// Import evals: CSV reading, column mapping, timestamp and amount parsing, row validation,
// strict parsing and CSV round trips. Invalid financial values must be rejected, never coerced to 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readTable, suggestMapping, exactMapping, mappingProblems, parseTimestamp, parseAmount, validateRows,
  parseCsv, toCsv, TEMPLATE_CSV, LIMITS, COLUMNS, FIELDS,
} from '../src/import.js';
import { analyze } from '../src/engine.js';

const HEADER = COLUMNS.join(',');
const GOOD = 'F1,2026-09-01T09:31:00+05:30,NIFTY,NIFTY 08SEP26 24800 CE,CE,24800,2026-09-08,BUY,75,112.5,20,';
// Build a canonical row from overrides keyed by column name.
function row(over = {}) {
  const base = Object.fromEntries(COLUMNS.map((c, i) => [c, GOOD.split(',')[i] ?? '']));
  return COLUMNS.map((c) => (c in over ? over[c] : base[c])).join(',');
}
function validate(lines, opts) {
  const table = readTable([HEADER, ...lines].join('\n'));
  return validateRows(table, exactMapping(table.header), opts);
}
const errorsOf = (r) => r.messages.filter((m) => m.level === 'error').map((m) => m.text).join(' | ');

// ---------- readTable ----------

test('readTable: quoted delimiters, escaped quotes and embedded newlines', () => {
  const t = readTable('a,b,c\n"x,y","he said ""hi""","line1\nline2"\n1,2,3');
  assert.deepEqual(t.header, ['a', 'b', 'c']);
  assert.deepEqual(t.rows[0], ['x,y', 'he said "hi"', 'line1\nline2']);
  assert.deepEqual(t.rows[1], ['1', '2', '3']);
  assert.deepEqual(t.lines, [2, 4], 'the row after a two-line cell starts on file line 4');
});

test('readTable: CRLF line endings, a UTF-8 BOM, trimmed cells', () => {
  const t = readTable('﻿id , ts\r\n 1 ,2\r\n3,4\r\n');
  assert.deepEqual(t.header, ['id', 'ts'], 'BOM removed from the first header cell');
  assert.deepEqual(t.rows, [['1', '2'], ['3', '4']]);
  assert.deepEqual(t.lines, [2, 3]);
});

test('readTable: semicolon and tab delimiters are detected from the header line', () => {
  const semi = readTable('a;b;c\n1;2;3');
  assert.equal(semi.delimiter, ';');
  assert.deepEqual(semi.rows, [['1', '2', '3']]);
  const tab = readTable('a\tb\n1\t2');
  assert.equal(tab.delimiter, '\t');
  assert.deepEqual(tab.rows, [['1', '2']]);
  // A comma inside a quoted header cell does not count towards the delimiter vote.
  assert.equal(readTable('"x,y,z";b;c\n1;2;3').delimiter, ';');
});

test('readTable: blank lines are skipped but row line numbers still match the file', () => {
  const t = readTable('\n\na,b\n\n1,2\n , \n\n3,4\n');
  assert.deepEqual(t.header, ['a', 'b']);
  assert.deepEqual(t.rows, [['1', '2'], ['3', '4']]);
  assert.deepEqual(t.lines, [5, 8]);
});

test('readTable: empty input has no header and no rows', () => {
  for (const s of ['', '\n\n', null, undefined]) {
    const t = readTable(s);
    assert.deepEqual([t.header, t.rows, t.lines], [[], [], []]);
  }
});

// ---------- mapping ----------

test('suggestMapping: broker-style aliases map to the right fields', () => {
  const header = ['Order ID', 'Trade Time', 'Underlying', 'Trading Symbol', 'Option Type', 'Strike Price', 'Expiry Date', 'Buy/Sell', 'Quantity', 'Trade Price', 'Brokerage', 'Tag'];
  assert.deepEqual(suggestMapping(header), { id: 0, ts: 1, underlying: 2, symbol: 3, optType: 4, strike: 5, expiry: 6, side: 7, qty: 8, price: 9, charges: 10, strategyId: 11 });
  assert.deepEqual(mappingProblems(suggestMapping(header)), []);
});

