// Period-comparison evals: one-sided Fisher exact test, Wilson intervals and the verdict rules.
// Reference values are computed independently (exact BigInt hypergeometric sums, closed-form Wilson bounds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fisherOneSided, wilson, compareHabit, comparePeriods, analyze, CONFIG, HABIT_IDS } from '../src/engine.js';
import { PERSONAS } from '../src/data.js';

const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

// Exact binomial coefficient.
function choose(n, k) {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1n; i <= BigInt(k); i++) r = (r * (BigInt(n) - BigInt(k) + i)) / i;
  return r;
}
// Reference one-sided Fisher p for [[a, b], [c, d]]: X ~ Hypergeometric(N = n, K = a + c, draws = a + b).
function fisherRef(a, b, c, d, direction) {
  const r1 = a + b, c1 = a + c, n = a + b + c + d;
  let num = 0n;
  for (let x = Math.max(0, c1 - (n - r1)); x <= Math.min(r1, c1); x++) {
    if (direction === 'decrease' ? x >= a : x <= a) num += choose(c1, x) * choose(n - c1, r1 - x);
  }
  return Number(num) / Number(choose(n, r1));
}

// A minimal "analysis" carrying only what compareHabit reads.
const period = (occurrences, opportunities, cost = 1000) => ({ standalone: { H1: { occurrences, opportunities, cost } } });
const cmp = (before, after) => compareHabit(period(...before), period(...after), 'H1');

// ---------- Fisher exact ----------

test('Fisher: lady tasting tea [[3,1],[1,3]] one-sided = 17/70; the other tail = 69/70', () => {
  // P(X ≥ 3) = [C(4,3)·C(4,1) + C(4,4)·C(4,0)] / C(8,4) = (16 + 1) / 70.
  near(fisherOneSided(3, 1, 1, 3, 'decrease'), 17 / 70);
  near(fisherOneSided(3, 1, 1, 3, 'decrease'), 0.242857, 1e-6);
  // P(X ≤ 3) = 1 − P(X = 4) = 1 − 1/70.
  near(fisherOneSided(3, 1, 1, 3, 'increase'), 69 / 70);
});

test('Fisher: hand-computed hypergeometric cases', () => {
  // [[2,0],[0,2]]: P(X ≥ 2) = C(2,2)·C(2,0) / C(4,2) = 1/6.
  near(fisherOneSided(2, 0, 0, 2, 'decrease'), 1 / 6);
  // [[0,10],[3,7]]: P(X ≤ 0) = C(17,10) / C(20,10) = (10·9·8) / (20·19·18) = 2/19.
  near(fisherOneSided(0, 10, 3, 7, 'increase'), 2 / 19);
  // [[4,4],[0,8]]: P(X ≥ 4) = C(12,4) / C(16,8) = 495 / 12,870 = 1/26.
  near(fisherOneSided(4, 4, 0, 8, 'decrease'), 1 / 26);
});

test('Fisher: matches an exact BigInt reference on every small table, and the two tails overlap at X = a', () => {
  for (let a = 0; a <= 5; a++) for (let b = 0; b <= 5; b++) for (let c = 0; c <= 5; c++) for (let d = 0; d <= 5; d++) {
    if (a + b === 0 || c + d === 0) continue;
    const dec = fisherOneSided(a, b, c, d, 'decrease');
    const inc = fisherOneSided(a, b, c, d, 'increase');
    near(dec, fisherRef(a, b, c, d, 'decrease'), 1e-10);
    near(inc, fisherRef(a, b, c, d, 'increase'), 1e-10);
    // P(X ≥ a) + P(X ≤ a) = 1 + P(X = a)
    const pa = Number(choose(a + c, a) * choose(b + d, b)) / Number(choose(a + b + c + d, a + b));
    near(dec + inc, 1 + pa, 1e-10);
    assert.ok(dec <= 1 && inc <= 1);
  }
});

// ---------- Wilson ----------

test('Wilson: k = 0 of 10 at z = 1.645 has upper bound z²/(n + z²) ≈ 0.2130 and lower bound 0', () => {
  const z = 1.645;
  const ci = wilson(0, 10);
  assert.equal(ci.lo, 0);
  near(ci.hi, (z * z) / (10 + z * z));
  near(ci.hi, 0.21297, 1e-5);
  // All successes mirror it: lower bound n / (n + z²).
  near(wilson(10, 10).lo, 10 / (10 + z * z));
  assert.equal(wilson(10, 10).hi, 1);
});

