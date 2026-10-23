// App state: a pure reducer plus memoised selectors. No DOM.
// Views read state only through these selectors, so every number on screen comes from the engine.

import {
  analyze, periodsOf, comparePeriods, regate, measureGuardrail, defaultGuardrailParams, validateGuardrailParams,
  GUARDRAILS, HABITS, HABIT_IDS, CONFIG,
} from './engine.js';
import { PERSONAS } from './data.js';
import { readTable, suggestMapping, mappingProblems, validateRows, LIMITS, COLUMNS } from './import.js';
import { runScenario, SCENARIOS, clampParams } from './lab.js';
import { formatMonth, formatINR, plural } from './format.js';

export const VIEWS = ['overview', 'habits', 'inspect', 'trades', 'guardrails', 'compare', 'import', 'lab', 'method'];
export const PAGE_SIZE = 25;

export const TRADE_FILTER_DEFAULTS = { q: '', from: '', to: '', underlying: 'all', type: 'all', outcome: 'all', habit: 'all', sort: 'open', dir: 'asc', page: 1 };
const INSPECT_DEFAULTS = { excluded: [], sort: 'day', dir: 'asc' };
const WIZARD_DEFAULTS = { step: 'start', fileName: null, size: 0, header: null, table: null, mapping: null, problems: [], result: null, excludeDuplicates: false, error: null, target: 'new' };
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// ---------- datasets ----------

export function getDataset(state, id = state.datasetId) {
  return PERSONAS[id] ?? state.imports[id] ?? null;
}

export function listDatasets(state) {
  return [
    ...Object.values(PERSONAS).map((p) => ({ id: p.id, name: p.name, kind: 'sample', style: p.style })),
    ...Object.values(state.imports).map((d) => ({ id: d.id, name: d.name, kind: 'import', style: `Imported ${d.importSummary.accepted} orders` })),
  ];
}

function defaultPeriodFor(ds) {
  if (!ds) return null;
  if (ds.defaultPeriod) return ds.defaultPeriod;
  const ps = periodsOf(ds.fills);
  return ps.length ? ps[ps.length - 1].key : null;
}

function defaultCompareFor(ds) {
  const ps = ds ? periodsOf(ds.fills) : [];
  if (ps.length < 2) return { from: ps[0]?.key ?? null, to: ps[0]?.key ?? null };
  return { from: ps[ps.length - 2].key, to: ps[ps.length - 1].key };
}

// ---------- initial state ----------

export function initialState(persisted) {
  if (!persisted || typeof persisted !== 'object') persisted = {};
  const ds = PERSONAS.aarav;
  return {
    view: 'overview',
    datasetId: ds.id,
    imports: {},
    importCounter: 0,
    periodKey: defaultPeriodFor(ds),
    compare: defaultCompareFor(ds),
    habitsFilter: { status: 'all', sort: 'rank' },
    inspect: { habitId: 'H1', ...INSPECT_DEFAULTS },
    trades: { ...TRADE_FILTER_DEFAULTS },
    selectedTradeId: null,
    guardrails: sanitizeGuardrails(persisted.guardrails),
    guardEdit: null,
    importWizard: { ...WIZARD_DEFAULTS },
    lab: { scenario: 'repeated', from: 'repeated', params: { ...SCENARIOS.repeated.params } },
    theme: ['light', 'dark', 'system'].includes(persisted.theme) ? persisted.theme : 'system',
    notice: null,
  };
}

function sanitizeGuardrails(g) {
  const out = {};
  if (!g || typeof g !== 'object') return out;
  for (const [dsId, rules] of Object.entries(g)) {
    if (!PERSONAS[dsId] || !rules || typeof rules !== 'object') continue;
    for (const [habitId, r] of Object.entries(rules)) {
      if (!GUARDRAILS[habitId] || !r || !['active', 'paused'].includes(r.status)) continue;
      if (Object.keys(validateGuardrailParams(habitId, r.params ?? {})).length) continue;
      const iso = (v) => (typeof v === 'string' && ISO_RE.test(v) ? v : null);
      const per = (v) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? v : null);
      (out[dsId] ??= {})[habitId] = { params: { ...r.params }, status: r.status, createdPeriod: per(r.createdPeriod), settingsPeriod: per(r.settingsPeriod) ?? per(r.createdPeriod), savedAt: iso(r.savedAt), changedAt: iso(r.changedAt) ?? iso(r.savedAt) };
    }
  }
  return out;
}

