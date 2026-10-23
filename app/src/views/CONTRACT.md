# View module contract

Habit Ledger is a static, dependency-free web app (vanilla ES modules, no build step for development).
Each product module is one file in `src/views/<name>.js` plus one stylesheet `styles/views/<name>.css`.

## Architecture (read these files before writing a view)

| File | Role |
|---|---|
| `src/engine.js` | Pure behaviour engine: positions, trades ("units"), 5 detectors (H1–H5), costs, 4 evidence gates, de-duplication, statistics, period comparison (Fisher exact + Wilson), guardrail templates and compliance. **Single source of truth for every number.** |
| `src/import.js` | CSV reading, column mapping (`FIELDS`), validation (`validateRows`), strict `parseCsv`, `TEMPLATE_CSV`, `LIMITS`. |
| `src/lab.js` | Scenario lab: `SCENARIOS`, `LAB_PARAMS`, `runScenario(params)`. |
| `src/store.js` | State, pure reducer (`reduce`), action list (`ACTION_TYPES`, `EFFECT_TYPES`) and memoised selectors. |
| `src/format.js` | `formatINR`, `formatPct`, `formatPP`, `formatRel`, `formatDate`, `formatDay`, `formatTime`, `formatDuration`, `formatLots`, `formatMonth`, `ordinal`, `plural`, `chanceText`, `MISSING`. |
| `src/ui/components.js` | HTML helpers: `esc`, `money`, `amount`, `pct`, `missing`, `button`, `linkTo`, `chip`, `statusChip`, `verdictChip`, `confidenceChip`, `def`, `stat`, `panel`, `callout`, `emptyState`, `pageHeader`, `select`, `input`, `segmented`, `table`, `gateList`, `gateDetail`, `meter`, `sr`. |
| `src/ui/charts.js` | `dailyPnlChart(daily)`, `rateCompareChart(row, {fromLabel, toLabel})`, `shareBar(x)`. |
| `src/views/shell.js` | Banner, sidebar, top bar (dataset + period + theme), mobile tabs, notice. Not yours to edit. |
| `src/main.js` | DOM events → actions, rendering, focus, routing, effects. Not yours to edit. |
| `styles/tokens.css`, `base.css`, `components.css` | Design system. Not yours to edit. |

## Ownership rule

You may create or edit **only** `src/views/<your module>.js` and `styles/views/<your module>.css`.
Do not edit any other file. If you need a shared change (a selector, component, engine field, action), do not make it:
work around it inside your module and list the request in your final report.

## Render contract

```js
export function render(state) { return '<html string>'; }
// Optional, only for modules that own a modal/drawer:
export function overlay(state) { return state.something ? '<div class="scrim" data-overlay-close data-action="closeX"></div><div class="drawer|dialog" data-overlay role="dialog" aria-modal="true" aria-labelledby="...">…</div>' : ''; }
```

- Pure functions of `state`. No DOM access, no `document`, no `window`, no timers, no `Math.random`, no `Date.now`.
- Read data only through selectors from `store.js` (and pure engine/format helpers). Never hardcode figures, persona names or results.
- Start the view with `pageHeader({ eyebrow, title, lead, actions })` (one `<h1>` per view). Use `panel()` for sections (h2 titles).
- The overlay root element must carry the attribute `data-overlay` (focus is moved into it). Give its first sensible control `data-autofocus`.

## Events

Interactive elements declare `data-action="<actionType>"` plus `data-*` payload attributes. `main.js` turns the click/change into
`{ type, ...dataset }`. Rules:

- Buttons: `button(label, { action: 'inspectHabit', data: { 'habit-id': 'H1' } })` → `{ type: 'inspectHabit', habitId: 'H1' }`.
- Form controls: the element's value is sent under the key named by `data-param` (default `value`). Example: `select({ id, label, value, options, action: 'setTradeFilter', data: { key: 'underlying' } })` → `{ type: 'setTradeFilter', key: 'underlying', value }`.
  For a different key: `data: { param: 'column', field: 'price' }` → `{ type: 'setMapping', field: 'price', column: value }`.