test('Wilson: textbook 95% interval for 5 of 10 is (0.2366, 0.7634); intervals are symmetric and contain p; n = 0 is unknown', () => {
  const ci = wilson(5, 10, 1.96);
  near(ci.lo, 0.2366, 1e-4);
  near(ci.hi, 0.7634, 1e-4);
  for (const [k, n] of [[1, 8], [3, 31], [9, 31], [0, 1], [7, 7]]) {
    const w = wilson(k, n);
    const m = wilson(n - k, n);
    near(w.lo, 1 - m.hi, 1e-12);
    assert.ok(w.lo <= k / n && k / n <= w.hi);
  }
  assert.equal(wilson(0, 0), null);
});

// ---------- verdict rules ----------

test('Verdict: fewer than 8 chances in either period is Inconclusive; 8 and 8 can give a verdict', () => {
  const seven = cmp([4, 7], [0, 8]);
  assert.equal(seven.verdict, 'Inconclusive');
  assert.equal(seven.p, null);
  assert.match(seven.explanation, /at least 8 in each/);
  assert.equal(CONFIG.compare.minOpp, 8);
  const eight = cmp([4, 8], [0, 8]);
  assert.equal(eight.verdict, 'Improving');
  near(eight.p, 1 / 26, 1e-12);
  assert.equal(eight.strength, 'strong');
  // One period without chances at all is still Inconclusive, not "Not applicable".
  assert.equal(cmp([0, 0], [3, 10]).verdict, 'Inconclusive');
});

test('Verdict: exactly −50% relative is Improving when p is far below 0.2, and No clear change when p is far above it', () => {
  const sig = cmp([20, 40], [10, 40]); // 50% → 25%
  assert.equal(sig.relChange, -0.5);
  near(sig.p, fisherRef(20, 20, 10, 30, 'decrease'), 1e-10);
  assert.ok(sig.p < CONFIG.compare.alpha);
  assert.equal(sig.verdict, 'Improving');
  const weak = cmp([2, 8], [1, 8]); // 25% → 12.5%; P(X ≥ 2) = (3·1,716 + 1,287) / 12,870 = 0.5
  assert.equal(weak.relChange, -0.5);
  near(weak.p, 0.5, 1e-12);
  assert.equal(weak.verdict, 'No clear change');
  assert.equal(weak.strength, 'weak');
  assert.match(weak.explanation, /too likely to call/);
});

test('Verdict: the p < 0.2 line is tested right at the threshold (p = 0.2002 and p = 0.1999)', () => {
  assert.equal(CONFIG.compare.alpha, 0.2);
  // 6 of 12 → 3 of 12: exactly −50% relative. P(X ≥ 6) = 541,268 / 2,704,156 ≈ 0.20016, just above the line.
  const above = cmp([6, 12], [3, 12]);
  assert.equal(above.relChange, -0.5);
  near(above.p, fisherRef(6, 6, 3, 9, 'decrease'), 1e-10);
  near(above.p, 541268 / 2704156, 1e-12);
  assert.ok(above.p > 0.2 && above.p < 0.2002);
  assert.equal(above.verdict, 'No clear change');
  assert.equal(above.strength, 'weak');
  assert.match(above.explanation, /too likely to call/);
  // 3 of 10 → 1 of 13: about −74% relative. P(X ≥ 3) = 228,684 / 1,144,066 ≈ 0.19989, just below the line.
  const below = cmp([3, 10], [1, 13]);
  assert.ok(below.relChange < -0.74 && below.relChange > -0.75);
  near(below.p, fisherRef(3, 7, 1, 12, 'decrease'), 1e-10);
  near(below.p, 228684 / 1144066, 1e-12);
  assert.ok(below.p < 0.2 && below.p > 0.1998);
  assert.equal(below.verdict, 'Improving');
  assert.equal(below.strength, 'suggestive');
});

test('Strength: p < 0.05 is "strong", 0.05 ≤ p < 0.2 is "suggestive"; both sides of 0.05 are still Improving', () => {
  assert.equal(CONFIG.compare.strongAlpha, 0.05);
  // 3 of 8 → 0 of 12: P(X ≥ 3) = P(X = 3) = C(3,3)·C(17,5) / C(20,8) = 6,188 / 125,970 ≈ 0.04912.
  const strong = cmp([3, 8], [0, 12]);
  assert.equal(strong.relChange, -1);
  near(strong.p, 6188 / 125970, 1e-12);
  near(strong.p, fisherRef(3, 5, 0, 12, 'decrease'), 1e-10);
  assert.equal(strong.strength, 'strong');
  assert.equal(strong.verdict, 'Improving');
  // 5 of 12 → 0 of 8: P(X ≥ 5) = P(X = 5) = C(5,5)·C(15,7) / C(20,12) = 6,435 / 125,970 ≈ 0.05108.
  const suggestive = cmp([5, 12], [0, 8]);
  assert.equal(suggestive.relChange, -1);
  near(suggestive.p, 6435 / 125970, 1e-12);
  near(suggestive.p, fisherRef(5, 7, 0, 8, 'decrease'), 1e-10);
  assert.equal(suggestive.strength, 'suggestive');
  assert.equal(suggestive.verdict, 'Improving');
});