// What is worth persisting across visits (sample-data guardrails and theme only; imports stay in memory).
export function persistable(state) {
  const guardrails = {};
  for (const [id, rules] of Object.entries(state.guardrails)) if (PERSONAS[id]) guardrails[id] = rules;
  return { guardrails, theme: state.theme };
}

// ---------- reducer ----------

const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

function resetForData(state) {
  return { ...state, trades: { ...TRADE_FILTER_DEFAULTS }, selectedTradeId: null, inspect: { ...state.inspect, ...INSPECT_DEFAULTS }, guardEdit: null };
}

// The habit the evidence inspector opens on for this data: the top confirmed habit, else the first
// near miss, else the first behaviour that occurred at all, else H1.
export function defaultInspectHabit(state) {
  const a = selectAnalysis(state);
  return a.confirmed[0]?.id ?? a.nearMisses[0]?.id ?? HABIT_IDS.find((id) => a.habits[id].occurrences > 0) ?? 'H1';
}
const withDefaultInspect = (s) => ({ ...s, inspect: { habitId: defaultInspectHabit(s), ...INSPECT_DEFAULTS } });

const handlers = {
  navigate(state, a) {
    const view = VIEWS.includes(a.view) ? a.view : 'overview';
    const next = { ...state, view, selectedTradeId: view === 'trades' ? state.selectedTradeId : null, guardEdit: null };
    if (view === 'inspect' && a.habitId && HABITS[a.habitId] && a.habitId !== state.inspect.habitId) next.inspect = { habitId: a.habitId, ...INSPECT_DEFAULTS };
    return next;
  },
  selectDataset(state, a) {
    const ds = getDataset(state, a.id);
    if (!ds) return state;
    return withDefaultInspect({ ...resetForData(state), datasetId: ds.id, periodKey: defaultPeriodFor(ds), compare: defaultCompareFor(ds) });
  },
  selectPeriod(state, a) {
    const ds = getDataset(state);
    if (!periodsOf(ds.fills).some((p) => p.key === a.key)) return state;
    return withDefaultInspect({ ...resetForData(state), periodKey: a.key });
  },
  setCompare(state, a) {
    const ds = getDataset(state);
    if (!['from', 'to'].includes(a.which) || !periodsOf(ds.fills).some((p) => p.key === a.key)) return state;
    return { ...state, compare: { ...state.compare, [a.which]: a.key } };
  },
  swapCompare: (state) => ({ ...state, compare: { from: state.compare.to, to: state.compare.from } }),
  setHabitsFilter(state, a) {
    const allowed = { status: ['all', 'confirmed', 'near', 'other'], sort: ['rank', 'cost', 'rate', 'occurrences'] };
    if (!allowed[a.key]?.includes(a.value)) return state;
    return { ...state, habitsFilter: { ...state.habitsFilter, [a.key]: a.value } };
  },
  inspectHabit(state, a) {
    if (!HABITS[a.habitId]) return state;
    const same = a.habitId === state.inspect.habitId;
    return { ...state, view: 'inspect', inspect: same ? state.inspect : { habitId: a.habitId, ...INSPECT_DEFAULTS }, selectedTradeId: null };
  },
  toggleExclude(state, a) {
    const ex = new Set(state.inspect.excluded);
    ex.has(a.unitId) ? ex.delete(a.unitId) : ex.add(a.unitId);
    return { ...state, inspect: { ...state.inspect, excluded: [...ex] } };
  },
  excludeWorst(state) {
    const h = selectAnalysis(state).habits[state.inspect.habitId];
    if (!h.evidence.length) return state;
    const worst = [...h.evidence].sort((x, y) => y.contribution - x.contribution)[0];
    return { ...state, inspect: { ...state.inspect, excluded: [worst.unitId] } };
  },
  resetExclusions: (state) => ({ ...state, inspect: { ...state.inspect, excluded: [] } }),
  setInspectSort(state, a) {
    if (!['day', 'netPnl', 'contribution'].includes(a.key)) return state;
    const dir = state.inspect.sort === a.key && state.inspect.dir === 'asc' ? 'desc' : 'asc';
    return { ...state, inspect: { ...state.inspect, sort: a.key, dir } };
  },
  setTradeFilter(state, a) {
    if (!(a.key in TRADE_FILTER_DEFAULTS) || ['page', 'sort', 'dir'].includes(a.key)) return state;
    return { ...state, trades: { ...state.trades, [a.key]: String(a.value ?? ''), page: 1 }, selectedTradeId: null };
  },
  // Resets filters only; the chosen sort order is kept.
  resetTradeFilters: (state) => ({ ...state, trades: { ...TRADE_FILTER_DEFAULTS, sort: state.trades.sort, dir: state.trades.dir }, selectedTradeId: null }),
  setTradeSort(state, a) {
    if (!['open', 'netPnl', 'hold', 'lots'].includes(a.key)) return state;
    const dir = state.trades.sort === a.key && state.trades.dir === 'asc' ? 'desc' : 'asc';
    return { ...state, trades: { ...state.trades, sort: a.key, dir, page: 1 } };
  },
  setTradePage(state, a) {
    const page = Math.max(1, Math.floor(num(a.page)) || 1);
    return { ...state, trades: { ...state.trades, page } };
  },
  // Selecting a trade from any view opens it in the trade explorer's detail panel.
  selectTrade: (state, a) => ({ ...state, selectedTradeId: a.id || null, view: 'trades' }),
  closeTrade: (state) => ({ ...state, selectedTradeId: null }),

  openGuardrail(state, a) {
    if (!GUARDRAILS[a.habitId]) return state;
    const saved = state.guardrails[state.datasetId]?.[a.habitId];
    const params = saved ? { ...saved.params } : defaultGuardrailParams(a.habitId, selectAnalysis(state));
    return { ...state, guardEdit: { habitId: a.habitId, params, errors: {}, isNew: !saved } };
  },
  setGuardParam(state, a) {
    if (!state.guardEdit) return state;
    const def = GUARDRAILS[state.guardEdit.habitId].params.find((p) => p.key === a.key);
    if (!def) return state;
    const params = { ...state.guardEdit.params, [a.key]: num(a.value) };
    return { ...state, guardEdit: { ...state.guardEdit, params, errors: validateGuardrailParams(state.guardEdit.habitId, params) } };
  },
  saveGuardrail(state, a) {
    const g = state.guardEdit;
    if (!g) return state;
    const errors = validateGuardrailParams(g.habitId, g.params);
    if (Object.keys(errors).length) return { ...state, guardEdit: { ...g, errors } };
    const prev = state.guardrails[state.datasetId]?.[g.habitId];
    // main.js stamps the save time; tests may omit it. Changing the settings restarts the timeline.
    const at = typeof a?.at === 'string' && ISO_RE.test(a.at) ? a.at : null;
    const changed = !prev || JSON.stringify(prev.params) !== JSON.stringify(g.params);
    const rule = {
      params: { ...g.params },
      status: prev?.status ?? 'active',
      createdPeriod: prev?.createdPeriod ?? state.periodKey,
      settingsPeriod: changed ? state.periodKey : prev.settingsPeriod ?? prev.createdPeriod,
      savedAt: prev?.savedAt ?? at,
      changedAt: changed ? at : prev.changedAt ?? prev.savedAt ?? null,
    };
    const rules = { ...(state.guardrails[state.datasetId] ?? {}), [g.habitId]: rule };
    return { ...state, guardrails: { ...state.guardrails, [state.datasetId]: rules }, guardEdit: null, notice: { tone: 'ok', text: `${prev ? 'Updated' : 'Saved'} "${GUARDRAILS[g.habitId].title}". Nothing was sent to any broker.` } };
  },
  closeGuardEdit: (state) => ({ ...state, guardEdit: null }),
  setGuardStatus(state, a) {
    const r = state.guardrails[state.datasetId]?.[a.habitId];
    if (!r || !['active', 'paused'].includes(a.status)) return state;
    return { ...state, guardrails: { ...state.guardrails, [state.datasetId]: { ...state.guardrails[state.datasetId], [a.habitId]: { ...r, status: a.status } } } };
  },
  removeGuardrail(state, a) {
    const rules = { ...(state.guardrails[state.datasetId] ?? {}) };
    if (!rules[a.habitId]) return state;
    delete rules[a.habitId];
    return { ...state, guardrails: { ...state.guardrails, [state.datasetId]: rules }, guardEdit: null, notice: { tone: 'info', text: `Removed "${GUARDRAILS[a.habitId].title}".` } };
  },

  importFileRead(state, a) {
    const size = Number(a.size) || 0;
    if (size > LIMITS.maxBytes) return { ...state, importWizard: { ...WIZARD_DEFAULTS, error: `"${a.fileName}" is larger than 5 MB. Split it into smaller files and add each one to the same trader.` } };
    const table = readTable(a.text);
    if (!table.header.length) return { ...state, importWizard: { ...WIZARD_DEFAULTS, error: `"${a.fileName}" is empty.` } };
    if (!table.rows.length) return { ...state, importWizard: { ...WIZARD_DEFAULTS, error: `"${a.fileName}" has a header row but no data rows.` } };
    const mapping = suggestMapping(table.header);
    return { ...state, importWizard: { ...WIZARD_DEFAULTS, step: 'mapping', fileName: a.fileName, size, header: table.header, table, mapping, problems: mappingProblems(mapping) } };
  },
  importReading: (state, a) => ({ ...state, importWizard: { ...WIZARD_DEFAULTS, step: 'reading', fileName: a.fileName ?? null } }),
  importFileError: (state, a) => ({ ...state, importWizard: { ...WIZARD_DEFAULTS, error: String(a.message || 'The file could not be read.') } }),
  setMapping(state, a) {
    const w = state.importWizard;
    if (!w.table || !COLUMNS.includes(a.field)) return state;
    const col = a.column === '' || a.column === 'none' ? null : Number(a.column);
    if (col !== null && !(col >= 0 && col < w.header.length)) return state;
    const mapping = { ...w.mapping, [a.field]: col };
    return { ...state, importWizard: { ...w, mapping, problems: mappingProblems(mapping), result: null, step: 'mapping' } };
  },
  validateImport(state) {
    const w = state.importWizard;
    if (!w.table) return state;
    const problems = mappingProblems(w.mapping);
    if (problems.length) return { ...state, importWizard: { ...w, problems } };
    return { ...state, importWizard: { ...w, problems, step: 'preview', result: validateRows(w.table, w.mapping), excludeDuplicates: false } };
  },
  toggleExcludeDuplicates(state) {
    const w = state.importWizard;
    if (!w.result) return state;
    const excludeDuplicates = !w.excludeDuplicates;
    const base = validateRows(w.table, w.mapping);
    const result = excludeDuplicates ? validateRows(w.table, w.mapping, { excludeLines: new Set(base.summary.suspectedDuplicates) }) : base;
    return { ...state, importWizard: { ...w, excludeDuplicates, result } };
  },
  backToMapping: (state) => ({ ...state, importWizard: { ...state.importWizard, step: 'mapping', result: null } }),
  // Import as a new trader, or add the file to an existing imported trader (so months and guardrails carry over).
  setImportTarget(state, a) {
    const target = a.target === 'new' || state.imports[a.target] ? a.target : null;
    return target ? { ...state, importWizard: { ...state.importWizard, target } } : state;
  },
  confirmImport(state) {
    const w = state.importWizard;
    if (!w.result || !w.result.fills.length) return state;
    const rejectedRows = w.result.rows.filter((r) => r.status === 'rejected').map((r) => ({ line: r.line, file: w.fileName, messages: r.messages.filter((m) => m.level === 'error').map((m) => m.text) }));
    const fileEntry = { fileName: w.fileName, accepted: w.result.fills.length, rejected: w.result.summary.rejected };
    const existing = w.target !== 'new' ? state.imports[w.target] : null;
    if (existing) {
      // Add to an existing imported trader: orders whose id is already there are skipped, not duplicated.
      const ids = new Set(existing.fills.map((f) => f.id));
      const added = w.result.fills.filter((f) => !ids.has(f.id));
      const skipped = w.result.fills.length - added.length;
      const prev = existing.importSummary;
      const merged = {
        ...existing,
        fills: [...existing.fills, ...added],
        importSummary: {
          ...prev,
          fileName: `${prev.fileName} + ${w.fileName}`,
          files: [...(prev.files ?? [{ fileName: prev.fileName, accepted: prev.accepted, rejected: prev.rejected }]), { ...fileEntry, accepted: added.length, skipped }],
          total: prev.total + w.result.summary.total, read: prev.read + w.result.summary.read,
          accepted: prev.accepted + added.length, rejected: prev.rejected + w.result.summary.rejected,
          excluded: prev.excluded + w.result.summary.excluded, withWarnings: prev.withWarnings + w.result.summary.withWarnings,
          missingCharges: prev.missingCharges + w.result.summary.missingCharges, assumedIst: prev.assumedIst + w.result.summary.assumedIst,
          suspectedDuplicates: [], duplicateIds: [], skippedExisting: (prev.skippedExisting ?? 0) + skipped,
          notes: [...(prev.notes ?? []), ...w.result.notes.map((t) => `${w.fileName}: ${t}`)],
          rejectedRows: [...(prev.rejectedRows ?? []), ...rejectedRows],
        },
      };
      const next = { ...state, imports: { ...state.imports, [existing.id]: merged }, importWizard: { ...WIZARD_DEFAULTS, step: 'done', fileName: w.fileName, lastImportId: existing.id } };
      return { ...handlers.selectDataset(next, { id: existing.id }), view: 'overview', notice: { tone: 'ok', text: `Added ${plural(added.length, 'order')} from "${w.fileName}" to "${existing.name}"${skipped ? ` (${plural(skipped, 'order')} already there ${skipped === 1 ? 'was' : 'were'} skipped)` : ''}. Its guardrails carry over.` } };
    }
    const n = state.importCounter + 1;
    const id = `import-${n}`;
    const base = (w.fileName || `Import ${n}`).replace(/\.(csv|txt)$/i, '');
    const taken = new Set(Object.values(state.imports).map((d) => d.name));
    let name = base;
    for (let k = 2; taken.has(name); k++) name = `${base} (${k})`;
    const ds = { id, kind: 'import', name, fills: w.result.fills, importSummary: { ...w.result.summary, fileName: w.fileName, files: [fileEntry], notes: w.result.notes, rejectedRows } };
    const next = { ...state, imports: { ...state.imports, [id]: ds }, importCounter: n, importWizard: { ...WIZARD_DEFAULTS, step: 'done', fileName: w.fileName, lastImportId: id } };
    return { ...handlers.selectDataset(next, { id }), view: 'overview', notice: { tone: 'ok', text: `Imported ${plural(ds.fills.length, 'order')} from "${w.fileName}" as "${name}". This data stays in this browser tab and is gone when you close it.` } };
  },
  cancelImport: (state) => ({ ...state, importWizard: { ...WIZARD_DEFAULTS } }),
  removeImport(state, a) {
    if (!state.imports[a.id]) return state;
    const imports = { ...state.imports };
    delete imports[a.id];
    const guardrails = { ...state.guardrails };
    delete guardrails[a.id];
    const next = { ...state, imports, guardrails };
    return state.datasetId === a.id ? handlers.selectDataset(next, { id: 'aarav' }) : next;
  },

  setScenario(state, a) {
    if (!SCENARIOS[a.id]) return state;
    return { ...state, lab: { scenario: a.id, from: a.id, params: { ...SCENARIOS[a.id].params } } };
  },
  setLabParam(state, a) {
    const value = a.key === 'blowup' ? (a.value === true || a.value === 'true') : num(a.value);
    if (a.key !== 'blowup' && !Number.isFinite(value)) return state;
    // 'from' remembers the preset this custom month started from.
    return { ...state, lab: { scenario: 'custom', from: state.lab.from ?? (state.lab.scenario !== 'custom' ? state.lab.scenario : 'repeated'), params: clampParams({ ...state.lab.params, [a.key]: value }) } };
  },
  regenerateLab: (state) => ({ ...state, lab: { ...state.lab, params: { ...state.lab.params, seed: state.lab.params.seed + 1 } } }),

  setTheme: (state, a) => (['light', 'dark', 'system'].includes(a.theme) ? { ...state, theme: a.theme } : state),
  dismissNotice: (state) => (state.notice ? { ...state, notice: null } : state),
};

