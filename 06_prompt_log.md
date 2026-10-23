# Prompt Log (chronological, as-is)

**Tool:** Claude Code (desktop app), a single session on 23 Oct 2026. Model: Claude Opus 5.5.

**What counts as a prompt:**
- Entries 1, 2, 4, 5, 6 and 7 are my prompts or answers, pasted verbatim.
- Entry 3 is the build spec Claude wrote and then executed in the same session. It was not pasted into Lovable, Bolt or Replit.
- Entries 8, 9 and 10 are the three multi-agent workflows Claude Code ran during the v2 upgrade. Their complete prompt scripts are in [`prompts/`](prompts/), with only local paths replaced.
- Section B lists what didn't work.
- Section C lists proposed prompts that were **not** used.

**Agents and AI tools:**
- **v1** (entries 1–4) used no subagents and no external AI tools.
- **v2** (entries 5–9) used Claude Code subagents, but only through the two workflows in `prompts/`.
- No other AI tool (Lovable, Bolt, Replit, ChatGPT) was used at any point.

---

## A. Prompts used

### 1. Research → concept selection (used)

Attached: `Nubra Product Intern Assignment (4).pdf`

> Role
> Act as a combination of:
>
> * A top-tier fintech Product Director who has shipped trading products
> * A startup founder who identifies non-obvious product opportunities
> * A skeptical product interviewer evaluating Product Management Intern candidates
> * A UX researcher, systems thinker, and AI product architect
> * A product engineer who can turn a validated concept into a working prototype
>
> Your goal is to help me create an outstanding submission for Nubra's Product Management Intern take-home assignment. Do not jump straight into building an app.
> Context
> Company: Nubra, operated by Zanskar Securities.
> Official website: https://nubra.io/
> Product/API documentation: https://nubra.io/products/api/docs/index.html
> Assignment: I have attached the original two-page PDF titled "Nubra Product Management Intern Assignment."
> The assignment asks me to select ONE of four problems:
>
> 1. Stock Fundamental Research Assistant
> 2. Position Risk Assistant
> 3. Post-trade Review
> 4. First F&O Trade
>
> Required deliverables:
>
> 1. A 300–700-word product one-pager explaining the problem, why Nubra should solve it, solution space, scope, and out of scope.
> 2. Every prompt used to build the product, including unsuccessful prompts.
> 3. Evaluation cases and the criteria used to decide whether the output was good enough.
> 4. A working application link, built using Lovable, Bolt, Replit, or another suitable tool.
>
> Time budget: 4–6 hours.
> Deadline: Within two days.
> The assignment explicitly says domain knowledge is not required and that problem framing matters more than visual polish.
> My Objective
> I do NOT want a generic assignment solution.
> I want a submission that demonstrates unusually strong product judgment, original thinking, customer empathy, technical feasibility, measurable evaluation, and a clear understanding of how a trading product works.
> Assume the evaluators are experienced product builders. They may already know the obvious solutions and may have already built features resembling them.
> Do not assume we know Nubra's internal roadmap. Verify public information and label unverified capabilities as hypotheses.
> Phase 1: Research Nubra
> Research its public website, product pages, help documentation, app listings, API documentation, release notes, and other credible public sources.
> Determine:
>
> * What Nubra already offers
> * Which user types it serves
> * The problems its current features appear designed to solve
> * What its existing capabilities imply for each of the four assignment options
> * Where an incremental clone would add little value
> * What genuine unmet needs may remain
>
> Create a table with:
> Existing capability | Evidence and source | User problem addressed | Potential gap | Confidence level.
> Cite sources and distinguish verified facts from inference.
> Do not invent internal features, customer interviews, usage data, business metrics, or product gaps.
> Phase 2: Find the Non-Obvious Opportunity
> Generate at least 12 genuinely different product concepts across all four assignment choices.
> Do not merely rename dashboards, add an AI chatbot, summarize data, or generate generic alerts.
> Explore ideas involving:
>
> * Decision quality rather than information quantity
> * User intent versus actual behavior
> * Context-aware workflows
> * Explainability and trust
> * Behavioral patterns and repeated mistakes
> * Scenario rehearsal and counterfactuals
> * Risk communication and comprehension
> * Missing information and uncertainty
> * Workflow friction and time-sensitive decisions
> * Evaluation and feedback loops
>
> These are exploration directions, not requirements. Do not force every idea into them.
> For every concept, explain:
>
> 1. The precise target user
> 2. The specific moment the problem occurs
> 3. The user's current workaround
> 4. Why the problem matters
> 5. The core insight
> 6. The product intervention
> 7. How it differs from known Nubra features
> 8. What evidence would validate or reject the idea
> 9. Whether a credible prototype can be built in 4–6 hours
> 10. The main risks and limitations
>
> Phase 3: Think Like a Skeptical Evaluator
> Compare all four assignment options. Do not automatically choose Position Risk Assistant just because it sounds technically difficult.
> Evaluate concepts on:
>
> * Originality and differentiation: 20%
> * Strength of problem framing: 20%
> * Demonstrable user value: 15%
> * Feasibility within the time limit: 15%
> * Quality of measurable evaluation: 15%
> * Fit with Nubra's business and product: 10%
> * Clarity and usability: 5%
>
> Score each concept out of 100 and explain the scores.
> Then challenge the top three ideas:
>
> * Could Nubra already have this?
> * Is this just a feature disguised as a product?
> * Is the user problem sufficiently painful?
> * Would an experienced PM find this obvious?
> * Does the idea depend on unavailable data or APIs?
> * Is AI genuinely useful, or would deterministic logic be better?
> * Can a five-minute demonstration make the value immediately obvious?
> * What would cause the submission to fail?
>
> Revise the ranking after this critique.
> Phase 4: Choose One Winning Concept
> Select ONE concept only.
> The winner should combine:
>
> * A non-obvious, defensible insight
> * A narrowly defined but meaningful user problem
> * A strong fit with the assignment
> * A product experience that can be demonstrated end to end
> * Clear evaluation criteria
> * A feasible implementation without privileged company access
>
> Do not overbuild. A small, original, well-tested product is preferable to a large collection of generic features.
> Explain why the winner is stronger than the other finalists.
> Phase 5: Define the Product
> Produce:
>
> 1. Product name and one-sentence value proposition
> 2. Target user and specific use case
> 3. Current workflow and its failure point
> 4. Core hypothesis
> 5. Primary user journey
> 6. Key screen-by-screen experience
> 7. MVP scope and explicit exclusions
> 8. Differentiation from Nubra's verified public capabilities
> 9. Success metric and guardrail metrics
> 10. Three assumptions that must be validated
> 11. A realistic demo scenario
> 12. A five-minute demo script
>
> Prioritize user decisions and outcomes over the number of features.
> Phase 6: Design Rigorous Evaluations
> Create at least 12 test cases covering:
>
> * Normal scenarios
> * High-risk edge cases
> * Incorrect or missing inputs
> * Contradictory user intent
> * False positives and unnecessary alerts
> * False negatives and missed risks
> * Numerical correctness
> * Explainability
> * User comprehension
> * Uncertainty and limitations
>
> For each case provide:
> Input, expected behavior, pass/fail criteria, severity, and what the test reveals.
> Where numerical calculations are involved, use deterministic calculations and independently check the expected answers.
> Where AI is used, identify which parts require structured outputs, validation, and fallback behavior.
> Never claim that the product is safe or accurate merely because the demo works. Define the limits of what the evaluation establishes.
> Phase 7: Implementation Plan
> Recommend the fastest suitable way to build the product, choosing between Lovable, Bolt, Replit, or another practical tool.
> Design a polished, credible, interactive prototype with:
>
> * A clear first-use experience
> * Realistic sample data
> * At least one complete end-to-end workflow
> * Functional controls, not decorative buttons
> * Useful empty, loading, error, and edge states where appropriate
> * Transparent labels for simulated data
> * No fabricated live market access
> * No requirement for Nubra credentials or private APIs
>
> Prefer deterministic calculations for financial metrics. Use AI only when it contributes a genuine capability.
> Give me:
>
> 1. The proposed architecture
> 2. The data model and sample data
> 3. The complete app-building prompt
> 4. Follow-up prompts to fix likely implementation failures
> 5. A manual QA checklist
> 6. Deployment and access-verification steps
>
> Do not claim to have built or deployed anything unless it actually has been done.
> Phase 8: Final Submission
> Produce the final four deliverables required by Nubra:
> A. A polished 300–700-word one-pager, ready to submit.
> B. A chronological prompt log, including unsuccessful prompts and actual outcomes. Clearly distinguish prompts that have genuinely been used from prompts merely proposed for future use.
> C. An evaluation document with test cases, pass criteria, actual results where tests have been run, and unresolved limitations. Never fabricate test results.
> D. A working app link only after the app has actually been deployed and access has been verified. If deployment is not possible, explain exactly what remains to be done.
> Working Rules
>
> * Research first, ideate second, select third, build last.
> * Be critical, concrete, and evidence-driven.
> * Avoid generic startup jargon and feature lists.
> * Do not optimize for visual polish at the expense of product insight.
> * Do not claim novelty without comparing against public product capabilities.
> * Do not fabricate customer evidence, company strategy, metrics, or evaluation results.
> * Do not give personalized investment recommendations or encourage risky trading behavior.
> * Make assumptions explicit.
> * Stay within the assignment's 4–6-hour build budget.
> * If information is missing, make reasonable reversible assumptions rather than blocking the entire process.
> * Present your findings in stages, starting with research, the 12 concepts, the scoring matrix, and the winning recommendation. Do not begin implementation until the concept has been selected and its rationale is clear.
>
> Start by examining the attached assignment and researching Nubra's public product. Then execute the phases in order.

