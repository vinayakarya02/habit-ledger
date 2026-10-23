// Hand-built fill fixtures for edge cases that the seeded personas don't produce.
// Mirrors the helpers in engine.rules.test.mjs (kept separate so those tests stay self-contained).

const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const ts = (day, min) => `${day}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00+05:30`;
const D = (d) => `2026-09-${String(d).padStart(2, '0')}`;

export function fixtureBuilder(prefix = 'X') {
  let seq = 0;
  const fill = (day, min, symbol, side, qty, price, o = {}) => ({
    id: `${prefix}${String(++seq).padStart(5, '0')}`, ts: ts(day, min), underlying: 'NIFTY', symbol,
    optType: 'CE', strike: o.strike ?? 25000, expiry: '2026-09-29', side, qty, price, charges: 0, strategyId: o.sid ?? null,
  });
  const buy = (day, open, close, entry, exit) => {
    const symbol = `NIFTY ${prefix}T${++seq} 25000 CE`;
    return [fill(day, open, symbol, 'BUY', 75, entry), fill(day, close, symbol, 'SELL', 75, exit)];
  };
  const addTrade = (day, open, prices) => {
    const symbol = `NIFTY ${prefix}T${++seq} 25000 CE`;
    return prices.map(([side, qty, price], i) => fill(day, open + 5 * i, symbol, side, qty, price));
  };
  // Bear call spread whose hedge is sold 10 min in and whose short is bought back `gap` min later (excess 6,150).
  const hedgeSpread = (day, startMin, gap) => {
    const sid = `${prefix}SP${++seq}`;
    return [
      fill(day, startMin, `NIFTY ${sid} 24900 CE`, 'SELL', 75, 60, { sid, strike: 24900 }),
      fill(day, startMin, `NIFTY ${sid} 25000 CE`, 'BUY', 75, 25, { sid, strike: 25000 }),
      fill(day, startMin + 10, `NIFTY ${sid} 25000 CE`, 'SELL', 75, 8, { sid, strike: 25000 }),
      fill(day, startMin + 10 + gap, `NIFTY ${sid} 24900 CE`, 'BUY', 75, 190, { sid, strike: 24900 }),
    ];
  };
  return { fill, buy, addTrade, hedgeSpread, hm, D };
}

// Four behaviours (H3, H2, H1, H5) that each pass every gate on their own trades, sharing none:
// the fourth is left out only by the three-habit reporting limit.
export function fourHabitFills() {
  const { buy, addTrade, hedgeSpread, hm: m, D: d } = fixtureBuilder('Q');
  const fills = [];
  for (const day of [1, 2, 3, 4, 7]) {
    fills.push(...buy(d(day), m('09:20'), m('09:30'), 100, 180));
    fills.push(...buy(d(day), m('10:10'), m('10:20'), 100, 80));
    fills.push(...buy(d(day), m('10:25'), m('10:35'), 100, 60));
    fills.push(...addTrade(d(day), m('11:15'), [['BUY', 75, 100], ['BUY', 75, 80], ['SELL', 150, 60]]));
    fills.push(...hedgeSpread(d(day), m('12:00'), 20));
  }
  for (const day of [8, 9, 10, 11]) {
    for (let i = 0; i < 5; i++) fills.push(...buy(d(day), m('09:20') + 40 * i, m('09:30') + 40 * i, 100, 180));
    fills.push(...buy(d(day), m('12:40'), m('12:50'), 100, 72));
  }
  return fills;
}
