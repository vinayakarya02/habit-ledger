export const meta = {
  name: 'habit-ledger-view-fixes',
  description: 'Fix confirmed review findings in each view module (one owner per file), then independently verify each fix',
  phases: [
    { title: 'Fix', detail: 'one agent per view file applies its confirmed findings using the new shared APIs' },
    { title: 'Verify', detail: 'independent checker confirms each finding is resolved; follow-up fix if not' },
  ],
}

const APP = '<repo>/app'
const SCRATCH = '<scratch>/viewfix'

const SHARED = `
Project: Habit Ledger (post-trade behaviour review prototype for options traders), static vanilla ES modules at ${APP} (Windows, Git Bash; quote paths). Read ${APP}/src/views/CONTRACT.md first (ownership, render contract, honesty rules), then the parts of src/engine.js, src/store.js, src/ui/components.js and src/main.js you need.
An integrated adversarial review found issues; the shared files (engine/store/main/components/charts/CSS/shell) have ALREADY been fixed by the lead. You now fix your ONE view file. You may edit ONLY your view's .js and its styles/views/*.css. Scratch probes only under ${SCRATCH}/<module>/.

NEW / CHANGED SHARED APIs (use them; do not re-derive):
- engine HABITS[id] now has 'chance' (singular) and 'chances' (plural); H1's chance is now "trade opened after a losing trade" (occurrences and chances are the same unit, rate ≤ 100%). Use HABITS text, never hardcode "losing trades" for H1.
- engine habits[id] for status 'overlap' now carry: overlap (shared trade count), overlapWith (names), limitCut (true when it passed every gate and only the CONFIG.maxHabits limit left it out), recheck {occurrences, cost, gates} (the de-duplicated re-check). Its own figures (occurrences, cost, evidence) are the standalone, pre-de-duplication ones. nearMisses entries also have limitCut, seen (standalone count), overlap, overlapWith. statusReason for overlaps says "Shares k of its n trades…" (or "Mostly the same trades…" only when > 50% shared) and for limit cuts "Passed every gate, but only the top 3 habits are reported…". CONFIG.maxHabits = 3, CONFIG.lotCapMultiple = 1.25.
- engine compareHabit rows now have: tracked (confirmed in either period), confirmedIn {before, after}; strength 'strong' (p<0.05) | 'suggestive' (p<0.2) | 'weak'; explanation already grammatical.
- engine GUARDRAILS.H2 is now status 'proposed' with NO snippet; only H3 has a snippet (field names with placeholder values). Nubra texts are plain language now.
- engine stats.orders, stats.noChargesRecorded; summary.excluded[] items {symbol, reason, fills, month} with reason "Still open at the end of the data, or its closing order is missing (for example a row rejected at import); excluded."
- store: rulePhase(state, rule, periodKey) → 'what-if' | 'after' ('after' only if the period's first trade is later than when the rule's current settings were saved); selectGuardrails() entries now include phases {current, prev, next}; saved rules have {params, status, createdPeriod, settingsPeriod, savedAt, changedAt}. New action setImportTarget {target: 'new' | <existing import id>} (wizard field importWizard.target); confirmImport adds to an existing import when target is an import id (fills merged, ids already present skipped; importSummary.files [{fileName, accepted, rejected, skipped}], skippedExisting; rejectedRows[] items now have 'file'). selectLab() now returns 'from' (preset a custom month started from). defaultInspectHabit(state). selectNextAction may return kind 'review-change' or a 'none' kind whose action is {type:'selectPeriod', key}.
- components: habitStatusChip(habit, CONFIG.maxHabits) (labels limit cuts "Passed · over the 3-habit limit"); verdictChip(verdict, strength) and verdictLabel(verdict, strength) ("Possibly improving/worsening" for suggestive); select({..., error, hint}); button(label, {..., ariaDisabled}).
- main.js: one polite live region; mark ONE result summary element per view with the attribute data-announce (its text is announced when it changes). Range inputs (input type=range with live:true) no longer re-render while dragging: render a value label element <span data-range-for="<the input id>" data-unit="<unit>">value unit</span> so main.js can update it during a drag; the action commits on change. Effects: downloadRejected now needs data-source="wizard" (rows of the file currently in the import Review step) or data-source="dataset" (the current imported trader); new effect openLabInImporter (no payload). Escape, focus trap (inert), scroll restore and popover flipping are handled globally.
- CSS: .def-body flips left automatically (.def-flip) and becomes a bottom sheet ≤640px; remove per-view .def-body overrides only if they now conflict.
Terminology to use everywhere: "excess loss" (never "excess cost"), "breaks" for guardrail violations, "realised" (Indian English) for P&L, "chances" for the denominator. Never "would have made/saved", never causal claims, never advice.
Before finishing: cd "${APP}" && node scripts/smoke.mjs <module>  (must print 0 problem(s)) and npm test (all must pass; currently 151). Render your view for the relevant states (tests/helpers/render-matrix.mjs stateMatrix(), renderPage(state, view, mods) via loadModules()) and READ the text to confirm each fix.
`