test('suggestMapping: an exact field name beats an alias, unknown columns stay unmapped, nothing is used twice', () => {
  const m = suggestMapping(['Trade Price', 'price', 'Notes']);
  assert.equal(m.price, 1, 'exact "price" wins over the alias "Trade Price"');
  assert.equal(m.ts, null);
  // Smoke check: every alias of every field (plus duplicates) in one header maps each field to a different column.
  const everything = COLUMNS.flatMap((f) => [f, ...FIELDS[f].aliases]);
  const all = suggestMapping([...everything, ...everything]);
  const used = Object.values(all).filter((v) => v !== null);
  assert.equal(used.length, COLUMNS.length, 'every field found');
  assert.equal(new Set(used).size, used.length, 'no column used twice');
});

test('suggestMapping cannot map one column to two fields: the names each field accepts never overlap', () => {
  // A header cell can only match a field through its canonical name or an alias (after lower-casing and
  // stripping punctuation). If no name is accepted by two fields, no cell can be claimed by two fields.
  const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const owner = new Map();
  for (const f of COLUMNS) {
    for (const name of new Set([norm(f), ...FIELDS[f].aliases.map(norm)])) {
      assert.ok(!owner.has(name), `"${name}" is accepted by both ${owner.get(name)} and ${f}`);
      owner.set(name, f);
    }
  }
  // Aliases are stored already normalised, so a header such as "Trade Price" reaches them.
  for (const f of COLUMNS) for (const alias of FIELDS[f].aliases) assert.equal(norm(alias), alias, `${f} alias "${alias}"`);
  // Each cell of a mapped header is used at most once even when it repeats.
  const twice = suggestMapping(['Price', 'Price', 'Rate']);
  assert.deepEqual([twice.price, twice.charges, twice.qty], [0, null, null]);
});

test('mappingProblems: missing required fields and one column mapped twice', () => {
  const ok = exactMapping(COLUMNS);
  assert.deepEqual(mappingProblems(ok), []);
  // id, expiry, charges and strategyId are optional in the wizard.
  assert.deepEqual(mappingProblems({ ...ok, id: null, expiry: null, charges: null, strategyId: null }), []);
  const missing = mappingProblems({ ...ok, ts: null, price: null });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /Missing column\(s\): ts, price/);
  const twice = mappingProblems({ ...ok, charges: ok.price });
  assert.equal(twice.length, 1);
  assert.match(twice[0], /same file column is mapped to both "Price \(₹ per unit\)" and "Charges \(₹\)"/);
});

// ---------- timestamps ----------

test('parseTimestamp: zones Z, +05:30, +0530 and negative offsets normalise to the same IST instant', () => {
  const want = '2026-09-01T09:30:00+05:30';
  for (const s of ['2026-09-01T04:00:00Z', '2026-09-01T04:00:00z', '2026-09-01T09:30:00+05:30', '2026-09-01T09:30:00+0530', '2026-09-01 09:30:00 +05:30', '2026-08-31T23:00:00-05:00']) {
    assert.deepEqual(parseTimestamp(s), { iso: want, assumedIst: false }, s);
  }
  // Rolls over to the next IST calendar day.
  assert.equal(parseTimestamp('2026-09-01T20:00:00Z').iso, '2026-09-02T01:30:00+05:30');
  // Fractional seconds are accepted and dropped.
  assert.equal(parseTimestamp('2026-09-01T09:30:15.789+05:30').iso, '2026-09-01T09:30:15+05:30');
});

test('parseTimestamp: no zone is read as IST and flagged; minutes-only times get :00', () => {
  assert.deepEqual(parseTimestamp('2026-09-01 09:30'), { iso: '2026-09-01T09:30:00+05:30', assumedIst: true });
  assert.deepEqual(parseTimestamp('2026-09-01T15:29:59'), { iso: '2026-09-01T15:29:59+05:30', assumedIst: true });
  assert.equal(parseTimestamp('2028-02-29T10:00').iso, '2028-02-29T10:00:00+05:30', 'leap day');
});

