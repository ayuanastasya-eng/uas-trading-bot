'use strict';
// Dashboard di Vercel: membaca log mentah dari Redis, menghitung metrik dengan lib/metrics.js, lalu menampilkannya.
const fs = require('fs');
const path = require('path');
const { makeStore } = require('../lib/store');
const { computeMetrics } = require('../lib/metrics');
const { render } = require('../lib/dashboard_html');

const TYPES = ['ticks', 'orders', 'equity', 'errors', 'killswitch', 'snapshots', 'signals'];
const ROOT = path.join(__dirname, '..');
const loadJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const store = makeStore(process.env);
    const L = {};
    for (const t of TYPES) L[t] = (await store.lrange(`log:${t}`, 0, -1)).map((r) => JSON.parse(r));
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    // ?end=2026-11-14T05:00:00Z memotong tampilan di batas waktu itu, supaya angka dashboard = angka di paket pengumpulan
    const endIso = req.query && req.query.end ? String(req.query.end) : '';
    const endMs = endIso ? Date.parse(endIso) : NaN;
    const endTs = Number.isFinite(endMs) ? endMs / 1000 : undefined;
    const { metrics, series } = computeMetrics(L, cfg, { endTs });
    const upTo = (rows) => (endTs ? rows.filter((r) => r.ts <= endTs) : rows);
    // Ringkasan backtest 3 tahun dan gap backtest-vs-forward berasal dari berkas hasil finalisasi
    // (dihitung ulang oleh scripts/hitung_ulang.js --gap, bukan angka yang ditulis tangan).
    const backtest = loadJson(path.join(ROOT, 'backtest_summary.json'));
    const hasil = loadJson(path.join(ROOT, 'hasil', 'metrics.json'));
    const gap = hasil && hasil.gap_backtest_vs_forward ? hasil.gap_backtest_vs_forward : null;
    const gapInfo = hasil ? { dihitung_pada: hasil.dihitung_pada, akhir: hasil.periode && hasil.periode.akhir } : null;
    const html = render({
      metrics, series, orders: upTo(L.orders), errors: upTo(L.errors), gap, gapInfo, backtest,
      sumber: 'log mentah di Redis' + (endTs ? `, dipotong sampai ${new Date(endTs * 1000).toISOString()}` : ' (langsung, tanpa batas waktu)'),
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).json({ error: 'dashboard_error', detail: String(e.message || e) });
  }
};
