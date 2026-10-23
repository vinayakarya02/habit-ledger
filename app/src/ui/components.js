// Shared UI building blocks. Each returns an HTML string. Interactive elements use data-action
// (an action type handled by store.js) plus data-* payload attributes; no inline handlers.

import { formatINR, formatPct, MISSING, isNum } from '../format.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const attrs = (data = {}) => Object.entries(data)
  .filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => (v === true ? ` data-${k}` : ` data-${k}="${esc(v)}"`)).join('');

// Money with sign-aware tone. Missing values render as an em dash with an explanation.
export function money(n, { sign = true, tone = true, decimals = 0 } = {}) {
  if (!isNum(n)) return missing();
  const cls = tone ? (n > 0.5 ? ' pos' : n < -0.5 ? ' neg' : '') : '';
  return `<span class="num${cls}">${esc(formatINR(n, { sign, decimals }))}</span>`;
}

export const amount = (n, opts = {}) => money(n, { sign: false, tone: false, ...opts });
export const pct = (x, opts) => (isNum(x) ? `<span class="num">${esc(formatPct(x, opts))}</span>` : missing());
export const missing = (why = 'Not in the data') => `<span class="missing" title="${esc(why)}" aria-label="${esc(why)}">${MISSING}</span>`;

// ariaDisabled keeps the button focusable (so keyboard focus is not lost) but marks it unavailable;
// main.js ignores clicks on it.
export function button(label, { action, data = {}, variant = 'secondary', size, disabled = false, ariaDisabled = false, ariaLabel, id, type = 'button', icon } = {}) {
  const cls = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', ariaDisabled ? 'is-unavailable' : ''].filter(Boolean).join(' ');
  return `<button type="${type}" class="${cls}"${id ? ` id="${esc(id)}"` : ''}${action ? ` data-action="${esc(action)}"` : ''}${attrs(data)}${disabled ? ' disabled' : ''}${ariaDisabled ? ' aria-disabled="true"' : ''}${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ''}>${icon ? `<span class="btn-icon" aria-hidden="true">${icon}</span>` : ''}${esc(label)}</button>`;
}

// Navigation link styled as text; uses the navigate action so the router stays the single source.
export const linkTo = (label, view, data = {}) => `<button type="button" class="link" data-action="navigate" data-view="${esc(view)}"${attrs(data)}>${esc(label)}</button>`;

