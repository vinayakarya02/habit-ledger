// Compare periods (module F): month-over-month behaviour tracking.
// Every behaviour is compared as a rate per chance (occurrences ÷ chances), so trading less is never
// read as improving. Verdicts, intervals and p-values come from engine.compareHabit via selectComparison;
// guardrail figures come from engine.measureGuardrail, and whether a month came after a rule was saved
// comes from store.rulePhase. This view only lays the numbers out.

import { esc, amount, missing, button, chip, verdictChip, verdictLabel, panel, callout, emptyState, pageHeader, select, sr } from '../ui/components.js';
import { rateCompareChart } from '../ui/charts.js';
import { formatPct, formatPP, formatRel, formatMonth, formatDate, chanceText, plural, isNum } from '../format.js';
import { getDataset, selectPeriods, selectComparison, selectAnalysis, rulePhase } from '../store.js';
import { CONFIG, HABITS, HABIT_IDS, GUARDRAILS, measureGuardrail } from '../engine.js';

const CC = CONFIG.compare;
const pct100 = (x) => `${Math.round(x * 100)}%`;
const oneIn = (p) => `1 in ${Math.round(1 / p)}`;
const shortMonth = (key) => formatMonth(key, { short: true });
const pValue = (p) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);

// A difference between two rates, written out in full ("−21.7 percentage points"), never a bare "pp".
const ppNumber = (x) => formatPP(x).replace(/\s*pp$/, '');
const ppHtml = (x) => `<span class="num">${esc(ppNumber(x))}</span> <span class="cmp-unit">percentage points</span>`;

// Most informative verdicts first; "Not applicable" rows are listed compactly at the end.
const VERDICT_ORDER = ['Worsening', 'Improving', 'No clear change', 'Inconclusive', 'Not seen'];
// Summary counts use the displayed label, so "Possibly improving" is never counted as a clear improvement.
const SUMMARY_LABELS = [
  ['Improving', 'ok', true],
  ['Possibly improving', 'neutral', false],
  ['Worsening', 'danger', true],
  ['Possibly worsening', 'neutral', false],
  ['No clear change', 'neutral', true],
  ['Inconclusive', 'muted', true],
];

export function render(state) {
  const ds = getDataset(state);
  const periods = selectPeriods(state);
  const eyebrow = `${esc(ds.name)} · ${ds.kind === 'sample' ? 'synthetic sample data' : 'your import, this browser tab only'}`;
  const header = pageHeader({
    eyebrow,
    title: 'Compare periods',
    lead: `Tracks how often each behaviour happened per chance (for example, re-entries ÷ ${esc(HABITS.H1.chances)}), so trading less does not count as improving. Every rate shows its sample size, because a few trades can move it a lot.`,
  });

  if (periods.length === 0) {
    return `<div class="stack cmp">${header}${panel({ body: emptyState({
      title: 'No closed trades to compare',
      body: 'This data has no closed trades in any month. Import order history that covers at least two calendar months.',
      action: button('Go to import', { action: 'navigate', data: { view: 'import' }, variant: 'primary' }),
    }) })}</div>`;
  }

  if (periods.length === 1) {
    const only = periods[0];
    const body = ds.kind === 'import'
      ? `"${esc(ds.name)}" only has trades in ${esc(only.label)} (${esc(plural(only.trades, 'trade'))}). A comparison needs a second month: import a CSV with another month's orders and choose "Add to ${esc(ds.name)}" under "Import as", or import one file whose orders cover at least two calendar months.`
      : `This data only has trades in ${esc(only.label)} (${esc(plural(only.trades, 'trade'))}). A comparison needs a second month.`;
    return `<div class="stack cmp">${header}${panel({ body: emptyState({
      title: 'A second month is needed',
      body,
      action: button(ds.kind === 'import' ? 'Import another month' : 'Import a longer history', { action: 'navigate', data: { view: 'import' }, variant: 'primary' }),
    }) })}</div>`;
  }

  const c = selectComparison(state);
  const parts = [header, pickers(state, periods)];
  if (!c) return `<div class="stack cmp">${parts.join('')}</div>`;

  if (c.same) {
    // The callout's title and body sit side by side with no space between them, so the live region reads
    // a separate, properly spaced sentence instead of the callout's text.
    parts.push(`<p hidden data-announce>The same period is selected twice. Both pickers are set to ${esc(c.fromLabel)}, so there is nothing to compare.</p>`);
    parts.push(callout({
      tone: 'warn',
      title: 'The same period is selected twice',
      body: `<p>Both pickers are set to ${esc(c.fromLabel)}, so there is nothing to compare. Choose a different month in "From" or "To".</p>`,
    }));
    return `<div class="stack cmp">${parts.join('')}</div>`;
  }

  parts.push(...contextCallouts(c));
  parts.push(summary(c));
  parts.push(behaviours(state, c));
  parts.push(guardrailSection(state, c));
  return `<div class="stack cmp">${parts.join('')}</div>`;
}

