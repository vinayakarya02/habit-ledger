# Habit Ledger: Product Specification (as shipped, v2)

This spec refines the concept chosen in `01_research_and_concept_selection.md` and describes what ships at https://habit-ledger-xi.vercel.app. The core is unchanged from v1. The product finds repeated behaviours, checks the evidence, prices them honestly against the trader's own usual trade, turns each into a guardrail, and measures whether the behaviour changed. v2 turns the single-screen v1 into nine connected modules, and makes the engine stricter where v1 was loose.

---

## 1. Weaknesses addressed

### Carried over from v1 (still in force)

| # | Weakness | Fix |
|---|---|---|
| W1 | Deleting a habit's losing trades always "finds" a cost | **Excess cost versus the trader's own baseline:** `cost = −(Σ net P&L of habit trades − n × b)`, where `b = min(mean net P&L of comparable other trades, 0)`. It never counts profit the trader "could have made". |
| W2 | Triggers that use a trade's own outcome are circular | Triggers use decision-time information only. Outcomes enter only through cost. |
| W3 | Small samples, multiple behaviours tested, one blow-up trade | Four fixed gates: n ≥ 4, ≥ 3 days, material, and no single trade explains > 60% of the cost. Fewer than 20 trades in a period means nothing is confirmed. |
| W4 | Double counting across habits | Greedy de-duplication by standalone cost; each trade counts toward one habit; later habits are re-gated without shared trades. |
| W5 | "Trade" undefined | Fills → positions (flat → flat per symbol + strategy ID) → trades (a position, or all legs sharing a strategy ID). |
| W6 | Guardrails implying non-existent Nubra features | Each guardrail is labelled either "Documented Nubra order control" (from the public API docs) or "Proposed capability". |
| W8 | A disciplined trader being flagged anyway | A first-class "no habit passed the evidence bar" result, with near misses and their reasons. |
| W10 | Hedge removal can't be priced from fills naively | Loss beyond the spread's defined maximum loss at entry (downside only, disclosed). |

### New in v2

| # | v1 weakness | Fix |
|---|---|---|
| W11 | Month verdicts used a crude rule ("cost fell 50%", min 3 chances) that rewarded small samples | Verdicts are rate-based: occurrences ÷ chances, ≥ 8 chances in each period, ≥ 50% relative fall (or ≥ 25% rise), and a one-sided **Fisher exact** chance below 1 in 5. Cost is shown but never decides, because excess cost is relative to the trader's other trades, which also move. Charts show 90% Wilson intervals. |
| W12 | A blank charge silently became ₹0; blank price became ₹0 in some paths | A missing charge stays **missing** (net P&L excludes it and is flagged; shown as "—"). A missing or invalid price, quantity or charge is **rejected with a reason**, never coerced to zero. |
| W13 | CSV upload required an exact header | Header aliases ("Trade Price", "Buy/Sell", "Tag" …), a column-mapping step, preview, row-level reasons, duplicate-ID rejection, possible-duplicate flags (kept by default because partial fills can be identical; excludable), timestamps without a timezone read as IST and disclosed. |
| W14 | Numbers were visible but not explorable | Evidence inspector: qualifying trades, baseline, arithmetic, leave-one-out, and a **sensitivity check** (exclude trades → re-gate) using the same engine function. |
| W15 | One month at a time, hard-coded to the sample months | Data is analysed per **review period** (calendar month of the trade's open date, IST). Any two periods can be compared. Imports can span several months. |
| W16 | Guardrails were a toggle with no measurement | Editable parameters (cool-off minutes, drop %, lot cap, daily limit), validation, active/paused/removed states, and **compliance measured from fills** with the same detectors run on the rule's own parameters. A period counts as "after the rule" only if its trades were placed after the rule's current settings were saved; months already in the file are labelled **what-ifs**. |
| W18 | Found by the integrated review: re-entry occurrences and chances were different units (two trades opened after one loss could give a rate above 100%) | A chance is now a **trade opened after a losing trade**, and an occurrence is one of those opened within 15 min, so the rate can never exceed 100%. Wilson and Fisher reject impossible inputs. |
| W19 | Found by the integrated review: each import became a separate trader, so "import next month" could not work | A file can be **added to an existing imported trader**: orders are merged, ids already present are skipped, and guardrails and comparisons carry over. |
| W20 | Found by the integrated review: suggestive changes were shown with the same "Improving" chip as clear ones | Verdict chips read **"Possibly improving / worsening"** when the chance is between 1 in 20 and 1 in 5. Behaviours that were not a confirmed habit in either period are shown as context only. |
| W17 | "Dead button" and stale-state risk in a hand-wired UI | Views are pure functions of state; every control declares a reducer action; a render matrix checks ~70 states for unknown actions, duplicate IDs and leaked `NaN`/`undefined`. |

---

## 2. Scope

**In:**
- Nine modules:
  - Overview
  - Habits
  - Evidence inspector
  - Trades
  - Guardrails
  - Compare periods
  - Import CSV
  - Scenario lab
  - Methodology
- Three synthetic sample traders, each with two months (Sep and Oct 2026).
- Imports that stay in the browser tab.
- Light and dark themes, a responsive layout from desktop to 360 px, and keyboard access.

**Out:**
- Live Nubra connection, credentials or order placement.
- Live or historical market data, so no "what if you'd held" counterfactuals.
- Mapping Nubra's own tradebook format (its row fields aren't public).
- Equity, futures and tax.
- Per-user thresholds (to avoid fishing for patterns).
- Any LLM at runtime.
- Accounts, server storage or analytics.

