// Scenario lab: change a synthetic month and watch the same fixed rules classify it.
// Every figure comes from selectLab(state) (lab.js runs the simulated file through the real importer
// and engine) or from engine constants. Nothing here forecasts markets or recommends a trade.

import { selectLab } from '../store.js';
import { LAB_PARAMS, SCENARIOS } from '../lab.js';
import { CONFIG, HABITS, HABIT_IDS } from '../engine.js';
import { formatINR, formatPct, formatMonth, formatDay, ordinal, plural } from '../format.js';
import {
  esc, amount, button, callout, chip, gateList, habitStatusChip, input, panel, pageHeader, segmented, stat,
} from '../ui/components.js';

const W = CONFIG.revengeWindowMin;
const G = CONFIG.gates;
const LIMIT = CONFIG.dailyTradeLimit;
// Fallback only: selectLab(state).from names the preset a custom month started from.
const DEFAULT_PRESET = 'repeated';
// The preset a "Reset" goes back to: the current preset, or for a custom month the preset it started from.
const resetTarget = (L) => (SCENARIOS[L.scenario] ? L.scenario : SCENARIOS[L.from] ? L.from : DEFAULT_PRESET);

const num = (n) => `<span class="num">${esc(String(n))}</span>`;
const q = (s) => `“${esc(s)}”`;
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ---------- settings helpers ----------

function valueText(p, v) {
  if (p.type === 'toggle') return v ? 'On' : 'Off';
  if (p.unit === '%') return `${v}%`;
  const unit = v === 1 && p.unit.endsWith('s') ? p.unit.slice(0, -1) : p.unit;
  return `${v} ${unit}`;
}

function changedFrom(params, presetId) {
  const preset = SCENARIOS[presetId].params;
  return LAB_PARAMS.filter((p) => params[p.key] !== preset[p.key]);
}

// The simulator pads the last N days to 7 trades, so there can be no more busy days than trading days.
// The sliders enforce this; render() also guards against a state that breaks it.
function boundsFor(p, params) {
  if (p.key === 'days') return { min: Math.max(p.min, params.busyDays), max: p.max };
  if (p.key === 'busyDays') return { min: p.min, max: Math.min(p.max, params.days) };
  return { min: p.min, max: p.max };
}

// ---------- presets ----------

// Presets with the fewest settings different from the current month (a comparison, independent of the
// preset the month started from).
function closestPresets(params) {
  const ranked = Object.keys(SCENARIOS).map((id) => ({ id, diffs: changedFrom(params, id) }));
  const best = Math.min(...ranked.map((r) => r.diffs.length));
  return ranked.filter((r) => r.diffs.length === best);
}

function diffText(p, params, presetId) {
  const fmt = (v) => (p.type === 'toggle' ? valueText(p, v).toLowerCase() : valueText(p, v));
  return `${p.label.toLowerCase()}: ${fmt(params[p.key])}, not ${fmt(SCENARIOS[presetId].params[p.key])}`;
}

function diffList(r, params, max) {
  const more = r.diffs.length > max ? `; ${plural(r.diffs.length - max, 'other setting')}` : '';
  return `${r.diffs.slice(0, max).map((p) => esc(diffText(p, params, r.id))).join('; ')}${esc(more)}`;
}

// A custom month is described against the preset it started from; a different preset is named only when
// the current settings are now strictly closer to it.
function customDescription(params, from) {
  if (!SCENARIOS[from]) return closestDescription(params);
  const n = changedFrom(params, from).length;
  const start = q(SCENARIOS[from].label);
  let out = n === 0
    ? `<strong>Custom month.</strong> Started from ${start}; every setting still matches it.`
    : `<strong>Custom month.</strong> Started from ${start}, with ${plural(n, 'setting')} changed (${diffList({ id: from, diffs: changedFrom(params, from) }, params, 4)}).`;
  const closer = closestPresets(params).filter((r) => r.id !== from && r.diffs.length < n);
  if (closer.length) {
    const k = closer[0].diffs.length;
    const names = andList(closer.map((r) => q(SCENARIOS[r.id].label)));
    out += k === 0 ? ` The settings now match ${names}.` : ` Now closer to ${names}, ${plural(k, 'setting')} away.`;
  }
  return out;
}

function closestDescription(params) {
  const closest = closestPresets(params);
  const n = closest[0].diffs.length;
  if (n === 0) return `<strong>Custom month.</strong> Same settings as ${q(SCENARIOS[closest[0].id].label)}.`;
  const list = (r, max) => diffList(r, params, max);
  if (closest.length === 1) {
    const r = closest[0];
    return `<strong>Custom month.</strong> Closest preset: ${q(SCENARIOS[r.id].label)}, with ${plural(n, 'setting')} different (${list(r, 4)}).`;
  }
  const names = closest.map((r) => `${q(SCENARIOS[r.id].label)}${n <= 2 ? ` (${list(r, 2)})` : ''}`);
  return `<strong>Custom month.</strong> Closest presets, each ${plural(n, 'setting')} away: ${andList(names)}.`;
}

