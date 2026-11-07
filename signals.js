// signals.js — SATU-SATUNYA sumber logika sinyal.
// Dipakai identik oleh backtest.js dan bot live (Vercel). Fungsi murni, tanpa I/O.
// Input bar: array objek {time, open, high, low, close, volume}, urut lama -> baru,
// HANYA berisi candle yang sudah tertutup.

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period; // seed = SMA
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function atr(bars, period) {
  const out = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period; // Wilder seed
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

function minBarsNeeded(p) {
  return Math.max(p.ema_period, p.donchian_entry + 1, p.donchian_exit + 1, p.atr_period + 1);
}

/**
 * Hitung sinyal pada bar terakhir (yang sudah tertutup).
 * position: null bila flat, atau {stop} bila sedang memegang posisi.
 * Return: {action: 'BUY'|'SELL'|'HOLD', reason, signalPrice, atr, ema, newStop}
 */
function computeSignal(bars, p, position) {
  const n = bars.length;
  if (n < minBarsNeeded(p)) {
    return { action: 'HOLD', reason: 'data_kurang', signalPrice: null };
  }
  const closes = bars.map((b) => b.close);
  const emaArr = ema(closes, p.ema_period);
  const atrArr = atr(bars, p.atr_period);
  const i = n - 1;
  const last = bars[i];
  const e = emaArr[i];
  const a = atrArr[i];
  const base = { signalPrice: last.close, atr: a, ema: e, time: last.time };

  if (e === null || a === null) return { ...base, action: 'HOLD', reason: 'indikator_belum_siap' };

  if (!position) {
    // Entry: close menembus high tertinggi N bar SEBELUMNYA, dan close > EMA
    let hh = -Infinity;
    for (let j = i - p.donchian_entry; j < i; j++) hh = Math.max(hh, bars[j].high);
    if (last.close > hh && last.close > e) {
      return { ...base, action: 'BUY', reason: 'donchian_breakout', newStop: last.close - p.atr_stop_mult * a, level: hh };
    }
    return { ...base, action: 'HOLD', reason: 'no_signal' };
  }

  // Sedang pegang posisi: exit bila close < stop (dari bar sebelumnya) atau < low terendah M bar sebelumnya
  let ll = Infinity;
  for (let j = i - p.donchian_exit; j < i; j++) ll = Math.min(ll, bars[j].low);
  if (last.close < position.stop) {
    return { ...base, action: 'SELL', reason: 'atr_stop', level: position.stop };
  }
  if (last.close < ll) {
    return { ...base, action: 'SELL', reason: 'donchian_exit', level: ll };
  }
  const newStop = Math.max(position.stop, last.close - p.atr_stop_mult * a); // stop hanya naik
  return { ...base, action: 'HOLD', reason: 'hold_position', newStop };
}

/**
 * Sizing: risiko tetap per trade, dibatasi max % equity per posisi dan kas tersedia.
 * Return nilai IDR yang dibelanjakan (termasuk fee), atau 0 bila tidak layak.
 */
function positionSizeIdr(equity, cash, price, atrValue, risk, strat) {
  const stopDistPct = (strat.atr_stop_mult * atrValue) / price;
  if (!(stopDistPct > 0)) return 0;
  const byRisk = (equity * risk.risk_per_trade) / stopDistPct;
  const byCap = equity * risk.max_position_pct;
  const size = Math.min(byRisk, byCap, cash);
  return size >= risk.min_order_idr ? size : 0;
}

module.exports = { ema, atr, computeSignal, positionSizeIdr, minBarsNeeded };
