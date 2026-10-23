// Methodology & transparency: how Habit Ledger reaches every conclusion.
// Every threshold, definition and parameter on this page is read from the engine (CONFIG, HABITS,
// GUARDRAILS), the importer (FIELDS, LIMITS), the scenario lab (LAB_PARAMS, SCENARIOS) or the sample
// generator's holiday calendar (HOLIDAYS).
// Worked examples use the period currently selected, through the store's selectors.

import { esc, money, amount, missing, chip, statusChip, habitStatusChip, verdictChip, confidenceChip, panel, callout, pageHeader, table, linkTo } from '../ui/components.js';
import { formatINR, formatPct, formatLots, formatDate, plural, ordinal, isNum } from '../format.js';
import { CONFIG, HABITS, HABIT_IDS, GUARDRAILS, defaultGuardrailParams } from '../engine.js';
import { FIELDS, LIMITS } from '../import.js';
import { LAB_PARAMS, SCENARIOS } from '../lab.js';
import { HOLIDAYS } from '../data.js';
import { getDataset, listDatasets, selectAnalysis, selectPeriods } from '../store.js';

// ---------- small helpers ----------

const ul = (items, cls = '') => `<ul${cls ? ` class="${cls}"` : ''}>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const ol = (items, cls = '') => `<ol${cls ? ` class="${cls}"` : ''}>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
const prose = (html) => `<div class="method-prose">${html}</div>`;
const h3 = (text) => `<h3 class="method-h3">${text}</h3>`;
const n = (v) => `<span class="num">${esc(String(v))}</span>`;
const share = (x) => `<span class="num">${esc(formatPct(x, { digits: 0 }))}</span>`;
const rupees = (v) => `<span class="num">${esc(formatINR(v))}</span>`;
const mins = (v) => `<span class="num">${esc(`${v} min`)}</span>`;
const code = (t) => `<code>${esc(t)}</code>`;
const m2 = (v) => money(v, { decimals: 2 });
const a2 = (v) => amount(v, { decimals: 2 });
const MB = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;
const G = CONFIG.gates;
const C = CONFIG.compare;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (k) => WORDS[k] ?? String(k);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// A probability threshold in the same words the rest of the app uses ("1 in 20"), with the percentage.
const oneIn = (p) => `<span class="num">1 in ${esc(String(Math.round(1 / p)))}</span> (${share(p)})`;
const MAX_H = CONFIG.maxHabits;

// The same store selectors, pointed at another dataset (pure: returns a new state object).
const forDataset = (state, id) => ({ ...state, datasetId: id });

function sourceText(state) {
  const ds = getDataset(state);
  return ds.kind === 'import'
    ? `your import “${esc(ds.name)}” (read in this browser tab only)`
    : `${esc(ds.name)}, a sample trader with synthetic orders`;
}

function periodText(a) {
  return a.summary.periodLabel ? esc(a.summary.periodLabel) : 'the imported data';
}

function gateNames(state) {
  const checks = selectAnalysis(state).habits[HABIT_IDS[0]].gates.checks;
  return Object.fromEntries(checks.map((c) => [c.id, c.name]));
}

function unitText(p) {
  if (p.type === 'toggle') return '';
  return p.unit.startsWith('%') ? p.unit : ` ${p.unit}`;
}

const NUBRA_LABEL = {
  documented: ["Documented in Nubra's public API docs", 'accent'],
  proposed: ['Proposed (not a Nubra feature)', 'warn'],
};
const nubraChip = (status) => {
  const [t, tone] = NUBRA_LABEL[status] ?? [status, 'neutral'];
  return chip(t, tone);
};

const ASSOCIATION = 'This is an association, not proof that the behaviour caused the loss.';

// ---------- 1. scope ----------