function presetPanel(L) {
  const options = Object.entries(SCENARIOS).map(([id, s]) => ({ value: id, label: s.label }));
  // segmented() emits data-value; setScenario reads `id`, so the payload attribute is renamed.
  let seg = segmented({ label: 'Preset scenario', value: L.scenario, options, action: 'setScenario', id: 'lab-presets' })
    .replace(/ data-value="/g, ' data-id="');
  // A status marker, not a control: styled like the active segment but not clickable.
  if (L.scenario === 'custom') seg = seg.replace(/<\/div>$/, '<span class="seg is-active lab-seg-status" aria-current="true">Custom</span></div>');

  const preset = SCENARIOS[L.scenario];
  let desc = preset ? `<strong>${esc(preset.label)}.</strong> ${esc(preset.description)}` : customDescription(L.params, L.from);
  // The seed is compared with the preset shown, or for a custom month with the preset it started from.
  const ref = preset ?? SCENARIOS[L.from] ?? null;
  if (ref && L.params.seed !== ref.params.seed) {
    desc += ` Random draw: seed ${num(L.params.seed)} (${preset ? 'the preset uses' : `${q(ref.label)} uses`} seed ${num(ref.params.seed)}).`;
  }
  return panel({
    title: 'Start from a preset',
    subtitle: 'Each preset is a month built to test one part of the rules. Any change below makes it a custom month.',
    body: `${seg}<p class="lab-preset-desc">${desc}</p>`,
  });
}

// ---------- controls ----------

function hintFor(p, L) {
  const a = L.analysis;
  const prm = L.params;
  const noReentries = prm.reentries === 0 && !prm.blowup;
  switch (p.key) {
    case 'days': {
      const base = a ? `${a.summary.units} closed trades this month; the review needs ${CONFIG.minUnits}+.` : `The review needs ${CONFIG.minUnits}+ closed trades.`;
      return prm.busyDays > p.min ? `${base} Cannot go below ${prm.busyDays}, the number of days with 7 trades.` : base;
    }
    case 'reentryGap': return `The rule counts re-entries within ${W} min of a loss.${noReentries ? ' No effect while there are no re-entries.' : ''}`;
    case 'reentryLoss': return noReentries ? 'No effect while there are no re-entries.' : '';
    case 'busyDays': {
      const base = `Trades after the ${ordinal(LIMIT)} of a day count as “${HABITS.H5.short}”.`;
      return prm.days < p.max ? `${base} Cannot exceed the ${prm.days} trading days.` : base;
    }
    case 'missingPrice': return 'Orders without a price are rejected, never read as ₹0.';
    case 'missingCharges': return 'Accepted and flagged; net P&L leaves the missing charges out.';
    case 'blowup': {
      const g4 = a?.habits.H1.gates.checks.find((c) => c.id === 'G4');
      return g4 ? `Tests the “${g4.name}” gate: one large loss should not make a habit.` : 'Tests whether one large loss can make a habit.';
    }
    default: return '';
  }
}

function control(p, L) {
  const v = L.params[p.key];
  const id = `lab-${p.key}`;
  const hint = hintFor(p, L);
  // A change is applied (and the month rebuilt) when it commits: a checkbox click, a slider key press, or
  // letting go of a slider. The new result is announced from #lab-summary (data-announce), so it is not
  // repeated in each control's description.
  const describedBy = hint ? ` aria-describedby="${id}-hint"` : '';
  if (p.type === 'toggle') {
    return `<div class="lab-control lab-control-toggle"><label class="check" for="${id}"><input type="checkbox" id="${id}" data-action="setLabParam" data-key="${esc(p.key)}"${v ? ' checked' : ''}${describedBy}><span>${esc(p.label)}</span></label>${hint ? `<span class="field-hint" id="${id}-hint">${esc(hint)}</span>` : ''}</div>`;
  }
  const { min, max } = boundsFor(p, L.params);
  const text = valueText(p, v);
  // The visible value sits beside the label. While a slider is dragged nothing re-renders: main.js rewrites
  // the [data-range-for] element as "value unit". A percentage keeps its "%" outside that element (with an
  // empty data-unit) so it reads "55%" during and after a drag. The slider's name stays the label alone
  // (aria-labelledby) and its committed value is spoken with the unit (aria-valuetext).
  const out = p.unit === '%'
    ? `<span class="lab-value num" aria-hidden="true"><span data-range-for="${id}" data-unit="">${esc(String(v))}</span>%</span>`
    : `<span class="lab-value num" data-range-for="${id}" data-unit="${esc(p.unit)}" aria-hidden="true">${esc(text)}</span>`;
  const field = input({ id, label: p.label, type: 'range', value: v, action: 'setLabParam', data: { key: p.key }, live: true, min, max, step: p.step, hint })
    .replace('<span class="field-label">', `<span class="field-label" id="${id}-label">`)
    .replace(/(<span class="field-label"[^>]*>[^<]*<\/span>)/, (m) => `${m}${out}`)
    .replace(/ aria-describedby="[^"]*"/, '')
    .replace(`<input id="${id}"`, () => `<input id="${id}" aria-labelledby="${id}-label" aria-valuetext="${esc(text)}"${describedBy}`);
  return `<div class="lab-control">${field}</div>`;
}

function summaryText(L) {
  const a = L.analysis;
  if (!a) return 'These settings could not be simulated.';
  const k = a.confirmed.length;
  if (k) return `${k === 1 ? `“${a.confirmed[0].name}” is confirmed` : `${k} habits are confirmed`}; ${formatINR(a.headlineCost)} of excess loss is associated with ${k === 1 ? 'it' : 'them'}.`;
  if (a.summary.thin) return `Too few trades to judge: ${a.summary.units} closed trades, ${CONFIG.minUnits} needed.`;
  const near = a.nearMisses.length;
  return `No confirmed habit${near ? `; ${plural(near, 'behaviour')} came close` : ''}.`;
}

// A compact result inside the controls: sticky at the bottom of the screen on narrow layouts (where the
// full results are far below), visually hidden on wide ones (where they sit beside the controls). It is
// the view's one data-announce element, so main.js announces the new result after each change.
function summaryBar(L) {
  return `<p class="lab-now" id="lab-summary" data-announce><span class="lab-now-label">Result<span class="sr-only">:</span></span> <span class="lab-now-text">${esc(summaryText(L))}</span></p>`;
}

function controlsPanel(L) {
  const groups = [...new Set(LAB_PARAMS.map((p) => p.group))];
  const fieldsets = groups.map((g) => `<fieldset class="lab-group"><legend class="lab-legend">${esc(g)}</legend><div class="lab-fields">${LAB_PARAMS.filter((p) => p.group === g).map((p) => control(p, L)).join('')}</div></fieldset>`).join('');
  const target = resetTarget(L);
  const preset = SCENARIOS[target];
  const atPreset = L.scenario === target && changedFrom(L.params, target).length === 0 && L.params.seed === preset.params.seed;
  // Without a simulated file there is nothing to download or hand to the importer.
  const noFile = !L.analysis;
  const actions = `<div class="lab-actions"><div class="btn-row">
      ${button('Regenerate with a new seed', { action: 'regenerateLab' })}
      ${button('Download this CSV', { action: 'downloadLabCsv', disabled: noFile })}
      ${button('Open this month in the importer', { action: 'openLabInImporter', disabled: noFile })}
      ${button(`Reset to “${preset.label}”`, { action: 'setScenario', data: { id: target }, variant: 'ghost', disabled: atPreset })}
    </div>
    <p class="lab-seed small muted">Seed ${num(L.params.seed)}. A new seed redraws wins, losses and prices with the same settings.</p>
    <p class="lab-seed small muted">“Open this month in the importer” loads this simulated file into the Import page, so you can see how the importer handles it: how its columns are mapped, which rows pass the checks and which are rejected. Nothing is added to your data unless you finish the import there.</p></div>`;
  return `<div class="lab-controls">${panel({
    title: 'Change the history',
    subtitle: 'The month is rebuilt each time a setting changes; a slider applies when you let go of it. The rules never move.',
    body: `${fieldsets}${summaryBar(L)}${actions}`,
  })}</div>`;
}

// ---------- what decides the result ----------

function gateLine(h, g, a) {
  const name = q(h.short);
  switch (g.id) {
    case 'G1': return `${name} was seen ${plural(h.gates.n, 'time')}; the gate needs at least ${G.minN}, so it is ${G.minN - h.gates.n} short.`;
    case 'G2': return `${name} was seen ${plural(h.gates.n, 'time')} but on only ${plural(h.gates.days, 'day')}; the gate needs ${G.minDays} different days, so a cluster is not a habit.`;
    case 'G3': return `${name} is associated with ${esc(formatINR(Math.max(h.cost, 0)))} of excess loss; this month's bar is ${esc(formatINR(a.summary.floor))} (the larger of ${esc(formatINR(G.minCost))} and ${esc(formatPct(G.lossShare, { digits: 0 }))} of ${esc(formatINR(a.summary.grossLosses))} total losses after charges).`;
    case 'G4': return h.gates.topShare >= 1
      ? `The costliest ${name} trade accounts for all of its ${esc(formatINR(Math.max(h.cost, 0)))} excess loss; the other occurrences together did no worse than the usual trade, so one large loss cannot make a habit.`
      : `The costliest ${name} trade carries ${esc(formatPct(h.gates.topShare, { digits: 0 }))} of its ${esc(formatINR(Math.max(h.cost, 0)))} excess loss. Without it, ${esc(formatINR(Math.max(h.gates.loo, 0)))} remains against a bar of ${esc(formatINR(g.threshold))}, so one large loss cannot make a habit.`;
    default: return esc(g.reason);
  }
}

// How far a gate's value is from its threshold, as a multiple (1 = exactly at the line).
const ratioOf = (g) => (g.threshold ? Math.max(g.value, 0) / g.threshold : 0);
const narrowest = (h) => [...h.gates.checks].sort((x, y) => ratioOf(x) - ratioOf(y))[0];
const plannedTrades = (L) => L.plan.reduce((n, d) => n + d.seq.length, 0);

function windowNote(L) {
  const gap = L.params.reentryGap;
  if (!L.planted.reentries || gap > W) return '';
  return ` Re-entries are planted ${gap} min after the loss, ${gap === W ? 'right at the edge of' : `${W - gap} min inside`} the ${W}-minute window.`;
}

function windowLine(L) {
  const gap = L.params.reentryGap;
  return { title: 'The re-entry window', body: `The planted re-entries open ${gap} min after the loss, ${gap - W} min beyond the rule's ${W}-minute window, so none of the ${L.planted.reentries} count. At ${W} min or less the rule counts them.` };
}

// Days on which the simulator planted a behaviour (from the day-by-day plan).
function plantedDays(id, L) {
  if (id === 'H1' && L.params.reentryGap > W) return 0;
  const has = { H1: (s) => s.some((k) => k[0] === 'R'), H2: (s) => s.includes('A'), H5: (s) => s.length > LIMIT }[id];
  return has ? L.plan.filter((d) => has(d.seq)).length : null;
}

// Rejected rows and positions left out of the review; null when the simulated file came through intact.
function dataLoss(L) {
  const rejected = L.validation.summary.rejected;
  const excluded = L.analysis.summary.excluded.length;
  if (!rejected && !excluded) return null;
  const parts = [
    rejected ? `${plural(rejected, 'row')} ${rejected === 1 ? 'was' : 'were'} rejected at import` : '',
    excluded ? `${plural(excluded, 'position')} ${excluded === 1 ? 'was' : 'were'} left out of the review` : '',
  ].filter(Boolean);
  return { rejected, excluded, text: parts.join(' and ') };
}

// Why a behaviour that occurred is not confirmed: its first failed gate, or missing data when the
// planted occurrences would have been enough for that gate but did not reach the review intact.
function nearMissLine(h, L) {
  const a = L.analysis;
  if (h.status === 'overlap' && h.limitCut) {
    const reason = h.statusReason ? `${h.statusReason.charAt(0).toLowerCase()}${h.statusReason.slice(1)}` : `passed every gate, but at most ${CONFIG.maxHabits} habits are reported per period.`;
    return { title: 'Over the reporting limit', body: `${q(h.short)} ${esc(reason)}` };
  }
  if (h.status === 'overlap') return { title: 'One trade, one habit', body: `${q(h.short)} passes every gate on its own, but each trade counts toward one habit only. ${esc(h.statusReason ?? '')}` };
  const fails = h.gates.checks.filter((c) => !c.pass);
  const g = fails[0];
  if (!g) return { title: 'Not confirmed', body: esc(h.statusReason ?? '') };
  const others = fails.slice(1).map((c) => `“${esc(c.name)}”`);
  const also = others.length ? ` It also fails the ${andList(others)} gate${others.length > 1 ? 's' : ''}.` : '';
  const loss = dataLoss(L);
  const planted = plantedFor(h.id, L).n;
  const detected = a.standalone[h.id].occurrences;
  const lost = Boolean(loss) && planted !== null && detected < planted;
  const days = plantedDays(h.id, L);
  const lossDecides = lost && ((g.id === 'G1' && planted >= G.minN) || (g.id === 'G2' && days >= G.minDays));
  if (lossDecides) {
    const enough = g.id === 'G1' ? `${planted} were planted, enough for this gate` : `${planted} were planted across ${days} days, enough for this gate`;
    const why = loss.rejected ? ' Rejected orders are left out rather than guessed, so the trades they belong to drop out of the review or pair up differently.' : '';
    return { title: 'Missing data', body: `${gateLine(h, g, a)} ${enough}, but ${loss.text}.${why}${also}` };
  }
  const lossNote = lost ? ` ${planted} were planted; the rules find ${detected} after ${loss.text}.` : '';
  return { title: `${g.name} gate`, body: `${gateLine(h, g, a)}${also}${h.id === 'H1' ? windowNote(L) : ''}${lossNote}` };
}

// The near miss closest to being confirmed: fewest failed gates, then the failed gate nearest its bar.
function closestNearMiss(L, skip = []) {
  const a = L.analysis;
  const key = (h) => {
    const fails = h.status === 'overlap' ? [] : h.gates.checks.filter((c) => !c.pass);
    return [fails.length, -(fails[0] ? ratioOf(fails[0]) : 1), -h.cost];
  };
  const cmp = (x, y) => {
    const kx = key(x);
    const ky = key(y);
    return kx[0] - ky[0] || kx[1] - ky[1] || kx[2] - ky[2];
  };
  return HABIT_IDS.map((id) => a.habits[id])
    .filter((h) => (h.status === 'insufficient' || h.status === 'overlap') && !skip.includes(h.id))
    .sort(cmp)[0] ?? null;
}

function unitsLossNote(L) {
  const loss = dataLoss(L);
  const planned = plannedTrades(L);
  return loss && planned > L.analysis.summary.units ? ` ${planned} trades were simulated, but ${loss.text}.` : '';
}

function thinLine(L) {
  const a = L.analysis;
  const s = a.summary;
  const passing = HABIT_IDS.filter((id) => a.standalone[id].gates.pass).map((id) => q(HABITS[id].short));
  const held = passing.length ? `, so ${andList(passing)} ${passing.length === 1 ? 'is' : 'are'} held back despite passing all four gates on ${passing.length === 1 ? 'its' : 'their'} own` : '';
  const more = dataLoss(L) ? 'More trading days, more trades per day or fewer missing prices raise the count.' : 'More trading days or trades per day raise the count.';
  return { title: 'Enough history', body: `This month has ${s.units} closed trades. The review needs at least ${CONFIG.minUnits} before it calls anything a habit${held}.${unitsLossNote(L)} ${more}` };
}

// The boundary nearest to removing a confirmed habit from the headline.
function confirmedLine(b, L) {
  const s = L.analysis.summary;
  if (b.kind === 'units') {
    const spare = s.units - CONFIG.minUnits;
    const edge = spare === 0
      ? 'It is exactly at that line: with one trade fewer, nothing is judged.'
      : `That is ${plural(spare, 'trade')} above the line; with ${CONFIG.minUnits - 1} or fewer, nothing is judged.`;
    return { title: 'Enough history', body: `This month has ${s.units} closed trades; the review needs at least ${CONFIG.minUnits} before it calls anything a habit. ${edge}${unitsLossNote(L)}` };
  }
  const { h, g, ratio } = b;
  const fewer = (have, need) => (have - need + 1 === 1 ? 'one fewer' : `${have - need + 1} fewer`);
  const times = `${ratio < 1.1 ? ratio.toFixed(2) : ratio.toFixed(1)}×`;
  const lines = {
    G1: `${q(h.short)} is confirmed with ${h.gates.n} occurrences; the Repeated gate needs ${G.minN}, so with ${fewer(h.gates.n, G.minN)} it fails that gate.`,
    G2: `${q(h.short)} is confirmed across ${h.gates.days} days; the Spread out gate needs ${G.minDays}, so with ${fewer(h.gates.days, G.minDays)} it fails that gate.`,
    G3: `${q(h.short)} is associated with ${esc(formatINR(h.cost))} of excess loss, ${times} this month's ${esc(formatINR(s.floor))} materiality bar.`,
    G4: `Without its costliest occurrence, ${q(h.short)} still shows ${esc(formatINR(h.gates.loo))} of excess loss against a bar of ${esc(formatINR(g.threshold))} (${times}).`,
  };
  return { title: `Narrowest margin: the ${g.name} gate`, body: `${lines[g.id]}${h.id === 'H1' ? windowNote(L) : ''}` };
}

// One boundary that decides the current result, computed from the current settings and results,
// plus at most one secondary line (the closest near miss, or planted re-entries outside the window).
function decider(L) {
  const a = L.analysis;
  const s = a.summary;
  const outside = L.planted.reentries > 0 && L.params.reentryGap > W;
  if (s.thin) return { primary: thinLine(L), second: outside ? windowLine(L) : null };
  if (a.confirmed.length) {
    const bounds = [
      { kind: 'units', ratio: s.units / CONFIG.minUnits },
      ...a.confirmed.map((h) => { const g = narrowest(h); return { kind: 'gate', h, g, ratio: ratioOf(g) }; }),
    ];
    const b = bounds.reduce((best, x) => (x.ratio < best.ratio ? x : best));
    const near = closestNearMiss(L);
    if (outside) return { primary: confirmedLine(b, L), second: windowLine(L) };
    return { primary: confirmedLine(b, L), second: near ? nearMissLine(near, L) : null, secondLabel: 'Closest to also being confirmed' };
  }
  const near = closestNearMiss(L, outside ? ['H1'] : []);
  if (outside) return { primary: windowLine(L), second: near ? nearMissLine(near, L) : null, secondLabel: 'Closest to being confirmed' };
  if (near) return { primary: nearMissLine(near, L) };
  const flat = HABIT_IDS.map((id) => a.habits[id]).find((h) => h.status === 'not-costly');
  if (flat) return { primary: { title: 'No excess loss', body: `${q(flat.short)} occurs ${plural(flat.occurrences, 'time')}, but those trades did no worse than the usual trade, so there is no excess loss for the Material gate to weigh.` } };
  return { primary: { title: 'Nothing to weigh', body: `No behaviour occurred this month. To be called a habit, a behaviour needs at least ${G.minN} occurrences on ${G.minDays}+ days, an associated excess loss of at least ${esc(formatINR(s.floor))} here, and more than one costly trade behind it.` } };
}

function deciderCallout(L) {
  const d = decider(L);
  const p1 = `<p><strong>${esc(d.primary.title)}.</strong> ${d.primary.body}</p>`;
  const p2 = d.second ? `<p><strong>${d.secondLabel ? `${esc(d.secondLabel)}:` : `${esc(d.second.title)}.`}</strong> ${d.second.body}</p>` : '';
  return callout({ tone: 'info', title: 'What decides this result', body: `${p1}${p2}` });
}

// ---------- results ----------

function monthLabel(L) {
  return L.plan.length ? formatMonth(L.plan[0].day.slice(0, 7)) : formatMonth(L.analysis.summary.months[0]);
}

function resultPanel(L) {
  const a = L.analysis;
  const s = a.summary;
  const k = a.confirmed.length;
  let headline;
  if (k) {
    headline = `<p class="lab-headline">${k === 1 ? `${q(a.confirmed[0].name)} is confirmed as a habit.` : `${k} confirmed habits: ${a.confirmed.map((h) => q(h.name)).join(', ')}.`}</p>
      <p class="lab-sub">${amount(a.headlineCost)} of excess loss is associated with ${k === 1 ? 'it' : 'them'}, compared with the usual trade in this simulated month. That is an association, not proof that the behaviour caused the loss.</p>`;
  } else if (s.thin) {
    headline = `<p class="lab-headline">Too few trades to judge.</p><p class="lab-sub">${s.units} closed trades; the review needs ${CONFIG.minUnits}+ in a month before anything is called a habit.</p>`;
  } else {
    const seen = a.nearMisses.length;
    headline = `<p class="lab-headline">No confirmed habit.</p><p class="lab-sub">Nothing in this simulated month passed all four evidence gates.${seen ? ` ${plural(seen, 'behaviour')} came close; see below.` : ''}</p>`;
  }
  const stats = `<div class="stat-grid lab-stats">
    ${stat({ label: 'Closed trades', value: num(s.units), sub: `${plural(s.tradingDays, 'trading day')}` })}
    ${stat({ label: 'Confirmed habits', value: num(k), sub: `of ${HABIT_IDS.length} behaviours checked` })}
    ${stat({ label: 'Associated excess loss', value: k ? amount(a.headlineCost) : '<span class="muted">None confirmed</span>', sub: k ? 'Confirmed habits vs the usual trade' : s.thin ? 'Too few trades to judge' : 'Counted only for confirmed habits' })}
    ${stat({ label: 'Materiality bar', value: amount(s.floor), sub: `Larger of ${formatINR(G.minCost)} and ${formatPct(G.lossShare, { digits: 0 })} of total losses after charges` })}
  </div>`;
  return panel({
    title: 'What the review concluded',
    subtitle: `${esc(monthLabel(L))} · simulated · not linked to the trader or period selected above`,
    body: `${headline}${stats}${deciderCallout(L)}`,
  });
}

function plantedFor(id, L) {
  const p = L.planted;
  if (id === 'H1') return { n: p.reentriesInWindow, html: p.reentriesInWindow === p.reentries ? num(p.reentries) : `${num(p.reentries)} <span class="muted">(${p.reentriesInWindow} within ${W} min of the loss)</span>` };
  if (id === 'H2') return { n: p.adds, html: num(p.adds) };
  if (id === 'H5') return { n: p.busyExtras, html: num(p.busyExtras) };
  return { n: null, html: '<span class="muted">Not simulated in the lab</span>' };
}

function habitItem(id, L) {
  const a = L.analysis;
  const h = a.habits[id];
  const def = HABITS[id];
  const planted = plantedFor(id, L);
  const found = h.opportunities ? `${num(h.occurrences)} of ${num(h.opportunities)} ${esc(def.chances)}` : `<span class="muted">No ${esc(def.chances)} to check</span>`;
  const rows = [
    ['Planted', planted.html],
    ['Found by the rules', found],
    ...(h.cost > 0 ? [['Excess loss vs usual trade', amount(h.cost)]] : []),
  ];
  const notes = [];
  const detected = a.standalone[id].occurrences;
  const loss = dataLoss(L);
  if (planted.n !== null && detected !== planted.n) {
    if (loss) notes.push(`The rules found ${detected} against ${planted.n} planted. ${loss.text[0].toUpperCase()}${loss.text.slice(1)}, which changes which trades the review sees and how the remaining orders pair into trades, so the count can be higher or lower than what was planted.`);
    else if (detected > planted.n) notes.push(`The rules found ${detected}, more than the ${planted.n} planted: ordinary trades can match the definition too.`);
    else notes.push(`The rules found ${detected} of the ${planted.n} planted; the others do not meet the definition as simulated.`);
  }
  if (h.status === 'confirmed' && h.overlap) notes.push(`${plural(h.overlap, 'trade')} also matched a higher-ranked habit and ${h.overlap === 1 ? 'is' : 'are'} counted there.`);
  return `<li class="lab-habit">
    <div class="lab-habit-head"><h3 class="lab-habit-title">${esc(def.name)}</h3>${habitStatusChip(h, CONFIG.maxHabits)}</div>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    ${h.occurrences > 0 ? `<div class="lab-gates"><span class="sr-only">Evidence gates:</span>${gateList(h.gates, { compact: true })}</div>` : ''}
    ${h.statusReason ? `<p class="lab-reason">${esc(h.statusReason)}</p>` : ''}
    ${notes.map((n) => `<p class="lab-reason muted">${esc(n)}</p>`).join('')}
  </li>`;
}

function habitsPanel(L) {
  return panel({
    title: 'Planted vs found, behaviour by behaviour',
    subtitle: 'In a simulation the planted behaviour is known by construction. In real trade data it never is, which is why the review needs evidence gates.',
    body: `<ol class="lab-habits">${HABIT_IDS.map((id) => habitItem(id, L)).join('')}</ol>`,
  });
}

const KIND = {
  W: ['W', 'ok', 'ordinary win'],
  L: ['L', 'neutral', 'ordinary loss'],
  R: ['R', 'warn', 're-entry after a loss'],
  Rb: ['R+', 'danger', 'very large losing re-entry'],
  A: ['A', 'accent', 'add to a losing buy'],
};
const kindOf = (k) => KIND[k] ?? [k, 'neutral', k];

function planList(L) {
  const used = new Set(L.plan.flatMap((d) => d.seq));
  const rows = L.plan.map(({ day, seq }) => {
    const marks = seq.map((k, i) => {
      const [t, tone, label] = kindOf(k);
      const limit = i === LIMIT && seq.length > LIMIT ? `<span class="lab-limit" title="Daily limit: trades after this line are past the ${ordinal(LIMIT)} of the day"></span>` : '';
      return `${limit}${chip(t, tone, { title: label })}`;
    }).join('');
    const sr = `${formatDay(day)}: ${seq.map((k) => kindOf(k)[2]).join(', ')}${seq.length > LIMIT ? `; ${seq.length - LIMIT} past the daily limit` : ''}.`;
    return `<li><span class="lab-plan-day" aria-hidden="true">${esc(formatDay(day))}</span><span class="chip-row" aria-hidden="true">${marks}</span><span class="sr-only">${esc(sr)}</span></li>`;
  }).join('');
  const legend = Object.entries(KIND).filter(([k]) => used.has(k)).map(([, [t, tone, label]]) => `<span>${chip(t, tone)}${esc(label)}</span>`).join('');
  const limitLegend = L.plan.some((d) => d.seq.length > LIMIT) ? `<span><span class="lab-limit lab-limit-key" aria-hidden="true"></span>after the ${esc(ordinal(LIMIT))} trade of the day</span>` : '';
  return `<h3 class="lab-subhead">Day by day</h3><p class="small muted lab-plan-note">The simulated plan, in order within each day, before missing prices or charges are applied.</p><ul class="lab-plan">${rows}</ul><div class="lab-plan-legend" aria-hidden="true">${legend}${limitLegend}</div>`;
}

function plantedPanel(L) {
  const p = L.planted;
  const rows = [
    ['Simulated month', `${esc(monthLabel(L))} · ${plural(L.params.days, 'trading day')}`],
    ['Re-entries right after a loss', p.reentriesInWindow === p.reentries ? num(p.reentries) : `${num(p.reentries)} <span class="muted">(${p.reentriesInWindow} within the ${W}-minute window)</span>`],
    ['Adds to a losing buy', num(p.adds)],
    [`Trades past the ${ordinal(LIMIT)} of a day`, num(p.busyExtras)],
    ['Orders in the file', num(p.orders)],
    ['Orders with a missing price', num(p.ordersMissingPrice)],
    ['Orders with missing charges', num(p.ordersMissingCharges)],
  ];
  return panel({
    title: 'What was planted',
    subtitle: 'The ground truth the simulator wrote into the file.',
    body: `<dl class="kv lab-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>${planList(L)}`,
  });
}

const QUALITY_CHIP = { good: ['No data issues', 'ok'], attention: ['Needs attention', 'warn'], insufficient: ['Not enough data', 'warn'] };

function groupBy(items, keyOf) {
  const m = new Map();
  for (const it of items) {
    const k = keyOf(it);
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return [...m.entries()];
}

function qualityPanel(L) {
  const v = L.validation.summary;
  const a = L.analysis;
  const ex = a.summary.excluded;
  const [qt, qtone] = QUALITY_CHIP[a.quality.status] ?? [a.quality.status, 'neutral'];
  const rows = [
    ['Rows read', num(v.read)],
    ['Accepted', `${num(v.accepted)}${v.withWarnings ? ` <span class="muted">(${v.withWarnings} with warnings)</span>` : ''}`],
    ['Rejected', num(v.rejected)],
    ['Accepted without charges', num(v.missingCharges)],
    ['Positions left out', num(ex.length)],
  ];
  const rejected = L.validation.rows.filter((r) => r.status === 'rejected');
  const byReason = groupBy(rejected, (r) => r.messages.find((m) => m.level === 'error')?.text ?? 'rejected');
  const rejList = byReason.map(([text, rs]) => `<li>${plural(rs.length, 'row')}: ${esc(text)}. <span class="muted">${rs.length === 1 ? 'Row' : 'Rows'} ${esc(rs.slice(0, 5).map((r) => r.line).join(', '))}${rs.length > 5 ? ` and ${rs.length - 5} more` : ''}.</span></li>`).join('');
  const exList = groupBy(ex, (x) => x.reason).map(([reason, xs]) => `<li>${plural(xs.length, 'position')}: ${esc(reason)}</li>`).join('');
  const items = a.quality.items.map((i) => `<li>${esc(i.text)}</li>`).join('');
  const notes = L.validation.notes.map((n) => `<li>${esc(n)}</li>`).join('');
  const clean = !rejected.length && !ex.length && !a.quality.items.length && !L.validation.notes.length;
  return panel({
    title: 'Data quality',
    subtitle: 'The simulated file goes through the same import checks as a real file. Missing values are never read as zero.',
    actions: chip(qt, qtone),
    body: `<dl class="kv lab-kv">${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join('')}</dl>
      ${clean ? '<p class="lab-reason muted lab-gap">Every simulated order passed validation and every position closed.</p>' : ''}
      ${rejList ? `<h3 class="lab-subhead">Rejected at import</h3><ul class="lab-list">${rejList}</ul>` : ''}
      ${exList ? `<h3 class="lab-subhead">Left out of the review</h3><ul class="lab-list">${exList}</ul>` : ''}
      ${items || notes ? `<h3 class="lab-subhead">Review notes</h3><ul class="lab-list">${items}${notes}</ul>` : ''}`,
  });
}

function rulesPanel(L) {
  const s = L.analysis.summary;
  const defs = HABIT_IDS.map((id) => `<li><strong>${esc(HABITS[id].short)}.</strong> ${esc(HABITS[id].definition)}</li>`).join('');
  const gates = [
    ['Enough history', `At least ${CONFIG.minUnits} closed trades in the month (${s.units} here).`],
    ['Repeated', `At least ${G.minN} occurrences.`],
    ['Spread out', `On at least ${G.minDays} different days.`],
    ['Material', `Associated excess loss of at least ${formatINR(s.floor)} here: the larger of ${formatINR(G.minCost)} and ${formatPct(G.lossShare, { digits: 0 })} of ${formatINR(s.grossLosses)} total losses after charges.`],
    ['Not one trade', `Without the costliest trade, at least ${formatINR(G.looMinCost)} and ${formatPct(G.looMinShare, { digits: 0 })} of the excess loss remain.`],
  ];
  return panel({
    title: 'The fixed rules',
    subtitle: 'Identical to the review. Nothing on this page changes them.',
    body: `<h3 class="lab-subhead lab-subhead-first">Behaviour definitions</h3><ul class="lab-list">${defs}</ul>
      <h3 class="lab-subhead">Evidence gates</h3><dl class="kv lab-kv">${gates.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`,
  });
}

// ---------- page ----------

// Runs the simulation for the current settings. A state the simulator cannot build (more busy days than
// trading days) is capped and said so; any other failure renders an error instead of stale results.
function labFor(state) {
  const p = state.lab.params;
  const capped = p.busyDays > p.days;
  const safe = capped ? { ...state, lab: { ...state.lab, params: { ...p, busyDays: p.days } } } : state;
  try {
    return { L: selectLab(safe), capped: capped ? p.busyDays : null };
  } catch {
    return { L: { scenario: state.lab.scenario, from: state.lab.from, params: p, analysis: null }, capped: null };
  }
}

export function render(state) {
  const { L, capped } = labFor(state);
  const head = `${pageHeader({
    eyebrow: 'Simulation',
    title: 'Scenario lab',
    lead: "Build a synthetic month and see how the review's fixed rules classify it. The simulated file runs through the same importer and engine as a real one.",
  })}
    ${callout({ tone: 'warn', title: 'Simulated trades only.', body: '<p>This is not a market forecast or a trading recommendation, and the rules here are the same fixed rules used in the review — only the history changes.</p>' })}
    ${presetPanel(L)}`;
  if (!L.analysis) {
    return `<div class="lab">${head}<div class="lab-layout">${controlsPanel(L)}<div class="lab-results">${callout({ tone: 'danger', title: 'These settings could not be simulated.', body: '<p>No results are shown for them. Change a setting or reset to a preset.</p>' })}</div></div></div>`;
  }
  const noteTexts = [
    ...(capped !== null ? [`Days with 7 trades cannot exceed the ${L.params.days} trading days, so this month has ${L.params.busyDays} busy days rather than ${capped}.`] : []),
    ...L.notes,
  ];
  const notes = noteTexts.length ? `<div class="lab-notes">${noteTexts.map((n) => callout({ tone: 'warn', title: 'Note on this simulation', body: `<p>${esc(n)}</p>` })).join('')}</div>` : '';
  return `<div class="lab">
    ${head}
    <div class="lab-layout">
      ${controlsPanel(L)}
      <div class="lab-results">
        ${notes}
        ${resultPanel(L)}
        ${habitsPanel(L)}
        ${plantedPanel(L)}
        ${qualityPanel(L)}
        ${rulesPanel(L)}
      </div>
    </div>
  </div>`;
}
