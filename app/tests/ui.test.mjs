// UI-layer evaluations without a browser: views are pure functions of state, so we render them across a
// matrix of ~90 realistic states and check structure, wiring, accessibility basics and honesty of copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runMatrix, stateMatrix, loadModules, renderPage, VIEW_NAMES } from './helpers/render-matrix.mjs';
import { initialState, reduce, selectAnalysis, EFFECT_TYPES, ACTION_TYPES } from '../src/store.js';
import { formatINR } from '../src/format.js';

const { mods } = await loadModules();
const matrix = stateMatrix();
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;/g, ' ').replace(/\s+/g, ' ');
const mainOf = (html) => html.slice(html.indexOf('<main>'), html.lastIndexOf('</main>') + 7);

test('U01 every view renders in every matrix state with no unknown actions, duplicate ids or leaked NaN/undefined', async () => {
  const { renders, failures } = await runMatrix();
  assert.ok(renders >= VIEW_NAMES.length * 80, `rendered ${renders}`);
  assert.deepEqual(failures.slice(0, 5), []);
});

test('U02 every side effect a view can trigger is implemented in main.js, and no action name is both', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const e of EFFECT_TYPES) {
    if (e === 'importFile') assert.match(main, /type === 'file'/, 'file input handled');
    else assert.match(main, new RegExp(`case '${e}'`), `effect ${e} implemented`);
  }
  for (const e of EFFECT_TYPES) assert.equal(ACTION_TYPES.has(e), false, `${e} is not also a reducer action`);
});

test('U03 every form control has an accessible name and every button has text or a label', () => {
  for (const { name, state } of matrix.filter((_, i) => i % 3 === 0)) {
    for (const v of VIEW_NAMES) {
      const html = renderPage({ ...state, view: v }, v, mods);
      for (const m of html.matchAll(/<(select|input|textarea)\b([^>]*)>/g)) {
        const attrs = m[2];
        if (/type="hidden"/.test(attrs)) continue;
        const id = attrs.match(/\sid="([^"]+)"/)?.[1];
        const labelled = /aria-label="[^"]+"/.test(attrs) || /aria-labelledby="[^"]+"/.test(attrs) || (id && html.includes(`for="${id}"`));
        assert.ok(labelled, `${v} @ ${name}: <${m[1]}${attrs.slice(0, 80)}> has no label`);
      }
      for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const hasName = /aria-label="[^"]+"/.test(m[1]) || text(m[2]).trim().length > 0;
        assert.ok(hasName, `${v} @ ${name}: button without a name: ${m[0].slice(0, 120)}`);
      }
    }
  }
});

test('U04 each view has exactly one h1 inside main, and every chart has a text alternative', () => {
  for (const { name, state } of matrix.filter((_, i) => i % 5 === 0)) {
    for (const v of VIEW_NAMES) {
      const html = renderPage({ ...state, view: v }, v, mods);
      const h1s = (mainOf(html).match(/<h1\b/g) ?? []).length;
      assert.equal(h1s, 1, `${v} @ ${name} has ${h1s} h1`);
      for (const svg of html.matchAll(/<svg\b([^>]*)>/g)) {
        assert.ok(/aria-label="[^"]+"|aria-hidden="true"/.test(svg[1]), `${v} @ ${name}: svg without text alternative`);
      }
    }
  }
});

test('U05 the overview headline figure is the engine headline (de-duplicated), for every sample trader and period', () => {
  for (const id of ['aarav', 'meera']) {
    for (const key of ['2026-09', '2026-10']) {
      const s = reduce(reduce(initialState(), { type: 'selectDataset', id }), { type: 'selectPeriod', key });
      const a = selectAnalysis(s);
      if (!a.confirmed.length) continue;
      const html = text(mods.overview.render(s));
      assert.ok(html.includes(formatINR(a.headlineCost)), `${id} ${key}: headline ${formatINR(a.headlineCost)} shown`);
    }
  }
});

