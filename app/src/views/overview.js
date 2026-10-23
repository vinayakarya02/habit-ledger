// Overview: the monthly review landing page. Answers, in order: what happened in the period, which
// behaviours passed the evidence bar, which comes first, what changed since the previous period,
// and the one next step. Every figure comes from store selectors / the engine.

import {
  getDataset, selectAnalysis, selectQuality, selectNextAction, selectPrevPeriod, selectNextPeriod, selectComparison,
} from '../store.js';
import { CONFIG, HABITS } from '../engine.js';
import {
  esc, money, amount, pct, missing, button, linkTo, chip, habitStatusChip, verdictChip, confidenceChip, def, stat, panel,
  emptyState, pageHeader, sr,
} from '../ui/components.js';
import { dailyPnlChart } from '../ui/charts.js';
import { formatINR, formatDate, plural, isNum } from '../format.js';

// ---------- small helpers ----------

const kebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

// An action object from a selector ({ type, habitId, view, ... }) as button props.
function actionProps(action) {
  const { type, ...rest } = action;
  const data = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) data[kebab(k)] = v;
  return { action: type, data };
}

const ARROW = '<span aria-hidden="true" class="ov-arrow">→</span><span class="sr-only"> to </span>';
const slot = (cls, html) => (html ? `<div class="ov-slot ${cls}">${html}</div>` : '');
const NO_TRADES = 'No closed trades in this period';

// Some selector and engine copy says "1 trades"; show it in correct English.
const tidy = (t) => String(t ?? '').replace(/\b1 (closed )?trades\b/g, '1 $1trade');

// A money amount inside prose, kept on one line so its sign never wraps away from the number.
const inr = (n, opts) => `<span class="num">${esc(formatINR(n, opts))}</span>`;

// The rupee figure formatINR shows (it rounds half away from zero), for checking that parts add up.
const shownRupees = (n) => Math.sign(n) * Math.round(Math.abs(n));

// ---------- page header ----------

// The period summary, as HTML. It is also the view's announced result summary (data-announce).
function leadHtml(a) {
  const s = a.stats;
  if (!s.trades) return 'No closed trades in this period, so there is nothing to review yet.';
  const charges = s.noChargesRecorded ? 'with no charges recorded' : 'after recorded charges';
  const base = `${esc(plural(s.trades, 'closed trade'))} over ${esc(plural(s.tradingDays, 'trading day'))}, net ${inr(s.netPnl, { sign: true })} ${charges}`;
  if (a.summary.thin) return `${base}; too few trades to judge habits (${CONFIG.minUnits}+ needed).`;
  const k = a.confirmed.length;
  return `${base}; ${k ? `${esc(plural(k, 'habit'))} passed the evidence bar` : 'no habit passed the evidence bar'}.`;
}

function header(a, ds) {
  const source = ds.kind === 'import' ? 'Imported file' : 'Sample trader (synthetic)';
  const period = a.summary.periodLabel ?? 'No review period';
  return pageHeader({ eyebrow: `${esc(ds.name)} · ${source} · ${esc(period)}`, title: 'Monthly review', lead: `<span data-announce>${leadHtml(a)}</span>` });
}

// ---------- key statistics ----------

