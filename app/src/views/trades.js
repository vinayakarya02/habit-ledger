// Trade explorer: every closed trade in the period, with search, filters, sort, paging, and a
// detail drawer (legs, fills, charges, behaviour labels). Pure functions of state; every figure
// comes from selectTrades / the engine analysis.

import { selectTrades, tradeLabels, selectQuality, getDataset, PAGE_SIZE } from '../store.js';
import { HABITS, HABIT_IDS, CONFIG } from '../engine.js';
import { formatINR, formatPrice, formatDate, formatDay, formatTime, formatDuration, formatLots, plural, isNum } from '../format.js';
import { esc, money, amount, missing, button, chip, pageHeader, panel, callout, emptyState, select, input, table, sr } from '../ui/components.js';

const TYPE_LABEL = { 'long-option': 'Option buy', 'short-option': 'Option sell', strategy: 'Multi-leg strategy' };
const TYPE_ORDER = ['long-option', 'short-option', 'strategy'];
const OPT_LABEL = { CE: 'Call (CE)', PE: 'Put (PE)' };
const NOT_IN_FILE = 'Not in the file';

const typeLabel = (t) => TYPE_LABEL[t] ?? t;
const inr = (n, opts) => `<span class="num">${esc(formatINR(n, opts))}</span>`;
const legCount = (u) => u.positions.length;
const fillsOf = (u) => u.positions.flatMap((p) => p.fills).sort((x, y) => x.ts.localeCompare(y.ts) || String(x.id).localeCompare(String(y.id)));
const chargesMissingNote = (n) => `${plural(n, 'order')} had no charges in the file`;

// ---------- behaviour labels ----------

function labelChip(l) {
  const def = HABITS[l.habitId];
  if (l.role === 'counted') return chip(def.short, 'danger', { title: `Counted toward the confirmed habit "${def.name}"` });
  if (l.role === 'overlap') {
    const under = HABITS[l.countedUnder]?.short ?? 'another habit';
    // A confirmed habit's figures are de-duplicated (the trade is not in them); any other behaviour's
    // figures are its own, before de-duplication, so the trade is still in them.
    const title = l.habitStatus === 'confirmed'
      ? 'Each trade counts toward one habit only, so it adds nothing to this one'
      : "Counted under the other habit for the headline; still in this behaviour's own figures (before de-duplication)";
    return chip(`${def.short} (counted under ${under})`, 'warn', { title });
  }
  return chip(`${def.short} · not a habit`, 'neutral', { title: 'Flagged by the review, but not called a habit this period' });
}

function labelChips(labels) {
  if (!labels.length) return '<span class="muted">None</span>';
  return `<div class="chip-row">${labels.map(labelChip).join('')}</div>`;
}

// ---------- filters ----------

// A button that would disable itself on click (Reset, Previous, Next at the ends) would drop keyboard
// focus to <body>, so while unavailable it is aria-disabled and stays focusable. Its action is then
// "stay on the current page", which changes nothing on screen (and never resets the sort).
function softButton(label, enabled, opts, page) {
  if (enabled) return button(label, opts);
  return button(label, { ...opts, action: 'setTradePage', data: { page } }).replace('<button ', '<button aria-disabled="true" ');
}

// Dates are picked from the days that have trades in the period. A native date input re-renders on
// every keystroke that forms a valid date (Chromium), which breaks typing; a select cannot.
function dayOptions(days, value, isOut) {
  const list = value && !days.includes(value) ? [...days, value].sort() : days;
  return [{ value: '', label: 'Any day' }, ...list.map((d) => ({ value: d, label: formatDay(d), disabled: d !== value && isOut(d) }))];
}

