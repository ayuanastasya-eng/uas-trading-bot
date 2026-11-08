// Membuat dashboard offline: SATU file HTML mandiri (buka dengan klik dua kali, tanpa internet) dari log mentah di folder logs/.
// Pakai:  node scripts/buat_dashboard.js [--logs logs] [--config config.json] [--end 2026-11-14T16:00:00Z] [--gap] [--out dashboard_offline.html]
// --gap: ikut memuat perbandingan backtest vs forward (jalankan dulu: node scripts/hitung_ulang.js --gap, hasilnya dibaca dari hasil/metrics.json)
'use strict';
const fs = require('fs');
const path = require('path');
const { computeMetrics } = require('../lib/metrics');
const { render } = require('../lib/dashboard_html');

const root = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const logsDir = arg('--logs', path.join(root, 'logs'));
const cfg = JSON.parse(fs.readFileSync(arg('--config', path.join(root, 'config.json')), 'utf8'));
const load = (t) => { const f = path.join(logsDir, `${t}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).rows : []; };
const L = Object.fromEntries(['ticks', 'orders', 'equity', 'errors', 'killswitch', 'snapshots', 'signals'].map((t) => [t, load(t)]));
const endTs = arg('--end') ? Date.parse(arg('--end')) / 1000 : undefined;
const { metrics, series } = computeMetrics(L, cfg, { endTs });
let gap = null, gapInfo = null;
if (process.argv.includes('--gap')) {
  const f = path.join(arg('--hasil', path.join(root, 'hasil')), 'metrics.json');
  if (fs.existsSync(f)) {
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    gap = m.gap_backtest_vs_forward || null;
    gapInfo = { dihitung_pada: m.dihitung_pada, akhir: m.periode && m.periode.akhir };
  } else console.warn('hasil/metrics.json tidak ada; bagian gap dilewati. Jalankan scripts/hitung_ulang.js --gap dulu.');
}
const btFile = path.join(root, 'backtest_summary.json');
const backtest = fs.existsSync(btFile) ? JSON.parse(fs.readFileSync(btFile, 'utf8')) : null;
const e = endTs || (L.ticks.length ? L.ticks[L.ticks.length - 1].ts : 0);
const html = render({
  metrics, series, gap, gapInfo, backtest,
  orders: L.orders.filter((o) => o.ts <= e), errors: L.errors.filter((x) => x.ts <= e),
  sumber: `berkas log di ${path.relative(root, logsDir) || 'logs'}/ (diunduh dari /api/logs)`,
});
const out = arg('--out', path.join(root, 'dashboard_offline.html'));
fs.writeFileSync(out, html);
console.log(`Tersimpan: ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