function statsSection(a) {
  const s = a.stats;
  const none = !s.trades;
  const left = a.summary.excluded.length;
  const largest = isNum(s.largestLoss) ? a.units.find((u) => u.netPnl === s.largestLoss) : null;
  const noCharges = s.noChargesRecorded;
  const tiles = [
    stat({
      label: 'Net realised P&L',
      value: none ? missing(NO_TRADES) : money(s.netPnl),
      sub: none ? '' : noCharges
        ? 'No charges recorded on any order, so net equals gross'
        : `${money(s.grossPnl, { tone: false })} gross before ${amount(s.charges)} of recorded charges`,
      definition: 'Sum of the net P&L of closed trades opened in this period, after recorded charges. Positions still open at the end of the data are not included.',
    }),
    stat({
      label: 'Closed trades',
      value: `<span class="num">${s.trades}</span>`,
      sub: `over ${plural(s.tradingDays, 'trading day')}${left ? ` · ${plural(left, 'position')} left out` : ''}`,
      definition: 'A trade is one position, or one multi-leg strategy, opened in this period and fully closed. Positions still open at the end of the data (or missing their closing order), or that flipped direction in one order, are left out.',
    }),
    stat({
      label: 'Win rate',
      value: pct(s.winRate),
      sub: none ? '' : `${s.wins} of ${plural(s.trades, 'trade')}${s.flat ? ` · ${s.flat} flat` : ''}`,
      definition: 'Trades with net P&L above ₹0 after recorded charges, divided by closed trades.',
    }),
    stat({
      label: 'Average winning trade',
      value: isNum(s.avgWin) ? money(s.avgWin) : missing('No winning trades in this period'),
      sub: s.wins ? `across ${plural(s.wins, 'winning trade')}` : 'No winning trades',
      definition: 'Total net P&L of winning trades divided by the number of winning trades.',
    }),
    stat({
      label: 'Average losing trade',
      value: isNum(s.avgLoss) ? money(s.avgLoss) : missing('No losing trades in this period'),
      sub: s.losses ? `across ${plural(s.losses, 'losing trade')}` : 'No losing trades',
      definition: 'Total net P&L of losing trades divided by the number of losing trades.',
    }),
    stat({
      label: 'Largest loss',
      value: isNum(s.largestLoss) ? money(s.largestLoss) : missing('No losing trades in this period'),
      sub: largest
        ? `<button type="button" class="link" data-action="selectTrade" data-id="${esc(largest.id)}" aria-label="${esc(`Open trade ${largest.label}, ${formatDate(largest.day, { year: false })}, in Trades`)}">${esc(largest.label)}</button> · ${esc(formatDate(largest.day, { year: false }))}`
        : 'No losing trades',
      definition: 'The single closed trade with the lowest net P&L after recorded charges. Select it to open the trade.',
    }),
    stat({
      label: 'Charges recorded',
      value: none ? missing(NO_TRADES) : noCharges ? missing('No charges recorded on any order in this period') : amount(s.charges),
      sub: none ? '' : noCharges
        ? (s.orders === 1 ? 'Not recorded on the only order' : `Not recorded on any of the ${s.orders} orders`)
        : s.tradesMissingCharges ? `Missing on ${s.tradesMissingCharges} of ${plural(s.trades, 'trade')}` : 'Recorded on every order',
      definition: 'Charges exactly as recorded on each order, summed over closed trades in this period. An order with no charge recorded is reported as missing, not as ₹0, and that trade’s net P&L excludes it.',
    }),
  ];
  return `<section class="ov-stats-wrap" aria-labelledby="overview-stats-h"><h2 class="sr-only" id="overview-stats-h">Period statistics</h2><div class="ov-stats">${tiles.join('')}</div></section>`;
}

// ---------- habits that passed the evidence bar ----------

// What a confirmed habit's excess loss is measured against. Only 'usual' is a comparison with the
// trader's usual trade; the ₹0 bases apply when that usual trade was not a loss (the baseline is capped
// at ₹0) or there were too few comparison trades; hedge removal is measured beyond the spread's own max loss.
function basisOf(h) {
  const c = h.costing;
  if (c.model === 'beyond-max-loss') return 'max-loss';
  if (c.thin) return 'zero-thin';
  if (c.baseline < 0) return 'usual';
  return c.comparisonMean > 0 ? 'zero-made' : 'zero-even';
}

