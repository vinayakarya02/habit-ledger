export const meta = {
  name: 'habit-ledger-integrated-review',
  description: 'Five-lens adversarial review of the integrated Habit Ledger app, each finding independently verified',
  phases: [
    { title: 'Review', detail: '5 reviewers: numbers, interaction/state, honesty/copy, a11y+responsive (browser), product' },
    { title: 'Verify', detail: '2 independent skeptics per finding; kept only if both confirm' },
  ],
}

const APP = '<repo>/app'
const SCRATCH = '<scratch>/review2'

const CONTEXT = `
Habit Ledger is a post-trade behaviour review prototype for options traders (PM take-home for Nubra, an Indian broker). It turns a month of option order history into the 2–3 repeated behaviours associated with excess losses, with 4 evidence gates, costs measured against the trader's own usual trade, a traceable evidence inspector, guardrails with compliance measurement, month-over-month comparison (rates per chance, Fisher exact), CSV import, a scenario lab and a methodology page. Synthetic sample traders: Aarav (2 confirmed habits in Sep), Meera (2), Kabir (none, by design). It is static vanilla JS: src/engine.js (single source of truth), src/import.js, src/lab.js, src/store.js (reducer + selectors), src/main.js (DOM/events), src/views/*.js (pure render(state) modules), styles/*. Contract: src/views/CONTRACT.md. Tests: npm test (138 pass). Smoke: node scripts/smoke.mjs. Render-matrix helper: tests/helpers/render-matrix.mjs (stateMatrix(), loadModules(), renderPage(state, view, mods)).
Project root: ${APP} (Windows, Git Bash; quote paths). A local static server serves the app at http://localhost:5173/ (source, not dist).
Honesty rules: no "would have made/saved", no causal claims, no trade advice, missing ≠ zero, synthetic/imported clearly labelled, Nubra "documented in public API docs" vs "proposed (not a Nubra feature)".
You are REVIEWING ONLY: do not edit any project file. Write probes only under ${SCRATCH}/<your-lens>/.
Report only real, reproducible issues with concrete evidence (file:line, a node reproduction, or exact rendered text). No style nitpicks without user impact. Severity: critical = wrong number/claim, broken control, crash, data loss, privacy; major = misleading/confusing UI, missing requirement, inconsistent figures between modules, accessibility blocker; minor = polish.
`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short slug' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          file: { type: 'string', description: 'primary file to change (repo-relative, e.g. src/views/trades.js)' },
          title: { type: 'string' },
          evidence: { type: 'string', description: 'exact reproduction / rendered text / file:line' },
          fix: { type: 'string', description: 'concrete proposed fix' },
        },
        required: ['id', 'severity', 'file', 'title', 'evidence', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    severity: { type: 'string', enum: ['critical', 'major', 'minor', 'not-an-issue'] },
    reasoning: { type: 'string' },
  },
  required: ['real', 'severity', 'reasoning'],
}