export const ACTION_TYPES = new Set(Object.keys(handlers));
// Side effects handled in main.js (file reading and downloads); they never change state directly.
export const EFFECT_TYPES = new Set(['importFile', 'downloadTemplate', 'downloadSample', 'downloadRejected', 'downloadLabCsv', 'openLabInImporter']);

export function reduce(state, action) {
  const h = handlers[action?.type];
  return h ? h(state, action) : state;
}

// ---------- selectors (memoised by data identity) ----------

const analysisCache = new WeakMap();
export function selectAnalysis(state, periodKey = state.periodKey) {
  const ds = getDataset(state);
  let byPeriod = analysisCache.get(ds.fills);
  if (!byPeriod) { byPeriod = new Map(); analysisCache.set(ds.fills, byPeriod); }
  const key = periodKey ?? '*';
  if (!byPeriod.has(key)) byPeriod.set(key, analyze(ds.fills, { period: periodKey }));
  return byPeriod.get(key);
}

export const selectPeriods = (state) => periodsOf(getDataset(state).fills);

export function selectPrevPeriod(state, key = state.periodKey) {
  const ps = selectPeriods(state);
  const i = ps.findIndex((p) => p.key === key);
  return i > 0 ? ps[i - 1] : null;
}

export function selectNextPeriod(state, key = state.periodKey) {
  const ps = selectPeriods(state);
  const i = ps.findIndex((p) => p.key === key);
  return i >= 0 && i < ps.length - 1 ? ps[i + 1] : null;
}

