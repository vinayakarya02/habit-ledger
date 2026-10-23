// Renders views across a matrix of realistic states (no DOM needed: views are pure functions of state)
// and reports problems: exceptions, unknown actions, unknown routes, duplicate ids, leaked NaN/undefined.

import { initialState, reduce, ACTION_TYPES, EFFECT_TYPES, VIEWS } from '../../src/store.js';
import { renderBanner, renderSidebar, renderTopbar, renderMobileNav, renderNotice } from '../../src/views/shell.js';
import { HABIT_IDS } from '../../src/engine.js';
import { runScenario } from '../../src/lab.js';
import { PERSONAS } from '../../src/data.js';
import { fourHabitFills } from './fixtures.mjs';
export const VIEW_NAMES = ['overview', 'habits', 'inspect', 'trades', 'guardrails', 'compare', 'import', 'lab', 'method'];

// Load view modules independently so one broken module doesn't hide problems in the others.
export async function loadModules(names = VIEW_NAMES) {
  const mods = {};
  const errors = {};
  for (const n of names) {
    try { mods[n] = await import(`../../src/views/${n}.js`); } catch (e) { errors[n] = e; }
  }
  return { mods, errors };
}

const LAB_ROWS = runScenario({ reentries: 9, reentryLoss: 45, missingPrice: 10, missingCharges: 15 }).csv.split('\n').slice(1);
export const MESSY_CSV = [
  'Trade ID,Time,Index,Trading Symbol,Option Type,Strike Price,Expiry,Buy/Sell,Quantity,Trade Price,Fees,Tag',
  ...LAB_ROWS,
  `COPY-OF-FIRST,${LAB_ROWS[0].split(',').slice(1).join(',')}`,
  'DUP1,2026-09-30 10:00,NIFTY,NIFTY X 25000 CE,CE,25000,2026-10-06,BUY,75,abc,20,',
  'DUP1,2026-09-30 10:05,NIFTY,NIFTY X 25000 CE,FUT,25000,2026-10-06,HOLD,-75,100,-3,',
].join('\n');

