'use strict';
// Endpoint tick: dipanggil cron eksternal tiap jam (menit ke-7). Dilindungi: Authorization: Bearer <CRON_SECRET>.
const crypto = require('crypto');
const { runTick } = require('../lib/engine');
const { makeStore } = require('../lib/store');
const indodax = require('../lib/indodax');
const { hashes } = require('../lib/hash');
const config = require('../config.json');

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(String(req.headers['authorization'] || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.CRON_SECRET) return res.status(500).json({ error: 'server_misconfigured' }); // gagal tertutup
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const result = await runTick({ exchange: indodax, store: makeStore(process.env), config, env: process.env, hashes: hashes() });
    return res.status(result.status === 'error' ? 500 : 200).json(result);
  } catch (e) {
    return res.status(500).json({ error: 'tick_failed', detail: String(e.message || e) });
  }
};
