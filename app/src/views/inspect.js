// Evidence & calculation inspector: one habit, every qualifying trade, and the arithmetic behind its cost.
// Pure function of state. Every figure comes from selectInspector() (engine output); the view only adds
// sums of the engine's own per-trade rows to show that they reproduce the engine's totals.

import { selectInspector, selectNextPeriod, tradeLabels } from '../store.js';
import { HABITS, HABIT_IDS, CONFIG, GUARDRAILS } from '../engine.js';
import { formatINR, formatPct, formatDay, formatDate, plural, isNum } from '../format.js';
import {
  esc, money, amount, missing, button, linkTo, chip, habitStatusChip, confidenceChip, stat, panel,
  callout, emptyState, pageHeader, table, gateList, sr,
} from '../ui/components.js';

const GATE_COUNT = 4;

// "N chances" in the habit's own words (HABITS.chance / HABITS.chances), e.g. "1 trade opened after a losing trade".
const chancesOf = (n, d) => plural(n, d.chance, d.chances);
const quoted = (names = []) => names.map((nm) => `“${nm}”`).join(', ');
const isLimitCut = (h) => h.status === 'overlap' && Boolean(h.limitCut);
const isOverlap = (h) => h.status === 'overlap' && !h.limitCut;
// The engine's de-duplicated re-check, with the costing it shares with the standalone result (same baseline).
const recheckOf = (h) => (h.recheck ? { ...h.recheck, costing: h.costing } : null);

// Rounds half away from zero, so −₹x.50 and +₹x.50 mirror each other and a row's net P&L and its
// contribution never differ by ₹1 when the baseline is ₹0. (format.js rounds half up.)
const roundTo = (n, d = 0) => (isNum(n) ? (Math.sign(n) * Math.round(Math.abs(n) * 10 ** d)) / 10 ** d : n);
const inr = (n, opts = {}) => formatINR(roundTo(n, opts.decimals ?? 0), opts);
const moneyR = (n, opts = {}) => money(roundTo(n, opts.decimals ?? 0), opts);
const amountR = (n, opts = {}) => amount(roundTo(n, opts.decimals ?? 0), opts);
const signed = (n, decimals = 0) => inr(n, { sign: true, decimals });

// A cost of zero or less is "no excess loss", never a negative cost.
const costHtml = (n) => (isNum(n) && n >= 0.5 ? amountR(n) : '<span class="muted">No excess loss</span>');
const costPlain = (n) => (isNum(n) && n >= 0.5 ? inr(n) : 'no excess loss');
const passed = (gates) => gates.checks.filter((c) => c.pass).length;
const sum = (xs) => xs.reduce((s, v) => s + v, 0);

// ---------- what the cost is compared with ----------

// 'max'    H3: each spread's own defined max loss at entry.
// 'usual'  the trader's usual trade lost money, so the baseline is that average loss.
// 'capped' the usual trade did not lose money, so the baseline is capped at ₹0.
// 'thin'   too few comparable trades for an average, so the baseline is ₹0.
function baseKind(c) {
  if (c.model === 'beyond-max-loss') return 'max';
  if (c.thin) return 'thin';
  return c.baseline < 0 ? 'usual' : 'capped';
}

// Completes "did no worse than …" / "did better than …" for the baseline actually used.
function benchmark(c) {
  const k = baseKind(c);
  if (k === 'max') return 'their defined max loss';
  if (k === 'usual') return `your usual trade (${inr(c.baseline)} on average)`;
  return 'breaking even (the ₹0 baseline)';
}

// When one trade carries all of the cost, what the remaining occurrences did. Null when there are none.
function othersNote(target) {
  if (target.occurrences < 2) return null;
  return baseKind(target.costing) === 'max'
    ? 'The other removals all ended within their defined max loss.'
    : `The other occurrences together did no worse than ${benchmark(target.costing)}.`;
}

// The engine's "Not one trade" reason assumes some excess loss, more than one occurrence and a baseline
// equal to "your usual trade". Restate it for the habit (or re-gated habit) actually shown.
function g4Reason(target) {
  const g4 = target.gates.checks.find((c) => c.id === 'G4');
  if (!(target.cost >= 0.5)) return 'There is no excess loss, so there is no single trade to test.';
  if (target.gates.topShare >= 1) {
    const others = othersNote(target);
    return others ? `One trade accounts for all of the cost. ${others}` : 'There is only one occurrence, so all of the cost rests on one trade.';
  }
  return g4.reason;
}

const gateReason = (check, target) => (check.id === 'G4' ? g4Reason(target) : check.reason);

// Swap the engine's G4 sentence inside a longer reason for the corrected one. The engine quotes a re-check's
// reason mid-sentence with a lower-case first letter, so both spellings are matched.
function fixG4(text, target) {
  const g4 = target?.gates.checks.find((c) => c.id === 'G4');
  if (!g4 || g4.pass) return text;
  const better = g4Reason(target);
  const lower = (s) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  if (text.includes(g4.reason)) return text.replace(g4.reason, better);
  if (text.includes(lower(g4.reason))) return text.replace(lower(g4.reason), lower(better));
  return text;
}

// Trades of this habit that are counted under a different (confirmed) habit.
function countedElsewhere(analysis, unitId, habitId) {
  const l = tradeLabels(analysis, unitId).find((x) => x.habitId === habitId);
  return l && l.countedUnder && l.countedUnder !== habitId ? l.countedUnder : null;
}

