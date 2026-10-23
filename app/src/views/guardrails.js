// Personal guardrail center: one rule template per behaviour, ordered by this period's evidence,
// with saved settings, Nubra capability status and compliance measured from the trader's own fills.
// Also owns the rule editor dialog (overlay), driven by state.guardEdit.

import {
  esc, amount, missing, button, chip, habitStatusChip, def, stat, panel, callout, emptyState, pageHeader, select, meter,
} from '../ui/components.js';
import { getDataset, selectAnalysis, selectGuardrails, selectPrevPeriod, selectNextPeriod } from '../store.js';
import { HABITS, CONFIG, GUARDRAILS, measureGuardrail, validateGuardrailParams } from '../engine.js';
import { formatMonth, formatLots, formatPct, plural, isNum } from '../format.js';

// What one "chance" is for each rule's compliance measure: the habit's own chance (HABITS), except the
// lot cap, which measureGuardrail checks on every trade, not only on trades opened after two wins.
const RULE_CHANCE = { H4: ['trade', 'trades'] };
const chances = (id, n) => {
  const [one, many] = RULE_CHANCE[id] ?? [HABITS[id].chance, HABITS[id].chances];
  return n === 1 ? one : many;
};

// Near misses read before behaviours that were simply not seen; a behaviour left out only by the
// reporting limit reads first of all.
const STATUS_ORDER = { confirmed: 0, overlap: 1, insufficient: 2, 'not-costly': 3, 'not-seen': 4 };
const statusOrder = (h) => (h.status === 'overlap' && h.limitCut ? 0.5 : STATUS_ORDER[h.status] ?? 9);
const isLimitCut = (h) => h?.status === 'overlap' && h.limitCut === true;

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');
// Row label for a period, and the same period inside a sentence.
const periodName = (key) => (key ? formatMonth(key) : 'Selected period');
const periodPhrase = (key) => (key ? formatMonth(key) : 'the selected period');
const trimNum = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
const withUnit = (v, unit) => (String(unit).startsWith('%') ? `${v}${unit}` : `${v} ${unit}`);

// engine.defaultGuardrailParams suggests a lot cap of ceil(CONFIG.lotCapMultiple × median entry lots). settingNote
// shows this arithmetic only after checking it reproduces the engine's value, so the note can never disagree with the rule.
const LOT_CAP_FACTOR = CONFIG.lotCapMultiple;

// Where a period stands against a saved rule (store.rulePhase), judged by when its trades were opened (not when
// they were imported): it includes trades opened before the rule's current settings were saved (a what-if), or
// every one of them was opened afterwards.
const PHASE_TEXT = {
  'what-if': 'What-if: measured on trades already in the file',
  after: 'After the current settings were saved',
};
const phaseTag = (p) => (PHASE_TEXT[p] ? `<span class="gr-phase gr-phase-${p}">${esc(PHASE_TEXT[p])}</span>` : '');

// ---------- shared pieces (cards and dialog) ----------

function excessLossDef(id) {
  const h = HABITS[id];
  const how = h.costModel === 'beyond-max-loss'
    ? "Loss beyond each spread's own defined maximum loss at entry, added up across the occurrences."
    : `Each occurrence's loss beyond the average result of ${lowerFirst(h.comparison)} (or beyond zero when that average is a gain), added up.`;
  return def('Excess loss', `${how} It is an association, not proof that the behaviour caused the loss.`);
}

