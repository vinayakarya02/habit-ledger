// Deterministic synthetic trade histories. Every number here is simulated.
// Each persona has a September 2026 review month and an October 2026 follow-up month.
// `manifest` lists the planted habit occurrences so evals can check detection against ground truth.

const LOT = { NIFTY: 75, BANKNIFTY: 35 };
const CHARGE = 20; // flat ₹ per executed order (illustrative; statutory levies excluded)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tick = (x) => Math.max(0.05, Math.round(x * 20) / 20);

// NSE trading holidays in the sample months (Ganesh Chaturthi, Gandhi Jayanti, Dussehra 2026).
export const HOLIDAYS = ['2026-09-14', '2026-10-02', '2026-10-20'];
const pad = (n) => String(n).padStart(2, '0');
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function tradingDays(year, month, count, skip = HOLIDAYS) {
  const out = [];
  for (let d = 1; d <= 31 && out.length < count; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    if (dt.getUTCMonth() !== month - 1) break;
    const wd = dt.getUTCDay();
    const iso = `${year}-${pad(month)}-${pad(d)}`;
    if (wd === 0 || wd === 6 || skip.includes(iso)) continue;
    out.push(iso);
  }
  return out;
}

// NIFTY: weekly Tuesday expiry on/after the trade day. BANKNIFTY: last Tuesday of the month.
function expiryFor(und, day) {
  const [y, m, d] = day.split('-').map(Number);
  let dt;
  if (und === 'NIFTY') {
    dt = new Date(Date.UTC(y, m - 1, d));
    while (dt.getUTCDay() !== 2) dt.setUTCDate(dt.getUTCDate() + 1);
  } else {
    dt = new Date(Date.UTC(y, m, 0));
    while (dt.getUTCDay() !== 2) dt.setUTCDate(dt.getUTCDate() - 1);
  }
  // An expiry that falls on a holiday moves to the previous trading day.
  while (HOLIDAYS.includes(dt.toISOString().slice(0, 10))) dt.setUTCDate(dt.getUTCDate() - 1);
  return { iso: dt.toISOString().slice(0, 10), code: `${pad(dt.getUTCDate())}${MON[dt.getUTCMonth()]}${String(dt.getUTCFullYear()).slice(2)}` };
}

function makeBook(seed, prefix) {
  const rnd = mulberry32(seed);
  const fills = [];
  const manifest = [];
  let n = 0;
  const ts = (day, min) => `${day}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00+05:30`;
  function fill(day, min, und, opt, strike, side, qty, price, strategyId = null) {
    const ex = expiryFor(und, day);
    const id = `${prefix}${String(++n).padStart(4, '0')}`;
    fills.push({ id, ts: ts(day, min), underlying: und, symbol: `${und} ${ex.code} ${strike} ${opt}`, optType: opt, strike, expiry: ex.iso, side, qty, price: tick(price), charges: CHARGE, strategyId });
    return id;
  }
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  const int = (lo, hi) => Math.floor(between(lo, hi + 1));
  return { rnd, fills, manifest, fill, between, int };
}

// ---------- single-leg option buyers ----------