// Order of the breakdown: clauses with a "because" go last so the list reads cleanly.
const BASIS_ORDER = ['max-loss', 'usual', 'zero-made', 'zero-even', 'zero-thin'];
const BASIS_PHRASE = {
  'max-loss': 'beyond spreads’ defined maximum loss',
  usual: 'compared with your usual trade',
  'zero-made': 'vs breaking even, because your usual trade made money',
  'zero-even': 'vs breaking even, because your usual trade broke even',
  'zero-thin': 'vs breaking even, because there were too few comparison trades',
};
const BASIS_ALONE = {
  'max-loss': 'Measured beyond each spread’s defined maximum loss at entry, not against your usual trade.',
  usual: '',
  'zero-made': 'Measured vs breaking even (₹0), because your usual trade made money.',
  'zero-even': 'Measured vs breaking even (₹0), because your usual trade broke even.',
  'zero-thin': 'Measured vs breaking even (₹0), because there were too few comparison trades.',
};

// The short basis line under each habit's figure (HTML).
function costBasis(h) {
  switch (basisOf(h)) {
    case 'max-loss': return 'beyond each spread’s defined maximum loss';
    case 'usual': return `vs your usual trade (${inr(h.costing.baseline)})`;
    case 'zero-thin': return 'vs breaking even (₹0): too few comparison trades';
    case 'zero-made': return 'vs breaking even (₹0): your usual trade made money';
    default: return 'vs breaking even (₹0): your usual trade broke even';
  }
}

function costDefinition(h) {
  const c = h.costing;
  const d = HABITS[h.id];
  if (c.model === 'beyond-max-loss') {
    return `Sum, over the ${plural(h.occurrences, 'counted spread')}, of any loss beyond the spread’s own defined maximum loss at entry, before charges. Downside only.`;
  }
  const comparison = d.comparison.charAt(0).toLowerCase() + d.comparison.slice(1);
  const basis = c.thin
    ? `taken as ₹0 because there were fewer than ${CONFIG.thinBaseline} comparison trades`
    : c.baseline < 0
      ? `the average net P&L of ${comparison}: ${formatINR(c.baseline)} across ${plural(c.comparisonN, 'trade')}`
      : `taken as ₹0 because ${comparison} averaged ${formatINR(c.comparisonMean, { sign: true })}`;
  return `Sum, over the ${plural(h.occurrences, 'counted trade')}, of how much more each lost than your usual trade. Usual trade: ${basis}.`;
}

function guardChip(rule) {
  if (!rule) return chip('No guardrail yet', 'muted');
  return rule.status === 'active' ? chip('Guardrail active', 'ok') : chip('Guardrail paused', 'neutral');
}

function habitItem(h, i, saved, a) {
  const d = HABITS[h.id];
  const rule = saved[h.id] ?? null;
  // Rank uses the behaviour's excess loss on all its matching trades (before shared trades move to a
  // higher-ranked habit); the figure shown is after that move. Say both when they differ.
  const sa = a.standalone[h.id];
  const overlap = h.overlap
    ? `<p class="ov-habit-note">${h.overlap} of its ${plural(sa.occurrences, 'matching trade')} ${h.overlap === 1 ? 'is' : 'are'} counted under “${esc(h.overlapWith.join('”, “'))}” instead, so ${h.overlap === 1 ? 'it is' : 'they are'} not in this figure. Its rank uses all ${sa.occurrences} (${esc(formatINR(sa.cost))} of excess loss).</p>`
    : '';
  return `<li class="ov-habit">
    <span class="ov-rank${i === 0 ? ' is-first' : ''}" aria-hidden="true">${i + 1}</span>
    <h3 class="ov-habit-name">${sr(`Rank ${i + 1}: `)}${esc(h.name)}</h3>
    <div class="ov-habit-cost">
      <span class="ov-cost-label">Excess loss${def('Excess loss', costDefinition(h))}</span>
      <span class="ov-cost-value">${amount(h.cost)}</span>
      <span class="ov-cost-basis">${costBasis(h)}</span>
    </div>
    <div class="ov-habit-meta">
      <p class="ov-habit-facts"><span class="num">${h.occurrences} of ${h.opportunities}</span> ${esc(d.chances)} (${pct(h.rate)}) · on ${plural(h.gates.days, 'day')}</p>
      <div class="chip-row">${confidenceChip(h.gates.confidence)}${guardChip(rule)}</div>
      ${overlap}
    </div>
    <div class="ov-habit-actions btn-row">
      ${button('Inspect evidence', { action: 'inspectHabit', data: { 'habit-id': h.id }, size: 'sm', id: `overview-inspect-${h.id}` })}
      ${button(rule ? 'Edit guardrail' : 'Set guardrail', { action: 'openGuardrail', data: { 'habit-id': h.id }, size: 'sm', variant: 'ghost', id: `overview-guard-${h.id}` })}
    </div>
  </li>`;
}

