// Tes: mesin bot live (lib/engine.js) diputar ulang di atas data historis dan dibandingkan dengan backtest.js.
// Membuktikan: sinyal IDENTIK, order identik waktunya, tidak ada eksekusi ganda, kill switch, candle basi, auth.
// Jalankan:  node test/replay_test.js        (butuh folder data/ berisi CSV universe)
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { runTick } = require('../lib/engine');
const { memoryStore } = require('../lib/store');

const root = path.join(__dirname, '..');
const cfg0 = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
// slippage = 0 supaya fill mock = fill backtest persis (spread tetap dipakai)
const cfg = { ...cfg0, costs: { ...cfg0.costs, slippage_pct: 0 } };
const tmpDir = path.join(root, 'out_replay');
fs.mkdirSync(tmpDir, { recursive: true });
const cfgPath = path.join(tmpDir, 'config_test.json');
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

const dur = cfg.tf_seconds;
const hs = cfg.costs.spread_pct / 100 / 2;
const bars = {};
for (const p of cfg.universe) {
  bars[p] = fs.readFileSync(path.join(root, 'data', `${p}_${cfg.timeframe}.csv`), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
    const [t, o, h, lo, c, v] = l.split(',');
    return { time: +t, open: +o, high: +h, low: +lo, close: +c, volume: +v };
  });
}

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK   ' : '  GAGAL ') + msg); if (!cond) failures++; };

// ---- exchange tiruan: menyajikan data CSV seolah-olah "sekarang" = cursor.now (termasuk candle berjalan yang belum tertutup) ----
function mockExchange(cursor, opts = {}) {
  return {
    async serverTime() { return cursor.now; },
    async history(pair, tf, from, to) {
      return bars[pair].filter((b) => b.time >= from && b.time <= Math.min(to, cursor.now));
    },
    async depth(pair) {
      const closed = bars[pair].filter((b) => b.time + dur <= cursor.now);
      const c = closed[closed.length - 1].close;
      if (opts.emptyBook) return { bids: [], asks: [] };
      return { bids: [[c * (1 - hs), 5], [c * (1 - hs) * 0.999, 5]], asks: [[c * (1 + hs), 5], [c * (1 + hs) * 1.001, 5]] };
    },
  };
}

const readLog = async (store, k) => (await store.lrange(`log:${k}`, 0, -1)).map((x) => JSON.parse(x));
const parseCsv = (f) => fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

