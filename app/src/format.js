// Stable formatting for money, percentages, dates and missing values. Pure, no DOM.
// Missing values render as an em dash and are never shown as zero.

export const MISSING = '—';

export const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export function formatINR(n, { sign = false, decimals = 0 } = {}) {
  if (!isNum(n)) return MISSING;
  const f = 10 ** decimals;
  // Round half away from zero so +x.5 and −x.5 mirror each other.
  const r = (Math.sign(n) * Math.round(Math.abs(n) * f)) / f;
  const abs = Math.abs(r).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const prefix = r < 0 ? '−' : sign && r > 0 ? '+' : '';
  return `${prefix}₹${abs}`;
}

export const formatPrice = (n) => formatINR(n, { decimals: 2 });

// x is a fraction: 0.29 -> "29.0%"
export function formatPct(x, { digits = 1, sign = false } = {}) {
  if (!isNum(x)) return MISSING;
  const v = (x * 100).toFixed(digits);
  const neg = Number(v) < 0;
  const body = neg ? v.slice(1) : v;
  return `${neg ? '−' : sign && Number(v) > 0 ? '+' : ''}${body}%`;
}

// Difference between two rates, in percentage points.
export function formatPP(x, { digits = 1 } = {}) {
  if (!isNum(x)) return MISSING;
  const v = (x * 100).toFixed(digits);
  const n = Number(v);
  return `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n).toFixed(digits)} pp`;
}

// Relative change: -0.69 -> "−69%"
export function formatRel(x) {
  if (!isNum(x)) return MISSING;
  const n = Math.round(x * 100);
  return `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n)}%`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatMonth(key, { short = false } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(key))) return MISSING;
  const name = MONTHS[Number(key.slice(5, 7)) - 1];
  return `${short ? name.slice(0, 3) : name} ${key.slice(0, 4)}`;
}

// "2026-09-01" -> "1 Sep 2026"
export function formatDate(day, { year = true } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(day))) return MISSING;
  const d = Number(day.slice(8, 10));
  return `${d} ${MONTHS[Number(day.slice(5, 7)) - 1].slice(0, 3)}${year ? ` ${day.slice(0, 4)}` : ''}`;
}

// "2026-09-01" -> "Tue, 1 Sep"
export function formatDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(day))) return MISSING;
  const wd = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))).getUTCDay();
  return `${WEEKDAYS[wd]}, ${formatDate(day, { year: false })}`;
}

// IST ISO timestamp -> "09:31"
export const formatTime = (ts) => (/T\d{2}:\d{2}/.test(String(ts)) ? ts.slice(11, 16) : MISSING);

export function formatDuration(min) {
  if (!isNum(min)) return MISSING;
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function formatLots(x) {
  if (!isNum(x)) return MISSING;
  const v = Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${v} lot${x === 1 ? '' : 's'}`;
}

// Plain-language reading of a one-sided p-value.
export function chanceText(p) {
  if (!isNum(p)) return MISSING;
  if (p < 0.001) return 'less than 1 in 1,000';
  if (p < 0.01) return `about 1 in ${Math.round(1 / p).toLocaleString('en-IN')}`;
  if (p >= 0.5) return 'more likely than not';
  return `about 1 in ${Math.max(2, Math.round(1 / p))}`;
}
