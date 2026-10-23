# Habit Ledger: app

A static web app (vanilla ES modules, no dependencies). See the repository README for the product overview.

```bash
npm test          # 151 automated evaluations (node:test)
npm run smoke     # render every view across ~90 states and check for problems
npm run build     # assemble dist/ (stamped with the git commit, security headers)
npm run serve     # serve the source at http://127.0.0.1:5173
node scripts/serve.mjs dist 5173   # serve the production bundle
```

| Path | Contents |
|---|---|
| `src/engine.js` | Behaviour engine: the single source of truth for every derived number |
| `src/import.js` | CSV reading, column mapping and validation |
| `src/lab.js` | Scenario-lab generator |
| `src/data.js` | Seeded sample traders |
| `src/store.js` | Reducer and selectors |
| `src/main.js` | DOM events, rendering, focus, routing and effects |
| `src/ui/` | Shared components and charts |
| `src/views/` | One pure `render(state)` module per product module (contract in `src/views/CONTRACT.md`) |
| `styles/` | Design tokens, base layout, components and per-view layout |
| `tests/` | Test suites; `tests/helpers/` holds the render matrix and fixtures; `tests/last-run.txt` is the latest run |
