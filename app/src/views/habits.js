// Habits: every behaviour checked this period (H1–H5), how each was classified and why.
// Nothing is forced into a habit: a behaviour is a habit only when the engine confirmed it.

import {
  esc, money, amount, pct, missing, button, chip, habitStatusChip, confidenceChip, def, panel, callout,
  emptyState, pageHeader, select, segmented, gateList, linkTo,
} from '../ui/components.js';
import { getDataset, selectAnalysis, selectQuality } from '../store.js';
import { HABITS, HABIT_IDS, CONFIG, regate } from '../engine.js';
import { formatINR, formatDay, ordinal, plural, isNum } from '../format.js';

// At most this many habits are confirmed per period (engine de-duplication rule).
const MAX_CONFIRMED = CONFIG.maxHabits;
// Data-quality notes that change figures on this page (rejected rows, left-out positions, missing charges, lot sizes).
const NOTE_CODES = ['rejected', 'excluded', 'charges', 'lot-size'];

const STATUS_ORDER = ['confirmed', 'overlap', 'insufficient', 'not-costly', 'not-seen'];
const FILTERS = {
  all: { label: 'All', test: () => true },
  confirmed: { label: 'Confirmed', test: (s) => s === 'confirmed' },
  near: { label: 'Near misses', test: (s) => s === 'insufficient' || s === 'overlap' },
  other: { label: 'Not seen or no excess loss', test: (s) => s === 'not-seen' || s === 'not-costly' },
};
const SORTS = {
  rank: 'Classification',
  cost: 'Excess loss',
  rate: 'Rate per chance',
  occurrences: 'Occurrences',
};
const TONE = { confirmed: 'danger', overlap: 'warn', insufficient: 'warn' };
const EVIDENCE_PREVIEW = 3;

const positive = (x) => (isNum(x) ? Math.max(0, x) : 0);
const statusIdx = (h) => STATUS_ORDER.indexOf(h.status);
const idIdx = (h) => HABIT_IDS.indexOf(h.id);
const rateKey = (h) => (h.opportunities ? h.rate : -1);

const SORTERS = {
  rank: (x, y) => statusIdx(x) - statusIdx(y) || (x.rank ?? 99) - (y.rank ?? 99) || positive(y.cost) - positive(x.cost) || idIdx(x) - idIdx(y),
  cost: (x, y) => positive(y.cost) - positive(x.cost) || statusIdx(x) - statusIdx(y) || idIdx(x) - idIdx(y),
  rate: (x, y) => rateKey(y) - rateKey(x) || statusIdx(x) - statusIdx(y) || idIdx(x) - idIdx(y),
  occurrences: (x, y) => y.occurrences - x.occurrences || statusIdx(x) - statusIdx(y) || idIdx(x) - idIdx(y),
};

const currentFilter = (state) => {
  const f = state.habitsFilter ?? {};
  return { status: FILTERS[f.status] ? f.status : 'all', sort: SORTS[f.sort] ? f.sort : 'rank' };
};

// ---------- shared trades (each trade counts toward one habit only) ----------

// The engine's de-duplication result for confirmed and overlapping behaviours:
//  h.overlap / h.overlapWith: how many matching trades were taken out before it was judged (they were
//    already claimed by habits confirmed before it), and the names of those habits
//  h.recheck (overlap only): occurrences, cost and gates without those trades
//  h.limitCut (overlap only): the re-check passed every gate; only the CONFIG.maxHabits limit left it out
// An overlapping behaviour's own figures (occurrences, cost, gates, evidence) are before de-duplication.
const sharedCount = (h) => (h.status === 'confirmed' || h.status === 'overlap' ? h.overlap ?? 0 : 0);
const sharedWith = (h) => (sharedCount(h) ? h.overlapWith ?? [] : []);

