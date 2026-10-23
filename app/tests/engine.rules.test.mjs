// Engine rule evals: detector thresholds (H1-H5), evidence gates, baselines, thin data,
// missing / zero values, de-duplication labels, period split, guardrail measurement and re-gating.
// Every fixture is hand-built and every expected figure is worked out by hand in the comments,
// so these tests check the engine against independent arithmetic, not against its own output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, buildPositions, buildUnits, detectH1, detectH2, detectH3, detectH4, detectH5,
  definedMaxLoss, measureGuardrail, regate, CONFIG,
} from '../src/engine.js';
import { PERSONAS } from '../src/data.js';

// ---------- fixture helpers ----------

const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const ts = (day, min) => `${day}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00+05:30`;
const D = (d) => `2026-09-${String(d).padStart(2, '0')}`;

let seq = 0;
function fill(day, min, symbol, side, qty, price, o = {}) {
  return {
    id: `F${String(++seq).padStart(5, '0')}`, ts: ts(day, min), underlying: o.underlying ?? 'NIFTY', symbol,
    optType: o.optType ?? 'CE', strike: o.strike ?? 25000, expiry: '2026-09-29', side, qty, price,
    charges: o.charges === undefined ? 0 : o.charges, strategyId: o.sid ?? null,
  };
}

// Single-leg option buy: BUY qty @entry at `open`, SELL qty @exit at `close` (minutes after midnight, IST).
// Each trade gets its own contract symbol so trades never merge into one position.
function buy(day, open, close, entry, exit, o = {}) {
  const qty = o.qty ?? 75;
  const symbol = `NIFTY T${++seq} ${o.strike ?? 25000} CE`;
  const entryCh = o.entryCharges !== undefined ? o.entryCharges : o.charges;
  const exitCh = o.exitCharges !== undefined ? o.exitCharges : o.charges;
  return [fill(day, open, symbol, 'BUY', qty, entry, { charges: entryCh }), fill(day, close, symbol, 'SELL', qty, exit, { charges: exitCh })];
}
const uid = (tradeFills) => `P:${tradeFills[0].id}`;
const unitsOf = (fills) => buildUnits(buildPositions(fills).positions);

// A trade with an exact rupee P&L: 1 unit bought at ₹10,000 and sold at ₹10,000 + pnl, no charges.
const pnlTrade = (day, open, pnl) => buy(day, open, open + 10, 10000, 10000 + pnl, { qty: 1 });

// H1 month builder. spec maps a day to the P&L of each re-entry on that day. Every re-entry R is
// preceded by a losing trigger L (P&L `trigger`) that closed 5 min before R opened; after the day's
// last re-entry comes one winner W (P&L `winner`) 40 min later. Blocks are 40 min apart, so only
// the re-entries are H1 occurrences. Comparison trades for H1 are therefore every L and W.
// `fillers` adds winning trades (P&L `winner`), five a day, on later days.
function revengeMonth(spec, { trigger = -1000, winner = 5000, fillers = 0 } = {}) {
  const fills = [];
  const ids = { L: [], R: [], W: [], F: [] };
  for (const [day, rs] of Object.entries(spec)) {
    let cur = hm('09:20');
    for (const r of rs) {
      const L = pnlTrade(day, cur, trigger);
      const R = pnlTrade(day, cur + 15, r);
      fills.push(...L, ...R);
      ids.L.push(uid(L));
      ids.R.push(uid(R));
      cur += 65;
    }
    const W = pnlTrade(day, cur, winner);
    fills.push(...W);
    ids.W.push(uid(W));
  }
  for (let i = 0; i < fillers; i++) {
    const F = pnlTrade(D(21 + Math.floor(i / 5)), hm('09:20') + 40 * (i % 5), winner);
    fills.push(...F);
    ids.F.push(uid(F));
  }
  return { fills, ids };
}
const check = (h, id) => h.gates.checks.find((c) => c.id === id);
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---------- H1: re-entry after a loss ----------

test('H1: a re-entry exactly 15 min after a losing trade counts; 16 min does not', () => {
  // Loss: buy 75 @100 at 10:00, sell @90 at 10:10 → (90 − 100) × 75 = −₹750 (no charges).
  for (const [gap, expected] of [[15, 1], [16, 0]]) {
    const L = buy(D(1), hm('10:00'), hm('10:10'), 100, 90);
    const R = buy(D(1), hm('10:10') + gap, hm('10:40'), 100, 110);
    const r = detectH1(unitsOf([...L, ...R]));
    assert.equal(r.opportunities, 1, 'one losing trade = one chance');
    assert.equal(r.occ.length, expected, `gap ${gap}`);
    if (expected) {
      assert.equal(r.occ[0].unit.id, uid(R));
      assert.equal(r.occ[0].trigger.gapMin, 15);
      assert.equal(r.occ[0].trigger.prevPnl, -750);
    }
  }
});

test('H1: a previous trade with net P&L exactly ₹0 after charges is not a loss and triggers nothing', () => {
  // Buy 75 @100, sell 75 @101: gross +₹75; charges ₹37.50 on each order → net exactly ₹0.
  const P = buy(D(1), hm('10:00'), hm('10:10'), 100, 101, { charges: 37.5 });
  const R = buy(D(1), hm('10:15'), hm('10:25'), 100, 90);
  const units = unitsOf([...P, ...R]);
  assert.equal(units[0].netPnl, 0);
  assert.equal(units[0].outcome, 'flat');
  const r = detectH1(units);
  assert.equal(r.occ.length, 0);
  // A chance is a trade opened after a losing trade; the only earlier trade was flat, so there is none.
  assert.equal(r.opportunities, 0, 'no trade follows a losing trade');
});