const compareCache = new WeakMap();
export function selectComparison(state, from = state.compare.from, to = state.compare.to) {
  if (!from || !to) return null;
  const a1 = selectAnalysis(state, from);
  const a2 = selectAnalysis(state, to);
  let m = compareCache.get(a1);
  if (!m) { m = new Map(); compareCache.set(a1, m); }
  if (!m.has(a2)) m.set(a2, comparePeriods(a1, a2));
  return { from, to, fromLabel: formatMonth(from), toLabel: formatMonth(to), rows: m.get(a2), a1, a2, same: from === to };
}

// Inspector: the habit as reported, plus a re-gated version when the user excludes trades.
export function selectInspector(state) {
  const a = selectAnalysis(state);
  const habit = a.habits[state.inspect.habitId];
  const excluded = state.inspect.excluded.filter((id) => habit.unitIds.includes(id));
  const sensitivity = excluded.length ? regate(a, habit.id, excluded) : null;
  const worstFirst = [...habit.evidence].sort((x, y) => y.contribution - x.contribution);
  const dir = state.inspect.dir === 'asc' ? 1 : -1;
  const key = state.inspect.sort;
  const rows = [...habit.evidence].sort((x, y) => dir * (key === 'day' ? `${x.day}${x.time}`.localeCompare(`${y.day}${y.time}`) : x[key] - y[key]));
  return { analysis: a, habit, def: HABITS[habit.id], rows, excluded, sensitivity, worst: worstFirst[0] ?? null };
}