// ---------- period pickers ----------

function pickers(state, periods) {
  const options = periods.map((p) => ({ value: p.key, label: `${p.label} · ${plural(p.trades, 'trade')}` }));
  const meta = (key, id) => {
    const p = periods.find((x) => x.key === key);
    if (!p) return `<p class="cmp-meta small muted" id="${id}">${missing('Not in the data')}</p>`;
    const thin = p.trades < CONFIG.minUnits ? ` · <span class="cmp-thin">fewer than ${CONFIG.minUnits} trades</span>` : '';
    const days = selectAnalysis(state, key).summary.tradingDays;
    return `<p class="cmp-meta small muted" id="${id}">${esc(p.firstDay === p.lastDay ? formatDate(p.firstDay, { year: false }) : `${formatDate(p.firstDay, { year: false })}–${formatDate(p.lastDay, { year: false })}`)} · ${esc(plural(days, 'trading day'))}${thin}</p>`;
  };
  const from = state.compare.from;
  const to = state.compare.to;
  const body = `<div class="cmp-pickers">
    <div class="cmp-from">${select({ id: 'compare-from', label: 'From', value: from, options, action: 'setCompare', data: { which: 'from', param: 'key' }, describedBy: 'compare-from-meta' })}</div>
    <div class="cmp-swap">${button('Swap', { action: 'swapCompare', id: 'compare-swap', ariaLabel: 'Swap the From and To periods', disabled: from === to })}</div>
    <div class="cmp-to">${select({ id: 'compare-to', label: 'To', value: to, options, action: 'setCompare', data: { which: 'to', param: 'key' }, describedBy: 'compare-to-meta' })}</div>
    <div class="cmp-from-meta">${meta(from, 'compare-from-meta')}</div>
    <div class="cmp-to-meta">${meta(to, 'compare-to-meta')}</div>
  </div>`;
  return panel({ title: 'Periods', subtitle: 'Any two months of this trader\'s history. Rates are compared from the first to the second. This page uses its own From and To months; the review period in the top bar does not apply here.', body });
}

function contextCallouts(c) {
  const out = [];
  if (c.from > c.to) {
    out.push(callout({
      tone: 'info',
      title: '"From" is later than "To"',
      body: `<p>Changes read backwards in time: "Improving" here means the rate was lower in ${esc(c.toLabel)} than in ${esc(c.fromLabel)}. Use Swap to read forwards.</p>`,
    }));
  }
  const thin = [[c.fromLabel, c.a1], [c.toLabel, c.a2]].filter(([, a]) => a.summary.thin);
  if (thin.length) {
    const list = thin.map(([label, a]) => `${esc(label)} has ${esc(plural(a.summary.units, 'closed trade'))}`).join('; ');
    out.push(callout({
      tone: 'warn',
      title: 'A thin month',
      body: `<p>${list}. No habit is confirmed in a month with fewer than ${CONFIG.minUnits} trades. Rates are still shown, but any behaviour with fewer than ${CC.minOpp} chances in either month gets no verdict.</p>`,
    }));
  }
  return out;
}

// ---------- summary and rules ----------