test('parseTimestamp: impossible dates and garbage are rejected with a reason', () => {
  for (const s of ['2026-02-30T10:00:00', '2026-02-30T10:00:00+05:30', '2026-02-29T10:00', '2026-13-01T10:00', '2026-09-31 10:00', '2026-09-01T24:00', '2026-09-01T10:60']) {
    assert.match(parseTimestamp(s).error ?? '', /not a real date and time/, s);
  }
  for (const s of ['yesterday', '01/09/2026 09:30', '2026-09-01', '1756700000', '2026-09-01T09:30+5:30']) {
    assert.match(parseTimestamp(s).error ?? '', /ts must look like/, s);
  }
  assert.deepEqual(parseTimestamp(''), { error: 'ts is blank' });
  assert.deepEqual(parseTimestamp('   '), { error: 'ts is blank' });
});

// ---------- amounts ----------

test('parseAmount: rupee sign, Indian and western thousands separators, signs and decimals', () => {
  const cases = [['₹1,234.50', 1234.5], ['₹ 100', 100], ['1,23,456.75', 123456.75], ['12,34,56,789', 123456789], ['123,456.75', 123456.75], ['1,234,567', 1234567], ['-5', -5], ['+5', 5], ['.5', 0.5], [' 42 ', 42], ['0', 0], ['0.05', 0.05]];
  for (const [s, v] of cases) assert.equal(parseAmount(s), v, s);
});

test('parseAmount: anything that is not a clean number is NaN, never 0', () => {
  for (const s of ['12abc', '', '   ', '1.2.3', '1e3', '5.', '-', '+', '.', '1234,567', '1,2', '₹', 'NaN', 'Infinity', '--5', '5-', '(100)', null, undefined]) {
    assert.ok(Number.isNaN(parseAmount(s)), `${JSON.stringify(s)} → ${parseAmount(s)}`);
  }
});

// ---------- validateRows ----------

test('validateRows: a blank price is rejected (never ₹0); a zero price is accepted', () => {
  const r = validate([row({ price: '' }), row({ id: 'F2', price: '0' })]);
  assert.equal(r.rows[0].status, 'rejected');
  assert.match(errorsOf(r.rows[0]), /price is blank; a missing price is never treated as ₹0/);
  assert.equal(r.rows[0].fill, null);
  assert.equal(r.rows[1].status, 'ok');
  assert.equal(r.rows[1].fill.price, 0);
  assert.deepEqual(r.fills.map((f) => f.id), ['F2']);
  assert.equal(r.summary.rejected, 1);
});

test('validateRows: non-numeric or negative charges are rejected; blank charges are accepted as null with a warning', () => {
  const r = validate([row({ id: 'A', charges: 'abc' }), row({ id: 'B', charges: '-1' }), row({ id: 'C', charges: '' }), row({ id: 'D', charges: '₹0' })]);
  assert.equal(r.rows[0].status, 'rejected');
  assert.match(errorsOf(r.rows[0]), /charges is not a number \(got "abc"\); it is not assumed to be ₹0/);
  assert.equal(r.rows[1].status, 'rejected');
  assert.match(errorsOf(r.rows[1]), /charges cannot be negative/);
  assert.equal(r.rows[2].status, 'warning');
  assert.equal(r.rows[2].fill.charges, null);
  assert.match(r.rows[2].messages[0].text, /charges are blank/);
  assert.equal(r.rows[3].fill.charges, 0, 'an explicit ₹0 is a value');
  assert.equal(r.summary.missingCharges, 1);
});

test('validateRows: quantity, price, strike and side checks explain the rule', () => {
  const r = validate([
    row({ id: 'A', qty: '-75' }), row({ id: 'B', qty: '7.5' }), row({ id: 'C', qty: 'x' }), row({ id: 'D', price: '-1' }),
    row({ id: 'E', strike: '0' }), row({ id: 'F', side: 'HOLD' }), row({ id: 'G', side: 's', optType: 'call' }), row({ id: 'H', underlying: '' }),
  ]);
  assert.match(errorsOf(r.rows[0]), /qty must be a positive whole number; use side to show direction/);
  assert.match(errorsOf(r.rows[1]), /qty must be a positive whole number \(got 7.5\)/);
  assert.match(errorsOf(r.rows[2]), /qty is not a number/);
  assert.match(errorsOf(r.rows[3]), /price cannot be negative/);
  assert.match(errorsOf(r.rows[4]), /strike must be a positive number/);
  assert.match(errorsOf(r.rows[5]), /side must be BUY or SELL/);
  assert.equal(r.rows[6].status, 'ok', 'S and CALL are accepted spellings');
  assert.deepEqual([r.rows[6].fill.side, r.rows[6].fill.optType], ['SELL', 'CE']);
  assert.match(errorsOf(r.rows[7]), /underlying is blank/);
});

