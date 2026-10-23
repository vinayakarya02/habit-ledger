// Import trades: a CSV wizard (choose file → map columns → review → done), the imports held in
// this tab, and the data-quality note for the dataset under review. Pure render of state: every
// count comes from the wizard's readTable / validateRows output, importSummary or the engine.

import { esc, button, chip, stat, panel, callout, pageHeader, select, table, missing, sr } from '../ui/components.js';
import { getDataset, listDatasets, selectAnalysis, selectQuality } from '../store.js';
import { FIELDS, COLUMNS, LIMITS, TEMPLATE_CSV, mappingProblems } from '../import.js';
import { periodsOf, buildPositions } from '../engine.js';
import { formatDate, formatTime, formatPrice, plural, isNum, MISSING } from '../format.js';

const PREVIEW_ROWS = 30;
const REJECTED_ROWS = 100;
const REQUIRED = COLUMNS.filter((f) => FIELDS[f].required);

const STEPS = ['Choose file', 'Map columns', 'Review', 'Done'];
const STEP_INDEX = { start: 0, reading: 0, mapping: 1, preview: 2, done: 3 };

// Focus across steps. main.js restores focus to the element whose id matches the one that had focus
// before the render. So a control that moves the wizard to another step carries the id of the element
// that should take focus there (usually that step's heading). The two are never on the page together.
const FOCUS_START = 'import-start'; // "Choose file" heading. Carried by Cancel and "Import another file".
const FOCUS_MAPPING = 'import-file'; // The file input on step 1, then the reading status, then the "Map columns" heading. Carried by "Back to mapping".
const FOCUS_REVIEW = 'import-review'; // "Review rows" heading. Carried by "Check rows".
const focusTitle = (id, label) => `<span class="imp-focus" id="${id}" tabindex="-1">${esc(label)}</span>`;

const count = (n) => (isNum(n) ? n.toLocaleString('en-IN') : MISSING);
const noun = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const rows = (n) => `${count(n)} ${noun(n, 'row')}`;
// "all 12 rows" / "the 1 row", for sentences that describe a whole set.
const allRows = (n) => (n === 1 ? 'the 1 row' : `all ${rows(n)}`);
const orders = (n) => `${count(n)} ${noun(n, 'order')}`;
const leftOut = (n) => `${count(n)} left out as ${noun(n, 'a suspected duplicate', 'suspected duplicates')}`;

// Rows the import will actually hold: accepted, with or without warnings. Rejected and left-out rows are not imported.
const importedRows = (result) => result.rows.filter((x) => x.status === 'ok' || x.status === 'warning');