// Where this behaviour's matching trades are counted, per trade (the engine's per-trade labels).
//  all:     its matching trades that are counted under a different (confirmed) habit
//  removed: the ones the engine took out before judging it (counted under a habit in h.overlapWith);
//           none for a behaviour that never passed the gates (its card keeps every matching trade)
//  later:   overlapping only: shared trades claimed by a habit confirmed after this one was checked,
//           so they stayed in the re-check
function sharing(h, a) {
  const all = [];
  for (const [unitId, labels] of Object.entries(a.labels)) {
    const mine = labels.find((l) => l.habitId === h.id);
    if (mine?.countedUnder && mine.countedUnder !== h.id) all.push({ unitId, under: mine.countedUnder });
  }
  const before = new Set(sharedWith(h));
  const removed = all.filter((x) => before.has(HABITS[x.under].name));
  const later = h.status === 'overlap' ? all.filter((x) => !before.has(HABITS[x.under].name)) : [];
  return { all, removed, later, underOf: new Map(all.map((x) => [x.unitId, x.under])) };
}

const quoted = (names) => names.map((n) => `“${esc(n)}”`).join(' and ');
const habitsUnder = (xs) => [...new Set(xs.map((x) => x.under))];
const namesOf = (xs) => quoted(habitsUnder(xs).map((id) => HABITS[id].name));
const them = (n) => (n === 1 ? 'it' : 'them');
const isAre = (n) => (n === 1 ? 'is' : 'are');
const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
// The engine's own wording for one chance and for several (H1: "trade(s) opened after a losing trade").
const chanceNoun = (id, n) => (n === 1 ? HABITS[id].chance : HABITS[id].chances);
// "18 trades are left, with ₹17,992 of excess loss" for an overlapping behaviour's re-check.
function recheckFacts(h) {
  const r = h.recheck;
  if (!r.occurrences) return 'no trades are left';
  return `${plural(r.occurrences, 'trade')} ${isAre(r.occurrences)} left, with ${r.cost > 0 ? `${esc(formatINR(r.cost))} of excess loss` : 'no excess loss'}`;
}
const guardrailOf = (state, id) => state.guardrails?.[state.datasetId]?.[id] ?? null;

// ---------- page pieces ----------

// What the headline total is measured against: hedge removal is costed beyond each spread's defined
// maximum loss (before charges), every other habit against your usual trade.
function headlineSentence(a) {
  const n = a.confirmed.length;
  const total = `<strong>${amount(a.headlineCost)}</strong>`;
  const beyond = a.confirmed.filter((h) => h.costing.model === 'beyond-max-loss').length;
  if (!beyond) return n === 1
    ? `It is associated with ${total} of excess loss compared with your usual trade.`
    : `Together they are associated with ${total} of excess loss compared with your usual trade, each trade counted once.`;
  if (n === 1) return `It is associated with ${total} of loss beyond each spread’s defined maximum loss, before charges.`;
  const others = n - beyond;
  return `Together they are associated with ${total} of excess loss, each trade counted once. For hedge removal that is loss beyond each spread’s defined maximum loss, before charges; for the ${others === 1 ? 'other habit' : `other ${others} habits`} it is compared with your usual trade.`;
}

function summaryLine(a) {
  const s = a.summary;
  if (!s.units) return '';
  const confirmed = a.confirmed.length;
  const short = HABIT_IDS.filter((id) => FILTERS.near.test(a.habits[id].status) && !a.habits[id].limitCut).length;
  const capped = HABIT_IDS.filter((id) => a.habits[id].status === 'overlap' && a.habits[id].limitCut).length;
  const parts = [`In ${esc(s.periodLabel ?? 'this period')}, <strong>${confirmed} of ${HABIT_IDS.length}</strong> behaviours ${confirmed === 1 ? 'is a confirmed habit' : 'are confirmed habits'}, from ${plural(s.units, 'trade')} on ${plural(s.tradingDays, 'trading day')}.`];
  if (confirmed) parts.push(headlineSentence(a));
  if (short) {
    const more = confirmed ? ' more' : '';
    parts.push(s.thin
      ? `${short}${more} ${short === 1 ? 'was' : 'were'} seen with excess loss, but no habit can be confirmed in a period this short.`
      : `${short}${more} ${short === 1 ? 'was' : 'were'} seen with excess loss but fell short of the evidence bar.`);
  }
  if (capped) parts.push(`${capped} more passed every gate but ${capped === 1 ? 'is' : 'are'} not confirmed, because at most ${MAX_CONFIRMED} habits are confirmed in a period.`);
  return `<p class="habits-summary">${parts.join(' ')}</p>`;
}

