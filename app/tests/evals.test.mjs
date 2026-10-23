// Habit Ledger evals. Run: node --test tests/
// Case IDs (E01...) match ../05_evaluation.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { analyze, compareHabit, parseCsv, toCsv, definedMaxLoss, buildPositions, buildUnits } from '../src/engine.js';
import { PERSONAS } from '../src/data.js';

const SEP = '2026-09';
const OCT = '2026-10';
const run = (p, m) => analyze(PERSONAS[p].months[m].fills);
const planted = (p, m, h) => PERSONAS[p].months[m].manifest.filter((x) => x.habit === h).map((x) => x.ref).sort();
const ids = (a) => a.confirmed.map((h) => h.id).sort();

// Independent fill-level P&L: recomputed from raw fills, not from engine positions.
function rawUnitPnl(fills, ref) {
  const mine = ref.startsWith('S:')
    ? fills.filter((f) => f.strategyId === ref.slice(2))
    : (() => {
      const first = fills.find((f) => `P:${f.id}` === ref);
      return fills.filter((f) => f.symbol === first.symbol && !f.strategyId && f.ts >= first.ts).reduce((acc, f) => {
        if (acc.done) return acc;
        acc.list.push(f);
        acc.q += f.side === 'BUY' ? f.qty : -f.qty;
        if (acc.q === 0) acc.done = true;
        return acc;
      }, { list: [], q: 0, done: false }).list;
    })();
  return mine.reduce((s, f) => s + (f.side === 'SELL' ? 1 : -1) * f.qty * f.price - f.charges, 0);
}

// ---------- E01-E03: normal scenarios / detection vs planted ground truth ----------

test('E01 Aarav Sep: H1 and H2 confirmed, detected sets equal planted sets for every detector', () => {
  const a = run('aarav', SEP);
  assert.deepEqual(ids(a), ['H1', 'H2']);
  for (const h of ['H1', 'H2', 'H3', 'H4', 'H5']) assert.deepEqual([...a.standalone[h].unitIds].sort(), planted('aarav', SEP, h), h);
  assert.equal(a.confirmed.find((h) => h.id === 'H1').gates.confidence, 'Strong');
  assert.equal(a.confirmed.find((h) => h.id === 'H2').gates.confidence, 'Moderate');
});

test('E02 Meera Sep: H3 and H5 confirmed, detected sets equal planted sets', () => {
  const a = run('meera', SEP);
  assert.deepEqual(ids(a), ['H3', 'H5']);
  for (const h of ['H1', 'H2', 'H3', 'H4', 'H5']) assert.deepEqual([...a.standalone[h].unitIds].sort(), planted('meera', SEP, h), h);
});

test('E03 All six persona-months: detected occurrences equal planted occurrences (precision = recall = 1)', () => {
  for (const p of Object.keys(PERSONAS)) {
    for (const m of [SEP, OCT]) {
      const a = run(p, m);
      for (const h of ['H1', 'H2', 'H3', 'H4', 'H5']) assert.deepEqual([...a.standalone[h].unitIds].sort(), planted(p, m, h), `${p} ${m} ${h}`);
    }
  }
});

// ---------- E04-E05: false positives ----------

test('E04 Kabir (disciplined) gets zero confirmed habits in both months', () => {
  assert.deepEqual(ids(run('kabir', SEP)), []);
  assert.deepEqual(ids(run('kabir', OCT)), []);
});

test('E05 Kabir near misses fail for the intended reason: H1 one-trade (G4), H2 too few (G1), H5 too few days (G2)', () => {
  const a = run('kabir', SEP);
  assert.equal(a.standalone.H1.gates.failed.id, 'G4');
  assert.equal(a.standalone.H2.gates.failed.id, 'G1');
  assert.equal(a.standalone.H5.gates.failed.id, 'G2');
  assert.equal(a.nearMisses.length, 3);
});

// ---------- E06: false negatives / below-threshold handling ----------

test('E06 Aarav H4 (3 occurrences) is surfaced as "not enough evidence", not dropped silently and not confirmed', () => {
  const a = run('aarav', SEP);
  const miss = a.nearMisses.find((x) => x.id === 'H4');
  assert.ok(miss);
  assert.equal(a.standalone.H4.occurrences, 3);
  assert.match(miss.reason, /at least 4/);
});

