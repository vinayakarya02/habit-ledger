// App chrome: data banner, sidebar navigation, top bar (dataset, period, theme), mobile tabs.

import { esc } from '../ui/components.js';
import { getDataset, listDatasets, selectAnalysis, selectPeriods } from '../store.js';
import { VERSION } from '../version.js';
import { plural } from '../format.js';

// Views where the review-period picker does not apply get a short note instead.
const PERIOD_NOTES = {
  compare: 'Compare uses the From and To months chosen on the page.',
  lab: 'The scenario lab simulates its own month; the review period does not apply.',
  import: 'Importing does not depend on the review period.',
  method: 'Methodology applies to every period.',
};

export const NAV = [
  { group: 'Review', items: [
    { view: 'overview', label: 'Overview' },
    { view: 'habits', label: 'Habits' },
    { view: 'inspect', label: 'Evidence inspector' },
    { view: 'trades', label: 'Trades' },
  ] },
  { group: 'Act', items: [
    { view: 'guardrails', label: 'Guardrails' },
    { view: 'compare', label: 'Compare periods' },
  ] },
  { group: 'Data', items: [
    { view: 'import', label: 'Import CSV' },
    { view: 'lab', label: 'Scenario lab' },
  ] },
  { group: 'About', items: [
    { view: 'method', label: 'Methodology' },
  ] },
];

function counts(state) {
  const a = selectAnalysis(state);
  const active = Object.values(state.guardrails[state.datasetId] ?? {}).filter((r) => r.status === 'active').length;
  return { habits: a.confirmed.length, trades: a.summary.units, guardrails: active };
}

function navItems(state, c) {
  return NAV.map((g) => `<div class="nav-group">${esc(g.group)}</div>${g.items.map((it) => navButton(state, it, c)).join('')}`).join('');
}

function navButton(state, it, c) {
  const count = c[it.view];
  return `<button type="button" class="nav-item" data-action="navigate" data-view="${it.view}"${state.view === it.view ? ' aria-current="page"' : ''}><span>${esc(it.label)}</span>${count !== undefined ? `<span class="nav-count" aria-label="${count}">${count}</span>` : ''}</button>`;
}

export function renderBanner(state) {
  const ds = getDataset(state);
  return ds.kind === 'import'
    ? `<div class="data-banner is-import" role="note">Your imported file "${esc(ds.name)}" · read in this browser tab only, never uploaded · not investment advice</div>`
    : '<div class="data-banner" role="note">Sample trader with synthetic trades · not connected to Nubra or any broker · not investment advice</div>';
}

export function renderSidebar(state) {
  const c = counts(state);
  return `<aside class="sidebar" aria-label="Sections">
    <button type="button" class="brand" data-action="navigate" data-view="overview" aria-label="Habit Ledger overview"><span class="brand-mark" aria-hidden="true">HL</span><span class="brand-name">Habit Ledger<span class="brand-sub">Post-trade behaviour review</span></span></button>
    <nav class="nav" aria-label="Main">${navItems(state, c)}</nav>
    <div class="sidebar-foot">Reviews closed trades only. No live market data, no orders placed.<br><span class="muted">Build ${esc(VERSION.commit)}${VERSION.builtAt ? ` · ${esc(VERSION.builtAt.slice(0, 10))}` : ''}</span></div>
  </aside>`;
}

export function renderTopbar(state) {
  const datasets = listDatasets(state);
  const samples = datasets.filter((d) => d.kind === 'sample');
  const imports = datasets.filter((d) => d.kind === 'import');
  const opt = (d) => `<option value="${esc(d.id)}"${d.id === state.datasetId ? ' selected' : ''}>${esc(d.name)}${d.kind === 'sample' ? ` · ${esc(d.style.split(',')[0])}` : ''}</option>`;
  const periods = selectPeriods(state);
  const periodOpts = periods.length
    ? periods.map((p) => `<option value="${esc(p.key)}"${p.key === state.periodKey ? ' selected' : ''}>${esc(p.label)} · ${esc(plural(p.trades, 'trade'))}</option>`).join('')
    : '<option value="">No periods</option>';
  return `<header class="topbar">
    <button type="button" class="brand" data-action="navigate" data-view="overview" aria-label="Habit Ledger overview"><span class="brand-mark" aria-hidden="true">HL</span><span class="brand-name">Habit Ledger</span></button>
    <div class="context">
      <label class="field" for="dataset-select"><span class="field-label">Trader</span><select id="dataset-select" data-action="selectDataset" data-param="id"><optgroup label="Sample traders (synthetic)">${samples.map(opt).join('')}</optgroup>${imports.length ? `<optgroup label="Your imports (this tab only)">${imports.map(opt).join('')}</optgroup>` : ''}</select></label>
      ${PERIOD_NOTES[state.view]
    ? `<p class="topbar-note">${PERIOD_NOTES[state.view]}</p>`
    : `<label class="field" for="period-select"><span class="field-label">Review period</span><select id="period-select" data-action="selectPeriod" data-param="key"${periods.length ? '' : ' disabled'}>${periodOpts}</select></label>`}
    </div>
    <span class="spacer"></span>
    <label class="field" for="theme-select"><span class="field-label">Theme</span><select id="theme-select" data-action="setTheme" data-param="theme"><option value="system"${state.theme === 'system' ? ' selected' : ''}>System</option><option value="light"${state.theme === 'light' ? ' selected' : ''}>Light</option><option value="dark"${state.theme === 'dark' ? ' selected' : ''}>Dark</option></select></label>
  </header>`;
}

export function renderMobileNav(state) {
  const c = counts(state);
  return `<nav class="mobile-nav" aria-label="Sections">${NAV.flatMap((g) => g.items).map((it) => navButton(state, it, c)).join('')}</nav>`;
}

export function renderNotice(state) {
  if (!state.notice) return '';
  return `<div class="notice" role="status"><span>${esc(state.notice.text)}</span><button type="button" class="btn btn-sm" data-action="dismissNotice" aria-label="Dismiss message">Dismiss</button></div>`;
}
