// Regression tests for findings from the integrated adversarial review (see 05_evaluation.md §4).
// Each test reproduces the reviewer's case and asserts the corrected behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, compareHabit, measureGuardrail, wilson, fisherOneSided, GUARDRAILS, HABIT_IDS } from '../src/engine.js';
import { PERSONAS, HOLIDAYS } from '../src/data.js';
import { initialState, reduce, selectAnalysis, selectNextAction, rulePhase, selectLab, getDataset, selectPeriods, defaultInspectHabit } from '../src/store.js';
import { habitStatusChip, verdictLabel } from '../src/ui/components.js';
import { toCsv } from '../src/import.js';
import { fourHabitFills } from './helpers/fixtures.mjs';
import { stateMatrix } from './helpers/render-matrix.mjs';

const run = (s, ...actions) => actions.reduce(reduce, s);
const ts = (d, hm) => `2026-09-${String(d).padStart(2, '0')}T${hm}:00+05:30`;
let n = 0;
const leg = (d, hm, symbol, side, price) => ({ id: `R${++n}`, ts: ts(d, hm), underlying: 'NIFTY', symbol, optType: 'CE', strike: 25000, expiry: '2026-09-29', side, qty: 75, price, charges: 0, strategyId: null });
const trade = (d, open, close, entry, exit) => { const sym = `NIFTY RV${++n} 25000 CE`; return [leg(d, open, sym, 'BUY', entry), leg(d, close, sym, 'SELL', exit)]; };

test('R01 two trades opened right after the same loss never push the re-entry rate above 100% (was 200%)', () => {
  // Each day: one loss, then a CE and a PE bought together 5 minutes later (no strategy ID), both winners.
  const fills = [];
  for (const d of [1, 2, 3, 4, 7, 8, 9, 10]) {
    fills.push(...trade(d, '10:00', '10:10', 100, 80));
    fills.push(...trade(d, '10:15', '10:30', 100, 120), ...trade(d, '10:15', '10:31', 100, 120));
  }
  const a = analyze(fills);
  const h = a.habits.H1;
  assert.equal(h.occurrences, 16);
  assert.equal(h.opportunities, 16, 'chances are trades opened after a losing trade: 2 per day');
  assert.ok(h.rate <= 1);
  const g = measureGuardrail(a, 'H1', { minutes: 15 });
  assert.ok(g.compliance >= 0 && g.compliance <= 1, `compliance ${g.compliance}`);
  const c = compareHabit(a, a, 'H1');
  assert.ok(c.before.ci && Number.isFinite(c.before.ci.lo) && Number.isFinite(c.before.ci.hi));
  assert.equal(c.verdict, 'No clear change');
});

test('R02 wilson and fisher refuse impossible inputs instead of returning NaN', () => {
  assert.equal(wilson(16, 8), null);
  assert.equal(wilson(-1, 8), null);
  assert.equal(fisherOneSided(16, -8, 0, 10, 'decrease'), null);
});

