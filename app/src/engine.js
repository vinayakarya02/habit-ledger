// Habit Ledger engine: pure functions, no DOM. The single source of truth for every derived number
// the UI shows (positions, trades, habits, costs, gates, statistics, comparisons, guardrail compliance).
// Spec: ../../02_refined_mvp.md

import { COLUMNS, parseCsv, toCsv } from './import.js';
import { formatINR, formatMonth, formatPct, ordinal, plural, chanceText, isNum } from './format.js';

export { COLUMNS, parseCsv, toCsv, formatINR };

export const CONFIG = {
  revengeWindowMin: 15,
  avgDownRatio: 0.8,
  hedgeGapMin: 5,
  sizeMultiple: 1.5,
  dailyTradeLimit: 5,
  thinBaseline: 5,
  minUnits: 20, // below this, a period is too thin to judge habits at all
  maxHabits: 3, // at most this many confirmed habits are reported per period
  lotCapMultiple: 1.25, // default lot-cap guardrail = this x median entry size, rounded up
  gates: { minN: 4, minDays: 3, minCost: 1000, lossShare: 0.05, looMinCost: 1000, looMinShare: 0.4, strongN: 8 },
  // Period comparison: rates need enough chances in both periods, and a change unlikely to be chance.
  compare: { minOpp: 8, improve: 0.5, worse: 0.25, alpha: 0.2, strongAlpha: 0.05 },
  lotSize: { NIFTY: 75, BANKNIFTY: 35 },
};

export const HABITS = {
  H1: {
    name: 'Re-entering right after a loss',
    short: 'Re-entry after loss',
    definition: `A new trade opened within ${CONFIG.revengeWindowMin} minutes of closing a trade that lost money after charges.`,
    appliesTo: 'All trades',
    chance: 'trade opened after a losing trade',
    chances: 'trades opened after a losing trade',
    chanceNote: `Every trade you open after a losing trade is a chance; it counts when it comes within ${CONFIG.revengeWindowMin} minutes of that loss.`,
    comparison: 'All your other trades in the period',
    costModel: 'baseline-excess',
    cannotConclude: [
      'Whether a re-entry was planned (for example a pre-set second entry) or impulsive. Timing is only a proxy.',
      'Whether the earlier loss influenced the decision at all.',
      'Anything about trades placed in other accounts.',
    ],
  },
  H2: {
    name: 'Adding to a losing option buy',
    short: 'Adding to a loser',
    definition: `Buying more of an option you are already long, at ${Math.round(CONFIG.avgDownRatio * 100)}% or less of your first entry price, before any sale.`,
    appliesTo: 'Single-leg option buys',
    chance: 'option buy',
    chances: 'option buys',
    chanceNote: 'Every single-leg option buy could have been added to.',
    comparison: 'Your other single-leg option buys in the period',
    costModel: 'baseline-excess',
    cannotConclude: [
      'Whether a stop-loss order was attached. Fills show what executed, not what was resting.',
      'Whether the add was part of a planned scale-in.',
      'What the option did after you sold. The review never uses later market prices.',
    ],
  },
  H3: {
    name: 'Removing the hedge, keeping the short',
    short: 'Hedge removal',
    definition: `In a spread, the protective long leg is closed more than ${CONFIG.hedgeGapMin} minutes before the short leg it protected.`,
    appliesTo: 'Multi-leg strategies with a hedged short',
    chance: 'hedged spread',
    chances: 'hedged spreads',
    chanceNote: 'Every spread with a protective leg is a chance to remove it early.',
    comparison: "The spread's own defined maximum loss at entry",
    costModel: 'beyond-max-loss',
    cannotConclude: [
      'How much the removal saved when the market moved your way. This measure counts downside only.',
      'What the hedge would have been worth later, since no market prices are used.',
      'Whether legs that share a strategy ID were really entered as one strategy.',
    ],
  },
  H4: {
    name: 'Sizing up after a winning streak',
    short: 'Size-up after wins',
    definition: `A trade opened at ${CONFIG.sizeMultiple}× or more your median entry size, immediately after two winning trades.`,
    appliesTo: 'All trades',
    chance: 'trade opened after two wins',
    chances: 'trades opened after two wins',
    chanceNote: 'Only trades that follow two consecutive winners are chances.',
    comparison: 'All your other trades in the period',
    costModel: 'baseline-excess',
    cannotConclude: [
      'Whether the larger size was appropriate for your account. Account equity is not in the data.',
      'Whether the size change was planned in advance.',
    ],
  },
  H5: {
    name: 'Trading past your 5th trade of the day',
    short: 'Past daily limit',
    definition: `Any trade opened after the ${ordinal(CONFIG.dailyTradeLimit)} trade of the same day.`,
    appliesTo: 'All trades',
    chance: 'trade',
    chances: 'trades',
    chanceNote: 'Every trade is a chance; only those beyond the daily limit count.',
    comparison: 'All your other trades in the period',
    costModel: 'baseline-excess',
    cannotConclude: [
      'Your own limit. The review uses a fixed limit of 5; a personal limit can be set as a guardrail.',
      'Whether busy days had genuinely more opportunities.',
    ],
  },
};

export const HABIT_IDS = Object.keys(HABITS);

const MIN = 60000;
const ms = (ts) => Date.parse(ts);
const dayOf = (ts) => ts.slice(0, 10);
const timeOf = (ts) => ts.slice(11, 16);

// ---------- positions & units ----------