**Actual outcome:**
- Claude read the PDF and researched nubra.io, the API docs, the Play Store listing, SEBI studies and competitors (Upstox Trading Insights, Sensibull, Dhan, Zerodha Console).
- It produced `01_research_and_concept_selection.md`: a capability table with sources, 14 concepts, a weighted score matrix, a critique of the top 3, and a winner (Habit Ledger, 78.5/100).
- It stopped before building, as instructed.
- Key finding: Upstox already offers descriptive post-trade buckets, so a generic review would be a clone.

### 2. Refine and build (used)

> We have already completed the research, evaluated 14 concepts, compared competitors, and selected Habit Ledger as the winning concept for Nubra's Product Management Intern assignment.
> I do NOT want to restart the research, brainstorm new products, or select another concept.
> Our final direction is Habit Ledger: a product that identifies repeated trading behaviors associated with losses, validates them using evidence, estimates their financial impact honestly, maps them to relevant guardrails, and measures behavioral change over time.
> Your task now is to refine this existing concept only where necessary and move toward execution.
>
> 1. Identify the most important weaknesses in the current Habit Ledger proposal.
> 2. Make targeted improvements without changing the core concept.
> 3. Define the final MVP that can be built within the assignment's 4–6-hour time budget.
> 4. Design the complete user journey and screens.
> 5. Define the deterministic behavior-detection logic, financial calculations, and evidence thresholds.
> 6. Create realistic synthetic trade histories, including a trader with repeated harmful behaviors and a disciplined trader who should receive no unsupported warnings.
> 7. Write the complete app-building prompt for Claude Code, Lovable, Bolt, or the most suitable available tool.
> 8. Define at least 12 evaluation cases with expected outputs and pass/fail criteria.
> 9. Prepare the 300–700-word submission one-pager.
> 10. Maintain an honest chronological prompt log and document actual evaluation results without fabricating them.
>
> The product must stand out through evidence-backed insights, honest uncertainty, behavior-specific guardrails, and a measurable feedback loop—not through generic AI features or unnecessary complexity.
> Do not repeat the research or reopen product selection. Do not build a different product. Refine Habit Ledger, then help me implement and test it.
> Start by presenting the final refined MVP and its screen-by-screen flow. Then provide the exact implementation prompt and proceed with building the product.