test('R03 the overlap reason says "Mostly the same trades" only when most trades are shared', () => {
  const m = Object.fromEntries(stateMatrix().map((x) => [x.name, x.state]));
  const h1 = selectAnalysis(m['edge/overlap-h1']).habits.H1;
  assert.equal(h1.status, 'overlap');
  assert.ok(h1.overlap / h1.occurrences <= 0.5);
  assert.match(h1.statusReason, /^Shares \d+ of its \d+ trades with "/);
  assert.doesNotMatch(h1.statusReason, /Mostly/);
});

test('R04 a behaviour cut only by the 3-habit limit is labelled as such by the shared status chip', () => {
  const a = analyze(fourHabitFills());
  assert.equal(a.habits.H5.limitCut, true);
  assert.match(habitStatusChip(a.habits.H5), /over the 3-habit limit/);
  assert.doesNotMatch(habitStatusChip(a.habits.H5), /Overlaps/);
  assert.match(habitStatusChip(a.habits.H1), /Confirmed habit/);
});

test('R05 guardrail texts never suggest a stop level, and the adding-to-a-loser rule is not labelled documented', () => {
  assert.equal(GUARDRAILS.H2.nubra.status, 'proposed');
  assert.doesNotMatch(GUARDRAILS.H2.rule({ dropPct: 20 }), /stop-loss/i);
  for (const id of HABIT_IDS) {
    const snip = JSON.stringify(GUARDRAILS[id].nubra.snippet ?? {});
    assert.doesNotMatch(snip, /0\.\d\d|×/, `${id} snippet carries no numeric level`);
    assert.doesNotMatch(GUARDRAILS[id].nubra.text, /exitConfig|stoplossParams|executionMode/, `${id} card text is plain language`);
  }
});

test('R06 a period whose trades already existed when a rule was saved is a what-if, never "after the rule"', () => {
  let s = run(initialState(), { type: 'openGuardrail', habitId: 'H1' }, { type: 'saveGuardrail', at: '2026-10-23T12:00:00.000Z' });
  const rule = s.guardrails.aarav.H1;
  assert.equal(rule.savedAt, '2026-10-23T12:00:00.000Z');
  assert.equal(rulePhase(s, rule, '2026-09'), 'what-if');
  assert.equal(rulePhase(s, rule, '2026-10'), 'what-if', 'October trades were already in the file');
  // A rule saved before a period's first trade makes that period "after".
  s = run(s, { type: 'openGuardrail', habitId: 'H2' }, { type: 'saveGuardrail', at: '2026-09-15T00:00:00.000Z' });
  assert.equal(rulePhase(s, s.guardrails.aarav.H2, '2026-10'), 'after');
  // Changing the settings restarts the timeline; re-saving unchanged settings keeps it.
  s = run(s, { type: 'openGuardrail', habitId: 'H1' }, { type: 'setGuardParam', key: 'minutes', value: '60' }, { type: 'selectPeriod', key: '2026-10' });
  s = run(s, { type: 'openGuardrail', habitId: 'H1' }, { type: 'setGuardParam', key: 'minutes', value: '60' }, { type: 'saveGuardrail', at: '2026-10-24T09:00:00.000Z' });
  assert.deepEqual([s.guardrails.aarav.H1.settingsPeriod, s.guardrails.aarav.H1.changedAt, s.guardrails.aarav.H1.createdPeriod], ['2026-10', '2026-10-24T09:00:00.000Z', '2026-09']);
});

test('R07 a second month can be added to an existing import: one trader, two periods, guardrails carry over, duplicates skipped', () => {
  const sep = toCsv(PERSONAS.aarav.months['2026-09'].fills);
  const oct = toCsv(PERSONAS.aarav.months['2026-10'].fills.concat(PERSONAS.aarav.months['2026-09'].fills.slice(0, 2)));
  let s = run(initialState(), { type: 'importFileRead', fileName: 'sep.csv', text: sep, size: sep.length }, { type: 'validateImport' }, { type: 'confirmImport' });
  const id = s.datasetId;
  s = run(s, { type: 'openGuardrail', habitId: 'H1' }, { type: 'saveGuardrail' });
  s = run(s, { type: 'importFileRead', fileName: 'oct.csv', text: oct, size: oct.length }, { type: 'validateImport' }, { type: 'setImportTarget', target: id }, { type: 'confirmImport' });
  assert.equal(s.datasetId, id);
  assert.equal(Object.keys(s.imports).length, 1);
  assert.deepEqual(selectPeriods(s).map((p) => p.key), ['2026-09', '2026-10']);
  assert.ok(s.guardrails[id].H1, 'guardrail carried over');
  assert.equal(getDataset(s).importSummary.skippedExisting, 2);
  assert.match(s.notice.text, /2 orders already there were skipped/);
  assert.equal(getDataset(s).fills.length, PERSONAS.aarav.fills.length);
});

test('R08 importing the same file twice gives distinct trader names', () => {
  const csv = toCsv(PERSONAS.kabir.months['2026-09'].fills);
  const once = (s) => run(s, { type: 'importFileRead', fileName: 'mine.csv', text: csv, size: csv.length }, { type: 'validateImport' }, { type: 'confirmImport' });
  const s = once(once(initialState()));
  assert.deepEqual(Object.values(s.imports).map((d) => d.name), ['mine', 'mine (2)']);
});

test('R09 reset filters keeps the sort; dismissing with no notice is a no-op', () => {
  let s = run(initialState(), { type: 'setTradeSort', key: 'netPnl' }, { type: 'setTradeSort', key: 'netPnl' }, { type: 'setTradeFilter', key: 'outcome', value: 'loss' }, { type: 'resetTradeFilters' });
  assert.deepEqual([s.trades.sort, s.trades.dir, s.trades.outcome], ['netPnl', 'desc', 'all']);
  s = reduce(s, { type: 'dismissNotice' });
  assert.equal(reduce(s, { type: 'dismissNotice' }), s);
});

test('R10 the inspector opens on the data\'s own top habit; a clean trader is pointed at the next month', () => {
  assert.equal(defaultInspectHabit(reduce(initialState(), { type: 'selectDataset', id: 'meera' })), 'H3');
  assert.equal(reduce(reduce(initialState(), { type: 'selectPeriod', key: '2026-10' }), { type: 'navigate', view: 'overview' }).inspect.habitId, 'H2');
  const k = selectNextAction(reduce(initialState(), { type: 'selectDataset', id: 'kabir' }));
  assert.deepEqual(k.action, { type: 'selectPeriod', key: '2026-10' });
});

test('R11 sample data has no trades or expiries on NSE holidays', () => {
  for (const p of Object.values(PERSONAS)) {
    for (const f of p.fills) {
      assert.ok(!HOLIDAYS.includes(f.ts.slice(0, 10)), `${p.id} trades on ${f.ts.slice(0, 10)}`);
      assert.ok(!HOLIDAYS.includes(f.expiry), `${p.id} expiry ${f.expiry}`);
    }
  }
  assert.doesNotMatch(PERSONAS.kabir.style, /stops/);
});

test('R12 suggestive verdicts read as "Possibly …"; the lab remembers which preset a custom month came from', () => {
  assert.equal(verdictLabel('Improving', 'suggestive'), 'Possibly improving');
  assert.equal(verdictLabel('Improving', 'strong'), 'Improving');
  assert.equal(verdictLabel('No clear change', 'suggestive'), 'No clear change');
  const s = run(initialState(), { type: 'setScenario', id: 'clean' }, { type: 'setLabParam', key: 'days', value: '15' });
  assert.equal(selectLab(s).from, 'clean');
});

test('R13 the timezone note counts only rows that were imported', () => {
  const csv = 'id,ts,underlying,symbol,optType,strike,expiry,side,qty,price,charges,strategyId\nA,2026-09-01 10:00,NIFTY,NIFTY X 25000 CE,CE,25000,,BUY,75,100,20,\nB,2026-09-01 10:30,NIFTY,NIFTY X 25000 CE,CE,25000,,SELL,75,abc,20,';
  const s = run(initialState(), { type: 'importFileRead', fileName: 'tz.csv', text: csv, size: csv.length }, { type: 'validateImport' });
  assert.equal(s.importWizard.result.summary.assumedIst, 1, 'row B was rejected, so only A counts');
});