test('U06 switching trader leaves no trace of the previous trader in any view', () => {
  let s = reduce(initialState(), { type: 'inspectHabit', habitId: 'H1' });
  s = reduce(s, { type: 'selectTrade', id: 'P:AS0001' });
  s = reduce(s, { type: 'setTradeFilter', key: 'q', value: 'BANKNIFTY' });
  s = reduce(s, { type: 'selectDataset', id: 'meera' });
  for (const v of VIEW_NAMES.filter((x) => x !== 'lab' && x !== 'method' && x !== 'import')) {
    // The trader picker legitimately lists Aarav; check the view content and any overlay only.
    const html = renderPage({ ...s, view: v }, v, mods);
    const content = html.slice(html.indexOf('<main>'));
    assert.doesNotMatch(content, /AS\d{4}|Aarav/, `${v} still shows Aarav data after switching to Meera`);
  }
  assert.equal(s.selectedTradeId, null);
  assert.equal(s.trades.q, '');
});

test('U07 the association disclaimer appears where costs are explained, and no rendered copy claims causation or advice', () => {
  const disclaimer = 'This is an association, not proof that the behaviour caused the loss.';
  const s = initialState();
  for (const v of ['inspect', 'overview', 'method']) assert.ok(text(mods[v].render({ ...s, view: v })).includes(disclaimer), `${v} has the disclaimer`);
  const banned = [/would have (made|earned|saved)/i, /\byou should (buy|sell)\b/i, /\bguaranteed\b/i, /\b(habit|this) caused\b/i, /\blive market data\b(?! is not)/i];
  for (const { name, state } of matrix.filter((_, i) => i % 4 === 0)) {
    for (const v of VIEW_NAMES) {
      const t = text(renderPage({ ...state, view: v }, v, mods));
      for (const b of banned) {
        const m = t.match(b);
        if (m && /no live market data|not use live market data|without live market data/i.test(t.slice(Math.max(0, m.index - 20), m.index + 40))) continue;
        assert.doesNotMatch(t, b, `${v} @ ${name}`);
      }
    }
  }
});

test('U08 overlays render only when their state asks for them, with dialog semantics', () => {
  const base = initialState();
  const page = (s) => renderPage(s, s.view, mods);
  assert.doesNotMatch(page(base), /data-overlay/);
  const withTrade = reduce(base, { type: 'selectTrade', id: 'P:AS0001' });
  const drawer = page(withTrade);
  assert.match(drawer, /data-overlay[^>]*role="dialog"|role="dialog"[^>]*data-overlay/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /data-action="closeTrade"/);
  const withGuard = reduce(base, { type: 'openGuardrail', habitId: 'H1' });
  const dlg = page(withGuard);
  assert.match(dlg, /data-action="saveGuardrail"/);
  assert.match(dlg, /data-action="closeGuardEdit"/);
  assert.doesNotMatch(page(reduce(withGuard, { type: 'closeGuardEdit' })), /data-action="saveGuardrail"/);
});

test('U09 missing values render as a dash, never as ₹0: an import with blank charges', () => {
  const csv = 'id,ts,underlying,symbol,optType,strike,expiry,side,qty,price,charges,strategyId\nA1,2026-09-01T09:30:00+05:30,NIFTY,NIFTY X 25000 CE,CE,25000,,BUY,75,100,,\nA2,2026-09-01T09:50:00+05:30,NIFTY,NIFTY X 25000 CE,CE,25000,,SELL,75,120,,';
  let s = reduce(initialState(), { type: 'importFileRead', fileName: 'blank.csv', text: csv, size: csv.length });
  s = reduce(reduce(s, { type: 'validateImport' }), { type: 'confirmImport' });
  const a = selectAnalysis(s);
  assert.equal(a.stats.noChargesRecorded, true);
  s = reduce(s, { type: 'selectTrade', id: a.units[0].id });
  const drawer = renderPage(s, 'trades', mods);
  const fillsTable = drawer.slice(drawer.indexOf('data-overlay'));
  assert.match(fillsTable, /—/, 'missing charge or expiry shown as a dash');
  assert.doesNotMatch(text(mods.overview.render({ ...s, view: 'overview' })), /Charges recorded ₹0\b/);
});