function formatBytes(n) {
  if (!isNum(n) || n < 0) return MISSING;
  if (n < 1024) return plural(n, 'byte');
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(kb / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

const DELIMITER = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab' };

// A file header as shown in the column picker; blank or repeated names get their position.
function columnName(header, i) {
  const name = header[i];
  if (!name) return `Column ${i + 1} (no header)`;
  return header.indexOf(name) !== header.lastIndexOf(name) ? `${name} (column ${i + 1})` : name;
}

// A raw cell from the file, shown verbatim. Blank cells say so; nothing is filled in.
// Invalid cells get a wavy underline as well as colour, plus a screen-reader note.
function rawCell(v, { bad = false } = {}) {
  const s = String(v ?? '').trim();
  const body = s ? `<code class="imp-raw" title="${esc(s)}">${esc(s)}</code>` : '<span class="imp-raw is-blank">blank</span>';
  return bad ? `<span class="imp-bad" title="Invalid value. See the notes for this row.">${body}${sr(' (invalid)')}</span>` : body;
}

// A rejection message without the row-specific parts ("(got …)", quoted values, "(first used on row n)"),
// so rows that fail in the same way are counted together.
const messageKind = (t) => String(t).replace(/\s*\((?:got|first used)[^)]*\)/g, '').replace(/"[^"]*"/g, '…').replace(/\s+/g, ' ').trim();

// Rejected rows per field, and within a field per kind of message. A row counts once per field.
function rejectionsByField(rejected) {
  const byField = new Map();
  for (const r of rejected) {
    const seen = new Set();
    for (const m of r.messages) {
      if (m.level !== 'error' || seen.has(m.field)) continue;
      seen.add(m.field);
      const entry = byField.get(m.field) ?? { field: m.field, n: 0, kinds: new Map() };
      entry.n++;
      const k = messageKind(m.text);
      entry.kinds.set(k, (entry.kinds.get(k) ?? 0) + 1);
      byField.set(m.field, entry);
    }
  }
  return [...byField.values()].sort((a, b) => b.n - a.n || a.field.localeCompare(b.field));
}

// Rows per field for messages of one level (a row counts once per field).
function countByField(resultRows, level) {
  const out = new Map();
  for (const r of resultRows) {
    for (const f of new Set(r.messages.filter((m) => m.level === level).map((m) => m.field))) out.set(f, (out.get(f) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const listText = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(''));

const fieldLabel = (f) => (f === 'row' ? 'Whole row' : FIELDS[f]?.label ?? f);

// The files behind an imported trader. Imports made before files were tracked have only fileName.
const filesOf = (ds) => {
  const s = ds.importSummary ?? {};
  return s.files?.length ? s.files : [{ fileName: s.fileName ?? ds.name, accepted: s.accepted, rejected: s.rejected }];
};

// Months with closed trades, as listed in the "Import as" choice.
const monthsText = (ds) => {
  const months = periodsOf(ds.fills).map((p) => p.label);
  return months.length ? listText(months) : 'no closed trades yet';
};

// The trader the checked rows will be added to, or null for a new trader. A target removed since it was
// chosen falls back to a new trader, exactly as confirmImport does.
const targetOf = (state, w) => (w.target && w.target !== 'new' ? state.imports[w.target] ?? null : null);

// What adding to an existing trader does with this file's orders: orders whose ID is already there are skipped.
function addPlan(fills, existing) {
  if (!existing) return { added: fills, skipped: 0 };
  const have = new Set(existing.fills.map((f) => f.id));
  const added = fills.filter((f) => !have.has(f.id));
  return { added, skipped: fills.length - added.length };
}

// Positions the review will leave out once the file is imported: engine.buildPositions over the orders the
// trader will hold. When adding to an existing trader, positions are rebuilt over both files (a closing order
// may be in the other file, and this file's orders can also re-pair the trader's own) and the ones that were
// not already left out before are counted.
const positionKey = (x) => x.fills.map((f) => f.id).join('|');
function leftOutPositions(fills, existing, added) {
  if (!existing) return buildPositions(fills).excluded;
  const before = new Set(buildPositions(existing.fills).excluded.map(positionKey));
  return buildPositions([...existing.fills, ...added]).excluded.filter((x) => !before.has(positionKey(x)));
}

const OPEN_REASON = /^Still open/;
const LEFT_OUT_SHOWN = 5;

function leftOutCallout(excluded) {
  if (!excluded.length) return '';
  const describe = (xs) => {
    const shown = xs.slice(0, LEFT_OUT_SHOWN).map((x) => `${esc(x.symbol)} (opened ${esc(formatDate(x.fills[0].ts.slice(0, 10)))})`);
    const more = xs.length - shown.length;
    return `${listText(more ? [...shown, `${count(more)} more`] : shown)}`;
  };
  const open = excluded.filter((x) => OPEN_REASON.test(x.reason));
  const other = excluded.filter((x) => !OPEN_REASON.test(x.reason));
  const openText = (n) => `because ${n === 1 ? 'its closing order is' : 'their closing order is'} missing or was rejected`;
  const n = excluded.length;
  const lines = [];
  if (open.length) lines.push(`${other.length ? `${plural(open.length, 'position')} ${openText(open.length)}` : 'Contracts'}: ${describe(open)}.`);
  // Any other engine reason (a position that flipped direction in one order), in the engine's own words.
  const byReason = new Map();
  for (const x of other) byReason.set(x.reason, [...(byReason.get(x.reason) ?? []), x]);
  for (const [reason, xs] of byReason) lines.push(`${plural(xs.length, 'position')} for this reason: ${esc(reason.replace(/;\s*excluded\.?$/i, ''))}. Contracts: ${describe(xs)}.`);
  const title = other.length
    ? `${plural(n, 'position')} will be left out of the review`
    : `${plural(n, 'position')} will be left out ${openText(n)}`;
  return callout({
    tone: 'warn',
    title,
    body: `${lines.length === 1 ? `<p>${lines[0]}</p>` : `<ul class="imp-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`}
      <p>${n === 1 ? 'It is' : 'They are'} not in any figure. A position still open at the end of this file is reviewed once its closing order is added to the same trader from another file.</p>`,
  });
}

// ---------- stepper ----------

function stepper(step) {
  const cur = STEP_INDEX[step] ?? 0;
  const finished = step === 'done';
  const items = STEPS.map((label, i) => {
    const done = finished || i < cur;
    const current = i === cur;
    const cls = done ? 'is-done' : current ? 'is-current' : '';
    const state = done ? 'completed' : current ? 'current step' : 'not started';
    return `<li${cls ? ` class="${cls}"` : ''}${current ? ' aria-current="step"' : ''}>${esc(label)}${sr(` (${state})`)}</li>`;
  }).join('');
  return `<ol class="stepper" aria-label="Import steps">${items}</ol>`;
}

// ---------- step 1: choose a file ----------

function startStep(state, w) {
  const samples = listDatasets(state).filter((d) => d.kind === 'sample');
  const hasImports = Object.keys(state.imports).length > 0;
  const templateRows = TEMPLATE_CSV.split('\n').length - 1;
  const error = w.error ? callout({ tone: 'danger', title: 'This file could not be imported', body: `<p>${esc(w.error)}</p><p>Nothing was imported. Choose another file, or start from the template.</p>` }) : '';

  const drop = `<div class="imp-drop">
      <label class="imp-drop-face" for="import-file">
        <span class="imp-drop-title">Choose a CSV file</span>
        <span class="imp-drop-sub">or drop it here</span>
        <span class="btn btn-primary imp-drop-btn" aria-hidden="true">Browse files</span>
      </label>
      <input type="file" id="import-file" class="imp-drop-input" data-action="importFile" accept=".csv,text/csv" aria-describedby="import-file-limits">
    </div>
    <ul class="imp-limits" id="import-file-limits">
      <li>One row per executed order (a fill), options only. Futures and equity rows are rejected.</li>
      <li>Up to ${esc(formatBytes(LIMITS.maxBytes))} and ${count(LIMITS.maxRows)} rows per file. Split a larger file into smaller files and add each one to the same trader.</li>
      <li>A header row, then comma-, semicolon- or tab-separated values.</li>
      <li>Read in this browser tab only. Not uploaded, not sent to Nubra or any broker.</li>
      ${hasImports ? '<li>Adding another month to a trader you imported? Choose its file here, then pick that trader under “Import as” in the Review step.</li>' : ''}
    </ul>`;

  const personaItems = samples.map((d) => {
    const ds = getDataset(state, d.id);
    const months = periodsOf(ds.fills).map((p) => p.label);
    return `<li class="imp-persona">
        <div class="imp-persona-head"><span class="imp-persona-name">${esc(d.name)}</span>${chip('Synthetic', 'warn')}</div>
        ${button('Download CSV', { action: 'downloadSample', data: { id: d.id }, size: 'sm', ariaLabel: `Download ${d.name}'s sample CSV` })}
        <p class="imp-persona-meta">${esc(d.style)}. ${orders(ds.fills.length)}${months.length ? `, ${esc(listText(months))}` : ''}.</p>
      </li>`;
  }).join('');

  const help = panel({
    title: 'No file to hand?',
    subtitle: 'Start from a file in the expected format.',
    body: `<div class="imp-help">
        <div class="imp-help-block">
          <h3 class="imp-h3">Template</h3>
          <p class="small muted">The expected header and ${plural(templateRows, 'example row')}, including a spread whose legs share a Strategy ID.</p>
          ${button('Download template', { action: 'downloadTemplate' })}
        </div>
        <div class="imp-help-block">
          <h3 class="imp-h3">Sample traders</h3>
          <p class="small muted">The synthetic fills behind each sample trader. Import one back to see how a file is checked.</p>
          <ul class="imp-personas">${personaItems}</ul>
        </div>
      </div>`,
  });

  const columns = table({
    caption: 'Columns Habit Ledger expects in an imported CSV',
    columns: [{ key: 'col', label: 'Column' }, { key: 'field', label: 'Field' }, { key: 'req', label: 'Required' }, { key: 'help', label: 'What it holds' }],
    rows: COLUMNS.map((f) => [
      `<code>${esc(f)}</code>`,
      esc(FIELDS[f].label),
      FIELDS[f].required ? chip('Required', 'accent') : '<span class="muted">Optional</span>',
      `<span class="imp-help-text">${esc(FIELDS[f].help)}</span>`,
    ]),
  });

  return `${error}
    <div class="grid grid-main-side">
      ${panel({ title: focusTitle(FOCUS_START, 'Choose file'), subtitle: 'A month of executed option orders exported from your broker.', body: drop })}
      ${help}
    </div>
    ${panel({ title: 'Expected columns', subtitle: `${REQUIRED.length} of ${COLUMNS.length} columns are required. Header names are matched automatically, including common broker variants such as "Trade Price" or "Buy/Sell"; you can change any match in the next step.`, body: columns })}`;
}

function readingStep(w) {
  const name = w.fileName ? `“${esc(w.fileName)}”` : 'your file';
  return panel({
    body: `<div class="imp-reading" id="${FOCUS_MAPPING}" tabindex="-1">
        <span class="imp-progress" aria-hidden="true"><span></span></span>
        <p class="imp-reading-title" data-announce>Reading ${name}…</p>
        <p class="small muted">The file is read in this browser tab. Nothing is uploaded.</p>
      </div>`,
  });
}

// ---------- step 2: map columns ----------

function fileFacts(w) {
  const t = w.table;
  const facts = [
    ['File', esc(w.fileName ?? MISSING)],
    ['Size', esc(formatBytes(w.size))],
    ['Data rows', `<span class="num">${count(t.rows.length)}</span>`],
    ['Columns', `<span class="num">${count(w.header.length)}</span>`],
    ['Separator', esc(DELIMITER[t.delimiter] ?? t.delimiter)],
  ];
  return `<dl class="imp-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

function mapRow(field, w, options) {
  const def = FIELDS[field];
  const col = w.mapping[field];
  const id = `import-map-${field}`;
  const unmapped = col == null;
  const missingReq = def.required && unmapped;
  const values = unmapped
    ? `<span class="muted small">${def.required ? 'Choose a column to see its values.' : 'Not mapped. Treated as not in the file.'}</span>`
    : `<span class="imp-vals">${w.table.rows.slice(0, 3).map((r) => rawCell(r[col])).join('')}</span>`;
  const picker = select({ id, label: `${def.label}${def.required ? ' (required)' : ''}: column in your file`, hideLabel: true, value: col ?? '', options, action: 'setMapping', data: { field, param: 'column' }, describedBy: missingReq ? `${id}-hint ${id}-err` : `${id}-hint` });
  // select() has no error state of its own; mark the unmapped required field the way input() does.
  const control = missingReq ? picker.replace('class="field', 'class="field has-error').replace('<select ', '<select aria-invalid="true" ') : picker;
  return `<li class="imp-map-row${missingReq ? ' is-missing' : ''}">
      <div class="imp-map-field">
        <div class="imp-map-name"><span>${esc(def.label)}</span><code class="imp-map-key">${esc(field)}</code>${def.required ? chip('Required', 'accent') : chip('Optional', 'muted')}</div>
        <p class="field-hint" id="${id}-hint">${esc(def.help)}</p>
      </div>
      <div class="imp-map-control">
        ${control}
        ${missingReq ? `<span class="field-error" id="${id}-err">Required. Pick the column that holds it.</span>` : ''}
      </div>
      <div class="imp-map-sample"><span class="imp-cell-label">First values</span>${values}</div>
    </li>`;
}

function mappingStep(w) {
  const t = w.table;
  const options = [{ value: '', label: '— Not in file —' }, ...w.header.map((_, i) => ({ value: i, label: columnName(w.header, i) }))];
  const mappedCount = COLUMNS.filter((f) => w.mapping[f] != null).length;
  const used = new Set(COLUMNS.map((f) => w.mapping[f]).filter((i) => i != null));
  const unused = w.header.map((_, i) => i).filter((i) => !used.has(i));
  const blocked = w.problems.length > 0;

  // w.problems decides whether the step is blocked. The text is rebuilt here with field labels:
  // unmapped required fields from the mapping, plus the remaining problems (a column used twice).
  const unmappedReq = REQUIRED.filter((f) => w.mapping[f] == null);
  const problemLines = [
    ...(unmappedReq.length ? [`Not mapped yet: ${listText(unmappedReq.map((f) => FIELDS[f].label))}. Pick the column in your file that holds ${unmappedReq.length === 1 ? 'it' : 'each one'}.`] : []),
    ...mappingProblems(w.mapping, []),
  ];
  const shownProblems = problemLines.length ? problemLines : w.problems;
  const status = blocked
    ? callout({
      tone: 'warn',
      title: 'Fix the mapping to continue',
      body: `<ul class="imp-list">${shownProblems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        ${unmappedReq.length ? `<div class="imp-callout-foot"><p>If your file has no such column, it cannot be imported as it is. The template shows the expected header.</p>${button('Download template', { action: 'downloadTemplate', size: 'sm' })}</div>` : ''}`,
    })
    : callout({ tone: 'ok', title: `All ${REQUIRED.length} required fields are mapped`, body: `<p>${mappedCount} of ${COLUMNS.length} fields are mapped. Optional fields left unmapped are treated as not in the file, never as zero.</p>` });

  const tooMany = t.rows.length > LIMITS.maxRows
    ? callout({ tone: 'warn', title: `Only the first ${count(LIMITS.maxRows)} rows will be checked`, body: `<p>This file has ${rows(t.rows.length)}. To review the rest, split it into smaller files and add each one to the same trader.</p>` })
    : '';

  const unusedNote = unused.length
    ? `<p class="small muted imp-unused">Not used from your file: ${unused.map((i) => `<code>${esc(columnName(w.header, i))}</code>`).join(' ')}</p>`
    : '';

  const body = `${fileFacts(w)}
    <div class="imp-stack">
      ${tooMany}
      <div data-announce>${status}</div>
      <div class="imp-map">
        <div class="imp-map-head" aria-hidden="true"><span>Field</span><span>Column in your file</span><span>First values in that column</span></div>
        <ul class="imp-map-list">${COLUMNS.map((f) => mapRow(f, w, options)).join('')}</ul>
      </div>
      ${unusedNote}
      <div class="imp-actions">
        <div class="btn-row">
          ${button('Check rows', { action: 'validateImport', variant: 'primary', disabled: blocked, id: FOCUS_REVIEW })}
          ${button('Cancel', { action: 'cancelImport', variant: 'ghost', id: FOCUS_START })}
        </div>
        <p class="small muted">Checking reads every row against these rules. Nothing is imported until you confirm.</p>
      </div>
    </div>`;

  return panel({ title: focusTitle(FOCUS_MAPPING, 'Map columns'), subtitle: 'Matched from your header where possible. Check each match against the first values from your file.', body });
}

// ---------- step 3: review ----------

const WARNING_TEXT = {
  charges: ['Charges blank', 'Imported. Net P&L for these trades excludes charges and is flagged. A blank is never read as ₹0.'],
  expiry: ['Expiry not in YYYY-MM-DD', 'Imported. The expiry is shown as missing.'],
  row: ['Identical to an earlier row', 'Same time, contract, side, quantity and price as an earlier row. See the choice below.'],
};

function reasonList(entries, describe) {
  return `<ul class="imp-reasons">${entries.map(([field, n]) => {
    const [title, text] = describe(field);
    return `<li><span class="imp-count num">${count(n)}</span><div><strong>${esc(title)}</strong>${text ? `<p class="small muted">${esc(text)}</p>` : ''}</div></li>`;
  }).join('')}</ul>`;
}

const KINDS_SHOWN = 4;

// Rejection reasons: rows per field, then how they failed (blank, not a number, …) with row counts.
function rejectionList(groups) {
  return `<ul class="imp-reasons">${groups.map((g) => {
    const kinds = [...g.kinds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const shown = kinds.slice(0, KINDS_SHOWN);
    const rest = kinds.slice(KINDS_SHOWN).reduce((s, [, n]) => s + n, 0);
    const detail = kinds.length === 1
      ? `<p class="small muted">${esc(kinds[0][0])}</p>`
      : `<ul class="imp-kinds">${shown.map(([k, n]) => `<li><span class="num">${rows(n)}</span>: ${esc(k)}</li>`).join('')}${rest ? `<li>${rows(rest)} with other messages, listed in the table below</li>` : ''}</ul>`;
    return `<li><span class="imp-count num">${count(g.n)}</span><div><strong>${esc(fieldLabel(g.field))}</strong>${detail}</div></li>`;
  }).join('')}</ul>`;
}

function messageList(messages) {
  if (!messages.length) return '<span class="muted">None</span>';
  return `<ul class="imp-msgs">${messages.map((m) => `<li class="imp-msg-${m.level === 'error' ? 'error' : 'warning'}">${sr(m.level === 'error' ? 'Error: ' : 'Warning: ')}${esc(m.text)}</li>`).join('')}</ul>`;
}

const STATUS_CHIP = { ok: ['Accepted', 'ok'], warning: ['Warning', 'warn'], rejected: ['Rejected', 'danger'], excluded: ['Left out', 'muted'] };

function previewTable(w) {
  const r = w.result;
  const shown = r.rows.slice(0, PREVIEW_ROWS);
  const body = shown.map((row, i) => {
    const [label, tone] = STATUS_CHIP[row.status] ?? [row.status, 'neutral'];
    const f = row.fill;
    if (f && row.status !== 'rejected') {
      return [
        `<span class="num">${row.line}</span>`,
        chip(label, tone),
        `<span class="num">${esc(formatDate(f.ts.slice(0, 10)))} ${esc(formatTime(f.ts))}</span>`,
        `<span class="imp-symbol">${esc(f.symbol)}</span>`,
        esc(f.side),
        `<span class="num">${count(f.qty)}</span>`,
        `<span class="num">${esc(formatPrice(f.price))}</span>`,
        f.charges === null ? missing('Blank in the file. Net P&L for this trade excludes charges.') : `<span class="num">${esc(formatPrice(f.charges))}</span>`,
        messageList(row.messages),
      ];
    }
    const cells = w.table.rows[i] ?? [];
    const bad = new Set(row.messages.filter((m) => m.level === 'error').map((m) => m.field));
    const raw = (field) => rawCell(w.mapping[field] == null ? '' : cells[w.mapping[field]], { bad: bad.has(field) });
    return [`<span class="num">${row.line}</span>`, chip(label, tone), raw('ts'), raw('symbol'), raw('side'), raw('qty'), raw('price'), raw('charges'), messageList(row.messages)];
  });
  return table({
    caption: `First ${shown.length} rows of ${w.fileName ?? 'the file'} with their check result`,
    columns: [{ key: 'line', label: 'Row' }, { key: 'status', label: 'Status' }, { key: 'ts', label: 'Time (IST)' }, { key: 'symbol', label: 'Contract' }, { key: 'side', label: 'Side' }, { key: 'qty', label: 'Qty', align: 'right' }, { key: 'price', label: 'Price', align: 'right' }, { key: 'charges', label: 'Charges', align: 'right' }, { key: 'msgs', label: 'Notes' }],
    rows: body,
    rowAttrs: (i) => (shown[i].status === 'excluded' ? ' class="is-excluded"' : shown[i].status === 'rejected' ? ' class="imp-row-rejected"' : ''),
    id: 'import-preview-table',
  });
}

function reviewStep(state, w) {
  const r = w.result;
  const s = r.summary;
  const n = r.fills.length;
  const dupCount = s.suspectedDuplicates.length;
  // Counted over imported rows only: rows left out as duplicates are not imported, so their blank
  // charges or warnings are not part of the import (summary.missingCharges still counts them).
  const imported = importedRows(r);
  const missingCharges = imported.filter((x) => x.fill && x.fill.charges === null).length;

  const stats = `<div class="imp-stats">
      ${stat({ label: 'Rows read', value: count(s.read), sub: s.truncated ? `of ${count(s.total)} in the file` : 'every data row in the file' })}
      ${stat({ label: 'Accepted', value: count(s.accepted), sub: s.excluded ? `after leaving out ${count(s.excluded)} ${noun(s.excluded, 'duplicate')}` : s.accepted ? 'ready to import' : 'nothing to import' })}
      ${stat({ label: 'Rejected', value: count(s.rejected), sub: s.rejected ? 'not imported; reasons below' : 'none' })}
      ${stat({ label: 'With warnings', value: count(s.withWarnings), sub: s.withWarnings ? 'imported and flagged' : 'none' })}
      ${stat({ label: 'Suspected duplicates', value: count(dupCount), sub: dupCount ? (w.excludeDuplicates ? 'left out by you' : 'kept by default') : 'none found' })}
      ${stat({ label: 'Missing charges', value: count(missingCharges), sub: missingCharges ? `imported ${noun(missingCharges, 'row')}; net P&L excludes ${noun(missingCharges, 'its charges', 'their charges')}` : s.accepted ? 'charges on every imported row' : 'nothing to import' })}
    </div>`;

  const arithmetic = `<p class="small muted imp-sum" data-announce><span class="num">${count(s.read)}</span> read = <span class="num">${count(s.accepted)}</span> accepted + <span class="num">${count(s.rejected)}</span> rejected${s.excluded ? ` + <span class="num">${count(s.excluded)}</span> left out as ${noun(s.excluded, 'a duplicate', 'duplicates')}` : ''}.</p>`;

  const notes = r.notes.length ? callout({ tone: 'info', title: 'How the file was read', body: `<ul class="imp-list">${r.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` }) : '';

  // Where the rows go: a new trader, or added to a trader imported earlier (store.setImportTarget).
  const imports = listDatasets(state).filter((d) => d.kind === 'import').map((d) => getDataset(state, d.id));
  const existing = targetOf(state, w);
  const { added, skipped } = addPlan(r.fills, existing);
  const nAdd = added.length;
  // Without a mapped ID column an order's ID is its row number, so a match in the other trader may or may not be the same order.
  const idClash = existing && w.mapping?.id == null && skipped > 0;
  const fileLabel = w.fileName ? `“${esc(w.fileName)}”` : 'this file';
  const targetHint = existing
    ? `Adding keeps ${existing.name}'s guardrails and lets Compare use both months. Orders whose ID is already in ${existing.name} are skipped${idClash ? '' : skipped ? `: ${plural(skipped, 'order')} in this file ${skipped === 1 ? 'is' : 'are'} already there` : '; none of this file\'s orders are there yet'}.`
    : 'A new trader starts with no guardrails. To keep a trader\'s guardrails and let Compare use both months, add the file to that trader instead; orders whose ID is already there are skipped.';
  const targetControl = imports.length
    ? `<div class="imp-target">${select({
      id: 'import-target',
      label: 'Import as',
      value: existing ? existing.id : 'new',
      options: [{ value: 'new', label: 'A new trader' }, ...imports.map((ds) => ({ value: ds.id, label: `Add to ${ds.name} (${monthsText(ds)})` }))],
      action: 'setImportTarget',
      data: { param: 'target' },
      hint: targetHint,
      error: idClash ? `This file has no order ID column mapped, so each order's ID is its row number, and ${count(skipped)} of those numbers ${skipped === 1 ? 'is' : 'are'} already used in ${existing.name}. Adding would skip ${skipped === 1 ? 'that order even if it is a different order' : 'those orders even if they are different orders'}, because a row number cannot tell them apart. Import it as a new trader, or go back and map the ID column.` : '',
    })}</div>`
    : '';

  // With an ID clash the file can only be imported as a new trader, so its left-out positions are counted that way.
  const leftOutNote = n > 0 ? leftOutCallout(leftOutPositions(r.fills, idClash ? null : existing, added)) : '';

  const ready = n === 0
    ? callout({ tone: 'danger', title: 'No rows can be imported', body: '<p>Every row was rejected or left out. Go back to check the column mapping, or fix the file and choose it again.</p>' })
    : idClash
      ? callout({ tone: 'warn', title: `${rows(n)} checked, but not ready to add to ${esc(existing.name)}`, body: '<p>Choose “A new trader” under “Import as” above, or go back to mapping and pick the column that holds the order ID.</p>' })
    : existing && nAdd === 0
      ? callout({ tone: 'warn', title: `Every order in ${fileLabel} is already in ${esc(existing.name)}`, body: '<p>Nothing would be added. Choose “A new trader” above to import it separately, or cancel.</p>' })
      : existing
        ? callout({ tone: 'ok', title: `${rows(nAdd)} ready to add to ${esc(existing.name)}`, body: `<p>${esc(existing.name)} becomes the trader under review, with its guardrails kept. The data stays in this browser tab, and you can remove the trader at any time.</p>` })
        : callout({ tone: 'ok', title: `${rows(n)} ready to import`, body: '<p>The import stays in this browser tab and becomes the trader under review. You can remove it at any time.</p>' });

  const confirmLabel = existing ? `Add ${rows(idClash ? n : nAdd)} to ${existing.name}` : `Import ${rows(n)} as a new trader`;
  const actions = `<div class="btn-row">
      ${button(confirmLabel, { action: 'confirmImport', variant: 'primary', disabled: n === 0 || (existing && nAdd === 0) || idClash })}
      ${button('Back to mapping', { action: 'backToMapping', id: FOCUS_MAPPING })}
      ${button('Cancel', { action: 'cancelImport', variant: 'ghost', id: FOCUS_START })}
    </div>`;

  const summaryPanel = panel({
    title: focusTitle(FOCUS_REVIEW, 'Review rows'),
    subtitle: `${esc(w.fileName ?? 'Your file')} · checked against the column rules`,
    body: `<div class="imp-stack">${stats}${arithmetic}${notes}${leftOutNote}${targetControl}${ready}${actions}</div>`,
  });

  // Warnings: imported, but flagged. Counted per row and field over imported rows only.
  const warnEntries = countByField(imported, 'warning');
  const warnTotal = warnEntries.reduce((t, [, k]) => t + k, 0);
  const warnOverlap = warnTotal > s.withWarnings
    ? `<p class="small muted">A row can carry more than one warning, so these counts add up to ${count(warnTotal)}, more than the ${rows(s.withWarnings)} with warnings.</p>`
    : '';
  const dupLines = r.rows.filter((x) => x.messages.some((m) => m.duplicateOf));
  const dupText = dupLines.slice(0, 10).map((x) => `row ${x.line} (same as row ${x.messages.find((m) => m.duplicateOf).duplicateOf})`).join(', ');
  const dupMore = dupLines.length > 10 ? ` and ${count(dupLines.length - 10)} more` : '';
  const dupControl = dupCount
    ? `<div class="imp-dups">
        <label class="check" for="import-excl-dups"><input type="checkbox" id="import-excl-dups" data-action="toggleExcludeDuplicates"${w.excludeDuplicates ? ' checked' : ''} aria-describedby="import-excl-dups-hint import-excl-dups-rows"> Leave out ${dupCount === 1 ? 'the suspected duplicate row' : `the ${count(dupCount)} suspected duplicate rows`}</label>
        <p class="field-hint" id="import-excl-dups-hint">Identical rows can be genuine partial fills of one order, so they are kept by default. Leave them out only if you know your export repeats rows.</p>
        <p class="field-hint imp-dups-rows" id="import-excl-dups-rows"><strong>${w.excludeDuplicates ? 'Left out, not imported' : 'Kept and imported'}:</strong> ${esc(dupText)}${dupMore}.</p>
      </div>`
    : '';
  const warningsPanel = warnEntries.length || dupCount
    ? panel({
      title: 'Warnings',
      subtitle: warnEntries.length
        ? 'These rows are imported. The issues are flagged wherever the affected trades appear.'
        : 'No imported row carries a warning. The suspected duplicates are left out, as chosen below.',
      tone: 'warn',
      body: `<div class="imp-stack">${warnEntries.length ? reasonList(warnEntries, (f) => WARNING_TEXT[f] ?? [fieldLabel(f), '']) : ''}${warnOverlap}${dupControl}</div>`,
    })
    : '';

  // Rejected rows: never imported, never coerced.
  const rejected = r.rows.filter((x) => x.status === 'rejected');
  // data-source="wizard": main.js downloads the rejected rows of this file, the one in the Review step.
  const fileText = w.fileName ?? 'this file';
  const downloadNote = `<p class="small muted imp-dl-note">The download is a CSV of ${allRows(rejected.length)} rejected from ${fileLabel}: the row number, the file name and the reasons for each. It is made in this tab; nothing is uploaded.</p>`;
  const groups = rejectionsByField(rejected);
  const reasonTotal = groups.reduce((t, g) => t + g.n, 0);
  const rejectedPanel = rejected.length
    ? panel({
      title: 'Rejected rows',
      subtitle: 'Not imported, and none of their values are used anywhere. Blank or invalid values are never replaced with ₹0 or a default.',
      tone: 'danger',
      actions: `<div class="imp-dl">${button(`Download rejected rows of “${fileText}”`, { action: 'downloadRejected', data: { source: 'wizard' }, size: 'sm', ariaLabel: `Download the ${rows(rejected.length)} rejected from ${fileText} as CSV` })}</div>`,
      body: `<div class="imp-stack">
          ${downloadNote}
          <div>
            <h3 class="imp-h3">Reasons</h3>
            ${rejectionList(groups)}
            ${reasonTotal > rejected.length ? `<p class="small muted imp-after">A row can fail on more than one field, so these counts add up to ${count(reasonTotal)}, more than the ${rows(rejected.length)} rejected.</p>` : ''}
            <p class="small muted imp-after">If a rejected row was one side of a trade, the other side is left without a match, so that position is left out of the review.${leftOutNote ? ' The positions this file leaves out are listed under Review rows above.' : n > 0 && !(existing && nAdd === 0 && !idClash) ? ' No position in this file is left out.' : ''}</p>
          </div>
          ${table({
            caption: 'Rejected rows and the reasons',
            columns: [{ key: 'line', label: 'Row' }, { key: 'reasons', label: 'Reasons' }],
            rows: rejected.slice(0, REJECTED_ROWS).map((x) => [`<span class="num">${x.line}</span>`, messageList(x.messages.filter((m) => m.level === 'error'))]),
            id: 'import-rejected-table',
          })}
          ${rejected.length > REJECTED_ROWS ? `<p class="small muted">Showing the first ${count(REJECTED_ROWS)} of ${count(rejected.length)} rejected rows. The download has all of them.</p>` : ''}
        </div>`,
    })
    : '';

  const shownCount = Math.min(PREVIEW_ROWS, r.rows.length);
  const previewPanel = panel({
    title: `First ${shownCount} ${noun(shownCount, 'row')}`,
    subtitle: 'Accepted rows show values as they will be imported, with times in IST. Rejected rows show the text from your file unchanged; invalid values are underlined.',
    body: previewTable(w),
  });

  return `<div class="imp-stack">${summaryPanel}${warningsPanel}${rejectedPanel}${previewPanel}</div>`;
}

// ---------- step 4: done ----------

function doneStep(state, w) {
  const ds = w.lastImportId ? state.imports[w.lastImportId] : null;
  if (!ds) {
    return panel({
      title: 'Import removed',
      body: `<p>The file you imported last${w.fileName ? `, “${esc(w.fileName)}”,` : ''} has since been removed from this tab.</p>${button('Import another file', { action: 'cancelImport', variant: 'primary', id: FOCUS_START })}`,
    });
  }
  const s = ds.importSummary;
  const current = state.datasetId === ds.id;
  const periods = periodsOf(ds.fills);
  const byMonth = periods.length ? `Closed trades by month${s.files?.length > 1 ? ` in ${esc(ds.name)}` : ''}: ${periods.map((p) => `${esc(p.label)} (${count(p.trades)})`).join(', ')}.` : 'It contains no closed trades yet.';
  // The file just confirmed is the last one listed; more than one file means it was added to an existing trader.
  const files = filesOf(ds);
  const added = files.length > 1 ? files[files.length - 1] : null;
  const title = added ? `Added “${esc(added.fileName ?? w.fileName ?? 'the file')}” to ${esc(ds.name)}` : `Imported “${esc(s.fileName ?? ds.name)}”`;
  const summary = added
    ? `<span class="num">${count(added.accepted)}</span> ${noun(added.accepted, 'order')} added from this file${added.skipped ? `; <span class="num">${count(added.skipped)}</span> already there ${added.skipped === 1 ? 'was' : 'were'} skipped` : ''}${added.rejected ? `; <span class="num">${count(added.rejected)}</span> ${noun(added.rejected, 'row')} rejected` : ''}. ${esc(ds.name)} now holds ${orders(ds.fills.length)} from ${plural(files.length, 'file')}, and its guardrails are kept. ${byMonth}`
    : `<span class="num">${count(s.accepted)}</span> ${noun(s.accepted, 'order')} imported, one per accepted row${s.rejected ? `; <span class="num">${count(s.rejected)}</span> ${noun(s.rejected, 'row')} rejected` : ''}${s.excluded ? `; ${leftOut(s.excluded)}` : ''}. ${byMonth}`;
  // "Open overview" and "Put in review" share an id, so focus stays on the button when one replaces the other.
  return panel({
    title,
    tone: 'ok',
    body: `<div class="imp-stack">
        <p data-announce>${summary}</p>
        <p class="small muted">${current ? 'It is the trader under review now.' : 'Another trader is under review now.'} The data stays in this tab and is gone when you close or reload it.</p>
        <div class="btn-row">
          ${current ? button('Open overview', { action: 'navigate', data: { view: 'overview' }, variant: 'primary', id: 'import-done-primary' }) : button('Put in review', { action: 'selectDataset', data: { id: ds.id }, variant: 'primary', id: 'import-done-primary', ariaLabel: `Put ${ds.name} in review` })}
          ${button('Import another file', { action: 'cancelImport', id: FOCUS_START })}
        </div>
      </div>`,
  });
}

// ---------- imports held in this tab ----------

function importsPanel(state) {
  const list = listDatasets(state).filter((d) => d.kind === 'import');
  if (!list.length) return '';
  const sampleNames = listDatasets(state).filter((d) => d.kind === 'sample').map((d) => d.name);
  const items = list.map((d) => {
    const ds = getDataset(state, d.id);
    const s = ds.importSummary;
    const periods = periodsOf(ds.fills);
    const current = state.datasetId === d.id;
    const files = filesOf(ds);
    const fileItems = files.map((f) => {
      const parts = [orders(f.accepted), ...(f.rejected ? [`${rows(f.rejected)} rejected`] : []), ...(f.skipped ? [`${count(f.skipped)} already there, skipped`] : [])];
      return `<li><span class="imp-file-name">${esc(f.fileName ?? MISSING)}</span> <span class="muted">· ${parts.join(' · ')}</span></li>`;
    }).join('');
    const facts = [
      [files.length === 1 ? 'File' : `Files (${count(files.length)})`, `<ul class="imp-files">${fileItems}</ul>`],
      ['Orders imported', `<span class="num">${count(s.accepted)}</span>${s.excluded ? ` <span class="muted small">(${leftOut(s.excluded)})</span>` : ''}`],
      ['Rows rejected', `<span class="num">${count(s.rejected)}</span>`],
      ['Months covered (closed trades)', periods.length ? periods.map((p) => `<span class="imp-period">${esc(p.label)} <span class="muted">· ${plural(p.trades, 'trade')}</span></span>`).join('') : missing('No closed trades in these files')],
    ];
    const primaryId = `import-item-${d.id}`;
    const primary = current
      ? button('Open overview', { action: 'navigate', data: { view: 'overview' }, size: 'sm', id: primaryId })
      : button('Put in review', { action: 'selectDataset', data: { id: d.id }, size: 'sm', id: primaryId, ariaLabel: `Put ${d.name} in review` });
    return `<li class="imp-import${current ? ' is-current' : ''}">
        <div class="imp-import-main">
          <div class="imp-import-name"><strong>${esc(d.name)}</strong>${current ? chip('In review', 'accent') : ''}</div>
        </div>
        <dl class="imp-import-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <div class="btn-row imp-import-actions">${primary}${button('Remove', { action: 'removeImport', data: { id: d.id }, size: 'sm', variant: 'danger', ariaLabel: `Remove ${d.name} from this tab` })}</div>
      </li>`;
  }).join('');
  return panel({
    title: 'Your imports',
    subtitle: `The traders you imported and the files behind each, held in this tab's memory only: never uploaded, never sent to Nubra or any broker, and gone when you close or reload the tab. The sample traders${sampleNames.length ? ` (${esc(listText(sampleNames))})` : ''} use synthetic trades and are always available.`,
    body: `<ul class="imp-imports" id="import-list" aria-label="Traders imported in this tab">${items}</ul>`,
  });
}

// ---------- data quality of the dataset under review ----------

const QUALITY = { good: ['No issues found', 'ok'], attention: ['Needs attention', 'warn'], insufficient: ['Not enough data', 'danger'] };
const LEVEL_ORDER = { error: 0, warning: 1 };

function qualityPanel(state, step) {
  const ds = getDataset(state);
  const q = selectQuality(state);
  const a = selectAnalysis(state);
  const [statusText, tone] = QUALITY[q.status] ?? [q.status, 'neutral'];
  const importFiles = ds.kind === 'import' ? filesOf(ds) : [];
  const source = ds.kind === 'import'
    ? `Your import${importFiles.length > 1 ? ` of ${count(importFiles.length)} files` : importFiles[0]?.fileName ? ` “${esc(importFiles[0].fileName)}”` : ''}, held in this tab only`
    : 'Sample trader, synthetic trades';
  // Blocking items first; the order within a level is kept.
  const sorted = q.items.map((it, i) => ({ it, i })).sort((x, y) => (LEVEL_ORDER[x.it.level] ?? 2) - (LEVEL_ORDER[y.it.level] ?? 2) || x.i - y.i).map((x) => x.it);
  const items = sorted.length
    ? `<ul class="imp-quality">${sorted.map((it) => `<li>${chip(it.level === 'error' ? 'Blocking' : 'Warning', it.level === 'error' ? 'danger' : 'warn')}<span>${esc(it.text)}</span></li>`).join('')}</ul>`
    : '<p class="small">Nothing to flag for this period: enough closed trades to review, no positions left out, and charges recorded for every trade.</p>';

  // The panel is hidden while a file is mapped or reviewed (see render). While one is being read, say
  // plainly that this panel is about the trader under review, not that file.
  const fileName = state.importWizard.fileName;
  const wizardNote = step === 'reading'
    ? callout({ tone: 'info', body: `<p>This describes ${esc(ds.name)}, the trader under review, not ${fileName ? `“${esc(fileName)}”, ` : ''}the file being read above.</p>` })
    : '';

  let importFacts = '';
  const s = q.importSummary;
  if (ds.kind === 'import' && s) {
    // Blank charges are counted over the imported orders themselves, so rows left out as duplicates are not included.
    const blankCharges = ds.fills.filter((f) => f.charges === null).length;
    const facts = [
      ['Rows read', count(s.read)],
      ['Orders imported', count(s.accepted)],
      ['Rejected at import', count(s.rejected)],
      ['Left out as suspected duplicates', count(s.excluded)],
      ['Imported orders with blank charges', count(blankCharges)],
    ];
    // data-source="dataset": main.js downloads the rejected rows stored with the trader under review (every file).
    const files = filesOf(ds);
    const fileNames = files.map((f) => f.fileName).filter(Boolean);
    const multi = files.length > 1;
    const dlName = fileNames[0] ?? ds.name;
    // A trader built from several files is named without the curly quotes that mark file names.
    const filesWord = files.length === 2 ? 'both files' : `all ${count(files.length)} files`;
    const dlLabel = multi ? `Download rejected rows from ${filesWord} of ${ds.name}` : `Download rejected rows of “${dlName}”`;
    const dlNote = multi
      ? `A CSV of ${allRows(s.rejected)} rejected across the ${count(files.length)} files of ${esc(ds.name)} (${esc(listText(fileNames.map((x) => `“${x}”`)))}): the row number, the file name and the reasons for each.`
      : `A CSV of ${allRows(s.rejected)} rejected from “${esc(dlName)}” when it was imported: the row number, the file name and the reasons for each.`;
    importFacts = `<div class="imp-stack">
        <h3 class="imp-h3">At import</h3>
        <dl class="kv">${facts.map(([k, v]) => `<dt>${k}</dt><dd class="num">${v}</dd>`).join('')}</dl>
        ${s.notes?.length ? `<ul class="imp-list small muted">${s.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${s.rejected ? `<div class="imp-dl">${button(dlLabel, { action: 'downloadRejected', data: { source: 'dataset' }, size: 'sm', ariaLabel: `Download the ${rows(s.rejected)} rejected from ${multi ? `${filesWord} of ${ds.name}` : dlName} as CSV` })}<p class="small muted imp-dl-note">${dlNote}</p></div>` : ''}
      </div>`;
  }

  const body = importFacts ? `<div class="imp-quality-grid"><div>${items}</div>${importFacts}</div>` : items;
  return panel({
    title: `Data quality: ${esc(ds.name)}`,
    subtitle: `Trader under review · ${esc(a.summary.periodLabel ?? 'All periods')} · ${source}. Change the trader or period in the top bar.`,
    actions: chip(statusText, tone),
    body: wizardNote ? `<div class="imp-stack">${wizardNote}${body}</div>` : body,
    id: 'import-quality',
  });
}

// ---------- view ----------

export function render(state) {
  const w = state.importWizard;
  let step = w.step;
  if (step === 'mapping' && !w.table) step = 'start';
  if (step === 'preview' && !w.result) step = w.table ? 'mapping' : 'start';

  let body;
  if (step === 'reading') body = readingStep(w);
  else if (step === 'mapping') body = mappingStep(w);
  else if (step === 'preview') body = reviewStep(state, w);
  else if (step === 'done') body = doneStep(state, w);
  else body = startStep(state, w);

  // While a file is mapped or reviewed, the page is about that file only: the data-quality panel of the
  // trader under review (someone else) is not shown next to it.
  const showQuality = step !== 'mapping' && step !== 'preview';

  return `${pageHeader({
    eyebrow: 'Data',
    title: 'Import trades',
    lead: 'Import a month of option fills as CSV, and add later months to the same trader. Files are read in this browser tab, never uploaded, and are gone when the tab closes.',
  })}
  <div class="imp">
    ${stepper(step)}
    ${body}
    ${importsPanel(state)}
    ${showQuality ? qualityPanel(state, step) : ''}
  </div>`;
}
