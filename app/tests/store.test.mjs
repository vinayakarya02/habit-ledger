// Store evals: reducer purity and resets, ignored bad input, guardrail and import flows, persistence,
// and the selectors views depend on (next action, trade explorer, inspector sensitivity, guardrails).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, reduce, persistable, getDataset, listDatasets, selectAnalysis, selectNextAction, selectTrades,
  selectInspector, selectGuardrails, selectQuality, selectComparison, selectLab, TRADE_FILTER_DEFAULTS, PAGE_SIZE,
} from '../src/store.js';
import { regate, measureGuardrail } from '../src/engine.js';
import { toCsv, LIMITS } from '../src/import.js';
import { PERSONAS } from '../src/data.js';
import { SCENARIOS } from '../src/lab.js';

function deepFreeze(o, seen = new WeakSet()) {
  if (o && typeof o === 'object' && !seen.has(o)) {
    seen.add(o);
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v, seen);
  }
  return o;
}
const run = (state, ...actions) => actions.reduce((s, a) => reduce(s, a), state);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Broker-style export: aliased headers, IST times without a zone, one identical repeat (line 4) and one blank price (line 5).
const BROKER_CSV = [
  'Order ID,Trade Time,Underlying,Trading Symbol,Option Type,Strike Price,Expiry Date,Buy/Sell,Quantity,Trade Price,Brokerage,Tag',
  'A1,2026-09-01 09:30,NIFTY,NIFTY X 25000 CE,CE,25000,2026-09-08,BUY,75,100,20,',
  'A2,2026-09-01 09:40,NIFTY,NIFTY X 25000 CE,CE,25000,2026-09-08,SELL,75,110,20,',
  'A3,2026-09-01 09:40,NIFTY,NIFTY X 25000 CE,CE,25000,2026-09-08,SELL,75,110,20,',
  'A4,2026-09-01 10:30,NIFTY,NIFTY Y 25000 PE,PE,25000,2026-09-08,BUY,75,,20,',
  'A5,2026-09-02 10:00,NIFTY,NIFTY Z 25100 CE,CE,25100,2026-09-08,BUY,75,90,20,',
  'A6,2026-09-02 10:20,NIFTY,NIFTY Z 25100 CE,CE,25100,2026-09-08,SELL,75,80,20,',
].join('\n');
const fileRead = (text, fileName = 'my trades.csv') => ({ type: 'importFileRead', fileName, size: text.length, text });
const importText = (state, text, fileName) => run(state, fileRead(text, fileName), { type: 'validateImport' }, { type: 'confirmImport' });

// A state with every per-dataset control touched: filters, sort, page, selection, exclusions, guardrail draft.
function dirty(state = initialState()) {
  const a = selectAnalysis(state);
  return run(state,
    { type: 'inspectHabit', habitId: 'H2' },
    { type: 'toggleExclude', unitId: a.habits.H2.unitIds[0] },
    { type: 'setInspectSort', key: 'netPnl' },
    { type: 'setTradeFilter', key: 'q', value: 'NIFTY' },
    { type: 'setTradeSort', key: 'netPnl' },
    { type: 'setTradePage', page: 2 },
    { type: 'selectTrade', id: a.units[0].id },
    { type: 'openGuardrail', habitId: 'H1' });
}

// ---------- purity ----------

test('Reducer is pure: no action mutates the previous state (every state is deep-frozen before reducing)', () => {
  const a = selectAnalysis(initialState());
  const actions = [
    { type: 'navigate', view: 'habits' }, { type: 'setHabitsFilter', key: 'sort', value: 'cost' }, { type: 'inspectHabit', habitId: 'H1' },
    { type: 'toggleExclude', unitId: a.habits.H1.unitIds[0] }, { type: 'excludeWorst' }, { type: 'setInspectSort', key: 'contribution' }, { type: 'resetExclusions' },
    { type: 'setTradeFilter', key: 'outcome', value: 'loss' }, { type: 'setTradeSort', key: 'hold' }, { type: 'setTradePage', page: 2 },
    { type: 'selectTrade', id: a.units[3].id }, { type: 'closeTrade' }, { type: 'resetTradeFilters' },
    { type: 'openGuardrail', habitId: 'H1' }, { type: 'setGuardParam', key: 'minutes', value: '30' }, { type: 'saveGuardrail' },
    { type: 'setGuardStatus', habitId: 'H1', status: 'paused' }, { type: 'openGuardrail', habitId: 'H4' }, { type: 'closeGuardEdit' },
    fileRead(BROKER_CSV), { type: 'setMapping', field: 'charges', column: '' }, { type: 'validateImport' }, { type: 'toggleExcludeDuplicates' },
    { type: 'backToMapping' }, { type: 'validateImport' }, { type: 'confirmImport' },
    { type: 'selectDataset', id: 'aarav' }, { type: 'selectPeriod', key: '2026-10' }, { type: 'setCompare', which: 'from', key: '2026-10' }, { type: 'swapCompare' },
    { type: 'removeGuardrail', habitId: 'H1' }, { type: 'removeImport', id: 'import-1' },
    { type: 'setScenario', id: 'borderline' }, { type: 'setLabParam', key: 'days', value: '12' }, { type: 'regenerateLab' },
    { type: 'setTheme', theme: 'dark' }, { type: 'dismissNotice' },
  ];
  let s = initialState();
  for (const action of actions) {
    deepFreeze(s);
    const before = JSON.stringify(s);
    const next = reduce(s, action);
    assert.equal(JSON.stringify(s), before, action.type);
    assert.ok(next && typeof next === 'object', action.type);
    s = next;
  }
  assert.equal(s.theme, 'dark');
});

