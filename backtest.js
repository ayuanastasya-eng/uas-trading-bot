// backtest.js — jalankan:  node backtest.js [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out out] [--data data] [--config config.json]
// Memakai signals.js yang SAMA dengan bot live. Output: out/trades.csv, orders.csv, equity.csv, signals.csv, summary.json
const fs = require('fs');
const path = require('path');
const { computeSignal, positionSizeIdr, minBarsNeeded } = require('./signals');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const cfg = JSON.parse(fs.readFileSync(arg('--config', path.join(__dirname, 'config.json')), 'utf8'));
const outDir = arg('--out', 'out');
const dataDir = arg('--data', 'data');
const fromTs = arg('--from') ? Date.parse(arg('--from') + 'T00:00:00Z') / 1000 : 0;
const toTs = arg('--to') ? Date.parse(arg('--to') + 'T23:59:59Z') / 1000 : Infinity;

const HISTORY_BARS = 600; // HARUS sama dengan lib/engine.js
const WIB_OFFSET = 7 * 3600;
const wibDate = (ts) => new Date((ts + WIB_OFFSET) * 1000).toISOString().slice(0, 10);

const c = cfg.costs;
for (const k of ['taker_fee_buy_pct', 'taker_fee_sell_pct', 'spread_pct', 'slippage_pct']) {
  if (typeof c[k] !== 'number') {
    console.error(`config.json: costs.${k} belum diisi.`);
    process.exit(1);
  }
}
const feeBuy = c.taker_fee_buy_pct / 100, feeSell = c.taker_fee_sell_pct / 100;
const halfSpread = c.spread_pct / 100 / 2, slip = c.slippage_pct / 100;

function loadCsv(pair) {
  const f = path.join(dataDir, `${pair}_${cfg.timeframe}.csv`);
  const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(1);
  return lines.map((l) => {
    const [t, o, h, lo, cl, v] = l.split(',');
    return { time: +t, open: +o, high: +h, low: +lo, close: +cl, volume: +v };
  });
}

const data = {};
for (const p of cfg.universe) data[p] = loadCsv(p);
const times = [...new Set(Object.values(data).flat().map((b) => b.time))].sort((a, b) => a - b);
const idx = {};
for (const p of cfg.universe) idx[p] = new Map(data[p].map((b, i) => [b.time, i]));

const init = cfg.risk.initial_capital;
let cash = init;
const positions = {};
const trades = [], orders = [], equityRows = [], sigRows = [];
const warmup = minBarsNeeded(cfg.strategy);

function markEquity(t) {
  let eq = cash;
  for (const [p, pos] of Object.entries(positions)) {
    const i = idx[p].get(t);
    const px = i !== undefined ? data[p][i].close : pos.lastClose;
    pos.lastClose = px;
    eq += pos.qty * px * (1 - halfSpread); // nilai jika dijual di bid
  }
  return eq;
}