// Clean state: one sentence on what the check found. The near misses are listed in their own panel,
// so they are not repeated here.
function cleanSentence(a) {
  const total = a.checked.length;
  const near = a.nearMisses.length;
  const seen = a.checked.filter((c) => c.status !== 'not-seen').length;
  if (near) return `All ${total} behaviours were checked; ${near === 1 ? 'the one that came close is' : `the ${near} that came close are`} listed under Near misses below.`;
  if (!seen) return `All ${total} behaviours were checked, and none was seen in this period.`;
  return `All ${total} behaviours were checked; ${seen === 1 ? 'the one that was seen was' : `none of the ${seen} that were seen was`} associated with excess loss.`;
}

// Headline, basis breakdown, rounding note and footer for the confirmed habits.
function headlineParts(a) {
  const k = a.confirmed.length;
  const groups = new Map();
  for (const h of a.confirmed) {
    const b = basisOf(h);
    groups.set(b, (groups.get(b) ?? 0) + h.cost);
  }
  const bases = BASIS_ORDER.filter((b) => groups.has(b));
  const allUsual = bases.length === 1 && bases[0] === 'usual';
  const figure = `${amount(a.headlineCost)} of excess loss <span class="ov-qual">(not a share of your net P&amp;L)</span>`;
  const headline = allUsual
    ? `Compared with your usual trade, ${esc(plural(k, 'habit'))} ${k === 1 ? 'is' : 'are'} associated with ${figure}.`
    : `${esc(plural(k, 'habit'))} ${k === 1 ? 'is' : 'are'} associated with ${figure}.`;
  let breakdown = '';
  if (!allUsual) {
    breakdown = bases.length === 1
      ? esc(BASIS_ALONE[bases[0]])
      : `How it is measured: ${bases.map((b) => `${amount(groups.get(b))} ${esc(BASIS_PHRASE[b])}`).join('; ')}.`;
  }
  // Each figure is rounded to the rupee on its own, so the shown parts can miss the shown total.
  const total = shownRupees(a.headlineCost);
  const gap = (parts) => Math.abs(parts.reduce((s, x) => s + shownRupees(x), 0) - total);
  const diff = k > 1 ? Math.max(gap(a.confirmed.map((h) => h.cost)), bases.length > 1 ? gap(bases.map((b) => groups.get(b))) : 0) : 0;
  const rounding = diff ? `Figures are rounded to the rupee, so the parts can differ from the total by ${inr(diff)}.` : '';
  const foot = allUsual
    ? 'Excess loss is measured against your usual trade, not against ₹0, so it is a different figure from net P&amp;L.'
    : 'Excess loss is measured against each habit’s own comparison point, shown with each figure, so it is a different figure from net P&amp;L.';
  return { headline, breakdown, rounding, foot };
}