// ---------- resets ----------

test('selectDataset resets filters, selection, inspector exclusions and the guardrail draft, and uses the dataset default period', () => {
  // Start away from the defaults: October under review and the comparison swapped, so a reducer that kept
  // the old period or comparison would be caught (every persona defaults to September → October).
  const d = dirty(run(initialState(), { type: 'selectPeriod', key: '2026-10' }, { type: 'swapCompare' }));
  assert.equal(d.periodKey, '2026-10');
  assert.deepEqual(d.compare, { from: '2026-10', to: '2026-09' });
  assert.notDeepEqual(d.trades, TRADE_FILTER_DEFAULTS);
  assert.ok(d.selectedTradeId && d.guardEdit && d.inspect.excluded.length);
  const s = reduce(d, { type: 'selectDataset', id: 'meera' });
  assert.equal(s.datasetId, 'meera');
  assert.deepEqual(s.trades, TRADE_FILTER_DEFAULTS);
  assert.equal(s.selectedTradeId, null);
  assert.equal(s.guardEdit, null);
  // The inspector opens on the new trader's top confirmed habit (Meera: hedge removal), not the old habit.
  assert.deepEqual(s.inspect, { habitId: selectAnalysis(s).confirmed[0].id, excluded: [], sort: 'day', dir: 'asc' });
  assert.equal(s.inspect.habitId, 'H3');
  assert.equal(s.periodKey, PERSONAS.meera.defaultPeriod);
  assert.deepEqual(s.compare, { from: '2026-09', to: '2026-10' });
});

test('selectPeriod resets the same per-period state; an unknown period is ignored', () => {
  const d = dirty();
  const s = reduce(d, { type: 'selectPeriod', key: '2026-10' });
  assert.equal(s.periodKey, '2026-10');
  assert.equal(s.datasetId, 'aarav');
  assert.deepEqual(s.trades, TRADE_FILTER_DEFAULTS);
  assert.equal(s.selectedTradeId, null);
  assert.equal(s.guardEdit, null);
  assert.deepEqual(s.inspect.excluded, []);
  assert.equal(reduce(d, { type: 'selectPeriod', key: '2026-12' }), d);
});

test('Unknown ids, keys, values and action types leave the state untouched (same reference)', () => {
  const s = initialState();
  const ignored = [
    { type: 'selectDataset', id: 'nobody' }, { type: 'setCompare', which: 'middle', key: '2026-09' }, { type: 'setCompare', which: 'from', key: '2027-01' },
    { type: 'setHabitsFilter', key: 'status', value: 'everything' }, { type: 'setHabitsFilter', key: 'colour', value: 'all' },
    { type: 'inspectHabit', habitId: 'H9' }, { type: 'setInspectSort', key: 'random' },
    { type: 'setTradeFilter', key: 'bogus', value: 'x' }, { type: 'setTradeFilter', key: 'page', value: 3 }, { type: 'setTradeFilter', key: 'sort', value: 'netPnl' },
    { type: 'setTradeSort', key: 'colour' }, { type: 'openGuardrail', habitId: 'H9' }, { type: 'setGuardParam', key: 'minutes', value: 10 },
    { type: 'saveGuardrail' }, { type: 'setGuardStatus', habitId: 'H1', status: 'active' }, { type: 'removeGuardrail', habitId: 'H1' },
    { type: 'setMapping', field: 'price', column: '1' }, { type: 'validateImport' }, { type: 'toggleExcludeDuplicates' }, { type: 'confirmImport' },
    { type: 'removeImport', id: 'import-9' }, { type: 'setScenario', id: 'nope' }, { type: 'setLabParam', key: 'days', value: 'abc' },
    { type: 'setTheme', theme: 'neon' }, { type: 'noSuchAction' }, { type: undefined }, undefined, null,
  ];
  for (const a of ignored) assert.equal(reduce(s, a), s, JSON.stringify(a));
  // With a draft open, an unknown parameter is still ignored.
  const g = reduce(s, { type: 'openGuardrail', habitId: 'H1' });
  assert.equal(reduce(g, { type: 'setGuardParam', key: 'colour', value: 3 }), g);
});

