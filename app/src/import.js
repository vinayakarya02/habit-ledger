// CSV import: reading, column mapping, validation and normalisation. Pure functions, no DOM.
// Invalid financial values are rejected with a reason; they are never coerced to zero.

export const COLUMNS = ['id', 'ts', 'underlying', 'symbol', 'optType', 'strike', 'expiry', 'side', 'qty', 'price', 'charges', 'strategyId'];

// Columns the strict parser (parseCsv) insists on. The mapping wizard relaxes id and expiry.
export const STRICT_REQUIRED = COLUMNS.filter((c) => c !== 'charges' && c !== 'strategyId');

export const FIELDS = {
  id: { label: 'Order / fill ID', required: false, help: 'Unique per row. If not mapped, the row number is used.', aliases: ['id', 'tradeid', 'orderid', 'fillid', 'execid', 'executionid', 'tradeno', 'orderno'] },
  ts: { label: 'Timestamp', required: true, help: 'When the order executed. ISO 8601; times without a timezone are read as IST (UTC+05:30).', aliases: ['ts', 'timestamp', 'time', 'datetime', 'tradetime', 'filltime', 'ordertime', 'exchangetime', 'executiontime', 'tradedatetime'] },
  underlying: { label: 'Underlying', required: true, help: 'Index or stock the option is on, e.g. NIFTY.', aliases: ['underlying', 'underlyingsymbol', 'index', 'name', 'asset'] },
  symbol: { label: 'Contract symbol', required: true, help: 'The exact option contract. Fills of the same symbol are grouped into one position.', aliases: ['symbol', 'tradingsymbol', 'instrument', 'contract', 'scrip', 'instrumentname'] },
  optType: { label: 'Option type', required: true, help: 'CE or PE (CALL / PUT accepted).', aliases: ['opttype', 'optiontype', 'type', 'right', 'cepe', 'callput', 'optype'] },
  strike: { label: 'Strike', required: true, help: 'Strike price, a positive number.', aliases: ['strike', 'strikeprice'] },
  expiry: { label: 'Expiry date', required: false, help: 'YYYY-MM-DD. Shown as missing if absent.', aliases: ['expiry', 'expirydate', 'exp', 'maturity'] },
  side: { label: 'Side', required: true, help: 'BUY or SELL (B / S accepted).', aliases: ['side', 'transactiontype', 'buysell', 'action', 'direction', 'tradetype', 'bs'] },
  qty: { label: 'Quantity (units)', required: true, help: 'Positive whole number of units, not lots. Direction comes from Side.', aliases: ['qty', 'quantity', 'filledqty', 'fillqty', 'tradedqty', 'units', 'tradeqty'] },
  price: { label: 'Price (₹ per unit)', required: true, help: 'Execution price. A blank price is rejected, never read as ₹0.', aliases: ['price', 'tradeprice', 'fillprice', 'avgprice', 'averageprice', 'tradedprice', 'executionprice', 'rate'] },
  charges: { label: 'Charges (₹)', required: false, help: 'Brokerage and fees for the row. If blank, net P&L for that trade excludes charges and is flagged.', aliases: ['charges', 'fees', 'brokerage', 'totalcharges', 'commission', 'fee'] },
  strategyId: { label: 'Strategy ID', required: false, help: 'Same value on every leg of a spread. Blank for single-leg trades.', aliases: ['strategyid', 'strategy', 'strattag', 'strattags', 'tag', 'basketid', 'groupid'] },
};

export const LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 20000 };

const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- reading ----------

function detectDelimiter(firstLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const c of firstLine) {
    if (c === '"') q = !q;
    else if (!q && c in counts) counts[c]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

// Returns { header: string[], rows: string[][], lines: number[] (1-based file line of each row), delimiter }.
export function readTable(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const records = [];
  let cur = '';
  let row = [];
  let q = false;
  let line = 1;
  let rowStart = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else { if (c === '\n') line++; cur += c; }
      continue;
    }
    if (c === '"') q = true;
    else if (c === delimiter) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      records.push({ cells: row, line: rowStart });
      row = []; cur = ''; line++; rowStart = line;
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); records.push({ cells: row, line: rowStart }); }
  const nonBlank = records.filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (!nonBlank.length) return { header: [], rows: [], lines: [], delimiter };
  const [head, ...rest] = nonBlank;
  return {
    header: head.cells.map((h) => h.trim()),
    rows: rest.map((r) => r.cells.map((c) => c.trim())),
    lines: rest.map((r) => r.line),
    delimiter,
  };
}