// "left out only because at most 3 habits are reported per period, and the 3 confirmed habits ranked above it".
const limitClause = (a) => `at most ${CONFIG.maxHabits} habits are reported per period, and the ${plural(a.confirmed.length, 'confirmed habit')} ranked above it by excess loss`;

function statusReasonOf(x) {
  const { habit: h, analysis: a } = x;
  const k = baseKind(h.costing);
  if (h.status === 'not-costly') {
    const why = k === 'max'
      ? 'every removal ended within its defined max loss'
      : k === 'usual'
        ? `together these trades did no worse than ${benchmark(h.costing)}`
        : 'together these trades did not lose money, and the baseline is ₹0';
    return `Seen ${plural(h.occurrences, 'time')}, but ${why}, so there is no excess loss to attribute.`;
  }
  // A reporting-limit cut, not an overlap: it passed every gate (and the de-duplicated re-check).
  if (isLimitCut(h)) return `Passed every gate; left out only because ${limitClause(a)}.`;
  // The engine's reason quotes the de-duplicated re-check; correct its G4 wording for that re-check.
  if (isOverlap(h)) return fixG4(h.statusReason ?? '', recheckOf(h));
  return fixG4(h.statusReason ?? '', h);
}

// ---------- view ----------

export function render(state) {
  // announce: this view's one live-region summary; the guardrail dialog carries its own while it is open.
  const x = { ...selectInspector(state), announce: !state.guardEdit };
  const { analysis: a, habit: h, def: d } = x;
  const period = a.summary.periodLabel ?? 'All periods';
  const header = pageHeader({
    eyebrow: `Evidence inspector · ${esc(period)}`,
    title: esc(h.name),
    lead: esc(d.definition),
    actions: button('All habits', { action: 'navigate', data: { view: 'habits' }, variant: 'ghost' }),
  });
  const n = h.evidence.length;
  const sections = [
    switcher(x),
    a.summary.thin ? callout({ tone: 'warn', title: 'Too few trades to judge habits', body: `<p>This period has ${plural(a.summary.units, 'closed trade')}. Nothing is called a habit until a period has ${CONFIG.minUnits} or more; the evidence below is shown for reference only.</p>` }) : '',
    statusPanel(x),
    overlapNote(x),
    tradesPanel(state, x),
    n ? `<div class="inspect-grid">${baselinePanel(x)}${calculationPanel(x)}${looPanel(x)}</div>` : '',
    x.sensitivity ? sensitivityPanel(x) : '',
    `<div class="inspect-pair">${gatesPanel(x)}${limitsPanel(x)}</div>`,
    actPanel(state, x),
  ];
  return `${header}<div class="inspect">${sections.filter(Boolean).join('')}</div>`;
}

// "Unavailable" is announced with aria-disabled instead of disabled, so the control stays focusable and
// keyboard focus is not dropped to <body> when it becomes unavailable after a click (main.js ignores the click).
function softButton(label, { action, variant = 'secondary', unavailable = false, ariaLabel }) {
  return button(label, { action, variant, ariaDisabled: unavailable, ariaLabel });
}

// ---------- habit switcher ----------

// Same markup and classes as the shared segmented() control, but each option carries its own
// data-habit-id so the click sends { type: 'inspectHabit', habitId }.
function switcher(x) {
  const opts = HABIT_IDS.map((id) => {
    const active = id === x.habit.id;
    const status = x.analysis.habits[id].status;
    return `<button type="button" class="seg${active ? ' is-active' : ''}" aria-pressed="${active}" data-action="inspectHabit" data-habit-id="${esc(id)}">${esc(HABITS[id].short)}${status === 'confirmed' ? sr(' (confirmed habit)') : ''}</button>`;
  }).join('');
  return `<div class="inspect-switch"><span class="inspect-switch-label" id="inspect-switch-label">Inspect habit</span><div class="segmented" role="group" aria-labelledby="inspect-switch-label">${opts}</div></div>`;
}

// ---------- status summary ----------