function filterBar(t, f) {
  const days = [...new Set(t.analysis.units.map((u) => u.day))].sort();
  const types = TYPE_ORDER.filter((x) => t.types.includes(x)).concat(t.types.filter((x) => !TYPE_ORDER.includes(x)));
  const filter = (key) => ({ action: 'setTradeFilter', data: { key } });
  return `<div class="trades-filters" role="search" aria-label="Filter trades">
    <div class="filter-bar trades-filters-row trades-filters-primary">
      ${input({ id: 'trades-q', label: 'Search', type: 'search', value: f.q, placeholder: 'Symbol, underlying or strategy', live: true, ...filter('q') })}
      ${select({ id: 'trades-from', label: 'Opened from', value: f.from, options: dayOptions(days, f.from, (d) => Boolean(f.to) && d > f.to), ...filter('from') })}
      ${select({ id: 'trades-to', label: 'Opened to', value: f.to, options: dayOptions(days, f.to, (d) => Boolean(f.from) && d < f.from), ...filter('to') })}
    </div>
    <div class="filter-bar trades-filters-row">
      ${select({ id: 'trades-underlying', label: 'Underlying', value: f.underlying, options: [{ value: 'all', label: 'All underlyings' }, ...t.underlyings.map((u) => ({ value: u, label: u }))], ...filter('underlying') })}
      ${select({ id: 'trades-type', label: 'Type', value: f.type, options: [{ value: 'all', label: 'All types' }, ...types.map((x) => ({ value: x, label: typeLabel(x) }))], ...filter('type') })}
      ${select({ id: 'trades-outcome', label: 'Outcome', value: f.outcome, options: [{ value: 'all', label: 'All outcomes' }, { value: 'win', label: 'Win' }, { value: 'loss', label: 'Loss' }, { value: 'flat', label: 'Flat' }], ...filter('outcome') })}
      ${select({ id: 'trades-habit', label: 'Behaviour', value: f.habit, options: [{ value: 'all', label: 'All trades' }, { value: 'any', label: 'Any behaviour flag' }, { value: 'none', label: 'No behaviour flag' }, ...HABIT_IDS.map((id) => ({ value: id, label: HABITS[id].short }))], ...filter('habit') })}
      ${softButton('Reset filters', t.filtersActive, { action: 'resetTradeFilters', id: 'trades-reset' }, t.page)}
    </div>
  </div>`;
}

// ---------- table ----------

function tradeCell(u) {
  const sub = u.kind === 'strategy' ? `<span class="trades-sub">${esc(`${plural(legCount(u), 'leg')} · strategy ${u.strategyId}`)}</span>` : '';
  return `<span class="trades-label">${esc(u.label)}</span>${sub}`;
}

function pnlCell(u) {
  const flag = u.chargesMissing > 0
    ? `<span class="trades-sub" title="${esc(`${chargesMissingNote(u.chargesMissing)}; net P&L excludes them`)}">excl. some charges</span>`
    : '';
  return `${money(u.netPnl)}${flag}`;
}

function tradesTable(t, state) {
  const columns = [
    { key: 'open', label: 'Opened', sortable: true },
    { key: 'trade', label: 'Trade' },
    { key: 'type', label: 'Type' },
    { key: 'lots', label: 'Entry size', align: 'right', sortable: true },
    { key: 'hold', label: 'Held', align: 'right', sortable: true },
    { key: 'netPnl', label: 'Net P&L', align: 'right', sortable: true },
    { key: 'habits', label: 'Behaviour' },
    { key: 'details', label: '', align: 'right' },
  ];
  const selectedId = t.selected?.id ?? null;
  const rows = t.rows.map((u) => [
    `<span class="trades-when"><span>${esc(formatDay(u.day))}</span><span class="trades-sub num">${esc(u.time)}</span></span>`,
    tradeCell(u),
    `<span class="trades-type">${esc(typeLabel(u.type))}</span>`,
    `<span class="num">${esc(formatLots(u.entryLots))}</span>`,
    `<span class="num">${esc(formatDuration(u.holdMin))}</span>`,
    pnlCell(u),
    labelChips(tradeLabels(t.analysis, u.id)),
    button('Details', { action: 'selectTrade', data: { id: u.id }, size: 'sm', ariaLabel: `Details for ${u.label}, opened ${formatDay(u.day)} at ${u.time}` }),
  ]);
  const html = table({
    columns, rows,
    caption: `Closed trades, page ${t.page} of ${t.pages}`,
    sort: { key: state.trades.sort, dir: state.trades.dir, action: 'setTradeSort' },
    rowAttrs: (i) => (t.rows[i].id === selectedId ? ' class="is-selected"' : ''),
  });
  // The action column has no visible header; give it one for screen readers.
  return `<div class="trades-table">${html.replace('<th scope="col" class="r"></th>', `<th scope="col" class="r">${sr('Details')}</th>`)}</div>`;
}