test('H1: compares against the most recently CLOSED trade, not the most recently opened one', () => {
  // A: 10:00–11:00, loss. B: 10:30–10:40, win (opened later, closed earlier). C opens 11:05.
  // The last trade closed before 11:05 is A (a loss, 5 min earlier), so C counts; B does not (nothing closed before 10:30).
  const A = buy(D(1), hm('10:00'), hm('11:00'), 100, 80);
  const B = buy(D(1), hm('10:30'), hm('10:40'), 100, 120);
  const C = buy(D(1), hm('11:05'), hm('11:15'), 100, 120);
  const r = detectH1(unitsOf([...A, ...B, ...C]));
  assert.deepEqual(r.occ.map((o) => o.unit.id), [uid(C)]);
  assert.equal(r.occ[0].trigger.prevId, uid(A));
});

// ---------- H2: adding to a losing buy ----------

function addTrade(day, open, prices) {
  // prices: [[side, qty, price], ...] on one contract, 5 min apart.
  const symbol = `NIFTY T${++seq} 25000 CE`;
  return prices.map(([side, qty, price], i) => fill(day, open + 5 * i, symbol, side, qty, price));
}

test('H2: adding at exactly 80% of the first price counts; 80.05 does not', () => {
  const at80 = addTrade(D(1), hm('10:00'), [['BUY', 75, 100], ['BUY', 75, 80], ['SELL', 150, 70]]);
  const above = addTrade(D(2), hm('10:00'), [['BUY', 75, 100], ['BUY', 75, 80.05], ['SELL', 150, 70]]);
  const r = detectH2(unitsOf([...at80, ...above]));
  assert.equal(r.opportunities, 2);
  assert.deepEqual(r.occ.map((o) => o.unit.id), [`P:${at80[0].id}`]);
  assert.equal(r.occ[0].trigger.firstPrice, 100);
  assert.equal(r.occ[0].trigger.addPrice, 80);
  assert.ok(close(r.occ[0].trigger.dropPct, 0.2));
});

test('H2: a buy after a partial sale is not "adding to a loser"; short singles and spreads are not chances', () => {
  // Buy 150 @100, sell 75 @90, buy 75 @70 (30% lower, but after a sale), sell 150 @60.
  const afterSell = addTrade(D(1), hm('10:00'), [['BUY', 150, 100], ['SELL', 75, 90], ['BUY', 75, 70], ['SELL', 150, 60]]);
  const shortSingle = addTrade(D(1), hm('11:00'), [['SELL', 75, 100], ['BUY', 75, 50]]);
  // Debit spread whose first leg is a long that is added to 25% lower (80 → 60). It is a strategy, so neither
  // a chance nor an occurrence, even though its long leg on its own would match the pattern.
  const sid = `H2S${++seq}`;
  const spread = [
    fill(D(1), hm('11:30'), `NIFTY ${sid} 25000 CE`, 'BUY', 75, 80, { sid }),
    fill(D(1), hm('11:31'), `NIFTY ${sid} 25100 CE`, 'SELL', 75, 30, { sid, strike: 25100 }),
    fill(D(1), hm('11:35'), `NIFTY ${sid} 25000 CE`, 'BUY', 75, 60, { sid }),
    fill(D(1), hm('12:00'), `NIFTY ${sid} 25000 CE`, 'SELL', 150, 50, { sid }),
    fill(D(1), hm('12:00'), `NIFTY ${sid} 25100 CE`, 'BUY', 75, 20, { sid, strike: 25100 }),
  ];
  const units = unitsOf([...afterSell, ...shortSingle, ...spread]);
  assert.deepEqual(units.map((u) => u.kind), ['single', 'single', 'strategy']);
  const st = units[2];
  assert.equal(st.positions[0].direction, 'long', 'the spread leads with its long leg');
  const r = detectH2(units);
  assert.equal(r.occ.length, 0);
  assert.equal(r.opportunities, 1, 'only the single-leg long counts as a chance');
});

// ---------- H3: hedge removed, short kept ----------

// Bear call spread: sell 24900 CE @60 and buy 25000 CE @25 at 10:00 (1 lot = 75).
// Net credit (60 − 25) × 75 = 2,625; width 100 × 75 = 7,500 → defined max loss 7,500 − 2,625 = 4,875.
// Hedge sold @8 at 10:10; short bought back @190 `gap` minutes later.
// Gross = (8 − 25) × 75 + (60 − 190) × 75 = −1,275 − 9,750 = −11,025 → excess beyond max = 6,150.
function hedgeSpread(day, gap, shortExit = 190) {
  const sid = `SP${++seq}`;
  return [
    fill(day, hm('10:00'), `NIFTY ${sid} 24900 CE`, 'SELL', 75, 60, { sid, strike: 24900 }),
    fill(day, hm('10:00'), `NIFTY ${sid} 25000 CE`, 'BUY', 75, 25, { sid, strike: 25000 }),
    fill(day, hm('10:10'), `NIFTY ${sid} 25000 CE`, 'SELL', 75, 8, { sid, strike: 25000 }),
    fill(day, hm('10:10') + gap, `NIFTY ${sid} 24900 CE`, 'BUY', 75, shortExit, { sid, strike: 24900 }),
  ];
}

test('H3: hedge closed exactly 5 min before the short does not count (> 5 required); 6 min does', () => {
  const five = detectH3(unitsOf(hedgeSpread(D(1), 5)));
  assert.equal(five.opportunities, 1);
  assert.equal(five.occ.length, 0);
  const six = detectH3(unitsOf(hedgeSpread(D(1), 6)));
  assert.equal(six.opportunities, 1);
  assert.equal(six.occ.length, 1);
  assert.equal(six.occ[0].maxLoss, 4875);
  assert.equal(six.occ[0].unit.grossPnl, -11025);
  assert.equal(six.occ[0].excess, 6150);
  assert.equal(six.occ[0].trigger.gapMin, 6);
});

