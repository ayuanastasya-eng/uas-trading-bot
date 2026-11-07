'use strict';
// Klien API publik Indodax. Sequential + rate limit (<= 2,5 req/detik) + retry-limit 3x.

const BASE = process.env.INDODAX_BASE || 'https://indodax.com';
const MIN_GAP_MS = 400; // batas soal: 3 req/detik
const MAX_ATTEMPTS = 3; // retry-limit per request
const TIMEOUT_MS = 8000;

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path, params) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(BASE + path + qs, {
        signal: ctrl.signal,
        // Nama klien yang SAMA dengan fetch_history.py (terbukti diterima Indodax). Kata "bot" di nama klien bisa memicu 403.
        headers: { 'User-Agent': process.env.INDODAX_UA || 'uas-algotrading-fetch/1.0', Accept: '*/*' },
      });
      if (!r.ok) {
        let body = '';
        try { body = (await r.text()).slice(0, 120).replace(/\s+/g, ' '); } catch (e) { /* abaikan */ }
        throw new Error('HTTP ' + r.status + (body ? ' | ' + body : ''));
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  const err = new Error(`${path}: ${lastErr && lastErr.message} (gagal setelah ${MAX_ATTEMPTS} percobaan)`);
  err.code = 'api_error';
  throw err;
}

const toSeconds = (t) => (t > 1e11 ? Math.floor(t / 1000) : t);

async function serverTime() {
  const j = await getJson('/api/server_time');
  const t = toSeconds(Number(j && j.server_time));
  if (!Number.isFinite(t) || t <= 0) throw new Error('server_time tidak valid: ' + JSON.stringify(j));
  return t;
}

// Mengembalikan [{time, open, high, low, close, volume}] urut lama -> baru (TERMASUK candle yang belum tertutup).
async function history(pair, tf, from, to) {
  const j = await getJson('/tradingview/history_v2', {
    symbol: pair.toUpperCase(),
    tf: String(tf),
    from: String(from),
    to: String(to),
  });
  if (!Array.isArray(j)) throw new Error('history_v2 bukan array: ' + JSON.stringify(j).slice(0, 200));
  return j
    .map((b) => ({
      time: toSeconds(Number(b.Time)),
      open: Number(b.Open),
      high: Number(b.High),
      low: Number(b.Low),
      close: Number(b.Close),
      volume: Number(b.Volume),
    }))
    .sort((a, b) => a.time - b.time);
}

// Parser toleran: bentuk [[harga, jumlah], ...] atau [{price, amount}, ...].
function parseDepth(j) {
  const side = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((l) => (Array.isArray(l) ? [Number(l[0]), Number(l[1])] : [Number(l.price), Number(l.amount != null ? l.amount : l.qty)]))
      .filter(([p, q]) => Number.isFinite(p) && p > 0 && Number.isFinite(q) && q >= 0);
  const bids = side(j && j.buy).sort((a, b) => b[0] - a[0]); // bid: tertinggi dulu
  const asks = side(j && j.sell).sort((a, b) => a[0] - b[0]); // ask: terendah dulu
  return { bids, asks };
}

async function depth(pair) {
  const j = await getJson(`/api/depth/${pair}`);
  return parseDepth(j);
}

module.exports = { serverTime, history, depth, parseDepth };
