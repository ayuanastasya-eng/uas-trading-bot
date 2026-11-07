// Uji LANGSUNG ke API Indodax asli, tanpa Vercel/Upstash (state di memori, dibuang setelah selesai).
// Jalankan dari folder proyek:  node scripts/local_tick.js
// Tujuan: memastikan format API (server_time, history_v2, depth) terbaca benar sebelum deploy.
const { runTick } = require('../lib/engine');
const { memoryStore } = require('../lib/store');
const indodax = require('../lib/indodax');
const { hashes } = require('../lib/hash');
const config = require('../config.json');

(async () => {
  const store = memoryStore();
  console.log('Menjalankan 1 tick percobaan ke Indodax (tidak ada yang disimpan)...\n');
  const res = await runTick({ exchange: indodax, store, config, env: {}, hashes: hashes() });
  console.log('HASIL TICK:', JSON.stringify(res, null, 2));

  const read = async (k) => (await store.lrange(`log:${k}`, 0, -1)).map((x) => JSON.parse(x));
  const signals = await read('signals');
  const errors = await read('errors');
  const snaps = await read('snapshots');
  const orders = await read('orders');

  console.log('\nSINYAL per pair:');
  for (const s of signals) console.log(`  ${s.pair.padEnd(8)} candle ${new Date(s.candle_time * 1000).toISOString()}  ${s.action.padEnd(4)} (${s.reason})  close=${s.signal_price}  ema=${Number(s.ema).toFixed(0)}  atr=${Number(s.atr).toFixed(0)}`);
  if (snaps[0]) {
    console.log('\nORDER BOOK (best bid / best ask / spread):');
    for (const [p, b] of Object.entries(snaps[0].pairs)) console.log(b.error ? `  ${p.padEnd(8)} GAGAL` : `  ${p.padEnd(8)} ${b.bid} / ${b.ask}  spread ${Number(b.spread_pct).toFixed(3)}%  (${b.bids.length} level bid, ${b.asks.length} level ask)`);
  }
  console.log('\nORDER SIMULASI:', orders.length ? '' : '(tidak ada)');
  for (const o of orders) console.log(`  ${o.side} ${o.pair} qty=${o.qty} fill=${o.fill_price} (signal ${o.signal_price}, selisih ${o.signal_diff_pct.toFixed(3)}%)`);
  console.log('\nERROR/PENOLAKAN:', errors.length ? '' : '(tidak ada)');
  for (const e of errors) console.log(`  [${e.type}] ${e.pair || ''} ${e.detail}`);
  console.log(errors.length ? '\n>>> Ada error di atas. Kirim seluruh output ini ke asisten.' : '\n>>> Semua API terbaca dengan benar.');
})().catch((e) => {
  console.error('GAGAL TOTAL:', e);
  process.exit(1);
});
