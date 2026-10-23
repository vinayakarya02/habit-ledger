export const meta = {
  name: 'habit-ledger-modules',
  description: 'Build 9 Habit Ledger product modules + expanded test suite in parallel, each adversarially reviewed then fixed',
  phases: [
    { title: 'Build', detail: 'one agent per module, owning exactly one view file + stylesheet (tests agent owns new test files)' },
    { title: 'Review', detail: 'independent adversarial reviewer per module: numbers, controls, honesty, a11y, mobile' },
    { title: 'Fix', detail: 'apply verified review findings, re-run smoke and tests' },
  ],
}

const APP = '<repo>/app'
const SCRATCH = '<scratch>/agents'

const COMMON = `
You are working on Habit Ledger, a post-trade behaviour review prototype for options traders (a PM take-home for Nubra, an Indian options-focused broker). The product turns a month of option order history into the 2–3 repeated behaviours associated with excess losses, with evidence gates, traceable costs, guardrails and month-over-month tracking. It must feel like a thoughtfully designed premium fintech analytics product, NOT a generic AI dashboard: restrained, precise, honest about uncertainty, every number traceable.

Project root: ${APP}  (Windows; use Git Bash syntax; quote paths because of spaces). Static ES-module app, no framework, no npm dependencies.
FIRST read ${APP}/src/views/CONTRACT.md completely, then read src/store.js, src/engine.js, src/ui/components.js, src/ui/charts.js, src/format.js, src/views/shell.js, src/main.js and styles/components.css so you use the real selectors, field names, components and CSS classes. Do not guess field names: check them in the source.
You may write scratch/probe scripts ONLY under ${SCRATCH}/<your-module>/ (create it). Run probes with node from the app dir, e.g. node --input-type=module -e "import {...} from './src/store.js'; ...".
Honesty rules from CONTRACT.md are non-negotiable (no "would have made/saved/earned", no causal claims, no trade recommendations, missing ≠ zero, label synthetic/imported data, Nubra documented vs proposed). Do not invent figures; everything comes from selectors/engine.
`