// De-duplication: each trade counts toward one habit, while compliance checks every trade. Say how the
// shared trades are counted, so the occurrence count and the break count trace back to each other.
// A confirmed habit's count leaves out trades a higher-ranked habit claimed; an overlap's count (the
// detector's standalone figure) still includes them.
function overlapLine(h) {
  const k = h.overlap;
  if (!(k > 0)) return '';
  const names = (h.overlapWith ?? []).map((n) => `"${n}"`).join(', ') || 'a higher-ranked habit';
  const one = k === 1;
  let text;
  if (h.status === 'confirmed') {
    text = `${plural(k, 'more matching trade')} ${one ? 'is' : 'are'} counted under ${names} instead, so ${one ? 'it is' : 'they are'} left out of this count. Compliance checks every trade against the rule, so its break count can include ${one ? 'it' : 'them'}.`;
  } else {
    const n = h.occurrences;
    const shared = k >= n
      ? (n === 1 ? `Its only trade is also counted under ${names}.` : `All ${n} of its trades are also counted under ${names}.`)
      : `Its ${n} trades include the ${k} also counted under ${names}.`;
    text = `${shared} Compliance checks every trade against the rule, so its break count can include ${one ? 'that one' : 'those'} too.`;
  }
  return `<p class="gr-overlap">${esc(text)}</p>`;
}

function relevance(g, { withLink = true } = {}) {
  const h = g.habit;
  const id = g.habitId;
  if (h.status === 'confirmed') {
    const link = withLink ? `<div class="gr-why-actions"><button type="button" class="link" data-action="inspectHabit" data-habit-id="${esc(id)}">See the evidence</button></div>` : '';
    return `<div class="gr-why"><div class="gr-why-line">Confirmed: ${esc(plural(h.occurrences, 'time'))} on ${esc(plural(h.gates.days, 'day'))}, associated with ${amount(h.cost)} excess loss compared with ${esc(lowerFirst(HABITS[id].comparison))}. ${excessLossDef(id)}</div>${overlapLine(h)}${link}</div>`;
  }
  const link = withLink && h.occurrences > 0
    ? `<div class="gr-why-actions"><button type="button" class="link" data-action="inspectHabit" data-habit-id="${esc(id)}">${h.occurrences === 1 ? 'See the trade' : `See the ${h.occurrences} trades`}</button></div>`
    : '';
  const optional = isLimitCut(h)
    ? `Passed every evidence gate; left out of the confirmed list only by the ${CONFIG.maxHabits}-habit limit.`
    : "Optional: this period's evidence does not single this behaviour out, so the rule is a personal choice.";
  return `<div class="gr-why"><div class="gr-why-line">${esc(h.statusReason ?? '')}</div>${overlapLine(h)}<p class="gr-optional${isLimitCut(h) ? ' is-limit' : ''}">${esc(optional)}</p>${link}</div>`;
}

function behaviour(g) {
  return `<div class="gr-behaviour"><span class="gr-behaviour-name">${esc(g.habit.name)}</span>${habitStatusChip(g.habit, CONFIG.maxHabits)}</div>`;
}

// Only a documented capability carries a snippet (field names from the public docs, placeholder values).
function nubraBlock(nubra, { snippet = false } = {}) {
  const documented = nubra.status === 'documented';
  const tag = documented
    ? chip("Documented in Nubra's public API docs", 'accent')
    : chip('Proposed (not a Nubra feature)', 'warn');
  const code = snippet && documented && nubra.snippet
    ? `<figure class="gr-snippet"><figcaption>Field names as described in Nubra's public API docs; values are placeholders, not a live order.</figcaption><pre><code>${esc(JSON.stringify(nubra.snippet, null, 2))}</code></pre></figure>`
    : '';
  return `<div class="gr-nubra"><div class="chip-row">${tag}</div><p class="gr-nubra-text">${esc(nubra.text)}</p>${code}</div>`;
}

// Built from this view's own chance names: the engine's note names the habit's chances, which differ
// from the rule's for the lot cap (every trade, not only trades after two wins).
const unmeasurable = (id, period) => `No ${chances(id, 0)} in ${period}, so compliance can't be measured.`;

function breaksText(id, m, period) {
  if (!m.measurable) return esc(unmeasurable(id, period));
  return `${esc(plural(m.violations, 'break'))} in ${esc(`${m.opportunities} ${chances(id, m.opportunities)}`)}`;
}

