'use strict';
// Kill switch manual. POST dengan Authorization: Bearer <CRON_SECRET>, body: {"on": true, "reason": "..."}
// Saat aktif, tick tetap jalan (log + snapshot) tetapi TIDAK ada order.
const crypto = require('crypto');
const { makeStore } = require('../lib/store');

function authorized(req) {
  const got = Buffer.from(String(req.headers['authorization'] || ''));
  const want = Buffer.from(`Bearer ${process.env.CRON_SECRET}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.CRON_SECRET) return res.status(500).json({ error: 'server_misconfigured' });
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'gunakan POST' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const on = body.on === true;
  const ts = Math.floor(Date.now() / 1000);
  try {
    const store = makeStore(process.env);
    await store.set('ctrl:kill', JSON.stringify({ on, reason: body.reason || null, ts }));
    await store.rpush('log:killswitch', JSON.stringify({ ts, iso: new Date(ts * 1000).toISOString(), active: on, source: 'manual', reason: body.reason || null }));
    return res.status(200).json({ kill_switch: on });
  } catch (e) {
    return res.status(500).json({ error: 'storage_error', detail: String(e.message || e) });
  }
};