test('H3: with two protective longs, the gap is measured from the LAST long to close', () => {
  // Short 24900 CE, longs 25000 CE and 25100 CE, all at 10:00. Longs close at 10:10 and 10:20.
  // The short closes `gap` min after 10:20: still hedged until 10:20, so only that gap counts.
  const mk = (gap) => {
    const sid = `H3L${++seq}`;
    return [
      fill(D(1), hm('10:00'), `NIFTY ${sid} 24900 CE`, 'SELL', 75, 60, { sid, strike: 24900 }),
      fill(D(1), hm('10:00'), `NIFTY ${sid} 25000 CE`, 'BUY', 75, 25, { sid, strike: 25000 }),
      fill(D(1), hm('10:00'), `NIFTY ${sid} 25100 CE`, 'BUY', 75, 10, { sid, strike: 25100 }),
      fill(D(1), hm('10:10'), `NIFTY ${sid} 25000 CE`, 'SELL', 75, 8, { sid, strike: 25000 }),
      fill(D(1), hm('10:20'), `NIFTY ${sid} 25100 CE`, 'SELL', 75, 3, { sid, strike: 25100 }),
      fill(D(1), hm('10:20') + gap, `NIFTY ${sid} 24900 CE`, 'BUY', 75, 120, { sid, strike: 24900 }),
    ];
  };
  const four = detectH3(unitsOf(mk(4))); // 14 min after the first long, but only 4 after the last
  assert.equal(four.opportunities, 1);
  assert.equal(four.occ.length, 0);
  const six = detectH3(unitsOf(mk(6)));
  assert.equal(six.occ.length, 1);
  assert.equal(six.occ[0].trigger.gapMin, 6, 'not 16 (measured from the first long)');
});

test('H3: removal that ends inside the defined max loss has zero excess; unhedged strategies are not chances', () => {
  // Short bought back @6 instead: gross = −1,275 + (60 − 6) × 75 = +2,775 → excess 0.
  const fine = analyze(hedgeSpread(D(1), 20, 6));
  assert.equal(fine.standalone.H3.occurrences, 1);
  assert.equal(fine.standalone.H3.cost, 0);
  assert.equal(fine.habits.H3.status, 'not-costly');
  // Short CE + long PE: no long of the same option type protects the short, so not a hedged spread.
  const sid = `ST${++seq}`;
  const strangle = [
    fill(D(1), hm('10:00'), `NIFTY ${sid} 25000 CE`, 'SELL', 75, 50, { sid }),
    fill(D(1), hm('10:00'), `NIFTY ${sid} 24500 PE`, 'BUY', 75, 20, { sid, optType: 'PE', strike: 24500 }),
    fill(D(1), hm('10:10'), `NIFTY ${sid} 24500 PE`, 'SELL', 75, 10, { sid, optType: 'PE', strike: 24500 }),
    fill(D(1), hm('11:00'), `NIFTY ${sid} 25000 CE`, 'BUY', 75, 90, { sid }),
  ];
  const r = detectH3(unitsOf(strangle));
  assert.equal(r.opportunities, 0);
  assert.equal(r.occ.length, 0);
});

test('definedMaxLoss: debit structure loses at most the net debit', () => {
  // Bull call spread: buy 25000 CE @80, sell 25100 CE @30 → net debit (80 − 30) × 75 = 3,750.
  const sid = `DB${++seq}`;
  const fills = [
    fill(D(1), hm('10:00'), `NIFTY ${sid} 25000 CE`, 'BUY', 75, 80, { sid }),
    fill(D(1), hm('10:00'), `NIFTY ${sid} 25100 CE`, 'SELL', 75, 30, { sid, strike: 25100 }),
    fill(D(1), hm('10:30'), `NIFTY ${sid} 25000 CE`, 'SELL', 75, 40, { sid }),
    fill(D(1), hm('10:30'), `NIFTY ${sid} 25100 CE`, 'BUY', 75, 10, { sid, strike: 25100 }),
  ];
  assert.equal(definedMaxLoss(unitsOf(fills)[0]), 3750);
});

// ---------- H4: size-up after two wins ----------

test('H4: exactly 1.5× the median size right after two wins counts; 2.96 lots does not; after one win is no chance', () => {
  // Lots: 2, 2, then 3 → median 2, 1.5 × 2 = 3.
  const mk = (third, firstPnlExit) => [
    ...buy(D(1), hm('10:00'), hm('10:10'), 100, firstPnlExit, { qty: 150 }),
    ...buy(D(1), hm('10:50'), hm('11:00'), 100, 120, { qty: 150 }),
    ...buy(D(1), hm('11:40'), hm('11:50'), 100, 90, { qty: third }),
  ];
  const exact = detectH4(unitsOf(mk(225, 120)));
  assert.equal(exact.median, 2);
  assert.equal(exact.opportunities, 1);
  assert.equal(exact.occ.length, 1);
  assert.deepEqual(exact.occ[0].trigger, { lots: 3, median: 2 });

  const below = detectH4(unitsOf(mk(222, 120))); // 222 / 75 = 2.96 lots
  assert.equal(below.opportunities, 1);
  assert.equal(below.occ.length, 0);

  const oneWin = detectH4(unitsOf(mk(225, 80))); // first trade loses: loss, win, then 3 lots
  assert.equal(oneWin.opportunities, 0);
  assert.equal(oneWin.occ.length, 0);
});

// ---------- H5: past the 5th trade of the day ----------

test('H5: the 5th trade of a day does not count, the 6th does; the count restarts each day', () => {
  const day = (d, n) => Array.from({ length: n }, (_, i) => buy(D(d), hm('09:20') + 40 * i, hm('09:30') + 40 * i, 100, 110)).flat();
  const five = detectH5(unitsOf([...day(1, 5), ...day(2, 5)]));
  assert.equal(five.opportunities, 10);
  assert.equal(five.occ.length, 0);
  const six = detectH5(unitsOf(day(3, 6)));
  assert.equal(six.occ.length, 1);
  assert.deepEqual(six.occ[0].trigger, { index: 6, limit: 5 });
});