**Actual outcome:**
- `02_refined_mvp.md`: 10 weaknesses and their fixes, detectors, gates and screens.
- `03_implementation_prompt.md` (entry 3).
- `app/`: engine, synthetic data, UI and 19 evals.
- `04_one_pager.md`, `05_evaluation.md`, and this log.

### 3. Build spec (written by Claude, executed by Claude in the same session)

The full text is in `03_implementation_prompt.md`.

**Actual outcome:**
- The first engine run matched planted ground truth for all detectors.
- Two generator fixes were needed: a fill after market hours, and spread prices above the spread's width.
- The month-over-month verdict rule was revised (see §B).
- The UI worked on first load, with no console errors.

---

### 4. Deploy (used)

> Yes, deploy Nubra/app to Vercel as a public static site, verify it loads logged-out, and add the link to the one-pager and prompt log.

**Actual outcome:**
- Only the 5 static files (`index.html`, `styles.css`, `app.js`, `engine.js`, `data.js`) were deployed to Vercel production via the CLI. Tests and `package.json` were left out.
- **Live at https://habit-ledger-xi.vercel.app**
- Verified on 23 Oct 2026:
  - Requests with no cookies or credentials return HTTP 200 for the page and all 4 assets.
  - In a browser, all three persona flows plus the October check-in matched the local results (Aarav ₹1,01,600 headline, Meera ₹42,636, Kabir no habits; verdicts Improving / No clear change).
  - No console errors.