function summary(c) {
  const count = (label) => c.rows.filter((r) => verdictLabel(r.verdict, r.strength) === label).length;
  const chips = SUMMARY_LABELS
    .map(([label, tone, always]) => [label, tone, always, count(label)])
    .filter(([, , always, n]) => always || n > 0)
    .map(([label, tone, , n]) => chip(`${n} ${label.toLowerCase()}`, tone))
    .join(' ');
  const notSeen = count('Not seen');
  const na = count('Not applicable');
  const extra = [notSeen ? `${notSeen} not seen in either month` : '', na ? `${na} not applicable (no chances)` : ''].filter(Boolean).join(' · ');
  const body = `<div class="chip-row cmp-counts" role="group" aria-label="Verdict counts" data-announce>${sr(`${c.fromLabel} to ${c.toLabel}:`)} ${chips}${extra ? ` <span class="small muted">${esc(extra)}</span>` : ''}</div>
    <p class="small cmp-disclaimer">A verdict describes these two months of trades: a measured change in how often a behaviour happened per chance. It is not proof that a guardrail, or anything else, changed the behaviour, and a month with few chances can swing by chance alone.</p>
    ${rules(c)}`;
  return panel({ title: 'What changed', subtitle: `${esc(c.fromLabel)} → ${esc(c.toLabel)} · ${HABIT_IDS.length} behaviours checked`, body });
}

function rules(c) {
  // The one-sided p-values live here only; each card states the chance in words.
  const tested = c.rows.filter((r) => isNum(r.p) && r.absChange !== 0);
  const tests = tested.length
    ? `<li><strong>Test results for these two months</strong> (one-sided Fisher exact test):
        <ul class="cmp-pvals">${tested.map((r) => `<li>${esc(r.name)}: <span class="num">${esc(pValue(r.p))}</span> (chance of a ${r.absChange < 0 ? 'drop' : 'rise'} this large if nothing had changed: ${esc(chanceText(r.p))})</li>`).join('')}</ul>
      </li>`
    : '';
  return `<details class="callout callout-info cmp-rules">
    <summary>How a verdict is decided</summary>
    <ul>
      <li><strong>Improving</strong>: the rate fell by at least ${pct100(CC.improve)} of its earlier level (relative), and a fall that large would show up less than ${oneIn(CC.alpha)} times by chance if nothing had changed (one-sided Fisher exact test, p &lt; ${CC.alpha}).</li>
      <li><strong>Worsening</strong>: the rate rose by at least ${pct100(CC.worse)} relative (or from zero), with the same bar of less than ${oneIn(CC.alpha)}.</li>
      <li><strong>Possibly improving</strong> / <strong>Possibly worsening</strong>: the change passes the bar above, but a change that large would still show up between ${oneIn(CC.strongAlpha)} and ${oneIn(CC.alpha)} times by chance (p from ${CC.strongAlpha} to ${CC.alpha}). Treat it as a hint, not a result. Below ${oneIn(CC.strongAlpha)} (p &lt; ${CC.strongAlpha}) the verdict is given without "possibly".</li>
      <li><strong>No clear change</strong>: the move is smaller than that, or too likely to be chance.</li>
      <li><strong>Inconclusive</strong>: fewer than ${CC.minOpp} chances in either month. No direction is given.</li>
      <li><strong>Not seen</strong> / <strong>Not applicable</strong>: the behaviour did not occur in either month, or there were no chances for it at all.</li>
      <li><strong>Percentage points</strong>: the change in a rate is the later rate minus the earlier one. From 30% to 10% is −20 percentage points, which is a 67% relative fall.</li>
      <li><strong>90% range</strong>: a Wilson score interval around each rate, showing where the underlying rate plausibly sits given the sample size. Wide ranges mean few chances. Ranges can overlap even when a verdict is given, because the verdict uses the direct test above rather than comparing ranges by eye.</li>
      <li><strong>Counting</strong>: rates and excess losses here count every trade each behaviour's check flagged, before the de-duplication used for confirmed habits, so one trade can appear under two behaviours.</li>
      <li><strong>Excess loss</strong> is shown for context but never decides the verdict, because it is measured against a comparison that also differs between months: your other trades in the same month, or, for hedge removal, each spread's own defined maximum loss.</li>
      ${tests}
    </ul>
  </details>`;
}

// ---------- behaviour rows ----------