const MODULES = [
  {
    key: 'overview', file: 'src/views/overview.js', css: 'styles/views/overview.css',
    spec: `MODULE A — Overview & monthly review (route 'overview', the landing page). It must answer, in this order of visual priority:
1) What happened in this review period? 2) Which behaviours have sufficient evidence? 3) Which deserves attention first? 4) What changed vs the previous period? 5) What should the trader do next?
Build:
- pageHeader: eyebrow "<dataset name> · <period label>" (sample vs import clearly labelled), title "Monthly review", a one-sentence lead summarising the period in plain words computed from data (e.g. "52 closed trades over 16 days; 2 behaviours passed the evidence bar.").
- Next action card near the top from selectNextAction(state): title, body, and ONE primary button whose data-action/payload is exactly next.action (type + its other fields as data-* attributes; e.g. {type:'openGuardrail', habitId:'H1'} → data-action="openGuardrail" data-habit-id="H1"; {type:'navigate', view:'compare'} → data-view="compare").
- Data quality strip from selectQuality(state): status (Good / Needs attention / Insufficient — text, not colour only), the items list, and source ("Sample trader · synthetic" or "Imported file · this tab only" with rejected-row count when import).
- Key statistics using stat() with def() definitions and correct handling of null (missing()): Net realized P&L (sum of net P&L of closed trades opened in the period, after recorded charges), Closed trades (+ trading days), Win rate (trades with net P&L > 0 ÷ closed trades), Average winning trade, Average losing trade, Largest loss, Charges recorded (note how many trades have missing charges if any). Keep it to ≤ 7 tiles; every tile must have a definition. Money via money()/amount().
- dailyPnlChart(analysis.stats.daily) in a panel titled "Daily net P&L" with a one-line explanation that dots mark days with trades counted toward a confirmed habit.
- "Habits that passed the evidence bar": headline sentence "<k> habit(s) associated with <analysis.headlineCost> of excess loss compared with your usual trade" (use analysis.headlineCost exactly; never re-sum differently). Ranked list of analysis.confirmed (rank = order): name, occurrences / opportunities + HABITS[id].chances, days, excess cost, confidence chip, guardrail status for this dataset (state.guardrails[datasetId][id] → Active/Paused/none), buttons "Inspect evidence" (inspectHabit) and "Set guardrail"/"Edit guardrail" (openGuardrail). Clean state when none: if analysis.summary.thin → explain too few trades (CONFIG.minUnits); else "No habit passed the evidence bar" with what was checked (link navigate→habits). Must include the sentence: "This is an association, not proof that the behaviour caused the loss."
- Near misses: analysis.nearMisses (name, seen n times, reason) with link to Habits.
- "Change since <previous period>": if selectPrevPeriod(state) exists, use selectComparison(state, prev.key, state.periodKey) and show rows for behaviours that were confirmed in either period (or all rows with a verdict other than Not applicable/Not seen): rate before → after (pct), verdictChip, short explanation; link to Compare. If no previous period: say so, and if selectNextPeriod exists, offer a button to compare with it (setCompare is not needed: navigate to 'compare' — compare defaults to the last two periods).
Layout: desktop two-column (main + side column for next action / data quality / change) using grid-main-side; single column on mobile. Keep it calm and scannable; no decorative elements.`,
  },
  {
    key: 'habits', file: 'src/views/habits.js', css: 'styles/views/habits.css',
    spec: `MODULE B — Habit intelligence (route 'habits'). Detailed analysis of ALL five behaviours (H1–H5) for the period, without forcing a confirmed habit on anyone.
- pageHeader: title "Habits", lead explaining: five behaviours are checked for every trader; a behaviour is called a habit only when it passes all four evidence gates (repeated, spread out, material, not one trade); costs are excess loss vs the trader's usual trade.
- Controls: segmented() filter on state.habitsFilter.status (all / confirmed / near = insufficient+overlap / other = not-seen + not-costly) via setHabitsFilter key=status; select() or segmented sort via setHabitsFilter key=sort (rank: confirmed by rank then others by status order; cost desc; rate desc; occurrences desc). Show count "Showing n of 5". Empty state for a filter with no matches (with a button to show all).
- One card (panel) per behaviour from analysis.habits[id]: name; HABITS[id].definition; statusChip(status) + confidenceChip if confirmed; statusReason (the classification reason); metrics row: occurrences / opportunities + HABITS[id].chances + rate (pct), different days (gates.days), excess loss (if cost > 0 money else "No excess loss"), applies to (HABITS[id].appliesTo); compact gateList(habit.gates, {compact:true}) when occurrences > 0 with each gate's pass/fail; overlap note when habit.overlap > 0 or status 'overlap' (which habit claimed the shared trades); first 3 supporting dates/trades as a short list (day + time + detail) with "and n more"; buttons: "Inspect evidence" (inspectHabit), "Set guardrail" (openGuardrail; label "Edit guardrail" if one is saved for this dataset), and per-trade buttons selectTrade (id = unitId) are welcome in the short list.
- Not-seen behaviours: compact card, explain HABITS[id].chanceNote and opportunities count; no gates.
- Thin period (analysis.summary.thin): callout explaining no habit can be confirmed below CONFIG.minUnits trades.
Make the status/classification visually clear (chips with text) and the reasoning prominent.`,
  },
  {
    key: 'inspect', file: 'src/views/inspect.js', css: 'styles/views/inspect.css',
    spec: `MODULE D — Evidence & calculation inspector (route 'inspect', habit chosen by state.inspect.habitId). This is the product's strongest differentiator: every displayed number must be traceable to the underlying trades and arithmetic.
Use selectInspector(state) → { analysis, habit, def, rows, excluded, sensitivity, worst }.
- pageHeader: eyebrow "Evidence inspector · <period>", title = habit name, lead = def.definition. Habit switcher: segmented() of the 5 habits (short names) with action inspectHabit (data habit-id).
- Status summary: statusChip + confidence + statusReason; occurrences/opportunities (def.chances) and rate; days; cost.
- Qualifying trades table (table() with sort {key: state.inspect.sort, dir: state.inspect.dir, action:'setInspectSort'}; sortable columns day, netPnl, contribution): columns Include (a checkbox input with data-action="toggleExclude" data-unit-id, id "inspect-inc-<n>", checked when NOT excluded, aria-label), Date (formatDay) + time, Trade (button selectTrade with the unit label), Why it qualified (detail), Net P&L (money), Counts toward cost (contribution; for H3 the excess beyond max loss). Excluded rows get class is-excluded via rowAttrs. If no occurrences: emptyState explaining the behaviour was not seen and its chances.
- Baseline panel: for costing.model 'baseline-excess': comparison set description (def.comparison), comparisonN, comparisonMean (money or missing() when null), baseline used = min(mean, 0) (explain the cap: we never count profit you could have made), thin-baseline note when costing.thin (fewer than CONFIG.thinBaseline comparable trades → baseline ₹0). For 'beyond-max-loss' (H3): explain defined max loss at entry (widest wing × qty − net credit) and that removals ending within the max count as ₹0 (downside only).
- Calculation panel (.formula block): rows showing Σ net P&L of the n occurrences, n × baseline, and excess = −(Σ − n × b) = habit.cost. Compute Σ from habit.evidence (sum netPnl) and confirm it reproduces habit.cost within ₹1 (it does by construction; display the engine's cost as the result). For H3: Σ of per-trade excess = cost.
- Leave-one-out panel: costliest occurrence (worst: date, trade, contribution), cost without it (habit.gates.loo), share it explains (topShare as pct), without the two costliest (loo2), thresholds (CONFIG.gates.looMinCost and looMinShare), buttons "Exclude the costliest trade" (excludeWorst) and "Reset" (resetExclusions, disabled when nothing excluded).
- Sensitivity result when sensitivity != null: re-gated cost, occurrences, gateList(sensitivity.gates), and whether it would still be confirmed (sensitivity.wouldConfirm), with explicit note "Excluded trades stop counting as occurrences; the comparison baseline stays the same." Show a clear before → after comparison.
- Evidence gates panel: full gateList(habit.gates) with each threshold (gateDetail) and the failing reason when failed.
- "What this cannot tell you": def.cannotConclude list plus the general sentence "This is an association, not proof that the behaviour caused the loss." (exact sentence required) and "No market prices are used, so nothing here says what would have happened instead."
- Overlap note when habit.overlap > 0 (shared trades counted under habit.overlapWith).
Layout: table full width; baseline/calculation/LOO as a 3-column grid on desktop collapsing on mobile.`,
  },
  {
    key: 'trades', file: 'src/views/trades.js', css: 'styles/views/trades.css',
    spec: `MODULE C — Trade explorer (route 'trades') + trade detail drawer (export overlay).
Use selectTrades(state) → { analysis, total, matched, page, pages, rows, netOfMatched, underlyings, types, days, selected, filtersActive } and tradeLabels(analysis, unitId).
- pageHeader: title "Trades", lead "Every closed trade in <period>. A trade is a position from open to flat; all legs sharing a strategy ID count as one trade." Show "Showing <matched> of <total> trades · net <netOfMatched>".
- Filter bar (.filter-bar, wraps on mobile; ids prefixed trades-): search input (key q, live: true, type search, placeholder "Symbol, underlying or strategy"), from/to date inputs (type date, keys from/to, min/max = days.first/last), underlying select (all + underlyings), type select (all, long-option "Option buy", short-option "Option sell", strategy "Multi-leg strategy" — only types present plus all), outcome select (all/win/loss/flat), behaviour select (all, any "Any behaviour flag", none "No behaviour flag", H1..H5 short names), and a "Reset filters" button (resetTradeFilters, disabled unless filtersActive). All via setTradeFilter with data key.
- Table (table() with sort {key: state.trades.sort, dir: state.trades.dir, action: 'setTradeSort'}; sortable keys open, netPnl, hold, lots): Opened (formatDay(day) + time), Trade (label; for strategies show leg count), Type, Entry size (formatLots(entryLots)), Held (formatDuration(holdMin)), Net P&L (money; append a small "excl. some charges" marker when chargesMissing > 0), Behaviour (chips from tradeLabels: role counted → chip 'danger' "<short>"; overlap → chip 'warn' "<short> (counted under …)"; flagged → chip 'neutral' "<short> · not a habit"), and a "Details" button (selectTrade data-id = unit.id, aria-label including the trade label). Mark the selected row (is-selected). Empty state when no matches (with reset button).
- Pager: Previous / Next buttons (setTradePage with data-page) disabled at bounds, "Page x of y".
- overlay(state): when selectTrades(state).selected is non-null and state.view === 'trades', render a drawer: scrim (data-overlay-close, data-action closeTrade) + aside.drawer[data-overlay][role=dialog][aria-modal=true][aria-labelledby]. Contents: title (label), opened → closed times with date, hold, type, underlying; P&L summary kv list: gross P&L, charges recorded (missing() note if chargesMissing>0: "<n> orders had no charges in the file"), net P&L. Legs table per position: symbol, direction (Bought/Sold first), option type, strike, expiry (missing() when null), entry lots, avg entry price (formatPrice), avg exit price (formatPrice or missing), leg gross P&L. Fills table: time, symbol, side, qty, price (formatPrice), charges (amount or missing()). Behaviour section: each label with habit name, role explained in words, detail text, and a button "Inspect <short> evidence" (inspectHabit). Footer: Close button (closeTrade, data-autofocus). Note: "Prices come from the file. No market data is used."
- Legend line explaining "—" means not in the file (not zero).`,
  },
  {
    key: 'guardrails', file: 'src/views/guardrails.js', css: 'styles/views/guardrails.css',
    spec: `MODULE E — Personal guardrail center (route 'guardrails') + editor dialog (export overlay).
Use selectGuardrails(state) (5 entries), GUARDRAILS templates, state.guardEdit for the dialog.
- pageHeader: title "Guardrails", lead: rules you choose for yourself, turned from evidence into a measurable intervention; compliance is measured from your own fills in each period. Prominent callout: "This prototype never places trades or changes any brokerage account. Saved rules live only in this browser."
- Order: recommended (habit confirmed) first, then saved rules, then the rest. Group headings: "Recommended by this period's evidence", "Other rules you can set".
- Card per entry: template.title; behaviour addressed (habit.name + statusChip(habit.status)); why it is relevant (confirmed → "Confirmed: <occurrences> times on <days> days, associated with <cost> excess loss"; otherwise habit.statusReason and a note that it is optional); the rule text template.rule(params) (use saved params when rule exists); Nubra capability chip: nubra.status 'documented' → "Documented Nubra order control" (accent) with nubra.text; 'proposed' → "Proposed capability (not a Nubra feature)" (warn) with nubra.text; status: "Not set" / "Active" / "Paused" (+ "since <formatMonth(createdPeriod)>"); how compliance is measured: template.measure(params); compliance block: current period (violations of opportunities, compliance pct, meter) plus previous and next period values when available (prevLabel/nextLabel) — if !measurable show the note; label clearly that compliance is computed for the selected period even if the rule was set later (it is a what-if measurement). Buttons: "Set up rule"/"Edit" (openGuardrail data habit-id), "Pause"/"Resume" (setGuardStatus data habit-id + status), "Remove" (removeGuardrail, btn danger) — only show pause/remove when a rule exists.
- overlay(state): when state.guardEdit: scrim (data-overlay-close, data-action closeGuardEdit) + div.dialog[data-overlay][role=dialog][aria-modal=true][aria-labelledby]: title "<Set up | Edit> <template.title>", the behaviour addressed, one input() per template param (type number, min/max/step, unit in label, action setGuardParam with data key, error from guardEdit.errors[key], id guard-param-<key>, first with data-autofocus), live preview of the rule text and the measurement text using the draft params (only when valid; otherwise show the validation message), Nubra capability section with the status chip, text and — when nubra.snippet exists — a <pre> of JSON.stringify(snippet, null, 2) labelled "Illustrative order fields from the public API docs — not a live order", the measured compliance of the current period with the draft params (measureGuardrail(selectAnalysis(state), habitId, params) only when params valid), and footer buttons Save (saveGuardrail, primary, disabled when errors exist) and Cancel (closeGuardEdit). Note: "Saving stores this rule in this browser only. Nothing is sent to Nubra or any broker." H3 has no params: show "No settings: the rule is always the same."`,
  },
  {
    key: 'compare', file: 'src/views/compare.js', css: 'styles/views/compare.css',
    spec: `MODULE F — Month-over-month behaviour tracking (route 'compare').
Use selectPeriods(state), state.compare, selectComparison(state) → rows from engine.compareHabit; CONFIG.compare; measureGuardrail + selectAnalysis for guardrail compliance in both periods.
- pageHeader: title "Compare periods", lead: tracks how often each behaviour happened per chance (e.g. re-entries ÷ losing trades), so trading less does not count as improving.
- Period pickers: two select() (ids compare-from, compare-to; action setCompare with data which=from|to, param key) + "Swap" button (swapCompare). If only one period in the data: emptyState explaining a second month is needed (button navigate→import). If from === to: callout warning that the same period is selected.
- Summary line: counts of Improving / Worsening / No clear change / Inconclusive (text chips).
- Rules callout (collapsible <details> is fine): verdict rules computed from CONFIG.compare — Improving needs the rate to fall by ≥ improve·100% relative AND a one-sided Fisher exact chance below alpha (1 in 5); Worsening needs a rise ≥ worse·100% relative and the same chance bar; fewer than minOpp chances in either period → Inconclusive; cost is shown but never decides the verdict because excess cost is measured against the trader's other trades, which also change.
- One row/card per behaviour (all 5): name (+ chip "Confirmed habit in <from label>" when a1.habits[id].status==='confirmed'; + guardrail status for the dataset), chances label, before: n / opp and rate with sample size, after: n / opp and rate, absolute change formatPP(absChange) and relative change formatRel(relChange) (missing when null), verdictChip(verdict), explanation, strength when p != null ("chance of a change this large if nothing changed: chanceText(p)"), rateCompareChart(row, {fromLabel, toLabel}) with 90% intervals, and secondary "Excess cost: <before.cost> → <after.cost>" with a short caveat. Rows with verdict 'Not applicable' can be rendered compactly at the end.
- Guardrail compliance section: for each saved rule (state.guardrails[datasetId]) show compliance in from vs to (measureGuardrail(selectAnalysis(state, key), habitId, rule.params)) with violations/opportunities and status (active/paused). If none saved: short emptyState with button navigate→guardrails.
- Make it clear the sample size matters: show n/opp prominently, and never present a verdict as proof.`,
  },
  {
    key: 'import', file: 'src/views/import.js', css: 'styles/views/import.css',
    spec: `MODULE G — Data import & data quality (route 'import'). A real, robust CSV import wizard driven by state.importWizard ({step: start|reading|mapping|preview|done, fileName, size, header, table, mapping, problems, result, excludeDuplicates, error, lastImportId}).
- pageHeader: title "Import trades", lead: import a month of option fills as CSV; the file is read in this browser tab, never uploaded, and is gone when the tab closes. Stepper (ol.stepper with is-current/is-done): Choose file → Map columns → Review → Done.
- Start step: file input (<input type="file" id="import-file" data-action="importFile" accept=".csv,text/csv"> inside a labelled drop panel), limits (LIMITS.maxBytes 5 MB, LIMITS.maxRows rows), buttons: "Download template" (downloadTemplate), "Download sample CSV" per persona (downloadSample data id=persona id; use listDatasets(state) filter kind 'sample'). Expected columns table from FIELDS/COLUMNS: column name (code), label, required yes/no, help text. Error callout when importWizard.error.
- Reading step: an accessible loading state (role=status "Reading <fileName>…").
- Mapping step: for each COLUMNS field a select() (id import-map-<field>, action setMapping, data field=<field>, param column; options: "— Not in file —" value '' plus each header with index as value; selected = mapping[field] ?? ''), required marker, FIELDS help as hint, and up to 3 sample values from the mapped column (table.rows[i][col]) shown in a code-ish style ("blank" for empty). Problems callout (importWizard.problems) and buttons "Check rows" (validateImport, primary, disabled when problems) and Cancel (cancelImport). Show the file name, size, number of data rows.
- Review step (result = validateRows output): summary stats (rows read, accepted, rejected, with warnings, suspected duplicates, missing charges) using stat(); notes list (result.notes e.g. IST assumption, truncation); when summary.suspectedDuplicates.length > 0 a checkbox (id import-excl-dups, action toggleExcludeDuplicates, checked=excludeDuplicates) explaining identical rows can be genuine partial fills so they are kept by default; rejected rows table (line, reasons) — all rejected rows (cap display at 100 with a count) and a "Download rejected rows" button (downloadRejected); preview table of the first 30 rows with status chip (ok/warning/rejected/excluded) and messages; warnings explained (missing charges → net P&L excludes them and is flagged; never treated as ₹0). Buttons: "Import <n> rows" (confirmImport, primary, disabled when accepted - excluded is 0), "Back to mapping" (backToMapping), Cancel (cancelImport). Never imply invalid values became zero.
- Your imports section (always visible when state.imports non-empty): each import dataset: name, accepted/rejected counts (importSummary), periods covered (periodsOf via selectPeriods only works for current dataset — instead show importSummary fields and a "Review" button selectDataset data id), "Remove" (removeImport data id). Make the distinction from sample personas explicit.
- Data quality note for the CURRENT dataset (selectQuality) at the bottom: status + items.`,
  },
  {
    key: 'lab', file: 'src/views/lab.js', css: 'styles/views/lab.css',
    spec: `MODULE H — Scenario lab (route 'lab'). Lets the user change a synthetic trade history and watch the SAME fixed rules classify it. Use selectLab(state) → { scenario, scenarios, params, plan, planted, csv, validation, analysis, notes } and LAB_PARAMS from src/lab.js.
- pageHeader: eyebrow "Simulation", title "Scenario lab", lead: build a synthetic month and see how the review's fixed rules classify it. Prominent callout (warn): "Simulated trades only. This is not a market forecast or a trading recommendation, and the rules here are the same fixed rules used in the review — only the history changes."
- Preset picker: segmented() of scenarios (action setScenario, data id) — normal, repeated, borderline, clean, missing — plus "Custom" shown as active when state.lab.scenario === 'custom'; the active preset's description.
- Controls panel grouped by LAB_PARAMS group (Month / Behaviour / Data quality): range inputs via input({type:'range', live:true, action:'setLabParam', data:{key}, min, max, step, id 'lab-<key>'}) with the current value and unit shown next to the label; the 'blowup' toggle as a checkbox (id lab-blowup, action setLabParam, data key=blowup). Buttons: "Regenerate with a new seed" (regenerateLab), "Download this CSV" (downloadLabCsv), "Reset to preset" (setScenario with the last preset id — if custom, use 'repeated').
- Results panel: "What was planted" (planted.reentries, reentriesInWindow, adds, busyExtras, orders, ordersMissingPrice, ordersMissingCharges) vs "What the review concluded": for each of the 5 behaviours: statusChip, occurrences/opportunities, cost (when > 0), compact gates when occurrences > 0, and the statusReason. Headline: confirmed habits and headlineCost, or the clean/thin message. Data quality: validation.summary (rows read/accepted/rejected) and analysis.summary.excluded count, quality items. Notes (lab notes) as callouts.
- Teach the boundary: one line explaining which threshold matters for the current settings (e.g. re-entry gap vs CONFIG.revengeWindowMin; occurrences vs CONFIG.gates.minN; days vs minDays) — computed from current params and results, not hardcoded.
- Layout: controls left (sticky on desktop) + results right; stacked on mobile.`,
  },
  {
    key: 'method', file: 'src/views/method.js', css: 'styles/views/method.css',
    spec: `MODULE I — Methodology & transparency (route 'method'). A well-structured explanation page documenting exactly how the product reaches conclusions. Pull every number from CONFIG / HABITS / GUARDRAILS / LAB_PARAMS / SCENARIOS / LIMITS / FIELDS (never hardcode thresholds). Include an in-page table of contents (buttons are not needed — use plain anchor links href="#method-<section>" to section ids; anchors are fine here as they are in-page links, not actions) — NOTE: the shell's main element has id main-content; your section ids must be unique (prefix method-).
Sections:
1. What Habit Ledger does and does not do (post-trade review of closed option trades; no live data, no orders, no advice; synthetic samples; imports stay in the browser).
2. From orders to trades (positions flat→flat per symbol + strategy ID; strategies as one trade; period membership by open date (IST); excluded positions: still open, flipped; charges missing handling; duplicates; timestamps without timezone read as IST).
3. The five behaviours: a table with name, exact definition (HABITS[id].definition), applies to, chances (denominator), comparison/cost model, and what it cannot conclude.
4. Evidence gates G1–G4 with CONFIG.gates values; Strong vs Moderate; thin-period rule (CONFIG.minUnits); de-duplication (each trade counts toward one habit; costliest first; re-gate).
5. Financial calculations: baseline-excess formula −(Σ net P&L − n × b), b = min(mean of comparison set, 0), thin-baseline fallback (CONFIG.thinBaseline), why the cap; H3 beyond-max-loss formula (widest wing × qty − net credit; downside only); headline = sum over confirmed habits after de-duplication; materiality floor = max(₹minCost, lossShare × gross losses).
6. Baseline selection per habit (HABITS[id].comparison).
7. Comparing periods: rate = occurrences ÷ chances; one-sided Fisher exact test; thresholds from CONFIG.compare; Wilson 90% intervals in charts; why cost doesn't decide verdicts.
8. Guardrails: how compliance is measured (same detectors with the rule's parameters), documented vs proposed Nubra capabilities (from GUARDRAILS[id].nubra), nothing is sent anywhere.
9. Known edge cases & limitations (at least 8 concrete ones: e.g. partial fills at identical prices flagged as possible duplicates; positions spanning months counted in the open month; legs with the same strategy ID assumed to be one strategy; lot sizes illustrative (CONFIG.lotSize) and unknown underlyings counted 1:1; small samples; multiple behaviours tested; no market prices so no counterfactual exits; account size unknown; charges missing → net excludes them).
10. How the sample data is generated (three personas, seeded deterministic generator, planted behaviours, ₹20 per order illustrative charges, synthetic prices; scenario lab presets from SCENARIOS with descriptions).
11. What the evaluation tests establish and what they do not (they verify the rules are implemented as defined, numbers recompute independently, planted behaviours are found and clean histories stay clean, invalid input is rejected; they do NOT show real-world accuracy, causation, behaviour change, or threshold calibration).
Use clean typographic hierarchy (h2 per section, readable line length ~72ch, tables where tabular). Must contain the sentence "This is an association, not proof that the behaviour caused the loss."`,
  },
]