// label: the row's name. period: the period the row measures, as used inside a sentence.
// phase: 'what-if' | 'after' for a saved rule (store.rulePhase), shown as text under the name.
function periodRow(id, m, { label, period = label, tags = '', phase = null, current = false }) {
  const value = m.measurable
    ? `<span class="num gr-pct">${esc(formatPct(m.compliance))}</span>${meter(m.compliance, { label: `Compliance ${formatPct(m.compliance)} in ${period}` })}`
    : missing(unmeasurable(id, period));
  return `<li class="gr-period${current ? ' is-current' : ''}"><div class="gr-period-label"><span>${esc(label)}</span>${tags}${phaseTag(phase)}</div><div class="gr-period-value">${value}</div><div class="gr-period-sub">${breaksText(id, m, period)}</div></li>`;
}

// One sentence for the live region: the compliance result with the setting being edited.
function resultSentence(id, m, period) {
  if (!m.measurable) return unmeasurable(id, period);
  return `With these settings: ${formatPct(m.compliance)} compliance in ${period}, ${plural(m.violations, 'break')} in ${m.opportunities} ${chances(id, m.opportunities)}.`;
}

const complianceDef = () => def('Compliance', 'Share of chances in the period where the rule was kept: 1 − breaks ÷ chances. It is computed from your fills with the rule\'s own settings.');

// ---------- cards ----------

// Names the period that was under review when the rule's current settings were chosen (a label only:
// which periods are what-ifs comes from store.rulePhase, not from month order).
// With no rule, the status line carries the id of the confirm-remove button: after a removal,
// main.js restores focus by id, so keyboard focus lands on this card's "Not set" instead of the page.
function statusLine(rule, id = null) {
  if (!rule) return `<div class="gr-status"${id ? ` id="guardrails-remove-${esc(id)}" tabindex="-1"` : ''}>${chip('Not set', 'muted')}</div>`;
  const key = rule.settingsPeriod ?? rule.createdPeriod ?? null;
  const when = key ? formatMonth(key) : '';
  const tag = rule.status === 'active' ? chip('Active', 'ok') : chip('Paused', 'warn');
  return `<div class="gr-status">${tag}${when ? `<span class="gr-status-note">· settings chosen while reviewing ${esc(when)}</span>` : ''}</div>`;
}

function settingNote(g) {
  if (!g.template.params.length) return 'This rule has no settings.';
  if (g.rule) return 'Your saved setting.';
  const change = 'You can change it when you set up the rule.';
  if (g.habitId === 'H4') {
    const med = g.habit.median;
    const cap = g.params.maxLots;
    if (!(isNum(med) && med > 0)) return `Default setting: there are no closed trades in this period to base a suggestion on. ${change}`;
    const product = LOT_CAP_FACTOR * med;
    if (Math.max(1, Math.ceil(product)) === cap) {
      const result = Number.isInteger(product) ? formatLots(product) : `${trimNum(product)}, rounded up to ${formatLots(cap)}`;
      return `Suggested setting: ${LOT_CAP_FACTOR} × your median entry size this period (${formatLots(med)}) = ${result}. ${change}`;
    }
  }
  return `Default setting. ${change}`;
}