function statusPanel(x) {
  const { habit: h, def: d, analysis: a } = x;
  const g = h.gates;
  const c = h.costing;
  const k = baseKind(c);
  const chips = [
    habitStatusChip(h, CONFIG.maxHabits),
    h.status === 'confirmed' ? confidenceChip(g.confidence) : '',
    h.rank ? chip(`Ranked ${h.rank} of ${a.confirmed.length} confirmed`, 'neutral') : '',
  ].join('');
  const costSub = {
    max: 'Beyond each spread’s defined max loss',
    usual: 'Compared with your usual trade',
    capped: 'Compared with your usual trade, capped at ₹0',
    thin: 'Compared with breaking even (₹0 baseline)',
  }[k];
  const assoc = 'It is an association, not a forgone profit.';
  const costDef = {
    max: 'Loss beyond the maximum each spread could lose at entry, added up over the occurrences. Removals that ended within the max count as ₹0.',
    usual: `Loss associated with these trades beyond what your usual trade lost in the same period (${inr(-c.baseline)} on average). ${assoc}`,
    capped: `Your usual trade did not lose money this period, so the baseline is capped at ₹0 and this is the net loss of these trades together. ${assoc}`,
    thin: `There are too few comparable trades for a stable average, so the baseline is ₹0 and this is the net loss of these trades together. ${assoc}`,
  }[k];
  // An overlapping behaviour's own figures include the trades it shares (before de-duplication).
  const beforeDedup = h.status === 'overlap' && h.overlap > 0;
  let gatesSub = 'All passed';
  if (g.failed) gatesSub = `First failed: ${esc(g.failed.name)}`;
  else if (isOverlap(h) && h.recheck) gatesSub = `Before de-duplication · <span class="num">${passed(h.recheck.gates)} of ${GATE_COUNT}</span> without the shared trades`;
  else if (beforeDedup) gatesSub = 'Passed, with and without the shared trades';
  const stats = [
    stat({
      label: 'Occurrences',
      value: `<span class="num">${h.occurrences}</span>`,
      sub: h.opportunities ? `of ${esc(chancesOf(h.opportunities, d))} · <span class="num">${esc(formatPct(h.rate))}</span>` : `No ${esc(d.chances)} this period`,
      definition: `${d.chanceNote} Applies to: ${d.appliesTo.toLowerCase()}.`,
    }),
    stat({
      label: 'Different days',
      value: `<span class="num">${g.days}</span>`,
      sub: `The “Spread out” gate needs ${CONFIG.gates.minDays} or more`,
    }),
    stat({ label: 'Excess loss', value: costHtml(h.cost), sub: esc(beforeDedup ? `${costSub} · before de-duplication` : costSub), definition: costDef }),
    stat({
      label: 'Evidence gates',
      value: `<span class="num">${passed(g)} of ${g.checks.length}</span>`,
      sub: gatesSub,
    }),
  ].join('');
  const reasonText = statusReasonOf(x);
  // The one result summary main.js announces: this status, or the sensitivity verdict while trades are unticked.
  const reason = reasonText ? `<p class="inspect-reason"${x.announce && !x.sensitivity ? ' data-announce' : ''}>${esc(reasonText)}</p>` : '';
  return panel({
    title: 'Status this period',
    body: `<div class="chip-row inspect-chips">${chips}</div>${reason}<div class="stat-grid">${stats}</div>`,
  });
}

// ---------- overlap ----------

// "18 occurrences and ₹17,992 of excess loss" for the engine's de-duplicated re-check.
function recheckFigures(r) {
  return `${plural(r.occurrences, 'occurrence')} and ${r.cost >= 0.5 ? `${inr(r.cost)} of excess loss` : 'no excess loss'}`;
}

function overlapNote(x) {
  const { habit: h, analysis: a } = x;
  const k = h.overlap ?? 0;
  const n = h.occurrences;
  const names = quoted(h.overlapWith) || 'a higher-ranked confirmed habit';
  const them = k === 1 ? 'it' : 'them';
  const sharedLine = `${k} of the ${plural(n, 'trade')} below ${k === 1 ? 'is' : 'are'} also counted under ${names} and marked in the table.`;
  const notAdded = 'Its excess loss is not added to the period’s headline.';
  // Status first: an overlapping or limit-cut behaviour shows its own figures BEFORE de-duplication.
  if (isLimitCut(h)) {
    const r = h.recheck;
    const shared = k && r
      ? `${sharedLine} The figures shown here include ${them} (before de-duplication). Re-checked without ${them}, it still passes every gate, with ${recheckFigures(r)}.`
      : 'None of its trades are counted under another habit.';
    return callout({
      tone: 'info',
      title: `Passed every gate, but over the ${CONFIG.maxHabits}-habit limit`,
      body: `<p>This behaviour passed all four evidence gates. It is left out only because ${esc(limitClause(a))}. ${esc(shared)} ${esc(notAdded)}</p>`,
    });
  }
  if (isOverlap(h)) {
    const r = h.recheck;
    const mostly = n > 0 && k / n > 0.5;
    let recheck = '';
    if (r && !r.occurrences) recheck = ` Without ${them} no occurrences are left, so it is not reported as a separate habit.`;
    else if (r && r.gates.failed) recheck = ` Re-checked without ${them} (${recheckFigures(r)}), it fails “${r.gates.failed.name}”, so it is not reported as a separate habit.`;
    return callout({
      tone: 'info',
      title: mostly ? 'Mostly the same trades as another habit' : 'Shares trades with a confirmed habit',
      body: `<p>${esc(sharedLine)} The occurrences, excess loss and gates shown here are this behaviour on its own, before de-duplication, so they include the shared ${k === 1 ? 'trade' : 'trades'}.${esc(recheck)} ${esc(notAdded)}</p>`,
    });
  }
  // A confirmed habit shows its de-duplicated evidence: the shared trades are counted under the other habit.
  if (h.status === 'confirmed' && k > 0) {
    return callout({
      tone: 'info',
      title: 'Shared trades are counted once',
      body: `<p>${plural(k, 'trade')} that also matched this behaviour ${k === 1 ? 'is' : 'are'} counted under ${esc(names)}, so ${k === 1 ? 'it is' : 'they are'} not in this table or this excess loss. Each trade counts toward one habit, so the headline is not double counted.</p>`,
    });
  }
  return '';
}

// ---------- qualifying trades ----------