// ---------- E07-E08: numerical correctness ----------

test('E07 Baseline-excess cost equals an independent recomputation from raw fills', () => {
  for (const [p, h] of [['aarav', 'H1'], ['aarav', 'H2'], ['meera', 'H5'], ['kabir', 'H1']]) {
    const fills = PERSONAS[p].months[SEP].fills;
    const a = analyze(fills);
    const hr = a.standalone[h];
    const habitPnls = planted(p, SEP, h).map((r) => rawUnitPnl(fills, r));
    const others = hr.costing.comparisonN;
    // comparison mean recomputed from all units minus planted ones (eligible class handled for H2)
    const eligible = h === 'H2' ? a.units.filter((u) => u.kind === 'single' && u.positions[0].direction === 'long') : a.units;
    const comp = eligible.filter((u) => !planted(p, SEP, h).includes(u.id));
    assert.equal(comp.length, others);
    const mean = comp.reduce((s, u) => s + rawUnitPnl(fills, u.id), 0) / comp.length;
    const b = comp.length < 5 ? 0 : Math.min(mean, 0);
    const expected = -(habitPnls.reduce((s, x) => s + x, 0) - habitPnls.length * b);
    assert.ok(Math.abs(hr.cost - expected) < 0.01, `${p} ${h}: ${hr.cost} vs ${expected}`);
  }
});

test('E08 Hedge-removal cost: hand-worked spread and defined max loss', () => {
  // Sell 24900 CE @60, buy 25000 CE @25 (1 lot = 75). Credit 35*75 = 2625. Max loss = 100*75 - 2625 = 4875.
  // Long closed @8 at 10:10, short closed @190 at 10:40. Gross = (8-25)*75 + (60-190)*75 = -1275 - 9750 = -11025.
  // Excess beyond max = 11025 - 4875 = 6150.
  const f = (id, t, strike, side, price) => ({ id, ts: `2026-09-01T${t}:00+05:30`, underlying: 'NIFTY', symbol: `NIFTY X ${strike} CE`, optType: 'CE', strike, expiry: '2026-09-08', side, qty: 75, price, charges: 20, strategyId: 'T1' });
  const fills = [f('a', '10:00', 24900, 'SELL', 60), f('b', '10:00', 25000, 'BUY', 25), f('c', '10:10', 25000, 'SELL', 8), f('d', '10:40', 24900, 'BUY', 190)];
  const units = buildUnits(buildPositions(fills).positions);
  assert.equal(definedMaxLoss(units[0]), 4875);
  assert.equal(units[0].grossPnl, -11025);
  const a = analyze(fills);
  assert.equal(a.standalone.H3.occurrences, 1);
  assert.equal(a.standalone.H3.cost, 6150);
});

// ---------- E09: robustness gate ----------

test('E09 One blow-up trade cannot create a habit (leave-one-out gate)', () => {
  const a = run('kabir', SEP);
  const h = a.standalone.H1;
  assert.ok(h.gates.checks.find((c) => c.id === 'G1').pass && h.gates.checks.find((c) => c.id === 'G3').pass);
  assert.ok(h.gates.loo < 1000);
});

// ---------- E10-E11: incorrect / missing inputs ----------

test('E10 Malformed CSV rows are rejected with row numbers; good rows survive', () => {
  const good = toCsv(PERSONAS.aarav.months[SEP].fills.slice(0, 3));
  const bad = `${good}\nX1,not-a-date,NIFTY,NIFTY Y 24800 CE,CE,24800,2026-09-08,BUY,75,100,20,\nX2,2026-09-01T10:00:00+05:30,NIFTY,NIFTY Y 24800 XX,XX,24800,2026-09-08,HOLD,-5,abc,20,`;
  const r = parseCsv(bad);
  assert.equal(r.fatal, false);
  assert.equal(r.fills.length, 3);
  assert.equal(r.errors.length, 2);
  assert.equal(r.errors[0].row, 5);
  assert.match(r.errors[1].message, /optType/);
  assert.match(r.errors[1].message, /side/);
  assert.match(r.errors[1].message, /qty/);
  assert.match(r.errors[1].message, /price/);
});