test('Trade explorer controls: a filter change resets the page; sort toggles direction; bad page numbers become 1', () => {
  let s = reduce(initialState(), { type: 'setTradePage', page: 3 });
  assert.equal(s.trades.page, 3);
  s = reduce(s, { type: 'setTradeFilter', key: 'underlying', value: 'NIFTY' });
  assert.equal(s.trades.page, 1);
  assert.equal(s.trades.underlying, 'NIFTY');
  assert.equal(reduce(s, { type: 'setTradeFilter', key: 'q', value: 42 }).trades.q, '42', 'values are stored as strings');
  // Sort: same key toggles asc ↔ desc; a new key starts ascending; page resets.
  s = run(s, { type: 'setTradePage', page: 2 }, { type: 'setTradeSort', key: 'open' });
  assert.deepEqual([s.trades.sort, s.trades.dir, s.trades.page], ['open', 'desc', 1]);
  s = reduce(s, { type: 'setTradeSort', key: 'open' });
  assert.equal(s.trades.dir, 'asc');
  s = run(s, { type: 'setTradeSort', key: 'open' }, { type: 'setTradeSort', key: 'netPnl' });
  assert.deepEqual([s.trades.sort, s.trades.dir], ['netPnl', 'asc']);
  for (const [p, want] of [['abc', 1], ['0', 1], ['-4', 1], ['2.7', 2], [5, 5]]) assert.equal(reduce(s, { type: 'setTradePage', page: p }).trades.page, want, String(p));
  // A filter change closes the open trade detail (the trade may no longer be in the list); reset does too.
  const open = reduce(s, { type: 'selectTrade', id: selectAnalysis(s).units[0].id });
  assert.ok(open.selectedTradeId);
  assert.equal(reduce(open, { type: 'setTradeFilter', key: 'outcome', value: 'win' }).selectedTradeId, null);
  assert.equal(reduce(open, { type: 'resetTradeFilters' }).selectedTradeId, null);
});

test('navigate: unknown views fall back to overview; leaving Trades clears the selection; the draft guardrail closes', () => {
  const d = dirty();
  assert.equal(reduce(d, { type: 'navigate', view: 'nowhere' }).view, 'overview');
  const away = reduce(d, { type: 'navigate', view: 'habits' });
  assert.equal(away.selectedTradeId, null);
  assert.equal(away.guardEdit, null);
  assert.equal(reduce(d, { type: 'navigate', view: 'trades' }).selectedTradeId, d.selectedTradeId);
  const insp = reduce(d, { type: 'navigate', view: 'inspect', habitId: 'H3' });
  assert.deepEqual(insp.inspect, { habitId: 'H3', excluded: [], sort: 'day', dir: 'asc' });
});

// ---------- guardrails ----------

test('Guardrail flow: defaults (H4 cap = ceil(1.25 × median lots)), live validation blocks save, save → active, pause, remove', () => {
  let s = initialState();
  const a = selectAnalysis(s);
  // Aarav trades 2 lots (4 on size-ups): median 2 → ceil(2.5) = 3.
  const med = median(a.units.map((u) => u.entryLots));
  assert.equal(med, 2);
  s = reduce(s, { type: 'openGuardrail', habitId: 'H4' });
  assert.deepEqual(s.guardEdit, { habitId: 'H4', params: { maxLots: Math.ceil(1.25 * med) }, errors: {}, isNew: true });
  assert.equal(s.guardEdit.params.maxLots, 3);
  // Invalid values are kept in the draft with an error, and saving is refused.
  for (const [v, msg] of [['abc', /whole number/], ['0', /between 1 and 100 lots/], ['2.5', /whole number/], ['', /whole number/]]) {
    const bad = reduce(s, { type: 'setGuardParam', key: 'maxLots', value: v });
    assert.match(bad.guardEdit.errors.maxLots ?? '', msg, v);
    const saved = reduce(bad, { type: 'saveGuardrail' });
    assert.ok(saved.guardEdit, 'draft stays open');
    assert.deepEqual(saved.guardrails, {}, 'nothing saved');
  }
  s = run(s, { type: 'setGuardParam', key: 'maxLots', value: '4' }, { type: 'saveGuardrail' });
  assert.equal(s.guardEdit, null);
  assert.deepEqual(s.guardrails.aarav.H4, { params: { maxLots: 4 }, status: 'active', createdPeriod: '2026-09', settingsPeriod: '2026-09', savedAt: null, changedAt: null });
  assert.match(s.notice.text, /Saved "Lot cap per trade"\. Nothing was sent to any broker\./);
  // Re-opening edits the saved rule; saving again keeps its status and creation period.
  s = run(s, { type: 'setGuardStatus', habitId: 'H4', status: 'paused' }, { type: 'openGuardrail', habitId: 'H4' });
  assert.deepEqual([s.guardEdit.isNew, s.guardEdit.params.maxLots], [false, 4]);
  s = run(s, { type: 'setGuardParam', key: 'maxLots', value: '5' }, { type: 'saveGuardrail' });
  assert.deepEqual(s.guardrails.aarav.H4, { params: { maxLots: 5 }, status: 'paused', createdPeriod: '2026-09', settingsPeriod: '2026-09', savedAt: null, changedAt: null });
  assert.match(s.notice.text, /^Updated/);
  assert.equal(reduce(s, { type: 'setGuardStatus', habitId: 'H4', status: 'deleted' }), s);
  s = reduce(s, { type: 'removeGuardrail', habitId: 'H4' });
  assert.deepEqual(s.guardrails.aarav, {});
  assert.match(s.notice.text, /Removed "Lot cap per trade"/);
});