// ---------- mapping ----------

// Best-effort mapping of file headers to canonical fields. Returns { field: columnIndex | null }.
export function suggestMapping(header) {
  const used = new Set();
  const mapping = {};
  const normed = header.map(norm);
  for (const f of COLUMNS) {
    let idx = normed.findIndex((h, i) => !used.has(i) && h === norm(f));
    if (idx < 0) idx = normed.findIndex((h, i) => !used.has(i) && FIELDS[f].aliases.includes(h));
    mapping[f] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  return mapping;
}

// Exact, case-insensitive canonical names only (used by the strict parser and round-trips).
export function exactMapping(header) {
  const normed = header.map(norm);
  return Object.fromEntries(COLUMNS.map((f) => {
    const i = normed.indexOf(norm(f));
    return [f, i >= 0 ? i : null];
  }));
}

export function mappingProblems(mapping, required = COLUMNS.filter((f) => FIELDS[f].required)) {
  const problems = [];
  const missing = required.filter((f) => mapping[f] == null);
  if (missing.length) problems.push(`Missing column(s): ${missing.join(', ')}. Map them, or download the template to see the expected header.`);
  const seen = new Map();
  for (const f of COLUMNS) {
    const i = mapping[f];
    if (i == null) continue;
    if (seen.has(i)) problems.push(`The same file column is mapped to both "${FIELDS[seen.get(i)].label}" and "${FIELDS[f].label}".`);
    else seen.set(i, f);
  }
  return problems;
}

// ---------- value parsing ----------

const pad2 = (n) => String(n).padStart(2, '0');
const IST_OFFSET_MIN = 330;

// Normalise any accepted timestamp to an IST ISO string "YYYY-MM-DDTHH:MM:SS+05:30".
export function toIstIso(ms) {
  const d = new Date(ms + IST_OFFSET_MIN * 60000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+05:30`;
}

// Returns { iso, assumedIst } or { error }.
export function parseTimestamp(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { error: 'ts is blank' };
  const withZone = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;
  const noZone = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
  let m = s.match(withZone);
  if (m) {
    const zone = m[7].toUpperCase() === 'Z' ? 'Z' : m[7].length === 5 ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : m[7];
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${zone}`);
    if (Number.isNaN(t) || !validDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0))) return { error: `ts "${s}" is not a real date and time` };
    return { iso: toIstIso(t), assumedIst: false };
  }
  m = s.match(noZone);
  if (m) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+05:30`);
    if (Number.isNaN(t) || !validDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0))) return { error: `ts "${s}" is not a real date and time` };
    return { iso: toIstIso(t), assumedIst: true };
  }
  return { error: `ts must look like 2026-09-01T09:30:00+05:30 (got "${s}")` };
}

function validDate(y, mo, d, h, mi, sec = 0) {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || sec > 59) return false;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= dim;
}

// Strict decimal parser: optional ₹ and sign, and thousands separators only in Indian (1,23,456) or
// western (123,456) grouping. A decimal comma ("112,50") is rejected rather than read as 11250.
export function parseAmount(raw) {
  const s = String(raw ?? '').trim().replace(/^₹\s*/, '');
  const grouped = /^[+-]?(\d{1,2}(,\d{2})*,\d{3}|\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/;
  if (!grouped.test(s) || !/\d/.test(s)) return NaN;
  return Number(s.replace(/,/g, ''));
}

const OPT = { CE: 'CE', PE: 'PE', CALL: 'CE', PUT: 'PE', C: 'CE', P: 'PE' };
const SIDE = { BUY: 'BUY', SELL: 'SELL', B: 'BUY', S: 'SELL' };

// ---------- validation ----------

// Validates mapped rows. Returns {
//   fills, rows: [{ line, status: 'ok'|'warning'|'rejected'|'excluded', messages: [{level, field, text}], fill }],
//   summary: { total, accepted, rejected, excluded, withWarnings, suspectedDuplicates: [line], duplicateIds: [line], missingCharges, assumedIst },
//   notes: [string]
// }
export function validateRows(table, mapping, { excludeLines = new Set() } = {}) {
  const out = [];
  const fills = [];
  const idFirstLine = new Map();
  const contentFirstLine = new Map();
  let assumedIst = 0;
  const rows = table.rows.slice(0, LIMITS.maxRows);
  rows.forEach((cells, i) => {
    const line = table.lines[i];
    const get = (f) => (mapping[f] == null ? '' : String(cells[mapping[f]] ?? '').trim());
    const msgs = [];
    const err = (field, text) => msgs.push({ level: 'error', field, text });
    const warn = (field, text) => msgs.push({ level: 'warning', field, text });

    const id = get('id') || `row${line}`;
    if (idFirstLine.has(id)) err('id', `duplicate id "${id}" (first used on row ${idFirstLine.get(id)}); the row is rejected so it can't be counted twice`);

    const tsRes = parseTimestamp(get('ts'));
    if (tsRes.error) err('ts', tsRes.error);

    const underlying = get('underlying').toUpperCase();
    if (!underlying) err('underlying', 'underlying is blank');
    const symbol = get('symbol');
    if (!symbol) err('symbol', 'symbol is blank');

    const optRaw = get('optType').toUpperCase();
    const optType = OPT[optRaw];
    if (!optType) {
      if (['FUT', 'FUTIDX', 'FUTSTK', 'EQ', 'EQUITY'].includes(optRaw)) err('optType', `optType "${optRaw}": Habit Ledger reviews options only, so futures and equity rows are not imported`);
      else err('optType', `optType must be CE or PE (got "${get('optType')}")`);
    }

    const strikeRaw = get('strike');
    const strike = parseAmount(strikeRaw);
    if (strikeRaw === '') err('strike', 'strike is blank');
    else if (!(strike > 0)) err('strike', `strike must be a positive number (got "${strikeRaw}")`);

    const expiryRaw = get('expiry');
    let expiry = null;
    if (expiryRaw) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(expiryRaw) && validDate(+expiryRaw.slice(0, 4), +expiryRaw.slice(5, 7), +expiryRaw.slice(8, 10), 0, 0)) expiry = expiryRaw;
      else warn('expiry', `expiry "${expiryRaw}" is not YYYY-MM-DD, so it is shown as missing`);
    }

    const sideRaw = get('side').toUpperCase();
    const side = SIDE[sideRaw];
    if (!side) err('side', `side must be BUY or SELL (got "${get('side')}")`);

    const qtyRaw = get('qty');
    const qty = parseAmount(qtyRaw);
    if (qtyRaw === '') err('qty', 'qty is blank');
    else if (Number.isNaN(qty)) err('qty', `qty is not a number (got "${qtyRaw}")`);
    else if (qty < 0) err('qty', `qty must be a positive whole number; use side to show direction (got ${qtyRaw})`);
    else if (!(Number.isInteger(qty) && qty > 0)) err('qty', `qty must be a positive whole number (got ${qtyRaw})`);

    const priceRaw = get('price');
    const price = parseAmount(priceRaw);
    if (priceRaw === '') err('price', 'price is blank; a missing price is never treated as ₹0');
    else if (Number.isNaN(price)) err('price', `price is not a number (got "${priceRaw}")`);
    else if (price < 0) err('price', `price cannot be negative (got ${priceRaw})`);

    const chRaw = get('charges');
    let charges = null;
    if (chRaw === '') warn('charges', 'charges are blank; net P&L for this trade excludes them and is flagged');
    else {
      charges = parseAmount(chRaw);
      if (Number.isNaN(charges)) err('charges', `charges is not a number (got "${chRaw}"); it is not assumed to be ₹0`);
      else if (charges < 0) err('charges', `charges cannot be negative (got ${chRaw})`);
    }

    const strategyId = get('strategyId') || null;
    const hasError = msgs.some((m) => m.level === 'error');
    let status = hasError ? 'rejected' : msgs.length ? 'warning' : 'ok';
    let fill = null;
    if (!hasError) {
      fill = { id, ts: tsRes.iso, underlying, symbol, optType, strike, expiry, side, qty, price, charges, strategyId };
      const key = [fill.ts, symbol, side, qty, price, strategyId ?? ''].join('|');
      if (contentFirstLine.has(key)) {
        msgs.push({ level: 'warning', field: 'row', text: `identical to row ${contentFirstLine.get(key)} (same time, symbol, side, qty and price); possible duplicate`, duplicateOf: contentFirstLine.get(key) });
        status = 'warning';
      } else contentFirstLine.set(key, line);
      if (excludeLines.has(line)) status = 'excluded';
    }
    if (!idFirstLine.has(id)) idFirstLine.set(id, line);
    if (status !== 'rejected' && status !== 'excluded') fills.push(fill);
    // Only rows that are actually imported count toward the timezone note.
    if (tsRes.assumedIst && (status === 'ok' || status === 'warning')) assumedIst++;
    out.push({ line, status, messages: msgs, fill });
  });
  const summary = {
    total: table.rows.length,
    read: rows.length,
    truncated: table.rows.length > rows.length,
    accepted: out.filter((r) => r.status === 'ok' || r.status === 'warning').length,
    rejected: out.filter((r) => r.status === 'rejected').length,
    excluded: out.filter((r) => r.status === 'excluded').length,
    withWarnings: out.filter((r) => r.status === 'warning').length,
    suspectedDuplicates: out.filter((r) => r.messages.some((m) => m.duplicateOf)).map((r) => r.line),
    duplicateIds: out.filter((r) => r.messages.some((m) => m.field === 'id' && m.level === 'error')).map((r) => r.line),
    // Only rows that will be imported (ok / warning); excluded duplicates are not counted.
    missingCharges: out.filter((r) => (r.status === 'ok' || r.status === 'warning') && r.fill && r.fill.charges === null).length,
    assumedIst,
  };
  const notes = [];
  if (assumedIst) notes.push(`${assumedIst} timestamp${assumedIst === 1 ? '' : 's'} had no timezone and ${assumedIst === 1 ? 'was' : 'were'} read as IST (UTC+05:30).`);
  if (summary.truncated) notes.push(`Only the first ${LIMITS.maxRows.toLocaleString('en-IN')} rows were read.`);
  return { fills, rows: out, summary, notes };
}