test('E11 Missing columns and empty file are fatal with a clear message; analysis of no fills does not crash', () => {
  assert.equal(parseCsv('').fatal, true);
  const r = parseCsv('id,ts,side\n1,2026-09-01T10:00:00+05:30,BUY');
  assert.equal(r.fatal, true);
  assert.match(r.errors[0].message, /Missing column/);
  const a = analyze([]);
  assert.equal(a.summary.units, 0);
  assert.deepEqual(a.confirmed, []);
});

test('E12 Open positions at month end and flips through zero are excluded and reported', () => {
  const fills = PERSONAS.aarav.months[SEP].fills;
  const lastSell = [...fills].reverse().find((f) => f.side === 'SELL');
  const cut = fills.filter((f) => f !== lastSell);
  const flip = { ...fills[0], id: 'FLIP1', ts: '2026-09-30T10:00:00+05:30', symbol: 'NIFTY FLIP 25000 CE', side: 'BUY', qty: 75 };
  const flip2 = { ...flip, id: 'FLIP2', ts: '2026-09-30T10:05:00+05:30', side: 'SELL', qty: 150 };
  const a = analyze([...cut, flip, flip2]);
  const reasons = a.summary.excluded.map((x) => x.reason).join(' | ');
  assert.match(reasons, /Still open/);
  assert.match(reasons, /flipped/);
  assert.equal(a.summary.units, 51);
});

// ---------- E13: round trip ----------

test('E13 CSV export then import reproduces the same analysis', () => {
  const fills = PERSONAS.meera.months[SEP].fills;
  const r = parseCsv(toCsv(fills));
  assert.equal(r.errors.length, 0);
  const a1 = analyze(fills);
  const a2 = analyze(r.fills);
  assert.deepEqual(ids(a2), ids(a1));
  assert.ok(Math.abs(a2.headlineCost - a1.headlineCost) < 0.01);
});

// ---------- E14-E15: feedback loop ----------

test('E14 Month-over-month verdicts: Aarav H1 Improving, H2 No clear change; Meera H3 Improving, H5 No clear change', () => {
  const v = (p, h) => compareHabit(run(p, SEP), run(p, OCT), h).verdict;
  assert.equal(v('aarav', 'H1'), 'Improving');
  assert.equal(v('aarav', 'H2'), 'No clear change');
  assert.equal(v('meera', 'H3'), 'Improving');
  assert.equal(v('meera', 'H5'), 'No clear change');
});

test('E15 Trading less is not "improving": same rate with fewer opportunities stays No clear change', () => {
  const a1 = run('aarav', SEP);
  const fake = (rate, opp, cost) => ({ standalone: { H1: { occurrences: Math.round(rate * opp), opportunities: opp, rate, cost } } });
  const before = fake(a1.standalone.H1.rate, 31, 57897);
  assert.equal(compareHabit(before, fake(a1.standalone.H1.rate, 10, 20000), 'H1').verdict, 'No clear change');
  assert.equal(compareHabit(before, fake(0.5, 30, 60000), 'H1').verdict, 'Worsening');
  assert.equal(compareHabit(before, fake(0.5, 2, 60000), 'H1').verdict, 'Inconclusive');
});

// ---------- E16: de-duplication ----------

test('E16 A trade matching two habits is counted once; the lower-ranked habit is re-gated without it', () => {
  // Build a month where every revenge re-entry is also the 6th+ trade of its day.
  const L = (id, day, t, side, price, qty = 150) => ({ id, ts: `2026-09-${day}T${t}:00+05:30`, underlying: 'NIFTY', symbol: `NIFTY D${id.slice(0, -1)} 25000 CE`, optType: 'CE', strike: 25000, expiry: '2026-09-29', side, qty, price, charges: 20, strategyId: null });
  const fills = [];
  let n = 0;
  for (const day of ['01', '02', '03', '04', '07']) {
    const times = ['09:20', '10:00', '10:40', '11:20', '12:00', '12:40'];
    times.forEach((t, i) => {
      const id = `${day}-${++n}`;
      const lossy = i >= 4; // 5th loses, 6th is a fast re-entry that loses big
      const hh = Number(t.slice(0, 2));
      const mm = Number(t.slice(3));
      const open = i === 5 ? `${String(hh).padStart(2, '0')}:${String(mm - 22).padStart(2, '0')}` : t;
      const close = i === 5 ? t : `${String(hh).padStart(2, '0')}:${String(mm + 15).padStart(2, '0')}`;
      fills.push(L(`${id}a`, day, open, 'BUY', 100));
      fills.push(L(`${id}b`, day, close, 'SELL', lossy ? (i === 5 ? 40 : 85) : 125));
    });
  }
  const a = analyze(fills);
  const h1 = a.standalone.H1;
  const h5 = a.standalone.H5;
  assert.ok(h1.gates.pass && h5.gates.pass, 'both pass standalone');
  assert.deepEqual([...h1.unitIds].sort(), [...h5.unitIds].sort(), 'same trades');
  assert.equal(a.confirmed.length, 1, 'only one survives de-duplication');
  assert.equal(a.nearMisses.find((x) => x.status === 'overlap')?.reason.startsWith('Mostly the same trades'), true);
  assert.ok(a.headlineCost <= Math.max(h1.cost, h5.cost) + 0.01, 'headline not double counted');
});

