'use strict';
// Mesin tick bot dry run. Dipanggil dari api/tick.js (produksi) dan test/replay_test.js (tes).
// Aturan utama:
//  - hanya candle TERTUTUP yang dipakai (candle berjalan dibuang)
//  - fill HANYA di best ask (beli) / best bid (jual) dari order book live
//  - satu candle tidak pernah dieksekusi dua kali (state.last_candle + kunci exec:<pair>:<candle>)
const { computeSignal, positionSizeIdr, minBarsNeeded } = require('../signals');

const WIB_OFFSET = 7 * 3600;
const HISTORY_BARS = 600; // HARUS sama dengan jendela di backtest.js (EMA seed dari bar pertama jendela)
const MAX_SPREAD_PCT = 2;
const BOOK_LEVELS = 20;
const EXEC_TTL = 60 * 60 * 24 * 40;

const iso = (ts) => new Date(ts * 1000).toISOString();
const wibDate = (ts) => new Date((ts + WIB_OFFSET) * 1000).toISOString().slice(0, 10);

function validateBars(bars, now, dur, minBars) {
  if (bars.length < minBars) return 'data_kurang';
  const last = bars[bars.length - 1];
  const expected = Math.floor(now / dur) * dur - dur; // open time candle tertutup terbaru
  if (last.time < expected) {
    return now - (last.time + dur) > 2 * dur ? 'candle_stale' : 'candle_not_ready';
  }
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].time - bars[i - 1].time !== dur) return 'gap_candle';
  }
  const bad = [last.open, last.high, last.low, last.close].some((v) => !(v > 0)) || !(last.volume > 0);
  if (bad) return 'zero_volume_or_price';
  return null;
}

function makeBook(raw) {
  const bid = raw.bids[0] ? raw.bids[0][0] : 0;
  const ask = raw.asks[0] ? raw.asks[0][0] : 0;
  const spreadPct = bid > 0 && ask > 0 ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
  return { bestBid: bid, bestAsk: ask, spreadPct, bids: raw.bids.slice(0, BOOK_LEVELS), asks: raw.asks.slice(0, BOOK_LEVELS) };
}

function bookReason(b) {
  if (!b) return 'orderbook_missing';
  if (!(b.bestBid > 0) || !(b.bestAsk > 0)) return 'orderbook_empty';
  if (b.bestAsk < b.bestBid) return 'orderbook_crossed';
  if (b.spreadPct > MAX_SPREAD_PCT) return 'spread_too_wide';
  return null;
}

