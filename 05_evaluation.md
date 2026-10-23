# Habit Ledger: Evaluations

**How I decided it was good enough to ship (as a prototype):**
1. It finds behaviours that are really there.
2. It stays silent when they aren't.
3. Every rupee figure can be recomputed by hand.
4. Bad input is rejected, never silently turned into ₹0.
5. Every control in the UI does what its label says.
6. Independent reviewers who are trying to break it can't find a confirmed problem that remains unaddressed.

**Actual result (23 Oct 2026, Node v24.16.0):**
- `npm test` passes **151 / 151** (0 fail, 0 todo, 0 skipped).
- `npm run smoke` renders 9 views × 90 states = **810 renders, 0 problems**.
- `npm run build` succeeds.
- The raw test output is saved in `app/tests/last-run.txt`.

All figures in this document come from actual runs.

---

## 1. Ship criteria

| # | Criterion | Threshold | Result |
|---|---|---|---|
| S1 | Detection against planted ground truth (5 behaviours × 6 sample trader-months, plus lab scenarios) | Detected set = planted set | Met (E01–E03, lab tests) |
| S2 | The disciplined trader gets no confirmed habit | 0 in both months | Met (E04, U-tests) |
| S3 | Each near miss fails for the intended reason | 3 / 3 | Met (E05) |
| S4 | Costs equal an independent recomputation from raw fills | abs. error < ₹0.01 | Met (E07, E08, engine rules) |
| S5 | Invalid values are rejected with a reason, never coerced to 0 | All malformed cases | Met (E10–E12, import tests, R13) |
| S6 | No copy claims causation, forgone profit or advice | 0 matches across all rendered states | Met (E17, U07) |
| S7 | Verdicts follow the comparison rules, and trading less never counts as improving | All boundary cases | Met (E14, E15, compare tests) |
| S8 | Every rendered control maps to a real action; no duplicate IDs; no leaked `NaN` or `undefined` | 0 problems in 810 renders | Met (U01, smoke) |
| S9 | Every control has an accessible name; one h1 per view; charts have text alternatives | All sampled states | Met (U03, U04) |
| S10 | Confirmed adversarial-review findings addressed | 57 / 57 | 56 fixed, 1 partly fixed (see §4.3) |

---

## 2. Automated suites

| File | Tests | What it covers | How expected values were derived |
|---|---|---|---|
| `evals.test.mjs` | 19 | The original v1 evals: planted vs detected, false-positive traps, cost arithmetic, gates, CSV failures, open positions, round trip, verdicts, de-duplication, honest copy, thin month, data realism | Planted manifest from the generator; a hand-worked spread; recomputation from raw fills |
| `engine.rules.test.mjs` | 34 | Every detector at its exact threshold boundary, every gate boundary, baseline cap and thin baseline, zero and flat P&L, missing charges, overlap labels, period split, guardrail measurement with custom parameters, re-gate, the 3-habit limit | Small hand-built fixtures, with the expected figures worked out in comments |
| `import.test.mjs` | 27 | Reader (quotes, CRLF, BOM, `;` delimiter, line numbers), header aliases, mapping problems, timestamps (zones, no zone → IST, invalid dates, seconds ≥ 60), strict amounts (Indian and western grouping; decimal comma rejected), every row-level error, duplicates, the row limit, round trip | Literal inputs and outputs |
| `compare.test.mjs` | 16 | Fisher exact against hand counts (17/70, 1/6, 2/19, 1/26) and an exact reference; Wilson; every verdict boundary (minimum chances, ±50% / 25% relative, p on both sides of 0.2 and 0.05); "trading less is not improving" | Exact fractions |
| `lab.test.mjs` | 10 | Each preset's classification, determinism, gap outside the window, clamping, planted = detected | Generator manifest |
| `store.test.mjs` | 23 | Reducer purity and state resets (trader or period change resets filters, selection, exclusions and drafts); ignored bad input; guardrail flow; import flow; persistence sanitising; next-action priority; trade filters and paging; inspector sensitivity | Hand-checked counts from sample data |
| `ui.test.mjs` | 9 | Render matrix (no unknown actions, duplicate IDs or leaks); every effect implemented; accessible names; one h1; chart text alternatives; overview headline = engine headline; no stale data after switching trader; disclaimer present and banned phrases absent; overlays only when asked for; missing values shown as "—" | Rendered HTML |
| `review-fixes.test.mjs` | 13 | One regression test per engine or store fix from the integrated review (R01–R13, §4.2) | The reviewers' reproductions |

The render matrix (`tests/helpers/render-matrix.mjs`) covers 90 states:
- 3 sample traders × 2 months × each habit in the inspector;
- trade filters, selections and dialogs;
- every import-wizard step, including a messy broker file and a thin file;
- every lab preset plus edge settings;
- three edge datasets: a habit cut only by the 3-habit limit, and two real overlaps.

