# Strategi Bot UAS dan Catatan Perubahan dari Versi UTS

Mahasiswa: Ayu Anastasya (NIM 25110200001) · Mata kuliah: Algorithmic Trading
Dokumen ini menjelaskan strategi yang dibekukan untuk forward test, dan semua perubahan dari strategi UTS.
Semua angka di bawah diambil dari `config.json` dan `signals.js` yang ada di commit freeze (`9a63a1e`).

## 1. Aturan strategi (versi UAS)

Strategi: Donchian breakout dengan filter tren dan trailing stop berbasis ATR. Long-only, timeframe 4 jam.
Sinyal dihitung hanya dari candle yang sudah tertutup. Candle yang masih berjalan dibuang.

| Bagian | Aturan |
|---|---|
| Masuk (BUY) | Close menembus high tertinggi 20 candle sebelumnya, dan close berada di atas EMA 200 |
| Keluar (SELL) | Close di bawah stop, atau close di bawah low terendah 10 candle sebelumnya (mana yang lebih dulu) |
| Stop awal | Close saat masuk dikurangi 3 × ATR(14) |
| Trailing stop | Stop hanya boleh naik: max(stop lama, close − 3 × ATR) |
| Sizing | Risiko 1% equity per trade dibagi jarak stop, maksimum 25% equity per posisi, dan tidak lebih dari kas yang ada |
| Batas posisi | Maksimal 3 posisi terbuka bersamaan |
| Order minimum | Rp25.000 (di bawah itu order tidak dibuat) |
| Batas rugi harian | Entri baru dihentikan jika equity turun 3% dari equity awal hari (reset 00:00 WIB) |
| Modal awal | Rp100.000.000 (simulasi) |
| Universe | BTC, ETH, XRP, SOL, DOGE terhadap IDR |
| Biaya | Fee taker 0,20555% (beli) dan 0,41555% (jual), dari help center Indodax, karena lebih mahal dari `/api/pairs` |
| Harga fill | Live: best ask (beli) dan best bid (jual). Backtest: close ± setengah spread ± slippage |

## 2. Catatan perubahan dari versi UTS

Aturan inti UTS (menurut `backtest_engine.py` versi revisi): Donchian high 20 untuk masuk, Donchian low 10 untuk keluar,
filter tren MA 200, stop loss tetap 5%, maksimal 10 posisi masing-masing 10% equity, data harian saham Kompas 100.

| No | Bagian | UTS | UAS | Alasan perubahan |
|---|---|---|---|---|
| 1 | Aset dan data | 32 saham Kompas 100 (BEI), data harian | 5 pasangan IDR di Indodax, candle 4 jam | Soal UAS mewajibkan pasangan IDR di Indodax |
| 2 | Filter tren | MA 200 hari | EMA 200 pada candle 4 jam | Pasar kripto berjalan 24 jam. EMA lebih cepat bereaksi daripada MA biasa |
| 3 | Stop loss | Tetap 5% dari harga masuk | 3 × ATR(14), naik mengikuti harga (trailing) | Volatilitas kripto jauh lebih besar dan berubah-ubah. Stop persentase tetap terlalu sering kena noise |
| 4 | Sizing | 10% equity per posisi, tetap | Risiko 1% per trade, maksimum 25% equity per posisi | Ukuran posisi menyesuaikan jarak stop, supaya risiko per trade seragam |
| 5 | Jumlah posisi | Maksimal 10 | Maksimal 3 | Universe hanya 5 pasangan, dan korelasi antar kripto tinggi |
| 6 | Biaya | Fee 0,15% beli, 0,25% jual, fraksi harga BEI, kelipatan lot 100 | Fee Indodax 0,20555% / 0,41555%, tanpa lot, order minimum Rp25.000 | Aturan bursa dan biaya berbeda |
| 7 | Eksekusi | Sinyal close hari T dieksekusi di open T+1 | Sinyal saat candle tertutup, fill di best ask/bid live saat bot berjalan | Soal UAS mewajibkan fill di order book nyata |
| 8 | Batas rugi harian | Tidak ada | 3% dari equity awal hari | Syarat bot UAS |
| 9 | Kontrol operasional | Tidak ada | Kill switch, idempotensi per candle, validasi candle dan order book | Syarat bot UAS |

Yang tidak berubah: logika inti breakout Donchian 20 untuk masuk, keluar di low Donchian 10, dan filter tren di atas rata-rata 200.

## 3. Catatan kejujuran
- Hasil backtest UTS tidak dipakai sebagai bukti apa pun di UAS. Semua angka UAS berasal dari backtest baru
  atas data historis asli Indodax (lebih dari 3 tahun) dan dari log forward test.
- Strategi dibekukan pada 7 November 2026 (commit `9a63a1e`). Tidak ada perubahan pada `signals.js`, `config.json`,
  dan `lib/engine.js` sesudah itu. Asumsi spread dan slippage di `config.json` bersifat sementara, dan kalibrasinya
  dari snapshot order book dijelaskan terpisah di README.
