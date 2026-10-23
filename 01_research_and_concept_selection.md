# Nubra PM Intern Take-Home: Research, Concepts, Selection (Phases 1–4)

Prepared 23 Oct 2026. Every claim below is labelled **[V]** verified from a public source (linked) or **[I]** my inference or hypothesis. I have no internal Nubra data, customer interviews, or usage metrics, and nothing here should read as if I did.

---

## 0. The assignment (from the PDF)

Pick one of four problems, build something people can click through, and explain the thinking. Four artifacts: a one-pager of 300–700 words, every prompt used (including failures), the evals and ship criteria, and a working link. Time budget is 4–6 hours, due in 2 days. The PDF says outright: *"We care about how you framed the problem, not how polished the build is"* and *"You will not be evaluated on your domain knowledge of markets."*

The exact wording of each problem matters:
- **01 Fundamental research:** an investor "cannot work through financial results and balance sheets…"
- **02 Position risk:** surface exposure, margin and expiry risk "a trader should act on, *without turning it into another dashboard*."
- **03 Post-trade review:** "Turn a month of order history into *the two or three habits that are costing them money*."
- **04 First F&O trade:** "Get them to an *informed order, not through a tutorial*."

---

## Phase 1: What Nubra publicly offers

### 1.1 Who Nubra is
- Nubra is run by Zanskar Securities Pvt Ltd. It covers NSE, BSE and MCX, with demat, F&O, IPO, MF and ETF. **[V]** [nubra.io](https://nubra.io/)
- The Play Store app is "Nubra: Stocks & Option Trading", package `com.zanskar.nubra`, rated 4.5★ from 569 reviews with 100K+ downloads (seen 23 Oct 2026). **[V]** [Play Store](https://play.google.com/store/apps/details?id=com.zanskar.nubra)
- The home page advertises a customisable brokerage of "₹5 per lot or ₹20 per order" and zero delivery brokerage. **[V]** [nubra.io](https://nubra.io/) The pricing page shows plan details only in an image, so I couldn't confirm the plan text there.
- Per-lot pricing, a multi-leg builder, Flexi strategy orders and API-first tooling point at **active options traders, especially multi-leg strategists and algo/API users**, more than first-time investors. Zanskar also describes itself as quant and market-making infrastructure. **[I]**, partly supported by third-party profiles ([village.ai](https://village.ai/company/nubra), [briter](https://www.briter.co/companies/zanskar-technology)).

### 1.2 Capability table

| Existing capability | Evidence and source | User problem addressed | Potential gap (inference) | Confidence |
|---|---|---|---|---|
| Advanced option chain, multi-leg strategy builder | Home and pricing pages **[V]** [nubra.io](https://nubra.io/) | Build and price multi-leg trades | The builder starts from strikes. A user who only has a view ("RELIANCE up 5% in a month") must already know which structure to pick. | High that it exists; payoff/Greeks UI details unverified |
| Real-time Greeks on positions | Blog promo box: "tracking positions with real-time Greeks" **[V]** [blogs](https://nubra.io/blogs); Greeks WebSocket in SDK 0.3.6 **[V]** [release notes](https://nubra.io/products/api/docs/python-sdk-v3/release-notes.html) | See position sensitivity live | Greeks are numbers, not decisions. Nothing public compares the current position to what the trader originally intended. | Medium–high |
| Strategy portfolio (positions grouped by strategy) | API page `strategy-portfolio` **[V]** [API docs](https://nubra.io/products/api/docs/index.html) | Track multi-leg trades as one unit | Unknown whether it flags a strategy whose shape has broken, e.g. a hedge leg closed | Medium (endpoint exists; behaviour unverified) |
| Flexi / strategy orders: entry triggers, price SL/target, trailing SL, `exitTime`, ENTRY/EXIT/ENTRY_AND_EXIT modes | Flexi order docs **[V]** [place-flexi-order](https://nubra.io/products/api/docs/python-sdk-v3/trading/orders/place-flexi-order.html) | Pre-commit to exits, automate discipline | The guardrails exist, but nothing tells a trader *which* guardrail they personally need. No strategy-level MTM stop is documented. | High |
| Smart price/indicator alerts, chart trading with SL/TP | Home page **[V]** | React to price moves | Alerts are price-based, not behaviour-based | High |
| Pre-trade margin estimate, including multi-leg | `get_margin()` returns `totalMargin` and charges **[V]** [get-margin](https://nubra.io/products/api/docs/python-sdk-v3/trading/orders/get-margin.html) | Know the capital needed before ordering | No public breakdown (SPAN/exposure/hedge benefit) and no forward-looking projection, e.g. margin on expiry day | High that it exists; breakdown absent from docs |
| Funds and margin fields (`netMarginAvailable`, `totalMarginBlocked`, `mtmDeriv`, …) | Funds docs **[V]** [funds](https://nubra.io/products/api/docs/python-sdk-v3/trading/portfolio/funds.html) | Current margin state | Shows current state only | High |
| Positions API (`netQuantity`, `avgPrice`, `pnl`, …) | Positions docs **[V]** [positions](https://nubra.io/products/api/docs/python-sdk-v3/trading/portfolio/positions.html) | Position P&L | Docs list no expiry, strike or Greeks fields per position | High |
| Reports: tradebook, P&L, contract notes, daily margin, **Trader diary** (XLSX download only), open positions | Reports docs **[V]** [reports](https://nubra.io/products/api/docs/python-sdk-v3/reports.html) | Record-keeping, tax, statements | They are records, not reviews. Nothing public turns order history into behavioural findings. Trader diary row fields are undocumented. | High that they exist; diary content unknown |
| Company fundamentals: P&L, balance sheet, cash flow, key ratios, shareholding, corporate actions | Fundamentals docs **[V]** [company-fundamentals](https://nubra.io/products/api/docs/python-sdk-v3/market-data/company-fundamentals.html); "research from technicals to fundamentals" on home page | Access to financial statements | Data access is solved. Interpretation for a specific investment question isn't (in public material). | High |
| Scanners, TradingView charts | Home page **[V]** | Idea discovery, technicals | — | High |
| Developer AI assistant, LLM-ready "Master Docs" | API docs page **[V]** | Writing algo code | Developer-facing only; no trader-facing AI is visible publicly | High |
| Education | Blogs only (PCR, strangles, OI spurts…) **[V]** [blogs](https://nubra.io/blogs) | Concepts | Generic articles, not tied to the user's own order | High |

### 1.3 Market and regulatory context (verified)
- **About 91% of individual equity-derivatives traders lost money in FY25.** Net losses rose 41% to about ₹1.05 lakh crore, roughly ₹1.1 lakh per trader. [Business Standard](https://www.business-standard.com/markets/news/net-losses-of-traders-in-fo-widens-in-fy25-sebi-study-125070701221_1.html), [Moneylife](https://moneylife.in/article/91-percentage-of-retail-traders-lost-money-in-derivatives-losses-in-fo-surged-41-percentage-to-rs105-lakh-crore-in-fy25-sebi-study/77613.html)
- A later SEBI study, as reported, found the share of loss-makers *rises with experience*: about 91% among first-year traders versus over 95% after four or more years. [Outlook Money](https://www.outlookmoney.com/invest/sebi-futures-options-study-retail-traders-trading-losses-experience) This is my most decision-relevant fact for Problem 3: experience alone doesn't teach. Feedback has to be engineered. **[I]**
- SEBI's late-2024 package includes a minimum index contract size of ₹15 lakh, an extra 2% ELM on short options on expiry day, upfront premium collection, and no calendar-spread margin benefit on expiry day. [Business Standard](https://www.business-standard.com/amp/markets/news/sebi-announces-six-key-changes-to-curb-speculation-in-derivatives-trading-124100101316_1.html), [Upstox community](https://community.upstox.com/t/an-explanation-of-recently-published-f-o-changes-by-sebi/6841) Some effective dates conflict across sources, so I'd check the NSE circular before citing one.

### 1.4 Competitor capabilities: where a clone adds nothing
- **Post-trade:** [Upstox Trading Insights](https://upstox.com/trading-insights) is free and accepts any broker's F&O P&L. It shows win rate, profit factor, performance by underlying, by days-to-expiry (incl. 0DTE), CE vs PE, risk-reward, "overtrading" via charges, and biggest losses. [Zerodha Console](https://zerodha.com/z-connect/console/tagging-on-console-trading-journal-tracking-goals) has tag-based journaling. [Dhan Trader's Diary](https://dhan.co/support/statements-and-ledger/trader-s-diary/what-is-a-trader-s-diary-and-how-does-it-work/) gives a visual P&L calendar. TradesViz, Tradezella and OneTradeJournal add analytics. **A "your stats bucketed by X" report is a clone.**
- **Position risk:** Sensibull's Positions Analysis on Kite does price/date what-if, max profit/loss, breakeven, POP and Greeks ([tradingqna](https://tradingqna.com/t/new-kite-feature-f-o-positions-analysis-tool-by-sensibull/106432)). **A Greeks-and-payoff panel is a clone.**
- **First F&O:** Dhan, Fyers, ICICI and AlgoTest builders show payoff and Greeks ([AlgoTest roundup](https://algotest.in/blog/best-strategy-builders-for-options-trading-in-india.md)). Sensibull-style view-to-strategy wizards are widely known. **"Pick bullish → we suggest a spread" is a clone.**
- **Fundamentals:** Screener and Tickertape-style ratio pages, plus generic LLM summarisers. **"AI summary of the annual report" is a clone.**

### 1.5 What each option implies for Nubra
| Option | Implication |
|---|---|
| 01 Fundamentals | Nubra has the data API, but its core users look like traders, not long-horizon investors. Weakest business fit. **[I]** |
| 02 Position risk | Closest to Nubra's core (multi-leg, Greeks, strategy portfolio), so the team has probably thought hardest here. That means the highest chance an intern idea is already on their roadmap, and the highest scrutiny of numerical errors. **[I]** |
| 03 Post-trade | Nubra already holds every input (tradebook, trader diary) and every *output lever* (Flexi SL/exitTime, strategy-level exits, alerts), but nothing publicly connects the two. Competitors do descriptive stats, not behaviour-to-guardrail loops. **[I]** |
| 04 First F&O | It's an acquisition and activation lever, but it's ethically delicate given 91% losses, and view-to-strategy tools already exist. **[I]** |

---

## Phase 2: Fourteen concepts

Format for each: **User · Moment · Workaround · Why it matters · Insight · Intervention · Vs Nubra · Validate/reject · 4–6h buildable? · Risks**

### Problem 01: Fundamental research

**C1. Thesis Checkpoints**
- **User:** a retail equity investor with a half-formed thesis ("margins will expand as input costs fall").
- **Moment:** just before buying, and again on each results day.
- **Workaround:** reads ratio pages and YouTube, never writes the thesis down.
- **Why it matters:** without a falsifiable thesis there's no exit rule, so they hold through a broken story.
- **Insight:** the scarce thing is a testable claim, not more data.
- **Intervention:** turn the thesis into 3–4 line-item checkpoints (gross margin, raw-material cost/sales, OCF/PAT). Mark each as supported, contradicted, or *not answerable from financials*. Re-check on next results.
- **Vs Nubra:** Nubra exposes the statements, not the interpretation.
- **Validate/reject:** do users write theses and come back on results day?
- **Buildable:** yes, with sample statements.
- **Risks:** needs an LLM to map a thesis to line items, which can hallucinate. Weak fit with a trader base.

**C2. Earnings-Quality Red-Flag Decoder**
- **User:** an investor who distrusts reported profit.
- **Moment:** screening.
- **Workaround:** Screener ratios.
- **Why it matters:** profit without cash is a classic trap.
- **Insight:** a handful of deterministic divergences (OCF vs PAT, receivables vs revenue growth) explain most red flags.
- **Intervention:** plain-language flags with the arithmetic shown.
- **Vs Nubra:** not public.
- **Validate/reject:** do flags change decisions?
- **Buildable:** yes.
- **Risks:** widely available elsewhere, so low originality.

**C3. Question-First Research**
- **User:** an investor with a specific worry ("Can this company survive two bad years?").
- **Moment:** pre-buy.
- **Workaround:** skims everything.
- **Why it matters:** information overload hides the 3 numbers that matter.
- **Insight:** the investor's question decides which metrics are relevant, and what financials *cannot* answer.
- **Intervention:** pick a question, see the 3–4 metrics that bear on it, and see the explicit unknowns.
- **Vs Nubra:** same as C1.
- **Validate/reject:** time to answer, and answer accuracy against an analyst key.
- **Buildable:** partly.
- **Risks:** fuzzy evals, heavy LLM dependence.

### Problem 02: Position risk

**C4. Expiry-Eve Margin Step Forecaster**
- **User:** a trader holding short options or calendar spreads into expiry.
- **Moment:** the evening before expiry.
- **Workaround:** finds out from a margin-shortfall call or penalty (the pricing page lists a 0.035%/day shortfall penalty **[V]**).
- **Why it matters:** expiry-day rules (+2% ELM on shorts, no calendar benefit) make margin jump *predictably*, not randomly.
- **Insight:** some risk is rule-driven and knowable a day early.
- **Intervention:** project tomorrow's margin versus `netMarginAvailable`, and list the cheapest actions that close the gap.
- **Vs Nubra:** `get_margin()` covers the current order only.
- **Validate/reject:** how often do shortfalls cluster on expiry day?
- **Buildable:** only with a simplified margin model.
- **Risks:** a wrong margin number destroys trust. An exact model needs SPAN files.

**C5. "Not the Trade You Placed": Intent-Drift Monitor**
- **User:** a multi-leg options trader.
- **Moment:** mid-session, after spot moves or after they adjust or partly exit legs.
- **Workaround:** stares at Greeks and P&L.
- **Why it matters:** an iron condor that has drifted to heavy delta is a directional bet the trader never chose.
- **Insight:** risk is the gap between the *current* position and the intent implied by the *entry order's shape* (neutral, defined-risk), not a threshold on a number.
- **Intervention:** infer intent from the entry structure, alert only when the position leaves that envelope, and offer "restore" or "accept new intent".
- **Vs Nubra:** Greeks and strategy portfolio exist; no intent comparison is public.
- **Validate/reject:** do traders act on drift alerts more than on raw Greek alerts?
- **Buildable:** yes, with Black-Scholes on simulated prices.
- **Risks:** fully simulated market data, and option-expert evaluators will scrutinise the Greeks.

**C6. Broken-Hedge Detector**
- **User:** a spread or condor trader.
- **Moment:** they close the cheap long "wing" to save a few rupees, or a multi-leg order fills partially (third-party reports call fills "not truly atomic" [multibagg](https://www.multibagg.ai/market-pulse/articles/optionx-nubra-multileg-execution-india-cmsda29uj00my0zoyrzav6hjl)).
- **Workaround:** none; they don't notice.
- **Why it matters:** defined risk silently becomes undefined risk.
- **Insight:** the most dangerous position change is one that *lowers* visible cost.
- **Intervention:** detect a short leg with no protecting leg, quantify the new worst-case loss against the old one, and offer "close both" or "re-buy wing".
- **Vs Nubra:** unverified whether strategy portfolio flags it.
- **Validate/reject:** how often do short legs outlive their hedges?
- **Buildable:** yes; it's deterministic.
- **Risks:** narrow, so it's a feature, not a product.

**C7. Three-Decision Risk Inbox**
- **User:** an active trader.
- **Moment:** intraday.
- **Workaround:** a dashboard.
- **Why it matters:** dashboards create attention load.
- **Insight:** rank risks by cost of inaction.
- **Intervention:** at most three cards, each with a single action.
- **Vs Nubra:** a UI pattern, not a capability.
- **Validate/reject:** time-to-action.
- **Buildable:** yes.
- **Risks:** generic. Every risk product claims it isn't a dashboard.

### Problem 03: Post-trade review

**C8. Rule-Break Ledger**
- **User:** a trader who has rules ("SL 30%, max 5 trades a day") but breaks them.
- **Moment:** month-end.
- **Workaround:** a mental tally, or guilt.
- **Why it matters:** the costliest losses come from breaking one's own rules.
- **Insight:** measure the gap between stated rules and behaviour, priced in ₹.
- **Intervention:** declare rules, then see each violation and its cost.
- **Vs Nubra:** none public.
- **Validate/reject:** do traders declare rules at all?
- **Buildable:** yes.
- **Risks:** cold start, since most users never write rules.

**C9. Tilt Sequence Detector**
- **User:** an intraday options buyer.
- **Moment:** after a loss.
- **Workaround:** none.
- **Why it matters:** revenge trades compound losses.
- **Insight:** the trigger is the previous trade's outcome, not the market.
- **Intervention:** flag trades opened within N minutes of a loss, and the size escalation after them.
- **Vs Nubra:** none public; journals partly cover it.
- **Validate/reject:** is the post-loss P&L worse than the baseline?
- **Buildable:** yes.
- **Risks:** fairly obvious idea.

**C10. Habit Ledger: priced, evidence-gated habits turned into guardrails**
- **User:** an active F&O trader on Nubra with 30–200 trades a month.
- **Moment:** month-end, or the first login of a new month.
- **Workaround:** a P&L statement or the Upstox-style buckets (descriptive), and usually nothing.
- **Why it matters:** loss rates *rise* with experience (SEBI study above), so passive experience doesn't correct behaviour.
- **Insight, in three parts:**
  1. A habit only "costs money" if you can price a counterfactual ("the month without these trades").
  2. One month is a *small sample*: one blow-up trade can fake a "pattern", so a credible review must refuse to overclaim.
  3. The point isn't a report. It's converting each habit into a guardrail Nubra *already* has (Flexi `stoplossParams`, `exitTime`, strategy-level exit) and checking next month whether it shrank.
- **Intervention:** load a tradebook, then:
  - run a deterministic habit library (revenge re-entry, averaging down on long options, hedge removal in spreads, size escalation after wins, trades beyond the Nth of the day, 0DTE long premium),
  - apply evidence gates (≥4 occurrences, ≥3 distinct days, still costly after removing the worst single trade),
  - show the top 2–3 by ₹, with the evidence trades,
  - make a one-tap "turn into guardrail",
  - put patterns that don't pass the gates in a separate "not enough evidence yet" list.
- **Vs Nubra:** Nubra has the tradebook, trader diary and guardrail primitives; nothing public links them. Vs Upstox: buckets versus priced, robust, actionable habits.
- **Validate/reject:**
  - planted-habit synthetic histories (precision/recall),
  - whether users enable the guardrail,
  - whether the habit's ₹ cost falls month over month.
- **Buildable:** yes; it's deterministic, with sample CSVs.
- **Risks:**
  - removal counterfactuals are associations, not causation;
  - overlapping habits need de-duplication;
  - synthetic demo data can look contrived.

**C11. Charges & Churn Tax**
- **User:** a scalper.
- **Moment:** month-end.
- **Workaround:** the contract note.
- **Why it matters:** fees eat edge.
- **Insight:** show charges as a % of gross profit.
- **Intervention:** a churn report.
- **Vs Nubra:** the P&L report has charges.
- **Validate/reject:** —
- **Buildable:** trivially.
- **Risks:** Upstox already does "overtrading". Low originality, and it sits awkwardly with a broker's revenue incentive.

### Problem 04: First F&O trade

**C12. Same View, Three Orders**
- **User:** an equity-only investor with a view ("RELIANCE up ~5% within a month; I'd risk ₹3,000").
- **Moment:** the first time they open the option chain.
- **Workaround:** buys a cheap far-OTM call.
- **Why it matters:** the classic first-trade failure is *being right on direction and still losing*, through time decay and breakeven distance.
- **Insight:** an equity investor's mental model has no clock. Compare instruments *for the same view* against the familiar baseline (buying the stock).
- **Intervention:**
  - take the view (direction, size of move, horizon, ₹ at risk),
  - show side by side: buy shares, buy call, bull call spread,
  - for each, show "what must happen for you to profit", "you're right but still lose if…", the lot-size notional, and the max loss,
  - stage the order.
- **Vs Nubra:** the builder starts from strikes, not from a view; the wizard pattern exists at competitors.
- **Validate/reject:** does a comprehension check pass before the order? What is the 30-day outcome?
- **Buildable:** yes.
- **Risks:**
  - an experienced PM may see it as a simplified builder;
  - ethical tension, so it must be willing to recommend "buy the stock".

**C13. Teach-Back Gate**
- **User:** a first-time options buyer.
- **Moment:** the order confirmation screen.
- **Workaround:** a risk disclosure checkbox.
- **Why it matters:** checkboxes don't create understanding.
- **Insight:** ask 3 questions about *their* order ("NIFTY is flat until Thursday. What is this worth?"). Teach only what they get wrong.
- **Intervention:** a personalised quiz generated from the order's payoff.
- **Vs Nubra:** none public.
- **Validate/reject:** comprehension pass rate, and whether it predicts outcomes.
- **Buildable:** yes.
- **Risks:** friction, so traders abandon or skip it.

**C14. Lot-Size Reality Check**
- **User:** an equity investor thinking in ₹ amounts.
- **Moment:** first order.
- **Workaround:** none.
- **Why it matters:** a ₹15 lakh contract size means large notional exposure.
- **Insight:** show notional against their capital.
- **Intervention:** a single meter.
- **Vs Nubra:** margin is shown, not notional.
- **Validate/reject:** —
- **Buildable:** trivially.
- **Risks:** a feature, not a product.

---

## Phase 3: Scoring

Each criterion is scored 1–10, then weighted: Originality 20%, Framing 20%, Value 15%, Feasibility 15%, Eval quality 15%, Nubra fit 10%, Clarity 5%. Score = Σ(sub/10 × weight).

| # | Concept | Orig | Frame | Value | Feas | Eval | Fit | Clar | **Score** |
|---|---|---|---|---|---|---|---|---|---|
| C10 | Habit Ledger | 7 | 8 | 8 | 8 | 9 | 7 | 8 | **78.5** |
| C5 | Intent-Drift Monitor | 8 | 8 | 7 | 6 | 7 | 9 | 6 | **74.0** |
| C12 | Same View, Three Orders | 6 | 8 | 8 | 8 | 8 | 6 | 8 | **74.0** |
| C6 | Broken-Hedge Detector | 6 | 7 | 7 | 8 | 8 | 8 | 8 | **72.5** |
| C4 | Expiry-Eve Margin Step | 8 | 8 | 7 | 5 | 6 | 8 | 7 | **70.5** |
| C13 | Teach-Back Gate | 7 | 7 | 7 | 7 | 7 | 5 | 6 | **67.5** |
| C8 | Rule-Break Ledger | 6 | 7 | 7 | 7 | 7 | 6 | 7 | **67.0** |
| C1 | Thesis Checkpoints | 8 | 7 | 6 | 7 | 5 | 5 | 7 | **65.5** |
| C9 | Tilt Sequence | 4 | 6 | 7 | 8 | 7 | 6 | 8 | **63.0** |
| C14 | Lot-Size Reality | 3 | 6 | 6 | 9 | 8 | 5 | 8 | **61.5** |
| C3 | Question-First Research | 6 | 6 | 6 | 6 | 4 | 5 | 6 | **56.0** |
| C11 | Charges & Churn | 2 | 5 | 6 | 9 | 7 | 5 | 8 | **56.0** |
| C7 | Three-Decision Inbox | 4 | 5 | 6 | 7 | 5 | 7 | 7 | **55.5** |
| C2 | Red-Flag Decoder | 3 | 5 | 6 | 8 | 7 | 4 | 7 | **55.0** |

Why the scores came out this way:
- **C10** wins on evaluation. Planted habits in synthetic histories give a real ground truth, with precision, recall and a "clean trader → no habits" null test. It's also feasible because it's deterministic. Its originality is capped at 7 because post-trade analytics is crowded.
- **C5** is the most original options-native idea. Its feasibility and eval scores drop because the market data must be simulated and Greeks errors are easy to make in front of options experts.
- **C12** has strong empathy and a clean demo, but a view-to-strategy wizard isn't new.
- **C4** is clever, but a credible expiry-day margin number needs exchange SPAN data. An approximation invites the exact error that kills trust.
- The **fundamentals** ideas are held back by Nubra fit and fuzzy evals.

### 3.1 Challenging the top three

| Challenge | C10 Habit Ledger | C5 Intent-Drift | C12 Same View, Three Orders |
|---|---|---|---|
| Could Nubra already have it? | Trader diary exists, but it's an XLSX record. No behavioural review is public. Possible but unverified internal work. | Real-time Greeks plus strategy portfolio are close neighbours. **Highest risk** that it's already on the roadmap. | The strategy builder exists. A view-first wizard is plausible on their roadmap. |
| Feature disguised as a product? | It's a loop (diagnose → guardrail → re-measure), not a screen, so it holds up. | Partly. It's an alert type inside the positions page. | Partly. It's an entry mode for the builder. |
| Is the pain sharp enough? | The pain is real but *latent*: users don't feel it until shown in ₹. A pull problem. | Sharp in the moment for multi-leg users, but that population is narrow. | Sharp at first trade, but it happens once per user. |
| Would an experienced PM find it obvious? | "Trade analytics", yes. Evidence gating, ₹ counterfactuals and the guardrail loop, much less so. | Not obvious; this is the most PM-impressive framing. | The equity-baseline comparison is mildly non-obvious; the rest is known. |
| Unavailable data/APIs? | No. The tradebook comes from reports, and the guardrail mapping uses documented Flexi params. | Needs live option prices and IV, so it's simulated in the prototype. | Needs option chain prices, so it's simulated. |
| Is AI genuinely useful? | **Not for the core.** Detection and ₹ are deterministic. AI could map arbitrary broker CSV formats or phrase cards; both must be validated. Saying so is a judgment signal. | No; it's maths. | It could parse free-text views. That's optional. |
| Obvious in a 5-minute demo? | Yes. Load a month, see 3 priced habits plus one "not enough evidence", tap "guardrail", replay next month. | Mostly. It needs a time slider plus explanation of Greeks. | Yes. |
| What makes the submission fail? | Looking like the Upstox buckets. Planted habits that look contrived. Overclaiming causation. | A wrong Greek or payoff number, or a "they already have this" reaction. | Seeming to encourage first-time F&O, or a "simplified builder" reaction. |

### 3.2 Revised ranking after critique
1. **C10 Habit Ledger, folding in C6's hedge-removal detection as one options-native habit.** It's the strongest on framing, evals and feasibility combined, and the hedge-removal habit ties it to Nubra's multi-leg users and away from Upstox's generic buckets.
2. **C5 Intent-Drift Monitor.** It's the most original, but it's the riskiest in front of options experts, needs fully simulated markets, and sits closest to what Nubra probably already builds.
3. **C12 Same View, Three Orders.** It has the clearest demo, but it's the most incremental relative to existing builders.

---

## Phase 4: Winner — Habit Ledger (Problem 03)

**One-line value proposition:** it shows the two or three repeatable behaviours that cost you the most money last month, priced in rupees and only when the evidence holds up, and turns each one into a guardrail you can switch on in Nubra.

**Why it beats the finalists:**
1. **The framing is the product.** The brief says "habits that are costing them money". Most submissions will answer with an AI summary of stats. This answer takes the words literally:
   - *costing* requires a priced counterfactual;
   - *habit* requires repetition, so evidence gates apply;
   - *them* means personal, actionable rules rather than generic tips.
2. **It's evaluable in a way the others aren't.** I can generate tradebooks with *known planted habits* and measure detection precision and recall, ₹ accuracy against hand calculation, and false positives on a clean trader. That directly answers "how you decided the output was good enough to ship".
3. **It closes a loop using verified Nubra primitives.** Each habit maps to a Flexi `stoplossParams`, `exitTime` or strategy-level exit (documented), or is clearly labelled as a *proposed* new guardrail (cool-off timer, daily trade cap). It's grounded, not invented.
4. **It's honest about uncertainty.** A "not enough evidence yet" list is a visible trust feature, and it's the opposite of AI apps that always find three insights.
5. **It's feasible and safe.** The core needs no live data, no credentials and no LLM, and nothing in it recommends a trade.

**Key risks I'm accepting, and how I'll handle them:**
- **Causation.** Label it "attributed cost" (the month without these trades), not "you would have earned".
- **Overlap.** Each trade is attributed to at most one habit in the ranking, with the overlap shown.
- **Contrived demo data.** Use three personas: a revenge trader, a hedge-remover, and a clean, disciplined trader (who should get *no* forced habits), and publish the generator rules.
- **Upstox comparison.** Name it in the one-pager and state the difference.

**Proposed build approach (to confirm before Phase 5–7):** a single React app on Lovable or Bolt (or built here and deployed to Vercel). It would have a deterministic TypeScript habit engine with a unit-test harness for the planted-habit evals, sample CSVs plus CSV upload, and no runtime LLM in v1.