export function chip(text, tone = 'neutral', { title } = {}) {
  return `<span class="chip chip-${tone}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
}

const STATUS_CHIP = {
  confirmed: ['Confirmed habit', 'danger'],
  overlap: ['Overlaps a confirmed habit', 'warn'],
  insufficient: ['Not enough evidence', 'warn'],
  'not-costly': ['Seen, no excess loss', 'neutral'],
  'not-seen': ['Not seen', 'neutral'],
};
export function statusChip(status) {
  const [t, tone] = STATUS_CHIP[status] ?? [status, 'neutral'];
  return chip(t, tone);
}

// Status chip for an engine habit object: a behaviour that passed every gate but was left out only by the
// reporting limit is labelled as such, not as an overlap.
export function habitStatusChip(habit, maxHabits = 3) {
  if (habit?.status === 'overlap' && habit.limitCut) return chip(`Passed · over the ${maxHabits}-habit limit`, 'warn');
  return statusChip(habit?.status);
}

const VERDICT_TONE = { Improving: 'ok', Worsening: 'danger', 'No clear change': 'neutral', Inconclusive: 'muted', 'Not seen': 'muted', 'Not applicable': 'muted' };
// Directional verdicts backed only by "suggestive" evidence (chance between 1 in 20 and 1 in 5) read as
// "Possibly improving / worsening" so they are not mistaken for a clear result.
const tentative = (v, strength) => strength === 'suggestive' && (v === 'Improving' || v === 'Worsening');
export const verdictLabel = (v, strength) => (tentative(v, strength) ? `Possibly ${v.toLowerCase()}` : v);
export const verdictChip = (v, strength) => chip(verdictLabel(v, strength), tentative(v, strength) ? 'neutral' : VERDICT_TONE[v] ?? 'neutral');

export const confidenceChip = (c) => (c ? chip(`${c} evidence`, c === 'Strong' ? 'accent' : 'warn') : '');

// A definition popover that works with keyboard and touch (native <details>).
export function def(term, text) {
  return `<details class="def"><summary aria-label="What is ${esc(term)}?"><span aria-hidden="true">?</span></summary><div class="def-body" role="note"><strong>${esc(term)}</strong><p>${esc(text)}</p></div></details>`;
}

export function stat({ label, value, sub = '', definition = '', tone = '' }) {
  return `<div class="stat${tone ? ` stat-${tone}` : ''}"><div class="stat-label">${esc(label)}${definition ? def(label, definition) : ''}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

export function panel({ title = '', subtitle = '', actions = '', body = '', id, tone = '', headingLevel = 2 }) {
  const h = `h${headingLevel}`;
  const head = title || actions ? `<header class="panel-head"><div>${title ? `<${h} class="panel-title">${title}</${h}>` : ''}${subtitle ? `<p class="panel-sub">${subtitle}</p>` : ''}</div>${actions ? `<div class="panel-actions">${actions}</div>` : ''}</header>` : '';
  return `<section class="panel${tone ? ` panel-${tone}` : ''}"${id ? ` id="${esc(id)}"` : ''}>${head}<div class="panel-body">${body}</div></section>`;
}

export function callout({ tone = 'info', title = '', body = '' }) {
  return `<div class="callout callout-${tone}" role="${tone === 'danger' ? 'alert' : 'note'}">${title ? `<strong class="callout-title">${title}</strong>` : ''}${body ? `<div class="callout-body">${body}</div>` : ''}</div>`;
}

export function emptyState({ title, body = '', action = '' }) {
  return `<div class="empty"><p class="empty-title">${esc(title)}</p>${body ? `<p class="empty-body">${body}</p>` : ''}${action}</div>`;
}

export function pageHeader({ eyebrow = '', title, lead = '', actions = '' }) {
  return `<header class="page-head"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

// Labeled <select>. options: [{value, label, disabled}]
export function select({ id, label, value, options, action, data = {}, hideLabel = false, describedBy, error = '', hint = '' }) {
  const opts = options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${esc(o.label)}</option>`).join('');
  const described = [describedBy, hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ');
  return `<label class="field${hideLabel ? ' field-hidden-label' : ''}${error ? ' has-error' : ''}" for="${esc(id)}"><span class="field-label">${esc(label)}</span><select id="${esc(id)}" data-action="${esc(action)}"${attrs(data)}${described ? ` aria-describedby="${esc(described)}"` : ''}${error ? ' aria-invalid="true"' : ''}>${opts}</select>${hint ? `<span class="field-hint" id="${esc(id)}-hint">${esc(hint)}</span>` : ''}${error ? `<span class="field-error" id="${esc(id)}-err">${esc(error)}</span>` : ''}</label>`;
}

export function input({ id, label, value = '', type = 'text', action, data = {}, live = false, placeholder = '', min, max, step, error = '', hint = '', hideLabel = false }) {
  const err = error ? `<span class="field-error" id="${esc(id)}-err">${esc(error)}</span>` : '';
  const hintHtml = hint ? `<span class="field-hint" id="${esc(id)}-hint">${esc(hint)}</span>` : '';
  const described = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ');
  return `<label class="field${hideLabel ? ' field-hidden-label' : ''}${error ? ' has-error' : ''}" for="${esc(id)}"><span class="field-label">${esc(label)}</span><input id="${esc(id)}" type="${type}" value="${esc(value)}" data-action="${esc(action)}"${attrs(data)}${live ? ' data-on="input"' : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${min !== undefined ? ` min="${min}"` : ''}${max !== undefined ? ` max="${max}"` : ''}${step !== undefined ? ` step="${step}"` : ''}${error ? ' aria-invalid="true"' : ''}${described ? ` aria-describedby="${described}"` : ''}>${hintHtml}${err}</label>`;
}

// Segmented control (radio-like buttons). options: [{value, label}]
export function segmented({ label, value, options, action, data = {}, id }) {
  return `<div class="segmented" role="group" aria-label="${esc(label)}"${id ? ` id="${esc(id)}"` : ''}>${options.map((o) => `<button type="button" class="seg${String(o.value) === String(value) ? ' is-active' : ''}" aria-pressed="${String(o.value) === String(value)}" data-action="${esc(action)}"${attrs({ ...data, value: o.value })}>${esc(o.label)}</button>`).join('')}</div>`;
}

// Table with optional sortable headers. columns: [{key, label, align, sortable, width}]
// rows: array of arrays of cell HTML. sort: {key, dir, action}
export function table({ columns, rows, caption = '', sort = null, rowAttrs = () => '', empty = 'Nothing to show.', id }) {
  const head = columns.map((c) => {
    const align = c.align === 'right' ? ' class="r"' : '';
    if (sort && c.sortable) {
      const active = sort.key === c.key;
      const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th scope="col"${align} aria-sort="${ariaSort}"><button type="button" class="th-sort${active ? ' is-active' : ''}" data-action="${esc(sort.action)}" data-key="${esc(c.key)}">${esc(c.label)}<span class="sort-ind" aria-hidden="true">${active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>`;
    }
    return `<th scope="col"${align}>${esc(c.label)}</th>`;
  }).join('');
  const body = rows.length
    ? rows.map((r, i) => `<tr${rowAttrs(i)}>${r.map((cell, j) => `<td${columns[j]?.align === 'right' ? ' class="r"' : ''}>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" class="table-empty">${esc(empty)}</td></tr>`;
  return `<div class="table-wrap"${id ? ` id="${esc(id)}"` : ''}><table>${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// Evidence-gate checklist (G1–G4) from an engine gates object.
export function gateList(gates, { compact = false } = {}) {
  return `<ul class="gates${compact ? ' gates-compact' : ''}">${gates.checks.map((g) => `<li class="${g.pass ? 'pass' : 'fail'}"><span class="gate-mark" aria-hidden="true">${g.pass ? '✓' : '✕'}</span><span class="sr-only">${g.pass ? 'Passed' : 'Failed'}:</span> <strong>${esc(g.name)}</strong>${compact ? '' : ` <span class="gate-detail">${esc(gateDetail(g))}</span>`}</li>`).join('')}</ul>`;
}

export function gateDetail(g) {
  switch (g.id) {
    case 'G1': return `${g.value} occurrence${g.value === 1 ? '' : 's'} (needs ${g.threshold}+)`;
    case 'G2': return `${g.value} different day${g.value === 1 ? '' : 's'} (needs ${g.threshold}+)`;
    case 'G3': return `${formatINR(Math.max(g.value, 0))} excess loss (needs ${formatINR(g.threshold)}+)`;
    case 'G4': return `${formatINR(Math.max(g.value, 0))} without the costliest trade (needs ${formatINR(g.threshold)}+)`;
    default: return '';
  }
}

// Progress meter for a 0..1 share (accessible).
export function meter(x, { label, tone = 'accent' } = {}) {
  if (!isNum(x)) return missing();
  const w = Math.max(0, Math.min(1, x)) * 100;
  return `<span class="meter meter-${tone}" role="img" aria-label="${esc(label ?? formatPct(x))}"><span style="width:${w.toFixed(1)}%"></span></span>`;
}

export const sr = (t) => `<span class="sr-only">${esc(t)}</span>`;