export function tradeLabels(analysis, unitId) {
  return analysis.labels[unitId] ?? [];
}

// Trade explorer rows after search, filters, sort and paging.
export function selectTrades(state) {
  const a = selectAnalysis(state);
  const f = state.trades;
  const q = f.q.trim().toLowerCase();
  let rows = a.units.filter((u) => {
    if (q && !`${u.label} ${u.underlying} ${u.strategyId ?? ''} ${u.positions.map((p) => p.symbol).join(' ')}`.toLowerCase().includes(q)) return false;
    if (f.from && u.day < f.from) return false;
    if (f.to && u.day > f.to) return false;
    if (f.underlying !== 'all' && u.underlying !== f.underlying) return false;
    if (f.type !== 'all' && u.type !== f.type) return false;
    if (f.outcome !== 'all' && u.outcome !== f.outcome) return false;
    const labels = a.labels[u.id] ?? [];
    if (f.habit === 'any' && !labels.length) return false;
    if (f.habit === 'none' && labels.length) return false;
    if (HABITS[f.habit] && !labels.some((l) => l.habitId === f.habit)) return false;
    return true;
  });
  const dir = f.dir === 'asc' ? 1 : -1;
  const key = { open: (u) => u.openTs, netPnl: (u) => u.netPnl, hold: (u) => u.holdMin, lots: (u) => u.entryLots }[f.sort];
  rows = rows.sort((x, y) => {
    const kx = key(x), ky = key(y);
    return dir * (typeof kx === 'string' ? kx.localeCompare(ky) : kx - ky) || x.id.localeCompare(y.id);
  });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  return {
    analysis: a, total: a.units.length, matched: rows.length, page, pages,
    rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    netOfMatched: rows.reduce((s, u) => s + u.netPnl, 0),
    underlyings: [...new Set(a.units.map((u) => u.underlying))].sort(),
    types: [...new Set(a.units.map((u) => u.type))],
    days: a.units.length ? { first: a.units[0].day, last: a.units[a.units.length - 1].day } : null,
    selected: state.selectedTradeId ? a.units.find((u) => u.id === state.selectedTradeId) ?? null : null,
    filtersActive: Object.keys(TRADE_FILTER_DEFAULTS).some((k) => !['page', 'sort', 'dir'].includes(k) && f[k] !== TRADE_FILTER_DEFAULTS[k]),
  };
}