function finishPosition(p) {
  let buy = 0, sell = 0, buyQty = 0, sellQty = 0, ch = 0, chMissing = 0;
  for (const f of p.fills) {
    if (f.side === 'BUY') { buy += f.qty * f.price; buyQty += f.qty; } else { sell += f.qty * f.price; sellQty += f.qty; }
    if (isNum(f.charges)) ch += f.charges; else chMissing++;
  }
  const lot = CONFIG.lotSize[p.underlying] || 1;
  const first = p.fills[0];
  const last = p.fills[p.fills.length - 1];
  const long = p.direction === 'long';
  return {
    ...p,
    openTs: first.ts,
    closeTs: last.ts,
    holdMin: (ms(last.ts) - ms(first.ts)) / MIN,
    buyValue: buy,
    sellValue: sell,
    avgEntry: long ? buy / buyQty : sell / sellQty,
    avgExit: long ? (sellQty ? sell / sellQty : null) : (buyQty ? buy / buyQty : null),
    charges: ch,
    chargesMissing: chMissing,
    grossPnl: sell - buy,
    netPnl: sell - buy - ch,
    lotSize: lot,
    lotSizeKnown: Boolean(CONFIG.lotSize[p.underlying]),
    entryLots: first.qty / lot,
    maxLots: p.maxQty / lot,
    entryPrice: first.price,
  };
}

// Returns { positions, excluded: [{symbol, reason, fills, month}], warnings }
export function buildPositions(fills) {
  const sorted = [...fills].sort((a, b) => ms(a.ts) - ms(b.ts) || String(a.id).localeCompare(String(b.id)));
  const open = new Map();
  const positions = [];
  const excluded = [];
  const warnings = new Set();
  for (const f of sorted) {
    if (!CONFIG.lotSize[f.underlying]) warnings.add(`Unknown lot size for ${f.underlying}; lots are counted as 1 unit = 1 lot.`);
    const key = `${f.symbol}|${f.strategyId ?? ''}`;
    const signed = f.side === 'BUY' ? f.qty : -f.qty;
    let p = open.get(key);
    if (!p) {
      p = { id: `P:${f.id}`, symbol: f.symbol, underlying: f.underlying, optType: f.optType, strike: f.strike, expiry: f.expiry ?? null, strategyId: f.strategyId, direction: signed > 0 ? 'long' : 'short', qty: 0, maxQty: 0, fills: [] };
      open.set(key, p);
    }
    const next = p.qty + signed;
    if (p.qty !== 0 && Math.sign(next) !== 0 && Math.sign(next) !== Math.sign(p.qty)) {
      excluded.push({ symbol: p.symbol, reason: 'Position flipped from long to short (or back) in one order; excluded.', fills: [...p.fills, f], month: p.fills[0].ts.slice(0, 7) });
      open.delete(key);
      continue;
    }
    p.fills.push(f);
    p.qty = next;
    p.maxQty = Math.max(p.maxQty, Math.abs(next));
    if (next === 0) {
      positions.push(finishPosition(p));
      open.delete(key);
    }
  }
  for (const p of open.values()) excluded.push({ symbol: p.symbol, reason: 'Still open at the end of the data, or its closing order is missing (for example a row rejected at import); excluded.', fills: p.fills, month: p.fills[0].ts.slice(0, 7) });
  positions.sort((a, b) => ms(a.openTs) - ms(b.openTs));
  return { positions, excluded, warnings: [...warnings] };
}

function strategyLabel(positions) {
  const p0 = positions[0];
  const legs = positions.map((p) => `${p.direction === 'short' ? 'S' : 'B'} ${p.strike}${p.optType}`).join(' / ');
  return `${p0.underlying} strategy (${legs})`;
}

export function buildUnits(positions) {
  const units = [];
  const groups = new Map();
  for (const p of positions) {
    if (p.strategyId) {
      if (!groups.has(p.strategyId)) groups.set(p.strategyId, []);
      groups.get(p.strategyId).push(p);
    } else {
      units.push({
        id: p.id, kind: 'single', type: p.direction === 'long' ? 'long-option' : 'short-option', positions: [p], label: p.symbol,
        underlying: p.underlying, openTs: p.openTs, closeTs: p.closeTs, entryLots: p.entryLots,
        grossPnl: p.grossPnl, netPnl: p.netPnl, charges: p.charges, chargesMissing: p.chargesMissing,
      });
    }
  }
  for (const [sid, ps] of groups) {
    const openTs = ps.reduce((m, p) => (ms(p.openTs) < ms(m) ? p.openTs : m), ps[0].openTs);
    const closeTs = ps.reduce((m, p) => (ms(p.closeTs) > ms(m) ? p.closeTs : m), ps[0].closeTs);
    units.push({
      id: `S:${sid}`, kind: 'strategy', type: 'strategy', strategyId: sid, positions: ps, label: strategyLabel(ps),
      underlying: ps[0].underlying, openTs, closeTs,
      entryLots: Math.max(...ps.map((p) => p.entryLots)),
      grossPnl: ps.reduce((s, p) => s + p.grossPnl, 0),
      netPnl: ps.reduce((s, p) => s + p.netPnl, 0),
      charges: ps.reduce((s, p) => s + p.charges, 0),
      chargesMissing: ps.reduce((s, p) => s + p.chargesMissing, 0),
    });
  }
  units.sort((a, b) => ms(a.openTs) - ms(b.openTs) || a.id.localeCompare(b.id));
  units.forEach((u) => {
    u.day = dayOf(u.openTs);
    u.time = timeOf(u.openTs);
    u.month = u.openTs.slice(0, 7);
    u.holdMin = (ms(u.closeTs) - ms(u.openTs)) / MIN;
    u.outcome = u.netPnl > 0 ? 'win' : u.netPnl < 0 ? 'loss' : 'flat';
  });
  return units;
}