test('Guardrail parameters follow their step and range (H1 minutes in steps of 5, 5–120); H3 has none', () => {
  const s = reduce(initialState(), { type: 'openGuardrail', habitId: 'H1' });
  assert.deepEqual(s.guardEdit.params, { minutes: 15 });
  assert.match(reduce(s, { type: 'setGuardParam', key: 'minutes', value: '12' }).guardEdit.errors.minutes, /steps of 5/);
  assert.match(reduce(s, { type: 'setGuardParam', key: 'minutes', value: '125' }).guardEdit.errors.minutes, /between 5 and 120 min/);
  assert.deepEqual(reduce(s, { type: 'setGuardParam', key: 'minutes', value: '120' }).guardEdit.errors, {});
  const h3 = run(initialState(), { type: 'openGuardrail', habitId: 'H3' }, { type: 'saveGuardrail' });
  assert.deepEqual(h3.guardrails.aarav.H3.params, {});
  // Meera trades 1 lot: ceil(1.25 × 1) = 2.
  const m = run(initialState(), { type: 'selectDataset', id: 'meera' }, { type: 'openGuardrail', habitId: 'H4' });
  assert.equal(m.guardEdit.params.maxLots, 2);
});

test('selectGuardrails measures compliance with the saved parameters in this and the next period', () => {
  const s = run(initialState(), { type: 'openGuardrail', habitId: 'H1' }, { type: 'setGuardParam', key: 'minutes', value: '30' }, { type: 'saveGuardrail' });
  const rows = selectGuardrails(s);
  assert.deepEqual(rows.map((r) => r.habitId), ['H1', 'H2', 'H3', 'H4', 'H5']);
  const h1 = rows[0];
  assert.deepEqual(h1.params, { minutes: 30 });
  assert.equal(h1.recommended, true);
  assert.deepEqual(h1.compliance.current, measureGuardrail(selectAnalysis(s), 'H1', { minutes: 30 }));
  assert.deepEqual(h1.compliance.next, measureGuardrail(selectAnalysis(s, '2026-10'), 'H1', { minutes: 30 }));
  assert.equal(h1.compliance.prev, null);
  assert.equal(h1.nextLabel, 'October 2026');
  assert.equal(rows[2].compliance.current.measurable, false, 'Aarav trades no spreads, so H3 cannot be measured');
});

// ---------- import wizard ----------

test('Import flow: read → suggested mapping → validate → exclude duplicates → confirm creates import-1 and selects it', () => {
  let s = reduce(initialState(), fileRead(BROKER_CSV));
  const w = s.importWizard;
  assert.equal(w.step, 'mapping');
  assert.deepEqual(w.mapping, { id: 0, ts: 1, underlying: 2, symbol: 3, optType: 4, strike: 5, expiry: 6, side: 7, qty: 8, price: 9, charges: 10, strategyId: 11 });
  assert.deepEqual(w.problems, []);
  s = reduce(s, { type: 'validateImport' });
  assert.equal(s.importWizard.step, 'preview');
  assert.deepEqual([s.importWizard.result.summary.rejected, s.importWizard.result.summary.suspectedDuplicates], [1, [4]]);
  assert.equal(s.importWizard.result.fills.length, 5);
  s = reduce(s, { type: 'toggleExcludeDuplicates' });
  assert.equal(s.importWizard.excludeDuplicates, true);
  assert.equal(s.importWizard.result.summary.excluded, 1);
  assert.deepEqual(s.importWizard.result.fills.map((f) => f.id), ['A1', 'A2', 'A5', 'A6']);
  s = reduce(s, { type: 'confirmImport' });
  assert.equal(s.datasetId, 'import-1');
  assert.equal(s.importCounter, 1);
  assert.equal(s.view, 'overview');
  assert.deepEqual([s.importWizard.step, s.importWizard.lastImportId], ['done', 'import-1']);
  const ds = getDataset(s);
  assert.deepEqual([ds.kind, ds.name, ds.fills.length], ['import', 'my trades', 4]);
  assert.deepEqual(ds.importSummary.rejectedRows, [{ line: 5, file: 'my trades.csv', messages: ['price is blank; a missing price is never treated as ₹0'] }]);
  // The note sits next to the imported data, so it counts only imported rows (not the rejected row or the
  // excluded duplicate): 6 zone-less rows were read, 4 of them were imported.
  assert.match(ds.importSummary.notes[0], /^4 timestamps had no timezone/, 'counted over imported rows only');
  assert.equal(s.periodKey, '2026-09', 'an import defaults to its latest period');
  assert.match(s.notice.text, /stays in this browser tab/);
  assert.deepEqual(listDatasets(s).at(-1), { id: 'import-1', name: 'my trades', kind: 'import', style: 'Imported 4 orders' });
  // Per-trade net P&L: (110 − 100) × 75 − 40 = 710; (80 − 90) × 75 − 40 = −790.
  assert.deepEqual(selectAnalysis(s).units.map((u) => u.netPnl), [710, -790]);
  const q = selectQuality(s);
  assert.equal(q.items[0].code, 'rejected');
  assert.match(q.items[0].text, /1 row was rejected at import and is not in any figure/);
  // A second import gets the next id.
  assert.equal(importText(s, BROKER_CSV, 'second.csv').datasetId, 'import-2');
});

