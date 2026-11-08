'use strict';
// Satu-satunya tempat semua metrik dihitung. Dipakai oleh scripts/hitung_ulang.js, dashboard Vercel, dan dashboard offline,
// jadi angkanya pasti sama. Fungsi murni: log mentah masuk, angka keluar. Tidak ada angka yang ditulis tangan.

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : +x.toFixed(2));
const iso = (ts) => new Date(ts * 1000).toISOString();
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// L = {ticks, orders, equity, errors, killswitch, snapshots, signals}; cfg = isi config.json; opts.endTs (detik) opsional
function computeMetrics(L, cfg, opts = {}) {
  const init = cfg.risk.initial_capital;
  const feeBuy = cfg.costs.taker_fee_buy_pct / 100, feeSell = cfg.costs.taker_fee_sell_pct / 100;
  const ticks = L.ticks || [];
  if (!ticks.length) return { metrics: null, series: { equity: [], btc: [] } };
  const startTs = ticks[0].started_at || ticks[0].ts;
  const endTs = opts.endTs || ticks[ticks.length - 1].ts;
  const inWin = (ts) => ts <= endTs;
  const tk = ticks.filter((t) => inWin(t.ts));
  const orders = (L.orders || []).filter((o) => inWin(o.ts));
  const errors = (L.errors || []).filter((e) => inWin(e.ts));

  const eq = [[startTs, init], ...tk.filter((t) => t.equity != null).map((t) => [t.ts, t.equity])];
  const finalEq = eq[eq.length - 1][1];
  let peak = -Infinity, maxDD = 0;
  for (const [, v] of eq) { peak = Math.max(peak, v); maxDD = Math.max(maxDD, (peak - v) / peak); }

  const sells = orders.filter((o) => o.side === 'SELL');
  const wins = sells.filter((o) => o.pnl_idr > 0), losses = sells.filter((o) => o.pnl_idr <= 0);
  const grossWin = sum(wins, (o) => o.pnl_idr), grossLoss = Math.abs(sum(losses, (o) => o.pnl_idr));
  const realized = sum(sells, (o) => o.pnl_idr);

  // Biaya: fee + spread (jarak fill ke harga tengah) + slippage (sisa selisih fill vs harga sinyal, bertanda)
  const feeTotal = sum(orders, (o) => o.fee_idr);
  const spreadCost = sum(orders, (o) => o.qty * Math.abs(o.fill_price - (o.best_bid + o.best_ask) / 2));
  const vsSignal = sum(orders, (o) => o.qty * (o.side === 'BUY' ? o.fill_price - o.signal_price : o.signal_price - o.fill_price));
  const slipCost = vsSignal - spreadCost;
  const costTotal = feeTotal + spreadCost + slipCost;
  const grossBeforeCost = realized + costTotal;
  const costRatio = grossBeforeCost > 0 ? costTotal / grossBeforeCost : null;

  // Snapshot order book: benchmark BTC buy & hold + statistik spread per pair
  const snaps = (L.snapshots || []).filter((s) => inWin(s.ts) && s.pairs);
  const btcSnaps = snaps.filter((s) => s.pairs.btcidr && !s.pairs.btcidr.error);
  let btc = null, btcSeries = [];
  if (btcSnaps.length >= 2) {
    const a = btcSnaps[0].pairs.btcidr.ask, b = btcSnaps[btcSnaps.length - 1].pairs.btcidr.bid;
    btc = { return_pct: r2(((b * (1 - feeSell)) / (a * (1 + feeBuy)) - 1) * 100), ask_awal: a, bid_akhir: b, dari: iso(btcSnaps[0].ts), sampai: iso(btcSnaps[btcSnaps.length - 1].ts) };
    btcSeries = btcSnaps.map((s) => [s.ts, init * ((s.pairs.btcidr.bid * (1 - feeSell)) / (a * (1 + feeBuy)))]);
  }
  const spreadStat = {};
  for (const pair of cfg.universe) {
    const v = snaps.map((s) => s.pairs[pair]).filter((x) => x && !x.error && Number.isFinite(x.spread_pct)).map((x) => x.spread_pct);
    spreadStat[pair] = { n: v.length, median_pct: v.length ? +median(v).toFixed(4) : null, p90_pct: v.length ? +pct(v, 0.9).toFixed(4) : null };
  }
  const allSpreads = Object.values(spreadStat).map((x) => x.median_pct).filter((x) => x !== null);

  // Uptime sesuai soal: candle diproses sebelum candle berikutnya ditutup / candle jatuh tempo (per pair)
  const dur = cfg.tf_seconds;
  const sigs = (L.signals || []).filter((x) => x.ts <= endTs);
  const firstCandle = sigs.length ? Math.min(...sigs.map((x) => x.candle_time)) : null;
  const done = new Map();
  for (const x of sigs) { const k = `${x.pair}|${x.candle_time}`; if (!done.has(k) || x.ts < done.get(k)) done.set(k, x.ts); }
  let due = 0, onTime = 0, late = 0, missed = 0;
  if (firstCandle !== null) {
    for (const pair of cfg.universe) {
      for (let c = firstCandle; c + 2 * dur <= endTs; c += dur) {
        due++;
        const ts = done.get(`${pair}|${c}`);
        if (ts === undefined) missed++; else if (ts <= c + 2 * dur) onTime++; else late++;
      }
    }
  }
  const upHours = new Set(tk.filter((t) => t.status === 'ok' || t.status === 'kill_switch').map((t) => Math.floor(t.ts / 3600)));
  const delays = tk.filter((t) => t.ts).map((t) => t.ts % 3600).sort((x, y) => x - y); // menit-detik dalam jam: info keterlambatan jadwal

  const byType = {};
  for (const e of errors) byType[e.type] = (byType[e.type] || 0) + 1;

  const metrics = {
    periode: { mulai: iso(startTs), akhir: iso(endTs), hari: r2((endTs - startTs) / 86400) },
    sumber: { jumlah_tick: tk.length, jumlah_order: orders.length, jumlah_snapshot: snaps.length, jumlah_sinyal: sigs.length },
    return_pct: r2((finalEq / init - 1) * 100),
    equity_awal: init,
    equity_akhir: Math.round(finalEq),
    max_drawdown_pct: r2(maxDD * 100),
    trade_tertutup: sells.length,
    order_buy: orders.filter((o) => o.side === 'BUY').length,
    posisi_terbuka_di_akhir: tk.length ? tk[tk.length - 1].open_positions : null,
    win_rate_pct: sells.length ? r2((wins.length / sells.length) * 100) : null,
    profit_factor: grossLoss > 0 ? r2(grossWin / grossLoss) : null,
    avg_win_idr: wins.length ? Math.round(grossWin / wins.length) : null,
    avg_loss_idr: losses.length ? Math.round(-grossLoss / losses.length) : null,
    biaya: {
      fee_idr: Math.round(feeTotal), spread_idr: Math.round(spreadCost), slippage_idr: Math.round(slipCost), total_idr: Math.round(costTotal),
      laba_kotor_sebelum_biaya_idr: Math.round(grossBeforeCost),
      cost_ratio: costRatio === null ? null : +costRatio.toFixed(3),
      catatan: costRatio === null ? 'laba kotor <= 0 (atau belum ada trade tertutup), rasio tidak bermakna' : 'cost_ratio = (fee+spread+slippage) / laba kotor sebelum biaya',
    },
    benchmark_btc_buy_hold: btc,
    selisih_vs_btc_pct_poin: btc ? r2((finalEq / init - 1) * 100 - btc.return_pct) : null,
    uptime: {
      definisi: 'candle diproses sebelum candle berikutnya ditutup / candle yang sudah jatuh tempo (per pair)',
      candle_jatuh_tempo: due, tepat_waktu: onTime, terlambat: late, terlewat: missed, persen: due ? r2((onTime / due) * 100) : null,
      info_tick: { jam_dengan_tick_sukses: upHours.size, total_jam: Math.floor(endTs / 3600) - Math.floor(startTs / 3600) + 1, median_detik_setelah_jam: delays.length ? Math.round(median(delays)) : null, maks_detik_setelah_jam: delays.length ? delays[delays.length - 1] : null },
    },
    error: { total: errors.length, api_error: errors.filter((e) => e.type === 'api_error').length, per_tipe: byType },
    kill_switch_events: (L.killswitch || []).filter((k) => inWin(k.ts)).length,
    spread_snapshot: { per_pair: spreadStat, median_semua_pair_pct: allSpreads.length ? +median(allSpreads).toFixed(4) : null, asumsi_backtest_pct: cfg.costs.spread_pct, asumsi_slippage_pct: cfg.costs.slippage_pct },
    hash: ticks[ticks.length - 1].config_hash ? { config: ticks[ticks.length - 1].config_hash, signals: ticks[ticks.length - 1].signals_hash } : null,
  };
  return { metrics, series: { equity: eq, btc: btcSeries } };
}

module.exports = { computeMetrics, iso };
