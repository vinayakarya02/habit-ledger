// Scenario lab: builds a synthetic month from a few behaviour settings, then runs it through the
// real importer and engine. The rules never change here; only the simulated history does.
// Pure and deterministic: the same settings always produce the same history.

import { singleLegMonth, tradingDays, mulberry32 } from './data.js';
import { readTable, exactMapping, validateRows, toCsv } from './import.js';
import { analyze, CONFIG } from './engine.js';

export const LAB_PARAMS = [
  // September 2026 has 21 NSE trading days (Ganesh Chaturthi, 14 Sep, is a holiday).
  { key: 'days', label: 'Trading days', unit: 'days', min: 5, max: 21, step: 1, group: 'Month' },
  { key: 'tradesPerDay', label: 'Ordinary trades per day', unit: 'trades', min: 1, max: 4, step: 1, group: 'Month' },
  { key: 'winRate', label: 'Ordinary trades that win', unit: '%', min: 20, max: 80, step: 5, group: 'Month' },
  { key: 'reentries', label: 'Re-entries right after a loss', unit: 'times', min: 0, max: 15, step: 1, group: 'Behaviour' },
  { key: 'reentryGap', label: 'Gap between the loss and the re-entry', unit: 'min', min: 1, max: 40, step: 1, group: 'Behaviour' },
  { key: 'reentryLoss', label: 'Premium lost on each re-entry', unit: '%', min: 5, max: 70, step: 5, group: 'Behaviour' },
  { key: 'blowup', label: 'Add one very large losing re-entry', type: 'toggle', group: 'Behaviour' },
  { key: 'adds', label: 'Times adding to a losing buy', unit: 'times', min: 0, max: 10, step: 1, group: 'Behaviour' },
  { key: 'busyDays', label: 'Days with 7 trades', unit: 'days', min: 0, max: 6, step: 1, group: 'Behaviour' },
  { key: 'missingPrice', label: 'Orders with a missing price', unit: '%', min: 0, max: 30, step: 5, group: 'Data quality' },
  { key: 'missingCharges', label: 'Orders with missing charges', unit: '%', min: 0, max: 30, step: 5, group: 'Data quality' },
];

const BASE = { days: 18, tradesPerDay: 3, winRate: 50, reentries: 0, reentryGap: 8, reentryLoss: 40, blowup: false, adds: 0, busyDays: 0, missingPrice: 0, missingCharges: 0, seed: 1 };

export const SCENARIOS = {
  normal: { label: 'Normal month', description: 'Ordinary wins and losses with two quick re-entries: too few to be a habit.', params: { ...BASE, reentries: 2 } },
  repeated: { label: 'Repeated behaviour', description: 'Nine fast re-entries after losses across the month, each losing heavily.', params: { ...BASE, reentries: 9, reentryLoss: 45 } },
  borderline: { label: 'Borderline evidence', description: 'Four re-entries, but one very large loss carries most of the cost.', params: { ...BASE, reentries: 3, blowup: true, reentryLoss: 10 } },
  clean: { label: 'Disciplined trader', description: 'No planted behaviour and a better win rate. Nothing should be flagged as a habit.', params: { ...BASE, winRate: 60 } },
  missing: { label: 'Missing data', description: 'The repeated-behaviour month, with some prices and charges missing from the file.', params: { ...BASE, reentries: 9, reentryLoss: 45, missingPrice: 10, missingCharges: 15 } },
};

export function clampParams(params) {
  const out = { ...BASE, ...params };
  for (const p of LAB_PARAMS) {
    if (p.type === 'toggle') out[p.key] = Boolean(out[p.key]);
    else {
      const v = Number(out[p.key]);
      out[p.key] = Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, Math.round(v / p.step) * p.step)) : BASE[p.key];
    }
  }
  out.busyDays = Math.min(out.busyDays, out.days); // can't have more busy days than trading days
  out.seed = Number.isInteger(Number(out.seed)) && Number(out.seed) > 0 ? Number(out.seed) : 1;
  return out;
}