---

## 3. Data model

```
Fill      { id, ts (IST ISO), underlying, symbol, optType CE|PE, strike, expiry|null, side BUY|SELL,
            qty (units), price (₹/unit), charges (₹)|null, strategyId|null }
Position  fills of one symbol (+ strategyId) from flat to flat
          { id, direction long|short, openTs, closeTs, holdMin, avgEntry, avgExit, entryLots, maxQty,
            grossPnl, charges (recorded), chargesMissing (count), netPnl, fills[] }
Trade     a single position, or all positions sharing a strategyId
          { id, kind single|strategy, type long-option|short-option|strategy, label, underlying, day,
            month (review period), openTs, closeTs, holdMin, entryLots, grossPnl, netPnl, outcome win|loss|flat }
```

- Positions still open at the end of the data, or that flip direction within one order, are excluded and reported.
- Lot sizes are illustrative (NIFTY 75, BANKNIFTY 35). Unknown underlyings are counted 1 unit = 1 lot, with a warning.

---

## 4. Behaviours (detectors)

| ID | Behaviour | Trigger (decision-time only) | Chances (denominator) | Cost model |
|---|---|---|---|---|
| H1 | Re-entering right after a loss | Trade opens ≤ 15 min after the most recent closed trade, which lost money | Trades opened after a losing trade | Baseline-excess vs all other trades |
| H2 | Adding to a losing option buy | Another buy of a held long option at ≤ 80% of the first price, before any sale | Single-leg option buys | Baseline-excess vs other option buys |
| H3 | Removing the hedge, keeping the short | Protective long leg closed > 5 min before the short leg it protects | Hedged spreads | Loss beyond defined max loss at entry |
| H4 | Sizing up after a winning streak | Entry size ≥ 1.5 × median entry size, right after two winning trades | Trades after two wins | Baseline-excess vs all other trades |
| H5 | Trading past your 5th trade of the day | 6th or later trade opened that day | All trades | Baseline-excess vs all other trades |

---

## 5. Evidence gates and classification