// ---------- E17: honest language ----------

test('E17 No user-facing copy claims causation or forgone profit', () => {
  // Every source file the app ships (engine, store, views, components), not just one view.
  const dir = new URL('../src/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.js'));
  assert.ok(files.length >= 10, 'scans the whole src tree');
  const src = files.map((f) => readFileSync(new URL(String(f).replace(/\\/g, '/'), dir), 'utf8')).join('\n');
  for (const banned of [/would have (made|earned|saved)/i, /(habit|this|which|it) caused/i, /you should (buy|sell)/i, /guaranteed/i]) {
    assert.doesNotMatch(src, banned);
  }
  assert.match(src, /associated with/);
  assert.match(src, /not proof that the behaviour caused the loss/);
});

// ---------- E19: thin month ----------

test('E19 A month with too few trades never confirms a habit, even if gates pass', () => {
  // First 4 days of Aarav: includes 3 revenge re-entries but only ~15 trades.
  const days = new Set(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07']);
  const fills = PERSONAS.aarav.months[SEP].fills.filter((f) => days.has(f.ts.slice(0, 10)));
  const a = analyze(fills);
  assert.ok(a.summary.units < 20);
  assert.deepEqual(a.confirmed, []);
  // Force a gate-passing habit into a thin month: Meera's first 4 hedge-removal days only.
  // The days that hold Meera's hedge removals, read from the ground-truth manifest (not hard-coded dates).
  const m = PERSONAS.meera.months[SEP].fills;
  const h3Strategies = new Set(planted('meera', SEP, 'H3').map((r) => r.slice(2)));
  const h3Days = new Set(m.filter((f) => h3Strategies.has(f.strategyId)).map((f) => f.ts.slice(0, 10)));
  assert.equal(h3Days.size, 5);
  const thin = m.filter((f) => h3Days.has(f.ts.slice(0, 10)));
  const b = analyze(thin);
  assert.ok(b.summary.units < 20);
  assert.equal(b.standalone.H3.gates.pass, true, 'H3 passes gates on its own');
  assert.deepEqual(b.confirmed, []);
  assert.match(b.nearMisses.find((x) => x.id === 'H3').reason, /only \d+ trades/);
});

// ---------- E18: data realism checks ----------

test('E18 Synthetic data sanity: market hours, spread values below width, lot multiples', () => {
  for (const p of Object.values(PERSONAS)) {
    for (const m of Object.values(p.months)) {
      for (const f of m.fills) {
        const hm = f.ts.slice(11, 16);
        assert.ok(hm >= '09:15' && hm <= '15:30', `${f.id} at ${hm}`);
        assert.equal(f.qty % (f.underlying === 'NIFTY' ? 75 : 35), 0);
      }
      const units = buildUnits(buildPositions(m.fills).positions);
      for (const u of units.filter((x) => x.kind === 'strategy')) {
        // closing spread value never exceeds the 100-point width when both legs close together
        const legs = u.positions;
        const closeTs = new Set(legs.map((l) => l.closeTs));
        if (closeTs.size === 1 && legs.length === 2) {
          const s = legs.find((l) => l.direction === 'short').fills.at(-1).price;
          const l = legs.find((x) => x.direction === 'long').fills.at(-1).price;
          assert.ok(s - l <= 100 + 1e-9, `${u.id}: ${s}-${l}`);
        }
      }
    }
  }
});