function thinCallout(a) {
  const s = a.summary;
  if (!s.thin) return '';
  const body = s.units
    ? `<p>This period has ${plural(s.units, 'closed trade')}. A behaviour can only be called a habit when the period has ${CONFIG.minUnits} or more trades, so nothing below is confirmed, even where every gate is passed. Treat what you see as patterns to watch.</p>`
    : '<p>There are no closed trades in this period, so no behaviour could be checked.</p>';
  return callout({
    tone: 'warn',
    title: `Too few trades to confirm a habit (${s.units} of ${CONFIG.minUnits} needed)`,
    body: `${body}<div class="btn-row">${button('Import more history', { action: 'navigate', data: { view: 'import' }, size: 'sm' })}</div>`,
  });
}

function dataNotes(state) {
  const items = selectQuality(state).items.filter((i) => NOTE_CODES.includes(i.code));
  if (!items.length) return '';
  return callout({ tone: 'info', title: 'Data notes that affect these figures', body: `<ul class="habits-notes">${items.map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul>` });
}

function controls(a, { status, sort }, shown, announce) {
  const counts = Object.fromEntries(Object.entries(FILTERS).map(([k, v]) => [k, HABIT_IDS.filter((id) => v.test(a.habits[id].status)).length]));
  const seg = segmented({
    id: 'habits-status', label: 'Show behaviours', value: status, action: 'setHabitsFilter', data: { key: 'status' },
    options: Object.entries(FILTERS).map(([k, v]) => ({ value: k, label: `${v.label} · ${counts[k]}` })),
  });
  const sel = select({
    id: 'habits-sort', label: 'Sort by', value: sort, action: 'setHabitsFilter', data: { key: 'sort' },
    options: Object.entries(SORTS).map(([value, label]) => ({ value, label })),
  });
  // main.js reads this result count into its single polite live region when it changes; while the guardrail
  // dialog is open over this page it carries the one announced summary instead, so the count is not marked.
  return `<div class="habits-controls"><div class="habits-filter"><span class="field-label" aria-hidden="true">Show</span>${seg}</div>${sel}</div>
    <p class="habits-count" id="habits-count"${announce ? ' data-announce' : ''}>Showing ${shown} of ${HABIT_IDS.length} behaviours</p>`;
}

function emptyFor(status, a) {
  const showAll = button('Show all five behaviours', { action: 'setHabitsFilter', data: { key: 'status', value: 'all' } });
  const copy = {
    confirmed: a.summary.thin
      ? ['No confirmed habits in this period', `This period has fewer than ${CONFIG.minUnits} trades, so no behaviour can be confirmed as a habit.`]
      : ['No confirmed habits in this period', 'None of the five behaviours passed all four evidence gates. That is a result in itself: nothing here is strong enough to call a habit.'],
    near: ['No near misses', 'No behaviour was seen with excess loss while falling short of the evidence bar.'],
    other: ['Every behaviour was seen with some excess loss', 'Each of the five behaviours occurred and was associated with excess loss this period. Their cards show how each was classified.'],
  }[status] ?? ['Nothing to show', ''];
  return emptyState({ title: copy[0], body: esc(copy[1]), action: showAll });
}

// ---------- card pieces ----------

function costNote(h) {
  const c = h.costing;
  if (c.model === 'beyond-max-loss') return 'beyond each spread’s defined maximum loss';
  if (c.thin) return 'vs ₹0: too few comparison trades';
  if (isNum(c.comparisonMean) && c.comparisonMean > 0) return 'vs ₹0: your other trades averaged a gain';
  return `vs your usual trade of ${esc(formatINR(c.baseline, { sign: true }))}`;
}