- Text/range inputs that should update while typing/dragging: pass `live: true` to `input()` (adds `data-on="input"`).
- Checkboxes send `checked` (boolean) as the value.
- File input: `<input type="file" id="…" data-action="importFile" accept=".csv,text/csv">` (main.js reads it).
- Every `id` must be unique on the whole page. Prefix ids with your module name (e.g. `trades-q`). Form controls need stable ids so focus survives re-renders.
- Use `<button>` for anything clickable. Never use links or divs with click handlers. Never render a button without a working `data-action`.

### Actions (reducer) and payloads

| type | payload | effect |
|---|---|---|
| `navigate` | `view`, optional `habitId` | change module |
| `selectDataset` | `id` | switch trader / import (resets filters, selection, exclusions) |
| `selectPeriod` | `key` (`YYYY-MM`) | switch review period (resets filters, selection, exclusions) |
| `setCompare` | `which` (`from`/`to`), `key` | comparison periods |
| `swapCompare` | — | swap from/to |
| `setHabitsFilter` | `key` (`status`/`sort`), `value` (`status`: all/confirmed/near/other; `sort`: rank/cost/rate/occurrences) | habits list controls |
| `inspectHabit` | `habitId` | open evidence inspector for a habit |
| `toggleExclude` | `unitId` | include/exclude one trade in the sensitivity check |
| `excludeWorst` / `resetExclusions` | — | sensitivity shortcuts |
| `setInspectSort` | `key` (day/netPnl/contribution) | toggles direction when repeated |
| `setTradeFilter` | `key` (q/from/to/underlying/type/outcome/habit), `value` | trade filters (resets page) |
| `resetTradeFilters` | — | |
| `setTradeSort` | `key` (open/netPnl/hold/lots) | toggles direction when repeated |
| `setTradePage` | `page` | |
| `selectTrade` | `id` (unit id) | opens trade detail (switches to Trades) |
| `closeTrade` | — | |
| `openGuardrail` | `habitId` | opens guardrail editor (`state.guardEdit`) |
| `setGuardParam` | `key`, `value` | edit draft param (validated live) |
| `saveGuardrail` / `closeGuardEdit` | — | |
| `setGuardStatus` | `habitId`, `status` (active/paused) | |
| `removeGuardrail` | `habitId` | |
| `setMapping` | `field`, `column` (index or '' for none) | import wizard |
| `validateImport`, `toggleExcludeDuplicates`, `backToMapping`, `confirmImport`, `cancelImport` | — | import wizard |
| `removeImport` | `id` | |
| `setScenario` | `id` | lab preset |
| `setLabParam` | `key`, `value` | lab control |
| `regenerateLab` | — | new seed |
| `setTheme` | `theme` | |
| `dismissNotice` | — | |

Effects (no state change): `downloadTemplate`, `downloadSample` (`id`), `downloadRejected`, `downloadLabCsv`, `importFile`.

## Selectors (store.js)

- `getDataset(state)` → `{ id, name, kind: 'sample'|'import', fills, style?, importSummary? }`
- `selectAnalysis(state, periodKey?)` → engine analysis for the period:
  `summary` (period, periodLabel, fills, units, excluded[], warnings[], tradingDays, netPnl, grossPnl, charges, floor, thin),
  `units[]` (id, kind single|strategy, type long-option|short-option|strategy, label, underlying, openTs, closeTs, day, time, month, holdMin, entryLots, grossPnl, netPnl, charges, chargesMissing, outcome, positions[] with fills[], avgEntry, avgExit, expiry, strike, optType, direction),
  `habits[H1..H5]` (name, short, status confirmed|overlap|insufficient|not-costly|not-seen, statusReason, rank, occurrences, opportunities, rate, cost, costing {model, baseline, comparisonMean, comparisonN, thin, contribs}, gates {n, days, loo, loo2, topShare, checks[{id,name,pass,value,threshold,reason}], failed, pass, confidence}, evidence[{unitId, day, time, label, detail, trigger, netPnl, grossPnl, contribution, maxLoss}], unitIds, overlap, overlapWith),
  `confirmed[]`, `nearMisses[]`, `checked[]`, `labels{unitId: [{habitId, role counted|overlap|flagged, habitStatus, detail, countedUnder}]}`,
  `stats` (trades, tradingDays, wins, losses, flat, winRate, netPnl, grossPnl, charges, chargesMissingFills, tradesMissingCharges, avgWin, avgLoss, largestWin, largestLoss, medianHoldMin, daily[{day, netPnl, trades, habitTrades}]) — nulls mean "cannot be computed",
  `quality` ({status good|attention|insufficient, items[{level, code, text}]}), `headlineCost`.