function complianceBlock(state, g) {
  const id = g.habitId;
  const cur = state.periodKey;
  const prevKey = selectPrevPeriod(state)?.key ?? null;
  const nextKey = selectNextPeriod(state)?.key ?? null;
  // A saved rule labels each period by when its trades were opened relative to the current settings'
  // save time (store.rulePhase), never by month order: a later month can still be a what-if.
  const phases = g.rule ? g.phases ?? {} : {};
  const rows = [];
  if (g.compliance.prev) {
    const name = g.prevLabel ?? periodName(prevKey);
    rows.push(periodRow(id, g.compliance.prev, { label: name, period: g.prevLabel ?? periodPhrase(prevKey), phase: phases.prev }));
  }
  rows.push(periodRow(id, g.compliance.current, { label: periodName(cur), period: periodPhrase(cur), tags: chip('Selected', 'accent'), phase: phases.current, current: true }));
  if (g.compliance.next) {
    const name = g.nextLabel ?? periodName(nextKey);
    rows.push(periodRow(id, g.compliance.next, { label: name, period: g.nextLabel ?? periodPhrase(nextKey), phase: phases.next }));
  }
  const shown = [g.compliance.prev && phases.prev, phases.current, g.compliance.next && phases.next].filter(Boolean);
  let whatIf;
  if (!g.rule) {
    whatIf = 'What-if: the rule is not set. Each period is measured on trades already in the file, with the setting shown.';
  } else if (shown.includes('after')) {
    whatIf = `Each period is measured from your fills with this rule's current settings. A what-if period includes trades opened before those settings were saved; a period marked "${PHASE_TEXT.after}" holds only trades opened later. Either way, it shows how often the behaviour happened, not what the rule changed.`;
  } else {
    whatIf = "Each period is measured from your fills with this rule's current settings. Every period here is a what-if: each includes trades opened before those settings were saved. It shows how often the behaviour happened, not what the rule changed.";
  }
  const titleId = `guardrails-comp-${id}`;
  return `<div class="gr-compliance" role="group" aria-labelledby="${titleId}"><div class="gr-comp-head"><h4 id="${titleId}">Compliance by period</h4>${complianceDef()}</div><p class="gr-comp-note">${esc(whatIf)}</p><ul class="gr-periods">${rows.join('')}</ul></div>`;
}

// Removing is a two-step action: the "Remove" toggle opens an inline confirmation (native <details>,
// so it needs no state), and only "Remove rule" dispatches removeGuardrail.
function removeControl(t, id) {
  const confirm = button('Remove rule', { action: 'removeGuardrail', data: { 'habit-id': id }, variant: 'danger', id: `guardrails-remove-${id}`, ariaLabel: `Confirm: remove ${t.title}` });
  return `<details class="gr-remove"><summary class="btn btn-danger" id="guardrails-remove-toggle-${esc(id)}"><span class="gr-remove-closed">Remove<span class="sr-only"> ${esc(t.title)}</span></span><span class="gr-remove-open">Keep rule</span></summary><div class="gr-remove-confirm"><p>${esc(`Remove "${t.title}"? Its settings are deleted from this browser.`)}</p>${confirm}</div></details>`;
}

function card(state, g) {
  const id = g.habitId;
  const t = g.template;
  const rule = g.rule;
  const facts = [
    ['Behaviour addressed', behaviour(g)],
    ['Why it is relevant', relevance(g)],
    [rule ? 'Your rule' : 'The rule', `<p class="gr-rule">${esc(t.rule(g.params))}</p><p class="gr-setting">${esc(settingNote(g))}</p>`],
    ['How compliance is measured', `<p>${esc(t.measure(g.params))}</p>`],
    ['Nubra capability', nubraBlock(t.nubra)],
  ].map(([dt, dd]) => `<div class="gr-fact"><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`).join('');
  const buttons = [
    button(rule ? 'Edit' : 'Set up rule', {
      action: 'openGuardrail', data: { 'habit-id': id }, id: `guardrails-edit-${id}`,
      variant: !rule && g.recommended ? 'primary' : 'secondary',
      ariaLabel: rule ? `Edit ${t.title}` : `Set up rule: ${t.title}`,
    }),
    rule ? button(rule.status === 'active' ? 'Pause' : 'Resume', {
      action: 'setGuardStatus', data: { 'habit-id': id, status: rule.status === 'active' ? 'paused' : 'active' }, id: `guardrails-status-${id}`,
      ariaLabel: `${rule.status === 'active' ? 'Pause' : 'Resume'} ${t.title}`,
    }) : '',
    rule ? removeControl(t, id) : '',
  ].join('');
  const body = `<div class="gr-card-grid"><dl class="gr-facts">${facts}</dl>${complianceBlock(state, g)}</div><div class="gr-card-foot btn-row">${buttons}</div>`;
  return panel({ title: esc(t.title), actions: statusLine(rule, id), body, id: `guardrails-card-${id}`, tone: g.recommended ? 'accent' : '', headingLevel: 3 });
}