test('confirmImport and removeImport reset the period and comparison to the new dataset defaults', () => {
  // Start on October with the comparison swapped. BROKER_CSV only has September, so the import opens on
  // September and compares September with itself.
  const moved = run(initialState(), { type: 'selectPeriod', key: '2026-10' }, { type: 'swapCompare' });
  const sep = importText(moved, BROKER_CSV);
  assert.equal(sep.periodKey, '2026-09');
  assert.deepEqual(sep.compare, { from: '2026-09', to: '2026-09' });
  // A two-month export opens on its LATEST month (October), not on the September the app started on.
  const all = importText(initialState(), toCsv(PERSONAS.kabir.fills), 'kabir-all.csv');
  assert.equal(getDataset(all).fills.length, PERSONAS.kabir.fills.length);
  assert.equal(all.periodKey, '2026-10', 'an import defaults to its latest period');
  assert.deepEqual(all.compare, { from: '2026-09', to: '2026-10' });
  // Removing the open import falls back to Aarav's default period and comparison, not the import's.
  const swapped = reduce(all, { type: 'swapCompare' });
  const gone = reduce(swapped, { type: 'removeImport', id: 'import-1' });
  assert.equal(gone.datasetId, 'aarav');
  assert.equal(gone.periodKey, PERSONAS.aarav.defaultPeriod);
  assert.equal(gone.periodKey, '2026-09');
  assert.deepEqual(gone.compare, { from: '2026-09', to: '2026-10' });
});

test('Import wizard errors and mapping edits', () => {
  const s = initialState();
  assert.match(reduce(s, { type: 'importFileRead', fileName: 'big.csv', size: LIMITS.maxBytes + 1, text: '' }).importWizard.error, /larger than 5 MB/);
  assert.match(reduce(s, fileRead('', 'empty.csv')).importWizard.error, /"empty.csv" is empty/);
  assert.match(reduce(s, fileRead('id,ts\n\n', 'head.csv')).importWizard.error, /header row but no data rows/);
  assert.match(reduce(s, { type: 'importFileError', message: 'nope' }).importWizard.error, /nope/);
  const m = reduce(s, fileRead(BROKER_CSV));
  const unmapped = reduce(m, { type: 'setMapping', field: 'price', column: '' });
  assert.equal(unmapped.importWizard.mapping.price, null);
  assert.match(unmapped.importWizard.problems[0], /Missing column\(s\): price/);
  const blocked = reduce(unmapped, { type: 'validateImport' });
  assert.deepEqual([blocked.importWizard.step, blocked.importWizard.result], ['mapping', null]);
  assert.equal(reduce(m, { type: 'setMapping', field: 'price', column: '99' }), m, 'column out of range');
  assert.equal(reduce(m, { type: 'setMapping', field: 'colour', column: '1' }), m, 'unknown field');
  assert.match(reduce(m, { type: 'setMapping', field: 'charges', column: '9' }).importWizard.problems[0], /same file column/);
  assert.equal(reduce(m, { type: 'cancelImport' }).importWizard.step, 'start');
});

test('removeImport: removing the open import falls back to Aarav and drops its guardrails; removing another keeps the selection', () => {
  let s = importText(initialState(), BROKER_CSV);
  s = run(s, { type: 'openGuardrail', habitId: 'H5' }, { type: 'saveGuardrail' });
  assert.ok(s.guardrails['import-1'].H5);
  const gone = reduce(s, { type: 'removeImport', id: 'import-1' });
  assert.equal(gone.datasetId, 'aarav');
  assert.equal(gone.periodKey, '2026-09');
  assert.deepEqual(gone.imports, {});
  assert.equal(gone.guardrails['import-1'], undefined);
  const two = importText(s, BROKER_CSV, 'b.csv');
  const kept = reduce(two, { type: 'removeImport', id: 'import-1' });
  assert.equal(kept.datasetId, 'import-2');
  assert.deepEqual(Object.keys(kept.imports), ['import-2']);
});

