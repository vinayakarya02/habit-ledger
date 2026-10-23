// Scenario-lab evals: each preset lands in the intended evidence class, the simulation is deterministic,
// detection matches what was planted, and parameters are clamped to their documented bounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, SCENARIOS, LAB_PARAMS, clampParams } from '../src/lab.js';
import { CONFIG } from '../src/engine.js';

const run = (id, over = {}) => runScenario({ ...SCENARIOS[id].params, ...over });
const confirmedIds = (r) => r.analysis.confirmed.map((h) => h.id);
const planted = (r, habit) => r.manifest.filter((m) => m.habit === habit).map((m) => m.ref).sort();

test('Lab "normal": two quick re-entries are too few: nothing confirmed, H1 "insufficient" (fails G1)', () => {
  const r = run('normal');
  assert.deepEqual(confirmedIds(r), []);
  assert.equal(r.analysis.habits.H1.status, 'insufficient');
  assert.equal(r.analysis.standalone.H1.occurrences, 2);
  assert.equal(r.analysis.standalone.H1.gates.failed.id, 'G1');
});

test('Lab "repeated": H1 confirmed, and the detected trades are exactly the planted re-entries', () => {
  const r = run('repeated');
  assert.ok(confirmedIds(r).includes('H1'));
  assert.equal(r.planted.reentries, 9);
  assert.deepEqual([...r.analysis.standalone.H1.unitIds].sort(), planted(r, 'H1'));
});

test('Lab "borderline": one very large loss carries the cost, so H1 fails the leave-one-out gate (G4)', () => {
  const r = run('borderline');
  const h = r.analysis.standalone.H1;
  assert.equal(h.occurrences, 4);
  assert.equal(h.gates.failed.id, 'G4');
  assert.ok(h.gates.topShare > 1 - CONFIG.gates.looMinShare, 'the worst trade is more than 60% of the cost');
  assert.notEqual(r.analysis.habits.H1.status, 'confirmed');
});

test('Lab "clean": no planted behaviour → nothing confirmed and no H1 occurrence at all', () => {
  const r = run('clean');
  assert.deepEqual(confirmedIds(r), []);
  assert.equal(r.analysis.standalone.H1.occurrences, 0);
  assert.equal(r.analysis.habits.H1.status, 'not-seen');
  assert.equal(r.analysis.headlineCost, 0);
});

test('Lab "missing": rows with a blank price are rejected (never priced at ₹0); blank charges stay null', () => {
  const r = run('missing');
  const s = r.validation.summary;
  assert.ok(s.rejected > 0);
  assert.equal(s.rejected, r.planted.ordersMissingPrice, 'every order with a missing price is rejected, nothing else');
  assert.equal(s.total, r.planted.orders);
  for (const f of r.validation.fills) assert.ok(typeof f.price === 'number' && Number.isFinite(f.price), `${f.id} price ${f.price}`);
  const nullCharges = r.validation.fills.filter((f) => f.charges === null).length;
  assert.ok(nullCharges > 0);
  assert.equal(r.analysis.stats.tradesMissingCharges > 0, true);
  // Rejected orders leave positions without an opening or closing fill; they are reported, not guessed.
  assert.ok(r.analysis.summary.excluded.length > 0);
  assert.deepEqual(r.analysis.quality.items.map((i) => i.code).sort(), ['charges', 'excluded']);
  assert.equal(r.analysis.summary.fills, r.validation.fills.length);
});

test('Lab is deterministic: the same settings give the same file and result; a new seed gives a new file', () => {
  const p = { ...SCENARIOS.repeated.params, adds: 3, busyDays: 2, missingCharges: 10 };
  const a = runScenario(p);
  const b = runScenario({ ...p });
  assert.equal(a.csv, b.csv);
  assert.equal(a.analysis.headlineCost, b.analysis.headlineCost);
  assert.deepEqual(confirmedIds(a), confirmedIds(b));
  assert.notEqual(runScenario({ ...p, seed: p.seed + 1 }).csv, a.csv);
});

test('Lab re-entry gap: 15 min is inside the window (counted), 16 min is outside (not seen, with a note)', () => {
  const inside = run('repeated', { reentryGap: CONFIG.revengeWindowMin });
  assert.equal(inside.planted.reentriesInWindow, 9);
  assert.equal(inside.analysis.standalone.H1.occurrences, 9);
  assert.deepEqual(inside.notes, []);
  const outside = run('repeated', { reentryGap: CONFIG.revengeWindowMin + 1 });
  assert.equal(outside.planted.reentries, 9);
  assert.equal(outside.planted.reentriesInWindow, 0);
  assert.equal(outside.analysis.standalone.H1.occurrences, 0);
  assert.equal(outside.analysis.habits.H1.status, 'not-seen');
  assert.ok(outside.notes.some((n) => /16 minutes after the loss, outside the 15-minute window/.test(n)), outside.notes.join(' | '));
});

test('Lab planted adds and busy days are detected one-for-one by H2 and H5', () => {
  for (const over of [{ adds: 5, busyDays: 3 }, { adds: 10, busyDays: 6, reentries: 15, tradesPerDay: 4, days: 21 }]) {
    const r = runScenario({ ...SCENARIOS.clean.params, ...over });
    assert.equal(r.planted.adds, over.adds);
    assert.deepEqual([...r.analysis.standalone.H2.unitIds].sort(), planted(r, 'H2'));
    assert.deepEqual([...r.analysis.standalone.H5.unitIds].sort(), planted(r, 'H5'));
    assert.deepEqual([...r.analysis.standalone.H1.unitIds].sort(), planted(r, 'H1'));
  }
});

test('clampParams: values are clamped to [min, max], rounded to the step, and bad input falls back to the default', () => {
  const c = clampParams({ days: 100, tradesPerDay: 2.6, winRate: 37, reentryGap: -3, missingPrice: 'x', blowup: 'yes', seed: 0 });
  assert.equal(c.days, 21, 'September 2026 has 21 trading days');
  assert.equal(c.tradesPerDay, 3);
  assert.equal(c.winRate, 35);
  assert.equal(c.reentryGap, 1);
  assert.equal(c.missingPrice, 0, 'non-numeric → default');
  assert.equal(c.blowup, true);
  assert.equal(c.seed, 1);
  assert.equal(clampParams({ days: 0 }).days, 5);
  assert.equal(clampParams({ days: '10' }).days, 10);
  assert.equal(clampParams({ blowup: 0 }).blowup, false);
  assert.equal(clampParams({ seed: 2.5 }).seed, 1);
  assert.equal(clampParams({ seed: 7 }).seed, 7);
  assert.equal(clampParams({ reentries: Infinity }).reentries, 0, 'non-finite → default');
});

test('clampParams: every numeric lab parameter always ends inside its bounds and on its step', () => {
  const inputs = [-1e9, -1, 0, 0.4, 1, 2.5, 7, 13, 33, 99, 1e9];
  for (const p of LAB_PARAMS.filter((x) => x.type !== 'toggle')) {
    for (const v of inputs) {
      const out = clampParams({ [p.key]: v })[p.key];
      assert.ok(out >= p.min && out <= p.max, `${p.key}=${v} → ${out}`);
      assert.ok(Number.isInteger(out / p.step), `${p.key}=${v} → ${out} not on step ${p.step}`);
    }
  }
  // Presets are already valid, so clamping them changes nothing.
  for (const [id, s] of Object.entries(SCENARIOS)) assert.deepEqual(clampParams(s.params), s.params, id);
});