---

### 5. v2 upgrade: "Transform Habit Ledger into a Standout Fintech Product" (used)

> Mission: Transform Habit Ledger into a Standout Fintech Product
> You are now acting as a senior product designer, staff frontend engineer, fintech product manager, QA engineer, and deployment engineer.
> We have already researched Nubra, evaluated 14 product concepts, selected Problem 03 (Post-trade Review), built Habit Ledger, run automated tests, and deployed an initial prototype.
> Do not restart research or replace the core product concept. Upgrade the existing product substantially.
> Current deployed app:
> https://habit-ledger-xi.vercel.app
> Current project: `habit-ledger`
> The existing codebase, tests, evaluation documents, one-pager, and prompt log are the starting point. Inspect the actual files before making changes. Do not assume the current deployment and local source are identical without checking.
> 1. Product vision
> Habit Ledger should become a sophisticated, interactive behavioral intelligence product for active options traders.
> The original problem is:
> "Most retail traders never review their own trades. Turn a month of order history into the two or three habits that are costing them money."
> Our product helps traders:
>
> * Understand repeated behavioral patterns in their trade history.
> * Inspect the actual trades supporting every finding.
> * Understand the limitations of financial attribution.
> * Choose appropriate personal guardrails.
> * Track whether their behavior changes over time.
> * Learn from previous decisions without receiving generic trading advice.
>
> The product must remain focused on post-trade review. Do not turn it into a generic brokerage dashboard, an AI chatbot, or a live trading terminal.
> 2. First: audit the existing implementation
> Before changing anything:
>
> 1. Inspect the complete project structure.
> 2. Identify the current UI, data model, rules engine, calculations, tests, and deployment configuration.
> 3. Run the existing automated test suite.
> 4. Record the current behavior and any failing tests.
> 5. Inspect the live deployment and compare it with the local source.
> 6. Preserve all existing working features and the original assignment requirements.
>
> Do not delete the existing implementation and rebuild a generic template.
> Create a short implementation plan, then execute it. Do not stop after producing the plan.
> 3. Upgrade the product experience
> Design a polished, cohesive, production-quality prototype.
> Visual direction:
>
> * Premium fintech analytics product.
> * Restrained dark/light theme support.
> * Clear information hierarchy and excellent typography.
> * Consistent spacing, grid, cards, tables, charts, and interaction patterns.
> * Responsive desktop, tablet, and mobile layouts.
> * Subtle animations only where they improve understanding.
> * Clear typography for financial figures and percentage changes.
> * Accessible contrast, keyboard navigation, and meaningful focus states.
>
> Avoid:
>
> * Generic AI-generated dashboard aesthetics.
> * Excessive gradients, glowing borders, decorative charts, and unnecessary cards.
> * Fake live-market tickers.
> * Arbitrary financial numbers.
> * Buttons that do nothing.
> * Empty pages disguised as features.
> * Unsupported claims about profitability or prediction accuracy.
>
> Use a coherent visual design system rather than styling every screen independently.
> 4. Build these product modules
> Prioritize the features that strengthen the core behavioral-review loop. Implement them as working interactions, not static mockups.
> A. Overview and monthly review
> Create an overview that answers:
>
> * What happened during this review period?
> * Which behaviors have sufficient evidence?
> * Which behaviors deserve attention first?
> * What changed compared with the previous period?
> * What action can the trader take next?
>
> Include:
>
> * Review-period selector.
> * Total trades analyzed and data-quality status.
> * Realized P&L and relevant trade statistics where supported by the data.
> * Confirmed habits and near misses.
> * Behavior-change indicators.
> * A clear next action.
>
> Every metric must have a defined calculation and appropriate context. Do not add a metric merely because it looks good in a card.
> B. Habit intelligence
> Provide detailed analysis of patterns such as:
>
> * Re-entering shortly after a loss.
> * Adding to losing long-option positions.
> * Removing a protective hedge.
> * Increasing position size after wins.
> * Trading beyond a self-defined daily limit.
>
> For each finding, show:
>
> * A clear name and explanation.
> * Occurrence count and relevant denominator.
> * Supporting dates and trades.
> * Evidence threshold results.
> * Financial impact calculation and assumptions.
> * Whether the pattern is confirmed, a near miss, or insufficiently supported.
> * The reason for the classification.
>
> Allow the user to filter, sort, and inspect the evidence.
> Do not force every trader to have a confirmed habit.
> C. Trade explorer
> Add a functional trade-history explorer with:
>
> * Search and filters.
> * Date range.
> * Instrument and trade type where available.
> * Realized P&L.
> * Entry and exit information where available.
> * Associated behavior labels.
> * A detail view for each selected trade.
>
> Use the actual data model. Clearly distinguish missing values from zero.
> Do not invent execution details or imply access to real Nubra accounts.
> D. Evidence and calculation inspector
> This should be one of the strongest differentiators.
> For each habit, let users inspect:
>
> * The exact trades included.
> * Why each trade qualified.
> * The relevant comparison baseline.
> * How the financial estimate was calculated.
> * What happens when the worst trade is removed.
> * Which evidence thresholds passed or failed.
> * What cannot be concluded from the data.
>
> Every displayed number must be traceable to the underlying data and calculation.
> Do not present associated losses as guaranteed savings or proven causal effects.
> E. Personal guardrail center
> Create a workflow for turning a sufficiently supported behavior into a proposed intervention.
> Examples:
>
> * A cooldown after a loss.
> * A self-defined daily trade limit.
> * A warning when a protective hedge is removed.
> * A position-size discipline rule.
>
> Each intervention should include:
>
> * The behavior it addresses.
> * Why it is relevant.
> * The proposed rule.
> * Its current status.
> * How compliance will be measured.
> * A way to edit, disable, or remove it.
>
> Distinguish publicly documented Nubra order controls from proposed new capabilities.
> The prototype must never place real trades or modify an actual brokerage account.
> F. Month-over-month behavior tracking
> Build an interactive comparison between two review periods.
> Track relevant behavioral rates rather than relying only on raw counts.
> For example:
>
> * Re-entries following losing trades divided by eligible losing trades.
> * Hedge-removal incidents divided by relevant spread opportunities.
> * Rule violations divided by opportunities to follow the rule.
>
> Show:
>
> * Previous and current values.
> * Absolute and relative changes where meaningful.
> * Sample sizes.
> * Whether the change is improving, worsening, or inconclusive.
> * An explanation of the verdict.
>
> A reduction in trading volume alone must not automatically count as improvement.
> Use comparable periods and avoid making strong claims when the sample is insufficient.
> G. Data import and data quality
> Make CSV upload a real, robust feature.
> Include:
>
> * A sample file download.
> * Column mapping or clear schema requirements.
> * Preview before import.
> * Validation errors with actionable explanations.
> * Missing-field and duplicate detection.
> * A summary of accepted and rejected rows.
> * A clear distinction between imported data and sample personas.
>
> Never silently convert invalid financial values to zero.
> Do not send uploaded trade data to an external AI service.
> H. Interactive scenario lab
> Add a scenario lab that lets users explore how a behavior rule would classify a synthetic trade history.
> Users should be able to change relevant inputs and see the results update.
> Include:
>
> * A normal scenario.
> * A repeated-behavior scenario.
> * A borderline-evidence scenario.
> * A clean, disciplined trader.
> * A missing-data scenario.
>
> Clearly label this as a simulation. Do not present the results as market forecasts or real trading recommendations.
> I. Product methodology and transparency
> Create a dedicated explanation page documenting:
>
> * The behavior-detection rules.
> * The evidence thresholds.
> * Financial calculations.
> * Baseline selection.
> * Limitations.
> * Known edge cases.
> * How sample data is generated.
> * What the evaluation tests do and do not establish.
>
> Users should be able to understand why the product reached a conclusion.
> 5. Engineering requirements
> Keep the existing working stack unless there is a compelling technical reason to change it.
> Requirements:
>
> * Separate UI components from the behavior engine.
> * Use deterministic calculations for financial values.
> * Maintain a single source of truth for derived metrics.
> * Add input validation and sensible error handling.
> * Keep behavior definitions explicit and testable.
> * Ensure overlapping habits do not inflate aggregate totals.
> * Preserve the minimum-data and insufficient-evidence rules.
> * Use stable formatting for INR, percentages, dates, and missing values.
> * Avoid hardcoded results in UI components.
> * Ensure all interactive controls work.
> * Prevent stale state after changing personas, filters, or imported files.
> * Keep the application usable on small screens.
>
> Do not add an LLM just to claim the product uses AI.
> If a calculation cannot be made reliably from the available data, display an explicit limitation rather than fabricating a result.
> 6. Improve the evaluation suite
> Preserve the existing 19 automated tests and expand or revise them where necessary.
> Add tests for:
>
> * Each major behavior rule.
> * Threshold boundaries.
> * Zero and negative values.
> * Missing data.
> * Duplicate trades.
> * Overlapping behavior labels.
> * Financial attribution.
> * Period comparisons.
> * Sample-size limitations.
> * CSV import failures.
> * Clean trader histories.
> * UI interactions and state resets.
>
> Use known expected results and independently verify important financial calculations.
> Run the full suite after the changes. Fix regressions rather than weakening the tests.
> Report the actual results, including any unresolved failures.
> Do not claim that synthetic tests establish real-world effectiveness.
> 7. GitHub: push the code to my repository
> Inspect the existing Git configuration and identify the repository currently associated with this project.
> If a GitHub repository is already configured, verify that it is the intended destination.
> If no repository is configured, ask me for the GitHub repository URL before pushing. Do not create a different repository without my approval.
> Before pushing:
>
> * Inspect the files being committed.
> * Exclude `.env` files, API keys, tokens, private data, build artifacts, and unnecessary dependencies.
> * Add or update `.gitignore`.
> * Include the application source, tests, package manifest, README, and necessary configuration.
> * Include setup instructions and the commands to run the tests.
> * Document the product architecture and limitations.
> * Ensure no secrets appear in the source or Git history.
>
> Use clear, honest commit messages describing the actual work performed. Do not fabricate historical commits, fake development activity, or falsely attribute work to someone else.
> Do not overwrite unrelated repository contents or force-push without approval.
> If GitHub authentication is unavailable, explain the exact step I need to complete. Never ask me to paste a private token into chat.
> 8. Remove generic scaffolding and improve originality
> Inspect the application for:
>
> * Default starter-template branding.
> * Placeholder text.
> * Generic boilerplate copy.
> * Unused components and dependencies.
> * Dead links and buttons.
> * Unexplained sample values.
> * Contradictory metrics.
> * Inconsistent design.
> * Console warnings and errors.
>
> Replace generic scaffolding with product-specific language, coherent design, meaningful interactions, and accurate explanations.
> Do not insert fabricated claims about who built the app, fake testimonials, fake users, fake usage metrics, or misleading authorship information. The code and documentation should be professional, understandable, and accurately represent what the product does.
> 9. Deploy the final version
> The current deployment is:
> https://habit-ledger-xi.vercel.app
> Preserve this URL if the existing Vercel project can be updated safely.
> Deployment requirements:
>
> 1. Run all automated tests.
> 2. Run a production build.
> 3. Check the main user journey.
> 4. Verify mobile layout.
> 5. Check the browser console.
> 6. Deploy the updated version.
> 7. Confirm the public URL works without a Vercel login.
> 8. Test all major modules on the live deployment.
> 9. Verify that the deployed application corresponds to the latest source commit.
>
> Do not expose private information or make uploaded user data publicly accessible.
> If deployment requires a new credential or explicit approval, pause and ask me. Do not invent a successful deployment.
> 10. Submission documents
> Update the existing submission documents to match the actual final implementation:
>
> * `02_refined_mvp.md`
> * `03_implementation_prompt.md`
> * `04_one_pager.md`
> * `05_evaluation.md`
> * `06_prompt_log.md`
>
> Preserve the original assignment requirements.
> The one-pager must remain within 300–700 words.
> The prompt log must distinguish prompts actually executed from prompts merely proposed.
> The evaluation document must report actual test results and unresolved limitations.
> The product description must match the shipped app. Do not claim features that were not implemented.
> 11. Final acceptance checklist
> Do not declare the task complete until you have checked:
>
> * Existing functionality preserved.
> * Multiple meaningful product modules implemented.
> * Major controls and workflows actually work.
> * Financial figures are traceable and consistent.
> * Evidence and uncertainty are clearly communicated.
> * CSV import handles invalid data.
> * Desktop and mobile experiences work.
> * Existing and new tests pass.
> * Production build succeeds.
> * Code is pushed to the intended GitHub repository.
> * No secrets or private data are committed.
> * Public deployment works without login.
> * Live behavior matches the source.
> * Submission documents match the actual product.
>
> Execution instructions
> Start by inspecting the current repository, tests, and deployment configuration.
> Then implement the improvements in logical stages, testing as you go. Do not merely return a plan, design description, or code snippets. Carry out the work using the tools and permissions available in the current environment.
> If access or credentials are missing, tell me exactly what is needed and continue with everything else that can be completed safely.
> At the end, provide:
>
> 1. A summary of meaningful product improvements.
> 2. The GitHub repository URL and latest commit hash.
> 3. The public deployment URL.
> 4. The test results.
> 5. The updated submission document locations.
> 6. Any remaining limitations or actions required from me.
>
> The objective is to make Habit Ledger feel like a thoughtfully designed fintech product with a defensible product insight—not a generic dashboard—while keeping the original assignment focused and credible.