const VIEWS = [
  { key: 'overview', items: `
1. Rounding: when the rounded confirmed-habit costs (formatINR) do not add up to the rounded headline (e.g. Meera Sep ₹30,908 + ₹11,729 = ₹42,637 vs headline ₹42,636), add a short note: "Figures are rounded to the rupee, so the parts can differ from the total by ₹1." Only when they differ.
2. "Change since …" panel: subtitle must say rates count every matching trade before de-duplication, so they can differ from the ranked list's counts. Use verdictChip(row.verdict, row.strength). Only list rows with row.tracked (confirmed in either period); if none, say so plainly.
3. Headline basis wording (honesty): the headline currently says "compared with your usual trade" even when part/all of the total is measured against ₹0 (capped baseline, costing.baseline === 0) or beyond a spread's defined max loss (H3). Word the headline by basis: if every confirmed habit uses a negative usual-trade baseline → "compared with your usual trade"; otherwise use a neutral headline ("associated with ₹X of excess loss") plus a one-line breakdown by basis (e.g. "₹11,729 vs breaking even, because your usual trade made money; ₹30,908 beyond spreads' defined maximum loss"). Make the panel footer conditional accordingly (no "not against ₹0" when some figure IS against ₹0).
4. Add a short qualifier right next to the headline figure: "not a share of your net P&L" (Aarav Sep headline ₹1,01,600 is close to his net −₹1,01,510; readers must not read it as "habits explain the whole loss").
5. Lead sentence: wrap every signed money amount in prose in <span class="num"> so the sign never wraps away from the number on phones.
6. Clean state (no confirmed habit, e.g. Kabir Sep): do not repeat the near-miss behaviours as a chip list in the habits panel when the Near misses panel already lists them — keep a single short sentence + link to Habits.
7. Any "Download rejected rows" button here must carry data-source="dataset".
8. Spelling "Net realised P&L" (not realized). Use habitStatusChip where a habit status chip is shown. Next-step button must render whatever action selectNextAction returns (including {type:'selectPeriod', key}) with correct data-* attributes.` },
  { key: 'inspect', items: `
1. Overlap callout order bug: for habit.status === 'overlap' the callout must explain that this behaviour's figures are BEFORE de-duplication (they include the shared trades) and summarise habit.recheck; the "shared trades are not in this table or this cost" text applies ONLY to confirmed habits with overlap > 0. Check status before overlap count.
2. Status chip: use habitStatusChip(h, CONFIG.maxHabits); for limitCut habits explain "Passed every gate; left out only because at most 3 habits are reported per period" (no overlap wording). Callout title "Mostly the same trades as another habit" only when more than half of its trades are shared; otherwise "Shares trades with a confirmed habit".
3. Rounding: the "Recomputed from the N rows in the table" check must compare the SUM OF ROUNDED table rows to the rounded total; when they differ (Meera Sep H3: rows sum to ₹30,907 vs ₹30,908) show paise or the note "The table rounds each row to the rupee, so the rows can differ from the total by ₹1." Never claim rows add up exactly when they don't.
4. Wording: "gross losses" → "total losses after charges" for the materiality bar.
5. Add an "Act on this" panel at the end: for a confirmed habit a primary button "Set guardrail"/"Edit guardrail" (action openGuardrail, data habit-id; label Edit when state.guardrails[datasetId][id] exists) and, when selectNextPeriod(state) exists, a link to Compare (navigate compare); for non-confirmed habits a secondary "Set an optional rule" button. Keep honest copy.
6. H1 chances wording comes from HABITS (trades opened after a losing trade).` },
  { key: 'guardrails', items: `
1. Status chip: use habitStatusChip(entry.habit, CONFIG.maxHabits). For a limitCut habit, the "why relevant" text must say "Passed every evidence gate; left out of the confirmed list only by the 3-habit limit" — not "evidence does not single this behaviour out".
2. Timeline honesty: stop labelling periods by month order ("Before/After rule was set", "Reviewed when rule was set"). Use entry.phases (from rulePhase): 'what-if' → label "What-if: measured on trades already in the file" (for every period whose trades existed before the rule's current settings were saved — which is every sample period); 'after' → "After the current settings were saved". Status line: "Active · settings chosen while reviewing <formatMonth(rule.settingsPeriod)>" (fallback createdPeriod). Remove claims that a later month shows the effect of the rule. The dialog's what-if note should match.
3. Nubra block: H2 is now 'proposed' with no snippet; H3 is the only one with a snippet — caption it "Field names as described in Nubra's public API docs; values are placeholders, not a live order." Chip labels: "Documented in Nubra's public API docs" / "Proposed (not a Nubra feature)".
4. Use "breaks" consistently for violations. H1's measure text comes from the template (trades opened after a losing trade).
5. If a de-duplication note exists (habit.overlap > 0), it must be correct for both confirmed and overlap statuses (overlap habits' counts include the shared trades).` },
  { key: 'compare', items: `
1. Verdict chips: use verdictChip(row.verdict, row.strength); the summary counts must use verdictLabel so "Possibly improving" is not counted as a clear improvement (e.g. "1 improving, 1 possibly improving, …").
2. Group rows: first "Habits you are tracking" (row.tracked — confirmed in either period), then "Other behaviours" with a note that they were not a confirmed habit in either period, so their changes are context only. Not applicable rows compact at the end.
3. Terminology: "Excess cost" → "Excess loss" everywhere. Do not call the comparison's p-value bands "Evidence strength: strong" (clashes with a habit's "Strong evidence"); instead write e.g. "Chance of a change this large if nothing had changed: about 1 in 20" and put the one-sided p-value inside the existing rules/details disclosure only.
4. Explain 'pp' once: show "−20.7 percentage points" (or "from 29.0% to 8.3%") — no bare unexplained "pp".
5. Guardrail compliance section (honesty): use rulePhase(state, rule, key) for each period. For a 'what-if' period never say "Kept/Broken" or imply the rule was in force: write "Happened N times in M chances (measured on trades already in the file, before the rule's current settings were saved)". Only 'after' periods may say "Kept in …" / "N breaks". Replace "Set while reviewing X" with "Settings chosen while reviewing X" (rule.settingsPeriod ?? createdPeriod). Remove any "Change in kept share" framing that implies the rule caused a change; you may show the change in rate neutrally.
6. Remove the tidy() workaround if it is now dead code (the engine sentence is fixed).` },
  { key: 'trades', items: `
1. Drawer overlap text: for a label with role 'overlap', branch on the behaviour's habit status: if that behaviour is confirmed, "already counted under X, so it adds nothing here"; otherwise (overlap / insufficient / not-costly) "counted under X for the headline, but it still appears in this behaviour's own figures (which are before de-duplication)".
2. Drawer focus: put data-autofocus on the drawer heading (give it tabindex="-1") instead of the footer Close button, so screen-reader users start at the top.
3. Mark the "Showing N of M trades · net …" summary with data-announce.
4. Left-out positions: add a collapsible panel (native <details>) "Left out of the review (N positions)" when analysis.summary.excluded is non-empty, listing symbol, number of orders, first order time, and the reason; explain that these are in no figure.
5. Spelling "realised". Missing values stay as the em dash.` },
  { key: 'habits', items: `
1. Wording: "gross losses" → "total losses after charges" (materiality bar).
2. Mark the "Showing n of 5" count with data-announce.
3. Prefer the engine's limitCut / recheck / overlap fields over local re-derivation where it simplifies the code without changing correct output; use habitStatusChip where a status chip is shown. Make sure overlap-status cards say their figures include the shared trades (before de-duplication).
4. H1 chances wording comes from HABITS.` },
  { key: 'lab', items: `
1. Reset button: when state.lab.scenario === 'custom', reset to selectLab(state).from (the preset it started from), with the label naming that preset; otherwise reset to the current preset.
2. Wording: "gross losses" → "total losses after charges" (all occurrences).
3. Sliders: each range input must have a visible value label <span data-range-for="<input id>" data-unit="<unit>">value unit</span> (main.js updates it during a drag; the value commits on change). Remove any assumption that every input event re-renders. Trading days max is now 21 (LAB_PARAMS) — no hardcoded 22.
4. Mark the result summary (e.g. #lab-summary) with data-announce.
5. Add a button "Open this month in the importer" (action openLabInImporter, no payload) near "Download this CSV", explaining it loads the simulated file into the Import page so you can see how the importer handles it.` },
  { key: 'import', items: `
1. Rejected-rows downloads: the button in the Review step must carry data-source="wizard" and download THIS file's rejected rows (label "Download rejected rows of <file>"); the button in the current-trader data-quality section carries data-source="dataset". Update notes so they describe exactly what each button downloads (remove the note saying the Review download is for another file).
2. Add-to-trader: in the Review step add a select (id import-target, action setImportTarget, data param=target) "Import as": "A new trader" (value new) plus one option per existing import "Add to <name> (<months covered>)". Explain: adding keeps that trader's guardrails and lets Compare use both months; orders whose id is already there are skipped. The confirm button label should reflect the choice ("Import N rows as a new trader" / "Add N rows to <name>").
3. Left-out positions preview: in the Review step, compute buildPositions(result.fills).excluded (import from ../engine.js) and show "N positions will be left out because their closing order is missing or was rejected" with the first few symbols (only when N > 0).
4. Hide the current-trader data-quality panel while the wizard is in the mapping or preview step (show it on start / reading / done only), so the page never shows another trader's quality next to the file being checked.
5. Your-imports list: show each import's files (importSummary.files) and periods covered; distinct names are now guaranteed by the store.
6. The size-limit error text now comes from the store ("Split it into smaller files and add each one to the same trader.") — make sure nothing on the page contradicts it (e.g. "split by month").` },
  { key: 'method', items: `
1. Remove "(the engine field is grossLosses)"; call it "total losses after charges" consistently.
2. Rounding: replace any claim that habit figures "add up to the headline exactly" with: the headline is the exact sum; shown figures are rounded to the rupee, so parts can differ from the total by ₹1.
3. Update content to match the shipped engine (read values from CONFIG/HABITS/GUARDRAILS/LAB_PARAMS, never hardcode): H1's chance is a trade opened after a losing trade; H2's guardrail is proposed (no documented Nubra control blocks adding; stop-loss exits are a related documented control); verdicts: "Improving"/"Worsening" when the chance is below 1 in 20 and the relative change is large enough, "Possibly improving/worsening" when it is between 1 in 20 and 1 in 5, and behaviours that were not a confirmed habit in either period are shown as context only; guardrail timeline: a period counts as "after" only if its trades were placed after the rule's current settings were saved, otherwise it is a what-if (true for every sample period); imports can be added to an existing imported trader (ids already present are skipped); sample data skips NSE holidays (14 Sep, 2 Oct, 20 Oct 2026) and expiries falling on a holiday move to the previous trading day; the scenario lab allows up to 21 trading days.
4. Terminology: "excess loss", "breaks", "realised".` },
]

