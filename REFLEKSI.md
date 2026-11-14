# Refleksi: Selisih Backtest vs Forward Test

Mahasiswa: Ayu Anastasya — NIM 25110200001
Mata kuliah: Algorithmic Trading (Trad1 & Trad2) — UAS individu
Periode forward: 2026-11-08 07:11 WIB sampai 2026-11-14 12:00 WIB (6,2 hari)
Batas data paket ini: 2026-11-14T05:00:00.000Z
Commit freeze: `9a63a1e` (7 November 2026)
Hash konfigurasi yang tercatat di tick terakhir: config `9ad12e017cc7d1ab`, signals `1b9ee27fa63403f3`

> Semua angka di bawah berasal dari `hasil/metrics.json`, yang dihasilkan `scripts/hitung_ulang.js` dari log mentah di `logs/`. Tidak ada angka yang ditulis tangan. Dashboard Vercel dan dashboard offline memakai modul perhitungan yang sama (`lib/metrics.js`).

## 1. Hasil singkat

| | Forward test | Backtest (jendela candle sama) |
|---|---|---|
| Return | 0% | 0% |
| Selisih | 0 poin | |
| Trade tertutup | 0 | 0 |
| Benchmark BTC buy and hold | -11,07% | |
| Max drawdown | 0% | 0% |
| Uptime | 100% (185 tepat waktu, 0 terlambat, 0 terlewat dari 185 candle) | |

Equity bergerak dari Rp100.000.000 menjadi Rp100.000.000. Tidak ada trade tertutup pada periode ini, jadi win rate, profit factor, dan rata-rata untung/rugi belum bisa dihitung dan tidak dipakai sebagai kesimpulan. Yang tetap bisa dinilai adalah kelengkapan sinyal per candle: 190 sinyal tercatat, seluruhnya berakhir tanpa order.

## 2. Kecocokan sinyal dan order

Di jendela candle yang sama (2026-11-08 03:00 WIB sampai 2026-11-14 07:00 WIB), forward dan backtest sama-sama tidak menghasilkan order. Tidak ada order yang hanya muncul di salah satu sisi, sehingga tidak ada pasangan order yang bisa dicocokkan per candle. Penyebabnya bukan perbedaan kode: seluruh 190 sinyal forward berakhir tanpa order, dan filter entry yang sama juga menahan backtest. Artinya jendela ini belum menguji selisih harga fill.

Karena tidak ada order di kedua sisi, selisih harga fill belum bisa diukur pada periode ini.

## 3. Sumber selisih harga fill

1. **Spread.** Backtest mengasumsikan spread 0,3%. Dari 268 snapshot order book, median spread semua pair 0,0694%. Per pair:

| Pair | Snapshot | Median spread | P90 |
|---|---:|---:|---:|
| BTCIDR | 268 | 0,0245% | 0,1272% |
| ETHIDR | 268 | 0,0694% | 0,1466% |
| XRPIDR | 268 | 0,0677% | 0,1539% |
| SOLIDR | 268 | 0,0975% | 0,1653% |
| DOGEIDR | 268 | 0,1582% | 0,2428% |

   Median spread dari snapshot (0,0694%) LEBIH RENDAH dari asumsi backtest (0,3%), sehingga asumsi biaya backtest cukup konservatif untuk spread.

2. **Slippage dan keterlambatan jadwal.** Backtest mengisi di sekitar harga close; bot live mengisi di best ask/bid saat dipanggil. Cron dijadwalkan menit ke-7 (detik ke-420) setiap jam. Realisasinya, tick sukses masuk median 2.227 detik setelah awal jam, yaitu sekitar 1.807 detik (30 menit) setelah jadwal; maksimum 3.591 detik (53 menit setelah jadwal). Slippage terhadap harga sinyal: Rp0.

3. **Fee.** Fee taker 0,20555% untuk beli dan 0,41555% untuk jual, dipakai di kedua sisi. Total fee forward: Rp0. Total biaya spread: Rp0.

4. **Biaya total terhadap laba kotor (cost ratio).** Tidak bisa dihitung: laba kotor <= 0 (atau belum ada trade tertutup), rasio tidak bermakna.

## 4. Uptime dan error

Uptime dihitung sesuai soal: candle dianggap terproses bila diproses sebelum candle berikutnya ditutup. Hasil: 100% (185 tepat waktu, 0 terlambat, 0 terlewat dari 185 candle yang jatuh tempo). Keterlambatan jadwal tidak sampai membuat candle terlewat karena tick masih masuk sebelum candle berikutnya ditutup; rincian waktunya ada di bagian 3.

Error: 0, API error 0. Per tipe: tidak ada. Pemakaian kill switch tercatat 0 kali. Tidak ada error yang tercatat, sehingga tidak ada data yang hilang karena kegagalan API.

## 5. Kenapa periode forward ini pendek dan apa dampaknya

Pengerjaan baru dimulai 7 November 2026, setelah freeze date di soal (4 November 2026 12.00 WIB). Forward test pada paket ini baru berjalan 6,2 hari (mulai 2026-11-08 07:11 WIB), bukan 10 hari penuh. Ini keterbatasan yang saya nyatakan apa adanya, bukan tanggal yang dimundurkan.

Dengan candle 4 jam dan filter tren yang ketat, jumlah trade pada jendela ini memang sedikit (0 trade tertutup). Perbandingan dengan backtest 3 tahun karena itu hanya indikatif. Yang bisa diuji dengan cukup baik adalah kecocokan sinyal candle demi candle, kelengkapan log, dan kepatuhan eksekusi pada best bid/ask.

## 6. Apa yang saya pelajari

Yang paling membuat forward test berbeda dari backtest bukan rumus sinyalnya, tetapi cara order benar-benar terjadi. Backtest mengisi order di sekitar harga close dengan asumsi spread dan slippage tetap, sedangkan bot live harus menunggu jadwal, membaca order book saat itu, lalu membayar fee taker di kedua sisi. Di paket ini belum ada trade, jadi saya belum bisa mengukur selisih fill dari pengalaman nyata. Yang bisa saya pastikan: spread dari snapshot lebih rendah dari asumsi backtest, sedangkan keterlambatan jadwal adalah selisih yang paling terlihat. Median tick baru masuk 1.807 detik setelah jadwal, dan jeda sebesar itu tidak terlihat sama sekali di backtest.

Hal kedua yang saya pelajari adalah bahwa disiplin waktu lebih penting daripada mengejar hasil. Karena pengerjaan baru dimulai setelah freeze date, jendela forward test menjadi pendek dan sebagian perbandingan kehilangan kekuatan. Kalau bisa memulai ulang, saya akan menyelesaikan strategi dan deploy lebih awal, mengumpulkan snapshot order book sejak hari pertama persiapan, dan memastikan penjadwal berjalan penuh 10 hari supaya selisih backtest dan forward bisa dijelaskan dengan lebih banyak trade. Saya juga akan memantau uptime setiap hari, bukan menunggu sampai akhir periode.

## 7. Pernyataan

Semua angka di atas berasal dari log mentah dan dapat dihitung ulang dengan `scripts/hitung_ulang.js`. Aturan, parameter, dan universe tidak diubah sejak commit freeze `9a63a1e`. Forward test dimulai 2026-11-08 07:11 WIB dan data dipotong pada 2026-11-14 12:00 WIB. Tidak ada hasil yang difabrikasi; kekurangan periode dan keterlambatan jadwal dicatat apa adanya.