// Named states that every view must render without problems.
export function stateMatrix() {
  const out = [];
  const add = (name, s) => out.push({ name, state: s });
  let base = initialState();
  for (const ds of ['aarav', 'meera', 'kabir']) {
    let s = reduce(base, { type: 'selectDataset', id: ds });
    for (const period of ['2026-09', '2026-10']) {
      s = reduce(s, { type: 'selectPeriod', key: period });
      add(`${ds}/${period}`, s);
      for (const h of HABIT_IDS) add(`${ds}/${period}/inspect-${h}`, reduce(s, { type: 'inspectHabit', habitId: h }));
    }
  }
  let s = reduce(base, { type: 'inspectHabit', habitId: 'H1' });
  add('aarav/inspect-H1/exclude-worst', reduce(s, { type: 'excludeWorst' }));
  s = reduce(base, { type: 'setTradeFilter', key: 'q', value: 'BANKNIFTY' });
  s = reduce(s, { type: 'setTradeFilter', key: 'habit', value: 'H1' });
  add('aarav/trades-filtered', s);
  add('aarav/trades-no-match', reduce(base, { type: 'setTradeFilter', key: 'q', value: 'zzzz-no-match' }));
  const firstUnit = 'P:AS0001';
  add('aarav/trade-selected', reduce(base, { type: 'selectTrade', id: firstUnit }));
  add('meera/trade-selected', reduce(reduce(base, { type: 'selectDataset', id: 'meera' }), { type: 'selectTrade', id: 'S:MSS001' }));
  add('aarav/guard-edit-H1', reduce(base, { type: 'openGuardrail', habitId: 'H1' }));
  add('aarav/guard-edit-H4-invalid', reduce(reduce(base, { type: 'openGuardrail', habitId: 'H4' }), { type: 'setGuardParam', key: 'maxLots', value: '0' }));
  s = reduce(base, { type: 'openGuardrail', habitId: 'H1' });
  s = reduce(s, { type: 'saveGuardrail' });
  s = reduce(s, { type: 'openGuardrail', habitId: 'H5' });
  s = reduce(s, { type: 'saveGuardrail' });
  s = reduce(s, { type: 'setGuardStatus', habitId: 'H5', status: 'paused' });
  add('aarav/guardrails-saved', s);
  add('aarav/oct-with-guardrails', reduce(s, { type: 'selectPeriod', key: '2026-10' }));
  add('compare/same-period', reduce(base, { type: 'setCompare', which: 'to', key: '2026-09' }));
  add('compare/swapped', reduce(base, { type: 'swapCompare' }));
  // Import wizard.
  add('import/start', base);
  add('import/reading', reduce(base, { type: 'importReading', fileName: 'trades.csv' }));
  add('import/error-empty', reduce(base, { type: 'importFileRead', fileName: 'empty.csv', text: '', size: 0 }));
  add('import/error-big', reduce(base, { type: 'importFileRead', fileName: 'big.csv', text: '', size: 9e6 }));
  s = reduce(base, { type: 'importFileRead', fileName: 'messy.csv', text: MESSY_CSV, size: MESSY_CSV.length });
  add('import/mapping', s);
  add('import/mapping-missing', reduce(s, { type: 'setMapping', field: 'price', column: '' }));
  s = reduce(s, { type: 'validateImport' });
  add('import/preview', s);
  add('import/preview-excl-dups', reduce(s, { type: 'toggleExcludeDuplicates' }));
  const imported = reduce(s, { type: 'confirmImport' });
  add('import/imported-dataset', imported);
  add('import/imported-trades', reduce(imported, { type: 'navigate', view: 'trades' }));
  add('import/after-import-wizard', reduce(imported, { type: 'navigate', view: 'import' }));
  // A thin imported month.
  const thinCsv = 'id,ts,underlying,symbol,optType,strike,expiry,side,qty,price,charges,strategyId\nA1,2026-09-01T09:30:00+05:30,NIFTY,NIFTY X 25000 CE,CE,25000,2026-09-08,BUY,75,100,20,\nA2,2026-09-01T09:50:00+05:30,NIFTY,NIFTY X 25000 CE,CE,25000,2026-09-08,SELL,75,120,,\nA3,2026-09-02T09:30:00+05:30,NIFTY,NIFTY X 25100 CE,CE,25100,2026-09-08,BUY,75,100,20,';
  s = reduce(base, { type: 'importFileRead', fileName: 'thin.csv', text: thinCsv, size: thinCsv.length });
  s = reduce(reduce(s, { type: 'validateImport' }), { type: 'confirmImport' });
  add('import/thin-dataset', s);
  // Scenario lab.
  for (const id of ['normal', 'repeated', 'borderline', 'clean', 'missing']) add(`lab/${id}`, reduce(base, { type: 'setScenario', id }));
  add('lab/custom-gap-20', reduce(base, { type: 'setLabParam', key: 'reentryGap', value: '20' }));
  add('lab/custom-zero', reduce(reduce(base, { type: 'setLabParam', key: 'reentries', value: '0' }), { type: 'setLabParam', key: 'days', value: '5' }));
  add('lab/days-5-busy-6', reduce(reduce(base, { type: 'setLabParam', key: 'busyDays', value: '6' }), { type: 'setLabParam', key: 'days', value: '5' }));
  // Edge datasets: a fourth habit cut only by the reporting limit, and real overlaps between habits.
  const inject = (s0, id, name, fills) => reduce({ ...s0, imports: { ...s0.imports, [id]: { id, kind: 'import', name, fills, importSummary: { fileName: `${name}.csv`, total: fills.length, read: fills.length, accepted: fills.length, rejected: 0, excluded: 0, withWarnings: 0, suspectedDuplicates: [], duplicateIds: [], missingCharges: 0, assumedIst: 0, notes: [], rejectedRows: [] } } } }, { type: 'selectDataset', id });
  const limitCut = inject(base, 'edge-limit', 'edge-four-habits', fourHabitFills());
  const overlapH1 = inject(base, 'edge-overlap-h1', 'edge-overlap-reentry', [...runScenario({ reentries: 9, reentryLoss: 45, adds: 8 }).validation.fills, ...PERSONAS.meera.months['2026-09'].fills]);
  const overlapH5 = inject(base, 'edge-overlap-h5', 'edge-overlap-daily-limit', [...runScenario({ reentries: 12, reentryLoss: 45, adds: 6, busyDays: 6 }).validation.fills, ...PERSONAS.meera.months['2026-09'].fills]);
  for (const [name, s0] of [['edge/limit-cut', limitCut], ['edge/overlap-h1', overlapH1], ['edge/overlap-h5', overlapH5]]) {
    add(name, s0);
    for (const h of HABIT_IDS) add(`${name}/inspect-${h}`, reduce(s0, { type: 'inspectHabit', habitId: h }));
    add(`${name}/guard-edit`, reduce(s0, { type: 'openGuardrail', habitId: 'H5' }));
  }
  add('theme/dark', reduce(base, { type: 'setTheme', theme: 'dark' }));
  add('notice', reduce(base, { type: 'openGuardrail', habitId: 'H2' }));
  return out;
}