| Gate | Rule |
|---|---|
| G1 Repeated | ≥ 4 occurrences |
| G2 Spread out | ≥ 3 different days |
| G3 Material | cost ≥ max(₹1,000, 5% of the period's gross losses) |
| G4 Not one trade | without the costliest occurrence, cost ≥ ₹1,000 and ≥ 40% of the total |

A behaviour gets one of five statuses:
- **Confirmed habit:** passes all four gates, survives de-duplication, and the period has ≥ 20 trades.
- **Overlaps a confirmed habit:** fails after its shared trades are removed.
- **Not enough evidence:** fails a gate, with the plain-language reason.
- **Seen, no excess loss:** the trades did no worse than usual.
- **Not seen.**

Confidence is **Strong** with ≥ 8 occurrences that stay material without the two costliest. Otherwise it's **Moderate**. The headline is the sum of confirmed habits' costs after de-duplication, phrased as "associated with ₹X of excess loss compared with your usual trade".

---

## 6. Period comparison

For each behaviour, the rate is occurrences ÷ chances in each period. The verdicts are:

| Verdict | Condition |
|---|---|
| **Not applicable** | No chances in either period |
| **Inconclusive** | Fewer than 8 chances in either period |
| **Improving** | Rate fell ≥ 50% relative **and** one-sided Fisher exact p < 0.2. The chip reads "Improving" when p < 0.05 and **"Possibly improving"** when 0.05 ≤ p < 0.2. |
| **Worsening** | Rate rose ≥ 25% relative (or from zero) **and** p < 0.2. The chip reads "Possibly worsening" when 0.05 ≤ p < 0.2. |
| **No clear change** | Otherwise |

The explanation states the chance in words (e.g. "about 1 in 18").

On the sample data:
- **Aarav:** re-entry after a loss went from 9/30 to 2/24 → Improving (p = 0.049). Adding to a loser went from 5/52 to 5/51 → No clear change.
- **Meera:** hedge removal went from 5/61 to 1/61 → Possibly improving (p = 0.10). Trading past the 5th trade stayed at 8/61 → No clear change.
- **Kabir:** behaviours that were never a confirmed habit (e.g. re-entry 4/23 → 0/15, "Possibly improving", p = 0.12) appear under "Other behaviours" as context only.

---

## 7. Guardrails

| Behaviour | Rule (editable) | Nubra capability | Compliance measured as |
|---|---|---|---|
| H1 | Cool-off of N minutes after a losing trade (5–120, default 15) | Proposed | Share of trades opened after a losing trade that came within N minutes |
| H2 | No adding to an option once it is X% below the first buy (5–60, default 20) | Proposed. Related: stop-loss exits are documented in the public API docs, but fills can't show whether one was attached, and a stop doesn't block a second buy. | Share of option buys with an add ≥ X% below the first price |
| H3 | Exit spreads as one unit | Documented: strategy order `executionMode: "EXIT"` | Share of hedged spreads with the hedge closed > 5 min early |
| H4 | Lot cap of N lots (default ceil(1.25 × median)) | Proposed | Share of trades opened above N lots |
| H5 | Daily limit of N trades (1–30, default 5) | Proposed | Share of trades after the Nth of the day |

Rules are stored in the browser only (sample traders), or in memory only (imports). Nothing is sent to any broker. Each rule records the review period and time its settings were chosen. Guardrails and Compare call a month "after" only if its trades came later; otherwise compliance is labelled a what-if, measured on trades that already existed.

---

## 8. Sample traders (synthetic, seeded)

The sample traders trade only on NSE trading days. 14 Sep, 2 Oct and 20 Oct 2026 are holidays, and an expiry falling on a holiday moves to the previous trading day.

| Trader | September 2026 | October 2026 |
|---|---|---|
| **Aarav** (option buyer) | Re-entry after a loss ×9 of 30 chances on 7 days → **Strong**, ₹57,897. Adding to a loser ×5 → **Moderate**, ₹43,703. Size-up ×3 → not enough evidence. | Re-entry ×2 of 24. Adding to a loser ×5. |
| **Meera** (spread seller) | Hedge removal ×5 → **Moderate**, ₹30,908. Past 5th trade ×8 on 4 days → **Strong**, ₹11,729. | Hedge removal ×1. Past 5th trade ×8. |
| **Kabir** (disciplined) | **No habits.** Traps: 4 re-entries where one blow-up explains everything (fails G4); 1 add (fails G1); 5 extra trades on 2 days (fails G2). | No habits. |

---

## 9. Modules (screen by screen)

1. **Overview:** what happened (defined statistics with definitions, daily P&L with habit-day markers); data-quality status; confirmed habits ranked by excess loss; near misses; change since the previous period; one deterministic next action.
2. **Habits:** all five behaviours with status, classification reason, occurrences per chance, days, gates, cost and short evidence; filter by status and sort.
3. **Evidence inspector:**
   - per habit: qualifying trades with "why it qualified", sortable;
   - the baseline and its cap;
   - the full calculation;
   - leave-one-out;
   - a sensitivity check (exclude trades → re-gated result);
   - gates;
   - what can't be concluded;
   - an "Act on this" panel to set or edit the guardrail.
4. **Trades:** search; filters for date range, underlying, type, outcome and behaviour label; sort and paging. A detail drawer shows legs (average entry and exit), fills, charges (missing shown as "—") and behaviour labels with links to the evidence. A "Left out of the review" list names positions with no closing order.
5. **Guardrails:** recommended rules first; documented vs proposed capability; editable parameters with validation; active, paused or removed; compliance in this, previous and next period.
6. **Compare periods:** any two periods; rates with 90% intervals; absolute and relative change; sample sizes; verdict with explanation; guardrail compliance in both periods.
7. **Import CSV:** choose file → map columns (aliases, sample values) → review → import.
   - The review step shows accepted, rejected and warning rows, possible duplicates, positions that will be left out, rejected-row reasons and a download.
   - A file can be imported as a new trader or **added to an existing imported trader**; ids already present are skipped and guardrails carry over.
   - Imports are separate from the sample traders and can be removed.
8. **Scenario lab:** five presets (normal, repeated, borderline, disciplined, missing data) plus sliders for re-entries, gap, loss size, blow-up, adds, busy days and missing prices or charges. Results show what was planted against what the fixed rules concluded. "Open this month in the importer" sends the simulated file through the real import wizard.
9. **Methodology:** every rule, threshold, formula, baseline, comparison test, edge case and limitation; how sample data is generated; what the tests do and don't establish.

---

## 10. Success and guardrail metrics (for a real launch; not measured here)

- **Primary:** the share of reviewed traders whose top confirmed habit's **rate** falls ≥ 50% the next month (Improving verdict), compared against traders who saw the review but set no guardrail.
- **Guardrails:**
  - disputed-habit rate (traders saying "that's not me");
  - share of zero-habit reviews (near 0% means the gates are too loose);
  - guardrail removal within 7 days;
  - **no rise in order count after a review** (the product must not drive activity).