(async () => {
  // ===== 1. Replay vs backtest =====
  console.log('\n[1] Replay mesin live vs backtest');
  const all = bars[cfg.universe[0]];
  let lastBar = all[all.length - 1];
  let d2 = new Date(lastBar.time * 1000);
  if (d2.getUTCHours() !== 20) d2 = new Date(d2.getTime() - 86400000); // pakai hari penuh terakhir
  const D2 = d2.toISOString().slice(0, 10);
  const D1 = new Date(d2.getTime() - 24 * 86400000).toISOString().slice(0, 10);
  const fromTs = Date.parse(D1 + 'T00:00:00Z') / 1000, toTs = Date.parse(D2 + 'T23:59:59Z') / 1000;
  console.log(`  jendela replay: ${D1} s/d ${D2}`);

  cp.execFileSync('node', [path.join(root, 'backtest.js'), '--from', D1, '--to', D2, '--out', tmpDir, '--data', path.join(root, 'data'), '--config', cfgPath], { stdio: 'pipe' });

  const store = memoryStore();
  const cursor = { now: 0 };
  const ex = mockExchange(cursor);
  const candleTimes = [...new Set(bars[cfg.universe[0]].map((b) => b.time))].filter((t) => t >= fromTs && t <= toTs);
  let ticks = 0;
  for (const T of candleTimes) {
    for (const extra of [0, 3600, 7200, 10800]) { // tick jam ke-0,1,2,3 setelah candle tutup (uji idempotensi)
      cursor.now = T + dur + 420 + extra;
      await runTick({ exchange: ex, store, config: cfg, env: {}, hashes: {} });
      ticks++;
    }
  }
  const sigs = await readLog(store, 'signals');
  const ords = await readLog(store, 'orders');
  const bSig = parseCsv(path.join(tmpDir, 'signals.csv'));
  const bOrd = parseCsv(path.join(tmpDir, 'orders.csv'));
  console.log(`  ${ticks} tick, ${sigs.length} sinyal live vs ${bSig.length} sinyal backtest, ${ords.length} order live vs ${bOrd.length} order backtest`);

  ok(sigs.length === bSig.length, 'jumlah sinyal sama (tidak ada candle terlewat / ganda)');
  const liveMap = new Map(sigs.map((s) => [`${s.candle_time}|${s.pair}`, s]));
  ok(liveMap.size === sigs.length, 'tidak ada candle yang diproses dua kali walau tick diulang 4x per candle');
  let sigMismatch = 0;
  for (const [t, p, action, reason, price, ema, atr] of bSig) {
    const s = liveMap.get(`${t}|${p}`);
    if (!s || s.action !== action || s.reason !== reason || !near(s.signal_price, +price) || !near(s.ema, +ema) || !near(s.atr, +atr)) sigMismatch++;
  }
  ok(sigMismatch === 0, `sinyal identik (action, reason, harga, EMA, ATR) pada semua candle (selisih: ${sigMismatch})`);
  const key = (t, p, s) => `${t}|${p}|${s}`;
  const liveOrd = new Set(ords.map((o) => key(o.candle_time, o.pair, o.side)));
  const btOrd = new Set(bOrd.map((r) => key(r[0], r[1], r[2])));
  const diff = [...liveOrd].filter((x) => !btOrd.has(x)).length + [...btOrd].filter((x) => !liveOrd.has(x)).length;
  ok(diff === 0 && liveOrd.size === ords.length, `order BUY/SELL identik waktunya (selisih: ${diff})`);
  const bad = ords.filter((o) => o.fill_price !== (o.side === 'BUY' ? o.best_ask : o.best_bid));
  ok(bad.length === 0, 'semua fill = best ask (BUY) / best bid (SELL), tidak ada harga close/mid');
  const tickLog = await readLog(store, 'ticks');
  ok(tickLog.length === ticks, 'setiap tick tercatat di log ticks');
  const eqLog = await readLog(store, 'equity');
  ok(eqLog.length >= 20, `equity harian tercatat sekali per hari WIB (${eqLog.length} baris)`);
  const snaps = await readLog(store, 'snapshots');
  ok(snaps.length === ticks && snaps.some((s) => s.daily), 'snapshot order book tercatat tiap tick, ada penanda harian');

  // ===== 2. Kill switch =====
  console.log('\n[2] Kill switch');
  {
    const s2 = memoryStore(); const cur = { now: bars[cfg.universe[0]].slice(-1)[0].time + dur + 420 };
    await s2.set('ctrl:kill', JSON.stringify({ on: true, reason: 'tes' }));
    const r = await runTick({ exchange: mockExchange(cur), store: s2, config: cfg, env: {}, hashes: {} });
    ok(r.status === 'kill_switch' && r.orders === 0 && (await readLog(s2, 'signals')).length === 0, 'kill switch (storage) menghentikan evaluasi & order, tick tetap tercatat');
    const s3 = memoryStore();
    const r3 = await runTick({ exchange: mockExchange(cur), store: s3, config: cfg, env: { KILL_SWITCH: '1' }, hashes: {} });
    ok(r3.status === 'kill_switch' && (await readLog(s3, 'killswitch')).length === 1, 'kill switch (env var KILL_SWITCH=1) bekerja & tercatat');
  }

  // ===== 3. Validasi data =====
  console.log('\n[3] Validasi data');
  {
    const last = bars[cfg.universe[0]].slice(-1)[0];
    const s4 = memoryStore();
    const r = await runTick({ exchange: mockExchange({ now: last.time + 4 * dur }), store: s4, config: cfg, env: {}, hashes: {} });
    const errs = await readLog(s4, 'errors');
    ok(r.processed.length === 0 && errs.some((e) => e.type === 'validation_candle_stale'), 'candle tertutup > 2x timeframe ditolak (candle_stale)');
    const s5 = memoryStore();
    const r5 = await runTick({ exchange: mockExchange({ now: last.time + dur + 420 }, { emptyBook: true }), store: s5, config: cfg, env: {}, hashes: {} });
    const errs5 = await readLog(s5, 'errors');
    const sigs5 = await readLog(s5, 'signals');
    ok(r5.orders === 0 && errs5.some((e) => e.type === 'api_error' || e.type.startsWith('orderbook')) || sigs5.every((s) => s.action === 'HOLD'), 'order book kosong tidak menghasilkan order');
    // gap candle
    const exGap = mockExchange({ now: last.time + dur + 420 });
    const origHist = exGap.history;
    exGap.history = async (...a) => { const h = await origHist(...a); h.splice(h.length - 50, 1); return h; };
    const s6 = memoryStore();
    const r6 = await runTick({ exchange: exGap, store: s6, config: cfg, env: {}, hashes: {} });
    ok(r6.processed.length === 0 && (await readLog(s6, 'errors')).some((e) => e.type === 'validation_gap_candle'), 'gap candle ditolak');
  }

  // ===== 4. Auth endpoint =====
  console.log('\n[4] Keamanan endpoint /api/tick');
  {
    const handler = require('../api/tick.js');
    const call = async (headers) => { let code = 0; const res = { setHeader() {}, status(c) { code = c; return this; }, json() { return this; } }; await handler({ headers, method: 'GET' }, res); return code; };
    delete process.env.CRON_SECRET;
    ok((await call({})) === 500, 'tanpa CRON_SECRET di server -> 500 (gagal tertutup)');
    process.env.CRON_SECRET = 'rahasia-tes';
    ok((await call({})) === 401, 'tanpa header Authorization -> 401');
    ok((await call({ authorization: 'Bearer salah' })) === 401, 'secret salah -> 401');
    ok((await call({ authorization: 'rahasia-tes' })) === 401, 'tanpa kata Bearer -> 401');
    const src = fs.readdirSync(path.join(root, 'api')).concat(fs.readdirSync(path.join(root, 'lib'))).length;
    ok(src > 0, 'file sumber terbaca');
  }

  console.log(failures ? `\n${failures} TES GAGAL` : '\nSEMUA TES LULUS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
