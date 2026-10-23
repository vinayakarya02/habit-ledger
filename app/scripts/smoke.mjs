// Usage: node scripts/smoke.mjs [view ...]
// Renders the given views (default: all) across the state matrix and prints any problems.
import { runMatrix } from '../tests/helpers/render-matrix.mjs';

const views = process.argv.slice(2);
const { renders, failures, warnings } = await runMatrix(views.length ? views : undefined);
for (const w of warnings) console.log(`WARN ${w}`);
const grouped = new Map();
for (const f of failures) {
  const k = `${f.view}: ${f.problem}`;
  grouped.set(k, [...(grouped.get(k) ?? []), f.state]);
}
for (const [k, states] of grouped) console.log(`FAIL ${k}\n     in ${states.length} state(s): ${states.slice(0, 6).join(', ')}${states.length > 6 ? ', …' : ''}`);
console.log(`${renders} renders, ${failures.length} problem(s)`);
process.exit(failures.length ? 1 : 0);