**Actual outcome:**
- **Audit:** 19/19 tests passed, and the live site was byte-identical to the local source. No git repository existed. The Vercel project `habit-ledger` existed with no Git connection.
- **Build:** Claude Code wrote the foundation directly (see `03_implementation_prompt.md` §2.2), then ran workflows 8 and 9.

### 6. Repository check (my reply, used)

Claude reported that no GitHub repository existed and that only the Vercel project had been created earlier. I replied:

> bro that is created by you just before this prompt check there

**Actual outcome:** Claude checked the deploy folder's `.vercel/project.json`, the Vercel project via API, and the newest repositories on my GitHub account. What it had created earlier was the **Vercel project**, which had no Git connection. No GitHub repository existed for this project, so it asked before creating one.

### 7. Repository choice (my answer, used)

Claude asked: "No GitHub repo exists for this project. Where should I push the code?" I chose:

> Create public repo (Recommended)

**Actual outcome:** Approval to create `github.com/vinayakarya02/habit-ledger` as a public repository.

### 8. Module build workflow (executed by Claude Code)

**Prompt script:** [`prompts/module-build-workflow.js`](prompts/module-build-workflow.js), verbatim apart from local paths.

It ran ten parallel pipelines (nine product modules and one test author), each with three stages: build, then independent adversarial review, then fix. That is 30 agents.

