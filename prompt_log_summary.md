# Prompt Log

These are my prompts in order, written in shortened form. Prompts 1–3 and 6–10 come from two longer messages, broken into their steps. The full text is in [`06_prompt_log.md`](https://github.com/vinayakarya02/habit-ledger/blob/main/06_prompt_log.md).

**Prompt 1**

Research Nubra's public product before we build anything. Go through its website, product pages, Play Store listing, API documentation and release notes. Tell me what it already offers, which kinds of traders it serves, and what problems its current features seem designed to solve. Also tell me where an incremental copy of an existing feature would add little value, and where real unmet needs might remain. Keep verified facts separate from inference, cite sources, and don't invent internal features, customer interviews or metrics.

**Prompt 2**

For each of the four problem statements, explain the problems traders face today and where Nubra could improve. Then suggest product ideas for them, saying who each is for, when the problem happens and how it differs from what Nubra already has, and score them.

**Prompt 3**

Could Nubra already have it? Is it just a feature dressed up as a product? Is AI really needed, or would plain logic work better? Then give me your recommendation.

**Prompt 4**

We are creating a product called Habit Ledger. It is a post-trade review for active options traders: it takes a month of their orders and finds the two or three repeated behaviours that are costing them money. It should only call something a habit when the evidence holds up, show the exact trades behind every finding, and estimate the cost honestly against the trader's own usual trade. Each habit should map to a personal guardrail, and the next month should show whether the behaviour actually changed. Keep all detection and calculations deterministic. Create sample traders, including a disciplined one who should get no warnings. Then build it and test it.

**Prompt 5**

Deploy the app to Vercel as a public site and check it opens without logging in.

**Prompt 6**

Now turn Habit Ledger into a complete product without changing the core idea. Check the current app first so nothing that works gets lost. Then add an overview page that answers what happened this month, which habits have enough evidence, what changed since last month, and what the trader should do next. Also add a habits section that shows how often each behaviour happened out of its chances, the trades behind it, and why it was or wasn't classed as a habit.

**Prompt 7**

Add a trade list with search, filters and a detail view for every trade, showing missing values as missing, never as zero. Then add an evidence page for each habit with the exact trades, the comparison baseline, how the cost was calculated, and what happens without the worst trade.

**Prompt 8**

Add a guardrails section that turns a habit into a personal rule, like a cool-off after a loss or a daily trade limit, and mark which rules Nubra already supports. Then add a month comparison that uses rates instead of raw counts, so trading less doesn't count as improving.

**Prompt 9**

Add CSV import with column mapping, a preview and clear errors, and never turn bad values into zero. Add a scenario lab clearly labelled as a simulation, and a methodology page that explains every rule.

**Prompt 10**

Add tests for the edge cases and fix anything that breaks. Then redeploy to the same link and check that the live app matches the code.