// Where a period stands relative to a rule: 'after' only when every trade in it was opened after the
// rule's current settings were saved; otherwise the trades already existed, so it is a what-if measurement.
export function rulePhase(state, rule, periodKey) {
  if (!rule || !periodKey) return 'what-if';
  const since = rule.changedAt ?? rule.savedAt;
  const first = selectAnalysis(state, periodKey).units[0]?.openTs;
  return since && first && Date.parse(first) > Date.parse(since) ? 'after' : 'what-if';
}

// Guardrail center: every rule template with its evidence, saved settings and measured compliance.
export function selectGuardrails(state) {
  const a = selectAnalysis(state);
  const saved = state.guardrails[state.datasetId] ?? {};
  const prev = selectPrevPeriod(state);
  const next = selectNextPeriod(state);
  return HABIT_IDS.map((id) => {
    const rule = saved[id] ?? null;
    const params = rule?.params ?? defaultGuardrailParams(id, a);
    const habit = a.habits[id];
    return {
      habitId: id, template: GUARDRAILS[id], habit, rule, params,
      recommended: habit.status === 'confirmed',
      compliance: { current: measureGuardrail(a, id, params), prev: prev ? measureGuardrail(selectAnalysis(state, prev.key), id, params) : null, next: next ? measureGuardrail(selectAnalysis(state, next.key), id, params) : null },
      phases: { current: rulePhase(state, rule, state.periodKey), prev: prev ? rulePhase(state, rule, prev.key) : null, next: next ? rulePhase(state, rule, next.key) : null },
      prevLabel: prev?.label ?? null, nextLabel: next?.label ?? null,
    };
  });
}