async function runTick({ exchange, store, config, env = {}, hashes = {} }) {
  const t0 = Date.now();
  const cfg = config;
  const dur = cfg.tf_seconds;
  const universe = cfg.universe;
  const feeBuy = cfg.costs.taker_fee_buy_pct / 100;
  const feeSell = cfg.costs.taker_fee_sell_pct / 100;
  let now = Math.floor(t0 / 1000);

  const L = { ticks: [], orders: [], equity: [], errors: [], killswitch: [], snapshots: [], signals: [] };
  const err = (type, pair, detail) =>
    L.errors.push({ ts: now, iso: iso(now), type, pair: pair || null, detail: String(detail).slice(0, 500) });

  const lockId = `${t0}-${Math.random().toString(36).slice(2)}`;
  if (!(await store.set('lock:tick', lockId, { nx: true, ex: 50 }))) return { status: 'locked_skipped' };

  const tick = { status: 'ok', evaluated: [], processed: [], rejected: [], orders: 0, kill: false, equity: null, cash: null, open_positions: null };
  let state = null;

  try {
    now = await exchange.serverTime();

    // ---- state ----
    const raw = await store.get('state:main');
    state = raw
      ? JSON.parse(raw)
      : { version: 1, started_at: now, initial_capital: cfg.risk.initial_capital, cash: cfg.risk.initial_capital, positions: {}, last_candle: {}, day: { date: null, equity: null } };
    tick.started_at = state.started_at;

    // ---- kill switch (env var atau key di storage) ----
    const envKill = ['1', 'true', 'on'].includes(String(env.KILL_SWITCH || '').toLowerCase());
    let storeKill = null;
    try {
      const k = await store.get('ctrl:kill');
      storeKill = k ? JSON.parse(k) : null;
    } catch (e) {
      /* abaikan, anggap tidak aktif */
    }
    const kill = envKill || !!(storeKill && storeKill.on);
    tick.kill = kill;
    if (kill) {
      tick.status = 'kill_switch';
      L.killswitch.push({ ts: now, iso: iso(now), active: true, source: envKill ? 'env' : 'storage', reason: storeKill && storeKill.reason ? storeKill.reason : null });
    }

    // ---- evaluasi candle baru (tidak dilakukan saat kill switch) ----
    const evals = {};
    const expected = Math.floor(now / dur) * dur - dur;
    if (!kill) {
      for (const pair of universe) {
        const lastDone = state.last_candle[pair];
        if (lastDone !== undefined && lastDone >= expected) continue; // sudah diproses
        tick.evaluated.push(pair);
        if (lastDone !== undefined && expected - lastDone > dur) err('missed_candle', pair, `terlewat ${(expected - lastDone) / dur - 1} candle sebelum ${iso(expected)}`);
        let all;
        try {
          all = await exchange.history(pair, cfg.timeframe, now - (HISTORY_BARS + 50) * dur, now);
        } catch (e) {
          err('api_error', pair, e.message);
          tick.rejected.push({ pair, reason: 'api_error' });
          continue;
        }
        // Buang candle yang belum tertutup, dedup, ambil jendela terakhir
        const seen = new Map();
        for (const b of all) if (b.time + dur <= now) seen.set(b.time, b);
        const bars = [...seen.values()].sort((a, b) => a.time - b.time).slice(-HISTORY_BARS);
        const bad = validateBars(bars, now, dur, minBarsNeeded(cfg.strategy));
        if (bad) {
          err('validation_' + bad, pair, `bars=${bars.length} last=${bars.length ? iso(bars[bars.length - 1].time) : '-'}`);
          tick.rejected.push({ pair, reason: bad });
          continue;
        }
        const pos = state.positions[pair] || null;
        const sig = computeSignal(bars, cfg.strategy, pos);
        evals[pair] = { candle: bars[bars.length - 1].time, sig, hadPos: !!pos, done: false, executed: false, skip: null };
      }
    }

    // ---- order book semua pair (snapshot + fill) ----
    const books = {};
    for (const pair of universe) {
      try {
        books[pair] = makeBook(await exchange.depth(pair));
      } catch (e) {
        books[pair] = null;
        err('api_error', pair, 'depth: ' + e.message);
      }
    }
    const mark = (p) => (books[p] && books[p].bestBid > 0 ? books[p].bestBid : (state.positions[p] && state.positions[p].last_price) || 0);
    const equityNow = () => state.cash + Object.entries(state.positions).reduce((s, [p, pos]) => s + pos.qty * mark(p), 0);
    for (const [p, pos] of Object.entries(state.positions)) if (books[p] && books[p].bestBid > 0) pos.last_price = books[p].bestBid;

    // ---- hari baru (WIB): catat equity harian + snapshot order book harian ----
    const wibToday = wibDate(now);
    const eq0 = equityNow();
    const dailyFirst = state.day.date !== wibToday;
    if (dailyFirst) {
      state.day = { date: wibToday, equity: eq0 };
      L.equity.push({
        ts: now, iso: iso(now), date_wib: wibToday, equity: eq0, cash: state.cash,
        positions: Object.fromEntries(Object.entries(state.positions).map(([p, pos]) => [p, { qty: pos.qty, bid: mark(p), value: pos.qty * mark(p) }])),
      });
    }
    L.snapshots.push({
      ts: now, iso: iso(now), daily: dailyFirst,
      pairs: Object.fromEntries(universe.map((p) => [p, books[p] ? { bid: books[p].bestBid, ask: books[p].bestAsk, spread_pct: books[p].spreadPct, bids: books[p].bids, asks: books[p].asks } : { error: true }])),
    });

    // ---- eksekusi ----
    const claim = (pair, candle) => store.set(`exec:${pair}:${candle}`, String(now), { nx: true, ex: EXEC_TTL });
    const order = (o) => {
      L.orders.push(o);
      tick.orders++;
    };

    if (!kill) {
      // 1) Exit & update stop
      for (const pair of universe) {
        const ev = evals[pair];
        const pos = state.positions[pair];
        if (!ev || !pos) continue;
        if (ev.sig.action === 'SELL') {
          const bad = bookReason(books[pair]);
          if (bad) {
            err(bad, pair, 'SELL ditunda, dicoba lagi di tick berikutnya');
            tick.rejected.push({ pair, reason: bad });
            ev.rejected = true;
            continue;
          }
          if (!(await claim(pair, ev.candle))) {
            ev.rejected = true;
            err('duplicate_candle', pair, `candle ${ev.candle} sudah dieksekusi`);
            continue;
          }
          const b = books[pair];
          const gross = pos.qty * b.bestBid;
          const fee = gross * feeSell;
          const proceeds = gross - fee;
          state.cash += proceeds;
          order({
            id: `${pair}-${ev.candle}-SELL`, ts: now, iso: iso(now), candle_time: ev.candle, pair, side: 'SELL', qty: pos.qty,
            best_bid: b.bestBid, best_ask: b.bestAsk, fill_price: b.bestBid, signal_price: ev.sig.signalPrice,
            signal_diff_pct: ((b.bestBid - ev.sig.signalPrice) / ev.sig.signalPrice) * 100,
            notional_idr: gross, fee_pct: feeSell * 100, fee_idr: fee, reason: ev.sig.reason,
            entry_cost_idr: pos.entry_cost, pnl_idr: proceeds - pos.entry_cost, cash_after: state.cash,
          });
          delete state.positions[pair];
          ev.executed = true;
          ev.done = true;
        } else {
          if (!(await claim(pair, ev.candle))) {
            ev.rejected = true;
            continue;
          }
          if (ev.sig.newStop !== undefined) pos.stop = ev.sig.newStop;
          ev.done = true;
        }
      }
      await store.set('state:main', JSON.stringify(state));

      // 2) Entry
      const eq = equityNow();
      const dayLoss = state.day.equity > 0 ? (eq - state.day.equity) / state.day.equity : 0;
      const limitHit = dayLoss <= -cfg.risk.daily_loss_limit_pct;
      for (const pair of universe) {
        const ev = evals[pair];
        if (!ev || state.positions[pair] || ev.done || ev.rejected) continue;
        if (ev.sig.action !== 'BUY') {
          if (await claim(pair, ev.candle)) ev.done = true;
          else ev.rejected = true;
          continue;
        }
        const bad = bookReason(books[pair]);
        if (bad) {
          err(bad, pair, 'BUY ditunda, dicoba lagi di tick berikutnya');
          tick.rejected.push({ pair, reason: bad });
          ev.rejected = true;
          continue;
        }
        if (!(await claim(pair, ev.candle))) {
          ev.rejected = true;
          continue;
        }
        ev.done = true;
        if (Object.keys(state.positions).length >= cfg.risk.max_positions) { ev.skip = 'max_positions'; continue; }
        if (limitHit) { ev.skip = 'daily_loss_limit'; continue; }
        const spend = positionSizeIdr(eq, state.cash, ev.sig.signalPrice, ev.sig.atr, cfg.risk, cfg.strategy);
        if (spend <= 0) { ev.skip = 'size_below_min_or_no_cash'; continue; }
        const b = books[pair];
        const fee = spend * feeBuy;
        const qty = (spend - fee) / b.bestAsk;
        state.cash -= spend;
        state.positions[pair] = {
          qty, stop: ev.sig.newStop, entry_time: ev.candle, entry_ts: now, entry_fill: b.bestAsk,
          entry_cost: spend, entry_fee_idr: fee, last_price: b.bestBid,
        };
        order({
          id: `${pair}-${ev.candle}-BUY`, ts: now, iso: iso(now), candle_time: ev.candle, pair, side: 'BUY', qty,
          best_bid: b.bestBid, best_ask: b.bestAsk, fill_price: b.bestAsk, signal_price: ev.sig.signalPrice,
          signal_diff_pct: ((b.bestAsk - ev.sig.signalPrice) / ev.sig.signalPrice) * 100,
          notional_idr: spend, fee_pct: feeBuy * 100, fee_idr: fee, reason: ev.sig.reason, stop: ev.sig.newStop, cash_after: state.cash,
        });
        ev.executed = true;
      }

      // 3) Tandai candle diproses + catat sinyal
      for (const pair of universe) {
        const ev = evals[pair];
        if (!ev || !ev.done) continue;
        state.last_candle[pair] = ev.candle;
        tick.processed.push(pair);
        L.signals.push({
          ts: now, iso: iso(now), candle_time: ev.candle, pair, action: ev.sig.action, reason: ev.sig.reason,
          signal_price: ev.sig.signalPrice, ema: ev.sig.ema, atr: ev.sig.atr, had_position: ev.hadPos,
          executed: ev.executed, skip_reason: ev.skip,
        });
      }
    }

    tick.equity = equityNow();
    tick.cash = state.cash;
    tick.open_positions = Object.keys(state.positions).length;
  } catch (e) {
    tick.status = 'error';
    err('exception', null, e && e.stack ? e.stack : e);
  } finally {
    try {
      if (state) await store.set('state:main', JSON.stringify(state));
      L.ticks.push({
        ts: now, iso: iso(now), status: tick.status, duration_ms: Date.now() - t0, ...hashes,
        started_at: tick.started_at || null, evaluated: tick.evaluated, processed: tick.processed, rejected: tick.rejected,
        orders: tick.orders, errors: L.errors.length, equity: tick.equity, cash: tick.cash, open_positions: tick.open_positions, kill: tick.kill,
      });
      const cmds = [];
      for (const [k, arr] of Object.entries(L)) for (const row of arr) cmds.push(['RPUSH', `log:${k}`, JSON.stringify(row)]);
      await store.multi(cmds);
    } finally {
      try {
        if ((await store.get('lock:tick')) === lockId) await store.del('lock:tick');
      } catch (e) {
        /* lock punya TTL 50 detik, aman */
      }
    }
  }
  return { status: tick.status, ts: now, evaluated: tick.evaluated, processed: tick.processed, rejected: tick.rejected, orders: tick.orders, errors: L.errors.length, equity: tick.equity, kill: tick.kill };
}

module.exports = { runTick, validateBars, bookReason, makeBook, wibDate, HISTORY_BARS };
