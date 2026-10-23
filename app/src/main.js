// Browser entry point: renders views from state, turns DOM events into actions, and runs the few
// side effects (file reading, downloads, persistence, routing). All logic lives in store.js / engine.js.

import { initialState, reduce, persistable, ACTION_TYPES, EFFECT_TYPES, VIEWS, getDataset, selectLab } from './store.js';
import { toCsv, TEMPLATE_CSV, LIMITS } from './import.js';
import { PERSONAS } from './data.js';
import { renderBanner, renderSidebar, renderTopbar, renderMobileNav, renderNotice } from './views/shell.js';
import * as overview from './views/overview.js';
import * as habits from './views/habits.js';
import * as inspect from './views/inspect.js';
import * as trades from './views/trades.js';
import * as guardrails from './views/guardrails.js';
import * as compare from './views/compare.js';
import * as importView from './views/import.js';
import * as lab from './views/lab.js';
import * as method from './views/method.js';

export const VIEW_MODULES = { overview, habits, inspect, trades, guardrails, compare, import: importView, lab, method };

const STORAGE_KEY = 'habit-ledger:v2';
const root = document.getElementById('app');
const TITLES = { overview: 'Overview', habits: 'Habits', inspect: 'Evidence', trades: 'Trades', guardrails: 'Guardrails', compare: 'Compare', import: 'Import', lab: 'Scenario lab', method: 'Methodology' };

function loadPersisted() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function savePersisted(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable(state))); } catch { /* storage blocked: settings last for this visit */ }
}

let state = initialState(loadPersisted());
let lastView = null;
let returnFocus = null;
let noticeTimer = null;

// ---------- routing ----------

function hashFor(s) {
  return s.view === 'inspect' ? `#/inspect/${s.inspect.habitId}` : `#/${s.view}`;
}
function routeFromHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  // In-page section links on the Methodology page (#method-…) keep the Methodology view.
  if (/^method-[\w-]+$/.test(raw)) return { type: 'navigate', view: 'method', anchor: raw };
  const [view, habitId] = raw.split('/');
  return VIEWS.includes(view) ? { type: 'navigate', view, habitId } : null;
}
function scrollToAnchor(id) {
  const el = id && document.getElementById(id);
  if (el) el.scrollIntoView({ block: 'start' });
}

// ---------- rendering ----------

const visible = (el) => Boolean(el && el.getClientRects().length);
const usable = (el) => el && !el.disabled && el.getAttribute('aria-hidden') !== 'true' && visible(el);

function focusKey(el) {
  if (!el || el === document.body) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset?.action) {
    return Object.entries(el.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${CSS.escape(v)}"]`).join('');
  }
  return null;
}

// First visible match (the sidebar and the mobile tabs render the same buttons; only one is shown).
const findUsable = (scope, key) => [...scope.querySelectorAll(key)].find(usable) ?? null;

// Scroll containers whose position survives a re-render (keyed by id, else selector + index).
const SCROLLERS = '[data-overlay], .drawer-body, .dialog, .table-wrap, .lab-controls, .mobile-nav';
function saveScroll() {
  const out = new Map();
  root.querySelectorAll(SCROLLERS).forEach((el, i) => {
    if (el.scrollTop || el.scrollLeft) out.set(el.id || `${el.className}#${i}`, [el.scrollTop, el.scrollLeft]);
  });
  return out;
}
function restoreScroll(saved) {
  root.querySelectorAll(SCROLLERS).forEach((el, i) => {
    const pos = saved.get(el.id || `${el.className}#${i}`);
    if (pos) { el.scrollTop = pos[0]; el.scrollLeft = pos[1]; }
  });
}
// Bring a focused element into view if a re-render left it off-screen (inside its scroller or the page).
function reveal(el) {
  const r = el.getBoundingClientRect();
  const offPage = r.bottom < 0 || r.top > window.innerHeight;
  el.scrollIntoView({ block: offPage ? 'start' : 'nearest', inline: 'nearest' });
}