const BUILD_CACHE = new WeakMap();
function build(fills) {
  if (BUILD_CACHE.has(fills)) return BUILD_CACHE.get(fills);
  const { positions, excluded, warnings } = buildPositions(fills);
  const res = { positions, excluded, warnings, units: buildUnits(positions) };
  BUILD_CACHE.set(fills, res);
  return res;
}

// Review periods present in the data. A trade belongs to the month in which it was opened.
export function periodsOf(fills) {
  const { units } = build(fills);
  const by = new Map();
  for (const u of units) {
    const p = by.get(u.month) ?? { key: u.month, label: formatMonth(u.month), trades: 0, firstDay: u.day, lastDay: u.day };
    p.trades++;
    p.lastDay = u.day;
    by.set(u.month, p);
  }
  return [...by.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ---------- detectors (parameterised so guardrail compliance reuses the same logic) ----------

function lastClosedBefore(units, u, count) {
  const t = ms(u.openTs);
  return units
    .filter((q) => q !== u && ms(q.closeTs) <= t)
    .sort((a, b) => ms(b.closeTs) - ms(a.closeTs) || b.id.localeCompare(a.id))
    .slice(0, count);
}

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A chance is any trade opened after a losing trade (the most recently closed trade lost money);
// it is an occurrence when it opened within the window. Same unit top and bottom, so the rate ≤ 100%.
export function detectH1(units, { window = CONFIG.revengeWindowMin } = {}) {
  const occ = [];
  let opportunities = 0;
  for (const u of units) {
    const [q] = lastClosedBefore(units, u, 1);
    if (!q || q.netPnl >= 0) continue;
    opportunities++;
    const gap = (ms(u.openTs) - ms(q.closeTs)) / MIN;
    if (gap <= window) occ.push({ unit: u, trigger: { prevId: q.id, gapMin: gap, prevPnl: q.netPnl }, detail: `Opened ${Math.round(gap)} min after a ${formatINR(q.netPnl)} loss on ${q.label}` });
  }
  return { occ, opportunities, eligible: units };
}

export function detectH2(units, { ratio = CONFIG.avgDownRatio } = {}) {
  const eligible = units.filter((u) => u.kind === 'single' && u.positions[0].direction === 'long');
  const occ = [];
  for (const u of eligible) {
    const fills = u.positions[0].fills;
    const first = fills[0];
    for (const f of fills.slice(1)) {
      if (f.side === 'SELL') break;
      if (f.price <= ratio * first.price) {
        occ.push({ unit: u, trigger: { firstPrice: first.price, addPrice: f.price, dropPct: 1 - f.price / first.price }, detail: `Bought at ${first.price}, added more at ${f.price} (${Math.round((1 - f.price / first.price) * 100)}% lower)` });
        break;
      }
    }
  }
  return { occ, opportunities: eligible.length, eligible };
}

// Defined maximum loss of a strategy at entry (credit structures: widest wing × qty − net credit; debit: net debit).
export function definedMaxLoss(unit) {
  const ps = unit.positions;
  let credit = 0;
  for (const p of ps) credit += (p.direction === 'short' ? 1 : -1) * p.entryPrice * p.maxQty;
  let width = 0;
  for (const s of ps.filter((p) => p.direction === 'short')) {
    const longs = ps.filter((p) => p.direction === 'long' && p.optType === s.optType);
    for (const l of longs) width = Math.max(width, Math.abs(s.strike - l.strike) * s.maxQty);
  }
  return credit >= 0 ? width - credit : -credit;
}

export function detectH3(units, { gap: gapMin = CONFIG.hedgeGapMin } = {}) {
  const eligible = [];
  const occ = [];
  for (const u of units.filter((x) => x.kind === 'strategy')) {
    const shorts = u.positions.filter((p) => p.direction === 'short');
    let hedged = false;
    let removal = null;
    for (const s of shorts) {
      const longs = u.positions.filter((p) => p.direction === 'long' && p.optType === s.optType);
      if (!longs.length) continue;
      hedged = true;
      const hedgeClose = Math.max(...longs.map((l) => ms(l.closeTs)));
      const gap = (ms(s.closeTs) - hedgeClose) / MIN;
      if (gap > gapMin && !removal) removal = { s, gap };
    }
    if (!hedged) continue;
    eligible.push(u);
    if (removal) {
      const maxLoss = definedMaxLoss(u);
      const excess = Math.max(0, -u.grossPnl - maxLoss);
      occ.push({
        unit: u, maxLoss, excess,
        trigger: { shortLeg: `${removal.s.strike}${removal.s.optType}`, gapMin: removal.gap, maxLoss, grossPnl: u.grossPnl },
        detail: `Closed the protective leg, then kept the short ${removal.s.strike}${removal.s.optType} open for ${Math.round(removal.gap)} more min. Defined max loss was ${formatINR(maxLoss)}; actual result ${formatINR(u.grossPnl)} before charges.`,
      });
    }
  }
  return { occ, opportunities: eligible.length, eligible };
}

export function detectH4(units, { multiple = CONFIG.sizeMultiple } = {}) {
  const med = median(units.map((u) => u.entryLots));
  const occ = [];
  let opportunities = 0;
  for (const u of units) {
    const prev = lastClosedBefore(units, u, 2);
    if (prev.length < 2 || !prev.every((q) => q.netPnl > 0)) continue;
    opportunities++;
    if (u.entryLots >= multiple * med) occ.push({ unit: u, trigger: { lots: u.entryLots, median: med }, detail: `${u.entryLots} lots after two winning trades (your usual size is ${med} lots)` });
  }
  return { occ, opportunities, eligible: units, median: med };
}

export function detectH5(units, { limit = CONFIG.dailyTradeLimit } = {}) {
  const occ = [];
  const byDay = new Map();
  for (const u of units) {
    const n = (byDay.get(u.day) ?? 0) + 1;
    byDay.set(u.day, n);
    if (n > limit) occ.push({ unit: u, trigger: { index: n, limit }, detail: `Trade #${n} of the day` });
  }
  return { occ, opportunities: units.length, eligible: units };
}

export const DETECTORS = { H1: detectH1, H2: detectH2, H3: detectH3, H4: detectH4, H5: detectH5 };

// ---------- costing & gates ----------

function costOf(habitId, raw, occ) {
  if (habitId === 'H3') {
    const contribs = occ.map((o) => o.excess);
    return { model: 'beyond-max-loss', baseline: null, thin: false, contribs, cost: contribs.reduce((a, b) => a + b, 0) };
  }
  const matched = new Set(raw.occ.map((o) => o.unit.id));
  const comp = raw.eligible.filter((u) => !matched.has(u.id));
  const thin = comp.length < CONFIG.thinBaseline;
  const mean = comp.length ? comp.reduce((s, u) => s + u.netPnl, 0) / comp.length : null;
  const baseline = thin ? 0 : Math.min(mean, 0);
  const contribs = occ.map((o) => -(o.unit.netPnl - baseline));
  return { model: 'baseline-excess', baseline, comparisonMean: mean, comparisonN: comp.length, thin, contribs, cost: contribs.reduce((a, b) => a + b, 0) };
}

function g4Reason(n, topShare, loo, costing) {
  if (topShare < 1) return `One trade explains ${Math.round(topShare * 100)}% of the cost. Without it the pattern is ${formatINR(Math.max(loo, 0))}, which is not enough to call it a habit.`;
  if (n === 1) return 'It is the only occurrence, so a single trade is the whole pattern.';
  if (costing.model === 'beyond-max-loss') return 'One spread accounts for all of the excess loss; the other occurrences ended within their defined maximum loss.';
  if (costing.baseline === 0) return 'One trade accounts for all of the cost. The other occurrences together broke even or made money.';
  return 'One trade accounts for all of the cost. The other occurrences together did no worse than your usual trade.';
}

function gate(occ, costing, floor) {
  const g = CONFIG.gates;
  const n = occ.length;
  const days = new Set(occ.map((o) => o.unit.day)).size;
  const sorted = [...costing.contribs].sort((a, b) => b - a);
  const cost = costing.cost;
  const loo = cost - (sorted[0] ?? 0);
  const loo2 = cost - (sorted[0] ?? 0) - (sorted[1] ?? 0);
  const topShare = cost > 0 ? (sorted[0] ?? 0) / cost : 0;
  const checks = [
    { id: 'G1', name: 'Repeated', pass: n >= g.minN, value: n, threshold: g.minN, reason: `Seen ${n} time${n === 1 ? '' : 's'}. We need at least ${g.minN} before calling it a habit.` },
    { id: 'G2', name: 'Spread out', pass: days >= g.minDays, value: days, threshold: g.minDays, reason: `${n === 1 ? 'The only occurrence fell' : n === 2 ? 'Both occurrences fell' : `All ${n} occurrences fell`} on ${plural(days, 'day')}. We need at least ${g.minDays} different days.` },
    { id: 'G3', name: 'Material', pass: cost >= floor, value: cost, threshold: floor, reason: `Associated excess loss is ${formatINR(Math.max(cost, 0))}, below this period's bar of ${formatINR(floor)}.` },
    {
      id: 'G4', name: 'Not one trade', pass: loo >= g.looMinCost && loo >= g.looMinShare * cost, value: loo, threshold: Math.max(g.looMinCost, g.looMinShare * cost),
      reason: g4Reason(n, topShare, loo, costing),
    },
  ];
  const failed = checks.find((c) => !c.pass) || null;
  const confidence = failed ? null : n >= g.strongN && loo2 >= g.looMinCost ? 'Strong' : 'Moderate';
  return { n, days, loo, loo2, topShare, checks, failed, pass: !failed, confidence };
}

function evidenceRows(occ, contribs) {
  return occ.map((o, i) => ({
    unitId: o.unit.id, day: o.unit.day, time: o.unit.time, label: o.unit.label,
    detail: o.detail, trigger: o.trigger, netPnl: o.unit.netPnl, grossPnl: o.unit.grossPnl, contribution: contribs[i],
    maxLoss: o.maxLoss ?? null, chargesMissing: o.unit.chargesMissing,
  }));
}

function evaluate(habitId, raw, occ, floor) {
  const costing = costOf(habitId, raw, occ);
  const gates = gate(occ, costing, floor);
  const res = {
    id: habitId, name: HABITS[habitId].name, short: HABITS[habitId].short,
    occurrences: occ.length, opportunities: raw.opportunities,
    rate: raw.opportunities ? occ.length / raw.opportunities : 0,
    cost: costing.cost, costing, gates,
    evidence: evidenceRows(occ, costing.contribs),
    unitIds: occ.map((o) => o.unit.id),
    median: raw.median,
  };
  Object.defineProperty(res, '_raw', { value: raw, enumerable: false });
  Object.defineProperty(res, '_occ', { value: occ, enumerable: false });
  return res;
}

function overlapReason(removed, n, shared, failedReason) {
  const after = `${failedReason.charAt(0).toLowerCase()}${failedReason.slice(1)}`;
  return removed / n > 0.5
    ? `Mostly the same trades as ${shared}: it shares ${removed} of its ${n} trades with a higher-ranked confirmed habit. Re-checked without them: ${after}`
    : `Shares ${removed} of its ${n} trades with ${shared}, a higher-ranked confirmed habit. Re-checked without ${removed === 1 ? 'it' : 'them'}: ${after}`;
}

// ---------- analysis ----------

// analyze(fills, { period }) — period is a "YYYY-MM" key; without it every trade in the data is reviewed.
export function analyze(fills, { period = null } = {}) {
  const built = build(fills);
  const units = period ? built.units.filter((u) => u.month === period) : built.units;
  const excluded = period ? built.excluded.filter((x) => x.month === period) : built.excluded;
  const positions = units.flatMap((u) => u.positions);
  const grossLosses = units.filter((u) => u.netPnl < 0).reduce((s, u) => s - u.netPnl, 0);
  const floor = Math.max(CONFIG.gates.minCost, CONFIG.gates.lossShare * grossLosses);
  const thinMonth = units.length < CONFIG.minUnits;
  const raws = {};
  const standalone = {};
  for (const id of HABIT_IDS) {
    raws[id] = DETECTORS[id](units);
    standalone[id] = evaluate(id, raws[id], raws[id].occ, floor);
  }

  // De-duplicate: rank gate-passing habits by standalone cost; each trade counts toward one habit.
  const candidates = Object.values(standalone).filter((h) => h.gates.pass).sort((a, b) => b.cost - a.cost);
  const claimedBy = new Map();
  const confirmed = [];
  const overlapped = [];
  for (const h of thinMonth ? [] : candidates) {
    const raw = raws[h.id];
    const keep = raw.occ.filter((o) => !claimedBy.has(o.unit.id));
    const removed = raw.occ.length - keep.length;
    const res = removed ? evaluate(h.id, raw, keep, floor) : h;
    res.overlap = removed;
    res.overlapWith = removed ? [...new Set(raw.occ.filter((o) => claimedBy.has(o.unit.id)).map((o) => HABITS[claimedBy.get(o.unit.id)].name))] : [];
    if (res.gates.pass && confirmed.length < CONFIG.maxHabits) {
      confirmed.push(res);
      keep.forEach((o) => claimedBy.set(o.unit.id, h.id));
    } else {
      // Either it fails once its shared trades are removed (a real overlap), or it still passes and only
      // the reporting limit stopped it.
      const limitCut = res.gates.pass;
      const shared = `"${res.overlapWith.join('", "')}"`;
      const reason = limitCut
        ? removed
          ? `Passed every gate, even without the ${plural(removed, 'trade')} it shares with ${shared}, but only the top ${CONFIG.maxHabits} habits are reported each period.`
          : `Passed every gate, but only the top ${CONFIG.maxHabits} habits are reported each period, and ${CONFIG.maxHabits} habits with larger excess losses were confirmed.`
        : overlapReason(removed, raw.occ.length, shared, res.gates.failed.reason);
      overlapped.push({ ...res, limitCut, sharedTrades: removed, reason });
    }
  }

  const habits = {};
  const checked = HABIT_IDS.map((id) => {
    const h = standalone[id];
    const conf = confirmed.find((c) => c.id === id);
    const over = overlapped.find((c) => c.id === id);
    let status;
    if (conf) status = 'confirmed';
    else if (over) status = 'overlap';
    else if (h.occurrences === 0) status = 'not-seen';
    else if (h.cost <= 0) status = 'not-costly';
    else status = 'insufficient';
    let reason = h.gates.failed?.reason ?? null;
    if (thinMonth && h.gates.pass) reason = `Passed every gate, but this period has only ${plural(units.length, 'trade')}. We need ${CONFIG.minUnits}+ before calling anything a habit.`;
    if (status === 'overlap') reason = over.reason;
    if (status === 'not-costly') {
      const seen = `Seen ${plural(h.occurrences, 'time')}`;
      reason = h.costing.model === 'beyond-max-loss'
        ? `${seen}, but every occurrence ended within the spread's defined maximum loss, so there is no excess loss to attribute.`
        : h.costing.baseline === 0
          ? `${seen}, but together these trades broke even or made money, so there is no excess loss to attribute.`
          : `${seen}, but these trades did no worse than your usual trade, so there is no excess loss to attribute.`;
    }
    if (status === 'not-seen') reason = h.opportunities ? `Not seen in ${plural(h.opportunities, HABITS[id].chance, HABITS[id].chances)}.` : `No ${HABITS[id].chances} in this period, so this behaviour could not occur.`;
    if (status === 'confirmed') reason = `Passed all four evidence gates with ${conf.gates.confidence.toLowerCase()} evidence.`;
    // Confirmed habits show their de-duplicated evidence; everything else shows what the detector saw.
    const view = conf ?? h;
    habits[id] = { ...view, status, statusReason: reason, rank: conf ? confirmed.indexOf(conf) + 1 : null };
    if (over) {
      // Overlap / limit-cut: the card shows what the detector saw; recheck is the de-duplicated result.
      Object.assign(habits[id], { overlap: over.sharedTrades, overlapWith: over.overlapWith, limitCut: over.limitCut, recheck: { occurrences: over.occurrences, cost: over.cost, gates: over.gates } });
    }
    Object.defineProperty(habits[id], '_raw', { value: raws[id], enumerable: false });
    Object.defineProperty(habits[id], '_occ', { value: view._occ, enumerable: false });
    return { id, name: h.name, status, occurrences: h.occurrences, opportunities: h.opportunities, cost: h.cost, reason };
  });
  const nearMisses = [
    ...checked.filter((c) => c.status === 'insufficient'),
    ...overlapped.map((o) => ({ id: o.id, name: o.name, status: 'overlap', occurrences: o.occurrences, seen: standalone[o.id].occurrences, cost: o.cost, reason: o.reason, limitCut: o.limitCut, overlap: o.sharedTrades, overlapWith: o.overlapWith })),
  ];

  // Behaviour labels per trade: which detectors flagged it, and how it is counted.
  const labels = {};
  for (const id of HABIT_IDS) {
    const status = habits[id].status;
    for (const o of raws[id].occ) {
      const uid = o.unit.id;
      let role;
      if (status === 'confirmed' && claimedBy.get(uid) === id) role = 'counted';
      else if (claimedBy.has(uid)) role = 'overlap';
      else role = 'flagged';
      (labels[uid] ??= []).push({ habitId: id, role, habitStatus: status, detail: o.detail, countedUnder: claimedBy.get(uid) ?? null });
    }
  }

  const stats = tradeStats(units, labels);
  const summary = {
    period, periodLabel: period ? formatMonth(period) : null,
    // Orders in this period: those in its closed trades plus those in its excluded positions.
    fills: positions.reduce((s, p) => s + p.fills.length, 0) + excluded.reduce((s, x) => s + x.fills.length, 0),
    positions: positions.length, units: units.length, excluded,
    warnings: built.warnings, tradingDays: stats.tradingDays,
    months: [...new Set(units.map((u) => u.month))].sort(),
    netPnl: stats.netPnl, grossPnl: stats.grossPnl, charges: stats.charges,
    wins: stats.wins, grossLosses, floor, thin: thinMonth,
  };
  return {
    summary, units, standalone, confirmed, nearMisses, checked, habits, labels, stats,
    quality: qualityOf(summary, stats),
    headlineCost: confirmed.reduce((s, h) => s + h.cost, 0),
  };
}

// Defined trade statistics. Every value is null when it cannot be computed (never a silent 0).
export function tradeStats(units, labels = {}) {
  const wins = units.filter((u) => u.netPnl > 0);
  const losses = units.filter((u) => u.netPnl < 0);
  const byDay = new Map();
  for (const u of units) {
    const d = byDay.get(u.day) ?? { day: u.day, netPnl: 0, trades: 0, habitTrades: 0 };
    d.netPnl += u.netPnl;
    d.trades++;
    if ((labels[u.id] ?? []).some((l) => l.role === 'counted')) d.habitTrades++;
    byDay.set(u.day, d);
  }
  const sum = (xs, k) => xs.reduce((s, u) => s + u[k], 0);
  return {
    trades: units.length,
    tradingDays: byDay.size,
    wins: wins.length,
    losses: losses.length,
    flat: units.length - wins.length - losses.length,
    winRate: units.length ? wins.length / units.length : null,
    netPnl: sum(units, 'netPnl'),
    grossPnl: sum(units, 'grossPnl'),
    charges: sum(units, 'charges'),
    orders: units.reduce((s, u) => s + u.positions.reduce((t, p) => t + p.fills.length, 0), 0),
    chargesMissingFills: sum(units, 'chargesMissing'),
    tradesMissingCharges: units.filter((u) => u.chargesMissing > 0).length,
    noChargesRecorded: units.length > 0 && units.every((u) => u.positions.every((p) => p.fills.every((f) => !isNum(f.charges)))),
    avgWin: wins.length ? sum(wins, 'netPnl') / wins.length : null,
    avgLoss: losses.length ? sum(losses, 'netPnl') / losses.length : null,
    largestWin: wins.length ? Math.max(...wins.map((u) => u.netPnl)) : null,
    largestLoss: losses.length ? Math.min(...losses.map((u) => u.netPnl)) : null,
    medianHoldMin: units.length ? median(units.map((u) => u.holdMin)) : null,
    daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

function qualityOf(summary, stats) {
  const items = [];
  if (summary.units === 0) items.push({ level: 'error', code: 'no-trades', text: 'No closed trades in this period, so there is nothing to review.' });
  else if (summary.thin) items.push({ level: 'warning', code: 'thin', text: `Only ${plural(summary.units, 'closed trade')}. Habits need ${CONFIG.minUnits}+ trades in a period before anything is called a habit.` });
  if (summary.excluded.length) items.push({ level: 'warning', code: 'excluded', text: `${summary.excluded.length} position${summary.excluded.length === 1 ? ' was' : 's were'} left out (still open or flipped direction), so ${summary.excluded.length === 1 ? 'it is' : 'they are'} not in any figure.` });
  if (stats.tradesMissingCharges) items.push({ level: 'warning', code: 'charges', text: `${stats.tradesMissingCharges === 1 ? '1 trade has' : `${stats.tradesMissingCharges} trades have`} orders with no charges recorded; ${stats.tradesMissingCharges === 1 ? 'its' : 'their'} net P&L excludes those charges.` });
  for (const w of summary.warnings) items.push({ level: 'warning', code: 'lot-size', text: w });
  const status = items.some((i) => i.level === 'error') ? 'insufficient' : summary.thin ? 'insufficient' : items.length ? 'attention' : 'good';
  return { status, items };
}

// Re-run cost and gates for a habit with some of its trades excluded (evidence sensitivity).
// The comparison baseline is unchanged; excluded trades simply stop counting as occurrences.
export function regate(analysis, habitId, excludedIds = []) {
  const h = analysis.habits[habitId];
  const ex = new Set(excludedIds);
  const keep = h._occ.filter((o) => !ex.has(o.unit.id));
  const res = evaluate(habitId, h._raw, keep, analysis.summary.floor);
  res.thin = analysis.summary.thin;
  res.wouldConfirm = res.gates.pass && !analysis.summary.thin;
  return res;
}

// ---------- period comparison ----------

const LF = [0];
function logFact(n) {
  for (let i = LF.length; i <= n; i++) LF[i] = LF[i - 1] + Math.log(i);
  return LF[n];
}
const logChoose = (n, k) => logFact(n) - logFact(k) - logFact(n - k);

// One-sided Fisher exact test on [[a, b], [c, d]] (rows = periods, columns = occurred / did not).
// direction 'decrease': evidence that period 2's rate is lower than period 1's, P(X >= a).
// direction 'increase': evidence that period 2's rate is higher, P(X <= a).
export function fisherOneSided(a, b, c, d, direction) {
  if ([a, b, c, d].some((x) => !Number.isInteger(x) || x < 0)) return null;
  const r1 = a + b, c1 = a + c, n = a + b + c + d;
  const lo = Math.max(0, c1 - (n - r1));
  const hi = Math.min(r1, c1);
  const denom = logChoose(n, r1);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    if (direction === 'decrease' ? x >= a : x <= a) p += Math.exp(logChoose(c1, x) + logChoose(n - c1, r1 - x) - denom);
  }
  return Math.min(1, p);
}

// Wilson score interval for a proportion (90% by default).
export function wilson(k, n, z = 1.645) {
  if (!n || k < 0 || k > n) return null;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

// Compare one behaviour's rate (occurrences per chance) between two analysed periods.
export function compareHabit(a1, a2, habitId) {
  const h1 = a1.standalone[habitId];
  const h2 = a2.standalone[habitId];
  const c = CONFIG.compare;
  const side = (h) => ({ n: h.occurrences, opp: h.opportunities, rate: h.opportunities ? h.occurrences / h.opportunities : null, cost: Math.max(h.cost, 0), ci: wilson(h.occurrences, h.opportunities) });
  const before = side(h1);
  const after = side(h2);
  // Whether the behaviour was a confirmed habit in either period (views separate tracked habits from the rest).
  const confirmedIn = { before: a1.habits?.[habitId]?.status === 'confirmed', after: a2.habits?.[habitId]?.status === 'confirmed' };
  const base = { id: habitId, name: HABITS[habitId].name, chances: HABITS[habitId].chances, before, after, absChange: null, relChange: null, p: null, strength: null, confirmedIn, tracked: confirmedIn.before || confirmedIn.after };
  if (h1.opportunities === 0 && h2.opportunities === 0) {
    return { ...base, verdict: 'Not applicable', explanation: `No ${HABITS[habitId].chances} in either period, so this behaviour could not occur.` };
  }
  if (h1.opportunities < c.minOpp || h2.opportunities < c.minOpp) {
    return { ...base, verdict: 'Inconclusive', explanation: `Only ${h1.opportunities} and ${h2.opportunities} ${HABITS[habitId].chances} in the two periods. A direction needs at least ${c.minOpp} in each, so no verdict is given.` };
  }
  if (before.n === 0 && after.n === 0) return { ...base, absChange: 0, verdict: 'Not seen', explanation: 'This behaviour did not occur in either period.' };
  const absChange = after.rate - before.rate;
  const relChange = before.rate > 0 ? absChange / before.rate : null;
  const direction = absChange < 0 ? 'decrease' : 'increase';
  const p = absChange === 0 ? 1 : fisherOneSided(before.n, before.opp - before.n, after.n, after.opp - after.n, direction) ?? 1;
  const strength = p < c.strongAlpha ? 'strong' : p < c.alpha ? 'suggestive' : 'weak';
  const word = direction === 'decrease' ? 'drop' : 'rise';
  const chance = p >= 0.5
    ? `A ${word} at least this large is more likely than not to show up by chance even if nothing had really changed.`
    : `If nothing had really changed, a ${word} at least this large would show up ${chanceText(p)} times by chance.`;
  let verdict = 'No clear change';
  let explanation;
  if (direction === 'decrease' && relChange !== null && relChange <= -c.improve && p < c.alpha) {
    verdict = 'Improving';
    explanation = `The rate fell from ${formatPct(before.rate)} to ${formatPct(after.rate)} of ${HABITS[habitId].chances}. ${chance}${strength === 'suggestive' ? ' Treat it as a hint, not a result.' : ''}`;
  } else if (direction === 'increase' && (relChange === null || relChange >= c.worse) && p < c.alpha) {
    verdict = 'Worsening';
    explanation = `The rate rose from ${formatPct(before.rate)} to ${formatPct(after.rate)} of ${HABITS[habitId].chances}. ${chance}${strength === 'suggestive' ? ' Treat it as a hint, not a result.' : ''}`;
  } else {
    const small = relChange !== null && Math.abs(relChange) < (direction === 'decrease' ? c.improve : c.worse);
    explanation = absChange === 0
      ? `The rate is unchanged at ${formatPct(before.rate)}.`
      : small
        ? `The rate moved from ${formatPct(before.rate)} to ${formatPct(after.rate)}, which is smaller than the ${Math.round((direction === 'decrease' ? c.improve : c.worse) * 100)}% relative change we require.`
        : `The rate moved from ${formatPct(before.rate)} to ${formatPct(after.rate)}, but ${chance.charAt(0).toLowerCase()}${chance.slice(1)} That is too likely to call.`;
  }
  return { ...base, absChange, relChange, p, strength, verdict, explanation };
}

export function comparePeriods(a1, a2) {
  return HABIT_IDS.map((id) => compareHabit(a1, a2, id));
}

// ---------- guardrails ----------

export const GUARDRAILS = {
  H1: {
    title: 'Cool-off after a loss',
    params: [{ key: 'minutes', label: 'Wait after a losing trade', unit: 'min', min: 5, max: 120, step: 5, default: 15 }],
    rule: (p) => `After any losing trade, wait ${p.minutes} minutes before opening a new one.`,
    measure: (p) => `Share of trades opened after a losing trade that came within ${p.minutes} minutes of it.`,
    nubra: { status: 'proposed', text: 'No public Nubra equivalent was found. This would be a new pre-trade check.' },
  },
  H2: {
    title: 'No adding to a losing buy',
    params: [{ key: 'dropPct', label: 'Counts as adding to a loser below', unit: '% under first price', min: 5, max: 60, step: 5, default: 20 }],
    rule: (p) => `Don't buy more of an option you hold once its price is ${p.dropPct}% or more below your first buy.`,
    measure: (p) => `Share of option buys where you added more at ${p.dropPct}% or further below your first price.`,
    nubra: {
      status: 'proposed',
      text: "No public Nubra control blocks adding to an open position, so this would be a new pre-trade check. Related: Nubra's public API docs describe orders with a built-in stop-loss exit, which a trader may choose to use; fills can't show whether one was attached.",
    },
  },
  H3: {
    title: 'Exit spreads as one unit',
    params: [],
    rule: () => 'Close every leg of a spread together. Never leave a short leg open after closing its hedge.',
    measure: () => `Share of hedged spreads where the protective leg was closed more than ${CONFIG.hedgeGapMin} minutes before its short leg.`,
    nubra: {
      status: 'documented',
      text: "Nubra's public API docs describe multi-leg strategy orders that can exit every leg together. A warning before leaving a naked short would be new.",
      snippet: { isMultiLeg: true, executionMode: 'EXIT', legs: [{ refId: '<short leg>', unitQty: 1 }, { refId: '<long leg>', unitQty: -1 }] },
    },
  },
  H4: {
    title: 'Lot cap per trade',
    params: [{ key: 'maxLots', label: 'Maximum lots per trade', unit: 'lots', min: 1, max: 100, step: 1, default: null }],
    rule: (p) => `Never open a trade larger than ${p.maxLots} lot${p.maxLots === 1 ? '' : 's'}, whatever the last trades did.`,
    measure: (p) => `Share of trades opened above ${p.maxLots} lot${p.maxLots === 1 ? '' : 's'}.`,
    nubra: { status: 'proposed', text: 'No public user-set lot cap was found. The maximum quantity a broker allows is a risk limit, not a personal rule.' },
  },
  H5: {
    title: 'Daily trade limit',
    params: [{ key: 'limit', label: 'Trades per day', unit: 'trades', min: 1, max: 30, step: 1, default: 5 }],
    rule: (p) => `Open at most ${p.limit} trade${p.limit === 1 ? '' : 's'} a day, with a warning before the next one.`,
    measure: (p) => `Share of trades opened after your ${ordinal(p.limit)} trade of the day.`,
    nubra: { status: 'proposed', text: 'No public daily trade limit was found. This would be a new pre-trade check.' },
  },
};

export function defaultGuardrailParams(habitId, analysis) {
  const params = {};
  for (const p of GUARDRAILS[habitId].params) params[p.key] = p.default;
  if (habitId === 'H4') params.maxLots = Math.max(1, Math.ceil(CONFIG.lotCapMultiple * (median(analysis.units.map((u) => u.entryLots)) || 1)));
  return params;
}

export function validateGuardrailParams(habitId, params) {
  const errors = {};
  for (const p of GUARDRAILS[habitId].params) {
    const v = params[p.key];
    if (!isNum(v) || !Number.isInteger(v / p.step)) errors[p.key] = `Enter a whole number in steps of ${p.step}.`;
    else if (v < p.min || v > p.max) errors[p.key] = `Must be between ${p.min} and ${p.max} ${p.unit}.`;
  }
  return errors;
}

// How often the period's trades broke the rule. Uses the same detectors as the review, with the rule's own parameters.
export function measureGuardrail(analysis, habitId, params) {
  const units = analysis.units;
  let violations = [];
  let opportunities = 0;
  switch (habitId) {
    case 'H1': { const r = detectH1(units, { window: params.minutes }); violations = r.occ.map((o) => o.unit.id); opportunities = r.opportunities; break; }
    case 'H2': { const r = detectH2(units, { ratio: 1 - params.dropPct / 100 }); violations = r.occ.map((o) => o.unit.id); opportunities = r.opportunities; break; }
    case 'H3': { const r = detectH3(units); violations = r.occ.map((o) => o.unit.id); opportunities = r.opportunities; break; }
    case 'H4': violations = units.filter((u) => u.entryLots > params.maxLots).map((u) => u.id); opportunities = units.length; break;
    case 'H5': { const r = detectH5(units, { limit: params.limit }); violations = r.occ.map((o) => o.unit.id); opportunities = r.opportunities; break; }
    default: throw new Error(`unknown habit ${habitId}`);
  }
  const rate = opportunities ? violations.length / opportunities : null;
  return {
    habitId, opportunities, violations: violations.length, violatingUnitIds: violations,
    rate, compliance: rate === null ? null : 1 - rate,
    measurable: opportunities > 0,
    note: opportunities ? null : `No ${HABITS[habitId].chances} in this period, so compliance can't be measured.`,
  };
}