test('validateRows: futures and equity rows are rejected as "options only"', () => {
  const r = validate([row({ id: 'A', optType: 'FUT' }), row({ id: 'B', optType: 'EQ' }), row({ id: 'C', optType: 'XX' })]);
  assert.match(errorsOf(r.rows[0]), /optType "FUT": Habit Ledger reviews options only/);
  assert.match(errorsOf(r.rows[1]), /options only/);
  assert.match(errorsOf(r.rows[2]), /optType must be CE or PE/);
  assert.equal(r.fills.length, 0);
});

test('validateRows: a repeated id is rejected and points to the first line that used it', () => {
  const r = validate([row({ id: 'F1' }), row({ id: 'F2', ts: '2026-09-01T09:40:00+05:30' }), row({ id: 'F1', ts: '2026-09-01T09:50:00+05:30' })]);
  assert.equal(r.rows[2].status, 'rejected');
  assert.match(errorsOf(r.rows[2]), /duplicate id "F1" \(first used on row 2\)/);
  assert.deepEqual(r.summary.duplicateIds, [4]);
  assert.equal(r.fills.length, 2);
});

test('validateRows: identical content is flagged as a possible duplicate and only excluded on request', () => {
  const lines = [row({ id: 'A' }), row({ id: 'B' }), row({ id: 'C', ts: '2026-09-01T10:00:00+05:30' })];
  const flagged = validate(lines);
  assert.equal(flagged.rows[1].status, 'warning');
  assert.equal(flagged.rows[1].messages[0].duplicateOf, 2);
  assert.match(flagged.rows[1].messages[0].text, /identical to row 2/);
  assert.deepEqual(flagged.summary.suspectedDuplicates, [3]);
  assert.equal(flagged.fills.length, 3, 'kept until the user chooses to exclude it');
  const excluded = validate(lines, { excludeLines: new Set(flagged.summary.suspectedDuplicates) });
  assert.equal(excluded.rows[1].status, 'excluded');
  assert.deepEqual(excluded.fills.map((f) => f.id), ['A', 'C']);
  assert.equal(excluded.summary.excluded, 1);
  assert.equal(excluded.summary.accepted, 2);
});

test('validateRows: missing ids fall back to the row number; bad expiry becomes missing with a warning; no-zone times are counted', () => {
  const r = validate([row({ id: '', ts: '2026-09-01 09:31' }), row({ id: '', ts: '2026-09-01 09:45', expiry: '08/09/2026' })]);
  assert.deepEqual(r.fills.map((f) => f.id), ['row2', 'row3']);
  assert.equal(r.fills[1].expiry, null);
  assert.match(r.rows[1].messages.map((m) => m.text).join(), /not YYYY-MM-DD, so it is shown as missing/);
  assert.equal(r.summary.assumedIst, 2);
  assert.match(r.notes[0], /2 timestamps had no timezone and were read as IST/);
});

test('validateRows: only the first LIMITS.maxRows rows are read, and the summary says so', () => {
  const n = LIMITS.maxRows + 3;
  const cells = (i) => [`F${i}`, '2026-09-01T09:31:00+05:30', 'NIFTY', `NIFTY S${i} 24800 CE`, 'CE', '24800', '2026-09-08', 'BUY', '75', '100', '20', ''];
  const table = { header: COLUMNS, rows: Array.from({ length: n }, (_, i) => cells(i)), lines: Array.from({ length: n }, (_, i) => i + 2) };
  const r = validateRows(table, exactMapping(COLUMNS));
  assert.equal(r.summary.total, n);
  assert.equal(r.summary.read, LIMITS.maxRows);
  assert.equal(r.summary.truncated, true);
  assert.equal(r.fills.length, LIMITS.maxRows);
  assert.ok(r.notes.includes('Only the first 20,000 rows were read.'), r.notes.join(' | '));
});

// ---------- parseCsv / toCsv ----------