function scopeSection(state) {
  const samples = listDatasets(state).filter((d) => d.kind === 'sample');
  const names = samples.map((d) => esc(d.name)).join(', ');
  const does = [
    'Rebuilds your closed option trades from the executed orders in a CSV file, including multi-leg strategies.',
    `Tests ${word(HABIT_IDS.length)} defined behaviours against four fixed evidence gates and confirms only those that pass.`,
    'Puts a rupee figure on each confirmed behaviour: the excess loss associated with it, compared with your usual trade (for hedge removal, with the spread’s own defined maximum loss).',
    'Shows the trades, the arithmetic and the gate results behind every figure, so each number can be checked by hand.',
    'Lets you set a personal guardrail for a behaviour and measures, in the period you are viewing and the months either side of it, how often trades kept to it.',
    'Compares two months by how often each behaviour happened per chance, with the uncertainty stated.',
  ];
  const doesNot = [
    'Use live or historical market prices. Only your own executed orders are read.',
    'Connect to Nubra or any broker, or place, modify or cancel orders.',
    'Give investment advice or recommend any trade, instrument or strategy.',
    'Estimate profit from decisions you did not take, or predict future results.',
    'Know your account size, your trading plan or your intent. Timing and size are used as proxies.',
    'Review open positions, futures or equity. Only closed CE/PE option trades are reviewed.',
    'Use an AI model to reach conclusions. Every rule is fixed code, applied the same way to every trader.',
  ];
  const body = `${prose(`<p>Habit Ledger is a post-trade review. It reads a month of executed option orders, rebuilds the closed trades, and looks for the few repeated behaviours that are associated with losses larger than your usual trade. Each rupee figure it shows is that excess loss, measured against your own trades. ${ASSOCIATION}</p>`)}
    <div class="method-two">
      <div>${h3('What it does')}${ul(does, 'method-list')}</div>
      <div>${h3('What it does not do')}${ul(doesNot, 'method-list')}</div>
    </div>
    ${callout({
      tone: 'info',
      title: 'Where the data comes from',
      body: `<p>The sample traders (${names}) are synthetic: every order was generated, none was traded. A CSV you import is read in this browser tab only, is never uploaded, and is gone when you close the tab. Guardrails saved for a sample trader are kept in this browser's local storage; guardrails on an import last only for the visit. Nothing is sent to Nubra or to any broker.</p><p>You are currently viewing ${sourceText(state)}.</p>`,
    })}`;
  return body;
}

// ---------- 2. orders to trades ----------

function tradesSection() {
  const steps = [
    `<strong>Read and validate each row.</strong> Each row is one executed order (a fill). A row with an invalid value is rejected with its row number and the reason; a blank or non-numeric price, quantity or charge is never read as ₹0. Only CE/PE options are reviewed, so futures and equity rows are rejected. Files up to ${n(MB(LIMITS.maxBytes))} are accepted and the first ${n(LIMITS.maxRows.toLocaleString('en-IN'))} rows are read.`,
    '<strong>Put every time in IST.</strong> Timestamps with a timezone are converted to IST (UTC+05:30). A timestamp without a timezone is read as IST, and the import says how many were.',
    '<strong>Build positions, flat to flat.</strong> Fills of the same contract symbol and the same strategy ID are followed in time order. A position opens with its first fill and closes when its quantity returns to zero. The first fill sets the direction: a buy opens a long, a sell opens a short. Its realised P&amp;L is measured two ways: gross P&amp;L is sell value minus buy value; net P&amp;L is gross P&amp;L minus recorded charges.',
    '<strong>Group strategies into one trade.</strong> Positions that share a strategy ID become a single trade: P&amp;L is summed across legs, the trade opens with its first leg and closes with its last, and its size is its largest leg. Positions with no strategy ID are single-leg trades.',
    '<strong>Assign each trade to a period.</strong> A trade belongs to the calendar month, in IST, in which it was opened, even if it closed in the next month. Months are reviewed separately and can be compared.',
  ];
  const handling = table({
    id: 'method-handling-table',
    caption: 'How unusual rows and positions are handled',
    columns: [{ key: 'case', label: 'Situation' }, { key: 'how', label: 'How it is handled' }],
    rows: [
      ['Position still open at the end of the data, or its closing order is missing (for example a row rejected at import)', 'Left out of every figure until it closes, and listed under data quality.'],
      ['Position flips from long to short (or back) in one order', 'Left out, because its P&amp;L cannot be split cleanly between the two directions, and listed under data quality.'],
      ['Charges blank on a row', 'Kept. The trade’s net P&amp;L excludes the missing charges, the trade is flagged, and the count appears under data quality. Missing charges are shown as “—”, never as ₹0.'],
      ['Charges, price or quantity not a valid number', 'Row rejected with the reason. Nothing is assumed.'],
      ['The same order ID on two rows', 'The second row is rejected, so one order cannot be counted twice.'],
      ['A further file added to an existing imported trader', 'Its orders are merged into that trader. An order whose ID is already there is skipped, not counted again, and the import reports how many were skipped. Saved guardrails carry over.'],
      ['Two rows identical in time, symbol, side, quantity, price and strategy ID', 'Kept but flagged as a possible duplicate, because partial fills can look identical. The import preview lets you exclude them.'],
      ['Expiry missing or not YYYY-MM-DD', 'Shown as missing. Expiry does not enter any calculation.'],
    ],
  });
  const fieldRows = Object.entries(FIELDS).map(([key, f]) => [
    `<strong>${esc(f.label)}</strong><div class="muted small">${code(key)}</div>`,
    f.required ? chip('Required', 'accent') : chip('Optional', 'muted'),
    esc(f.help),
  ]);
  const fields = table({
    id: 'method-fields-table',
    caption: 'Columns read from an imported file',
    columns: [{ key: 'field', label: 'Column' }, { key: 'req', label: 'Needed' }, { key: 'help', label: 'How it is read' }],
    rows: fieldRows,
  });
  return `${prose(ol(steps, 'method-steps'))}
    ${h3('Rows and positions that need special handling')}${handling}
    ${h3('Columns read from your file')}
    ${prose('<p class="muted small">Column names are matched case-insensitively against common broker headers, and you confirm the mapping before anything is analysed.</p>')}
    ${fields}
    <p class="method-after">${linkTo('Open the import wizard', 'import')}</p>`;
}

// ---------- 3. behaviours ----------

const COST_MODEL = { 'baseline-excess': 'Baseline excess', 'beyond-max-loss': 'Loss beyond defined max loss' };

function behavioursSection() {
  const rows = HABIT_IDS.map((id) => {
    const h = HABITS[id];
    return [
      `<strong>${esc(h.name)}</strong><div class="muted small">${esc(id)} · ${esc(h.short)}</div>`,
      esc(h.definition),
      esc(h.appliesTo),
      `${esc(h.chances)}<div class="muted small">${esc(h.chanceNote)}</div>`,
      `${esc(h.comparison)}<div class="muted small">Cost model: ${esc(COST_MODEL[h.costModel] ?? h.costModel)}</div>`,
      ul(h.cannotConclude.map(esc), 'method-cell-list'),
    ];
  });
  return `${prose(`<p>Each behaviour is a fixed rule, applied the same way to every trader. Its trigger uses only the timing, prices and sizes of orders and the results of earlier trades, never the trade’s own final result, so a trade cannot qualify because it lost. Some triggers happen after entry: adding to a loser is an add fill inside the trade, and hedge removal depends on when the legs were closed. The rule decides which trades count as <em>occurrences</em> and which trades could have counted, the <em>chances</em>. Thresholds are set in advance and are not tuned per trader, to avoid fishing for patterns.</p>`)}
    ${table({
      id: 'method-habit-table',
      caption: 'The five behaviours Habit Ledger checks',
      columns: [
        { key: 'name', label: 'Behaviour' },
        { key: 'def', label: 'Exact definition' },
        { key: 'applies', label: 'Applies to' },
        { key: 'chances', label: 'Chances (denominator)' },
        { key: 'cmp', label: 'Compared with' },
        { key: 'cannot', label: 'Cannot conclude' },
      ],
      rows,
    })}
    ${prose(`<p class="muted small">Sizes for “${esc(HABITS.H4.short)}” are measured in lots at entry, against the median entry size of all trades in the period. The daily count for “${esc(HABITS.H5.short)}” orders trades by their open time; a strategy counts once however many legs it has.</p>`)}`;
}

// ---------- 4. gates ----------

function gatesSection(state) {
  const names = gateNames(state);
  const a = selectAnalysis(state);
  const gateRows = [
    ['G1', 'Occurrences in the period', `at least ${n(G.minN)}`, `Fewer than ${n(G.minN)} instances are anecdotes, not a habit.`],
    ['G2', 'Different trading days with an occurrence', `at least ${n(G.minDays)}`, `Occurrences bunched on fewer than ${n(G.minDays)} days may reflect a few bad days rather than a repeated behaviour.`],
    ['G3', 'Associated excess loss', `at least the period’s materiality floor: the larger of ${rupees(G.minCost)} and ${share(G.lossShare)} of the period’s total losses after charges (the net losses of every losing trade, added up)`, 'A small amount relative to the month is not worth acting on.'],
    ['G4', 'Excess loss after removing the single costliest occurrence', `at least ${rupees(G.looMinCost)} and at least ${share(G.looMinShare)} of the total`, 'One very large trade cannot carry a habit on its own.'],
  ].map(([id, test, threshold, why]) => [`<strong>${esc(id)} · ${esc(names[id] ?? '')}</strong>`, test, threshold, why]);

  const statusRows = [
    [statusChip('confirmed'), `Passed all four gates, survived de-duplication, and the period has at least ${n(CONFIG.minUnits)} closed trades.`],
    [statusChip('overlap'), 'Passed on its own, but fails a gate once the trades it shares with a higher-ranked confirmed habit are removed. The behaviour’s own figures are shown as its detector saw them, before de-duplication, with how many trades it shares, which habit it shares them with, and the result of the re-check without them.'],
    [habitStatusChip({ status: 'overlap', limitCut: true }, MAX_H), `Passed every gate, even after de-duplication, but only the top ${n(MAX_H)} habits are reported each period and ${word(MAX_H)} with larger excess losses were already confirmed. It is listed, not added to the headline.`],
    [statusChip('insufficient'), `Seen, with some excess loss, but at least one gate failed (the first failed gate is given as the reason), or every gate passed but the period has fewer than ${n(CONFIG.minUnits)} closed trades.`],
    [statusChip('not-costly'), 'Seen, but those trades did no worse than your usual trade, so there is no excess loss to attribute.'],
    [statusChip('not-seen'), 'No occurrences, or no chances for it to occur (for example, no hedged spreads).'],
  ];

  const dedup = [
    'Every detector runs on all trades of the period independently (its standalone result).',
    'Behaviours that pass all four gates are ranked by standalone excess loss, costliest first.',
    'Going down the ranking, each behaviour keeps only trades not already claimed by a higher-ranked confirmed habit. If any were removed, its cost and gates are recomputed without them (re-checked).',
    `If it still passes and fewer than ${word(MAX_H)} habits are confirmed, it is confirmed and claims its trades. If it fails the re-check, it is reported as overlapping, with the habit it shares trades with and how many it shares. If it passes but ${word(MAX_H)} habits are already confirmed, it is reported as over the ${n(MAX_H)}-habit limit.`,
    `At most ${word(MAX_H)} habits are confirmed in a period. Each trade counts toward one confirmed habit, so the headline never counts a loss twice.`,
  ];

  return `${prose(`<p>A behaviour is called a habit only if it passes four gates. The gates are checked in order and the first one that fails is reported in plain language. Thresholds are the same for every trader and every month.</p>`)}
    ${table({
      id: 'method-gate-table',
      caption: 'Evidence gates',
      columns: [{ key: 'gate', label: 'Gate' }, { key: 'test', label: 'What is measured' }, { key: 'thr', label: 'Needs' }, { key: 'why', label: 'Why' }],
      rows: gateRows,
    })}
    ${h3('Strong or moderate evidence')}
    ${prose(`<p>A confirmed habit is labelled ${confidenceChip('Strong')} when it has at least ${n(G.strongN)} occurrences and its excess loss is still at least ${rupees(G.looMinCost)} after removing the two costliest occurrences. Otherwise it is labelled ${confidenceChip('Moderate')}. The label describes how much the conclusion depends on a few trades; it is not a probability.</p>`)}
    ${h3('Thin periods')}
    ${prose(`<p>A period with fewer than ${n(CONFIG.minUnits)} closed trades is too thin to judge habits at all. Nothing is confirmed in it, even if a behaviour passes every gate; such behaviours are listed with that reason instead.</p>`)}
    ${h3('Each trade counts toward one habit')}
    ${prose(ol(dedup, 'method-steps'))}
    ${h3('How each behaviour is labelled')}
    ${table({ id: 'method-status-table', caption: 'Behaviour statuses', columns: [{ key: 's', label: 'Status' }, { key: 'm', label: 'Meaning' }], rows: statusRows })}
    ${floorExample(state, a)}`;
}

function floorExample(state, a) {
  const period = periodText(a);
  if (!a.summary.units) {
    return callout({ tone: 'info', title: 'Applied to the period you are viewing', body: `<p>There are no closed trades in ${period}, so there is no materiality floor to show.</p>` });
  }
  const totalLosses = a.summary.grossLosses; // total losses after charges
  const part = G.lossShare * totalLosses;
  const arithmetic = a.stats.losses
    ? `total losses after charges in ${period} were ${amount(totalLosses)} across ${plural(a.stats.losses, 'losing trade')}. ${share(G.lossShare)} of that is ${amount(part)}, so this period’s floor for G3 is the larger of ${rupees(G.minCost)} and ${amount(part)}: <strong>${amount(a.summary.floor)}</strong>.`
    : `there were no losing trades in ${period}, so the floor for G3 is the minimum, <strong>${amount(a.summary.floor)}</strong>.`;
  const thin = a.summary.thin
    ? `<p>This period has ${plural(a.summary.units, 'closed trade')}, fewer than ${n(CONFIG.minUnits)}, so no behaviour can be confirmed in it whatever the gates say.</p>`
    : '';
  return callout({
    tone: 'info',
    title: `Applied to ${period}`,
    body: `<p>For ${sourceText(state)}: ${arithmetic}</p>${thin}`,
  });
}

// ---------- 5. money ----------

function moneySection(state) {
  const a = selectAnalysis(state);
  return `${prose(`<p>Every cost is an <strong>excess loss associated with</strong> a behaviour, measured against your own trades. It is not an estimate of the result of a different decision, and a cost of zero or less means “no excess loss”, never a gain.</p>`)}
    ${callout({ tone: 'neutral', title: 'Reading the rupee figures', body: `<p>${ASSOCIATION} Losses can also reflect the market on those days, position size, or other trades.</p>` })}
    ${h3('Baseline excess (used for H1, H2, H4 and H5)')}
    <div class="formula" role="group" aria-label="Baseline excess formula">
      <div class="eq">excess loss = −( Σ net P&amp;L of the n occurrences − n × b )</div>
      <div class="eq">b = min( mean net P&amp;L of the comparison set, 0 )</div>
    </div>
    ${prose(ul([
      'Each occurrence contributes −(its net P&amp;L − b): how much more it lost than your usual trade. An occurrence that did better than b reduces the total.',
      'The comparison set is the behaviour’s eligible trades that are not occurrences (see section 6).',
      `<strong>Thin-baseline fallback.</strong> If the comparison set has fewer than ${n(CONFIG.thinBaseline)} trades, its mean is not trusted and b = ₹0: each occurrence then counts only its own net loss.`,
      '<strong>Why b is capped at zero.</strong> If your usual trade makes money, a positive baseline would turn “earned less than usual” into a cost, which is a statement about profit that was never made. Habit Ledger does not count forgone profit, so the baseline never goes above ₹0, and the figure counts only money actually lost beyond what your usual trade lost.',
    ], 'method-list'))}
    ${h3('Loss beyond defined max loss (used for H3)')}
    <div class="formula" role="group" aria-label="Beyond max loss formula">
      <div class="eq">defined max loss = widest wing × quantity − net credit   (credit structures)</div>
      <div class="eq">defined max loss = net debit                              (debit structures)</div>
      <div class="eq">excess loss per occurrence = max( 0, −gross P&amp;L − defined max loss )</div>
    </div>
    ${prose(ul([
      'Widest wing × quantity is the largest strike distance between a short leg and a long leg of the same option type, multiplied by that short leg’s largest open quantity; quantity is counted once. Where there are several short legs, the largest of these products is used. Net credit is premium received on short legs minus premium paid on long legs, valued at each leg’s first entry price and largest open quantity.',
      'Gross P&amp;L (before charges) is used because the defined maximum loss is a statement about premiums.',
      '<strong>Downside only.</strong> An occurrence counts only the loss beyond what the spread could have lost with its hedge in place. When removing the hedge ended well it contributes ₹0, never a negative amount: the review does not credit outcomes that depended on the market moving your way.',
    ], 'method-list'))}
    ${h3('Headline and materiality floor')}
    <div class="formula" role="group" aria-label="Headline and floor formulas">
      <div class="eq">headline = Σ excess loss of confirmed habits, after de-duplication</div>
      <div class="eq">materiality floor = max( ${esc(formatINR(G.minCost))}, ${esc(formatPct(G.lossShare, { digits: 0 }))} × total losses after charges in the period )</div>
    </div>
    ${prose(`<p><strong>Total losses after charges</strong> are the net losses of every losing trade in the period, added up. Unlike gross P&amp;L above, they include charges. Behaviours that were not confirmed are never added to the headline, and each trade counts toward one confirmed habit, so no loss is counted twice.</p><p><strong>Rounding.</strong> The headline is the exact sum of the confirmed habits’ excess losses. Elsewhere in the app, figures are shown rounded to the rupee, so the rounded habit figures can add up to ${rupees(1)} more or less than the rounded headline.</p>`)}
    ${workedMoney(state, a)}`;
}

function workedMoney(state, a) {
  const period = periodText(a);
  const intro = `<p class="muted small">Worked from ${sourceText(state)}${a.summary.periodLabel ? `, ${period}` : ''}. Every value below comes from the same engine result the other pages show, to the paisa so each line can be checked; other pages round to the rupee.</p>`;
  if (!a.summary.units) {
    return `${h3('Worked example from the period you are viewing')}${intro}${callout({ tone: 'info', body: `<p>There are no closed trades in ${period}, so there is nothing to work through.</p>` })}`;
  }
  const blocks = [];

  // a.habits carries the status label; confirmed habits there already hold their de-duplicated evidence.
  const topConfirmed = a.confirmed.find((h) => h.costing.model === 'baseline-excess');
  const be = topConfirmed ? a.habits[topConfirmed.id]
    : HABIT_IDS.map((id) => a.habits[id]).find((h) => h.costing.model === 'baseline-excess' && h.evidence.length);
  if (be) {
    const c = be.costing;
    const occ = be.evidence.length;
    const sumNet = be.evidence.reduce((s, e) => s + e.netPnl, 0);
    const baselineRow = c.thin
      ? `<div class="row"><span>Baseline b</span><span>${m2(0)} <span class="muted small">(only ${plural(c.comparisonN, 'comparison trade')}, fewer than ${CONFIG.thinBaseline})</span></span></div>`
      : `<div class="row"><span>Baseline b = min(mean, 0)</span><span>${m2(c.baseline)}</span></div>`;
    // Confirmed habits carry their de-duplicated evidence; an overlapping one shows its standalone figures.
    const occNote = be.status === 'confirmed' && be.overlap ? ' (after de-duplication)' : be.status === 'overlap' ? ' (standalone, before de-duplication)' : '';
    blocks.push(`<div class="method-worked">
      <div class="chip-row"><strong>${esc(be.name)}</strong>${habitStatusChip(be, MAX_H)}</div>
      <div class="formula">
        <div class="row"><span>Occurrences n${occNote}</span><span>${n(occ)}</span></div>
        <div class="row"><span>Σ net P&amp;L of the occurrences</span><span>${m2(sumNet)}</span></div>
        <div class="row"><span>Comparison set</span><span>${plural(c.comparisonN, 'trade')}, mean ${isNum(c.comparisonMean) ? m2(c.comparisonMean) : missing('No comparison trades')}</span></div>
        ${baselineRow}
        <div class="row"><span>n × b</span><span>${m2(occ * c.baseline)}</span></div>
        <div class="row total"><span>Excess loss = −(Σ − n × b)</span><span>${be.cost > 0 ? a2(be.cost) : 'No excess loss'}</span></div>
      </div>
      <p class="muted small">Comparison set: ${esc(HABITS[be.id].comparison.toLowerCase())}.</p>
    </div>`);
  }

  const h3h = a.habits.H3;
  if (h3h.evidence.length) {
    const e = [...h3h.evidence].sort((x, y) => y.contribution - x.contribution)[0];
    blocks.push(`<div class="method-worked">
      <div class="chip-row"><strong>${esc(h3h.name)}</strong>${habitStatusChip(h3h, MAX_H)}</div>
      <p class="muted small">Costliest occurrence: ${esc(e.label)}, ${esc(formatDate(e.day))} at ${esc(e.time)}.</p>
      <div class="formula">
        <div class="row"><span>Defined max loss at entry</span><span>${isNum(e.maxLoss) ? a2(e.maxLoss) : missing()}</span></div>
        <div class="row"><span>Actual result before charges (gross P&amp;L)</span><span>${m2(e.grossPnl)}</span></div>
        <div class="row total"><span>Excess = max(0, −gross − max loss)</span><span>${e.contribution > 0 ? a2(e.contribution) : 'No excess loss'}</span></div>
      </div>
      <p class="muted small">Across ${plural(h3h.evidence.length, 'occurrence')} the total is ${h3h.cost > 0 ? a2(h3h.cost) : 'no excess loss'}.</p>
    </div>`);
  }

  if (a.confirmed.length) {
    blocks.push(`<div class="method-worked">
      <div class="chip-row"><strong>Headline for ${period}</strong></div>
      <div class="formula">
        ${a.confirmed.map((h) => `<div class="row"><span>${esc(h.name)}</span><span>${a2(h.cost)}</span></div>`).join('')}
        <div class="row total"><span>Headline: associated excess loss</span><span>${a2(a.headlineCost)}</span></div>
      </div>
    </div>`);
  } else {
    blocks.push(callout({ tone: 'info', body: `<p>No behaviour is confirmed in ${period}${a.summary.thin ? ` (the period has fewer than ${CONFIG.minUnits} closed trades)` : ''}, so there is no headline figure.</p>` }));
  }
  if (!be && !h3h.evidence.length) blocks.unshift(callout({ tone: 'info', body: `<p>None of the ${word(HABIT_IDS.length)} behaviours occurred in ${period}, so there is no cost to work through.</p>` }));

  return `${h3('Worked example from the period you are viewing')}${intro}<div class="method-worked-grid">${blocks.join('')}</div>`;
}

// ---------- 6. baselines ----------

const WHY_BASELINE = {
  H1: 'Any trade can follow a loss, so quick re-entries are compared with every trade that was not one.',
  H2: 'Only single-leg option buys can be added to, so they are compared like for like, not with spreads or short options.',
  H3: 'A hedged spread has a known worst case at entry, so it is measured against its own limit rather than against other trades.',
  H4: 'Any trade can be sized up, so large trades after two wins are compared with every other trade.',
  H5: `Any trade can be the ${ordinal(CONFIG.dailyTradeLimit + 1)} or later of a day, so trades past the limit are compared with every other trade.`,
};

function baselinesSection(state) {
  const a = selectAnalysis(state);
  const rows = HABIT_IDS.map((id) => {
    const h = HABITS[id];
    const c = a.habits[id].costing;
    let applied;
    if (!a.summary.units) applied = missing('No closed trades in this period');
    else if (!a.habits[id].opportunities) applied = `<span class="muted">No ${esc(h.chances)} in this period, so there is nothing to compare.</span>`;
    else if (c.model !== 'baseline-excess') applied = '<span class="muted">Not used: each spread is compared with its own max loss.</span>';
    else if (c.thin) applied = `${plural(c.comparisonN, 'trade')}, fewer than ${n(CONFIG.thinBaseline)}, so b = ${money(0)}`;
    else applied = `${plural(c.comparisonN, 'trade')}, mean ${money(c.comparisonMean)} → b = ${money(c.baseline)}`;
    return [`<strong>${esc(h.short)}</strong><div class="muted small">${esc(id)}</div>`, esc(h.comparison), WHY_BASELINE[id] ?? '', applied];
  });
  return `${prose(`<p>A cost is only meaningful against a fair comparison. Each behaviour is compared with the trades that were eligible for it but did not show it, in the same period and for the same trader, so market conditions and style are as similar as the data allows.</p>`)}
    ${table({
      id: 'method-baseline-table',
      caption: 'Comparison set per behaviour',
      columns: [{ key: 'h', label: 'Behaviour' }, { key: 'cmp', label: 'Compared with' }, { key: 'why', label: 'Why' }, { key: 'now', label: `In ${a.summary.periodLabel ?? 'this data'}` }],
      rows,
    })}`;
}

// ---------- 7. comparing periods ----------

function compareSection() {
  const fell = `The rate fell by at least ${share(C.improve)} relative to the earlier period`;
  const rose = `The rate rose by at least ${share(C.worse)} relative to the earlier period (or rose from zero)`;
  const verdictRows = [
    [verdictChip('Not applicable'), 'No chances in either period, so the behaviour could not occur.'],
    [verdictChip('Inconclusive'), `Fewer than ${n(C.minOpp)} chances in either period. No direction is given.`],
    [verdictChip('Not seen'), 'Enough chances in both periods, but no occurrence in either.'],
    [verdictChip('Improving', 'strong'), `${fell}, and the one-sided chance of a drop that large, if nothing had changed, is below ${oneIn(C.strongAlpha)}.`],
    [verdictChip('Improving', 'suggestive'), `${fell}, and that chance is between ${oneIn(C.strongAlpha)} and ${oneIn(C.alpha)}: a hint, not a result.`],
    [verdictChip('Worsening', 'strong'), `${rose}, and the one-sided chance of a rise that large, if nothing had changed, is below ${oneIn(C.strongAlpha)}.`],
    [verdictChip('Worsening', 'suggestive'), `${rose}, and that chance is between ${oneIn(C.strongAlpha)} and ${oneIn(C.alpha)}: a hint, not a result.`],
    [verdictChip('No clear change'), `Anything else: the change is smaller than that, or its chance is ${oneIn(C.alpha)} or more.`],
  ];
  const strengthRows = [
    ['strong', `below ${oneIn(C.strongAlpha)}`],
    ['suggestive', `from ${oneIn(C.strongAlpha)} up to, but not including, ${oneIn(C.alpha)}`],
    ['weak', `${oneIn(C.alpha)} or more`],
  ].map(([s, p]) => [chip(cap(s), 'neutral'), p]);
  const h1 = HABITS.H1;
  return `${prose(`<p>A month is judged better or worse by how often a behaviour happened <em>per chance</em>, not by how much it cost.</p>`)}
    <div class="formula" role="group" aria-label="Rate formula"><div class="eq">rate = occurrences ÷ chances</div></div>
    ${prose(ul([
      `Chances are the denominator from section 3 (for example, for “${esc(h1.short)}” the chances are ${esc(h1.chances)}), so occurrences and chances are counted in the same unit and a rate is never above 100%. Comparisons use each detector’s standalone counts, before de-duplication, so a behaviour can be measured even in a month where it was not confirmed.`,
      '<strong>Tracked or context only.</strong> A behaviour that was a confirmed habit in at least one of the two periods is tracked. A behaviour that was not a confirmed habit in either period is still measured the same way, but is shown separately, as context only.',
      'The direction is tested with a <strong>one-sided Fisher exact test</strong> on the two periods’ counts (occurred / did not occur). The result is the chance, if the underlying rate had not changed, of seeing a change at least this large in that direction. It is shown in words, such as “about 1 in 12”.',
      'Charts show each rate with a <strong>90% Wilson score interval</strong>, which stays sensible for small counts and rates near zero.',
    ], 'method-list'))}
    ${table({ id: 'method-verdict-table', caption: 'Verdicts', columns: [{ key: 'v', label: 'Verdict' }, { key: 'r', label: 'Rule' }], rows: verdictRows })}
    ${h3('Strength of the evidence for a change')}
    ${table({ id: 'method-strength-table', caption: 'Strength labels', columns: [{ key: 's', label: 'Label' }, { key: 'p', label: 'Chance of a change this large if nothing changed' }], rows: strengthRows })}
    ${h3('Why cost does not decide the verdict')}
    ${prose(`<p>Excess loss depends on how the market moved, on position size, and on how your other trades did, since they form the baseline. A month can look cheaper because you traded less, traded smaller, or were lucky, with the behaviour itself unchanged. The rate per chance isolates the behaviour, so a month with fewer trades at the same rate is “No clear change”, not “Improving”. Cost is shown alongside for context only.</p>`)}`;
}

// ---------- 8. guardrails ----------

// The engine sets the lot cap's default from the period's median entry size × CONFIG.lotCapMultiple.
const LOT_CAP_FACTOR = CONFIG.lotCapMultiple;
const derivedDefault = (p) => p.default === null || p.default === undefined;
const valueText = (p, v) => (p.unit === 'lots' ? esc(formatLots(v)) : `${esc(String(v))}${esc(unitText(p))}`);

function settingText(p, value, hasTrades) {
  const range = `${esc(p.label)}: ${n(`${p.min}–${p.max}`)}${esc(unitText(p))}`;
  if (!derivedDefault(p)) return `${range}, default <span class="num">${valueText(p, value)}</span>`;
  return hasTrades
    ? `${range}, default for this period <span class="num">${valueText(p, value)}</span>`
    : `${range}, default for this period ${missing('No closed trades in this period, so there is no median entry size to set it from')}`;
}

function guardrailsSection(state) {
  const a = selectAnalysis(state);
  const hasTrades = a.summary.units > 0;
  const cards = HABIT_IDS.map((id) => {
    const t = GUARDRAILS[id];
    const params = defaultGuardrailParams(id, a);
    // Without closed trades a period-derived default is only the engine's fallback, so the rule is shown with N.
    const shown = { ...params };
    if (!hasTrades) for (const p of t.params) if (derivedDefault(p)) shown[p.key] = 'N';
    const settings = t.params.length
      ? t.params.map((p) => `<dt>Setting</dt><dd>${settingText(p, params[p.key], hasTrades)}</dd>`).join('')
      : `<dt>Setting</dt><dd>None. The review’s own ${mins(CONFIG.hedgeGapMin)} gap is used.</dd>`;
    const snippet = t.nubra.snippet
      ? `<details class="method-snippet"><summary>Request fields as described in the docs</summary><pre><code>${esc(JSON.stringify(t.nubra.snippet, undefined, 2))}</code></pre><p class="muted small">Field names as described in the docs, with placeholder values. Illustrative shape only: Habit Ledger never builds or sends this request.</p></details>`
      : '';
    return `<article class="method-card" aria-labelledby="method-guard-${esc(id)}">
      <h3 class="method-h3" id="method-guard-${esc(id)}">${esc(t.title)}</h3>
      <p class="muted small">For “${esc(HABITS[id].name)}”</p>
      <dl class="kv method-kv">
        <dt>Rule</dt><dd>${esc(t.rule(shown))}</dd>
        <dt>Measured as</dt><dd>${esc(t.measure(shown))}</dd>
        ${settings}
      </dl>
      <div class="method-nubra">${nubraChip(t.nubra.status)}<p class="small">${esc(t.nubra.text)}</p>${snippet}</div>
    </article>`;
  }).join('');
  const med = a.habits.H4.median;
  const lotDefault = defaultGuardrailParams('H4', a).maxLots;
  const lotNow = hasTrades && isNum(med)
    ? ` For this period: ${esc(formatLots(med))} × ${n(LOT_CAP_FACTOR)} = ${esc(formatLots(med * LOT_CAP_FACTOR))}, so the default is ${esc(formatLots(lotDefault))}.`
    : ' This period has no closed trades, so there is no median entry size and no default to show.';
  const byStatus = (s) => HABIT_IDS.filter((id) => GUARDRAILS[id].nubra.status === s).map((id) => `“${esc(GUARDRAILS[id].title)}”`);
  const documented = byStatus('documented');
  const proposed = byStatus('proposed');
  const listText = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');
  // Each card below carries the engine's own wording for what is documented and what is related.
  const labels = documented.length
    ? `Only ${listText(documented)} ${documented.length === 1 ? 'relies' : 'rely'} on a documented control${proposed.length ? `; ${listText(proposed)} ${proposed.length === 1 ? 'is' : 'are'} proposed` : ''}.`
    : 'Every guardrail is proposed.';
  return `${prose(`<p>A guardrail is a personal rule for one behaviour. Saving one changes nothing outside this page: no order, setting or message is sent to Nubra or any broker.</p>`)}
    ${prose(ul([
      '<strong>Compliance is measured with the same detectors</strong> the review uses, run on the period’s trades with the rule’s own settings (for example, your cool-off minutes instead of the review’s fixed window).',
      'Compliance = 1 − breaks ÷ chances, where a break is a trade that did not keep to the rule. It is shown for the period you are viewing and the periods before and after it. When there are no chances, compliance is shown as missing, never as 100%.',
      '<strong>After the rule, or a what-if.</strong> A period counts as “after” the rule only when every trade in it was opened after the rule’s current settings were saved; changing the settings starts that again. Any other period is a what-if: its trades already existed, so the figure shows how often the behaviour happened, measured against the rule, not what the rule changed. The sample trades all predate any rule saved here, so every sample period is a what-if.',
      `The lot cap is the exception: it applies to every trade, so its chances are all trades, not only those after two wins. Its default is ${n(LOT_CAP_FACTOR)} × your median entry size in the period, rounded up to a whole lot (at least 1 lot).${lotNow}`,
      'Fills show what executed, not what was resting, so every rule is measured by the behaviour it targets. The review cannot see whether a stop-loss was attached or cancelled.',
      `Each guardrail is labelled either “Documented in Nubra’s public API docs”, when the order control it relies on is described there, or “Proposed (not a Nubra feature)”, when no public equivalent was found. ${labels} A related documented control mentioned on a card is not the rule itself, and a documented control is not a claim that Nubra enforces the rule.`,
    ], 'method-list'))}
    <div class="method-cards">${cards}</div>`;
}

// ---------- 9. limitations ----------

function limitsSection() {
  const lots = Object.entries(CONFIG.lotSize).map(([u, s]) => `${esc(u)} ${n(s)}`).join(', ');
  const rows = [
    ['Partial fills at identical prices', 'Two rows with the same time, symbol, side, quantity, price and strategy ID are flagged as a possible duplicate and kept unless you exclude them in the import preview.', 'A genuine split fill is safe to keep; a file exported twice is not. Check the preview.'],
    ['Trades that span two months', 'Counted in the month they were opened (IST), with their full P&amp;L.', 'A month’s figures can include P&amp;L realised after the month ended.'],
    ['Legs that share a strategy ID', 'Assumed to be one strategy, whatever they are.', 'Unrelated legs tagged with the same ID are merged. Spread legs without an ID are reviewed as separate single-leg trades, and hedge removal cannot be seen.'],
    ['Lot sizes', `Illustrative lot sizes are used (${lots}). Any other underlying is counted as 1 unit = 1 lot, with a data-quality warning.`, 'Size comparisons for other underlyings are in units, not lots. P&amp;L is unaffected.'],
    ['Small samples', `A habit needs ${n(G.minN)}+ occurrences on ${n(G.minDays)}+ days; a period needs ${n(CONFIG.minUnits)}+ trades; a comparison needs ${n(C.minOpp)}+ chances in each period.`, 'Even a confirmed habit rests on a handful of trades. Treat the confidence label as rough.'],
    ['Several behaviours tested at once', `${cap(word(HABIT_IDS.length))} behaviours are tested every month with fixed thresholds. No correction for multiple testing is applied.`, 'Occasionally a behaviour will pass the gates by chance. The gates make this rarer; they do not rule it out.'],
    ['No market prices', 'The review never uses quotes, so it cannot value a different exit, a held hedge, or what an option did after you sold it.', 'Costs compare with your own trades, not with a hypothetical alternative.'],
    ['Account size unknown', 'Sizing up is measured against your own median entry size, not against equity or margin.', 'A larger trade can be reasonable for a larger account; the review cannot tell.'],
    ['Charges missing', 'Net P&amp;L for affected trades excludes the missing charges; the trades are flagged and counted under data quality.', 'Net P&amp;L of those trades is overstated by the missing charges, and a small loss can show as a gain. Costs and the materiality floor can move either way, depending on whether the affected trades are occurrences or part of the comparison set.'],
    ['Timestamps without a timezone', 'Read as IST (UTC+05:30), and the import reports how many.', 'A file exported in UTC without a zone would show every time 5 h 30 min early. A uniform shift keeps the gaps between trades, but if only some rows lack a zone those gaps change, and a trade placed before 05:30 IST would move to the previous day, possibly the previous month.'],
    ['Stop-loss and resting orders', 'Only executed fills are read.', 'The review cannot see whether a stop was attached or cancelled.'],
    ['The median includes the size-ups', 'The median entry size is taken across every trade in the period, including the large ones.', 'Frequent size-ups raise the median and make the rule harder to trigger.'],
    ['A trade matching two behaviours', 'Counted toward the costlier confirmed habit only; the other is re-checked without it.', 'The headline never counts a loss twice, but a behaviour can lose its confirmation to overlap. Its own figures are still shown, before de-duplication.'],
    [`More than ${word(MAX_H)} behaviours pass`, `Only the ${n(MAX_H)} with the largest excess losses are confirmed; any other that passes is listed as over the ${n(MAX_H)}-habit limit.`, 'A behaviour over the limit passed the same gates, but its excess loss is not in the headline.'],
    ['Intent', 'Timing, price and size are proxies for a decision; a planned second entry or scale-in looks the same as an impulsive one.', 'A confirmed habit is a prompt to review those trades, not a verdict on why you took them.'],
  ];
  return `${prose(`<p>These are the known cases where the review can be wrong or incomplete, and what each one means when reading the results.</p>`)}
    ${table({
      id: 'method-edge-table',
      caption: 'Known edge cases and limitations',
      columns: [{ key: 'c', label: 'Case' }, { key: 'h', label: 'How it is handled' }, { key: 'm', label: 'What it means for you' }],
      rows: rows.map(([c, h, m]) => [`<strong>${c}</strong>`, h, m]),
    })}`;
}

// ---------- 10. sample data ----------

function habitCounts(counts) {
  const parts = HABIT_IDS.filter((id) => counts[id]).map((id) => `${esc(id)} ${n(counts[id])}`);
  return parts.length ? parts.join(' · ') : '<span class="muted">None</span>';
}

function presetSettings(params, varying) {
  const parts = [];
  for (const p of LAB_PARAMS) {
    if (!varying.has(p.key)) continue;
    const v = params[p.key];
    if (p.type === 'toggle') { if (v) parts.push(esc(p.label)); continue; }
    if (!v) continue;
    if ((p.key === 'reentryGap' || p.key === 'reentryLoss') && !params.reentries && !params.blowup) continue;
    parts.push(`${esc(p.label)}: ${n(v)}${esc(unitText(p))}`);
  }
  return parts.length ? ul(parts, 'method-cell-list') : '<span class="muted">Shared settings only</span>';
}

function samplesSection(state) {
  const samples = listDatasets(state).filter((d) => d.kind === 'sample');
  const chargeSet = new Set(samples.flatMap((d) => getDataset(state, d.id).fills.map((f) => f.charges)));
  const flat = chargeSet.size === 1 ? [...chargeSet][0] : null;

  const personaRows = [];
  const plantedRows = [];
  for (const d of samples) {
    const s = forDataset(state, d.id);
    const periods = selectPeriods(s);
    personaRows.push([`<strong>${esc(d.name)}</strong>`, esc(d.style), periods.map((p) => `${esc(p.label)} · ${plural(p.trades, 'trade')}`).join('<br>')]);
    const months = getDataset(state, d.id).months ?? {};
    for (const p of periods) {
      const manifest = months[p.key]?.manifest ?? [];
      const a = selectAnalysis(s, p.key);
      const planted = {};
      const detected = {};
      let exact = true;
      for (const id of HABIT_IDS) {
        const want = manifest.filter((m) => m.habit === id).map((m) => m.ref).sort();
        const got = [...a.standalone[id].unitIds].sort();
        planted[id] = want.length;
        detected[id] = got.length;
        if (want.join('|') !== got.join('|')) exact = false;
      }
      plantedRows.push([
        `<strong>${esc(d.name)}</strong><div class="muted small">${esc(p.label)}</div>`,
        habitCounts(planted),
        habitCounts(detected),
        exact ? chip('Exact match', 'ok') : chip('Differs', 'warn'),
        a.confirmed.length ? `<div class="chip-row">${a.confirmed.map((h) => chip(`${h.id} · ${h.gates.confidence}`, 'neutral')).join('')}</div>` : '<span class="muted">No habit</span>',
      ]);
    }
  }

  const presets = Object.entries(SCENARIOS);
  const varying = new Set(LAB_PARAMS.map((p) => p.key).filter((k) => new Set(presets.map(([, sc]) => String(sc.params[k]))).size > 1));
  const shared = LAB_PARAMS.filter((p) => !varying.has(p.key)).map((p) => {
    const v = presets[0][1].params[p.key];
    return p.type === 'toggle' ? `${esc(p.label)}: ${v ? 'on' : 'off'}` : `${esc(p.label)}: ${n(v)}${esc(unitText(p))}`;
  });
  const daysParam = LAB_PARAMS.find((p) => p.key === 'days');
  const presetRows = presets.map(([, sc]) => [`<strong>${esc(sc.label)}</strong>`, esc(sc.description), presetSettings(sc.params, varying)]);
  const labRows = LAB_PARAMS.map((p) => [esc(p.label), esc(p.group), p.type === 'toggle' ? 'On / off' : `${n(`${p.min}–${p.max}`)}${esc(unitText(p))}`]);

  return `${prose(`<p>The ${word(samples.length)} sample traders are generated by a seeded pseudo-random generator, so every visit shows the same orders and the same figures. Each trader has a written plan of trades per day; specific behaviours are planted on purpose and recorded in a manifest, which the evaluation tests use as ground truth.</p>`)}
    ${prose(ul([
      'Prices are simulated option premiums, not market data, kept within plausible ranges; spread prices stay below the strike width, and every order falls inside market hours.',
      `Orders are placed on weekdays only, skipping the NSE trading holidays in the sample months (${HOLIDAYS.map((d) => `<span class="num">${esc(formatDate(d))}</span>`).join(', ')}). An expiry that would fall on one of those holidays moves to the previous trading day.`,
      flat !== null ? `Charges are a flat ${rupees(flat)} per executed order, for illustration only; statutory levies are not modelled.` : 'Charges are illustrative and do not model statutory levies.',
      'Quantities are whole lots at the illustrative lot sizes in section 9.',
    ], 'method-list'))}
    ${table({ id: 'method-persona-table', caption: 'Sample traders', columns: [{ key: 'n', label: 'Trader' }, { key: 's', label: 'Style' }, { key: 'p', label: 'Periods' }], rows: personaRows })}
    ${h3('Planted behaviours and what the review found')}
    ${prose('<p class="muted small">Counts per behaviour. “Exact match” means the detectors flagged exactly the planted trades, no more and no fewer. Confirmation then depends on the gates, so a planted behaviour can be found and still not be called a habit.</p>')}
    ${table({
      id: 'method-planted-table',
      caption: 'Planted versus detected behaviours per sample month',
      columns: [{ key: 't', label: 'Trader and month' }, { key: 'p', label: 'Planted' }, { key: 'd', label: 'Detected' }, { key: 'm', label: 'Match' }, { key: 'c', label: 'Confirmed habits' }],
      rows: plantedRows,
    })}
    ${h3('Scenario lab presets')}
    ${prose(`<p>The scenario lab builds a synthetic month of up to ${plural(daysParam.max, 'trading day')} from a few behaviour settings, writes it to a CSV, and runs it through the real importer and engine. The rules never change in the lab; only the simulated history does. The same settings always produce the same month; regenerating only changes the seed. Changing any control starts a custom month from the preset you were on.</p><p class="muted small">Shared by every preset: ${shared.join(' · ')}.</p>`)}
    ${table({ id: 'method-preset-table', caption: 'Scenario lab presets', columns: [{ key: 'p', label: 'Preset' }, { key: 'd', label: 'What it simulates' }, { key: 's', label: 'Settings that differ' }], rows: presetRows })}
    ${h3('Lab controls')}
    ${table({ id: 'method-labparam-table', caption: 'Scenario lab controls and ranges', columns: [{ key: 'l', label: 'Control' }, { key: 'g', label: 'Group' }, { key: 'r', label: 'Range' }], rows: labRows })}
    <p class="method-after">${linkTo('Open the scenario lab', 'lab')}</p>`;
}

// ---------- 11. tests ----------

function testsSection() {
  const established = [
    '<strong>The rules are implemented as defined.</strong> On every sample month, each detector flags exactly the planted trades: no missed occurrences and no extra ones.',
    '<strong>Numbers recompute independently.</strong> Excess losses under the baseline-excess model are recomputed from raw fills by separate code, and a hand-worked spread checks the max-loss formula.',
    '<strong>Planted behaviours are found and clean histories stay clean.</strong> The disciplined trader gets no confirmed habit, and each near miss fails for the intended reason.',
    '<strong>The gates do their job.</strong> One very large loss cannot create a habit, a thin month confirms nothing, and a trade matching two behaviours is counted once.',
    '<strong>Period verdicts read as intended,</strong> and trading less at the same rate is not called improving.',
    '<strong>Invalid input is rejected.</strong> Malformed rows are rejected with row numbers, missing columns and empty files stop the import with a clear message, open and flipped positions are excluded and reported, and exporting then re-importing reproduces the same analysis.',
    '<strong>The wording is checked.</strong> All user-facing copy is scanned for causal or forgone-profit claims.',
  ];
  const notEstablished = [
    '<strong>Real-world accuracy.</strong> The sample data was written to exercise the rules, so finding the planted behaviours shows internal consistency, not that the rules find real habits in real traders.',
    '<strong>Causation.</strong> A confirmed habit is associated with excess loss; no test can show the behaviour produced the loss.',
    '<strong>Behaviour change.</strong> Nothing here shows that a guardrail reduces a behaviour or improves results.',
    `<strong>Threshold calibration.</strong> The thresholds (${mins(CONFIG.revengeWindowMin)} window, ${n(G.minN)} occurrences, ${n(G.minDays)} days, ${rupees(G.minCost)} floor, ${n(CONFIG.minUnits)} trades a period, ${n(C.minOpp)} chances to compare) are judgement calls set in advance, not fitted to or validated against outcomes.`,
    '<strong>Coverage.</strong> Every broker’s export format, instruments other than CE/PE options, and very large or very unusual histories are untested.',
  ];
  return `<div class="method-two">
      <div>${h3('What the tests establish')}${ul(established, 'method-list')}</div>
      <div>${h3('What they do not establish')}${ul(notEstablished, 'method-list')}</div>
    </div>
    ${prose('<p class="muted small">The checks live in the project’s tests folder and run with <code>npm test</code>. A separate render check opens every page in dozens of states and fails on unknown actions, duplicate element IDs, or values that could not be computed leaking into the page.</p>')}`;
}

// ---------- page ----------

const SECTIONS = [
  { id: 'method-scope', toc: 'What it does and does not do', title: 'What Habit Ledger does and does not do', body: scopeSection },
  { id: 'method-trades', toc: 'From orders to trades', title: 'From orders to trades', body: tradesSection },
  { id: 'method-behaviours', toc: `The ${word(HABIT_IDS.length)} behaviours`, title: `The ${word(HABIT_IDS.length)} behaviours`, body: behavioursSection },
  { id: 'method-gates', toc: 'Evidence gates', title: 'Evidence gates G1–G4', body: gatesSection },
  { id: 'method-money', toc: 'Financial calculations', title: 'Financial calculations', body: moneySection },
  { id: 'method-baselines', toc: 'Baseline per behaviour', title: 'Baseline selection per behaviour', body: baselinesSection },
  { id: 'method-compare', toc: 'Comparing periods', title: 'Comparing periods', body: compareSection },
  { id: 'method-guardrails', toc: 'Guardrails', title: 'Guardrails and compliance', body: guardrailsSection },
  { id: 'method-limits', toc: 'Edge cases and limitations', title: 'Known edge cases and limitations', body: limitsSection },
  { id: 'method-samples', toc: 'How sample data is made', title: 'How the sample data is generated', body: samplesSection },
  { id: 'method-tests', toc: 'What the tests show', title: 'What the evaluation tests establish', body: testsSection },
];

export function render(state) {
  const toc = `<nav class="method-toc" aria-label="On this page">
      <p class="eyebrow">On this page</p>
      <ol>${SECTIONS.map((s, i) => `<li><a href="#${s.id}"><span class="method-toc-num num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>${esc(s.toc)}</a></li>`).join('')}</ol>
    </nav>`;
  // Live-region source (main.js reads [data-announce]): the worked examples follow the trader and period.
  const a = selectAnalysis(state);
  const announce = `<p hidden data-announce>Methodology worked examples use ${sourceText(state)}, ${periodText(a)}.</p>`;
  const sections = SECTIONS.map((s, i) => panel({
    id: s.id,
    title: `<span class="method-num num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}`,
    body: s.body(state),
  })).join('');
  return `<div class="method">
    ${pageHeader({
      eyebrow: 'About',
      title: 'Methodology',
      lead: 'How Habit Ledger turns a month of option orders into a short list of evidence-gated behaviours: every rule, threshold and formula the review uses, and what each one cannot tell you.',
    })}
    ${announce}
    <div class="method-layout">${toc}<div class="method-sections">${sections}</div></div>
  </div>`;
}