function habitsPanel(state, a) {
  const saved = state.guardrails[state.datasetId] ?? {};
  const k = a.confirmed.length;
  const title = 'Habits that passed the evidence bar';
  const actions = linkTo('All behaviours', 'habits');
  let body;
  if (!a.summary.units) {
    body = emptyState({ title: 'Nothing to review yet', body: 'There are no closed trades in this period, so no behaviour could be checked.', action: linkTo('Import a CSV', 'import') });
  } else if (a.summary.thin) {
    body = emptyState({
      title: 'Too few trades to judge habits',
      body: `This period has ${plural(a.summary.units, 'closed trade')}. A behaviour is only called a habit when the period has at least ${CONFIG.minUnits} closed trades, so nothing is ranked here.`,
      action: linkTo('See what was checked', 'habits'),
    });
  } else if (!k) {
    body = emptyState({
      title: 'No habit passed the evidence bar',
      body: esc(cleanSentence(a)),
      action: linkTo('See what was checked', 'habits'),
    });
  } else {
    const { headline, breakdown, rounding, foot } = headlineParts(a);
    body = `<p class="ov-headline">${headline}</p>${breakdown ? `<p class="ov-headline-note">${breakdown}</p>` : ''}
      <ol class="ov-habits">${a.confirmed.map((h, i) => habitItem(h, i, saved, a)).join('')}</ol>
      ${rounding ? `<p class="ov-round-note">${rounding}</p>` : ''}
      <p class="ov-foot">This is an association, not proof that the behaviour caused the loss. ${foot}</p>`;
  }
  return panel({
    title,
    subtitle: k ? 'Ranked by each behaviour’s excess loss across all its matching trades. A trade shared by two habits is then counted under the higher-ranked one only.' : '',
    actions,
    body,
  });
}

// ---------- daily chart ----------

function chartPanel(a) {
  const marked = a.confirmed.length > 0;
  // With no confirmed habit there are never any dots, so the chart drops that legend entry.
  const chart = dailyPnlChart(a.stats.daily, { habitLegend: marked });
  const charges = a.stats.noChargesRecorded ? ' (no charges recorded)' : ', after recorded charges';
  return panel({
    title: 'Daily net P&amp;L',
    subtitle: marked
      ? `One bar per trading day${charges}. Dots mark days with trades counted toward a confirmed habit.`
      : `One bar per trading day${charges}. No habit was confirmed this period, so no days are marked.`,
    body: chart || emptyState({ title: 'No trading days to show', body: 'There are no closed trades in this period.' }),
  });
}

// ---------- near misses ----------

// One plain sentence or two per near miss. Counts come from the detector (a.standalone), which is how
// often the behaviour was seen; nearMisses[].occurrences for an overlap is what is left after de-duplication.
function nearText(a, n) {
  const seen = n.seen ?? a.standalone[n.id]?.occurrences ?? n.occurrences;
  const reason = tidy(n.reason);
  // The engine's reasons for overlaps and limit cuts already give the shared count and the re-check result.
  return /\bSeen \d+ times?\b/.test(reason) && n.status !== 'overlap' ? reason : `Seen ${plural(seen, 'time')}. ${reason}`.trim();
}

function nearPanel(a) {
  if (!a.nearMisses.length) return '';
  // habitStatusChip labels a behaviour left out only by the reporting limit as such, not as an overlap.
  const items = a.nearMisses.map((n) => `<li><div class="ov-row-head"><strong>${esc(n.name)}</strong>${habitStatusChip(n, CONFIG.maxHabits)}</div><p class="ov-why">${esc(nearText(a, n))}</p></li>`).join('');
  return panel({
    title: 'Near misses',
    subtitle: 'Seen, but not ranked as a habit this period. Not included in the excess-loss total.',
    actions: linkTo('See in Habits', 'habits'),
    body: `<ul class="ov-list">${items}</ul>`,
  });
}

// ---------- side column: next step, data quality, change ----------