// ---------- evidence gates (via H1 months with a zero baseline) ----------

test('G1 boundary: 3 occurrences fail "Repeated", 4 pass', () => {
  // Re-entries −2,000 each on separate days. Comparison = L (−1,000) and W (+5,000) per day → positive mean → baseline 0.
  const four = analyze(revengeMonth({ [D(1)]: [-2000], [D(2)]: [-2000], [D(3)]: [-2000], [D(4)]: [-2000] }).fills).standalone.H1;
  assert.equal(four.costing.baseline, 0);
  assert.equal(four.cost, 8000);
  assert.equal(four.gates.pass, true);
  const three = analyze(revengeMonth({ [D(1)]: [-2000], [D(2)]: [-2000], [D(3)]: [-2000] }).fills).standalone.H1;
  assert.equal(three.gates.failed.id, 'G1');
  assert.equal(check(three, 'G1').value, 3);
  assert.equal(check(three, 'G1').threshold, 4);
  for (const g of ['G2', 'G3', 'G4']) assert.equal(check(three, g).pass, true, g);
});

test('G2 boundary: 4 occurrences on 2 days fail "Spread out", on 3 days pass', () => {
  const two = analyze(revengeMonth({ [D(1)]: [-2000, -2000], [D(2)]: [-2000, -2000] }).fills).standalone.H1;
  assert.equal(two.occurrences, 4);
  assert.equal(two.gates.failed.id, 'G2');
  assert.equal(check(two, 'G2').value, 2);
  const three = analyze(revengeMonth({ [D(1)]: [-2000, -2000], [D(2)]: [-2000], [D(3)]: [-2000] }).fills).standalone.H1;
  assert.equal(check(three, 'G2').value, 3);
  assert.equal(three.gates.pass, true);
});

test('G3 boundary at the ₹1,000 minimum: cost exactly ₹1,000 passes, ₹999 fails', () => {
  // Gross losses = 4 × 1,000 (triggers) + 1,000 (re-entries) = 5,000 → 5% = 250 → floor = max(1,000, 250) = 1,000.
  const at = analyze(revengeMonth({ [D(1)]: [-250], [D(2)]: [-250], [D(3)]: [-250], [D(4)]: [-250] }).fills);
  assert.equal(at.summary.floor, 1000);
  assert.equal(at.standalone.H1.cost, 1000);
  assert.equal(check(at.standalone.H1, 'G3').pass, true);
  const below = analyze(revengeMonth({ [D(1)]: [-250], [D(2)]: [-250], [D(3)]: [-250], [D(4)]: [-249] }).fills);
  assert.equal(below.summary.floor, 1000);
  assert.equal(below.standalone.H1.cost, 999);
  assert.equal(check(below.standalone.H1, 'G3').pass, false);
});

test('G3 boundary at 5% of gross losses: cost equal to the floor passes, ₹1 under fails', () => {
  // Triggers −9,500 × 4 = 38,000; winners +10,000 × 4 → comparison mean (−38,000 + 40,000) / 8 = +250 → baseline 0.
  // Re-entries −500 × 4: cost 2,000; gross losses 40,000 → floor = max(1,000, 2,000) = 2,000 → passes.
  const opts = { trigger: -9500, winner: 10000 };
  const at = analyze(revengeMonth({ [D(1)]: [-500], [D(2)]: [-500], [D(3)]: [-500], [D(4)]: [-500] }, opts).fills);
  assert.equal(at.summary.grossLosses, 40000);
  assert.equal(at.summary.floor, 2000);
  assert.equal(at.standalone.H1.cost, 2000);
  assert.equal(check(at.standalone.H1, 'G3').pass, true);
  // One re-entry at −499: cost 1,999; gross losses 39,999 → floor 1,999.95, so it fails even though it is far above ₹1,000.
  const below = analyze(revengeMonth({ [D(1)]: [-500], [D(2)]: [-500], [D(3)]: [-500], [D(4)]: [-499] }, opts).fills);
  assert.ok(close(below.summary.floor, 1999.95, 1e-6));
  assert.equal(below.standalone.H1.cost, 1999);
  assert.equal(check(below.standalone.H1, 'G3').pass, false);
  assert.equal(below.standalone.H1.gates.failed.id, 'G3');
});

test('G4 boundary at the 40% leave-one-out share: exactly 40% passes, just under fails', () => {
  // Re-entries −6,000, −2,000, −1,000, −1,000 → cost 10,000; without the worst: 4,000 = 40% of 10,000 → passes.
  const at = analyze(revengeMonth({ [D(1)]: [-6000], [D(2)]: [-2000], [D(3)]: [-1000], [D(4)]: [-1000] }).fills).standalone.H1;
  assert.equal(at.cost, 10000);
  assert.equal(at.gates.loo, 4000);
  assert.ok(close(at.gates.topShare, 0.6));
  assert.equal(check(at, 'G4').threshold, 4000);
  assert.equal(at.gates.pass, true);
  // Worst at −6,001 → cost 10,001; loo 4,000 < 40% × 10,001 = 4,000.4 → fails on G4 only.
  const under = analyze(revengeMonth({ [D(1)]: [-6001], [D(2)]: [-2000], [D(3)]: [-1000], [D(4)]: [-1000] }).fills).standalone.H1;
  assert.equal(under.gates.loo, 4000);
  assert.ok(close(check(under, 'G4').threshold, 4000.4, 1e-6));
  assert.equal(under.gates.failed.id, 'G4');
});