function behaviours(state, c) {
  const saved = state.guardrails[state.datasetId] ?? {};
  const order = (r) => VERDICT_ORDER.indexOf(r.verdict);
  const sorted = (rows) => [...rows].sort((x, y) => order(x) - order(y) || HABIT_IDS.indexOf(x.id) - HABIT_IDS.indexOf(y.id));
  const applicable = c.rows.filter((r) => r.verdict !== 'Not applicable');
  const tracked = sorted(applicable.filter((r) => r.tracked));
  const others = sorted(applicable.filter((r) => !r.tracked));
  const na = c.rows.filter((r) => r.verdict === 'Not applicable');
  const cards = (rows) => rows.map((r) => card(r, c, saved[r.id] ?? null)).join('');

  const trackedBody = tracked.length
    ? `<div class="cmp-list">${cards(tracked)}</div>`
    : `<p class="small muted cmp-group-empty">No behaviour was a confirmed habit in ${esc(c.fromLabel)} or ${esc(c.toLabel)}, so there is nothing to track here yet. Every behaviour is listed under "Other behaviours".</p>`;
  const trackedSection = group({
    id: 'compare-tracked-title',
    title: 'Habits you are tracking',
    sub: `Behaviours confirmed as a habit in ${esc(c.fromLabel)}, ${esc(c.toLabel)} or both.`,
    body: trackedBody,
  });

  if (!others.length && !na.length) return trackedSection;
  const naBlock = na.length
    ? panel({
      title: 'Not applicable in these months',
      headingLevel: 3,
      body: `<ul class="cmp-na">${na.map((r) => `<li><strong>${esc(r.name)}</strong> <span class="muted">${esc(r.explanation)}</span></li>`).join('')}</ul>`,
    })
    : '';
  const otherSection = group({
    id: 'compare-other-title',
    title: 'Other behaviours',
    sub: 'None of these was a confirmed habit in either month, so their changes are context only.',
    body: `<div class="cmp-list">${cards(others)}${naBlock}</div>`,
  });
  return `${trackedSection}${otherSection}`;
}

function group({ id, title, sub, body }) {
  return `<section class="cmp-section" aria-labelledby="${id}">
    <header class="cmp-section-head"><h2 class="section-title cmp-section-title" id="${id}">${esc(title)}</h2><p class="small muted cmp-section-sub">${sub}</p></header>
    ${body}
  </section>`;
}

function card(r, c, rule) {
  const def = HABITS[r.id];
  const tags = [];
  if (r.confirmedIn?.before) tags.push(chip(`Confirmed habit in ${c.fromLabel}`, 'danger'));
  if (r.confirmedIn?.after) tags.push(chip(`Confirmed habit in ${c.toLabel}`, 'danger'));
  if (rule) tags.push(chip(rule.status === 'active' ? 'Guardrail saved · active' : 'Guardrail saved · paused', rule.status === 'active' ? 'accent' : 'muted'));

  const figs = `<dl class="cmp-figs">
    ${sideFig(r.before, c.fromLabel, r.chances)}
    ${sideFig(r.after, c.toLabel, r.chances)}
    ${changeFig(r)}
  </dl>`;
  const chart = `<figure class="cmp-chart">${rateCompareChart(r, { fromLabel: shortMonth(c.from), toLabel: shortMonth(c.to) })}<figcaption class="small muted">Share of ${esc(r.chances)} in each month. Whiskers show the 90% range.</figcaption></figure>`;

  // The engine's explanation already carries the "by chance" sentence for Improving, Worsening and
  // "too likely to call" rows; only state the chance in words when the explanation does not. The
  // p-value itself is listed in "How a verdict is decided".
  const explainsChance = /by chance/.test(String(r.explanation ?? ''));
  const chanceLine = isNum(r.p) && r.absChange !== 0 && !explainsChance
    ? `<p class="small cmp-chance"><span class="muted">Chance of a change this large if nothing had changed:</span> ${esc(chanceText(r.p))}</p>`
    : '';
  const caveat = def.costModel === 'beyond-max-loss'
    ? `Loss beyond ${esc(lowerFirst(def.comparison))}, shown for context only; it never decides the verdict.`
    : `Excess loss associated with these trades compared with ${esc(lowerFirst(def.comparison))}. That comparison group changes from month to month too, so it is context only and never decides the verdict.`;
  const cost = r.verdict === 'Not seen'
    ? ''
    : `<p class="small muted cmp-cost"><span class="cmp-cost-label">Excess loss:</span> <span class="cmp-cost-vals">${costText(r.before)} → ${costText(r.after)}</span>. ${caveat}</p>`;

  const tentative = verdictLabel(r.verdict, r.strength) !== r.verdict;
  const tone = tentative ? '' : r.verdict === 'Worsening' ? 'danger' : r.verdict === 'Improving' ? 'ok' : '';
  return panel({
    id: `compare-row-${r.id}`,
    title: esc(r.name),
    subtitle: esc(def.chanceNote),
    headingLevel: 3,
    actions: verdictChip(r.verdict, r.strength),
    tone,
    body: `${tags.length ? `<div class="chip-row cmp-tags">${tags.join('')}</div>` : ''}
      <div class="cmp-body">${figs}${chart}</div>
      <div class="cmp-notes"><p class="cmp-explain">${esc(r.explanation)}</p>${chanceLine}${cost}</div>`,
  });
}