const TESTS_SPEC = `TESTS MODULE — expand the automated evaluation suite. You own ONLY new files: ${APP}/tests/engine.rules.test.mjs, tests/import.test.mjs, tests/compare.test.mjs, tests/lab.test.mjs, tests/store.test.mjs. Do NOT edit tests/evals.test.mjs (the original 19 cases must be preserved), tests/helpers/*, or any src file. If you find a real bug in src, do NOT fix it: write a failing test that demonstrates it ONLY if you are certain, otherwise describe it in your report under "suspected bugs" with a minimal reproduction.
Use node:test + node:assert/strict, ESM imports from '../src/...'. Build small hand-made fill fixtures (helper functions inside each file) with KNOWN expected results computed by hand in comments — independently verify important financial figures (do not just copy the engine's output into assertions).
Cover at least:
- engine.rules: each detector H1–H5 including threshold boundaries (H1 gap exactly 15 min counts, 16 does not; previous trade net P&L exactly 0 does not trigger; H2 add at exactly 80% of first price counts, slightly above does not, add after a sell does not; H3 hedge closed exactly 5 min before short does NOT count (> 5 required), 6 min does; H4 exactly 1.5× median after two wins counts, after one win does not; H5 5th trade does not, 6th does); gate boundaries (n 3 vs 4; days 2 vs 3; materiality floor max(1000, 5% gross losses) at the edge; leave-one-out 40% share edge); baseline cap (comparison mean positive → baseline 0; negative → used); thin baseline (< 5 comparable trades → 0); thin month (< 20 trades → nothing confirmed); zero and negative values (price 0 accepted and flat trades outcome 'flat'); missing charges (null) → netPnl excludes them, chargesMissing counted, stats.tradesMissingCharges; overlap labels roles (counted / overlap / flagged) and headline not double counted; period split (analyze(allFills,{period}) equals analyze(monthFills) for personas); measureGuardrail with custom params (e.g. H1 window 30 catches more; H5 limit 3); regate excluding trades.
- import: readTable (quoted commas, escaped quotes, CRLF, BOM, semicolon delimiter, blank lines, line numbers); suggestMapping aliases (e.g. "Trade Price"→price, "Buy/Sell"→side, "Tag"→strategyId) and no double use of a column; mappingProblems (missing required, same column twice); parseTimestamp (Z, +05:30, +0530, no zone → assumedIst true, invalid date 2026-02-30 rejected, garbage rejected) and normalisation to IST ISO; parseAmount strictness (₹, Indian and western thousands separators, rejects '12abc', '', '1.2.3'); validateRows: blank price rejected (never 0), non-numeric charges rejected (never 0), blank charges accepted with warning and charges null, negative qty message mentions side, FUT row rejected as not options, duplicate id rejected with first line, identical content flagged as possible duplicate and excluded only when excludeLines given; LIMITS maxRows truncation note (use a small synthetic table by temporarily building > maxRows rows only if fast; otherwise test the summary logic with a mocked smaller table is NOT possible — skip if slow); parseCsv strict header requirement; toCsv round trip with commas/quotes and nulls.
- compare: fisherOneSided against known values (Fisher tea-tasting [[3,1],[1,3]] one-sided = 17/70 ≈ 0.242857; and at least one more hand-computed hypergeometric case, e.g. [[2,0],[0,2]] one-sided = 1/6); wilson known value (e.g. k=0,n=10 z=1.645 upper ≈ 0.2129; verify by formula in the test); compareHabit verdict boundaries using small fake analysis objects {standalone:{H1:{occurrences, opportunities, cost}}}: minOpp 7 vs 8, exact −50% relative with p<0.2 → Improving, p ≥ 0.2 → No clear change, increase from 0 → Worsening when significant, both 0 opps → Not applicable, both 0 occurrences → Not seen, same rate fewer opps → No clear change (trading less is not improving).
- lab: each SCENARIOS preset classification (normal → no confirmed habit and H1 'insufficient'; repeated → H1 confirmed; borderline → H1 fails G4; clean → nothing confirmed and no H1 occurrences; missing → rejected rows > 0 and no fill has a null/NaN price); determinism (same params → identical csv); reentryGap > 15 → H1 not seen and a note; clampParams bounds.
- store: reducer purity and resets — selectDataset resets trade filters, selection, inspector exclusions, guardEdit and sets the dataset default period; selectPeriod resets the same; unknown ids/keys ignored (state unchanged); setTradeFilter resets page; setTradeSort toggles direction; guardrail flow (openGuardrail defaults incl. H4 maxLots = ceil(1.25 × median lots); invalid param blocks save with errors; save → active; pause; remove); import flow (importFileRead → mapping with suggested columns; validateImport; toggleExcludeDuplicates; confirmImport creates import-1, selects it and records rejectedRows; removeImport of the current dataset falls back to aarav); persistable excludes imports; sanitizeGuardrails (via initialState(persisted)) drops garbage/invalid entries; selectNextAction priority (thin → import; unguarded confirmed habit → openGuardrail for the top one; all guarded + next period → compare; Kabir → none); selectTrades filters (habit filter H1 returns exactly the H1-labelled units; 'none' excludes labelled; date range; paging PAGE_SIZE); selectInspector sensitivity after excludeWorst equals regate.
Run the whole suite with: cd "${APP}" && npm test. All your new tests must pass unless they intentionally demonstrate a real, verified bug (then report it). Report the number of tests you added per file.`

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ship', 'fix-needed'] },
    smoke: { type: 'string', description: 'result line of node scripts/smoke.mjs <module> (or npm test result for tests)' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          category: { type: 'string', description: 'numbers | controls | state | honesty | requirements | a11y | mobile | design | tests' },
          description: { type: 'string' },
          evidence: { type: 'string', description: 'file:line or reproduction showing the problem' },
          fix: { type: 'string' },
        },
        required: ['severity', 'category', 'description', 'evidence', 'fix'],
      },
    },
    missingRequirements: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'smoke', 'issues', 'missingRequirements'],
}