// "₹11,051 loss before charges − ₹5,678 max", in paise when rupee rounding would not add up.
function beyondMaxLine(e) {
  const loss = -e.grossPnl;
  const whole = roundTo(loss) - roundTo(e.maxLoss) === roundTo(e.contribution);
  const dp = whole ? 0 : 2;
  return `${inr(loss, { decimals: dp })} loss before charges − ${inr(e.maxLoss, { decimals: dp })} max${whole ? '' : ` = ${inr(e.contribution, { decimals: 2 })}`}`;
}

function tradesPanel(state, x) {
  const { habit: h, def: d, rows, analysis: a } = x;
  const n = h.evidence.length;
  const title = 'Qualifying trades';
  if (!n) {
    let lead = `There were no ${d.chances} this period, so this behaviour could not occur.`;
    if (h.opportunities === 1) lead = `Your only ${d.chance} this period did not match the definition.`;
    else if (h.opportunities) lead = `None of your ${chancesOf(h.opportunities, d)} this period matched the definition.`;
    const body = `${esc(lead)} ${esc(d.chanceNote)}`;
    return panel({ title, body: emptyState({ title: 'This behaviour was not seen', body }) });
  }
  const k = baseKind(h.costing);
  const isH3 = k === 'max';
  const offsetNote = k === 'usual' ? 'Better than your usual trade, so it offsets' : 'A profit, so it offsets';
  const index = new Map(h.evidence.map((e, i) => [e.unitId, i]));
  const excluded = new Set(x.excluded);
  const columns = [
    { key: 'include', label: 'Include' },
    { key: 'day', label: 'Date', sortable: true },
    { key: 'trade', label: 'Trade' },
    { key: 'why', label: 'Why it qualified' },
    { key: 'netPnl', label: 'Net P&L', align: 'right', sortable: true },
    { key: 'contribution', label: 'Counts toward cost', align: 'right', sortable: true },
  ];
  const cells = rows.map((e) => {
    const i = index.get(e.unitId);
    const inc = !excluded.has(e.unitId);
    const when = `${formatDate(e.day)} at ${e.time}`;
    const elsewhere = countedElsewhere(a, e.unitId, h.id);
    const include = `<span class="inspect-inc"><input type="checkbox" id="inspect-inc-${i}" data-action="toggleExclude" data-unit-id="${esc(e.unitId)}"${inc ? ' checked' : ''} aria-label="${esc(`Include ${e.label} (${when}) in the sensitivity check`)}">${inc ? '' : '<span class="inspect-sub">Excluded</span>'}</span>`;
    const date = `<span class="inspect-nowrap">${esc(formatDay(e.day))}</span><span class="inspect-sub muted num">${esc(e.time)}</span>`;
    const trade = `<button type="button" class="link inspect-trade" data-action="selectTrade" data-id="${esc(e.unitId)}" aria-label="${esc(`Open trade ${e.label}, ${when}`)}">${esc(e.label)}</button>`;
    const why = `<span class="inspect-why">${esc(e.detail)}</span>${elsewhere ? `<span class="inspect-sub">${chip(`Counted under “${HABITS[elsewhere].short}”`, 'muted')}</span>` : ''}`;
    const net = `${moneyR(e.netPnl)}${e.chargesMissing ? `<span class="inspect-sub muted">Charges missing on ${plural(e.chargesMissing, 'fill')}</span>` : ''}`;
    let contrib = amountR(e.contribution);
    if (isH3 && isNum(e.maxLoss)) {
      contrib += e.contribution >= 0.5
        ? `<span class="inspect-sub muted">${esc(beyondMaxLine(e))}</span>`
        : `<span class="inspect-sub muted">${esc(`Within the ${inr(e.maxLoss)} max loss`)}</span>`;
    } else if (!isH3 && e.contribution <= -0.5) {
      contrib += `<span class="inspect-sub muted">${esc(offsetNote)}</span>`;
    }
    return [include, date, trade, why, net, contrib];
  });
  const totalNet = sum(h.evidence.map((e) => e.netPnl));
  const exNote = x.excluded.length
    ? ` ${plural(x.excluded.length, 'trade')} unticked: the re-gated result is below. The reported figures do not change.`
    : '';
  const counted = h.cost >= 0.5
    ? `, counted toward cost <span class="num">${esc(inr(h.cost))}</span>`
    : '; no excess loss is counted';
  const foot = `<p class="inspect-foot muted">All ${plural(n, 'occurrence')} as reported: net P&L <span class="num">${esc(signed(totalNet))}</span>${counted}.${exNote}</p>`;
  return panel({
    title,
    subtitle: `${plural(n, 'occurrence')} on ${plural(h.gates.days, 'day')}. Untick a trade to test whether the evidence gates still pass without it.`,
    body: table({
      columns,
      rows: cells,
      caption: `Trades that matched “${h.name}”`,
      sort: { key: state.inspect.sort, dir: state.inspect.dir, action: 'setInspectSort' },
      rowAttrs: (i) => (excluded.has(rows[i].unitId) ? ' class="is-excluded"' : ''),
    }) + foot,
  });
}

// ---------- baseline ----------

