# Refleksi: Selisih Backtest vs Forward Test

Mahasiswa: Ayu Anastasya · NIM 25110200001
Periode forward: [ISI dari `hasil/metrics.json`, `periode.mulai` sampai `periode.akhir`, `periode.hari` hari]
Batas data paket ini: [ISI: nilai `--end` yang dipakai]

> Cara mengisi: jalankan `node scripts/hitung_ulang.js --end <waktu> --gap`, lalu salin angka dari `hasil/metrics.json`.
> Jangan menulis angka yang tidak ada di file itu. Hasil buruk yang bisa dibuktikan bernilai lebih daripada hasil bagus yang tidak bisa dijelaskan.

## 1. Hasil singkat
| | Forward test | Backtest (jendela candle sama) |
|---|---|---|
| Return | [ISI `return_pct`] | [ISI `gap_backtest_vs_forward.return_backtest_pct`] |
| Selisih | [ISI `selisih_pct_poin`] poin | |
| Trade tertutup | [ISI `trade_tertutup`] | [ISI dari backtest] |
| Benchmark BTC buy and hold | [ISI `benchmark_btc_buy_hold.return_pct`] | |
| Max drawdown | [ISI `max_drawdown_pct`] | |
| Uptime | [ISI `uptime.persen`] ([ISI tepat waktu / terlambat / terlewat]) | |

## 2. Kecocokan sinyal dan order
Dari `gap_backtest_vs_forward`: [ISI `order_cocok`] dari [ISI `order_forward`] order forward dan [ISI `order_backtest`] order backtest cocok per candle. Ada atau tidaknya order yang hanya muncul di satu sisi: [ISI `hanya_di_forward`, `hanya_di_backtest`].
Karena kode sinyal sama, perbedaan yang ada seharusnya hanya berasal dari harga fill dan waktu eksekusi. [JELASKAN jika ada order yang tidak cocok, dan sebabnya.]
Bila tidak ada trade, sebutkan bahwa log sinyal tetap dicocokkan per candle ([ISI `sumber.jumlah_sinyal`] sinyal tercatat).

## 3. Sumber selisih harga fill
1. **Spread.** Backtest mengasumsikan [ISI `spread_snapshot.asumsi_backtest_pct`]%. Dari [ISI `sumber.jumlah_snapshot`] snapshot order book, median spread semua pair [ISI `spread_snapshot.median_semua_pair_pct`]%. Per pair: [ISI tabel `spread_snapshot.per_pair`]. [JELASKAN: asumsi terlalu tinggi atau rendah, dan dampaknya ke selisih.]
2. **Slippage dan keterlambatan jadwal.** Backtest mengisi di sekitar close; bot live mengisi saat dipanggil. Median keterlambatan panggilan setelah awal jam: [ISI `uptime.info_tick.median_detik_setelah_jam`] detik, maksimum [ISI `maks_detik_setelah_jam`] detik. Slippage terhadap harga sinyal: Rp[ISI `biaya.slippage_idr`]. [JELASKAN.]
3. **Fee.** Fee taker 0,20555% beli dan 0,41555% jual di kedua sisi. Total fee forward: Rp[ISI `biaya.fee_idr`].
4. **Biaya total terhadap laba kotor (cost ratio).** [ISI `biaya.cost_ratio` atau jelaskan bila null karena belum ada laba kotor positif.]

## 4. Uptime dan error
Jadwal GitHub Actions bisa terlambat. Uptime dihitung sesuai soal: candle dianggap terproses bila diproses sebelum candle berikutnya ditutup. Hasil: [ISI]. Error: [ISI `error.total`], API error [ISI `error.api_error`], per tipe [ISI `error.per_tipe`]. [JELASKAN penyebab dan dampaknya, bila ada.]

## 5. Kenapa periode forward ini pendek dan apa dampaknya
Pengerjaan dimulai setelah freeze date di soal (7 November, bukan 4 November), sehingga forward test pada paket ini hanya [ISI `periode.hari`] hari. Dengan candle 4 jam dan filter tren yang ketat, jumlah trade sangat sedikit. Dengan [ISI] trade, win rate dan profit factor tidak bermakna secara statistik, dan perbandingan dengan backtest 3 tahun hanya indikatif.

## 6. Apa yang saya pelajari
[ISI 3 sampai 5 kalimat dengan kata-katamu sendiri: apa yang paling membuat forward berbeda dari backtest, dan apa yang akan diubah bila ada kesempatan memulai ulang. Jangan mengubah aturan sekarang; ini hanya catatan.]

## 7. Pernyataan
Semua angka di atas berasal dari log mentah dan dapat dihitung ulang dengan `scripts/hitung_ulang.js`. Aturan, parameter, dan universe tidak diubah sejak commit freeze `9a63a1e`.