function render() {
  const active = document.activeElement;
  const key = focusKey(active);
  const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = saveScroll();
  const mod = VIEW_MODULES[state.view];
  const overlays = Object.values(VIEW_MODULES).map((m) => (typeof m.overlay === 'function' ? m.overlay(state) : '')).join('');
  const viewChanged = lastView !== state.view;
  // While a dialog or drawer is open, everything behind it is inert (no Tab, no clicks, no screen reader).
  const inert = overlays ? ' inert' : '';
  root.innerHTML = `<a class="skip-link" href="#main-content"${inert}>Skip to content</a><div class="shell"${inert}>${renderBanner(state)}${renderSidebar(state)}${renderTopbar(state)}${renderMobileNav(state)}<main class="main" id="main-content" tabindex="-1"><div class="content${viewChanged ? ' view-enter' : ''}">${mod.render(state)}</div></main></div>${overlays}${renderNotice(state)}`;
  document.documentElement.classList.toggle('has-overlay', Boolean(overlays));
  if (state.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = state.theme;
  document.title = `${TITLES[state.view]} · ${getDataset(state).name} · Habit Ledger`;
  if (!viewChanged) restoreScroll(scroll);

  const restore = (el) => {
    el.focus({ preventScroll: true });
    if (sel && typeof sel[0] === 'number' && 'setSelectionRange' in el) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ } }
    reveal(el);
  };
  const mainEl = root.querySelector('#main-content');
  const overlayEl = root.querySelector('[data-overlay]');
  if (overlayEl) {
    // Keep focus inside the dialog/drawer: the same control if it still exists, else its first target.
    const target = key && findUsable(overlayEl, key);
    if (target) restore(target);
    else if (!overlayEl.contains(document.activeElement)) (overlayEl.querySelector('[data-autofocus]') || overlayEl.querySelector('h2, button, select, input, [tabindex]'))?.focus();
  } else if (viewChanged && lastView !== null) {
    mainEl?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  } else if (returnFocus && findUsable(root, returnFocus)) {
    restore(findUsable(root, returnFocus));
  } else if (key) {
    // If the focused control vanished or became unusable, fall back to the view's own target, then <main>.
    const el = findUsable(root, key);
    if (el) restore(el);
    else (mainEl?.querySelector('[data-autofocus]') || mainEl)?.focus({ preventScroll: true });
  }
  if (!overlayEl) returnFocus = null;
  // Keep the current section visible in the horizontally scrolling mobile tab bar.
  root.querySelector('.mobile-nav [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  announce();
  lastView = state.view;
}

// One polite live region outside the re-rendered tree: notices first, else the view's result summary.
let lastAnnounced = '';
function announce() {
  const live = document.getElementById('live-region');
  // An open dialog/drawer's summary wins over the page behind it.
  const source = root.querySelector('[data-overlay] [data-announce]') ?? root.querySelector('[data-announce]');
  const text = (state.notice?.text ?? source?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (live && text && text !== lastAnnounced) live.textContent = text;
  lastAnnounced = text;
}

export function dispatch(action) {
  if (EFFECT_TYPES.has(action.type)) return runEffect(action);
  if (!ACTION_TYPES.has(action.type)) { console.warn(`Unknown action ${action.type}`); return; }
  // The reducer is pure; the save time of a guardrail is stamped here.
  if (action.type === 'saveGuardrail' && !action.at) action = { ...action, at: new Date().toISOString() };
  if (action.type === 'dismissNotice') clearTimeout(noticeTimer);
  const prev = state;
  state = reduce(state, action);
  if (state === prev) return;
  if (state.notice !== prev.notice && state.notice) {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => dispatch({ type: 'dismissNotice' }), 7000);
  }
  savePersisted(state);
  const h = hashFor(state);
  if (location.hash !== h) history.pushState(null, '', h);
  render();
}

// ---------- effects ----------

function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
const safeName = (s) => String(s).replace(/\.(csv|txt)$/i, '').replace(/[^\w.-]+/g, '_');
const csvRows = (rows) => ['row,file,reasons', ...rows.map((r) => `${r.line},"${String(r.file ?? '').replace(/"/g, '""')}","${r.messages.join('; ').replace(/"/g, '""')}"`)].join('\n');