function baselinePanel(x) {
  const { habit: h, def: d } = x;
  const c = h.costing;
  if (c.model === 'beyond-max-loss') {
    const beyond = h.evidence.filter((e) => e.contribution >= 0.5).length;
    const within = h.evidence.length - beyond;
    return panel({
      title: 'Baseline',
      subtitle: 'The spread’s own worst case',
      body: `<dl class="kv">
        <dt>Compared with</dt><dd>${esc(d.comparison)}</dd>
        <dt>Beyond the max</dt><dd><span class="num">${beyond}</span> of ${plural(h.evidence.length, 'spread')}</dd>
        <dt>Within the max</dt><dd><span class="num">${within}</span>, counted as <span class="num">₹0</span></dd>
      </dl>
      <p class="inspect-note">The defined max loss is fixed when the spread is opened: the widest wing × quantity − the net credit received (for a debit spread, the net debit paid).</p>
      <p class="inspect-note">Each result is taken before charges, like the max loss itself. A removal that ended within the max counts as ₹0: this measure counts downside only.</p>`,
    });
  }
  let note;
  if (c.thin) {
    note = callout({ tone: 'warn', body: `<p>Only ${plural(c.comparisonN, 'comparable trade')}, fewer than the ${CONFIG.thinBaseline} needed for a stable average, so the baseline is ₹0: these trades are compared with breaking even.</p>` });
  } else if (c.comparisonMean >= 0) {
    note = `<p class="inspect-note">Your usual trade made ${esc(inr(c.comparisonMean))} on average. The baseline is capped at ₹0, so only real losses count and no forgone profit is ever added to the cost.</p>`;
  } else {
    note = `<p class="inspect-note">Your usual trade lost ${esc(inr(-c.comparisonMean))} on average, so only the part of each loss beyond that counts.</p>`;
  }
  const rule = c.thin
    ? `Baseline = ₹0 when there are fewer than ${CONFIG.thinBaseline} comparable trades; otherwise the lower of their average and ₹0.`
    : 'Baseline = the lower of that average and ₹0.';
  return panel({
    title: 'Baseline',
    subtitle: 'What “your usual trade” means here',
    body: `<dl class="kv">
      <dt>Compared with</dt><dd>${esc(d.comparison)}</dd>
      <dt>Comparable trades</dt><dd class="num">${c.comparisonN}</dd>
      <dt>Their average</dt><dd>${isNum(c.comparisonMean) ? moneyR(c.comparisonMean) : missing('No comparable trades in this period')} <span class="muted">net</span></dd>
      <dt>Baseline used</dt><dd>${moneyR(c.baseline)}</dd>
    </dl>
    <p class="inspect-note muted">${esc(rule)}</p>
    ${note}`,
  });
}

// ---------- calculation ----------

function calculationPanel(x) {
  const { habit: h } = x;
  const c = h.costing;
  const k = baseKind(c);
  const n = h.evidence.length;
  let rows;
  let eq;
  let recon;
  let dp;
  if (k === 'max') {
    const beyond = h.evidence.filter((e) => e.contribution >= 0.5);
    const loss = sum(beyond.map((e) => -e.grossPnl));
    const max = sum(beyond.map((e) => e.maxLoss));
    recon = sum(h.evidence.map((e) => e.contribution));
    // Rupees when the rounded figures add up exactly; otherwise paise, so the shown sum is exact.
    dp = roundTo(loss) - roundTo(max) === roundTo(recon) ? 0 : 2;
    rows = [
      [`Loss before charges on the ${plural(beyond.length, 'spread')} beyond the max`, esc(inr(loss, { decimals: dp }))],
      ['− their defined max losses', esc(inr(max, { decimals: dp }))],
      [`+ ${plural(n - beyond.length, 'spread')} within the max`, '₹0'],
    ];
    eq = `excess = Σ max(0, −result before charges − defined max loss)${recon >= 0.5 ? ` = ${inr(recon, { decimals: dp })}` : ''}`;
  } else {
    const total = sum(h.evidence.map((e) => e.netPnl));
    const nb = n * c.baseline;
    recon = -(total - nb);
    const whole = Number.isInteger(roundTo(c.baseline, 2))
      && n * roundTo(c.baseline) === roundTo(nb)
      && -(roundTo(total) - roundTo(nb)) === roundTo(recon);
    dp = whole ? 0 : 2;
    const fm = (v, opts = {}) => inr(v, { decimals: dp, ...opts });
    rows = [
      [`Σ net P&L of the ${plural(n, 'occurrence')}`, esc(fm(total, { sign: true }))],
      [`${n} × baseline (${fm(c.baseline)})`, esc(fm(nb, { sign: true }))],
    ];
    // A result below ₹0 is an offset, not a negative cost: the line stops before it.
    eq = `excess = −(Σ − n × b) = −(${fm(total)} − ${nb < 0 ? `(${fm(nb)})` : fm(nb)})${recon >= 0.5 ? ` = ${fm(recon)}` : ''}`;
  }
  // The table's "Counts toward cost" column shows each row rounded to the rupee. Only say the rows add up
  // when the SUM OF THOSE ROUNDED ROWS equals the rounded total; otherwise show paise and say why they differ.
  const rowsR = sum(h.evidence.map((e) => roundTo(e.contribution)));
  const rowsMatch = rowsR === roundTo(recon);
  const f = (v) => inr(v, { decimals: rowsMatch ? dp : 2 });
  const p2 = (v) => inr(v, { decimals: 2 });
  const ok = Math.abs(recon - h.cost) < 0.005;
  const rowsWord = n === 1 ? 'the 1 row' : `the ${n} rows`;
  let roundNote = '';
  if (!rowsMatch) {
    const gap = Math.abs(rowsR - roundTo(recon));
    roundNote = gap === 1
      ? ` The table rounds each row to the rupee, so the rows can differ from the total by ₹1: here they add up to ${inr(rowsR)}.`
      : ` The table rounds each row to the rupee, so the rows can differ from the total: here they add up to ${inr(rowsR)}, ${inr(gap)} away.`;
  }
  let check;
  if (!ok) {
    check = callout({ tone: 'warn', body: `<p>Recomputed from ${esc(rowsWord)} in the table: ${esc(p2(recon))}, which differs from the engine’s ${esc(p2(h.cost))}. The engine’s figure is shown.</p>` });
  } else {
    let text;
    if (h.cost >= 0.5) {
      text = rowsMatch
        ? `${n === 1 ? 'The 1 row in the table comes' : `The ${n} rows in the table add up`} to ${inr(rowsR)}, matching the engine’s ${inr(h.cost)}.`
        : `Recomputed to the paisa from ${rowsWord} in the table: ${p2(recon)}, matching the engine’s ${p2(h.cost)}.${roundNote}`;
    } else if (k === 'max') text = 'No removal in the table ended beyond its defined max loss, so there is no excess loss, as the engine reports.';
    else if (recon <= -0.5) text = `Recomputed from ${rowsWord} in the table, these trades did ${f(-recon)} better than ${benchmark(c)} in total. That is an offset, not a cost, so there is no excess loss, as the engine reports.${roundNote}`;
    else text = `Recomputed from ${rowsWord} in the table, these trades did as well as ${benchmark(c)} to within ₹1, so there is no excess loss, as the engine reports.`;
    const paise = dp && rowsMatch ?' The lines above are shown to the paisa so they add up exactly; the table rounds each row to the rupee.' : '';
    check = `<p class="inspect-note muted">${esc(text)}${paise}</p>`;
  }
  const per = k === 'max'
    ? 'Each spread counts as the part of its loss beyond its defined max, or ₹0.'
    : k === 'usual'
      ? 'Each trade counts as −(its net P&L − baseline): a loss deeper than your usual trade adds, a better result subtracts.'
      : 'With a ₹0 baseline each trade counts as minus its net P&L: a loss adds, a profit subtracts.';
  return panel({
    title: 'Calculation',
    subtitle: 'How the cost adds up',
    body: `<div class="formula">
      ${rows.map(([key, v]) => `<div class="row"><span>${esc(key)}</span><span class="num">${v}</span></div>`).join('')}
      <div class="eq">${esc(eq)}</div>
      <div class="row total"><span>Associated excess loss</span><span>${costHtml(h.cost)}</span></div>
    </div>
    <p class="inspect-note">${esc(per)}</p>
    ${check}`,
  });
}