function pager(t) {
  const start = (t.page - 1) * PAGE_SIZE + 1;
  const end = start + t.rows.length - 1;
  return `<nav class="pager trades-pager" aria-label="Trade pages">
    <span>Trades <span class="num">${start}–${end}</span> of <span class="num">${t.matched}</span></span>
    <div class="btn-row">
      ${softButton('Previous', t.page > 1, { action: 'setTradePage', data: { page: t.page - 1 }, size: 'sm', id: 'trades-prev', ariaLabel: 'Previous page of trades' }, t.page)}
      <span class="num trades-page-of">Page ${t.page} of ${t.pages}</span>
      ${softButton('Next', t.page < t.pages, { action: 'setTradePage', data: { page: t.page + 1 }, size: 'sm', id: 'trades-next', ariaLabel: 'Next page of trades' }, t.page)}
    </div>
  </nav>`;
}

function dataNotes(state, t) {
  const q = selectQuality(state);
  const items = q.items.filter((i) => i.code !== 'no-trades');
  if (!items.length) return '';
  const missingCharges = t.analysis.stats.tradesMissingCharges;
  const text = (i) => {
    if (i.code === 'charges') return `${i.text} ${missingCharges === 1 ? 'It is' : 'They are'} marked "excl. some charges" below.`;
    if (i.code === 'thin') return `Only ${plural(t.total, 'closed trade')} in this period. Habits need ${CONFIG.minUnits}+ trades in a period before anything is called a habit, so behaviour flags below are shown as "not a habit".`;
    if (i.code === 'excluded') return `${i.text} ${t.analysis.summary.excluded.length === 1 ? 'It is' : 'They are'} listed under "Left out of the review" below.`;
    return i.text;
  };
  return callout({
    tone: 'warn',
    title: 'Data notes for this period',
    body: `<ul class="trades-notes">${items.map((i) => `<li>${esc(text(i))}</li>`).join('')}</ul>`,
  });
}

// Positions the engine could not turn into a closed trade (still open, closing order missing, or
// flipped in one order). Collapsed by default; one row per position, earliest first.
const firstOrderTs = (x) => x.fills.map((f) => f.ts).filter((ts) => typeof ts === 'string' && ts).sort()[0] ?? null;
const leftOutReason = (r) => String(r ?? '').replace(/;\s*excluded\.?$/i, '.');

function leftOutPanel(a) {
  const xs = a.summary.excluded ?? [];
  if (!xs.length) return '';
  const sorted = [...xs].sort((x, y) => String(firstOrderTs(x) ?? '').localeCompare(String(firstOrderTs(y) ?? '')) || String(x.symbol).localeCompare(String(y.symbol)));
  const when = (ts) => (ts ? `<span class="num">${esc(`${formatDate(ts.slice(0, 10))}, ${formatTime(ts)}`)}</span>` : missing(NOT_IN_FILE));
  const rows = sorted.map((x) => [
    x.symbol ? `<span class="trades-label">${esc(x.symbol)}</span>` : missing(NOT_IN_FILE),
    `<span class="num">${x.fills.length}</span>`,
    when(firstOrderTs(x)),
    `<span class="trades-left-out-reason">${esc(leftOutReason(x.reason))}</span>`,
  ]);
  const n = xs.length;
  const list = table({
    columns: [{ label: 'Symbol' }, { label: 'Orders', align: 'right' }, { label: 'First order' }, { label: 'Why it is left out' }],
    rows,
    caption: `${plural(n, 'position')} left out of the review, earliest first`,
  });
  return `<details class="panel trades-left-out" id="trades-left-out">
    <summary class="trades-left-out-head"><span class="trades-left-out-title">Left out of the review (${esc(plural(n, 'position'))})</span><span class="panel-sub">Not in any figure in the review</span></summary>
    <div class="panel-body">
      <p class="trades-left-out-intro">A position becomes a trade only once the file shows it opened and then closed. ${n === 1 ? 'This position does' : 'These positions do'} not: still open at the end of the data, the closing order is missing (for example a row rejected at import), or one order flipped it from bought to sold (or back). ${n === 1 ? 'It is' : 'They are'} in no figure: not in the trade list, the P&amp;L, the behaviour checks, excess loss or guardrail breaks.</p>
      ${list}
    </div>
  </details>`;
}