function baselineSentence(h) {
  const c = h.costing;
  const comp = HABITS[h.id].comparison.toLowerCase();
  if (c.thin) return `Only ${plural(c.comparisonN, 'comparison trade')} (${esc(comp)}), fewer than ${CONFIG.thinBaseline}, so the usual trade is taken as ₹0.`;
  if (isNum(c.comparisonMean) && c.comparisonMean > 0) return `Your ${plural(c.comparisonN, 'comparison trade')} (${esc(comp)}) averaged ${esc(formatINR(c.comparisonMean, { sign: true }))}. A gain is never used as the bar, so the usual trade is taken as ₹0.`;
  return `Usual trade = average net P&amp;L of your ${plural(c.comparisonN, 'comparison trade')} (${esc(comp)}).`;
}

function costArithmetic(h) {
  const n = h.evidence.length;
  const c = h.costing;
  const total = h.cost > 0 ? amount(h.cost, { decimals: 2 }) : '<span>No excess loss</span>';
  if (c.model === 'beyond-max-loss') {
    // One row per matched spread: its result before charges, its defined maximum loss, and the part beyond it.
    const rows = h.evidence.map((e) => {
      const result = e.grossPnl < 0 ? `lost ${esc(formatINR(-e.grossPnl, { decimals: 2 }))}` : e.grossPnl > 0 ? `gained ${esc(formatINR(e.grossPnl, { decimals: 2 }))}` : 'broke even';
      const max = isNum(e.maxLoss) ? esc(formatINR(e.maxLoss, { decimals: 2 })) : missing('Defined maximum loss not available');
      return `<div class="row habits-spread-row"><span>${esc(formatDay(e.day))} · ${esc(e.label)}: ${result} before charges; defined maximum loss ${max}</span>${amount(e.contribution, { decimals: 2 })}</div>`;
    }).join('');
    return `<div class="formula">
      ${rows}
      <div class="row total"><span>Loss beyond the defined maximum, summed over ${plural(n, 'spread')}</span>${total}</div>
      <p class="habits-formula-note">Each row is the loss before charges minus the spread’s defined maximum loss at entry. A spread that stayed within its defined maximum counts ₹0.</p></div>`;
  }
  const sumNet = h.evidence.reduce((s, e) => s + e.netPnl, 0);
  return `<div class="formula">
      <div class="row"><span>${n} × your usual trade (${esc(formatINR(c.baseline, { sign: true, decimals: 2 }))})</span>${money(n * c.baseline, { decimals: 2 })}</div>
      <div class="row"><span>Net P&amp;L of ${n === 1 ? 'this trade' : `these ${n} trades`}</span>${money(sumNet, { decimals: 2 })}</div>
      <div class="row total"><span>Excess loss (usual minus actual)</span>${total}</div>
      <p class="habits-formula-note">${baselineSentence(h)}</p></div>`;
}