// ---------- leave-one-out ----------

function looPanel(x) {
  const { habit: h, worst } = x;
  const g = h.gates;
  const g4 = g.checks.find((c) => c.id === 'G4');
  const n = h.evidence.length;
  const costly = worst && worst.contribution >= 0.5;
  const hasCost = h.cost >= 0.5;
  let share;
  if (!hasCost || !costly) share = missing('There is no excess loss to share');
  else if (g.topShare >= 1) share = '<span>All of it</span>';
  else share = `<span class="num">${esc(formatPct(g.topShare, { digits: 0 }))}</span>`;
  const worstHtml = costly
    ? `<span class="inspect-nowrap">${esc(formatDay(worst.day))} <span class="muted num">${esc(worst.time)}</span></span><span class="inspect-sub">${esc(worst.label)}</span>`
    : '<span class="muted">No occurrence added to the cost</span>';
  const thresholds = `To pass, the cost without the costliest trade must be at least ${esc(inr(CONFIG.gates.looMinCost))} and at least ${esc(formatPct(CONFIG.gates.looMinShare, { digits: 0 }))} of the total${hasCost ? ` (${esc(inr(CONFIG.gates.looMinShare * h.cost))} here)` : ''}.`;
  let allOfIt = '';
  if (costly && hasCost && g.topShare >= 1) {
    allOfIt = `<p class="inspect-note">${esc(othersNote(h) ?? 'It is the only occurrence, so all of the cost rests on one trade.')}</p>`;
  }
  const exState = x.excluded.length
    ? `<p class="inspect-note">${plural(x.excluded.length, 'trade')} excluded. The re-gated result is below.</p>`
    : '';
  // excludeWorst replaces the whole selection with the costliest trade; say so when other trades are unticked.
  const onlyWorst = costly && x.excluded.length === 1 && x.excluded[0] === worst.unitId;
  const replaces = costly && x.excluded.length > 0 && !onlyWorst;
  const worstBtn = costly
    ? softButton(replaces ? 'Exclude only the costliest trade' : 'Exclude the costliest trade', {
      action: 'excludeWorst',
      unavailable: onlyWorst,
      ariaLabel: onlyWorst ? 'Exclude the costliest trade (already the only excluded trade)' : undefined,
    })
    : button('Exclude the costliest trade', { action: 'excludeWorst', disabled: true });
  const resetBtn = softButton('Reset', { action: 'resetExclusions', variant: 'ghost', unavailable: !x.excluded.length, ariaLabel: 'Reset: include all trades again' });
  return panel({
    title: 'Leave-one-out',
    subtitle: 'Is it one bad trade?',
    body: `<dl class="kv">
      <dt>Costliest occurrence</dt><dd>${worstHtml}</dd>
      <dt>It counts for</dt><dd>${costly ? amountR(worst.contribution) : missing('No occurrence added to the cost')}</dd>
      <dt>Share it explains</dt><dd>${share}</dd>
      <dt>Cost without it</dt><dd>${costHtml(g.loo)}</dd>
      <dt>Without the two costliest</dt><dd>${n >= 2 ? costHtml(g.loo2) : missing('Needs at least two occurrences')}</dd>
      <dt>Gate “${esc(g4.name)}”</dt><dd>${g4.pass ? chip('Passes', 'ok') : chip('Fails', 'warn')}</dd>
    </dl>
    ${allOfIt}
    <p class="inspect-note muted">${thresholds}</p>
    ${exState}
    ${replaces ? '<p class="inspect-note muted">This replaces the trades you unticked with the costliest one.</p>' : ''}
    <div class="btn-row">${worstBtn}${resetBtn}</div>`,
  });
}