test('Verdict: a significant drop smaller than 50% relative is not called Improving', () => {
  const r = cmp([40, 80], [21, 80]); // −47.5% relative, p ≈ 0.0016
  assert.ok(r.p < 0.01);
  assert.equal(r.verdict, 'No clear change');
  assert.match(r.explanation, /smaller than the 50% relative change we require/);
});

test('Verdict: Worsening needs +25% relative (or a rise from zero) and p < 0.2', () => {
  const at = cmp([200, 400], [250, 400]); // +25% exactly
  assert.equal(at.relChange, 0.25);
  assert.equal(at.verdict, 'Worsening');
  const under = cmp([200, 400], [249, 400]); // +24.5%, still significant
  assert.ok(under.p < CONFIG.compare.alpha);
  assert.equal(under.verdict, 'No clear change');
  assert.match(under.explanation, /smaller than the 25% relative change/);
  // From 0 of 20 to 5 of 20: no relative change exists; P(X ≤ 0) = C(35,20)/C(40,20) = (20·19·18·17·16)/(40·39·38·37·36).
  const fromZero = cmp([0, 20], [5, 20]);
  assert.equal(fromZero.relChange, null);
  near(fromZero.p, (20 * 19 * 18 * 17 * 16) / (40 * 39 * 38 * 37 * 36), 1e-12);
  assert.equal(fromZero.verdict, 'Worsening');
  // From 0 of 8 to 1 of 8: p = C(15,8)/C(16,8) = 0.5 → not significant.
  const small = cmp([0, 8], [1, 8]);
  near(small.p, 0.5, 1e-12);
  assert.equal(small.verdict, 'No clear change');
});

test('Verdict: no chances in either period is Not applicable; no occurrences in either is Not seen', () => {
  const na = cmp([0, 0], [0, 0]);
  assert.equal(na.verdict, 'Not applicable');
  assert.equal(na.before.rate, null, 'rate unknown, not 0%');
  assert.equal(na.before.ci, null);
  assert.match(na.explanation, /could not occur/);
  const ns = cmp([0, 10], [0, 12]);
  assert.equal(ns.verdict, 'Not seen');
  assert.equal(ns.absChange, 0);
  assert.equal(ns.p, null);
});

test('Verdict: trading less is not improving: the same rate on fewer chances is No clear change', () => {
  const r = cmp([10, 40], [3, 12]); // 25% → 25%
  assert.equal(r.absChange, 0);
  assert.equal(r.p, 1);
  assert.equal(r.verdict, 'No clear change');
  assert.match(r.explanation, /unchanged at 25.0%/);
  // Fewer occurrences in absolute terms (10 → 3) does not matter; only the rate does.
  assert.equal(cmp([10, 40], [2, 8]).verdict, 'No clear change');
});

test('compareHabit: costs are floored at 0 (no "negative cost"); rates and intervals come from occurrences per chance', () => {
  const r = compareHabit(period(3, 12, -500), period(1, 10, 800), 'H1');
  assert.equal(r.before.cost, 0);
  assert.equal(r.after.cost, 800);
  assert.equal(r.before.rate, 0.25);
  assert.deepEqual(r.before.ci, wilson(3, 12));
  assert.equal(r.chances, 'trades opened after a losing trade');
});

test('comparePeriods on real persona months: one row per habit in order, p-values match the exact reference', () => {
  for (const p of Object.values(PERSONAS)) {
    const rows = comparePeriods(analyze(p.months['2026-09'].fills), analyze(p.months['2026-10'].fills));
    assert.deepEqual(rows.map((r) => r.id), HABIT_IDS);
    for (const r of rows) {
      if (r.p === null || r.p === 1) continue;
      const dir = r.absChange < 0 ? 'decrease' : 'increase';
      near(r.p, fisherRef(r.before.n, r.before.opp - r.before.n, r.after.n, r.after.opp - r.after.n, dir), 1e-10);
    }
  }
});

// ---------- known issue (reported, not fixed) ----------

// chanceText(p) returns "more likely than not" for p ≥ 0.5, but the explanation template wraps it as
// "would show up ___ times by chance", producing "would show up more likely than not times by chance".
test('Explanation reads as a sentence when p ≥ 0.5', () => {
  const r = cmp([2, 8], [1, 8]);
  assert.doesNotMatch(r.explanation, /more likely than not times/);
});