test('G4 boundary at the ₹1,000 leave-one-out minimum', () => {
  // −1,000, −400, −300, −300 → cost 2,000, loo 1,000 (≥ 1,000 and ≥ 800) → passes.
  const at = analyze(revengeMonth({ [D(1)]: [-1000], [D(2)]: [-400], [D(3)]: [-300], [D(4)]: [-300] }).fills).standalone.H1;
  assert.equal(at.gates.loo, 1000);
  assert.equal(check(at, 'G4').pass, true);
  // −1,000, −400, −300, −299 → cost 1,999 (above the ₹1,000 floor), loo 999 → fails on G4.
  const under = analyze(revengeMonth({ [D(1)]: [-1000], [D(2)]: [-400], [D(3)]: [-300], [D(4)]: [-299] }).fills).standalone.H1;
  assert.equal(under.gates.loo, 999);
  assert.equal(check(under, 'G3').pass, true);
  assert.equal(under.gates.failed.id, 'G4');
});

test('Confidence: 8 occurrences with leave-two-out ≥ ₹1,000 is Strong; 7 is Moderate', () => {
  const eight = analyze(revengeMonth({ [D(1)]: [-2000, -2000], [D(2)]: [-2000, -2000], [D(3)]: [-2000, -2000], [D(4)]: [-2000, -2000] }).fills).standalone.H1;
  assert.equal(eight.occurrences, 8);
  assert.equal(eight.gates.loo2, 12000); // 16,000 − 2,000 − 2,000
  assert.equal(eight.gates.confidence, 'Strong');
  const seven = analyze(revengeMonth({ [D(1)]: [-2000, -2000], [D(2)]: [-2000, -2000], [D(3)]: [-2000, -2000], [D(4)]: [-2000] }).fills).standalone.H1;
  assert.equal(seven.gates.confidence, 'Moderate');
});

test('Confidence: 8 occurrences that pass every gate are only Moderate when leave-two-out is under ₹1,000', () => {
  // Re-entries −2,000, −2,000 and six small ones. Comparison = 8 L (−1,000) + 4 W (+5,000) → mean +1,000 → baseline 0.
  // Small ones summing to 1,000: cost 5,000, loo 3,000 (≥ 2,000), loo2 exactly 1,000 → Strong.
  const at = analyze(revengeMonth({ [D(1)]: [-2000, -200], [D(2)]: [-2000, -200], [D(3)]: [-150, -150], [D(4)]: [-150, -150] }).fills).standalone.H1;
  assert.equal(at.occurrences, 8);
  assert.equal(at.costing.baseline, 0);
  assert.equal(at.cost, 5000);
  assert.equal(at.gates.pass, true);
  assert.equal(at.gates.loo2, 1000);
  assert.equal(at.gates.confidence, 'Strong');
  // Small ones summing to 999: cost 4,999, loo 2,999 (≥ 1,999.6, so G4 still passes), loo2 999 → Moderate.
  const under = analyze(revengeMonth({ [D(1)]: [-2000, -200], [D(2)]: [-2000, -200], [D(3)]: [-150, -150], [D(4)]: [-150, -149] }).fills).standalone.H1;
  assert.equal(under.occurrences, 8);
  assert.equal(under.cost, 4999);
  assert.equal(under.gates.pass, true);
  assert.equal(under.gates.loo2, 999);
  assert.equal(under.gates.confidence, 'Moderate');
});

// ---------- baselines ----------

test('Baseline cap: a positive comparison mean gives baseline 0; a negative mean is used as the baseline', () => {
  const spec = { [D(1)]: [-2000], [D(2)]: [-2000], [D(3)]: [-2000], [D(4)]: [-2000] };
  // Winners +5,000: comparison = 4 × (−1,000) + 4 × 5,000 → mean +2,000 → capped to 0 → cost = 4 × 2,000 = 8,000.
  const pos = analyze(revengeMonth(spec).fills).standalone.H1.costing;
  assert.equal(pos.comparisonN, 8);
  assert.equal(pos.comparisonMean, 2000);
  assert.equal(pos.baseline, 0);
  assert.equal(pos.cost, 8000);
  // Winners +200: mean (−4,000 + 800) / 8 = −400 → each re-entry contributes −(−2,000 − (−400)) = 1,600 → cost 6,400.
  const neg = analyze(revengeMonth(spec, { winner: 200 }).fills).standalone.H1;
  assert.equal(neg.costing.comparisonMean, -400);
  assert.equal(neg.costing.baseline, -400);
  assert.equal(neg.costing.thin, false);
  assert.deepEqual(neg.evidence.map((e) => e.contribution), [1600, 1600, 1600, 1600]);
  assert.equal(neg.cost, 6400);
});

test('Thin baseline: fewer than 5 comparison trades → baseline 0; at 5 the mean is used (and can make cost ≤ 0)', () => {
  // Day 1 and 2: L (−1,000) then two chained re-entries (−200 each, 5 min apart) → 4 occurrences.
  // Day 3: two stand-alone losers (−1,000), 40 min apart. Comparison = 2 L + 2 losers = 4 trades.
  const fills = [];
  for (const d of [1, 2]) fills.push(...pnlTrade(D(d), hm('09:20'), -1000), ...pnlTrade(D(d), hm('09:35'), -200), ...pnlTrade(D(d), hm('09:50'), -200));
  fills.push(...pnlTrade(D(3), hm('09:20'), -1000), ...pnlTrade(D(3), hm('10:10'), -1000));
  const thin = analyze(fills).standalone.H1;
  assert.equal(thin.occurrences, 4);
  assert.equal(thin.costing.comparisonN, 4);
  assert.equal(thin.costing.thin, true);
  assert.equal(thin.costing.comparisonMean, -1000);
  assert.equal(thin.costing.baseline, 0);
  assert.equal(thin.cost, 800);
  // A 5th comparison loser: baseline −1,000; each re-entry did better than usual: −(−200 + 1,000) = −800 → cost −3,200.
  const a = analyze([...fills, ...pnlTrade(D(4), hm('09:20'), -1000)]);
  const h = a.standalone.H1;
  assert.equal(h.costing.thin, false);
  assert.equal(h.costing.baseline, -1000);
  assert.equal(h.cost, -3200);
  assert.equal(a.habits.H1.status, 'not-costly');
  assert.match(a.habits.H1.statusReason, /did no worse than your usual trade/);
  assert.match(check(h, 'G3').reason, /₹0/, 'a negative cost is shown as no excess loss, never as a negative cost');
});