function metrics(h, a) {
  const d = HABITS[h.id];
  const rate = h.opportunities ? pct(h.rate) : missing('No chances in this period');
  const cost = h.cost > 0 ? amount(h.cost) : '<span class="habits-none">No excess loss</span>';
  const costDef = d.costModel === 'beyond-max-loss'
    ? 'Loss before charges beyond each spread’s defined maximum loss at entry, summed over the matched spreads.'
    : 'Extra loss on these trades compared with your usual trade in the same period. It is associated with the behaviour, not proof that it was the reason.';
  const item = (label, value, sub, definition) => `<div class="habits-metric"><dt>${esc(label)}${definition ? def(label, definition) : ''}</dt><dd><span class="habits-metric-value">${value}</span>${sub ? `<span class="habits-sub">${sub}</span>` : ''}</dd></div>`;
  // An overlapping behaviour's figures are what the detector saw, before de-duplication.
  const k = h.status === 'overlap' ? sharedCount(h) : 0;
  const before = k
    ? `<p class="habits-metrics-note"><strong>Before de-duplication.</strong> These figures and the supporting trades below include the ${k === 1 ? 'trade' : `${k} trades`} it shares with ${quoted(sharedWith(h))}.</p>`
    : '';
  return `<div class="habits-metrics-wrap"><dl class="habits-metrics">
    ${item('Occurrences', `<span class="num">${h.occurrences}</span> <span class="habits-of">of ${h.opportunities}</span>`, `${esc(chanceNoun(h.id, h.opportunities))} · rate ${rate}`, `Occurrences out of chances. A chance is any one of the ${d.chances} in this period. ${d.chanceNote}`)}
    ${item('Different days', `<span class="num">${h.gates.days}</span> <span class="habits-of">of ${a.summary.tradingDays}</span>`, 'trading days with an occurrence')}
    ${item('Excess loss', cost, costNote(h), costDef)}
    ${item('Applies to', `<span class="habits-applies">${esc(d.appliesTo)}</span>`, '')}
  </dl>${before}</div>`;
}

function evidencePreview(h, sh) {
  if (!h.evidence.length) return '';
  const rows = h.evidence.slice(0, EVIDENCE_PREVIEW).map((e) => {
    // A behaviour that is not confirmed keeps shared trades in its figures; mark where each one is counted.
    const under = h.status === 'confirmed' ? null : sh.underOf.get(e.unitId);
    const tag = under ? ` · <span class="habits-ev-shared">also counted under ${esc(HABITS[under].short)}</span>` : '';
    return `<li>
      <div class="habits-ev-main"><span class="habits-ev-when"><span class="num">${esc(formatDay(e.day))} · ${esc(e.time)}</span> · ${esc(e.label)}${tag}</span><p class="habits-ev-detail">${esc(e.detail)}</p></div>
      <div class="habits-ev-side"><span class="habits-ev-pnl"><span class="sr-only">Net P&amp;L </span>${money(e.netPnl)}</span>${button('Open trade', { action: 'selectTrade', data: { id: e.unitId }, variant: 'ghost', size: 'sm', ariaLabel: `Open trade ${e.label}, ${formatDay(e.day)} at ${e.time}` })}</div>
    </li>`;
  }).join('');
  const more = h.evidence.length - EVIDENCE_PREVIEW;
  return `<div class="habits-block"><h4 class="habits-h3">Supporting trades <span class="muted">(${h.evidence.length})</span></h4>
    <ol class="habits-evidence">${rows}${more > 0 ? `<li class="habits-ev-more">and ${plural(more, 'more trade')}, all listed in the evidence inspector</li>` : ''}</ol></div>`;
}

const noteBlock = (tone, title, text) => `<div class="habits-block">${callout({ tone, title, body: `<p>${text}</p>` })}</div>`;

// "All 6 trades seen here are" / "2 trades of the 8 seen here are"
function sharedLead(k, n) {
  if (k === n) return k === 1 ? 'The 1 trade seen here is' : `All ${k} trades seen here are`;
  return `${plural(k, 'trade')} of the ${n} seen here ${isAre(k)}`;
}

