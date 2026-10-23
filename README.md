# Habit Ledger

**Post-trade behaviour review for options traders.** Habit Ledger turns a month of option order history into the two or three repeated behaviours associated with excess losses. It shows only the ones the evidence supports, makes every rupee traceable to the trades behind it, turns each behaviour into a personal guardrail, and measures whether the behaviour changed the next month.

Live prototype: **https://habit-ledger-xi.vercel.app** (synthetic sample traders; you can also import your own CSV, which never leaves your browser).

Built as a take-home for the Nubra Product Management Intern assignment (Problem 03: *"Most retail traders never review their own trades. Turn a month of order history into the two or three habits that are costing them money."*). It is a prototype: it is not connected to Nubra or any broker, it uses no live market data, it never places orders, and nothing in it is investment advice.

## What makes it different

Generic trade journals bucket P&L (by expiry, by call/put, by time of day). Habit Ledger asks a narrower, harder question and refuses to over-answer it:

- **Costs are measured against your own usual trade**, capped at ₹0, so a profitable usual trade means the comparison is breaking even and forgone profit is never counted. Hedge removal is measured against the spread's own defined maximum loss. Most retail F&O traders lose on most trades, so simply deleting a behaviour's trades ("the month without these trades") would blame it for losses you'd have taken anyway.
- **A behaviour is called a habit only if it passes four fixed evidence gates**: repeated (≥ 4), spread out (≥ 3 days), material, and not explained by a single trade (leave-one-out). Below 20 trades in a period, nothing is confirmed. The disciplined sample trader gets **no confirmed habits**; his near misses are shown with the reason each one fell short.
- **Every number is traceable.** The evidence inspector shows each qualifying trade, why it qualified, the baseline, the arithmetic, the leave-one-out result, and lets you exclude trades to see whether the conclusion survives.
- **The loop closes.** Each habit maps to a guardrail, labelled as either an order control documented in Nubra's public API docs or a proposed new capability. Compliance is measured from your own fills. Months whose trades already existed when the rule was saved are labelled what-ifs, not "after". Month-over-month verdicts use *rates per chance* plus a one-sided Fisher exact test ("Possibly improving" when the evidence is only suggestive), so trading less is never mistaken for improving. A second month's CSV can be added to an imported trader, so its guardrails and comparisons carry over.

## Modules

| Module | What it does |
|---|---|
| Overview | Period summary, data quality, defined trade statistics, daily P&L, confirmed habits, near misses, change since the previous period, and one next action |
| Habits | All five behaviours with status, the reason for the classification, occurrences per chance, gates, and cost; filter and sort |
| Evidence inspector | Qualifying trades, baseline, calculation, leave-one-out, sensitivity (exclude trades and re-gate), what can't be concluded |
| Trades | Search, filters (date, underlying, type, outcome, behaviour), sort, paging, and a detail drawer with legs, fills and labels; missing values are shown as "—", never ₹0 |
| Guardrails | Create, edit, pause and remove personal rules; documented vs proposed capability; compliance per period |
| Compare periods | Rates per chance with 90% intervals, absolute and relative change, sample sizes, verdicts with explanations |
| Import CSV | Column mapping with header aliases, preview, row-level validation, duplicate detection, accepted/rejected summary, rejected-rows download |
| Scenario lab | Change a synthetic history (re-entries, gaps, blow-ups, missing data) and watch the same fixed rules classify it |
| Methodology | Every rule, threshold, formula, edge case and limitation, and what the tests do and don't establish |

## Architecture

A dependency-free static web app: vanilla ES modules, no framework, no runtime services, no LLM.

```
app/
  index.html
  src/
    engine.js      Behaviour engine: positions → trades, 5 detectors, costs, gates, de-duplication,
                   statistics, period comparison (Fisher exact, Wilson), guardrail compliance.
                   The single source of truth for every derived number.
    import.js      CSV reading, column mapping, validation (invalid values rejected, never coerced to 0)
    lab.js         Scenario lab generator (runs through the real importer and engine)
    data.js        Seeded synthetic personas with planted behaviours (ground truth for tests)
    store.js       Pure reducer + memoised selectors; views read data only through these
    format.js      Stable INR / % / date / missing-value formatting
    main.js        DOM events → actions, rendering, focus management, routing, downloads
    ui/            Shared components and SVG charts
    views/         One pure render(state) module per product module (see views/CONTRACT.md)
  styles/          Design tokens (light/dark), base layout, components, per-view layout
  tests/           node:test suites + a render matrix that checks every view in ~90 states
  scripts/         build (dist/ with commit stamp + security headers), smoke, serve
```

Views are pure functions of state, and every interactive element declares a `data-action` handled by the reducer. That makes "no dead buttons", "no stale state after switching data" and "no leaked NaN/undefined" testable without a browser.

## Run it

Requires Node 20+ (no `npm install` needed: there are no dependencies).

```bash
cd app
npm test          # all automated evaluations
npm run smoke     # render every view across the state matrix
npm run build     # assemble dist/ (stamped with the git commit)
npm run serve     # serve the source at http://127.0.0.1:5173
```

To serve the production bundle: `node scripts/serve.mjs dist 5173`.

## Data and privacy

- Sample traders (Aarav, Meera, Kabir) are synthetic and generated deterministically from fixed seeds. Lot sizes and the ₹20-per-order charge are illustrative.
- Imported CSV files are parsed in the browser tab, held in memory only, and discarded when the tab closes. The deployed site's Content-Security-Policy restricts network connections to its own origin. Guardrail settings for the sample traders (and the theme) are stored in `localStorage`.
- There are no API keys, credentials, analytics or third-party calls besides the Google Fonts stylesheet.

## Limitations

Associations, not causes. Small samples. Fixed, reasoned thresholds that have not been calibrated on real traders. No market prices, so no "what if you had held" counterfactuals. Synthetic evaluation data, so the tests verify the rules are implemented as defined, not that they work in the real world. See the Methodology page and [`05_evaluation.md`](05_evaluation.md).

## Submission documents

| File | Contents |
|---|---|
| [`01_research_and_concept_selection.md`](01_research_and_concept_selection.md) | Public research on Nubra, 14 concepts, scoring, selection |
| [`02_refined_mvp.md`](02_refined_mvp.md) | Product specification as shipped |
| [`03_implementation_prompt.md`](03_implementation_prompt.md) | Build prompts |
| [`04_one_pager.md`](04_one_pager.md) | The 300–700-word one-pager |
| [`05_evaluation.md`](05_evaluation.md) | Evaluation cases, actual results, limits |
| [`06_prompt_log.md`](06_prompt_log.md) | Every prompt I sent, verbatim and in order |