// Strict parse used for canonical files (template, sample downloads, round-trips).
// Returns { fills, errors: [{row, message}], warnings: [{row, message}], fatal, summary }.
export function parseCsv(text) {
  const table = readTable(text);
  if (!table.header.length) return { fills: [], errors: [{ row: 0, message: 'The file is empty.' }], warnings: [], fatal: true };
  const mapping = exactMapping(table.header);
  const problems = mappingProblems(mapping, STRICT_REQUIRED);
  if (problems.length) return { fills: [], errors: [{ row: 1, message: problems[0] }], warnings: [], fatal: true };
  const res = validateRows(table, mapping);
  return {
    fills: res.fills,
    errors: res.rows.filter((r) => r.status === 'rejected').map((r) => ({ row: r.line, message: r.messages.filter((m) => m.level === 'error').map((m) => m.text).join('; ') })),
    warnings: res.rows.filter((r) => r.status === 'warning').map((r) => ({ row: r.line, message: r.messages.map((m) => m.text).join('; ') })),
    fatal: false,
    summary: res.summary,
  };
}

export function toCsv(fills) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [COLUMNS.join(','), ...fills.map((f) => COLUMNS.map((c) => cell(f[c])).join(','))].join('\n');
}

export const TEMPLATE_CSV = [
  COLUMNS.join(','),
  'F1,2026-09-01T09:31:00+05:30,NIFTY,NIFTY 08SEP26 24800 CE,CE,24800,2026-09-08,BUY,150,112.5,20,',
  'F2,2026-09-01T09:52:00+05:30,NIFTY,NIFTY 08SEP26 24800 CE,CE,24800,2026-09-08,SELL,150,131,20,',
  'F3,2026-09-01T10:40:00+05:30,NIFTY,NIFTY 08SEP26 24900 CE,CE,24900,2026-09-08,SELL,75,60,20,S1',
  'F4,2026-09-01T10:40:00+05:30,NIFTY,NIFTY 08SEP26 25000 CE,CE,25000,2026-09-08,BUY,75,25,20,S1',
  'F5,2026-09-01T11:05:00+05:30,NIFTY,NIFTY 08SEP26 24900 CE,CE,24900,2026-09-08,BUY,75,30,20,S1',
  'F6,2026-09-01T11:05:00+05:30,NIFTY,NIFTY 08SEP26 25000 CE,CE,25000,2026-09-08,SELL,75,12,20,S1',
].join('\n');