// Which trades are shared with confirmed habits, and whether they are in this card's figures.
function overlapNote(h, sh) {
  const k = sharedCount(h);
  const names = quoted(sharedWith(h));
  const higher = sharedWith(h).length > 1 ? 'higher-ranked habits' : 'a higher-ranked habit';
  if (h.status === 'confirmed') {
    if (!k) return '';
    return noteBlock('info', 'Some matching trades are counted elsewhere',
      `${plural(k, 'trade')} that also ${k === 1 ? 'matches' : 'match'} this behaviour ${isAre(k)} counted under ${names}, ${higher}, so ${k === 1 ? 'it is' : 'they are'} left out here. The figures, gates and supporting trades on this card use the remaining ${plural(h.occurrences, 'trade')}.`);
  }
  if (h.status === 'overlap') {
    const limit = `At most ${MAX_CONFIRMED} habits are confirmed in a period, and the ${MAX_CONFIRMED} confirmed habits each ranked above this one by excess loss on all of their matching trades, so it is not confirmed.`;
    // The figures above already say they are before de-duplication (see metrics()).
    const figures = 'The gates below are that re-check.';
    if (h.limitCut) {
      return noteBlock('warn', `Passed every gate, but over the ${MAX_CONFIRMED}-habit limit`, k
        ? `${sharedLead(k, h.occurrences)} already counted under ${names}. Each trade counts toward one habit only, so this behaviour was re-checked without ${them(k)}: ${recheckFacts(h)}, and it still passed all four gates. ${limit} ${figures}`
        : `It passed all four evidence gates and shares no trades with a confirmed habit. ${limit}`);
    }
    let text = `${sharedLead(k, h.occurrences)} already counted under ${names}. Each trade counts toward one habit only, so this behaviour was re-checked without ${them(k)}: ${recheckFacts(h)}, and it did not pass every gate. ${figures}`;
    const m = sh.later.length;
    if (m) text += ` ${m === 1 ? 'Another trade' : `Another ${m} trades`} seen here ${isAre(m)} counted under ${namesOf(sh.later)}, ${habitsUnder(sh.later).length > 1 ? 'habits' : 'a habit'} confirmed after this one was checked, so ${them(m)} stayed in the re-check.`;
    return noteBlock('warn', 'Shares its trades with a confirmed habit', text);
  }
  // Behaviours that never passed the gates keep every matching trade in their figures.
  const n = sh.all.length;
  if (!n) return '';
  const many = habitsUnder(sh.all).length > 1;
  return noteBlock('info', `Some of these trades are also counted under ${many ? 'confirmed habits' : 'a confirmed habit'}`,
    `${n} of the ${plural(h.occurrences, 'trade')} seen here ${isAre(n)} also counted under ${namesOf(sh.all)}, ${many ? 'confirmed habits' : 'a confirmed habit'}. The figures on this card include ${them(n)}; the headline total counts each trade once, under ${many ? 'those habits' : 'that habit'}.`);
}

function chips(h, rule) {
  // habitStatusChip labels a behaviour left out only by the reporting limit as such, not as an overlap.
  const out = [habitStatusChip(h, MAX_CONFIRMED)];
  if (h.status === 'confirmed') out.push(confidenceChip(h.gates.confidence));
  if (rule) out.push(chip(`Guardrail ${rule.status}`, rule.status === 'active' ? 'accent' : 'muted'));
  return `<div class="chip-row">${out.join('')}</div>`;
}

function reasonBlock(h, a) {
  const k = sharedCount(h);
  const names = quoted(sharedWith(h));
  let text;
  if (h.status === 'overlap' && h.limitCut) {
    text = `Passed all four evidence gates${k ? `, even without the ${plural(k, 'trade')} it shares with ${names}` : ''}, but at most ${MAX_CONFIRMED} habits are confirmed in a period and ${MAX_CONFIRMED} others ranked above it by excess loss.`;
  } else if (h.status === 'overlap') {
    // Spell out that the failed gate is the re-check's, so it reads correctly next to the full counts.
    const share = k === h.occurrences ? (k === 1 ? 'its only trade' : `all ${k} of its trades`) : `${k} of its ${plural(h.occurrences, 'trade')}`;
    const failed = h.recheck.gates.failed;
    text = `Shares ${share} with ${names}, ${sharedWith(h).length > 1 ? 'higher-ranked confirmed habits' : 'a higher-ranked confirmed habit'}. Re-checked without ${them(k)}: ${esc(lowerFirst(failed?.reason ?? 'it did not pass every gate.'))}`;
  } else {
    text = esc(h.statusReason ?? '');
  }
  if (h.status === 'confirmed' && h.rank) text += ` Ranked ${ordinal(h.rank)} of ${a.confirmed.length} confirmed ${a.confirmed.length === 1 ? 'habit' : 'habits'} by associated excess loss.`;
  return `<div class="habits-reason"><span class="habits-reason-label">Why this classification</span><p>${text}</p></div>`;
}