// Kinds: W win, L loss, R re-entry after loss (loss), Rw re-entry small win, Rs re-entry small loss,
// Rb re-entry big loss, A averaging down (loss), Ab averaging down (big loss), S size-up after wins (loss).
export function singleLegMonth(seed, prefix, days, plan, p) {
  const b = makeBook(seed, prefix);
  const { fill, between, int, manifest } = b;
  plan.forEach((seq, di) => {
    const day = days[di];
    let t = 9 * 60 + int(18, 26);
    const busy = seq.length > 5;
    seq.forEach((k, i) => {
      if (i > 0) t += k[0] === 'R' ? int(...(p.reGap ?? [3, 12])) : busy ? int(31, 34) : int(p.gapMin, p.gapMax);
      const und = b.rnd() < 0.6 ? 'NIFTY' : 'BANKNIFTY';
      const opt = b.rnd() < 0.5 ? 'CE' : 'PE';
      const strike = und === 'NIFTY' ? 50 * int(492, 504) : 100 * int(545, 560);
      const lots = k === 'S' ? (p.sizeUpLots ?? 4) : p.lots;
      const qty = lots * LOT[und];
      const entry = between(80, 200);
      const hold = int(p.holdMin, p.holdMax);
      let exit;
      let add = null;
      switch (k) {
        case 'W': exit = entry * between(p.win[0], p.win[1]); break;
        case 'L': exit = entry * between(p.loss[0], p.loss[1]); break;
        case 'R': exit = entry * between(...(p.reExit ?? [0.5, 0.7])); break;
        case 'Rw': exit = entry * between(1.06, 1.1); break;
        case 'Rs': exit = entry * between(0.94, 0.96); break;
        case 'Rb': exit = entry * 0.3; break;
        case 'S': exit = entry * between(0.6, 0.75); break;
        case 'A': add = entry * between(0.62, 0.74); exit = add * between(0.62, 0.82); break;
        case 'Ab': add = entry * 0.7; exit = add * 0.4; break;
        default: throw new Error(`unknown kind ${k}`);
      }
      const first = fill(day, t, und, opt, strike, 'BUY', qty, entry);
      if (add) fill(day, t + Math.floor(hold / 2), und, opt, strike, 'BUY', qty, add);
      fill(day, t + hold, und, opt, strike, 'SELL', add ? qty * 2 : qty, exit);
      const ref = `P:${first}`;
      if (k[0] === 'R') manifest.push({ habit: 'H1', ref, kind: k });
      if (k[0] === 'A') manifest.push({ habit: 'H2', ref, kind: k });
      if (k === 'S') manifest.push({ habit: 'H4', ref, kind: k });
      if (i >= 5) manifest.push({ habit: 'H5', ref, kind: k });
      t += hold;
    });
  });
  return { fills: b.fills, manifest };
}

// ---------- spread seller ----------

// Kinds: C credit spread win, Cl credit spread loss (within max), K iron condor win,
// H hedge removed then loss beyond max, Hf hedge removed but ended fine.
function spreadMonth(seed, prefix, days, plan) {
  const b = makeBook(seed, prefix);
  const { fill, between, int, manifest } = b;
  let sid = 0;
  const und = 'NIFTY';
  const qty = LOT.NIFTY;
  function side(day, t, strategyId, opt, k, hold) {
    const atm = 50 * int(492, 504);
    const short = opt === 'CE' ? atm + 100 : atm - 100;
    const long = opt === 'CE' ? short + 100 : short - 100;
    const s = between(40, 80);
    const l = s * between(0.4, 0.5);
    fill(day, t, und, opt, short, 'SELL', qty, s, strategyId);
    fill(day, t, und, opt, long, 'BUY', qty, l, strategyId);
    if (k === 'H' || k === 'Hf') {
      fill(day, t + int(8, 12), und, opt, long, 'SELL', qty, l * between(0.3, 0.5), strategyId);
      fill(day, t + hold, und, opt, short, 'BUY', qty, k === 'H' ? s * between(3.2, 4.5) : s * 0.1, strategyId);
    } else if (k === 'Cl') {
      // Keep the spread's value below its width so prices stay arbitrage-free.
      const sx = s * between(1.6, 2.2);
      fill(day, t + hold, und, opt, short, 'BUY', qty, sx, strategyId);
      fill(day, t + hold, und, opt, long, 'SELL', qty, Math.max(l * between(1.8, 2.6), sx - 90), strategyId);
    } else {
      fill(day, t + hold, und, opt, short, 'BUY', qty, s * between(0.3, 0.5), strategyId);
      fill(day, t + hold, und, opt, long, 'SELL', qty, l * between(0.3, 0.5), strategyId);
    }
  }
  plan.forEach((seq, di) => {
    const day = days[di];
    const busy = seq.length > 5;
    let t = 9 * 60 + int(18, 24);
    seq.forEach((k, i) => {
      if (i > 0) t += busy ? int(31, 34) : int(32, 45);
      const strategyId = `${prefix}S${String(++sid).padStart(3, '0')}`;
      const hold = k === 'H' || k === 'Hf' ? int(25, 35) : busy ? int(8, 14) : int(10, 25);
      if (k === 'K') { side(day, t, strategyId, 'CE', 'C', hold); side(day, t, strategyId, 'PE', 'C', hold); }
      else side(day, t, strategyId, b.rnd() < 0.5 ? 'CE' : 'PE', k, hold);
      const ref = `S:${strategyId}`;
      if (k === 'H' || k === 'Hf') manifest.push({ habit: 'H3', ref, kind: k });
      if (i >= 5) manifest.push({ habit: 'H5', ref, kind: k });
      t += hold;
    });
  });
  return { fills: b.fills, manifest };
}