function group({ id, title, sub = '', cards = '', empty = '' }) {
  return `<section class="gr-group" aria-labelledby="${id}"><header class="gr-group-head"><h2 class="section-title" id="${id}">${esc(title)}</h2>${sub ? `<p class="gr-group-sub">${sub}</p>` : ''}</header>${cards ? `<div class="gr-list">${cards}</div>` : empty}</section>`;
}

// ---------- view ----------

export function render(state) {
  const a = selectAnalysis(state);
  const ds = getDataset(state);
  const all = selectGuardrails(state);
  const periodLabel = a.summary.periodLabel ?? null;
  const label = periodLabel ?? 'this period';

  const recommended = all.filter((g) => g.recommended).sort((x, y) => (x.habit.rank ?? 9) - (y.habit.rank ?? 9));
  const saved = all.filter((g) => !g.recommended && g.rule);
  const rest = all.filter((g) => !g.recommended && !g.rule)
    .sort((x, y) => statusOrder(x.habit) - statusOrder(y.habit));

  const rules = all.filter((g) => g.rule);
  const active = rules.filter((g) => g.rule.status === 'active').length;
  const paused = rules.length - active;

  const head = pageHeader({
    eyebrow: periodLabel ? `Act · ${esc(periodLabel)}` : 'Act',
    title: 'Guardrails',
    lead: 'Rules you choose for yourself, turned from evidence into a measurable intervention. Compliance is measured from your own fills in each period.',
    actions: button('Compare periods', { action: 'navigate', data: { view: 'compare' } }),
  });

  const safety = callout({
    tone: 'info',
    title: 'This prototype never places trades or changes any brokerage account.',
    body: ds.kind === 'import'
      ? '<p>Saved rules live only in this browser. Rules for an imported file last only for this browser tab, like the import itself.</p>'
      : '<p>Saved rules live only in this browser.</p>',
  });

  const summary = `<div class="stat-grid gr-summary">${[
    stat({ label: 'Recommended', value: `<span class="num">${recommended.length}</span>`, sub: `Confirmed in ${esc(label)}, of ${all.length} behaviours checked` }),
    stat({ label: 'Active rules', value: `<span class="num">${active}</span>`, sub: 'Measured from your fills each period' }),
    stat({ label: 'Paused rules', value: `<span class="num">${paused}</span>`, sub: 'Saved, switched off for now' }),
  ].join('')}</div>`;
  // Live-region source (main.js reads [data-announce]); the dialog carries its own while it is open,
  // so the page only ever has one.
  const announce = state.guardEdit ? '' : `<p hidden data-announce>${esc(`${plural(recommended.length, 'rule')} recommended by ${label}'s evidence. ${plural(active, 'active rule')}, ${paused} paused.`)}</p>`;

  let recEmpty;
  if (a.summary.units === 0) {
    recEmpty = emptyState({ title: 'No closed trades in this period', body: 'There is nothing to measure yet. Import a month of option orders to see which rules the evidence supports.', action: button('Go to import', { action: 'navigate', data: { view: 'import' } }) });
  } else if (a.summary.thin) {
    recEmpty = emptyState({ title: 'Too few trades to recommend a rule', body: `${esc(label)} has ${esc(plural(a.summary.units, 'closed trade'))}. Habits need ${CONFIG.minUnits}+ trades in a period before anything is called a habit, and compliance figures below rest on very few chances.` });
  } else {
    recEmpty = emptyState({ title: 'No rule is recommended for this period', body: `No behaviour passed all four evidence gates in ${esc(label)}. Any rule below can still be set as a personal commitment.` });
  }

  const groups = [
    group({
      id: 'guardrails-recommended',
      title: "Recommended by this period's evidence",
      sub: recommended.length ? (recommended.length === 1 ? `This behaviour passed all four evidence gates in ${esc(label)}. The rule below targets it.` : `These behaviours passed all four evidence gates in ${esc(label)}. Each rule below targets one of them.`) : '',
      cards: recommended.map((g) => card(state, g)).join(''),
      empty: recEmpty,
    }),
    saved.length ? group({
      id: 'guardrails-saved',
      title: 'Your saved rules',
      sub: `Rules you set earlier. ${esc(label)}'s evidence does not confirm ${saved.length === 1 ? 'this behaviour as a habit' : 'these behaviours as habits'}.`,
      cards: saved.map((g) => card(state, g)).join(''),
    }) : '',
    rest.length ? group({
      id: 'guardrails-other',
      title: 'Other rules you can set',
      sub: rest.some((g) => isLimitCut(g.habit))
        ? `Optional rules for behaviours this period does not list as confirmed habits. A behaviour left out only by the ${CONFIG.maxHabits}-habit limit comes first, then near misses.`
        : 'Optional rules for behaviours this period does not confirm. Near misses come first.',
      cards: rest.map((g) => card(state, g)).join(''),
    }) : '',
  ].join('');

  return `<div class="gr-view">${head}<div class="gr-intro">${safety}${summary}${announce}</div>${groups}</div>`;
}