const DASH = `<span aria-hidden="true">—</span>${sr('A dash')}`;
const legend = () => `<p class="trades-legend">${DASH} means the value is not in the file (it is not zero). Net P&amp;L is realised, after the charges recorded in the file. Times are IST, as recorded in the file.</p>`;

export function render(state) {
  const t = selectTrades(state);
  const a = t.analysis;
  const ds = getDataset(state);
  const period = a.summary.periodLabel ?? 'this data';
  const head = pageHeader({
    eyebrow: `${esc(ds.name)} · ${ds.kind === 'sample' ? 'Synthetic sample data' : 'Imported file, this browser tab only'}`,
    title: 'Trades',
    lead: `Every closed trade in ${esc(period)}. A trade is a position from open to flat; all legs sharing a strategy ID count as one trade.`,
  });

  if (!t.total) {
    const excluded = a.summary.excluded.length;
    return `${head}<div class="stack trades-view">${panel({
      body: emptyState({
        title: `No closed trades in ${period}`,
        body: esc(`${excluded ? `${plural(excluded, 'position')} ${excluded === 1 ? 'is' : 'are'} left out of the review (listed below). ` : ''}Trades appear here once a position is closed in the file.`),
        action: button('Go to import', { action: 'navigate', data: { view: 'import' }, variant: 'primary' }),
      }),
    })}${leftOutPanel(a)}</div>`;
  }

  // Net of zero matched trades is not a figure, so it is left out rather than shown as ₹0.
  // The result summary main.js announces (one polite live region) whenever it changes.
  const showing = `<span data-announce>Showing <strong class="num">${t.matched}</strong> of <span class="num">${t.total}</span> ${t.total === 1 ? 'trade' : 'trades'}${t.matched ? ` · net ${money(t.netOfMatched)}` : ''}</span>`;
  const results = t.matched
    ? `${tradesTable(t, state)}${t.pages > 1 ? pager(t) : ''}`
    : emptyState({
      title: 'No trades match these filters',
      body: esc(`None of the ${t.total} trades in ${period} match. Widen the dates, clear the search or reset the filters.`),
      action: button('Reset filters', { action: 'resetTradeFilters', id: 'trades-reset-empty' }),
    });

  return `${head}<div class="stack trades-view">
    ${dataNotes(state, t)}
    ${panel({ title: 'Closed trades', subtitle: showing, body: `${filterBar(t, state.trades)}${results}${legend()}` })}
    ${leftOutPanel(a)}
  </div>`;
}

// ---------- detail drawer ----------

function whenLine(u) {
  const closeDay = u.closeTs.slice(0, 10);
  const close = closeDay === u.day ? formatTime(u.closeTs) : `${formatDate(closeDay)}, ${formatTime(u.closeTs)}`;
  return `${formatDate(u.day)} · ${formatTime(u.openTs)} → ${close}`;
}