// ---------- persistence ----------

test('persistable keeps sample-data guardrails and theme only; imports never leave memory', () => {
  let s = run(initialState(), { type: 'openGuardrail', habitId: 'H1' }, { type: 'saveGuardrail' }, { type: 'setTheme', theme: 'dark' });
  s = importText(s, BROKER_CSV);
  s = run(s, { type: 'openGuardrail', habitId: 'H5' }, { type: 'saveGuardrail' });
  const p = persistable(s);
  assert.deepEqual(Object.keys(p).sort(), ['guardrails', 'theme']);
  assert.deepEqual(Object.keys(p.guardrails), ['aarav']);
  assert.equal(p.theme, 'dark');
  assert.ok(!JSON.stringify(p).includes('NIFTY X'), 'no imported trade data in the persisted blob');
  // Round trip through initialState restores the saved rule.
  assert.deepEqual(initialState(JSON.parse(JSON.stringify(p))).guardrails, p.guardrails);
});

test('initialState(persisted) drops unknown datasets, unknown habits, invalid params and bad statuses', () => {
  const s = initialState({
    guardrails: {
      aarav: {
        H1: { params: { minutes: 30 }, status: 'active' },
        H2: { params: { dropPct: 7 }, status: 'active' }, // not a multiple of 5
        H4: { params: { maxLots: 500 }, status: 'paused' }, // out of range
        H5: { params: { limit: 3 }, status: 'bogus' },
        H3: { params: {}, status: 'paused', createdPeriod: '2026-09' },
        H9: { params: {}, status: 'active' },
      },
      meera: 'garbage',
      kabir: { H1: null, H5: { status: 'active' } },
      'import-1': { H1: { params: { minutes: 30 }, status: 'active' } },
      nobody: { H1: { params: { minutes: 30 }, status: 'active' } },
    },
    theme: 'neon',
  });
  assert.deepEqual(s.guardrails, {
    aarav: {
      H1: { params: { minutes: 30 }, status: 'active', createdPeriod: null, settingsPeriod: null, savedAt: null, changedAt: null },
      H3: { params: {}, status: 'paused', createdPeriod: '2026-09', settingsPeriod: '2026-09', savedAt: null, changedAt: null },
    },
  });
  assert.equal(s.theme, 'system');
  for (const junk of [undefined, {}, { guardrails: 'x' }, { guardrails: [1, 2] }, 'string', 42]) assert.deepEqual(initialState(junk).guardrails, {}, JSON.stringify(junk));
  assert.equal(initialState({ theme: 'light' }).theme, 'light');
});

// ---------- next action ----------

test('selectNextAction priority: guard the top confirmed habit, then the next, then compare, then wait', () => {
  let s = initialState();
  const a = selectAnalysis(s);
  assert.deepEqual(a.confirmed.map((h) => h.id), ['H1', 'H2'], 'ranked by associated excess loss');
  let n = selectNextAction(s);
  assert.equal(n.kind, 'guardrail');
  assert.deepEqual(n.action, { type: 'openGuardrail', habitId: 'H1' });
  s = run(s, n.action, { type: 'saveGuardrail' });
  n = selectNextAction(s);
  assert.deepEqual(n.action, { type: 'openGuardrail', habitId: 'H2' });
  s = run(s, n.action, { type: 'saveGuardrail' });
  n = selectNextAction(s);
  assert.equal(n.kind, 'compare');
  assert.deepEqual(n.action, { type: 'navigate', view: 'compare' });
  assert.match(n.title, /October 2026/);
  // October: its only confirmed habit (H2) is guarded and there is no later month, but September is
  // earlier and has rules, so the next step is to see how the guarded behaviours changed.
  s = reduce(s, { type: 'selectPeriod', key: '2026-10' });
  assert.deepEqual(selectAnalysis(s).confirmed.map((h) => h.id), ['H2']);
  n = selectNextAction(s);
  assert.equal(n.kind, 'review-change');
  assert.deepEqual(n.action, { type: 'navigate', view: 'compare' });
  assert.match(n.title, /September 2026/);
});