const ITEMS = [...MODULES.map((m) => ({ ...m, kind: 'view' })), { key: 'tests', kind: 'tests' }]

function buildPrompt(it) {
  if (it.kind === 'tests') return `${COMMON}\n${TESTS_SPEC}\nYour final message: a short report (files written, tests per file, npm test result line, suspected bugs with reproductions).`
  return `${COMMON}
You own ONLY ${APP}/${it.file} and ${APP}/${it.css} (both exist as placeholders — replace them). Do not touch any other file.
${it.spec}

Quality bar: this view must look and read like a polished, production-quality fintech analytics product. Use the shared components; add only layout CSS in your stylesheet (grid/spacing/specific widths) using tokens (var(--sp-*), var(--border), etc.). Check your HTML renders sensibly at 360px width (no fixed widths that overflow; tables inside .table-wrap). Every control must work with an existing action. Every number must come from selectors/engine.
Before finishing: (1) cd "${APP}" && node scripts/smoke.mjs ${it.key}  → must print 0 problem(s); (2) write a probe under ${SCRATCH}/${it.key}/ that renders your view for aarav 2026-09, meera 2026-09, kabir 2026-09 and an import/thin state from tests/helpers/render-matrix.mjs stateMatrix(), and READ the HTML text output (strip tags) to check copy, numbers and empty states make sense; (3) npm test (note: E17 may fail until the inspect/overview modules add the required association sentence — that is expected unless you own those modules).
Final message: a concise report: what you built (sections), any shared-change requests you could not make, smoke result line.`
}