function buildPlan(p) {
  const rnd = mulberry32(p.seed * 7919 + 13);
  const plans = Array.from({ length: p.days }, () => Array.from({ length: p.tradesPerDay }, () => (rnd() < p.winRate / 100 ? 'W' : 'L')));
  // A re-entry follows a loss: append it right after the day's last loss (adding a loss first if the day has none).
  const placeReentry = (di, kind) => {
    const plan = plans[di];
    let at = -1;
    for (let i = plan.length - 1; i >= 0; i--) if (plan[i] !== 'W') { at = i; break; }
    if (at < 0) { plan[plan.length - 1] = 'L'; at = plan.length - 1; }
    plan.splice(at + 1, 0, kind);
  };
  for (let i = 0; i < p.reentries; i++) placeReentry(Math.floor((i * p.days) / p.reentries), 'R');
  if (p.blowup) placeReentry(Math.min(p.days - 1, Math.floor(p.days / 2) + 1), 'Rb');
  // Adds go first in the day so they never sit right after a loss.
  for (let i = 0; i < p.adds; i++) plans[Math.floor(((i + 0.5) * p.days) / p.adds)].unshift('A');
  // Busy days: pad the last N days to 7 trades with ordinary trades at the same win rate.
  for (let i = 0; i < p.busyDays; i++) {
    const plan = plans[p.days - 1 - i];
    while (plan.length < 7) plan.push(rnd() < p.winRate / 100 ? 'W' : 'L');
  }
  return plans;
}

// Returns { params, plan, planted, csv, validation, analysis, notes }.
export function runScenario(input) {
  const p = clampParams(input);
  const plans = buildPlan(p);
  const days = tradingDays(2026, 9, p.days);
  const lossMid = 1 - p.reentryLoss / 100;
  const month = singleLegMonth(500 + p.seed, 'LB', days, plans, {
    lots: 2, win: [1.15, 1.4], loss: [0.75, 0.9], gapMin: 32, gapMax: 40, holdMin: 6, holdMax: 15,
    reGap: [p.reentryGap, p.reentryGap], reExit: [Math.max(0.05, lossMid - 0.05), Math.min(0.99, lossMid + 0.05)],
  });

  // Inject missing values into a copy of the file, then import it like any user file.
  const rnd = mulberry32(p.seed * 31 + 7);
  const rows = month.fills.map((f) => {
    const r = { ...f };
    if (rnd() < p.missingPrice / 100) r.price = null;
    if (rnd() < p.missingCharges / 100) r.charges = null;
    return r;
  });
  const csv = toCsv(rows);
  const table = readTable(csv);
  const validation = validateRows(table, exactMapping(table.header));
  const analysis = analyze(validation.fills);

  const reentryKinds = month.manifest.filter((m) => m.habit === 'H1');
  const planted = {
    reentries: reentryKinds.length,
    reentriesInWindow: p.reentryGap <= CONFIG.revengeWindowMin ? reentryKinds.length : 0,
    adds: month.manifest.filter((m) => m.habit === 'H2').length,
    busyExtras: month.manifest.filter((m) => m.habit === 'H5').length,
    orders: month.fills.length,
    ordersMissingPrice: rows.filter((r) => r.price === null).length,
    ordersMissingCharges: rows.filter((r) => r.charges === null).length,
  };
  const notes = [];
  if (p.reentryGap > CONFIG.revengeWindowMin && p.reentries) notes.push(`Re-entries are ${p.reentryGap} minutes after the loss, outside the ${CONFIG.revengeWindowMin}-minute window, so the rule does not count them.`);
  const late = month.fills.filter((f) => f.ts.slice(11, 16) > '15:30').length;
  if (late) notes.push(`${late} simulated order${late === 1 ? '' : 's'} fall after 15:30 because the day is very full. Reduce trades per day for a realistic session.`);
  return { params: p, plan: plans.map((seq, i) => ({ day: days[i], seq })), planted, csv, validation, analysis, notes, manifest: month.manifest };
}
