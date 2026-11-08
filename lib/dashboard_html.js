'use strict';
// Membuat halaman dashboard (satu file HTML mandiri: tanpa library luar, tanpa internet). Semua angka datang dari lib/metrics.js.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const idr = (n) => (n === null || n === undefined ? '-' : (n < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(n)).toLocaleString('id-ID'));
const num = (n, d = 2) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: d }));
const wib = (ts) => new Date((ts + 7 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' WIB';

function line(series, w, h, pad, x0, x1, y0, y1, cls) {
  if (series.length < 2) return '';
  const X = (t) => pad.l + ((t - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (h - pad.t - pad.b);
  return `<polyline class="${cls}" fill="none" points="${series.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
}

function chart(equity, btc, init) {
  const w = 900, h = 300, pad = { l: 64, r: 16, t: 14, b: 28 };
  if (equity.length < 2) return '<p class="muted">Belum cukup data untuk grafik.</p>';
  const all = [...equity, ...btc];
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  let y0 = Math.min(...all.map((p) => p[1]), init), y1 = Math.max(...all.map((p) => p[1]), init);
  const m = (y1 - y0) * 0.1 || init * 0.005; y0 -= m; y1 += m;
  const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  const grid = [0, 1, 2, 3, 4].map((i) => { const v = y0 + ((y1 - y0) * i) / 4; return `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${pad.l - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${(v / 1e6).toFixed(2)} jt</text>`; }).join('');
  const days = []; for (let t = Math.ceil((x0 + 7 * 3600) / 86400) * 86400 - 7 * 3600; t <= x1; t += 86400) days.push(t);
  const X = (t) => pad.l + ((t - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
  const xs = days.map((t) => `<text class="ax" x="${X(t).toFixed(1)}" y="${h - 8}" text-anchor="middle">${new Date((t + 7 * 3600) * 1000).toISOString().slice(5, 10)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Kurva equity bot dibanding BTC buy and hold">${grid}${xs}
  <line class="base" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(init).toFixed(1)}" y2="${Y(init).toFixed(1)}"/>
  ${line(btc, w, h, pad, x0, x1, y0, y1, 'btc')}${line(equity, w, h, pad, x0, x1, y0, y1, 'eq')}</svg>`;
}

function render({ metrics: m, series, orders = [], errors = [], gap = null, sumber = '', dibuat = Date.now() / 1000 }) {
  if (!m) return '<!doctype html><meta charset="utf-8"><title>Dashboard bot</title><p>Belum ada tick yang tercatat.</p>';
  const c = (label, val, sub = '') => `<div class="card"><div class="k">${esc(label)}</div><div class="v">${val}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const sign = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
  const sp = m.spread_snapshot;
  const spRows = Object.entries(sp.per_pair).map(([p, s]) => `<tr><td>${esc(p.toUpperCase())}</td><td class="r">${s.n}</td><td class="r">${num(s.median_pct, 4)}%</td><td class="r">${num(s.p90_pct, 4)}%</td></tr>`).join('');
  const ordRows = [...orders].reverse().slice(0, 100).map((o) => `<tr><td>${wib(o.ts)}</td><td>${esc(o.pair.toUpperCase())}</td><td class="${o.side === 'BUY' ? 'pos' : 'neg'}">${o.side}</td><td class="r">${num(o.fill_price, 4)}</td><td class="r">${num(o.best_bid, 4)} / ${num(o.best_ask, 4)}</td><td class="r">${num(o.signal_diff_pct, 3)}%</td><td class="r">${idr(o.fee_idr)}</td><td class="r ${sign(o.pnl_idr)}">${o.side === 'SELL' ? idr(o.pnl_idr) : '-'}</td><td>${esc(o.reason)}</td></tr>`).join('');
  const errTypes = Object.entries(m.error.per_tipe).map(([k, v]) => `${esc(k)}: ${v}`).join(', ') || 'tidak ada';
  const errRows = [...errors].reverse().slice(0, 30).map((e) => `<tr><td>${wib(e.ts)}</td><td>${esc(e.type)}</td><td>${esc(e.pair || '')}</td><td>${esc(String(e.detail || '').slice(0, 140))}</td></tr>`).join('');
  const g = gap && !gap.error ? `<h2>Backtest vs forward test (jendela candle sama)</h2>
  <div class="cards">${c('Return forward', num(gap.return_forward_pct) + '%')}${c('Return backtest', num(gap.return_backtest_pct) + '%')}${c('Selisih', num(gap.selisih_pct_poin) + ' poin', 'forward dikurangi backtest')}${c('Order cocok', `${gap.order_cocok} dari ${gap.order_forward} (forward) / ${gap.order_backtest} (backtest)`)}${c('Selisih fill rata-rata', num(gap.rata2_selisih_fill_pct, 3) + '%', 'positif = fill live lebih buruk')}</div>
  ${gap.hanya_di_forward.length || gap.hanya_di_backtest.length ? `<p class="muted">Hanya di forward: ${esc(gap.hanya_di_forward.join(', ') || '-')}. Hanya di backtest: ${esc(gap.hanya_di_backtest.join(', ') || '-')}.</p>` : ''}` : '<p class="muted">Perbandingan backtest vs forward dihitung oleh <code>scripts/hitung_ulang.js --gap</code> (butuh data harga terbaru). Dashboard offline memuatnya bila sudah dijalankan.</p>';
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Bot Dry Run Indodax</title>
<style>
:root{--bg:#f7f7f5;--fg:#1c1c1a;--mut:#6b6b66;--card:#fff;--bd:#e3e3de;--pos:#0a7a43;--neg:#b3261e;--eq:#1a56db;--btc:#c27803;--grid:#ececE7}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ececE7;--mut:#9a9a93;--card:#1d1d1b;--bd:#32322f;--pos:#4ade80;--neg:#f87171;--eq:#60a5fa;--btc:#fbbf24;--grid:#2a2a27}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1000px;margin:0 auto;padding:20px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 10px}
.muted{color:var(--mut);font-size:13px}code{font-size:12px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px 14px}.k{font-size:12px;color:var(--mut)}.v{font-size:20px;font-weight:600;margin-top:2px}.s{font-size:12px;color:var(--mut);margin-top:2px}
.pos{color:var(--pos)}.neg{color:var(--neg)}svg{width:100%;height:auto;background:var(--card);border:1px solid var(--bd);border-radius:10px}
.eq{stroke:var(--eq);stroke-width:2}.btc{stroke:var(--btc);stroke-width:1.5;stroke-dasharray:5 4}.grid{stroke:var(--grid)}.base{stroke:var(--mut);stroke-dasharray:2 3;stroke-width:1}.ax{fill:var(--mut);font-size:11px}
.leg{font-size:13px;margin:6px 0}.leg i{display:inline-block;width:18px;height:0;border-top:3px solid;vertical-align:middle;margin:0 6px 0 12px}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--bd);border-radius:10px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:7px 10px;border-bottom:1px solid var(--bd);text-align:left;white-space:nowrap}th{color:var(--mut);font-weight:500}.r{text-align:right}tr:last-child td{border-bottom:0}
</style></head><body><main>
<h1>Dashboard Bot Dry Run Indodax</h1>
<div class="muted">Periode ${wib(Date.parse(m.periode.mulai) / 1000)} sampai ${wib(Date.parse(m.periode.akhir) / 1000)} (${num(m.periode.hari, 1)} hari) · ${m.sumber.jumlah_tick} tick · ${m.sumber.jumlah_order} order simulasi · sumber: ${esc(sumber)} · dibuat ${wib(dibuat)}${m.hash ? ` · hash config <code>${esc(m.hash.config)}</code> signals <code>${esc(m.hash.signals)}</code>` : ''}</div>

<h2>Ringkasan</h2>
<div class="cards">
${c('Return', `<span class="${sign(m.return_pct)}">${num(m.return_pct)}%</span>`, `${idr(m.equity_awal)} menjadi ${idr(m.equity_akhir)}`)}
${c('Max drawdown', num(m.max_drawdown_pct) + '%')}
${c('Benchmark BTC buy & hold', m.benchmark_btc_buy_hold ? num(m.benchmark_btc_buy_hold.return_pct) + '%' : '-', m.selisih_vs_btc_pct_poin !== null ? `bot ${m.selisih_vs_btc_pct_poin >= 0 ? 'unggul' : 'tertinggal'} ${num(Math.abs(m.selisih_vs_btc_pct_poin))} poin` : '')}
${c('Trade tertutup', m.trade_tertutup, `${m.order_buy} order beli · ${m.posisi_terbuka_di_akhir ?? 0} posisi terbuka`)}
${c('Win rate', m.win_rate_pct === null ? '-' : num(m.win_rate_pct, 1) + '%')}
${c('Profit factor', m.profit_factor === null ? '-' : num(m.profit_factor))}
${c('Rata-rata menang / kalah', `${idr(m.avg_win_idr)} / ${idr(m.avg_loss_idr)}`)}
${c('Cost ratio', m.biaya.cost_ratio === null ? '-' : num(m.biaya.cost_ratio, 3), esc(m.biaya.catatan))}
${c('Uptime', m.uptime.persen === null ? '-' : num(m.uptime.persen, 1) + '%', `${m.uptime.tepat_waktu} tepat waktu, ${m.uptime.terlambat} terlambat, ${m.uptime.terlewat} terlewat dari ${m.uptime.candle_jatuh_tempo} candle`)}
${c('Error', m.error.total, `API error: ${m.error.api_error}`)}
</div>

<h2>Kurva equity</h2>
${chart(series.equity, series.btc, m.equity_awal)}
<div class="leg"><i style="border-color:var(--eq)"></i>Equity bot (posisi dinilai di best bid)<i style="border-color:var(--btc);border-top-style:dashed"></i>BTC buy &amp; hold (setelah fee)</div>

<h2>Biaya transaksi</h2>
<div class="cards">${c('Fee', idr(m.biaya.fee_idr))}${c('Spread', idr(m.biaya.spread_idr))}${c('Slippage vs sinyal', idr(m.biaya.slippage_idr), 'bertanda, negatif = lebih baik dari sinyal')}${c('Total biaya', idr(m.biaya.total_idr))}</div>

${g}

<h2>Spread dari snapshot order book</h2>
<p class="muted">Median semua pair ${num(sp.median_semua_pair_pct, 4)}% dibanding asumsi backtest ${num(sp.asumsi_backtest_pct, 2)}% (slippage ${num(sp.asumsi_slippage_pct, 2)}%).</p>
<div class="tw"><table><thead><tr><th>Pair</th><th class="r">Snapshot</th><th class="r">Median</th><th class="r">P90</th></tr></thead><tbody>${spRows}</tbody></table></div>

<h2>Order simulasi (100 terbaru)</h2>
<div class="tw"><table><thead><tr><th>Waktu</th><th>Pair</th><th>Sisi</th><th class="r">Fill</th><th class="r">Bid / Ask</th><th class="r">Beda vs sinyal</th><th class="r">Fee</th><th class="r">PnL</th><th>Alasan</th></tr></thead><tbody>${ordRows || '<tr><td colspan="9" class="muted">Belum ada order.</td></tr>'}</tbody></table></div>

<h2>Error dan penolakan</h2>
<p class="muted">Per tipe: ${errTypes}. Kill switch aktif tercatat ${m.kill_switch_events} kali.</p>
${errRows ? `<div class="tw"><table><thead><tr><th>Waktu</th><th>Tipe</th><th>Pair</th><th>Detail</th></tr></thead><tbody>${errRows}</tbody></table></div>` : ''}

<p class="muted" style="margin-top:32px">Semua angka dihitung ulang dari log mentah oleh <code>lib/metrics.js</code> (dipakai juga oleh <code>scripts/hitung_ulang.js</code>). Tidak ada angka yang ditulis tangan.</p>
</main></body></html>`;
}

module.exports = { render };
