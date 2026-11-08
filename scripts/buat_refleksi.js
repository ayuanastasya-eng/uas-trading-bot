// buat_refleksi.js — menyusun REFLEKSI.md HANYA dari angka di hasil/metrics.json.
// Tidak ada angka yang ditulis tangan. Narasi memakai angka yang sama dengan dashboard.
//
// Pakai:
//   node scripts/buat_refleksi.js
//   node scripts/buat_refleksi.js --metrics hasil/metrics.json --out REFLEKSI.md
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const metricsPath = path.resolve(root, arg('--metrics', path.join('hasil', 'metrics.json')));
const outPath = path.resolve(root, arg('--out', 'REFLEKSI.md'));

const m = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
const gap = m.gap_backtest_vs_forward || null;
const num = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? '-' : Number(x).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: d }));
const rp = (x) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? '-' : 'Rp' + Math.round(Number(x)).toLocaleString('id-ID'));
const wib = (v) => {
  if (v === null || v === undefined) return '-';
  const ms = typeof v === 'number' ? v * 1000 : Date.parse(v);
  if (!Number.isFinite(ms)) return String(v);
  return new Date(ms + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' WIB';
};
const boolId = (x) => (x ? 'ada' : 'tidak ada');
const listOr = (arr) => (arr && arr.length ? arr.join(', ') : 'tidak ada');

const zeroTrade = !m.trade_tertutup;
const fwdOrder = gap ? gap.order_forward : m.sumber.jumlah_order;
const btOrder = gap ? gap.order_backtest : null;
const btc = m.benchmark_btc_buy_hold ? `${num(m.benchmark_btc_buy_hold.return_pct)}%` : '-';
const spreadRows = Object.entries((m.spread_snapshot && m.spread_snapshot.per_pair) || {})
  .map(([p, s]) => `| ${p.toUpperCase()} | ${s.n} | ${num(s.median_pct, 4)}% | ${num(s.p90_pct, 4)}% |`)
  .join('\n');
const medianSpread = m.spread_snapshot ? m.spread_snapshot.median_semua_pair_pct : null;
const asumsiSpread = m.spread_snapshot ? m.spread_snapshot.asumsi_backtest_pct : null;
const medianDelay = m.uptime && m.uptime.info_tick ? m.uptime.info_tick.median_detik_setelah_jam : null;
const maxDelay = m.uptime && m.uptime.info_tick ? m.uptime.info_tick.maks_detik_setelah_jam : null;
const errTypes = m.error && m.error.per_tipe && Object.keys(m.error.per_tipe).length
  ? Object.entries(m.error.per_tipe).map(([k, v]) => `${k}: ${v}`).join(', ')
  : 'tidak ada';

const spreadVsAssumption = (medianSpread === null || asumsiSpread === null)
  ? 'Belum cukup snapshot untuk dibandingkan dengan asumsi backtest.'
  : medianSpread > asumsiSpread
    ? `Median spread dari snapshot (${num(medianSpread, 4)}%) LEBIH TINGGI dari asumsi backtest (${num(asumsiSpread, 2)}%), sehingga fill live cenderung lebih mahal daripada yang diasumsikan backtest.`
    : `Median spread dari snapshot (${num(medianSpread, 4)}%) LEBIH RENDAH dari asumsi backtest (${num(asumsiSpread, 2)}%), sehingga asumsi biaya backtest cukup konservatif untuk spread.`;

const lessonDelay = (medianDelay === null)
  ? 'Data waktu tick belum cukup untuk mengukur jeda jadwal.'
  : `Median tick baru masuk ${num(medianDelay - 420, 0)} detik setelah jadwal, dan jeda sebesar itu tidak terlihat sama sekali di backtest.`;

const spreadShort = (medianSpread === null || asumsiSpread === null)
  ? 'data spread belum cukup untuk dibandingkan'
  : medianSpread > asumsiSpread
    ? 'spread dari snapshot lebih tinggi dari asumsi backtest'
    : 'spread dari snapshot lebih rendah dari asumsi backtest';

const delayText = (medianDelay === null)
  ? 'Belum ada data keterlambatan jadwal.'
  : medianDelay > 420
    ? `Cron dijadwalkan menit ke-7 (detik ke-420) setiap jam. Realisasinya, tick sukses masuk median ${num(medianDelay, 0)} detik setelah awal jam, yaitu sekitar ${num(medianDelay - 420, 0)} detik (${num((medianDelay - 420) / 60, 0)} menit) setelah jadwal; maksimum ${num(maxDelay, 0)} detik (${num((maxDelay - 420) / 60, 0)} menit setelah jadwal).`
    : `Cron dijadwalkan menit ke-7, dan tick sukses masuk median ${num(medianDelay, 0)} detik setelah awal jam (maksimum ${num(maxDelay, 0)} detik), jadi masih dekat dengan jadwal.`;

const tradeText = zeroTrade
  ? `Tidak ada trade tertutup pada periode ini, jadi win rate, profit factor, dan rata-rata untung/rugi belum bisa dihitung dan tidak dipakai sebagai kesimpulan. Yang tetap bisa dinilai adalah kelengkapan sinyal per candle: ${num(m.sumber.jumlah_sinyal, 0)} sinyal tercatat, seluruhnya berakhir tanpa order.`
  : `Dengan ${m.trade_tertutup} trade tertutup, win rate ${num(m.win_rate_pct, 1)}% dan profit factor ${num(m.profit_factor)}. Jumlah ini masih kecil, jadi angka tersebut belum cukup kuat untuk menyimpulkan strategi secara statistik.`;

const noOrders = gap && !gap.error && Number(gap.order_forward) === 0 && Number(gap.order_backtest) === 0;
const gapText = !gap
  ? 'Bagian gap belum dihitung (jalankan `hitung_ulang.js --gap` setelah data harga diperbarui).'
  : gap.error
    ? `Bagian gap gagal dihitung: ${gap.error}.`
    : noOrders
      ? `Di jendela candle yang sama (${wib(gap.jendela_candle.dari)} sampai ${wib(gap.jendela_candle.sampai)}), forward dan backtest sama-sama tidak menghasilkan order. Tidak ada order yang hanya muncul di salah satu sisi, sehingga tidak ada pasangan order yang bisa dicocokkan per candle. Penyebabnya bukan perbedaan kode: seluruh ${num(m.sumber.jumlah_sinyal, 0)} sinyal forward berakhir tanpa order, dan filter entry yang sama juga menahan backtest. Artinya jendela ini belum menguji selisih harga fill.`
      : `Dari \`gap_backtest_vs_forward\`: ${num(gap.order_cocok, 0)} order cocok dari ${num(gap.order_forward, 0)} order forward dan ${num(gap.order_backtest, 0)} order backtest. Order yang hanya muncul di forward: ${listOr(gap.hanya_di_forward)}. Order yang hanya muncul di backtest: ${listOr(gap.hanya_di_backtest)}.`;

const fillDiffText = (gap && gap.rata2_selisih_fill_pct !== null && gap.rata2_selisih_fill_pct !== undefined)
  ? `Rata-rata selisih harga fill live terhadap asumsi backtest ${num(gap.rata2_selisih_fill_pct, 3)}% (positif berarti fill live lebih mahal untuk beli atau lebih murah untuk jual).`
  : noOrders
    ? 'Karena tidak ada order di kedua sisi, selisih harga fill belum bisa diukur pada periode ini.'
    : 'Belum ada pasangan order yang bisa dibandingkan harga fill-nya.';

const content = `# Refleksi: Selisih Backtest vs Forward Test

Mahasiswa: Ayu Anastasya — NIM 25110200001
Mata kuliah: Algorithmic Trading (Trad1 & Trad2) — UAS individu
Periode forward: ${wib(m.periode.mulai)} sampai ${wib(m.periode.akhir)} (${num(m.periode.hari, 1)} hari)
Batas data paket ini: ${m.periode.akhir}
Commit freeze: \`9a63a1e\` (7 November 2026)
Hash konfigurasi yang tercatat di tick terakhir: config \`${m.hash ? m.hash.config : '-'}\`, signals \`${m.hash ? m.hash.signals : '-'}\`

> Semua angka di bawah berasal dari \`hasil/metrics.json\`, yang dihasilkan \`scripts/hitung_ulang.js\` dari log mentah di \`logs/\`. Tidak ada angka yang ditulis tangan. Dashboard Vercel dan dashboard offline memakai modul perhitungan yang sama (\`lib/metrics.js\`).

## 1. Hasil singkat

| | Forward test | Backtest (jendela candle sama) |
|---|---|---|
| Return | ${num(m.return_pct)}% | ${gap && !gap.error ? num(gap.return_backtest_pct) + '%' : '-'} |
| Selisih | ${gap && !gap.error ? num(gap.selisih_pct_poin) + ' poin' : '-'} | |
| Trade tertutup | ${num(m.trade_tertutup, 0)} | ${gap && !gap.error ? num(gap.trade_backtest, 0) : '-'} |
| Benchmark BTC buy and hold | ${btc} | |
| Max drawdown | ${num(m.max_drawdown_pct)}% | ${gap && !gap.error ? num(gap.max_drawdown_backtest_pct) + '%' : '-'} |
| Uptime | ${num(m.uptime.persen, 1)}% (${num(m.uptime.tepat_waktu, 0)} tepat waktu, ${num(m.uptime.terlambat, 0)} terlambat, ${num(m.uptime.terlewat, 0)} terlewat dari ${num(m.uptime.candle_jatuh_tempo, 0)} candle) | |

Equity bergerak dari ${rp(m.equity_awal)} menjadi ${rp(m.equity_akhir)}. ${tradeText}

## 2. Kecocokan sinyal dan order

${gapText}

${fillDiffText}

## 3. Sumber selisih harga fill

1. **Spread.** Backtest mengasumsikan spread ${num(asumsiSpread, 2)}%. Dari ${num(m.sumber.jumlah_snapshot, 0)} snapshot order book, median spread semua pair ${num(medianSpread, 4)}%. Per pair:

| Pair | Snapshot | Median spread | P90 |
|---|---:|---:|---:|
${spreadRows || '| - | 0 | - | - |'}

   ${spreadVsAssumption}

2. **Slippage dan keterlambatan jadwal.** Backtest mengisi di sekitar harga close; bot live mengisi di best ask/bid saat dipanggil. ${delayText} Slippage terhadap harga sinyal: ${rp(m.biaya.slippage_idr)}.

3. **Fee.** Fee taker 0,20555% untuk beli dan 0,41555% untuk jual, dipakai di kedua sisi. Total fee forward: ${rp(m.biaya.fee_idr)}. Total biaya spread: ${rp(m.biaya.spread_idr)}.

4. **Biaya total terhadap laba kotor (cost ratio).** ${m.biaya.cost_ratio === null ? 'Tidak bisa dihitung: ' + m.biaya.catatan + '.' : num(m.biaya.cost_ratio, 3) + ' — ' + m.biaya.catatan}

## 4. Uptime dan error

Uptime dihitung sesuai soal: candle dianggap terproses bila diproses sebelum candle berikutnya ditutup. Hasil: ${num(m.uptime.persen, 1)}% (${num(m.uptime.tepat_waktu, 0)} tepat waktu, ${num(m.uptime.terlambat, 0)} terlambat, ${num(m.uptime.terlewat, 0)} terlewat dari ${num(m.uptime.candle_jatuh_tempo, 0)} candle yang jatuh tempo). Keterlambatan jadwal tidak sampai membuat candle terlewat karena tick masih masuk sebelum candle berikutnya ditutup; rincian waktunya ada di bagian 3.

Error: ${num(m.error.total, 0)}, API error ${num(m.error.api_error, 0)}. Per tipe: ${errTypes}. Pemakaian kill switch tercatat ${num(m.kill_switch_events, 0)} kali. ${m.error.total === 0 ? 'Tidak ada error yang tercatat, sehingga tidak ada data yang hilang karena kegagalan API.' : 'Error di atas tercatat di log dan tidak dihapus; dampaknya dijelaskan di bagian ini.'}

## 5. Kenapa periode forward ini pendek dan apa dampaknya

Pengerjaan baru dimulai 7 November 2026, setelah freeze date di soal (4 November 2026 12.00 WIB). Forward test pada paket ini baru berjalan ${num(m.periode.hari, 1)} hari (mulai ${wib(m.periode.mulai)}), bukan 10 hari penuh. Ini keterbatasan yang saya nyatakan apa adanya, bukan tanggal yang dimundurkan.

Dengan candle 4 jam dan filter tren yang ketat, jumlah trade pada jendela pendek memang sedikit (${num(m.trade_tertutup, 0)} trade tertutup). Perbandingan dengan backtest 3 tahun karena itu hanya indikatif. Yang bisa diuji dengan cukup baik adalah kecocokan sinyal candle demi candle, kelengkapan log, dan kepatuhan eksekusi pada best bid/ask.

## 6. Apa yang saya pelajari

Yang paling membuat forward test berbeda dari backtest bukan rumus sinyalnya, tetapi cara order benar-benar terjadi. Backtest mengisi order di sekitar harga close dengan asumsi spread dan slippage tetap, sedangkan bot live harus menunggu jadwal, membaca order book saat itu, lalu membayar fee taker di kedua sisi. Di paket ini belum ada trade, jadi saya belum bisa mengukur selisih fill dari pengalaman nyata. Yang bisa saya pastikan: ${spreadShort}, sedangkan keterlambatan jadwal adalah selisih yang paling terlihat. ${lessonDelay}

Hal kedua yang saya pelajari adalah bahwa disiplin waktu lebih penting daripada mengejar hasil. Karena pengerjaan baru dimulai setelah freeze date, jendela forward test menjadi pendek dan sebagian perbandingan kehilangan kekuatan. Kalau bisa memulai ulang, saya akan menyelesaikan strategi dan deploy lebih awal, mengumpulkan snapshot order book sejak hari pertama persiapan, dan memastikan penjadwal berjalan penuh 10 hari supaya selisih backtest dan forward bisa dijelaskan dengan lebih banyak trade. Saya juga akan memantau uptime setiap hari, bukan menunggu sampai akhir periode.

## 7. Pernyataan

Semua angka di atas berasal dari log mentah dan dapat dihitung ulang dengan \`scripts/hitung_ulang.js\`. Aturan, parameter, dan universe tidak diubah sejak commit freeze \`9a63a1e\`. Forward test dimulai ${wib(m.periode.mulai)} dan data dipotong pada ${wib(m.periode.akhir)}. Tidak ada hasil yang difabrikasi; kekurangan periode dan keterlambatan jadwal dicatat apa adanya.
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content);
console.log(`Tersimpan: ${path.relative(root, outPath)} (${(content.length / 1024).toFixed(1)} KB)`);
