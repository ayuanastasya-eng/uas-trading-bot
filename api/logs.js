'use strict';
// Log mentah (read-only, publik, tanpa secret). Dipakai script hitung_ulang dan dashboard.
// GET /api/logs?type=orders&limit=1000   type: ticks|orders|equity|errors|killswitch|snapshots|signals
const { makeStore } = require('../lib/store');

const TYPES = ['ticks', 'orders', 'equity', 'errors', 'killswitch', 'snapshots', 'signals'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const type = String(q.type || '');
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'type harus salah satu dari: ' + TYPES.join(', ') });
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 2000, 1), 5000);
  try {
    const rows = await makeStore(process.env).lrange(`log:${type}`, -limit, -1);
    return res.status(200).json({ type, count: rows.length, rows: rows.map((r) => JSON.parse(r)) });
  } catch (e) {
    return res.status(500).json({ error: 'storage_error', detail: String(e.message || e) });
  }
};