const ID_RE = /\sid="([^"]+)"/g;
const ACTION_RE = /data-action="([^"]+)"/g;
const VIEW_RE = /data-action="navigate"[^>]*data-view="([^"]+)"|data-view="([^"]+)"[^>]*data-action="navigate"/g;
const TEXT_LEAK_RE = />[^<]*\b(NaN|undefined|null|\[object Object\]|Infinity)\b[^<]*</;
const ATTR_LEAK_RE = /="(NaN|undefined|\[object Object\])"/;

export function checkHtml(html) {
  const problems = [];
  for (const [, a] of html.matchAll(ACTION_RE)) if (!ACTION_TYPES.has(a) && !EFFECT_TYPES.has(a)) problems.push(`unknown data-action "${a}"`);
  for (const m of html.matchAll(VIEW_RE)) { const v = m[1] ?? m[2]; if (!VIEWS.includes(v)) problems.push(`unknown data-view "${v}"`); }
  const ids = [...html.matchAll(ID_RE)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) problems.push(`duplicate id(s): ${[...new Set(dup)].join(', ')}`);
  const leak = html.match(TEXT_LEAK_RE);
  if (leak) problems.push(`leaked value in text: ${leak[0].slice(0, 120)}`);
  const aleak = html.match(ATTR_LEAK_RE);
  if (aleak) problems.push(`leaked value in attribute: ${aleak[0]}`);
  return problems;
}

// Render the full page (shell + chosen view + every overlay), as main.js does.
export function renderPage(state, viewName, mods) {
  const mod = mods[viewName];
  const overlays = Object.values(mods).map((m) => (typeof m.overlay === 'function' ? m.overlay(state) : '')).join('');
  return `${renderBanner(state)}${renderSidebar(state)}${renderTopbar(state)}${renderMobileNav(state)}<main>${mod.render(state)}</main>${overlays}${renderNotice(state)}`;
}

export async function runMatrix(views = VIEW_NAMES) {
  const { mods, errors } = await loadModules(VIEW_NAMES);
  const failures = [];
  let renders = 0;
  for (const v of views) {
    if (errors[v]) failures.push({ state: '(module load)', view: v, problem: `module failed to load: ${errors[v].message}` });
    else if (typeof mods[v].render !== 'function') failures.push({ state: '(module load)', view: v, problem: 'module does not export render(state)' });
  }
  const warnings = Object.entries(errors).filter(([n]) => !views.includes(n)).map(([n, e]) => `other module "${n}" failed to load (its overlay was skipped): ${e.message}`);
  for (const { name, state } of stateMatrix()) {
    for (const v of views.filter((x) => mods[x] && typeof mods[x].render === 'function')) {
      let html;
      try { html = renderPage({ ...state, view: v }, v, mods); } catch (e) { failures.push({ state: name, view: v, problem: `threw: ${e.stack?.split('\n').slice(0, 3).join(' | ')}` }); continue; }
      renders++;
      for (const p of checkHtml(html)) failures.push({ state: name, view: v, problem: p });
    }
  }
  return { renders, failures, warnings };
}