async function runEffect(action) {
  switch (action.type) {
    case 'downloadTemplate': return download('habit-ledger-template.csv', TEMPLATE_CSV);
    case 'downloadSample': {
      const p = PERSONAS[action.id];
      if (p) download(`habit-ledger-sample-${p.id}.csv`, toCsv(p.fills));
      return undefined;
    }
    case 'downloadRejected': {
      // The button says which rows it downloads: the file being checked ('wizard') or the trader under review.
      const w = state.importWizard;
      if (action.source === 'wizard' && w.result) {
        const rows = w.result.rows.filter((r) => r.status === 'rejected').map((r) => ({ line: r.line, file: w.fileName, messages: r.messages.filter((m) => m.level === 'error').map((m) => m.text) }));
        return download(`rejected-rows-${safeName(w.fileName ?? 'file')}.csv`, csvRows(rows));
      }
      const ds = getDataset(state);
      return download(`rejected-rows-${safeName(ds.name)}.csv`, csvRows(ds.importSummary?.rejectedRows ?? []));
    }
    case 'downloadLabCsv': return download('habit-ledger-scenario.csv', selectLab(state).csv);
    case 'openLabInImporter': {
      // Hand the simulated file to the importer, exactly as if it had been chosen from disk.
      const csv = selectLab(state).csv;
      dispatch({ type: 'importFileRead', fileName: `scenario-${state.lab.scenario}.csv`, text: csv, size: csv.length });
      dispatch({ type: 'navigate', view: 'import' });
      return undefined;
    }
    default: return undefined;
  }
}

async function readImport(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > LIMITS.maxBytes) { dispatch({ type: 'importFileRead', fileName: file.name, size: file.size, text: '' }); return; }
  dispatch({ type: 'importReading', fileName: file.name });
  try {
    const text = await file.text();
    dispatch({ type: 'importFileRead', fileName: file.name, size: file.size, text });
  } catch {
    dispatch({ type: 'importFileError', message: `"${file.name}" could not be read. Check that it is a plain-text CSV file.` });
  }
}

// ---------- events ----------

function payload(el) {
  const { action, param, on, ...rest } = el.dataset;
  const out = { type: action, ...rest };
  if (el.matches('select, input, textarea')) out[param || 'value'] = el.type === 'checkbox' ? el.checked : el.value;
  return out;
}

const OPENERS = new Set(['selectTrade', 'openGuardrail']);

document.addEventListener('click', (e) => {
  // Skip link: move focus to the content without changing the route hash.
  const skip = e.target.closest('.skip-link');
  if (skip) { e.preventDefault(); document.getElementById('main-content')?.focus(); return; }
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el) || el.matches('select, input, textarea') || el.disabled) return;
  if (el.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
  if (el.dataset.overlayClose !== undefined && e.target !== el) return;
  e.preventDefault();
  if (OPENERS.has(el.dataset.action)) returnFocus = focusKey(el);
  dispatch(payload(el));
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.matches?.('[data-action]')) return;
  if (el.type === 'file') { readImport(el); return; }
  // Range sliders commit on change (end of drag / each key press); other live fields already dispatched on input.
  if (el.dataset.on === 'input' && el.type !== 'checkbox' && el.type !== 'range') return;
  dispatch(payload(el));
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.matches?.('[data-action][data-on="input"]')) return;
  if (el.type === 'range') {
    // Re-rendering mid-drag would destroy the slider under the pointer, so only update its value label here.
    document.querySelectorAll(`[data-range-for="${CSS.escape(el.id)}"]`).forEach((out) => {
      out.textContent = `${el.value}${out.dataset.unit ? ` ${out.dataset.unit}` : ''}`;
    });
    return;
  }
  dispatch(payload(el));
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Close the innermost thing first: an open definition popover, then a dialog/drawer, then the notice.
  const openDef = document.querySelector('details.def[open]');
  if (openDef) { openDef.open = false; openDef.querySelector('summary')?.focus(); return; }
  if (state.guardEdit) dispatch({ type: 'closeGuardEdit' });
  else if (state.selectedTradeId) dispatch({ type: 'closeTrade' });
  else if (state.notice) dispatch({ type: 'dismissNotice' });
});

// Close any open definition popover when clicking elsewhere.
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.def[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
}, true);

// Keep definition popovers inside the viewport: open to the left when there is no room on the right.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.matches?.('details.def') || !d.open) return;
  const body = d.querySelector('.def-body');
  if (!body) return;
  body.classList.remove('def-flip');
  if (body.getBoundingClientRect().right > document.documentElement.clientWidth - 8) body.classList.add('def-flip');
}, true);

window.addEventListener('popstate', () => {
  const r = routeFromHash();
  if (!r) { history.replaceState(null, '', hashFor(state)); return; }
  if (r.anchor && state.view === 'method') { scrollToAnchor(r.anchor); return; }
  state = reduce(state, r);
  render();
  if (r.anchor) scrollToAnchor(r.anchor);
});

const initial = routeFromHash();
if (initial) state = reduce(state, initial);
else history.replaceState(null, '', hashFor(state));
render();
if (initial?.anchor) scrollToAnchor(initial.anchor);