**Actual outcome:**
- All 30 agents completed, and every module reported 0 smoke problems.
- The test author added 103 tests and found 6 real bugs, recorded as `todo` tests. All six were fixed afterwards in shared files and are now hard tests (see B9).
- About 25 shared-file change requests came back and were applied by Claude Code during integration.

### 9. Integrated review workflow (executed by Claude Code)

**Prompt script:** [`prompts/integrated-review-workflow.js`](prompts/integrated-review-workflow.js).

Five reviewers each took one lens: numbers, interaction and state, honesty and copy, accessibility and responsive design (in a browser), and the product as a whole. Each finding was checked by two independent skeptics.

**Actual outcome:**
- 66 findings were reported and 57 were confirmed by both skeptics (1 critical, 24 major, 32 minor); 4 were split and 5 rejected (137 agents).
- Claude Code fixed the engine, store, `main.js`, data and design-system findings directly, with a regression test for each (R01–R13).
- Details are in `05_evaluation.md` §4.

### 10. View-fix workflow (executed by Claude Code)

**Prompt script:** [`prompts/view-fix-workflow.js`](prompts/view-fix-workflow.js).

Nine agents (one per view file) each applied that module's confirmed findings using the new shared APIs. An independent verifier per module then checked every item against rendered text, and a second fix pass ran where the verifier found regressions (23 agents in total).