test('selectNextAction: Kabir → none; thin import → import more; no closed trades → import; rejected rows → review data', () => {
  assert.equal(selectNextAction(reduce(initialState(), { type: 'selectDataset', id: 'kabir' })).kind, 'none');
  const thin = selectNextAction(importText(initialState(), BROKER_CSV));
  assert.equal(thin.kind, 'thin');
  assert.deepEqual(thin.action, { type: 'navigate', view: 'import' });
  // Only opening orders: every position is still open, so there are no closed trades and no period.
  const open = importText(initialState(), BROKER_CSV.split('\n').filter((l, i) => i === 0 || /,BUY,/.test(l)).join('\n'));
  assert.equal(open.periodKey, null);
  assert.equal(selectNextAction(open).kind, 'import');
  // Kabir's September exported, plus one malformed row: nothing confirmed, but data issues to review.
  const csv = `${toCsv(PERSONAS.kabir.months['2026-09'].fills)}\nX1,not-a-date,NIFTY,NIFTY Q 25000 CE,CE,25000,2026-09-08,BUY,75,100,20,`;
  const k = importText(initialState(), csv, 'kabir.csv');
  const q = selectNextAction(k);
  assert.equal(q.kind, 'quality');
  assert.match(q.body, /1 row was rejected at import/);
});

// ---------- trade explorer ----------

test('selectTrades habit filters: H1 returns exactly the H1-labelled trades; "none" excludes every labelled trade', () => {
  const base = initialState();
  const a = selectAnalysis(base);
  const labelled = new Set(Object.keys(a.labels));
  const h1 = selectTrades(reduce(base, { type: 'setTradeFilter', key: 'habit', value: 'H1' }));
  assert.equal(h1.matched, a.standalone.H1.unitIds.length);
  assert.deepEqual(h1.rows.map((u) => u.id).sort(), [...a.standalone.H1.unitIds].sort());
  const none = selectTrades(reduce(base, { type: 'setTradeFilter', key: 'habit', value: 'none' }));
  assert.equal(none.matched, a.units.length - labelled.size);
  const any = selectTrades(reduce(base, { type: 'setTradeFilter', key: 'habit', value: 'any' }));
  assert.equal(any.matched, labelled.size);
  for (const u of any.rows) assert.ok(labelled.has(u.id));
  const allNone = selectTrades(run(base, { type: 'setTradeFilter', key: 'habit', value: 'none' }, { type: 'setTradePage', page: 2 }));
  for (const u of [...none.rows, ...allNone.rows]) assert.ok(!labelled.has(u.id));
  assert.equal(none.filtersActive, true);
  assert.equal(selectTrades(base).filtersActive, false);
});

test('selectTrades: date range, outcome and search filters, totals over every matched trade, sorting and paging', () => {
  const base = initialState();
  const a = selectAnalysis(base);
  const range = selectTrades(run(base, { type: 'setTradeFilter', key: 'from', value: '2026-09-03' }, { type: 'setTradeFilter', key: 'to', value: '2026-09-04' }));
  const inRange = a.units.filter((u) => u.day >= '2026-09-03' && u.day <= '2026-09-04');
  assert.ok(inRange.length > 0);
  assert.deepEqual(range.rows.map((u) => u.id), inRange.map((u) => u.id));
  const losses = selectTrades(run(base, { type: 'setTradeFilter', key: 'outcome', value: 'loss' }, { type: 'setTradeFilter', key: 'q', value: 'banknifty' }));
  const want = a.units.filter((u) => u.netPnl < 0 && u.underlying === 'BANKNIFTY');
  assert.equal(losses.matched, want.length);
  assert.ok(Math.abs(losses.netOfMatched - want.reduce((s, u) => s + u.netPnl, 0)) < 1e-6, 'total of the filtered trades');
  // Paging: 52 trades → 3 pages of 25; page 3 holds the last 2; an out-of-range page is clamped.
  assert.equal(a.units.length, 52);
  const p1 = selectTrades(base);
  assert.deepEqual([p1.total, p1.matched, p1.pages, p1.page, p1.rows.length], [52, 52, 3, 1, PAGE_SIZE]);
  // The total spans all 3 pages, not just the 25 rows on screen (which sum to a different figure).
  const allNet = a.units.reduce((s, u) => s + u.netPnl, 0);
  const pageNet = p1.rows.reduce((s, u) => s + u.netPnl, 0);
  assert.ok(Math.abs(allNet - pageNet) > 1, 'page 1 alone has a different total, so this check can fail');
  assert.ok(Math.abs(p1.netOfMatched - allNet) < 1e-6, 'total covers every matched trade, not just the page');
  assert.ok(Math.abs(selectTrades(reduce(base, { type: 'setTradePage', page: 2 })).netOfMatched - allNet) < 1e-6, 'same total on page 2');
  const p3 = selectTrades(reduce(base, { type: 'setTradePage', page: 3 }));
  assert.equal(p3.rows.length, 52 - 2 * PAGE_SIZE);
  assert.equal(selectTrades(reduce(base, { type: 'setTradePage', page: 99 })).page, 3);
  // Sorting by net P&L descending over all pages.
  const sorted = [];
  for (let page = 1; page <= 3; page++) sorted.push(...selectTrades(run(base, { type: 'setTradeSort', key: 'netPnl' }, { type: 'setTradeSort', key: 'netPnl' }, { type: 'setTradePage', page })).rows);
  assert.equal(sorted.length, 52);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].netPnl >= sorted[i].netPnl);
  // Selected trade resolves to the unit; an unknown id resolves to null.
  assert.equal(selectTrades(reduce(base, { type: 'selectTrade', id: a.units[5].id })).selected, a.units[5]);
  assert.equal(selectTrades(reduce(base, { type: 'selectTrade', id: 'P:nope' })).selected, null);
});