function pnlSummary(u) {
  const fills = fillsOf(u).length;
  const allMissing = u.chargesMissing > 0 && u.chargesMissing >= fills;
  // When every order lacks charges the value itself is the dash, so the note is plain text.
  const glyph = allMissing ? '' : `${missing(chargesMissingNote(u.chargesMissing))} `;
  const note = u.chargesMissing > 0 ? `<span class="trade-note">${glyph}${esc(chargesMissingNote(u.chargesMissing))}</span>` : '';
  const charges = allMissing ? missing(chargesMissingNote(u.chargesMissing)) : amount(u.charges, { decimals: 2 });
  return `<dl class="kv trade-kv">
    <dt>Gross P&amp;L</dt><dd>${money(u.grossPnl, { decimals: 2 })}<span class="trade-note">Sales minus purchases, before charges</span></dd>
    <dt>Charges recorded</dt><dd>${charges}${note}</dd>
    <dt>Net P&amp;L</dt><dd><strong>${money(u.netPnl, { decimals: 2 })}</strong>${u.chargesMissing > 0 ? '<span class="trade-note">Excludes the charges that are not in the file</span>' : ''}</dd>
  </dl>`;
}

// One column per leg (position), one row per field: reads well in a narrow drawer for 1–4 legs.
// Hand-built (rather than table()) so each field is a proper row header.
function legsTable(u) {
  const fields = [
    ['Symbol', (p) => `<span class="trade-symbol">${esc(p.symbol)}</span>`],
    ['Direction', (p) => esc(p.direction === 'short' ? 'Sold first' : 'Bought first')],
    ['Option', (p) => (p.optType ? esc(OPT_LABEL[p.optType] ?? p.optType) : missing(NOT_IN_FILE))],
    ['Strike', (p) => (isNum(p.strike) ? `<span class="num">${esc(p.strike.toLocaleString('en-IN'))}</span>` : missing(NOT_IN_FILE))],
    ['Expiry', (p) => (p.expiry ? `<span class="num">${esc(formatDate(p.expiry))}</span>` : missing('Expiry not in the file'))],
    ['Entry lots', (p) => `<span class="num">${esc(formatLots(p.entryLots))}</span>`],
    ['Avg entry price', (p) => (isNum(p.avgEntry) ? `<span class="num">${esc(formatPrice(p.avgEntry))}</span>` : missing(NOT_IN_FILE))],
    ['Avg exit price', (p) => (isNum(p.avgExit) ? `<span class="num">${esc(formatPrice(p.avgExit))}</span>` : missing('No closing order in the file'))],
    ['Leg gross P&L', (p) => money(p.grossPnl, { decimals: 2 })],
  ];
  const ps = u.positions;
  const head = ps.length === 1 ? '<th scope="col">This leg</th>' : ps.map((p, i) => `<th scope="col">Leg ${i + 1}</th>`).join('');
  const body = fields.map(([label, cell]) => `<tr><th scope="row">${esc(label)}</th>${ps.map((p) => `<td>${cell(p)}</td>`).join('')}</tr>`).join('');
  const unknownLot = [...new Set(ps.filter((p) => !p.lotSizeKnown).map((p) => p.underlying))];
  const lotNote = unknownLot.length ? `<p class="trade-note">Lot size for ${esc(unknownLot.join(', '))} is not known, so 1 unit is counted as 1 lot.</p>` : '';
  return `<div class="table-wrap trade-legs"><table><caption class="sr-only">Legs of this trade, one column per leg</caption><thead><tr><td class="trade-legs-corner"></td>${head}</tr></thead><tbody>${body}</tbody></table></div>${lotNote}`;
}