// The selector's body text, made exact where it can overstate: the guardrail step can point at a habit
// that is not rank 1, and the thin-period text is not pluralised.
function nextBody(n, a) {
  if (n.kind === 'guardrail') {
    const h = a.habits[n.action.habitId];
    if (h?.rank) {
      const k = a.confirmed.length;
      return h.rank === 1
        ? `It is your top-ranked habit${k > 1 ? ` of ${k}` : ''}, associated with ${formatINR(h.cost)} of excess loss this period.`
        : `It is the highest-ranked habit without a guardrail (rank ${h.rank} of ${k}), associated with ${formatINR(h.cost)} of excess loss this period.`;
    }
  }
  if (n.kind === 'thin') return `This period has ${plural(a.summary.units, 'closed trade')}; habits need ${CONFIG.minUnits}+.`;
  return tidy(n.body);
}

function nextPanel(state, a) {
  const n = selectNextAction(state);
  const props = actionProps(n.action);
  const body = nextBody(n, a);
  return panel({
    title: 'Next step',
    tone: 'accent',
    body: `<h3 class="ov-next-title">${esc(n.title)}</h3>${body ? `<p class="ov-next-body">${esc(body)}</p>` : ''}${button(n.label, { ...props, variant: 'primary', id: 'overview-next-action' })}`,
  });
}

const QUALITY = { good: ['Good', 'ok'], attention: ['Needs attention', 'warn'], insufficient: ['Insufficient', 'danger'] };