function reviewPrompt(it, buildReport) {
  const target = it.kind === 'tests'
    ? `the NEW test files in ${APP}/tests (engine.rules.test.mjs, import.test.mjs, compare.test.mjs, lab.test.mjs, store.test.mjs). Check: tests actually assert meaningful behaviour with independently derived expected values (not values copied from engine output), boundaries are right, nothing is trivially true, no test weakens or duplicates the original evals.test.mjs, and that the whole suite runs (npm test). Check coverage against this spec:\n${TESTS_SPEC}`
    : `the module ${APP}/${it.file} (+ ${it.css}) against its spec:\n${it.spec}`
  return `${COMMON}
You are an independent, skeptical reviewer (a senior fintech product designer + QA engineer). Do NOT edit any project file; you may write probes under ${SCRATCH}/review-${it.key}/.
Review ${target}

The builder reported:\n${String(buildReport ?? '').slice(0, 3000)}

Actively try to find problems: render the view across states (use tests/helpers/render-matrix.mjs stateMatrix() and renderPage / run node scripts/smoke.mjs ${it.kind === 'tests' ? '' : it.key}), read the produced text, and verify:
- numbers are traceable and consistent with the engine (recompute a few with your own probe), missing values shown as an em dash not ₹0, negative/zero costs not shown as negative costs;
- every interactive element has a valid data-action and payload that the reducer actually handles (check store.js handlers and their payload keys, e.g. data-habit-id → habitId, data-param for form controls); no dead or decorative buttons; stable unique ids for inputs;
- state handling: switching dataset/period/filters does not leave stale content (the view must derive everything from state);
- honesty rules (no causal or "would have" claims, no advice, correct documented vs proposed labelling, synthetic/imported labelling);
- requirement coverage (list anything missing from the spec);
- accessibility (labels, headings order, aria, colour not the only signal) and mobile (≤ 360px: no fixed widths, wrapping controls);
- design consistency with the shared components (no ad-hoc colours, no decorative junk).
Only report real, verified issues with concrete evidence (file:line or a reproduction). Severity critical = wrong number/claim or broken control; major = missing requirement or confusing/misleading UI; minor = polish.`
}