function fillsTable(u) {
  const multiDay = u.closeTs.slice(0, 10) !== u.day;
  const columns = [{ label: 'Time' }, { label: 'Symbol' }, { label: 'Side' }, { label: 'Qty', align: 'right' }, { label: 'Price', align: 'right' }, { label: 'Charges', align: 'right' }];
  const rows = fillsOf(u).map((f) => [
    `<span class="num">${esc(multiDay ? `${formatDate(f.ts, { year: false })}, ${formatTime(f.ts)}` : formatTime(f.ts))}</span>`,
    esc(f.symbol),
    esc(f.side === 'BUY' ? 'Buy' : f.side === 'SELL' ? 'Sell' : f.side),
    isNum(f.qty) ? `<span class="num">${esc(f.qty.toLocaleString('en-IN'))}</span>` : missing(NOT_IN_FILE),
    isNum(f.price) ? `<span class="num">${esc(formatPrice(f.price))}</span>` : missing(NOT_IN_FILE),
    isNum(f.charges) ? amount(f.charges, { decimals: 2 }) : missing('No charges in the file for this order'),
  ]);
  return table({ columns, rows, caption: 'Orders (fills) in this trade, in time order' });
}

// The arithmetic sentences show figures to the paisa, like the P&L block above, and every difference
// is taken from the two figures exactly as displayed (rounded the same way formatINR rounds), so
// each sentence adds up on its own.
const paise = (n) => Math.round(n * 100);
const rs = (p, sign = false) => inr(p / 100, { decimals: 2, sign });

// How the trade enters a counted habit's associated excess loss, with the arithmetic.
function countedText(a, u, habitId) {
  const h = a.habits[habitId];
  const c = h.costing;
  const ev = h.evidence.find((e) => e.unitId === u.id);
  if (!ev) return '';
  if (c.model === 'beyond-max-loss') {
    if (!isNum(ev.maxLoss)) return '';
    const gross = paise(u.grossPnl);
    const max = paise(ev.maxLoss);
    const beyond = -gross - max;
    return beyond > 0
      ? `Its loss before charges, ${rs(-gross)}, went ${rs(beyond)} beyond the spread's defined maximum loss of ${rs(max)}. That ${rs(beyond)} is part of this habit's associated excess loss.`
      : `Its result before charges, ${rs(gross, true)}, stayed within the spread's defined maximum loss of ${rs(max)}, so it adds no excess loss to this habit.`;
  }
  const net = paise(u.netPnl);
  const base = paise(c.baseline);
  const diff = base - net; // > 0: below the baseline
  const comparable = c.comparisonN ? plural(c.comparisonN, 'comparable trade') : 'no comparable trades';
  let baseTxt;
  let why = '';
  if (c.thin) {
    baseTxt = 'breaking even';
    why = c.comparisonN
      ? ` This habit has only ${comparable} this period, fewer than the ${CONFIG.thinBaseline} needed for a stable average, so it is compared with breaking even.`
      : ' This habit has no comparable trades this period, so it is compared with breaking even.';
  } else if (c.comparisonMean > 0) {
    baseTxt = `the baseline of ${rs(base)}`;
    why = ` Your usual trade (${comparable}) averaged ${inr(c.comparisonMean, { sign: true })}, but the baseline is capped at ₹0 so only real losses count.`;
  } else {
    baseTxt = `the usual-trade baseline of ${rs(base, true)}, the average net P&amp;L of ${comparable}`;
  }
  const lead = `This trade's net P&amp;L of ${rs(net, true)}`;
  if (diff > 0) return `${lead} is ${rs(diff)} below ${baseTxt}.${why} That ${rs(diff)} is counted in this habit's associated excess loss.`;
  if (diff < 0) return `${lead} is ${rs(-diff)} above ${baseTxt}, which lowers this habit's associated excess loss by ${rs(-diff)}.${why}`;
  return `${lead} equals ${baseTxt}, so it adds no excess loss.${why}`;
}