- `selectPeriods(state)` → `[{key, label, trades, firstDay, lastDay}]`; `selectPrevPeriod(state, key?)`, `selectNextPeriod(state, key?)`.
- `selectComparison(state, from?, to?)` → `{ from, to, fromLabel, toLabel, rows[{id, name, chances, before{n, opp, rate, cost, ci}, after{…}, absChange, relChange, p, strength, verdict, explanation}], a1, a2, same }`.
- `selectInspector(state)` → `{ analysis, habit, def, rows (sorted evidence), excluded[], sensitivity (re-gated habit or null; has wouldConfirm), worst }`.
- `selectTrades(state)` → `{ analysis, total, matched, page, pages, rows (units), netOfMatched, underlyings, types, days {first,last}, selected (unit|null), filtersActive }`; `tradeLabels(analysis, unitId)`.
- `selectGuardrails(state)` → `[{ habitId, template {title, params[], rule(p), measure(p), nubra {status documented|proposed, text, snippet?}}, habit, rule (saved {params, status, createdPeriod} or null), params, recommended, compliance {current, prev, next} (each {opportunities, violations, rate, compliance, measurable, note}), prevLabel, nextLabel }]`.
- `selectQuality(state)` → `{ status, items, source, importSummary }`.
- `selectNextAction(state)` → `{ kind, title, body, action: {type, …payload}, label }`.
- `selectLab(state)` → `{ scenario, scenarios, params, plan, planted, csv, validation, analysis, notes, manifest }`.
- Engine constants you may display: `CONFIG`, `HABITS` (name, short, definition, appliesTo, chances, chanceNote, comparison, costModel, cannotConclude[]), `HABIT_IDS`, `GUARDRAILS`, `measureGuardrail(analysis, habitId, params)`.

## Honesty rules (non-negotiable)

- Costs are "excess loss associated with" a behaviour **compared with the trader's usual trade**. Never "would have made / saved / earned", never "caused", never "you lost because". Never recommend buying or selling anything.
- Show missing values with `missing()` (an em dash with a tooltip), never as ₹0. A cost ≤ 0 means "no excess loss", not a negative cost.
- Label sample data as synthetic and imports as local to the browser. Nubra capabilities: "Documented in Nubra's public API docs" vs "Proposed (not a Nubra feature)". Never imply a live Nubra connection, live market data, or that anything is sent to a broker.
- Every figure must be traceable to the engine; prefer showing the arithmetic.

## Design rules

Premium, restrained analytics product. Use the shared components and tokens (CSS custom properties); no new colours, gradients, glows, emoji, or decorative charts. Tabular numbers for money (`.num`). Consistent spacing (`--sp-*`). Tables for record data, panels for sections, chips for status. Mobile first: everything must work at 360 px wide (wrap filter bars, allow tables to scroll horizontally inside `.table-wrap`). Accessible: real headings in order, labels for every control, `aria-*` where useful, colour never the only signal (use text in chips).

## Verify before finishing

```
node scripts/smoke.mjs <your-module>    # must print "0 problem(s)"
npm test                                 # existing tests must still pass
```