const VERIFY = {
  type: 'object',
  properties: {
    allResolved: { type: 'boolean' },
    unresolved: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, evidence: { type: 'string' } }, required: ['item', 'evidence'] } },
    regressions: { type: 'array', items: { type: 'string' } },
    smoke: { type: 'string' },
    tests: { type: 'string' },
  },
  required: ['allResolved', 'unresolved', 'regressions', 'smoke', 'tests'],
}

const results = await pipeline(
  VIEWS,
  (v) => agent(`${SHARED}\nYOUR MODULE: ${v.key} — you own ONLY src/views/${v.key}.js and styles/views/${v.key}.css.\nConfirmed findings to fix:\n${v.items}\nFinal message: for each numbered item say what you changed (or why it needed nothing), plus the smoke and npm test result lines.`, { label: `fix:${v.key}`, phase: 'Fix' }),
  (report, v) => agent(`${SHARED}\nYou are an independent VERIFIER for module ${v.key} (src/views/${v.key}.js). Do NOT edit project files. For EACH numbered item below, check the current code AND the rendered text across relevant states (stateMatrix incl. edge/limit-cut, edge/overlap-h1, edge/overlap-h5, meera/2026-09, kabir/2026-09, aarav/guardrails-saved, imports) and decide whether it is resolved. Also look for regressions introduced by the fix (broken controls, unknown actions, wrong numbers, honesty violations). Run node scripts/smoke.mjs ${v.key} and npm test.\nItems:\n${v.items}\nThe fixer reported:\n${String(report ?? '').slice(0, 2500)}`, { label: `verify:${v.key}`, phase: 'Verify', schema: VERIFY }).then((ver) => ({ report, ver })),
  (prev, v) => (prev.ver && (prev.ver.allResolved === false || prev.ver.regressions.length)
    ? agent(`${SHARED}\nYOUR MODULE: ${v.key} — you own ONLY src/views/${v.key}.js and styles/views/${v.key}.css.\nAn independent verifier found these remaining problems after your first pass:\n${JSON.stringify({ unresolved: prev.ver.unresolved, regressions: prev.ver.regressions }, null, 2).slice(0, 8000)}\nOriginal items:\n${v.items}\nFix what is real (verify each first). Final message: what you changed + smoke and npm test result lines.`, { label: `fix2:${v.key}`, phase: 'Verify' }).then((fix2) => ({ key: v.key, report: prev.report, ver: prev.ver, fix2 }))
    : { key: v.key, report: prev.report, ver: prev.ver, fix2: null }),
)

return results.filter(Boolean).map((r) => ({
  key: r.key,
  verifiedResolved: r.ver?.allResolved ?? null,
  unresolved: (r.ver?.unresolved ?? []).map((u) => `${u.item}: ${u.evidence}`.slice(0, 400)),
  regressions: r.ver?.regressions ?? [],
  smoke: r.ver?.smoke, tests: r.ver?.tests,
  secondPass: r.fix2 ? String(r.fix2).slice(0, 1500) : null,
}))