function roleText(a, u, l) {
  if (l.role === 'counted') return `<p>${['Counted toward this confirmed habit.', countedText(a, u, l.habitId)].filter(Boolean).join(' ')}</p>`;
  const reason = a.habits[l.habitId].statusReason;
  if (l.role === 'overlap') {
    const under = HABITS[l.countedUnder]?.name ?? 'a higher-ranked habit';
    // Confirmed: its figures are de-duplicated, so this trade is not in them. Otherwise (overlap,
    // insufficient, not-costly) the behaviour's figures are its own, taken before de-duplication.
    if (l.habitStatus === 'confirmed') return `<p>Also matches this behaviour, but the trade is already counted under "${esc(under)}". Each trade counts toward one habit only, so it adds nothing here.</p>`;
    return `<p>Also matches this behaviour. The trade is counted under "${esc(under)}" for the headline, but it still appears in this behaviour's own figures (which are before de-duplication). This behaviour is not called a habit this period.${reason ? ` ${esc(reason)}` : ''}</p>`;
  }
  return `<p>The review flagged this trade, but this behaviour is not called a habit this period.${reason ? ` ${esc(reason)}` : ''}</p>`;
}

function behaviourSection(a, u) {
  const labels = tradeLabels(a, u.id);
  if (!labels.length) return `<p class="muted">None of the ${HABIT_IDS.length} behaviours the review checks was seen on this trade.</p>`;
  return `<ul class="trade-habits">${labels.map((l) => {
    const def = HABITS[l.habitId];
    return `<li class="trade-habit">
      <div class="trade-habit-head"><strong>${esc(def.name)}</strong>${labelChip(l)}</div>
      ${roleText(a, u, l)}
      <p class="trade-note">What was seen: ${esc(l.detail)}</p>
      ${button(`Inspect ${def.short} evidence`, { action: 'inspectHabit', data: { 'habit-id': l.habitId }, size: 'sm' })}
    </li>`;
  }).join('')}</ul>`;
}

export function overlay(state) {
  if (state.view !== 'trades') return '';
  const t = selectTrades(state);
  const u = t.selected;
  if (!u) return '';
  const a = t.analysis;
  const facts = [
    ['Held', esc(formatDuration(u.holdMin))],
    ['Type', esc(typeLabel(u.type))],
    ['Underlying', esc(u.underlying)],
    ...(u.kind === 'strategy' ? [['Strategy ID', esc(u.strategyId)], ['Legs', esc(String(legCount(u)))]] : []),
    ['Orders', `<span class="num">${fillsOf(u).length}</span>`],
    ['Entry size', `<span class="num">${esc(formatLots(u.entryLots))}</span>`],
  ];
  return `<div class="scrim" data-overlay-close data-action="closeTrade"></div>
  <aside class="drawer trade-drawer" data-overlay role="dialog" aria-modal="true" aria-labelledby="trades-drawer-title" aria-describedby="trades-drawer-when">
    <header class="drawer-head">
      <div class="trade-drawer-heading">
        <p class="eyebrow">Trade detail · ${esc(typeLabel(u.type))}</p>
        <h2 id="trades-drawer-title" tabindex="-1" data-autofocus>${esc(u.label)}</h2>
        <p class="trade-when num" id="trades-drawer-when">${esc(whenLine(u))}</p>
      </div>
    </header>
    <div class="drawer-body">
      <dl class="kv trade-kv">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      <section class="trade-section" aria-labelledby="trades-drawer-pnl"><h3 id="trades-drawer-pnl" class="trade-section-title">Realised P&amp;L</h3>${pnlSummary(u)}</section>
      <section class="trade-section" aria-labelledby="trades-drawer-legs"><h3 id="trades-drawer-legs" class="trade-section-title">${u.positions.length === 1 ? 'Leg' : `Legs (${u.positions.length})`}</h3>${legsTable(u)}</section>
      <section class="trade-section" aria-labelledby="trades-drawer-fills"><h3 id="trades-drawer-fills" class="trade-section-title">Orders</h3>${fillsTable(u)}</section>
      <section class="trade-section" aria-labelledby="trades-drawer-habits"><h3 id="trades-drawer-habits" class="trade-section-title">Behaviour</h3>${behaviourSection(a, u)}</section>
      <p class="trade-note">Prices come from the file. No market data is used. ${DASH} means the value is not in the file (it is not zero).</p>
    </div>
    <footer class="drawer-foot">${button('Close', { action: 'closeTrade' })}</footer>
  </aside>`;
}
