// hitung_ulang.js — SEMUA metrik dihitung ulang dari log mentah. Tidak ada angka yang ditulis tangan.
//
// Langkah:
//   1) Unduh log mentah dari bot (disimpan ke logs/ sebagai bukti, boleh di-commit):
//        node scripts/hitung_ulang.js --url https://uas-trading-bot.vercel.app --unduh
//   2) Hitung metrik dari folder logs/:
//        node scripts/hitung_ulang.js --end 2026-11-18T00:00:00Z
//      (--end = akhir periode forward test; default = tick terakhir)
//   3) Bandingkan dengan backtest di jendela yang sama (butuh data/ yang sudah di-update sampai akhir periode):
//        node scripts/hitung_ulang.js --end 2026-11-18T00:00:00Z --gap
// Output: hasil/metrics.json (+ ringkasan di layar). Opsi: --logs <folder> --config <file> --out <folder>
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { computeMetrics, iso } = require('../lib/metrics');

const root = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const logsDir = arg('--logs', path.join(root, 'logs'));
const cfgPath = arg('--config', path.join(root, 'config.json'));
const outDir = arg('--out', path.join(root, 'hasil'));
const TYPES = ['ticks', 'orders', 'equity', 'errors', 'killswitch', 'snapshots', 'signals'];

async function unduh() {
  const base = (arg('--url') || '').replace(/\/$/, '');
  if (!base) throw new Error('isi --url https://<nama-proyek>.vercel.app');
  fs.mkdirSync(logsDir, { recursive: true });
  for (const t of TYPES) {
    const r = await fetch(`${base}/api/logs?type=${t}&limit=5000`, { headers: { 'User-Agent': 'uas-algotrading-fetch/1.0' } });
    if (!r.ok) throw new Error(`${t}: HTTP ${r.status}`);
    const j = await r.json();
    fs.writeFileSync(path.join(logsDir, `${t}.json`), JSON.stringify({ fetched_at: new Date().toISOString(), type: t, count: j.rows.length, rows: j.rows }, null, 1));
    console.log(`  ${t.padEnd(10)} ${j.rows.length} baris`);
  }
}

const load = (t) => {
  const f = path.join(logsDir, `${t}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).rows : [];
};
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : +x.toFixed(2));

function hitung() {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const L = Object.fromEntries(TYPES.map((t) => [t, load(t)]));
  if (!L.ticks.length) throw new Error(`log ticks kosong di ${logsDir}. Jalankan dengan --unduh dulu.`);
  const endTs = arg('--end') ? Date.parse(arg('--end')) / 1000 : undefined;
  const { metrics } = computeMetrics(L, cfg, { endTs });
  const m = {
    dihitung_pada: new Date().toISOString(),
    sumber_berkas: { logs_dir: path.relative(root, logsDir), config: path.relative(root, cfgPath) },
    ...metrics,
  };
  if (has('--gap')) {
    const e = endTs || L.ticks[L.ticks.length - 1].ts;
    const orders = L.orders.filter((o) => o.ts <= e);
    const finalEq = m.equity_akhir;
    m.gap_backtest_vs_forward = gap(cfg, L, e, finalEq, orders);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(m, null, 2));
  return m;
}

// Backtest dengan sinyal yang sama, dipotong di jendela candle yang sama dengan yang dipakai bot live.
function gap(cfg, L, endTs, finalEq, orders) {
  const sig = L.signals.filter((s) => s.ts <= endTs);
  if (!sig.length) return { error: 'log signals kosong' };
  const cMin = Math.min(...sig.map((s) => s.candle_time)), cMax = Math.max(...sig.map((s) => s.candle_time));
  const tmp = path.join(outDir, 'backtest_jendela');
  fs.mkdirSync(tmp, { recursive: true });
  cp.execFileSync('node', [path.join(root, 'backtest.js'), '--from', iso(cMin), '--to', iso(cMax), '--out', tmp, '--data', arg('--data', path.join(root, 'data')), '--config', cfgPath], { stdio: 'pipe' });
  const bs = JSON.parse(fs.readFileSync(path.join(tmp, 'summary.json'), 'utf8'));
  const rows = (f) => fs.readFileSync(path.join(tmp, f), 'utf8').trim().split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(','));
  const bOrd = rows('orders.csv'); // time,pair,side,qty,fill_price,fee_idr,reason
  const live = new Map(orders.map((o) => [`${o.candle_time}|${o.pair}|${o.side}`, o]));
  const bt = new Map(bOrd.map((r) => [`${r[0]}|${r[1]}|${r[2]}`, r]));
  const cocok = [...live.keys()].filter((k) => bt.has(k));
  const diffs = cocok.map((k) => { const l = live.get(k), b = bt.get(k); return ((l.fill_price - +b[4]) / +b[4]) * 100 * (l.side === 'BUY' ? 1 : -1); });
  const liveRet = (finalEq / cfg.risk.initial_capital - 1) * 100;
  return {
    jendela_candle: { dari: iso(cMin), sampai: iso(cMax) },
    return_forward_pct: r2(liveRet),
    return_backtest_pct: bs.return_total_pct,
    selisih_pct_poin: r2(liveRet - bs.return_total_pct),
    order_forward: live.size,
    order_backtest: bt.size,
    order_cocok: cocok.length,
    hanya_di_forward: [...live.keys()].filter((k) => !bt.has(k)),
    hanya_di_backtest: [...bt.keys()].filter((k) => !live.has(k)),
    rata2_selisih_fill_pct: diffs.length ? r2(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null,
    catatan_selisih_fill: 'positif = fill live lebih MAHAL (beli) / lebih MURAH (jual) daripada fill asumsi backtest',
    asumsi_backtest: { spread_pct: cfg.costs.spread_pct, slippage_pct: cfg.costs.slippage_pct },
  };
}

(async () => {
  if (has('--unduh')) { console.log('Mengunduh log mentah...'); await unduh(); if (!has('--hitung')) return console.log('\nSelesai. Jalankan lagi tanpa --unduh untuk menghitung.'); }
  const m = hitung();
  console.log(JSON.stringify(m, null, 2));
  console.log(`\nTersimpan: ${path.relative(root, path.join(outDir, 'metrics.json'))}`);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