// ---------- thin month ----------

test('Thin month: 19 trades confirm nothing even when every gate passes; 20 trades confirm', () => {
  const spec = { [D(1)]: [-2000], [D(2)]: [-2000], [D(3)]: [-2000], [D(4)]: [-2000] }; // 12 trades
  const nineteen = analyze(revengeMonth(spec, { fillers: 7 }).fills);
  assert.equal(nineteen.summary.units, 19);
  assert.equal(nineteen.summary.thin, true);
  assert.equal(nineteen.standalone.H1.gates.pass, true);
  assert.deepEqual(nineteen.confirmed, []);
  assert.equal(nineteen.headlineCost, 0);
  assert.equal(nineteen.habits.H1.status, 'insufficient');
  assert.match(nineteen.habits.H1.statusReason, /only 19 trades/);
  assert.equal(nineteen.quality.status, 'insufficient');
  const twenty = analyze(revengeMonth(spec, { fillers: 8 }).fills);
  assert.equal(twenty.summary.units, 20);
  assert.deepEqual(twenty.confirmed.map((h) => h.id), ['H1']);
  assert.equal(twenty.headlineCost, 8000);
});

// ---------- zero, flat and missing values ----------

test('Zero exit price is a real (total) loss; a ₹0 net trade is "flat", not a win or a loss', () => {
  // Buy 75 @4, sell 75 @0, ₹20 charges each → gross −300, net −340.
  const zero = buy(D(1), hm('10:00'), hm('10:10'), 4, 0, { charges: 20 });
  const flat = buy(D(1), hm('11:00'), hm('11:10'), 100, 101, { charges: 37.5 });
  const a = analyze([...zero, ...flat]);
  const z = a.units.find((u) => u.id === uid(zero));
  assert.equal(z.grossPnl, -300);
  assert.equal(z.netPnl, -340);
  assert.equal(z.outcome, 'loss');
  assert.equal(z.positions[0].avgExit, 0, 'an exit at ₹0 is a value, not a missing value');
  assert.equal(a.units.find((u) => u.id === uid(flat)).outcome, 'flat');
  assert.equal(a.stats.wins, 0);
  assert.equal(a.stats.losses, 1);
  assert.equal(a.stats.flat, 1);
  assert.equal(a.stats.winRate, 0);
  assert.equal(a.stats.avgWin, null, 'no wins → average win cannot be computed (null, not 0)');
  assert.equal(a.stats.largestWin, null);
  assert.equal(a.stats.avgLoss, -340);
});

test('Missing charges (null) are excluded from net P&L, counted, and reported; never read as ₹0 silently', () => {
  // T1: buy 75 @100 (₹20), sell 75 @110 (charges missing) → gross 750, net 730, 1 missing.
  // T2: buy 75 @100, sell 75 @90, both charges missing → gross −750, net −750, 2 missing.
  const t1 = buy(D(1), hm('10:00'), hm('10:10'), 100, 110, { entryCharges: 20, exitCharges: null });
  const t2 = buy(D(1), hm('11:00'), hm('11:10'), 100, 90, { charges: null });
  const a = analyze([...t1, ...t2]);
  const u1 = a.units.find((u) => u.id === uid(t1));
  const u2 = a.units.find((u) => u.id === uid(t2));
  assert.equal(u1.netPnl, 730);
  assert.equal(u1.charges, 20);
  assert.equal(u1.chargesMissing, 1);
  assert.equal(u2.netPnl, -750);
  assert.equal(u2.chargesMissing, 2);
  assert.equal(a.stats.tradesMissingCharges, 2);
  assert.equal(a.stats.chargesMissingFills, 3);
  assert.equal(a.stats.charges, 20);
  const item = a.quality.items.find((i) => i.code === 'charges');
  assert.ok(item);
  assert.match(item.text, /2 trades have orders with no charges recorded/);
});

test('No trades: statistics that cannot be computed are null, and quality says there is nothing to review', () => {
  const a = analyze([]);
  assert.equal(a.stats.winRate, null);
  assert.equal(a.stats.medianHoldMin, null);
  assert.equal(a.stats.avgLoss, null);
  assert.equal(a.quality.status, 'insufficient');
  assert.equal(a.quality.items[0].code, 'no-trades');
  for (const id of ['H1', 'H2', 'H3', 'H4', 'H5']) assert.equal(a.habits[id].status, 'not-seen');
  assert.match(a.habits.H3.statusReason, /could not occur/);
});

// ---------- de-duplication labels ----------