function fixPrompt(it, buildReport, review) {
  return `${COMMON}
You built ${it.kind === 'tests' ? 'the new test files' : it.file}. An independent reviewer returned these findings (JSON):
${JSON.stringify(review ?? { issues: [], missingRequirements: [] }, null, 2).slice(0, 12000)}

For each issue: verify it yourself (it may be wrong). Fix every verified critical and major issue and any cheap minor ones, staying strictly within the files you own (${it.kind === 'tests' ? 'tests/engine.rules.test.mjs, tests/import.test.mjs, tests/compare.test.mjs, tests/lab.test.mjs, tests/store.test.mjs' : `${it.file} and ${it.css}`}). Implement missing requirements. If a fix needs a shared file change, do not make it; record it as a request.
${it.kind === 'tests' ? '' : `Spec reminder:\n${it.spec}\n`}
Then re-verify: cd "${APP}" && ${it.kind === 'tests' ? 'npm test' : `node scripts/smoke.mjs ${it.key} && npm test`}.
Final message: report each finding as fixed / rejected (with why) / needs-shared-change, the final smoke/test result line, and any shared-change requests.`
}

const results = await pipeline(
  ITEMS,
  (it) => agent(buildPrompt(it), { label: `build:${it.key}`, phase: 'Build' }),
  (report, it) => agent(reviewPrompt(it, report), { label: `review:${it.key}`, phase: 'Review', schema: REVIEW_SCHEMA }).then((rev) => ({ report, rev })),
  (prev, it) => agent(fixPrompt(it, prev.report, prev.rev), { label: `fix:${it.key}`, phase: 'Fix' }).then((fix) => ({ key: it.key, build: prev.report, review: prev.rev, fix })),
)

return results.filter(Boolean).map((r) => ({
  key: r.key,
  reviewVerdict: r.review?.verdict,
  issues: (r.review?.issues ?? []).map((i) => `${i.severity}/${i.category}: ${i.description}`),
  missing: r.review?.missingRequirements ?? [],
  fixReport: String(r.fix ?? '').slice(0, 2500),
}))