// Gates as decided: for an overlapping behaviour, the engine's re-check without the trades counted elsewhere.
function gatesBlock(h, a, sh) {
  if (!h.occurrences) return '';
  const k = h.status === 'overlap' ? sharedCount(h) : 0;
  const g = k ? h.recheck.gates : h.gates;
  const passed = g.checks.filter((c) => c.pass).length;
  const heading = k ? `Evidence gates, re-checked without the ${plural(k, 'shared trade')}` : 'Evidence gates';
  // The cost arithmetic needs the re-check's trade rows, which only the full regate result carries.
  const detail = k && !h.recheck.occurrences
    ? '<p class="habits-formula-note">No trades remain once the shared ones are removed, so there is nothing left to cost.</p>'
    : `<details class="habits-more"><summary>Show gate and cost arithmetic</summary><div class="habits-more-body">${gateList(g)}${costArithmetic(k ? regate(a, h.id, sh.removed.map((x) => x.unitId)) : h)}</div></details>`;
  return `<div class="habits-block habits-gates"><h4 class="habits-h3">${heading} <span class="muted">(${passed} of ${g.checks.length} passed)</span></h4>${gateList(g, { compact: true })}${detail}</div>`;
}

function actions(h, rule, { compact = false } = {}) {
  const guardLabel = rule ? 'Edit guardrail' : 'Set guardrail';
  const guardVariant = h.status === 'confirmed' && !rule ? 'primary' : 'secondary';
  const out = [];
  if (!compact) out.push(button('Inspect evidence', { action: 'inspectHabit', data: { 'habit-id': h.id }, ariaLabel: `Inspect evidence for ${h.name}` }));
  if (!compact || rule) out.push(button(guardLabel, { action: 'openGuardrail', data: { 'habit-id': h.id }, variant: guardVariant, ariaLabel: `${guardLabel} for ${h.name}` }));
  return out.length ? `<div class="btn-row habits-actions">${out.join('')}</div>` : '';
}

// Cards are h3 sections under the page's "Behaviours checked" h2; their inner headings are h4.
function fullCard(state, h, a, sh) {
  const d = HABITS[h.id];
  const rule = guardrailOf(state, h.id);
  const body = `${reasonBlock(h, a)}${metrics(h, a)}${overlapNote(h, sh)}${gatesBlock(h, a, sh)}${evidencePreview(h, sh)}${actions(h, rule)}`;
  return `<div class="habits-card habits-card-${esc(h.status)}">${panel({
    id: `habits-card-${h.id}`, tone: TONE[h.status] ?? '', title: esc(d.name), subtitle: esc(d.definition), actions: chips(h, rule), body, headingLevel: 3,
  })}</div>`;
}

function compactCard(state, h) {
  const d = HABITS[h.id];
  const rule = guardrailOf(state, h.id);
  const chances = h.opportunities ? `<span class="num">${h.opportunities}</span> ${esc(chanceNoun(h.id, h.opportunities))}` : 'None';
  const body = `<p class="habits-reason-compact">${esc(h.statusReason ?? '')}</p>
    <dl class="habits-facts"><div><dt>Chances this period</dt><dd>${chances}</dd></div><div><dt>Applies to</dt><dd>${esc(d.appliesTo)}</dd></div></dl>
    <p class="habits-chance-note">${esc(d.chanceNote)}</p>${actions(h, rule, { compact: true })}`;
  return `<div class="habits-card habits-card-compact">${panel({
    id: `habits-card-${h.id}`, title: esc(d.name), subtitle: esc(d.definition), actions: chips(h, rule), body, headingLevel: 3,
  })}</div>`;
}

const card = (state, h, a) => (h.status === 'not-seen' ? compactCard(state, h) : fullCard(state, h, a, sharing(h, a)));