test('Overlap: shared trades are labelled counted / overlap, unclaimed ones flagged; headline counts them once', () => {
  // 5 days × 6 trades: four winners (+1,500), a loser (−750), then a 6th trade 5 min later losing −3,000.
  // The 6th trade is both an H1 re-entry and an H5 "past the 5th trade". Day 6: one losing H2 add (−3,000).
  const fills = [];
  for (const d of [1, 2, 3, 4, 7]) {
    for (let i = 0; i < 4; i++) fills.push(...buy(D(d), hm('09:20') + 50 * i, hm('09:30') + 50 * i, 100, 120));
    fills.push(...buy(D(d), hm('12:40'), hm('12:50'), 100, 90));
    fills.push(...buy(D(d), hm('12:55'), hm('13:05'), 100, 60));
  }
  const h2 = addTrade(D(8), hm('10:00'), [['BUY', 75, 100], ['BUY', 75, 80], ['SELL', 150, 70]]); // 10,500 − 13,500 = −3,000
  fills.push(...h2);
  const a = analyze(fills);
  assert.equal(a.summary.units, 31);
  const h1 = a.standalone.H1;
  const h5 = a.standalone.H5;
  assert.deepEqual([...h1.unitIds].sort(), [...h5.unitIds].sort());
  // Comparison mean is positive → baseline 0 → each standalone cost = 5 × 3,000.
  assert.equal(h1.cost, 15000);
  assert.equal(h5.cost, 15000);
  assert.equal(a.confirmed.length, 1);
  const top = a.confirmed[0].id;
  const other = top === 'H1' ? 'H5' : 'H1';
  assert.equal(a.habits[other].status, 'overlap');
  for (const u of h1.unitIds) {
    const roles = Object.fromEntries(a.labels[u].map((l) => [l.habitId, l]));
    assert.equal(roles[top].role, 'counted');
    assert.equal(roles[other].role, 'overlap');
    assert.equal(roles[other].countedUnder, top);
  }
  const h2Label = a.labels[`P:${h2[0].id}`];
  assert.deepEqual(h2Label.map((l) => [l.habitId, l.role, l.countedUnder]), [['H2', 'flagged', null]]);
  assert.equal(a.headlineCost, 15000, 'counted once, not 30,000');
  assert.equal(a.stats.daily.reduce((s, d) => s + d.habitTrades, 0), 5, 'daily habit trades count only "counted" labels');
});

// ---------- period split ----------

test('Period split: analyze(all fills, {period}) matches analyze(that month alone) for every persona-month', () => {
  for (const p of Object.values(PERSONAS)) {
    for (const [key, month] of Object.entries(p.months)) {
      const split = analyze(p.fills, { period: key });
      const alone = analyze(month.fills);
      assert.deepEqual(split.units.map((u) => u.id), alone.units.map((u) => u.id), `${p.id} ${key} units`);
      for (const f of ['units', 'netPnl', 'grossPnl', 'charges', 'floor', 'grossLosses', 'tradingDays', 'thin']) assert.equal(split.summary[f], alone.summary[f], `${p.id} ${key} ${f}`);
      assert.deepEqual(split.confirmed.map((h) => h.id), alone.confirmed.map((h) => h.id));
      assert.equal(split.headlineCost, alone.headlineCost);
      for (const id of ['H1', 'H2', 'H3', 'H4', 'H5']) {
        const [s, m] = [split.standalone[id], alone.standalone[id]];
        assert.deepEqual([s.occurrences, s.opportunities, s.cost, s.gates.pass], [m.occurrences, m.opportunities, m.cost, m.gates.pass], `${p.id} ${key} ${id}`);
        assert.equal(split.habits[id].status, alone.habits[id].status);
      }
      assert.deepEqual(split.stats, alone.stats);
      assert.deepEqual(split.labels, alone.labels);
    }
  }
});

// ---------- guardrail measurement with custom parameters ----------

test('measureGuardrail H1: a 30-minute cool-off catches a re-entry the 15-minute rule misses', () => {
  // L1 (−750) 10:00–10:10, W1 opens 20 min later; L2 (−750) 11:30–11:40, W2 opens 10 min later.
  const L1 = buy(D(1), hm('10:00'), hm('10:10'), 100, 90);
  const W1 = buy(D(1), hm('10:30'), hm('10:40'), 100, 110);
  const L2 = buy(D(1), hm('11:30'), hm('11:40'), 100, 90);
  const W2 = buy(D(1), hm('11:50'), hm('12:00'), 100, 110);
  const a = analyze([...L1, ...W1, ...L2, ...W2]);
  const m15 = measureGuardrail(a, 'H1', { minutes: 15 });
  assert.deepEqual([m15.opportunities, m15.violations, m15.rate, m15.compliance], [2, 1, 0.5, 0.5]);
  assert.deepEqual(m15.violatingUnitIds, [uid(W2)]);
  const m30 = measureGuardrail(a, 'H1', { minutes: 30 });
  assert.deepEqual([m30.violations, m30.compliance], [2, 0]);
  assert.deepEqual(m30.violatingUnitIds, [uid(W1), uid(W2)]);
});

test('measureGuardrail H5/H4/H2 with custom limits; H3 with no spreads is not measurable', () => {
  // Six trades in one day with lots 2, 2, 3, 4, 2, 2; the third opens with an add at 84 (16% below 100).
  const lots = [2, 2, 3, 4, 2, 2];
  const fills = [];
  lots.forEach((l, i) => {
    if (i === 2) fills.push(...addTrade(D(1), hm('09:20') + 40 * i, [['BUY', 225, 100], ['BUY', 75, 84], ['SELL', 300, 90]]));
    else fills.push(...buy(D(1), hm('09:20') + 40 * i, hm('09:30') + 40 * i, 100, 110, { qty: l * 75 }));
  });
  const a = analyze(fills);
  assert.equal(a.summary.units, 6);
  assert.equal(measureGuardrail(a, 'H5', { limit: 3 }).violations, 3); // 4th, 5th, 6th
  assert.equal(measureGuardrail(a, 'H5', { limit: 5 }).violations, 1);
  assert.equal(measureGuardrail(a, 'H5', { limit: 6 }).violations, 0);
  // H4 cap counts entries strictly above the cap (entry lots 2, 2, 3, 4, 2, 2).
  assert.equal(measureGuardrail(a, 'H4', { maxLots: 2 }).violations, 2);
  assert.equal(measureGuardrail(a, 'H4', { maxLots: 3 }).violations, 1);
  assert.equal(measureGuardrail(a, 'H4', { maxLots: 4 }).violations, 0);
  // H2: 84 is ≤ 85 (15% rule) but not ≤ 80 (20% rule).
  assert.equal(measureGuardrail(a, 'H2', { dropPct: 15 }).violations, 1);
  assert.equal(measureGuardrail(a, 'H2', { dropPct: 20 }).violations, 0);
  const h3 = measureGuardrail(a, 'H3', {});
  assert.equal(h3.measurable, false);
  assert.equal(h3.rate, null);
  assert.equal(h3.compliance, null, 'no chances → compliance unknown, not 100%');
  assert.match(h3.note, /No hedged spreads in this period/);
  assert.throws(() => measureGuardrail(a, 'H9', {}), /unknown habit/);
});