const LENSES = [
  { key: 'numbers', prompt: `LENS: numerical correctness and cross-module consistency. For every sample trader and both periods, and for the edge datasets in stateMatrix() (edge/limit-cut, edge/overlap-h1, edge/overlap-h5, imports incl. thin and messy), render every view (renderPage) and extract the figures shown. Check that the SAME quantity is shown identically everywhere it appears (headline excess loss; each habit's occurrences, chances, rate, days, cost; net P&L; win rate; trade counts; guardrail compliance in Guardrails vs Compare; comparison rates/verdicts in Overview vs Compare; lab results). Independently recompute a sample of figures from raw fills with your own code (not by calling the same engine function), including baseline-excess costs, leave-one-out, Fisher p-values for the Compare page, Wilson intervals, compliance rates, daily P&L. Check missing values are dashes not ₹0, cost ≤ 0 never shown as a negative cost, rounding consistency (₹ figures that should add up do add up or are explained), and Indian number formatting.` },
  { key: 'interaction', prompt: `LENS: interaction, state and routing. Read src/main.js, src/store.js and every view. For every data-action rendered across stateMatrix(), confirm the payload keys match what the reducer handler reads (data-habit-id → habitId, data-param for form controls, data-value for segmented, etc.) by dispatching the exact payload derived from the rendered attributes through reduce() and checking the state actually changes as the label promises. Look for: dead or no-op controls, controls that change the wrong thing, stale content after selectDataset/selectPeriod/setCompare/import/removeImport, inspector exclusions leaking across habits or datasets, pagination beyond last page, filter combinations returning wrong rows, guardrail edit/save/pause/remove edge cases (invalid params, removing while editing), import wizard step transitions (cancel mid-way, re-import, duplicate toggling then back to mapping), lab param clamping, theme persistence, hash routing (#/inspect/H3 deep link, #method-* anchors, back/forward), focus handling logic in main.js render(), and keyboard Escape behaviour. You may also use the browser at http://localhost:5173/ (one tab only; close it when done) to confirm a suspected interaction bug, using javascript_tool to dispatch DOM events.` },
  { key: 'honesty', prompt: `LENS: honesty, claims and copy quality across ALL modules. Render every view across stateMatrix() and read the TEXT (strip tags). Flag: any causal or counterfactual-profit claim; any trade recommendation; any implication of live Nubra connection, live market data, real accounts or orders being placed; Nubra capability mislabelled (compare with GUARDRAILS[id].nubra and the documented/proposed wording); synthetic data not labelled; contradictions between modules (e.g. one page says a behaviour is a habit and another implies otherwise; different definitions of the same term); grammar errors, unpluralised counts ("1 trades"), placeholder/boilerplate/lorem/TODO text, jargon unexplained to a retail trader, overly long paragraphs that hide the point, inconsistent terminology (habit vs behaviour vs pattern; chances vs opportunities; excess loss vs cost) where it could confuse. Also check README.md at ${APP}/../README.md for claims that don't match the app.` },
  { key: 'a11y-responsive', prompt: `LENS: accessibility, responsive layout and visual design consistency, IN A REAL BROWSER. You are the only reviewer using the browser: open ONE tab at http://localhost:5173/ (mcp__Claude_Browser__* tools; load them via ToolSearch), and close it when done. For each of the 9 modules (Overview, Habits, Evidence inspector, Trades incl. the detail drawer, Guardrails incl. the editor dialog, Compare periods, Import CSV incl. mapping/review steps (use DataTransfer to set a file on the #import-file input and dispatch a change event; a messy CSV can be built from tests/helpers/render-matrix.mjs MESSY_CSV logic), Scenario lab, Methodology) check at widths 360, 768 and 1280 (resize_window) and in dark mode: horizontal overflow (document.documentElement.scrollWidth > clientWidth), clipped/overlapping text, unreadable contrast, controls too small to tap (< 32px), sticky elements covering content, drawer/dialog usability on mobile, focus visibility and logical tab order (use keyboard via computer key presses on a couple of flows), headings order, missing labels, colour as the only signal. Also judge visual consistency across modules (spacing, panel/chip/table usage, typography hierarchy) and anything that looks generic, broken or unfinished. Take screenshots as evidence where useful and describe what you saw precisely.` },
  { key: 'product', prompt: `LENS: senior fintech PM evaluating the product as a whole for a Nubra PM-intern submission. Use the app at http://localhost:5173/ only via reading the rendered HTML text from the render matrix (do NOT use the browser; another reviewer uses it). Walk the main journeys: (1) first visit → Overview for Aarav Sep → understand top habit → Inspect evidence → set guardrail → Compare Sep→Oct; (2) Kabir (clean trader) journey; (3) import a messy CSV → review → resulting overview; (4) scenario lab presets. Judge: does each screen answer its question quickly; are there dead ends, empty pages, confusing first-use, missing next steps, redundant modules, information overload, anything that reads like a generic dashboard rather than a behavioural review; is the core insight (evidence-gated, baseline-relative, rate-based tracking) obvious within 5 minutes; do the guardrail and compare flows make the feedback loop tangible. Report concrete, fixable issues (with exact screen + text) rather than vague opinions; prioritise what would most change an experienced evaluator's impression.` },
]

phase('Review')
const reviews = await parallel(LENSES.map((l) => () => agent(`${CONTEXT}\n${l.prompt}\nReturn at most 15 findings, most important first.`, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS })))

const all = []
reviews.forEach((r, i) => { for (const f of (r?.findings ?? [])) all.push({ ...f, lens: LENSES[i].key }) })
log(`${all.length} findings from ${reviews.filter(Boolean).length} reviewers; verifying each with 2 skeptics`)

phase('Verify')
const verified = await parallel(all.map((f) => () => parallel([0, 1].map((k) => () => agent(`${CONTEXT}
You are an independent skeptic. Try to REFUTE this reported issue; default to real=false if you cannot reproduce it or it is not actually a problem for users (or is intended behaviour documented in CONTRACT.md / Methodology). Reproduce it yourself from the source (node probe under ${SCRATCH}/verify-${k}/; do not use the browser unless the finding is browser-only and then use at most one tab and close it).
Finding (${f.lens}, claimed ${f.severity}): ${f.title}
File: ${f.file}
Evidence: ${f.evidence}
Proposed fix: ${f.fix}
Return real=true only if you reproduced it and it matters; give the severity you would assign.`, { label: `verify${k}:${f.id}`, phase: 'Verify', schema: VERDICT }))).then((vs) => ({ ...f, votes: vs.filter(Boolean) }))))

const confirmed = verified.filter((f) => f.votes.length === 2 && f.votes.every((v) => v.real))
const split = verified.filter((f) => f.votes.length === 2 && f.votes.filter((v) => v.real).length === 1)
log(`${confirmed.length} confirmed by both skeptics, ${split.length} split`)
return {
  confirmed: confirmed.map((f) => ({ id: f.id, lens: f.lens, severity: f.votes.map((v) => v.severity).sort()[0], file: f.file, title: f.title, evidence: f.evidence, fix: f.fix, reasoning: f.votes.map((v) => v.reasoning).join(' || ').slice(0, 1200) })),
  split: split.map((f) => ({ id: f.id, lens: f.lens, file: f.file, title: f.title, evidence: f.evidence.slice(0, 600), fix: f.fix, votes: f.votes.map((v) => `${v.real}/${v.severity}: ${v.reasoning.slice(0, 400)}`) })),
  rejected: verified.filter((f) => f.votes.every((v) => !v.real)).map((f) => `${f.lens}/${f.id}: ${f.title}`),
}