function rulesPanel(a) {
  const g = CONFIG.gates;
  const s = a.summary;
  // summary.grossLosses sums the net P&L of the period's losing trades, so charges are included.
  const share = `${Math.round(g.lossShare * 100)}% of this period’s total losses after charges (${esc(formatINR(s.grossLosses))})`;
  const floorWhy = s.floor > g.minCost ? share : `the minimum, because ${share} is lower`;
  const rules = [
    ['Repeated', `Seen at least ${g.minN} times in the period.`],
    ['Spread out', `Seen on at least ${g.minDays} different trading days.`],
    ['Material', `Excess loss of at least ${esc(formatINR(s.floor))} this period: ${floorWhy}.`],
    ['Not one trade', `Without its costliest trade, the excess loss is still at least ${esc(formatINR(g.looMinCost))} and at least ${Math.round(g.looMinShare * 100)}% of the total.`],
  ];
  const body = `<dl class="habits-rules">${rules.map(([t, x], i) => `<div><dt><span class="habits-rule-n">${i + 1}</span>${esc(t)}</dt><dd>${x}</dd></div>`).join('')}</dl>
    <div class="habits-rules-notes">
      <p><strong>Strength.</strong> A confirmed habit is marked strong when it has ${g.strongN} or more occurrences and still clears ${esc(formatINR(g.looMinCost))} without its two costliest trades; otherwise moderate.</p>
      <p><strong>Excess loss.</strong> The extra loss on a behaviour’s trades compared with your usual trade in the same period: the average net P&amp;L of your other comparable trades, taken as ₹0 when that average is a gain or there are fewer than ${CONFIG.thinBaseline} of them. For hedge removal it is the loss beyond each spread’s defined maximum loss at entry. It is associated with the behaviour, not proof that the behaviour caused the loss.</p>
      <p><strong>Counted once.</strong> A trade that matches two behaviours counts toward the higher-ranked confirmed habit only, and at most ${MAX_CONFIRMED} habits are confirmed in a period. Periods with fewer than ${CONFIG.minUnits} trades confirm none.</p>
      <p class="muted">This review describes past orders only. It does not recommend any trade. ${linkTo('Read the full methodology', 'method')}</p>
    </div>`;
  return panel({ id: 'habits-rules', title: 'How behaviours are judged', subtitle: `The evidence bar for ${esc(s.periodLabel ?? 'this period')}. A behaviour becomes a habit only when it passes all four.`, body });
}

// ---------- view ----------

export function render(state) {
  const a = selectAnalysis(state);
  const ds = getDataset(state);
  const filter = currentFilter(state);
  const shown = HABIT_IDS.map((id) => a.habits[id]).filter((h) => FILTERS[filter.status].test(h.status)).sort(SORTERS[filter.sort]);
  const source = ds.kind === 'import' ? 'your imported file, this tab only' : 'synthetic sample data';

  const header = pageHeader({
    eyebrow: `${esc(a.summary.periodLabel ?? 'All periods')} · ${esc(ds.name)} · ${esc(source)}`,
    title: 'Habits',
    lead: 'Five behaviours are checked for every trader. A behaviour is called a habit only when it passes all four evidence gates: it is repeated, spread out over different days, material in size, and not down to one trade. Costs are excess loss compared with your usual trade (for hedge removal, loss beyond the spread’s defined maximum loss).',
    actions: button('Methodology', { action: 'navigate', data: { view: 'method' }, variant: 'ghost' }),
  });

  const list = shown.length
    ? `<div class="habits-list">${shown.map((h) => card(state, h, a)).join('')}</div>`
    : `<div class="panel habits-empty">${emptyFor(filter.status, a)}</div>`;

  return `${header}<div class="habits-view">
    ${thinCallout(a)}
    ${summaryLine(a)}
    ${dataNotes(state)}
    <section class="habits-results" aria-labelledby="habits-results-title"><h2 class="sr-only" id="habits-results-title">Behaviours checked</h2>
      ${controls(a, filter, shown.length, !state.guardEdit)}
      ${list}
    </section>
    ${rulesPanel(a)}
  </div>`;
}