// ---------- sensitivity ----------

function sensitivityPanel(x) {
  const { habit: h, sensitivity: s } = x;
  const k = x.excluded.length;
  const them = k === 1 ? 'this trade' : 'these trades';
  const after = `Without ${plural(k, 'trade')}`;
  const before = h.gates.pass;
  const wasConfirmed = h.status === 'confirmed';
  let verdict;
  if (s.wouldConfirm) verdict = chip('Passes all gates', 'accent');
  else if (s.gates.pass) verdict = chip('Passes gates · too few trades', 'warn');
  else verdict = chip(`Fails “${s.gates.failed.name}”`, 'warn');
  const rows = [
    ['Occurrences', `<span class="num">${h.occurrences}</span>`, `<span class="num">${s.occurrences}</span>`],
    ['Different days', `<span class="num">${h.gates.days}</span>`, `<span class="num">${s.gates.days}</span>`],
    ['Excess loss', costHtml(h.cost), costHtml(s.cost)],
    ['Without the costliest trade', costHtml(h.gates.loo), costHtml(s.gates.loo)],
    ['Evidence gates passed', `<span class="num">${passed(h.gates)} of ${GATE_COUNT}</span>`, `<span class="num">${passed(s.gates)} of ${GATE_COUNT}</span>`],
    ['Result', habitStatusChip(h, CONFIG.maxHabits), verdict],
  ];
  let message;
  if (s.gates.pass && s.thin) {
    message = `${before ? 'It still passes' : 'It now passes'} the gates, but this period has too few trades (under ${CONFIG.minUnits}) to call anything a habit.`;
  } else if (s.gates.pass) {
    message = wasConfirmed
      ? `Still confirmed: without ${them} the habit passes all four gates, with an excess loss of ${costPlain(s.cost)}.`
      : `${before ? 'Still passes' : 'Passes'} all four gates on its own without ${them}. This check does not re-run the de-duplication against other habits.`;
  } else {
    const lead = wasConfirmed ? 'Would no longer be confirmed.' : before ? 'No longer passes the gates.' : 'Still does not pass.';
    message = `${lead} ${gateReason(s.gates.failed, s)}`;
  }
  // Excluding trades raises the cost only when they had been offsetting it (H3 contributions are never negative).
  let rose = '';
  if (s.cost >= 0.5 && s.cost > Math.max(h.cost, 0) + 0.5 && baseKind(s.costing) !== 'max') {
    const did = baseKind(s.costing) === 'usual' ? `did better than ${benchmark(s.costing)}` : 'made a profit';
    rose = h.cost >= 0.5
      ? `The excess loss is larger without ${them}: together ${k === 1 ? 'it' : 'they'} ${did}, which had been offsetting part of it.`
      : `Without ${them} there is an excess loss: together ${k === 1 ? 'it' : 'they'} ${did}, which had been offsetting it.`;
    rose = `<p class="inspect-note">${esc(rose)}</p>`;
  }
  return panel({
    title: 'Sensitivity check',
    subtitle: `${plural(k, 'trade')} excluded · before → after`,
    tone: 'accent',
    body: `<div class="inspect-sens">
      <div>${table({
        columns: [{ key: 'm', label: 'Measure' }, { key: 'b', label: 'As reported', align: 'right' }, { key: 'a', label: after, align: 'right' }],
        rows,
        caption: 'Habit figures as reported and with the excluded trades removed',
      })}</div>
      <div>
        <h3 class="inspect-h3">Gates after excluding</h3>
        ${gateList(s.gates)}
        <p class="inspect-verdict"${x.announce ? ' data-announce' : ''}>${esc(message)}</p>
        ${rose}
        <p class="inspect-note muted">Excluded trades stop counting as occurrences; the comparison baseline stays the same.</p>
        <div class="btn-row">${softButton('Reset', { action: 'resetExclusions', ariaLabel: 'Reset the sensitivity check: include all trades again' })}</div>
      </div>
    </div>`,
  });
}

// ---------- evidence gates ----------