function sideFig(s, label, chances) {
  const few = s.opp < CC.minOpp ? `<dd class="cmp-few">${chip(s.opp === 0 ? 'No chances' : `Under ${CC.minOpp} chances`, 'warn')}</dd>` : '';
  const sub = isNum(s.rate)
    ? `${esc(formatPct(s.rate))} of ${esc(chances)}${s.ci ? `<br><span class="muted">90% range <span class="num">${esc(formatPct(s.ci.lo, { digits: 0 }))}–${esc(formatPct(s.ci.hi, { digits: 0 }))}</span></span>` : ''}`
    : `No ${esc(chances)} in this month`;
  return `<div class="cmp-fig">
    <dt class="stat-label">${esc(label)}</dt>
    <dd class="stat-value num"><span aria-hidden="true">${s.n} / ${s.opp}</span>${sr(`${s.n} of ${s.opp} ${chances}`)}</dd>
    <dd class="stat-sub">${sub}</dd>${few}
  </div>`;
}

function changeFig(r) {
  let value;
  let sub;
  if (isNum(r.absChange)) {
    value = ppHtml(r.absChange);
    const span = `From ${esc(formatPct(r.before.rate))} to ${esc(formatPct(r.after.rate))}`;
    if (r.verdict === 'Not seen') sub = 'Not seen in either month';
    else if (r.absChange === 0) sub = `Unchanged at ${esc(formatPct(r.before.rate))}`;
    else if (isNum(r.relChange)) sub = `${span} (${esc(formatRel(r.relChange))} relative)`;
    else sub = `${span}. From zero, so no relative change`;
  } else {
    value = missing(r.verdict === 'Inconclusive' ? `No change is computed with fewer than ${CC.minOpp} chances in a month` : 'No chances in either month');
    sub = r.verdict === 'Inconclusive' ? `Needs ${CC.minOpp}+ chances in each month` : 'No chances';
  }
  return `<div class="cmp-fig cmp-fig-change">
    <dt class="stat-label">Change in rate</dt>
    <dd class="stat-value cmp-change-value">${value}</dd>
    <dd class="stat-sub">${sub}</dd>
  </div>`;
}

function costText(s) {
  if (s.opp === 0) return missing('No chances in this month');
  if (s.n === 0) return '<span class="muted">not seen</span>';
  return s.cost > 0 ? amount(s.cost) : '<span class="muted">no excess loss</span>';
}

const lowerFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

// ---------- saved guardrails, measured in both months ----------