// ---------- inspector ----------

test('selectInspector: excludeWorst removes the largest contributor, and the sensitivity equals regate()', () => {
  let s = reduce(initialState(), { type: 'inspectHabit', habitId: 'H1' });
  const a = selectAnalysis(s);
  const h = a.habits.H1;
  const worst = [...h.evidence].sort((x, y) => y.contribution - x.contribution)[0];
  assert.equal(selectInspector(s).sensitivity, null);
  s = reduce(s, { type: 'excludeWorst' });
  assert.deepEqual(s.inspect.excluded, [worst.unitId]);
  const insp = selectInspector(s);
  assert.equal(insp.worst.unitId, worst.unitId);
  const ref = regate(a, 'H1', [worst.unitId]);
  assert.deepEqual(
    [insp.sensitivity.occurrences, insp.sensitivity.cost, insp.sensitivity.gates.pass, insp.sensitivity.gates.failed?.id, insp.sensitivity.wouldConfirm],
    [ref.occurrences, ref.cost, ref.gates.pass, ref.gates.failed?.id, ref.wouldConfirm],
  );
  assert.equal(insp.sensitivity.occurrences, h.occurrences - 1);
  assert.ok(Math.abs(insp.sensitivity.cost - (h.cost - worst.contribution)) < 1e-6, 'cost drops by exactly the excluded contribution');
  assert.equal(selectInspector(reduce(s, { type: 'resetExclusions' })).sensitivity, null);
  // Ids that are not this habit's trades are ignored.
  assert.equal(selectInspector(reduce(reduce(s, { type: 'resetExclusions' }), { type: 'toggleExclude', unitId: 'P:nope' })).sensitivity, null);
  // Sort by contribution, descending on the second click.
  const rows = selectInspector(run(s, { type: 'setInspectSort', key: 'contribution' }, { type: 'setInspectSort', key: 'contribution' })).rows;
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].contribution >= rows[i].contribution);
});

// ---------- comparison and lab selectors ----------

test('selectComparison and selectLab read the same engine results the views show', () => {
  const s = initialState();
  const c = selectComparison(s);
  assert.deepEqual([c.from, c.to, c.fromLabel, c.toLabel, c.same], ['2026-09', '2026-10', 'September 2026', 'October 2026', false]);
  assert.equal(c.rows.find((r) => r.id === 'H1').verdict, 'Improving');
  assert.equal(selectComparison(reduce(s, { type: 'swapCompare' })).from, '2026-10');
  assert.equal(selectComparison(s, '2026-09', '2026-09').same, true);
  let l = reduce(s, { type: 'setScenario', id: 'clean' });
  assert.deepEqual(l.lab, { scenario: 'clean', from: 'clean', params: SCENARIOS.clean.params });
  assert.notEqual(l.lab.params, SCENARIOS.clean.params, 'a copy, so edits never touch the preset');
  l = reduce(l, { type: 'setLabParam', key: 'days', value: '99' });
  // Clamped to September 2026's 21 trading days; the custom month remembers its starting preset.
  assert.deepEqual([l.lab.scenario, l.lab.params.days, l.lab.from], ['custom', 21, 'clean'], 'custom month remembers its starting preset');
  assert.equal(reduce(l, { type: 'setLabParam', key: 'blowup', value: 'true' }).lab.params.blowup, true);
  assert.equal(reduce(l, { type: 'regenerateLab' }).lab.params.seed, l.lab.params.seed + 1);
  const lab = selectLab(reduce(s, { type: 'setScenario', id: 'repeated' }));
  assert.equal(lab.scenario, 'repeated');
  assert.equal(lab.analysis.habits.H1.status, 'confirmed');
});

// ---------- known issues (reported, not fixed) ----------

// summary.accepted already excludes rows marked "excluded", so the notice subtracts them twice.
test('confirmImport notice reports the number of orders actually imported', () => {
  const s = run(initialState(), fileRead(BROKER_CSV), { type: 'validateImport' }, { type: 'toggleExcludeDuplicates' }, { type: 'confirmImport' });
  assert.equal(getDataset(s).fills.length, 4);
  assert.match(s.notice.text, /^Imported 4 orders/);
});

// main.js passes JSON.parse(localStorage value) straight in; a stored "null" crashes start-up.
test('initialState(null) falls back to defaults instead of throwing', () => {
  assert.deepEqual(initialState(null).guardrails, {});
});