function gatesPanel(x) {
  const { habit: h, analysis: a } = x;
  const g = h.gates;
  const failed = g.checks.filter((c) => !c.pass);
  let reasons;
  if (!h.occurrences) reasons = '<p class="inspect-verdict">Not seen this period, so no gate can pass.</p>';
  else if (failed.length) reasons = `<h3 class="inspect-h3">Why ${failed.length === 1 ? 'a gate' : 'gates'} failed</h3><ul class="inspect-list">${failed.map((c) => `<li><strong>${esc(c.name)}.</strong> ${esc(gateReason(c, h))}</li>`).join('')}</ul>`;
  else if (h.status === 'overlap' && h.overlap > 0) reasons = '<p class="inspect-verdict">Passed all four gates on its own, before de-duplication.</p>';
  else reasons = `<p class="inspect-verdict">Passed all four gates${h.status === 'confirmed' && g.confidence ? ` with ${esc(g.confidence.toLowerCase())} evidence` : ''}.</p>`;
  const floor = `The material bar is the larger of ${inr(CONFIG.gates.minCost)} and ${formatPct(CONFIG.gates.lossShare, { digits: 0 })} of this period’s total losses after charges (${inr(a.summary.grossLosses)}): ${inr(a.summary.floor)}.`;
  const strong = `Strong evidence needs ${CONFIG.gates.strongN} or more occurrences and at least ${inr(CONFIG.gates.looMinCost)} left without the two costliest trades.`;
  return panel({
    title: 'Evidence gates',
    subtitle: 'All four must pass before a behaviour is called a habit',
    body: `${gateList(g)}${reasons}${recheckGates(h)}<p class="inspect-note muted">${esc(floor)} ${esc(strong)}</p>`,
  });
}

// For a behaviour that shares trades, the engine's de-duplicated re-check of the same four gates.
function recheckGates(h) {
  const r = recheckOf(h);
  const k = h.overlap ?? 0;
  if (h.status !== 'overlap' || !k || !r) return '';
  const failed = r.gates.checks.filter((c) => !c.pass);
  let verdict;
  if (!r.occurrences) verdict = '<p class="inspect-verdict">No occurrences are left, so no gate can pass.</p>';
  else if (failed.length) verdict = `<ul class="inspect-list">${failed.map((c) => `<li><strong>${esc(c.name)}.</strong> ${esc(gateReason(c, r))}</li>`).join('')}</ul>`;
  else verdict = '<p class="inspect-verdict">Still passes all four gates.</p>';
  return `<h3 class="inspect-h3">Re-checked without the ${plural(k, 'shared trade')}</h3>
    <p class="inspect-note muted">${esc(`${recheckFigures(r)} remain once each shared trade counts only under the habit it was assigned to.`)}</p>
    ${gateList(r.gates)}${verdict}`;
}

// ---------- limits ----------

function limitsPanel(x) {
  const items = x.def.cannotConclude.map((t) => `<li>${esc(t)}</li>`).join('');
  return panel({
    title: 'What this cannot tell you',
    body: `<ul class="inspect-list">${items}</ul>
      <p class="inspect-note">This is an association, not proof that the behaviour caused the loss.</p>
      <p class="inspect-note">No market prices are used, so nothing here says what would have happened instead.</p>`,
  });
}

// ---------- act on this ----------

function actPanel(state, x) {
  const { habit: h } = x;
  const tpl = GUARDRAILS[h.id];
  if (!tpl) return '';
  const rule = state.guardrails?.[state.datasetId]?.[h.id] ?? null;
  const next = selectNextPeriod(state);
  const local = '<p class="inspect-note muted">A rule is a limit you set for yourself; the app only measures how often your own trades in this data break it. Nothing is sent to Nubra or any broker.</p>';
  const ruleState = rule ? ` (${rule.status === 'paused' ? 'paused' : 'active'})` : '';
  if (h.status === 'confirmed') {
    const label = rule ? 'Edit guardrail' : 'Set guardrail';
    const lead = rule
      ? `You have set “${tpl.title}”${ruleState} for this habit. Edit it to change its settings.`
      : `This habit passed every evidence gate. The matching guardrail is “${tpl.title}”.`;
    const compare = next
      ? `<p class="inspect-note">${esc(next.label)} is also in the data. ${linkTo('Compare periods', 'compare')} shows how often this behaviour happened per chance in each month, with the sample sizes behind it.</p>`
      : '<p class="inspect-note muted">A later month is needed to see whether this behaviour changed.</p>';
    return panel({
      title: 'Act on this',
      body: `<p class="inspect-act-lead">${esc(lead)}</p>${compare}${local}
        <div class="btn-row">${button(label, { action: 'openGuardrail', data: { 'habit-id': h.id }, variant: 'primary', id: 'inspect-guard', ariaLabel: `${label} for ${h.name}` })}</div>`,
    });
  }
  const why = isLimitCut(h)
    ? `It passed every gate but is outside the ${CONFIG.maxHabits} habits reported this period, so a rule for it is a personal choice.`
    : 'This period’s evidence does not single this behaviour out as a habit, so a rule for it is a personal choice.';
  const lead = rule ? `You have set “${tpl.title}”${ruleState} for this behaviour. ${why}` : `${why} The matching rule is “${tpl.title}”.`;
  const label = rule ? 'Edit your rule' : 'Set an optional rule';
  return panel({
    title: 'Act on this',
    body: `<p class="inspect-act-lead">${esc(lead)}</p>${local}
      <div class="btn-row">${button(label, { action: 'openGuardrail', data: { 'habit-id': h.id }, variant: 'secondary', id: 'inspect-guard', ariaLabel: `${label} for ${h.name}` })}</div>`,
  });
}