---

## 3. Changes to existing tests (all deliberate)

| Test | Change | Why |
|---|---|---|
| E15 | Expected labels renamed: "Worse" → "Worsening", "Too little activity to judge" → "Inconclusive" | v2 verdict vocabulary. The same cases now go through a stricter rule (minimum 8 chances, exact test). |
| E17 | Scans every file under `src/` instead of two files | The v1 `app.js` no longer exists. The scan is wider, not narrower. |
| E19 | Days of Meera's hedge removals read from the ground-truth manifest | The sample calendar now skips NSE holidays, so the hard-coded dates moved. |
| engine.rules "previous trade flat" | Re-entry chances 1 → 0 | **Semantic fix** (review finding #1). A re-entry chance is now a *trade opened after a losing trade*. Before, chances counted losing trades while occurrences counted trades, so the rate could exceed 100%. |
| compare "costs floored at 0" | Chances label → "trades opened after a losing trade" | Same fix |
| lab and store "days" clamp | 22 → 21 | September 2026 has 21 NSE trading days |
| store selectDataset | Inspector opens on the new trader's top confirmed habit (H3 for Meera) instead of keeping H2 | Review finding: switching trader showed an empty "not seen" page |
| store guardrail, persistence and import tests | Rule objects gained `settingsPeriod`, `savedAt` and `changedAt`; rejected rows gained `file` | New fields for the honest guardrail timeline and multi-file imports |
| store next-action | October with rules set → "review-change" (compare) instead of "wait" | Review finding: the month where the loop pays off was a dead end |
| store import notes | Timezone note counts 4 imported rows, not 6 rows read | Review finding: it counted rejected rows that never entered the data |

No test was deleted, and no assertion was loosened to make a failure pass.

---

## 4. Adversarial review (real, multi-agent)

### 4.1 Module build workflow

Ten pipelines ran (nine modules and one test author), each through build, independent review and fix: 30 agents in total. The test author found **6 real bugs** and recorded them as `todo` tests instead of patching them:
1. A decimal comma "112,50" was read as ₹11,250.
2. A timestamp with seconds ≥ 60 became `NaN`.
3. The import notice double-counted excluded rows.
4. `initialState(null)` crashed.
5. The p ≥ 0.5 sentence was ungrammatical.
6. A 4th habit cut only by the 3-habit limit was called an "overlap".

All six were fixed, and the tests are now hard tests.

### 4.2 Integrated review

Five reviewers each took one lens:
- numbers and cross-module consistency;
- interaction and state;
- honesty and copy;
- accessibility and responsive design (in a browser);
- the product as a whole.

Two independent skeptics then tried to refute each finding.

| | Count |
|---|---|
| Findings reported | 66 |
| Confirmed by both skeptics | **57** (1 critical, 24 major, 32 minor) |
| Split (one skeptic each way) | 4 |
| Rejected by both | 5 |

The most important confirmed findings, and what changed:
- **Critical: the re-entry rate could exceed 100%.** Two trades opened after one loss both counted against a single "chance". This made compliance negative, gave a `NaN` interval and produced a false "strong Improving". A chance is now a trade opened after a losing trade, and the statistics functions reject impossible inputs (R01, R02).
- **Honesty: guardrail timeline.** Months already in the file were labelled "after the rule was set", implying the rule caused a change. Each rule now records when its settings were saved. A month is "after" only if its trades came later; otherwise it is labelled a what-if. Compare no longer says a rule was "broken" before it existed (R06).
- **Honesty: suggested stop levels.** The stop-loss snippet showed specific stop distances (0.70 / 0.68 × entry), and the adding-to-a-loser rule was labelled "documented" although no documented control blocks adding. The rule is now only the measured behaviour, labelled proposed. The snippet carries field names with placeholder values (R05).
- **Honesty:**
  - "Mostly the same trades" was used for 1 of 19 shared trades (R03);
  - limit cuts were called overlaps (R04);
  - "gross losses" actually included charges;
  - the headline said "vs your usual trade" for figures measured against ₹0 or a spread's maximum loss;
  - sample trades fell on NSE holidays (R11);
  - Kabir was described as using stops;
  - counts were not pluralised.
- **Product:**
  - "Import next month" was impossible: each import became a new trader. A file can now be added to an existing imported trader (R07).
  - The inspector had no way to set a guardrail.
  - Suggestive changes looked as certain as clear ones. They now read "Possibly improving", and behaviours that were never a habit are shown as context (R12).
  - The inspector opened on an empty habit (R10).
  - A clean trader was told to wait for a month already loaded.
- **Interaction and accessibility:**
  - slider drag broke after one step;
  - dialogs didn't trap focus;
  - Escape closed the dialog instead of the popover inside it;
  - re-renders reset scroll positions;
  - the skip link broke routing;
  - the live region was never written to;
  - the focus ring was hidden on active segments;
  - text contrast was slightly below AA, and input borders were 1.55:1;
  - popovers overflowed the viewport;
  - the chart's values were reachable by hover only;
  - the phone header took 43% of the screen.

**Split findings:**
- Implemented:
  - the loop-payoff next action (now "review-change");
  - the lab → importer handoff ("Open this month in the importer");
  - hiding another trader's data-quality panel while a file is checked.
- Not implemented: larger tap targets for the 16px "?" popover triggers. One skeptic rated this not-an-issue, the other minor.

**Rejected by both skeptics:** five findings, including that lot-cap compliance measures only the first fill (it measures entry size by design), and that the Overview leads with generic KPIs.

### 4.3 Fix verification

**Engine, store, main and data fixes** were made directly. Each has a regression test (R01–R13).

**View fixes** went to nine agents, one per module. An independent verifier per module checked every item against rendered text:
- all **9 / 9** were verified as resolved;
- four verifiers found small regressions introduced by the fixes (e.g. two live-region sources on one page, a missing space between sentences, copy that over-claimed), and a second pass fixed them.

**Partly addressed:** review finding #16. Fixing the unprompted re-render (the notice timer) is done. But any re-render still closes open `<details>` disclosures, because the app re-renders the whole tree.

---

## 5. Manual browser QA (23 Oct 2026, local preview, Chromium)

| Check | Observed |
|---|---|
| Guardrail from the Overview "Next step" with a real click | Dialog opens with focus on the first setting; the page behind is `inert` with scroll locked; 8 Tab presses stay inside the dialog; arrow keys change the setting with a live preview; one click on Save closes the dialog, focus returns to the next-step button, and the live region announces "Saved … Nothing was sent to any broker." |
| Guardrails and Compare wording after saving | "Every period here is a what-if…"; Compare: "9 / 30 → 2 / 24 · Improving · … about 1 in 20 times by chance"; excess loss shown as context only |
| Trades: typing "BANKNIFTY" in search | Focus stays in the box through each re-render; "Showing 18 of 52 trades · net −₹7,120" announced |
| Trade drawer | Opens with focus on its heading; Escape closes it and returns focus to that row's Details button |
| Import of a messy broker CSV via the real file input | Header aliases mapped. Rejected with reasons: decimal comma, duplicate ID, FUT row, side "HOLD", negative quantity, blank price, non-numeric charge. The blank charge was imported and flagged. "1 position will be left out" is named before import. The new trader is thin, so the next step is "Add more history". |
| Lab slider: real mouse drag from 18 → 5 | Value follows the drag to 5; the results recompute; focus stays on the slider |
| 375px in dark mode, all 9 modules | 0 horizontal overflow; the current tab is visible in the mobile tab bar; the drawer is a bottom sheet and the dialog fits |
| Console | No messages at all across the journey |

**Found in earlier browser QA and fixed:** a 1-trade upload was reading as "no habits" (now "Too few trades to judge"), and the copy said "Some appeared" when nothing had.

---

## 6. What these evaluations do *not* establish

- **Real-world accuracy.** The data is synthetic and the behaviours were planted. Perfect detection shows the rules are implemented as defined. It does not show that real traders' habits look like this, or that the thresholds are right. Next step: consenting users' real tradebooks, with their own "that's me / that's not me" labels.
- **Causation.** Excess loss is an association; the UI says so wherever a cost appears.
- **Behaviour change.** October was also generated. The loop shows the *measurement* works, not that guardrails change behaviour, which would need a controlled comparison.
- **Statistical calibration.** Gates are a pragmatic small-sample filter. Testing five behaviours raises the chance of a false pattern. A null simulation by a reviewer showed a directional verdict about 10% of the time per behaviour per direction with the p < 0.2 bar, which is why such verdicts read "Possibly…".
- **Nubra integration.** Nubra's real tradebook schema isn't public. "Documented" labels refer to Nubra's public API docs, not verified app behaviour.
- **Accessibility.** Automated checks plus keyboard tests are not a full audit. Screen-reader testing on real assistive technology wasn't done.

## 7. AI in the product

There is none at runtime. Detection, costing, gates, statistics, verdicts and compliance are deterministic, so tests can assert exact values. Two places an LLM could earn its keep later, each with structured output, validation and a fallback:
1. **Mapping arbitrary broker CSVs.** Validate by zero row errors plus reconciliation with the broker's P&L. Fall back to the manual mapper, which exists today.
2. **Rephrasing habit cards.** Every number in the text must appear in the structured habit object. Fall back to template copy.