// ---------- editor dialog ----------

// One setting as a native select of the values the engine accepts (min..max in steps). A select commits
// on choice, so the draft is current before Save is pressed: a typed field commits on blur, and the
// re-render that blur triggers at mousedown swallowed the first click on Save or Cancel.
// A draft value outside the list (e.g. a suggested lot cap above the maximum) stays visible with its error.
function paramField(p, i, value, error) {
  const id = `guard-param-${p.key}`;
  const options = [];
  for (let v = p.min; v <= p.max; v += p.step) options.push({ value: v, label: String(v) });
  if (!isNum(value)) options.unshift({ value: '', label: 'Choose a value' });
  else if (!options.some((o) => o.value === value)) options.unshift({ value, label: `${value} (not allowed)` });
  const range = `${p.min} to ${withUnit(p.max, p.unit)}${p.step === 1 ? '' : `, in steps of ${p.step}`}`;
  const hint = `${range}. The preview below updates as soon as you choose.`;
  const describedBy = [`${id}-hint`, error ? `${id}-err` : ''].filter(Boolean).join(' ');
  let html = select({
    id, label: `${p.label} (${p.unit})`, value: isNum(value) ? value : '', options,
    action: 'setGuardParam', data: { key: p.key, autofocus: i === 0 }, describedBy,
  });
  if (error) html = html.replace('<select ', '<select aria-invalid="true" ');
  return `<div class="gr-field${error ? ' has-error' : ''}">${html}<span class="field-hint" id="${id}-hint">${esc(hint)}</span>${error ? `<span class="field-error" id="${id}-err">${esc(error)}</span>` : ''}</div>`;
}