let curDay = null, dayStartEq = init;
for (const t of times) {
  if (t < fromTs || t > toTs) continue; // di luar jendela: tidak bertransaksi
  const actions = [];
  for (const p of cfg.universe) {
    const i = idx[p].get(t);
    if (i === undefined || i + 1 < warmup) continue;
    const bars = data[p].slice(Math.max(0, i + 1 - HISTORY_BARS), i + 1);
    const pos = positions[p] || null;
    const sig = computeSignal(bars, cfg.strategy, pos);
    sigRows.push([t, p, sig.action, sig.reason, sig.signalPrice, sig.ema, sig.atr].join(','));
    actions.push({ p, sig, pos });
  }
  // hari baru (WIB) pada saat keputusan (= candle close): equity awal hari = equity setelah keputusan sebelumnya
  const d = wibDate(t + cfg.tf_seconds);
  if (d !== curDay) {
    curDay = d;
    dayStartEq = equityRows.length ? equityRows[equityRows.length - 1][1] : init;
  }

  // 1) exit & update stop
  for (const { p, sig, pos } of actions) {
    if (!pos) continue;
    if (sig.action === 'SELL') {
      const fill = sig.signalPrice * (1 - halfSpread - slip);
      const gross = pos.qty * fill;
      const feeIdr = gross * feeSell;
      const proceeds = gross - feeIdr;
      cash += proceeds;
      trades.push({ pair: p, entry_time: pos.entryTime, exit_time: t, qty: pos.qty, entry_fill: pos.entryFill, exit_fill: fill, fee_idr: pos.entryFeeIdr + feeIdr, pnl: proceeds - pos.entryCost, reason: sig.reason });
      orders.push([t, p, 'SELL', pos.qty, fill, feeIdr, sig.reason].join(','));
      delete positions[p];
    } else if (sig.newStop !== undefined) {
      pos.stop = sig.newStop;
    }
  }
  // 2) entry
  const eqNow = markEquity(t);
  const limitHit = (eqNow - dayStartEq) / dayStartEq <= -cfg.risk.daily_loss_limit_pct;
  for (const { p, sig, pos } of actions) {
    if (pos || sig.action !== 'BUY') continue;
    if (Object.keys(positions).length >= cfg.risk.max_positions) break;
    if (limitHit) continue;
    const spend = positionSizeIdr(eqNow, cash, sig.signalPrice, sig.atr, cfg.risk, cfg.strategy);
    if (spend <= 0) continue;
    const fill = sig.signalPrice * (1 + halfSpread + slip);
    const feeIdr = spend * feeBuy;
    const qty = (spend - feeIdr) / fill;
    cash -= spend;
    positions[p] = { qty, stop: sig.newStop, entryTime: t, entryFill: fill, entryCost: spend, entryFeeIdr: feeIdr, lastClose: sig.signalPrice };
    orders.push([t, p, 'BUY', qty, fill, feeIdr, sig.reason].join(','));
  }
  equityRows.push([t, markEquity(t)]);
}

// ---- Metrik ----
const eq = equityRows.map((r) => r[1]);
const finalEq = eq.length ? eq[eq.length - 1] : init;
let peak = -Infinity, maxDD = 0;
for (const v of eq) { peak = Math.max(peak, v); maxDD = Math.max(maxDD, (peak - v) / peak); }
const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const grossWin = sum(wins, (t) => t.pnl), grossLoss = Math.abs(sum(losses, (t) => t.pnl));
const years = equityRows.length > 1 ? (equityRows[equityRows.length - 1][0] - equityRows[0][0]) / (365.25 * 86400) : 0;
const totalRet = finalEq / init - 1;
const summary = {
  periode: equityRows.length ? `${new Date(equityRows[0][0] * 1000).toISOString().slice(0, 10)} -> ${new Date(equityRows[equityRows.length - 1][0] * 1000).toISOString().slice(0, 10)}` : '-',
  return_total_pct: +(totalRet * 100).toFixed(2),
  cagr_pct: years > 0 ? +((Math.pow(1 + totalRet, 1 / years) - 1) * 100).toFixed(2) : null,
  max_drawdown_pct: +(maxDD * 100).toFixed(2),
  jumlah_trade: trades.length,
  win_rate_pct: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : null,
  profit_factor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : null,
  avg_win_idr: wins.length ? Math.round(grossWin / wins.length) : null,
  avg_loss_idr: losses.length ? Math.round(-grossLoss / losses.length) : null,
  total_fee_idr: Math.round(sum(trades, (t) => t.fee_idr)),
};
console.log(summary);

fs.mkdirSync(outDir, { recursive: true });
const w = (f, lines) => fs.writeFileSync(path.join(outDir, f), lines.join('\n'));
w('trades.csv', ['pair,entry_time,exit_time,qty,entry_fill,exit_fill,fee_idr,pnl,reason', ...trades.map((t) => [t.pair, t.entry_time, t.exit_time, t.qty, t.entry_fill, t.exit_fill, t.fee_idr, t.pnl, t.reason].join(','))]);
w('orders.csv', ['time,pair,side,qty,fill_price,fee_idr,reason', ...orders]);
w('equity.csv', ['time,equity', ...equityRows.map((r) => r.join(','))]);
w('signals.csv', ['time,pair,action,reason,signal_price,ema,atr', ...sigRows]);
w('summary.json', [JSON.stringify(summary, null, 2)]);
console.log(`Tersimpan di ${outDir}/ (trades.csv, orders.csv, equity.csv, signals.csv, summary.json)`);