// A month counts as "after" a rule only when every trade in it was opened after the rule's current settings
// were saved (store.rulePhase). Any other month is a what-if on trades that already existed, so it never
// says "kept" or "broken"; it only says how often the rule's condition happened.
function guardrailSection(state, c) {
  const saved = state.guardrails[state.datasetId] ?? {};
  const ids = HABIT_IDS.filter((id) => saved[id]);
  const manage = button('Manage guardrails', { action: 'navigate', data: { view: 'guardrails' }, size: 'sm' });
  if (!ids.length) {
    return panel({
      title: 'Saved guardrails in these months',
      body: emptyState({
        title: 'No guardrails saved yet',
        body: `Save a rule for ${esc(getDataset(state).name)} on the Guardrails page to see how often its condition happened in each month.`,
        action: button('Go to guardrails', { action: 'navigate', data: { view: 'guardrails' } }),
      }),
    });
  }
  const a1 = selectAnalysis(state, c.from);
  const a2 = selectAnalysis(state, c.to);
  const items = ids.map((id) => {
    const rule = saved[id];
    const t = GUARDRAILS[id];
    const m1 = measureGuardrail(a1, id, rule.params);
    const m2 = measureGuardrail(a2, id, rule.params);
    const ph1 = rulePhase(state, rule, c.from);
    const ph2 = rulePhase(state, rule, c.to);
    const change = m1.measurable && m2.measurable
      ? { value: ppHtml(m2.rate - m1.rate), sub: m2.rate === m1.rate ? `Unchanged at ${esc(formatPct(m1.rate))} of ${esc(HABITS[id].chances)}` : `From ${esc(formatPct(m1.rate))} to ${esc(formatPct(m2.rate))} of ${esc(HABITS[id].chances)}` }
      : { value: missing(`Needs ${HABITS[id].chances} in both months`), sub: 'Needs chances in both months' };
    const status = rule.status === 'active' ? chip('Active', 'accent') : chip('Paused', 'muted');
    const settingsKey = rule.settingsPeriod ?? rule.createdPeriod;
    const set = settingsKey ? `<p class="small muted">Settings chosen while reviewing ${esc(formatMonth(settingsKey))}</p>` : '';
    return `<li class="cmp-guard">
      <div class="cmp-guard-rule">
        <div class="cmp-guard-head"><h3 class="cmp-guard-title">${esc(t.title)}</h3>${status}</div>
        <p class="small">${esc(t.rule(rule.params))}</p>
        <p class="small muted">Measured as: ${esc(lowerFirst(t.measure(rule.params)))}</p>
        ${set}
      </div>
      <dl class="cmp-figs cmp-guard-figs">
        ${guardFig(m1, c.from, ph1, id, rule)}
        ${guardFig(m2, c.to, ph2, id, rule)}
        <div class="cmp-fig cmp-fig-change"><dt class="stat-label">Change in rate</dt><dd class="stat-value cmp-change-value">${change.value}</dd><dd class="stat-sub">${change.sub}</dd></div>
      </dl>
    </li>`;
  });
  const body = `<ul class="cmp-guards" aria-label="Saved guardrails measured in ${esc(c.fromLabel)} and ${esc(c.toLabel)}">${items.join('')}</ul>
  <p class="small muted cmp-guard-note">Each rule is measured with its current settings, which can differ from the fixed definitions used for the behaviour rates above. A month counts as after the rule only when every trade in it was opened after those settings were saved; any other month is a what-if on trades already in the file. Paused rules are still measured. No significance test is run here, a change between months is not evidence of what a rule did, and nothing here is sent to Nubra or any broker.</p>`;
  return panel({
    title: 'Saved guardrails in these months',
    subtitle: `How often each saved rule's condition happened in ${esc(c.fromLabel)} and ${esc(c.toLabel)}, per chance`,
    actions: manage,
    body,
  });
}

function guardFig(m, key, phase, habitId, rule) {
  const tag = phase === 'after' ? chip('After the rule was saved', 'neutral') : chip('What-if', 'muted');
  if (!m.measurable) {
    // engine m.note speaks of compliance, which only fits a month after the rule was saved.
    const note = phase === 'after' ? m.note : `No ${HABITS[habitId].chances} in this month, so how often the rule's condition happened can't be measured.`;
    return `<div class="cmp-fig"><dt class="stat-label">${esc(shortMonth(key))}</dt><dd class="cmp-phase">${tag}</dd><dd class="stat-value">${missing(note)}</dd><dd class="stat-sub">No ${esc(HABITS[habitId].chances)} in this month</dd></div>`;
  }
  const kept = m.opportunities - m.violations;
  const sub = phase === 'after'
    ? `${m.violations === 0 ? 'No breaks' : esc(plural(m.violations, 'break'))} in ${esc(plural(m.opportunities, 'chance'))} · kept in ${kept === m.opportunities ? 'all of them' : kept === 0 ? 'none of them' : `the other ${kept}`}`
    : `${m.violations === 0 ? `Did not happen in any of ${esc(plural(m.opportunities, 'chance'))}` : `Happened ${esc(plural(m.violations, 'time'))} in ${esc(plural(m.opportunities, 'chance'))}`} <span class="cmp-whatif">(measured on trades already in the file, before the rule's current settings were saved)</span>`;
  // Pause history is not recorded, so a paused rule's "after" month may include days it was switched off.
  const paused = phase === 'after' && rule.status !== 'active'
    ? ' <span class="cmp-whatif">(the rule is paused now; when it was paused is not recorded)</span>'
    : '';
  return `<div class="cmp-fig"><dt class="stat-label">${esc(shortMonth(key))}</dt><dd class="cmp-phase">${tag}</dd><dd class="stat-value"><span class="num">${esc(formatPct(m.rate))}</span></dd><dd class="stat-sub">${sub}${paused}</dd></div>`;
}