// Data quality for the current period, including rows rejected at import.
export function selectQuality(state) {
  const a = selectAnalysis(state);
  const ds = getDataset(state);
  const items = [...a.quality.items];
  let status = a.quality.status;
  if (ds.kind === 'import' && ds.importSummary.rejected) {
    items.unshift({ level: 'warning', code: 'rejected', text: `${ds.importSummary.rejected} row${ds.importSummary.rejected === 1 ? ' was' : 's were'} rejected at import and ${ds.importSummary.rejected === 1 ? 'is' : 'are'} not in any figure.` });
    if (status === 'good') status = 'attention';
  }
  return { status, items, source: ds.kind, importSummary: ds.importSummary ?? null };
}

// The single next step the overview recommends. Deterministic, in priority order.
export function selectNextAction(state) {
  const a = selectAnalysis(state);
  const q = selectQuality(state);
  const saved = state.guardrails[state.datasetId] ?? {};
  const next = selectNextPeriod(state);
  if (a.summary.units === 0) return { kind: 'import', title: 'Import a month of trades', body: 'There are no closed trades in this period.', action: { type: 'navigate', view: 'import' }, label: 'Go to import' };
  if (a.summary.thin) return { kind: 'thin', title: 'Add more history before judging habits', body: `This period has ${plural(a.summary.units, 'closed trade')}; habits need ${CONFIG.minUnits}+. ${getDataset(state).kind === 'import' ? 'You can add another file to this trader on the Import page.' : ''}`.trim(), action: { type: 'navigate', view: 'import' }, label: 'Import more data' };
  const unguarded = a.confirmed.find((h) => !saved[h.id]);
  if (unguarded) return { kind: 'guardrail', title: `Set a guardrail for "${unguarded.name}"`, body: unguarded.rank === 1
      ? `It is your highest-ranked habit, associated with ${formatINR(unguarded.cost)} of excess loss this period.`
      : `It is the highest-ranked habit without a guardrail (rank ${unguarded.rank} of ${a.confirmed.length}), associated with ${formatINR(unguarded.cost)} of excess loss this period.`, action: { type: 'openGuardrail', habitId: unguarded.id }, label: 'Set guardrail', view: 'guardrails' };
  if (a.confirmed.length && next) return { kind: 'compare', title: `Check ${next.label} against your guardrails`, body: 'See whether each behaviour happened less often per chance.', action: { type: 'navigate', view: 'compare' }, label: 'Compare periods' };
  const prev = selectPrevPeriod(state);
  if (prev && Object.keys(saved).length) return { kind: 'review-change', title: `See how your guarded behaviours changed since ${prev.label}`, body: 'Compare the rate per chance for each behaviour you set a rule for, with the sample sizes behind it.', action: { type: 'navigate', view: 'compare' }, label: 'Compare periods' };
  if (q.status === 'attention') return { kind: 'quality', title: 'Review data issues', body: q.items[0]?.text ?? '', action: { type: 'navigate', view: 'trades' }, label: 'Open trades' };
  if (a.confirmed.length) return { kind: 'wait', title: 'Guardrails are set', body: getDataset(state).kind === 'import' ? "Add next month's file to this trader on the Import page to measure whether the behaviours changed." : 'A later month is needed to measure whether the behaviours changed.', action: { type: 'navigate', view: 'import' }, label: 'Add next month' };
  if (next) return { kind: 'none', title: 'No habit needs action', body: `Nothing passed the evidence bar this period. ${next.label} is also in the data.`, action: { type: 'selectPeriod', key: next.key }, label: `Review ${next.label}` };
  return { kind: 'none', title: 'No habit needs action', body: 'Nothing passed the evidence bar. Review again when the next month is available.', action: { type: 'navigate', view: 'habits' }, label: 'See what was checked' };
}

const labCache = new Map();
export function selectLab(state) {
  const key = JSON.stringify(state.lab.params);
  if (!labCache.has(key)) {
    if (labCache.size > 40) labCache.clear();
    labCache.set(key, runScenario(state.lab.params));
  }
  return { scenario: state.lab.scenario, from: state.lab.from ?? 'repeated', scenarios: SCENARIOS, ...labCache.get(key) };
}
