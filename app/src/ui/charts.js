// Small, purposeful SVG charts. Colours come from CSS custom properties so both themes work.
// Every chart carries a text summary for screen readers.

import { esc } from './components.js';
import { formatINR, formatPct, formatDate, isNum } from '../format.js';

// Daily realized P&L bars. Days containing trades counted toward a confirmed habit are marked.
export function dailyPnlChart(daily, { height = 160, title = 'Daily net P&L', habitLegend = true } = {}) {
  if (!daily.length) return '';
  const W = 640, H = height, padL = 8, padR = 8, padT = 10, padB = 22;
  const max = Math.max(1, ...daily.map((d) => Math.abs(d.netPnl)));
  const zeroY = padT + (H - padT - padB) / 2;
  const half = (H - padT - padB) / 2;
  const bw = (W - padL - padR) / daily.length;
  const bars = daily.map((d, i) => {
    const h = (Math.abs(d.netPnl) / max) * half;
    const x = padL + i * bw + bw * 0.15;
    const y = d.netPnl >= 0 ? zeroY - h : zeroY;
    const cls = d.netPnl >= 0 ? 'bar-pos' : 'bar-neg';
    const mark = d.habitTrades ? `<circle class="habit-dot" cx="${(x + bw * 0.35).toFixed(1)}" cy="${(H - padB + 9).toFixed(1)}" r="3"><title>${esc(`${d.habitTrades} habit trade${d.habitTrades === 1 ? '' : 's'}`)}</title></circle>` : '';
    return `<g><rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="1.5"><title>${esc(`${formatDate(d.day)}: ${formatINR(d.netPnl, { sign: true })} across ${d.trades} trade${d.trades === 1 ? '' : 's'}${d.habitTrades ? `, ${d.habitTrades} counted toward a confirmed habit` : ''}`)}</title></rect>${mark}</g>`;
  }).join('');
  const worst = daily.reduce((m, d) => (d.netPnl < m.netPnl ? d : m), daily[0]);
  const best = daily.reduce((m, d) => (d.netPnl > m.netPnl ? d : m), daily[0]);
  const habitDays = daily.filter((d) => d.habitTrades).length;
  const summary = `${title} across ${daily.length} trading days. Best day ${formatDate(best.day)} ${formatINR(best.netPnl, { sign: true })}; worst day ${formatDate(worst.day)} ${formatINR(worst.netPnl, { sign: true })}. ${habitDays} day${habitDays === 1 ? '' : 's'} included trades counted toward a confirmed habit.`;
  const rows = daily.map((d) => `<tr><td>${esc(formatDate(d.day))}</td><td class="r num">${esc(formatINR(d.netPnl, { sign: true }))}</td><td class="r num">${d.trades}</td><td class="r num">${d.habitTrades || '—'}</td></tr>`).join('');
  const table = `<details class="chart-data"><summary>Show daily values</summary><div class="table-wrap"><table><caption class="sr-only">${esc(title)} by day</caption><thead><tr><th scope="col">Day</th><th scope="col" class="r">Net P&amp;L</th><th scope="col" class="r">Trades</th><th scope="col" class="r">Habit trades</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}"><line class="axis" x1="${padL}" x2="${W - padR}" y1="${zeroY}" y2="${zeroY}"/>${bars}</svg><figcaption class="chart-legend"><span><i class="lg lg-pos"></i>Gain day</span><span><i class="lg lg-neg"></i>Loss day</span>${habitLegend ? '<span><i class="lg lg-dot"></i>Day with a trade counted toward a confirmed habit</span>' : ''}<span class="muted">Scale: tallest bar = ${esc(formatINR(max))}</span></figcaption>${table}</figure>`;
}

// Two-period rate comparison with 90% Wilson intervals as whiskers.
export function rateCompareChart(row, { fromLabel, toLabel }) {
  const W = 320, H = 64, padL = 70, padR = 46;
  const scaleMax = Math.max(0.05, ...[row.before, row.after].map((s) => (s.ci ? s.ci.hi : s.rate ?? 0)));
  const x = (v) => padL + (Math.min(v, scaleMax) / scaleMax) * (W - padL - padR);
  const line = (s, y, cls, label) => {
    if (!isNum(s.rate)) return `<text class="chart-label" x="0" y="${y + 4}">${esc(label)}</text><text class="chart-val" x="${padL}" y="${y + 4}">no chances</text>`;
    const ci = s.ci ? `<line class="ci" x1="${x(s.ci.lo).toFixed(1)}" x2="${x(s.ci.hi).toFixed(1)}" y1="${y}" y2="${y}"/><line class="ci" x1="${x(s.ci.lo).toFixed(1)}" x2="${x(s.ci.lo).toFixed(1)}" y1="${y - 4}" y2="${y + 4}"/><line class="ci" x1="${x(s.ci.hi).toFixed(1)}" x2="${x(s.ci.hi).toFixed(1)}" y1="${y - 4}" y2="${y + 4}"/>` : '';
    return `<text class="chart-label" x="0" y="${y + 4}">${esc(label)}</text><rect class="${cls}" x="${padL}" y="${y - 6}" width="${Math.max(1.5, x(s.rate) - padL).toFixed(1)}" height="12" rx="2"/>${ci}<text class="chart-val" x="${W - padR + 6}" y="${y + 4}">${esc(formatPct(s.rate))}</text>`;
  };
  const summary = `${row.name}: ${fromLabel} ${row.before.n} of ${row.before.opp} (${formatPct(row.before.rate)}), ${toLabel} ${row.after.n} of ${row.after.opp} (${formatPct(row.after.rate)}). Whiskers show 90% intervals.`;
  return `<svg class="rate-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}">${line(row.before, 18, 'bar-a', fromLabel)}${line(row.after, 46, 'bar-b', toLabel)}</svg>`;
}

// Inline bar for a share 0..1 (used in tables).
export function shareBar(x) {
  if (!isNum(x)) return '';
  return `<svg class="share-bar" viewBox="0 0 60 8" aria-hidden="true"><rect class="share-bg" width="60" height="8" rx="4"/><rect class="share-fg" width="${(Math.max(0, Math.min(1, x)) * 60).toFixed(1)}" height="8" rx="4"/></svg>`;
}
