# Habit Ledger: a post-trade review that only names habits it can defend

**Problem 03 · Post-trade review** · App: https://habit-ledger-xi.vercel.app · Code: https://github.com/vinayakarya02/habit-ledger

## My take on the problem

"Turn a month of order history into the two or three habits that are costing them money" contains three tests that most post-trade tools fail:

- **"Costing"** needs a counterfactual. About 91% of individual F&O traders lost money in FY25 (SEBI, July 2025), so nearly every bucket of their trades loses. Subtracting losing trades always "finds" a cost. The honest question is how much *worse* these trades did than the trader's usual trade.
- **"Habits"** means repetition. A month is 30–200 trades, and one blow-up can impersonate a pattern. A credible review must be willing to say "not enough evidence".
- **"Them"** means a personal rule the trader can act on, not generic tips.

A later SEBI study found loss rates *rise* with experience. Experience alone doesn't correct behaviour, so the review must close a loop.

## Why Nubra should solve it

Nubra holds both ends of that loop: the tradebook and P&L reports in its public API, and Flexi and strategy orders with stop-losses and whole-strategy exits. Nothing public connects a trader's history to *which* lever they need. Competing reviews (e.g. Upstox Trading Insights' expiry and call/put buckets) describe where money went. They don't test whether a behaviour is real, price it, or turn it into a rule. Nubra's multi-leg users also show a habit generic tools miss: closing the hedge and keeping the naked short.

## Solution space

I compared descriptive dashboards, AI-written journals, rule-break ledgers (cold start), market-price replays (need intraday data, invite hindsight), and **evidence-gated habit detection with a guardrail loop**. Only the last is personal, falsifiable and actionable from a tradebook alone.

## What I built

Five behaviours are checked, using only what the trader knew when deciding:
- re-entering within 15 minutes of a loss;
- adding to a losing option buy;
- removing a spread's hedge;
- sizing up after two wins;
- trading past the 5th trade of a day.

**Cost** is the excess loss versus the trader's own usual trade, capped so it never counts forgone profit. A behaviour becomes a **habit** only if:
- it occurs at least 4 times on at least 3 days;
- it is material;
- it still matters without its single worst trade;
- the period has 20 or more trades.

A disciplined trader gets **zero** warnings.

Nine connected modules make that reviewable:
- an **Overview** with one next action;
- **Habits**, with the reason for each classification;
- an **Evidence inspector** showing the trades, baseline, arithmetic, leave-one-out, and a re-gate when you exclude trades;
- a **Trade explorer**, where missing values show as "—", never ₹0;
- **Guardrails**, each labelled as a documented Nubra order control or a proposed capability, with compliance measured from fills;
- **Compare periods**, using rates per chance and an exact test, so trading less never counts as improving;
- **CSV import** with column mapping, validation and duplicate checks; data stays in the browser;
- a **Scenario lab**;
- a **Methodology** page.

140+ automated tests check planted behaviours against ground truth, recompute costs independently, test threshold boundaries and false-positive traps, and render every view across ~90 states. Bugs found by adversarial review became tests.

## In scope

- Closed option trades (single- and multi-leg) from CSV or synthetic sample traders, reviewed month by month.
- No AI at runtime, by design: deterministic maths keeps every number auditable.

## Out of scope

- Live Nubra connection, credentials or order placement.
- Nubra's own tradebook format, whose fields aren't public.
- Market-price counterfactuals.
- Equity, futures and tax.
- Per-user thresholds, which would invite fishing for patterns.
- Any trade recommendation.

## What would prove me wrong

- Traders don't adopt guardrails.
- Guarded habits' rates fall no more than unguarded ones'.
- Traders dispute the evidence.

A launch would track all three, plus the share of zero-habit reviews (near 0% means the gates are loose) and order counts after review, which must not rise.