test('parseCsv: strict header requires canonical names (aliases are for the wizard only)', () => {
  const aliased = HEADER.replace('price', 'Trade Price');
  const r = parseCsv(`${aliased}\n${GOOD}`);
  assert.equal(r.fatal, true);
  assert.match(r.errors[0].message, /Missing column\(s\): price/);
  // id and expiry are required by the strict parser too.
  const noExpiry = parseCsv('id,ts,underlying,symbol,optType,strike,side,qty,price\nF1,2026-09-01T09:31:00+05:30,NIFTY,X,CE,24800,BUY,75,100');
  assert.equal(noExpiry.fatal, true);
  assert.match(noExpiry.errors[0].message, /expiry/);
  // charges and strategyId columns may be absent: rows load with a missing-charges warning.
  const noCharges = parseCsv('id,ts,underlying,symbol,optType,strike,expiry,side,qty,price\nF1,2026-09-01T09:31:00+05:30,NIFTY,X,CE,24800,2026-09-08,BUY,75,100');
  assert.equal(noCharges.fatal, false);
  assert.equal(noCharges.fills[0].charges, null);
  assert.equal(noCharges.warnings.length, 1);
  // Header names are matched case-insensitively.
  assert.equal(parseCsv(`${HEADER.toUpperCase()}\n${GOOD}`).fills.length, 1);
});

test('toCsv → parseCsv round trip keeps commas, quotes, newlines and nulls exactly', () => {
  const fills = [
    { id: 'R1', ts: '2026-09-01T09:31:00+05:30', underlying: 'NIFTY', symbol: 'NIFTY, "odd" name', optType: 'CE', strike: 24800, expiry: '2026-09-08', side: 'BUY', qty: 75, price: 112.5, charges: null, strategyId: 'S"1,a' },
    { id: 'R2', ts: '2026-09-01T09:52:00+05:30', underlying: 'NIFTY', symbol: 'NIFTY, "odd" name', optType: 'CE', strike: 24800, expiry: null, side: 'SELL', qty: 75, price: 0, charges: 20.25, strategyId: 'S"1,a' },
    { id: 'R3', ts: '2026-09-01T10:00:00+05:30', underlying: 'BANKNIFTY', symbol: 'BANK\nNIFTY 55000 PE', optType: 'PE', strike: 55000, expiry: '2026-09-29', side: 'BUY', qty: 35, price: 1234.55, charges: 0, strategyId: null },
  ];
  const csv = toCsv(fills);
  assert.equal(csv.split('\n')[0], HEADER);
  const r = parseCsv(csv);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.fills, fills);
});

test('TEMPLATE_CSV parses cleanly into one single-leg trade and one spread', () => {
  const r = parseCsv(TEMPLATE_CSV);
  assert.deepEqual([r.fatal, r.errors.length, r.warnings.length, r.fills.length], [false, 0, 0, 6]);
  const a = analyze(r.fills);
  assert.deepEqual(a.units.map((u) => u.kind), ['single', 'strategy']);
  // Single: (131 − 112.5) × 150 − 2 × 20 = 2,775 − 40 = 2,735.
  assert.equal(a.units[0].netPnl, 2735);
  // Spread S1: short 24900 (60 → 30) +2,250; long 25000 (25 → 12) −975; 4 × ₹20 charges → 1,195.
  assert.equal(a.units[1].netPnl, 1195);
});

// ---------- known issues (reported, not fixed) ----------

// A timezone-less timestamp with seconds 60-99 passes validDate (seconds are not checked), Date.parse
// returns NaN, and the row is accepted with ts "NaN-NaN-NaNTNaN:NaN:NaN+05:30" (a "NaN-NaN" period).
test('parseTimestamp: seconds ≥ 60 without a timezone are rejected', () => {
  assert.ok(parseTimestamp('2026-09-01T10:00:60').error);
  assert.ok(parseTimestamp('2026-09-01 10:00:61').error);
});

// "112,50" (a decimal comma, typical of semicolon-delimited exports) matches the thousands pattern
// because groups of 2 or 3 digits are allowed anywhere, so it is read as ₹11,250 instead of being rejected.
test('parseAmount: comma groups that fit neither Indian nor western grouping are rejected', () => {
  assert.ok(Number.isNaN(parseAmount('112,50')));
  assert.ok(Number.isNaN(parseAmount('1,23')));
  assert.ok(Number.isNaN(parseAmount('1,234,56')));
});
