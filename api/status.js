'use strict';
// Ringkasan state bot (read-only, publik).
const { makeStore } = require('../lib/store');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const store = makeStore(process.env);
    const [rawState, rawKill, lastTick, nOrders, nTicks, nErrors] = await Promise.all([
      store.get('state:main'),
      store.get('ctrl:kill'),
      store.lrange('log:ticks', -1, -1),
      store.llen('log:orders'),
      store.llen('log:ticks'),
      store.llen('log:errors'),
    ]);
    const state = rawState ? JSON.parse(rawState) : null;
    const envKill = ['1', 'true', 'on'].includes(String(process.env.KILL_SWITCH || '').toLowerCase());
    return res.status(200).json({
      initialized: !!state,
      started_at: state ? state.started_at : null,
      cash: state ? state.cash : null,
      positions: state ? state.positions : {},
      last_candle: state ? state.last_candle : {},
      kill_switch: envKill || !!(rawKill && JSON.parse(rawKill).on),
      counts: { ticks: nTicks, orders: nOrders, errors: nErrors },
      last_tick: lastTick && lastTick[0] ? JSON.parse(lastTick[0]) : null,
    });
  } catch (e) {
    return res.status(500).json({ error: 'storage_error', detail: String(e.message || e) });
  }
};