// ---------- plans ----------

const SEP = tradingDays(2026, 9, 16);
const OCT = tradingDays(2026, 10, 16);
const s = (str) => str.split(' ');

const AARAV = {
  params: { lots: 2, win: [1.15, 1.4], loss: [0.73, 0.88], gapMin: 32, gapMax: 45, holdMin: 8, holdMax: 25 },
  sep: ['W L R W', 'L R R W', 'W W S L', 'A W L', 'L R W', 'W L W', 'A L R', 'W W S', 'L R W W', 'A W', 'L R R', 'W L W A', 'W W S L', 'L R W', 'A L W', 'W L'].map(s),
  oct: ['W L W W', 'L R W', 'W W L', 'A W L', 'L W W', 'W L W', 'A L W', 'W L W', 'L R W W', 'A W', 'L W L', 'W L W A', 'W L W L', 'L W W', 'A L W', 'W L W'].map(s),
};

const KABIR = {
  params: { lots: 2, win: [1.2, 1.4], loss: [0.82, 0.9], gapMin: 32, gapMax: 45, holdMin: 8, holdMax: 14 },
  sep: ['W L W', 'W W L', 'L Rb W', 'W L W W', 'W L L', 'Ab W', 'W W L W W L L', 'L Rw W', 'W L W', 'L Rw W', 'W W L W W L L L', 'L Rs W', 'W L W', 'W W L', 'W L W'].map(s),
  oct: ['W W L', 'W L W', 'L W W', 'W L W W', 'W W L', 'W L W', 'W L W W', 'L W W', 'W L W', 'W W L', 'W L W', 'L W W', 'W L W W', 'W W L', 'W L W'].map(s),
};

const MEERA = {
  sep: ['C C K', 'C H C', 'C C Cl C C Cl Cl', 'K Cl C', 'C Hf C', 'C C C K C Cl Cl', 'H C K', 'C Cl C', 'K C C C C Cl Cl', 'C H', 'K C Cl', 'C C C C K Cl Cl', 'H C', 'C K C', 'C Cl C', 'K C'].map(s),
  oct: ['C C K', 'C Cl C', 'C C Cl C C Cl Cl', 'K Cl C', 'C C C', 'C C C K C Cl Cl', 'H C K', 'C Cl C', 'K C C C C Cl Cl', 'C C', 'K C Cl', 'C C C C K Cl Cl', 'C C', 'C K C', 'C Cl C', 'K C'].map(s),
};

function persona(id, name, style, months) {
  // Combined history across both months, so the app can review either period and compare them.
  const fills = [...months['2026-09'].fills, ...months['2026-10'].fills];
  return { id, name, style, kind: 'sample', defaultPeriod: '2026-09', months, fills };
}

function build() {
  return {
    aarav: persona('aarav', 'Aarav', 'Intraday NIFTY / BANKNIFTY option buyer, 2 lots a trade', {
      '2026-09': singleLegMonth(101, 'AS', SEP, AARAV.sep, AARAV.params),
      '2026-10': singleLegMonth(102, 'AO', OCT, AARAV.oct, AARAV.params),
    }),
    meera: persona('meera', 'Meera', 'Sells NIFTY credit spreads and iron condors, 1 lot', {
      '2026-09': spreadMonth(201, 'MS', SEP, MEERA.sep),
      '2026-10': spreadMonth(202, 'MO', OCT, MEERA.oct),
    }),
    kabir: persona('kabir', 'Kabir', 'Disciplined option buyer, mostly 3 trades a day', {
      '2026-09': singleLegMonth(301, 'KS', SEP.slice(0, 15), KABIR.sep, KABIR.params),
      '2026-10': singleLegMonth(302, 'KO', OCT.slice(0, 15), KABIR.oct, KABIR.params),
    }),
  };
}

export const PERSONAS = build();
export const MONTH_LABEL = { '2026-09': 'September 2026', '2026-10': 'October 2026' };