// ---------- re-gating with exclusions ----------

test('regate: excluding the worst trade removes its contribution, keeps the baseline, and re-runs the gates', () => {
  const { fills, ids } = revengeMonth({ [D(1)]: [-6000], [D(2)]: [-2000], [D(3)]: [-1000], [D(4)]: [-1000] }, { fillers: 8 });
  const a = analyze(fills);
  assert.equal(a.summary.units, 20);
  assert.equal(a.habits.H1.status, 'confirmed');
  const same = regate(a, 'H1', []);
  assert.equal(same.cost, 10000);
  assert.equal(same.wouldConfirm, true);
  const worst = regate(a, 'H1', [ids.R[0]]);
  assert.equal(worst.occurrences, 3);
  assert.equal(worst.cost, 4000);
  assert.equal(worst.gates.failed.id, 'G1');
  assert.equal(worst.wouldConfirm, false);
  assert.equal(regate(a, 'H1', ['P:not-a-trade']).cost, 10000, 'unknown ids are ignored');
});

test('regate: the comparison baseline is not recomputed when trades are excluded', () => {
  // Negative-baseline month from above: baseline −400, contributions 1,600 each, cost 6,400.
  const { fills, ids } = revengeMonth({ [D(1)]: [-2000], [D(2)]: [-2000], [D(3)]: [-2000], [D(4)]: [-2000] }, { winner: 200 });
  const a = analyze(fills);
  const r = regate(a, 'H1', [ids.R[1]]);
  assert.equal(r.costing.baseline, -400);
  assert.equal(r.costing.comparisonN, 8);
  assert.equal(r.cost, 4800);
});

test('regate in a thin month never reports wouldConfirm, even when gates pass', () => {
  const a = analyze(revengeMonth({ [D(1)]: [-2000], [D(2)]: [-2000], [D(3)]: [-2000], [D(4)]: [-2000] }).fills);
  const r = regate(a, 'H1', []);
  assert.equal(r.gates.pass, true);
  assert.equal(r.thin, true);
  assert.equal(r.wouldConfirm, false);
});

// ---------- top-3 limit ----------

// Four habits that each pass every gate on their own trades and share no trade with one another.
function fourHabitMonth() {
  const fills = [];
  for (const d of [1, 2, 3, 4, 7]) {
    fills.push(...buy(D(d), hm('09:20'), hm('09:30'), 100, 180)); // W +6,000
    fills.push(...buy(D(d), hm('10:10'), hm('10:20'), 100, 80)); // L −1,500
    fills.push(...buy(D(d), hm('10:25'), hm('10:35'), 100, 60)); // H1 re-entry −3,000
    fills.push(...addTrade(D(d), hm('11:15'), [['BUY', 75, 100], ['BUY', 75, 80], ['SELL', 150, 60]])); // H2 −4,500
    fills.push(...hedgeSpread(D(d), 20).map((f) => ({ ...f, ts: ts(D(d), hm(f.ts.slice(11, 16)) + 120) }))); // H3 excess 6,150
  }
  for (const d of [8, 9, 10, 11]) {
    for (let i = 0; i < 5; i++) fills.push(...buy(D(d), hm('09:20') + 40 * i, hm('09:30') + 40 * i, 100, 180));
    fills.push(...buy(D(d), hm('12:40'), hm('12:50'), 100, 72)); // 6th trade −2,100 (H5)
  }
  return analyze(fills);
}

test('Top-3 limit: a 4th habit that passes every gate is not confirmed; the three costliest are, in cost order', () => {
  const a = fourHabitMonth();
  // Standalone costs: H3 30,750, H2 22,500, H1 15,000, H5 8,400; all pass; no trade is shared.
  for (const id of ['H1', 'H2', 'H3', 'H5']) assert.equal(a.standalone[id].gates.pass, true, id);
  assert.deepEqual(['H3', 'H2', 'H1', 'H5'].map((id) => a.standalone[id].cost), [30750, 22500, 15000, 8400]);
  assert.deepEqual(a.confirmed.map((h) => h.id), ['H3', 'H2', 'H1']);
  assert.notEqual(a.habits.H5.status, 'confirmed');
  assert.equal(a.habits.H5.rank, null, 'not ranked among the confirmed habits');
  assert.equal(a.habits.H5.overlap, 0, 'none of its trades were claimed by another habit');
  assert.equal(a.headlineCost, 30750 + 22500 + 15000, 'the headline covers the three confirmed habits only');
});

// ---------- known issue (reported, not fixed) ----------

// A fourth habit that passes every gate on its own trades is dropped by the top-3 limit, but it is
// labelled "overlap" with the reason "Mostly the same trades as ..." although it shares no trade with
// any confirmed habit. The explanation shown to the trader is then factually wrong.
test('Top-3 limit: a 4th gate-passing habit with no shared trades is not described as overlapping', () => {
  const a = fourHabitMonth();
  assert.equal(a.habits.H5.overlap, 0);
  assert.doesNotMatch(a.habits.H5.statusReason, /Mostly the same trades/);
});