export function overlay(state) {
  const g = state.guardEdit;
  if (!g || !GUARDRAILS[g.habitId]) return '';
  const id = g.habitId;
  const t = GUARDRAILS[id];
  const a = selectAnalysis(state);
  const ds = getDataset(state);
  const entry = selectGuardrails(state).find((x) => x.habitId === id);
  const params = g.params ?? {};
  const computed = validateGuardrailParams(id, params);
  const errorFor = (key) => g.errors?.[key] ?? computed[key] ?? '';
  const valid = Object.keys(computed).length === 0 && Object.keys(g.errors ?? {}).length === 0;
  const label = a.summary.periodLabel ?? 'this period';
  const period = periodPhrase(state.periodKey);
  const titleId = 'guardrails-dialog-title';

  const fields = t.params.length
    ? `<div class="gr-fields">${t.params.map((p, i) => paramField(p, i, params[p.key], errorFor(p.key))).join('')}</div>`
    : '<p class="gr-muted-line">No settings: the rule is always the same.</p>';

  const problems = t.params.map((p) => (errorFor(p.key) ? `<li>${esc(p.label)}: ${esc(errorFor(p.key))}</li>` : '')).join('');
  const preview = valid
    ? `<dl class="gr-facts gr-preview"><div class="gr-fact"><dt>Your rule</dt><dd><p class="gr-rule">${esc(t.rule(params))}</p></dd></div><div class="gr-fact"><dt>How compliance is measured</dt><dd><p>${esc(t.measure(params))}</p></dd></div></dl>`
    : callout({ tone: 'warn', title: 'Fix the setting to preview the rule', body: `<ul class="gr-problems">${problems}</ul>` });

  let measured;
  if (!valid) {
    measured = '<p class="gr-muted-line" data-announce>Compliance is measured once the setting is valid.</p>';
  } else {
    const m = measureGuardrail(a, id, params);
    const savedParams = entry?.rule?.params ?? null;
    const changed = savedParams && t.params.some((p) => savedParams[p.key] !== params[p.key]);
    // Unsaved settings are always a what-if on trades already in the file. Unchanged saved settings keep
    // their own timeline, so this period may hold only trades opened after they were saved.
    const savedPhase = entry?.rule ? entry.phases?.current ?? 'what-if' : null;
    const rows = [
      changed ? periodRow(id, entry.compliance.current, { label: 'Saved settings', period, phase: savedPhase }) : '',
      periodRow(id, m, { label: changed ? 'These settings' : 'With these settings', period, phase: changed ? 'what-if' : null, current: true }),
    ].join('');
    let note;
    if (!changed && savedPhase === 'after') {
      note = `These are your saved settings. Every trade in ${label} was opened after they were saved. It shows how often the behaviour happened, not what the rule changed.`;
    } else {
      note = `What-if: measured on trades already in the file. The fills in ${label} are checked against these settings. It shows how often the behaviour happened, not what the rule changed.${changed ? " Saving them restarts the rule's timeline from that moment." : ''}`;
    }
    measured = `<div class="gr-compliance gr-compliance-flat"><ul class="gr-periods">${rows}</ul><p class="gr-comp-note">${esc(note)}</p><p hidden data-announce>${esc(resultSentence(id, m, period))}</p></div>`;
  }

  const savedNote = ds.kind === 'import'
    ? 'Saving stores this rule in this browser only, for this tab, alongside your import. Nothing is sent to Nubra or any broker.'
    : 'Saving stores this rule in this browser only. Nothing is sent to Nubra or any broker.';

  const section = (title, body, extra = '') => `<section class="gr-dialog-section"><div class="gr-dialog-section-head"><h3>${esc(title)}</h3>${extra}</div>${body}</section>`;

  return `<div class="scrim" data-overlay-close data-action="closeGuardEdit"></div><div class="dialog gr-dialog" data-overlay role="dialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="guardrails-dialog-note">
    <header class="gr-dialog-head"><h2 id="${titleId}"><span class="gr-dialog-kind">${g.isNew ? 'Set up rule' : 'Edit rule'}<span class="sr-only">:</span></span> ${esc(t.title)}</h2>${entry?.rule ? statusLine(entry.rule) : ''}</header>
    <div class="gr-dialog-body">
      ${section('Behaviour addressed', `${behaviour(entry ?? { habit: a.habits[id] })}${entry ? relevance(entry, { withLink: false }) : ''}`)}
      ${section('Settings', fields)}
      ${section('Preview', preview)}
      ${section(`Compliance in ${label}`, measured, complianceDef())}
      ${section('Nubra capability', nubraBlock(t.nubra, { snippet: true }))}
      <p class="gr-dialog-note" id="guardrails-dialog-note">${esc(savedNote)}</p>
    </div>
    <footer class="gr-dialog-foot">${button('Cancel', { action: 'closeGuardEdit' })}${button(g.isNew ? 'Save rule' : 'Save changes', { action: 'saveGuardrail', variant: 'primary', disabled: !valid })}</footer>
  </div>`;
}