function qualityPanel(state) {
  const q = selectQuality(state);
  const [label, tone] = QUALITY[q.status] ?? [q.status, 'neutral'];
  const imp = q.importSummary;
  let source;
  if (q.source === 'import' && imp) {
    const parts = [`${plural(imp.accepted, 'order')} imported`];
    // Rejected rows are already the first item in the list below; only repeat here if that item is absent.
    if (imp.rejected && !q.items.some((i) => i.code === 'rejected')) parts.push(`${plural(imp.rejected, 'row')} rejected`);
    if (imp.excluded) parts.push(`${plural(imp.excluded, 'suspected duplicate')} left out`);
    if (imp.skippedExisting) parts.push(`${plural(imp.skippedExisting, 'order')} already in this trader skipped`);
    source = `<strong>Imported file · this tab only</strong><span class="ov-src-detail">${esc(imp.fileName ?? 'Imported file')}: ${esc(parts.join(', '))}. Read in this browser tab, never uploaded.</span>`;
  } else {
    source = '<strong>Sample trader · synthetic</strong><span class="ov-src-detail">Simulated orders, not a real account. Not connected to Nubra or any broker.</span>';
  }
  const notes = imp?.notes?.length ? imp.notes : [];
  const items = [...q.items.map((i) => tidy(i.text)), ...notes];
  const list = items.length
    ? `<ul class="ov-quality-items">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '<p class="ov-why">No gaps found: every position in this period closed, every order has charges recorded and every lot size is known.</p>';
  const dl = imp?.rejected ? `<div class="btn-row ov-quality-actions">${button('Download rejected rows', { action: 'downloadRejected', data: { source: 'dataset' }, size: 'sm', id: 'overview-dl-rejected' })}</div>` : '';
  return panel({
    title: 'Data quality',
    actions: `<span class="ov-quality-status">${sr('Status: ')}${chip(label, tone)}</span>`,
    body: `<p class="ov-src">${source}</p>${list}${dl}`,
  });
}

function shortWhy(r) {
  // The rates are shown just above the explanation, so drop the part that only restates them.
  const e = tidy(r.explanation);
  let m = e.match(/^The rate (?:fell|rose) from \S+ to \S+ of [^.]+\.\s+([\s\S]+)$/);
  if (m) return m[1];
  m = e.match(/^The rate moved from \S+ to \S+, which is ([\s\S]+)$/);
  if (m) return `The change is ${m[1]}`;
  return e.replace(/^The rate moved from \S+ to \S+, but (\S)/, (_, c) => c.toUpperCase());
}

function changeRow(r) {
  return `<li>
    <div class="ov-row-head"><strong>${esc(r.name)}</strong>${verdictChip(r.verdict, r.strength)}</div>
    <p class="ov-change-rates">${pct(r.before.rate)}${ARROW}${pct(r.after.rate)}</p>
    <p class="ov-change-counts"><span class="num">${r.before.n} of ${r.before.opp}</span>${ARROW}<span class="num">${r.after.n} of ${r.after.opp}</span> ${esc(r.chances)}</p>
    <p class="ov-why">${esc(shortWhy(r))}</p>
  </li>`;
}

function changePanel(state, a) {
  const prev = selectPrevPeriod(state);
  if (!prev) {
    const next = selectNextPeriod(state);
    const label = a.summary.periodLabel;
    const matches = next && state.compare.from === state.periodKey && state.compare.to === next.key;
    // Compare periods keeps its own pair; when it does not include this period, say where the button leads.
    const pair = next && !matches ? selectComparison(state) : null;
    const pairNote = pair ? `<p class="ov-why">Compare periods is currently set to ${esc(pair.fromLabel)} → ${esc(pair.toLabel)}; choose ${esc(label)} there to compare it.</p>` : '';
    const body = `<p class="ov-why">${label ? `${esc(label)} is the earliest period in this data` : 'There is no review period in this data'}, so there is nothing earlier to compare with.</p>${
      next ? `<p class="ov-why">${esc(next.label)} is also in the data.</p>${pairNote}${button(matches ? `Compare with ${next.label}` : 'Open Compare periods', { action: 'navigate', data: { view: 'compare' }, size: 'sm', id: 'overview-compare-next' })}` : ''}`;
    return panel({ title: 'Change since last period', body });
  }
  const c = selectComparison(state, prev.key, state.periodKey);
  // Only habits confirmed in either period are tracked here; the rest are on Compare periods.
  const rows = c.rows.filter((r) => r.tracked);
  const list = rows.length
    ? `<ul class="ov-list">${rows.map(changeRow).join('')}</ul>`
    : `<p class="ov-why">No behaviour was confirmed as a habit in ${esc(prev.label)} or ${esc(a.summary.periodLabel)}, so there is no habit to track here.</p>`;
  // The Compare view uses its own period pair; say so when it differs from this one.
  const sameAsCompare = state.compare.from === prev.key && state.compare.to === state.periodKey;
  const current = sameAsCompare ? null : selectComparison(state);
  const note = current ? `<span class="ov-src-detail">Compare periods is currently set to ${esc(current.fromLabel)} → ${esc(current.toLabel)}.</span>` : '';
  return panel({
    title: `Change since ${esc(prev.label)}`,
    subtitle: rows.length
      ? 'Habits confirmed in either period. Rates are per chance, so trading less on its own does not count as improving. They count every matching trade before de-duplication (a trade shared with another habit counts for both), so they can differ from the ranked list’s counts.'
      : '',
    body: `${list}<p class="ov-foot">${linkTo(sameAsCompare ? 'Open full comparison' : 'Open Compare periods', 'compare')}${note}</p>`,
  });
}

// ---------- render ----------

export function render(state) {
  const a = selectAnalysis(state);
  const ds = getDataset(state);
  const main = [
    slot('ov-o-stats', statsSection(a)),
    slot('ov-o-habits', habitsPanel(state, a)),
    slot('ov-o-chart', chartPanel(a)),
    slot('ov-o-near', nearPanel(a)),
  ].join('');
  const side = [
    slot('ov-o-quality', qualityPanel(state)),
    slot('ov-o-change', changePanel(state, a)),
  ].join('');
  // DOM order is the reading and focus order: next step, then the review, then quality and change.
  // On wide screens the grid places the next step and the side panels in the right-hand column.
  return `${header(a, ds)}<div class="grid grid-main-side ov-layout">${slot('ov-o-next', nextPanel(state, a))}<div class="ov-main">${main}</div><div class="ov-side">${side}</div></div>`;
}