**Actual outcome:**
- 9 / 9 modules were verified as resolved.
- 4 verifiers found small regressions introduced by the fixes, and the second pass fixed them.
- Final result: 151 / 151 tests and 810 smoke renders with 0 problems.

## B. What didn't work (actual)

| # | What was tried | What happened | What changed |
|---|---|---|---|
| B1 | Reading the PDF with the built-in page renderer | Failed: `pdftoppm` isn't installed | Extracted the text with Python `pypdf` instead |
| B2 | Searching for Nubra's Play Store listing and reviews | Search results didn't include it | Fetched the Play Store page directly: rating 4.5, 100K+ downloads. Reviews and the full description weren't retrievable. |
| B3 | Original cost idea: "the month without these trades" | Found biased while refining: deleting any losing subset always looks costly | Switched to excess cost versus the trader's own baseline, capped at ₹0 |
| B4 | Original verdict rule: "Worse" if rate *or* cost rose 25% | Building October data showed fixing one habit inflates another's cost | "Worse" now keys on rate only |
| B5 | Eval E17 (banned-phrase scan) | Failed: matched our own disclaimer | Narrowed the regex to causal claims |
| B6 | Eval E16 (overlap) | Failed: fixture bug (mismatched symbols) | Fixed the fixture; engine unchanged |
| B7 | Starting the local preview | Launched an unrelated server from another project's config | Added a dedicated `habit-ledger` config |
| B8 | Manual QA: 1-trade upload | Showed "No habit passed", a misleading all-clear | Added an engine-enforced "Too few trades" state (E19) |
| B9 | v2 engine and importer as first written | The workflow's test author found 6 real bugs:<br>• `parseAmount` read a decimal comma "112,50" as 11,250<br>• timestamps with seconds ≥ 60 became NaN<br>• the import notice double-subtracted excluded rows<br>• `initialState(null)` crashed<br>• the p ≥ 0.5 explanation was ungrammatical<br>• a habit cut by the 3-habit limit was mislabelled "overlap" | All six fixed in shared files. Their `todo` markers were removed, so they are now hard tests. |
| B10 | v1 period verdict ("Improving" when the cost fell 50%, at least 3 chances) | Too lenient on small samples, and cost moves with the baseline | Replaced with a rate-based verdict: at least 8 chances in each period and a one-sided Fisher exact p < 0.2. E15's two expected labels were renamed ("Worse" → "Worsening", "Too little activity to judge" → "Inconclusive"); the cases were not weakened. |
| B11 | Guardrail editor with typed number inputs | Inside the dialog, re-rendering moved the caret, so "305" was typed as "503" | The module uses select menus for parameters. `main.js` now also restores the caret in overlays. |
| B12 | Smoke runs while agents edited files in parallel | A half-written `guardrails.js` overlay briefly broke other modules' smoke runs | The smoke harness now loads each view module on its own and reports a broken module separately. |
| B13 | Starting the module workflow | The first test run failed: E17 still read the deleted v1 `app.js` | E17 now scans every file under `src/`, which is a wider scan than before, not a weaker one |
| B14 | Excluding NSE holidays from the sample calendar | The lab's maximum of 22 trading days crashed: September 2026 has only 21 | Lab capped at 21 days; two tests updated with the reason |
| B15 | Browser QA: dragging a lab slider | My first drag missed the slider: the screenshot frame (800 px) was scaled from a 1024 px viewport | Retried at the corrected coordinates. The drag works (18 → 5); no code change was needed. |
| B16 | Shell heredocs for patch scripts | Bash failed on some scripts containing Unicode or quotes | Wrote the patch scripts to files and ran them from there |

---

## C. Proposed but NOT used

These are listed for transparency. None of them were run.
- **Lovable port:** "Recreate this app in Lovable from `03_implementation_prompt.md`, keeping engine.js unchanged." Not needed, because the app was built directly.
- **Real-tradebook adapter:** "Map Nubra's tradebook XLSX columns to the canonical schema." Blocked: the row schema isn't public.
