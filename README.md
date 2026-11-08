# Bot Dry Run Indodax di Vercel (UAS Algorithmic Trading)

Mahasiswa: Ayu Anastasya · NIM 25110200001 · Tugas individu
Bot trading otomatis long-only yang membaca harga dan order book Indodax sungguhan, lalu mensimulasikan order (dry run). Tidak ada uang sungguhan dan tidak memakai API key.

- Dashboard live: https://uas-trading-bot.vercel.app/api/dashboard
- Repositori: https://github.com/ayuanastasya-eng/uas-trading-bot

## 1. Bukti freeze dan jadwal yang sebenarnya

| Hal | Isi |
|---|---|
| Commit freeze | `9a63a1e` (GitHub: `ayuanastasya-eng/uas-trading-bot`), 7 November 2026. Waktu persisnya dapat dicek di riwayat commit |
| Bot mulai berjalan | 8 November 2026, sekitar 07.11 WIB (tick pertama tercatat di `logs/ticks.json`, kolom `started_at`) |
| Jadwal di soal | Freeze Rabu 4 November 2026 12.00 WIB, forward test 4 sampai 14 November |

Pengerjaan baru dimulai pada 7 November 2026, setelah freeze date di soal. Tanggal tidak diubah atau dimundurkan. Akibatnya forward test lebih pendek dari 10 hari penuh pada paket yang dikumpulkan tepat waktu, dan dijelaskan di refleksi.
Sejak commit freeze, `signals.js`, `config.json`, dan `lib/engine.js` tidak diubah. Hash `config.json` dan `signals.js` dicatat di setiap tick (`config_hash`, `signals_hash`) sebagai bukti. Commit sesudah freeze hanya menambah alat baca dan hitung (`lib/metrics.js`, `lib/dashboard_html.js`, `api/dashboard.js`, `scripts/*`, dokumen). Daftar commit sesudah freeze ada di bagian 9.

## 2. Strategi
Breakout Donchian 20 (masuk) dan 10 (keluar) dengan filter EMA 200 dan trailing stop 3×ATR(14), timeframe 4 jam. Aturan lengkap dan catatan perubahan dari versi UTS ada di [`STRATEGI.md`](STRATEGI.md). Semua parameter ada di [`config.json`](config.json) dan logikanya di [`signals.js`](signals.js), yang dipakai identik oleh backtest dan bot live.

## 3. Universe dan cara menghindari survivorship bias
Universe: BTC, ETH, XRP, SOL, DOGE terhadap IDR (`config.json`).
Pemilihan: `universe_select.py` meranking pasangan IDR menurut median omzet harian (close × volume) pada 90 hari pertama periode backtest (mulai 2023-10-01), bukan menurut kondisi hari ini. Stablecoin dan pasangan yang belum punya data sejak awal periode dikeluarkan (misalnya `shibidr`, data baru ada sejak 30 Januari 2024). Hasil ranking ada di `universe.csv`.

## 4. Backtest
- Data asli Indodax, candle 4 jam, lebih dari 3 tahun (`data/*.csv`, diambil dengan `fetch_history.py`, 0 celah pada semua kandidat).
- `node backtest.js` memakai `signals.js` yang sama dengan bot. Candle yang belum tertutup dibuang.
- Fill backtest: close ± setengah spread ± slippage. Nilai `spread_pct` (0,3) dan `slippage_pct` (0,05) di `config.json` adalah asumsi awal dan **tidak diubah setelah freeze**. Perbandingannya dengan spread dari snapshot order book dibahas di refleksi.
- Jendela perbandingan dengan forward test: `node scripts/hitung_ulang.js --gap`.

## 5. Biaya dan batas (dicek pada 7 November 2026)
| Sumber | URL | Nilai |
|---|---|---|
| Help center Indodax, Rincian Biaya Transaksi (IDR, Pro, taker) | https://help.indodax.com/hc/en-us/articles/4416646599705-Details-of-Transaction-Fees-on-INDODAX | beli 0,20555%, jual 0,41555% |
| `/api/pairs` | https://indodax.com/api/pairs | taker 0,2% |

Dipakai angka yang lebih mahal (help center). Minimum order Rp25.000 (mode Pro), yang lebih ketat daripada nilai di `/api/pairs`.

## 6. Cara kerja bot (`/api/tick`)
1. Dipanggil GitHub Actions tiap jam pada menit ke-7 (`.github/workflows/tick.yml`, cron `7 * * * *`) dengan header `Authorization: Bearer <CRON_SECRET>`. Tanpa header benar hasilnya 401.
2. Mengambil `server_time`, lalu candle 4 jam terakhir tiap pair. Candle yang belum tertutup dibuang.
3. Validasi: data kurang, candle basi (lebih dari 2× timeframe), celah candle, volume atau harga nol, order book kosong, spread lebih dari 2%. Yang gagal ditolak dan dicatat sebagai error.
4. Sinyal dihitung dengan `signals.js`. Eksekusi: SELL di best bid, BUY di best ask dari order book live, plus fee taker. Maksimal 3 posisi, risiko 1% per trade, batas rugi harian 3% (reset 00.00 WIB), minimum order Rp25.000.
5. Idempotensi: satu candle per pair hanya diproses sekali (kunci `exec:<pair>:<candle>` di Redis), jadi panggilan terlambat atau ganda aman. Panggilan ke Indodax maksimal 3 percobaan per request.
6. Semua dicatat ke log mentah di Redis: tiap tick, sinyal, order, equity harian, error, kill switch, dan snapshot order book setiap tick.

Kill switch manual: `POST /api/kill` dengan Bearer secret dan isi `{"on": true, "reason": "..."}`. Saat aktif, bot tetap mencatat tick dan snapshot tapi tidak membuat order. Alternatif: set variabel `KILL_SWITCH=1`.

## 7. Menjalankan dan men-deploy
Prasyarat: Node.js 18+, Python 3 (untuk `fetch_history.py` saja), akun GitHub, Vercel, dan Upstash (dari Vercel Storage).
```
node test/replay_test.js          # uji: mesin live = backtest, kill switch, validasi, auth (butuh folder data/)
node scripts/local_tick.js        # satu tick percobaan ke Indodax asli, tanpa menyimpan apa pun
node backtest.js                  # backtest penuh -> out/
```
Deploy:
1. Push repositori ke GitHub, impor ke Vercel (framework: Other).
2. Vercel, Storage: buat database Upstash for Redis, hubungkan ke proyek. Variabel `KV_REST_API_URL` dan `KV_REST_API_TOKEN` terisi otomatis.
3. Vercel, Environment Variables: tambah `CRON_SECRET` (string acak panjang). Salin `.env.example` ke `.env` untuk pemakaian lokal. `.env` ada di `.gitignore` dan tidak pernah di-commit.
4. GitHub, Settings, Secrets and variables, Actions: tambah `APP_URL` (alamat Vercel tanpa garis miring akhir) dan `CRON_SECRET` (nilai sama).
5. Redeploy, lalu jalankan workflow "tick" secara manual (Run workflow) dan cek `/api/status`.

Endpoint: `/api/tick` (rahasia), `/api/kill` (rahasia), `/api/status` dan `/api/logs?type=...` (baca saja), `/api/dashboard` (tampilan; tambah `?end=<waktu ISO>` untuk memotong di batas waktu pengumpulan).

## 8. Log mentah, hitung ulang, dan dashboard
```
node scripts/hitung_ulang.js --url https://<proyek>.vercel.app --unduh      # simpan log mentah ke logs/
node scripts/hitung_ulang.js --end <waktu ISO> --gap                        # hasil/metrics.json, bandingkan dengan backtest
node scripts/buat_dashboard.js --end <waktu ISO> --gap                      # dashboard_offline.html (klik dua kali, tanpa internet)
node scripts/buat_refleksi.js                                               # REFLEKSI.md dari hasil/metrics.json
node scripts/finalisasi.js [--paket A|B]                                    # semua langkah di atas + ZIP pengumpulan
```
Semua metrik (return, max drawdown, win rate, profit factor, rata-rata menang dan kalah, cost ratio, benchmark BTC buy and hold, uptime, error, selisih backtest dan forward) dihitung oleh satu modul, `lib/metrics.js`. Modul ini dipakai oleh `hitung_ulang`, dashboard Vercel, dan dashboard offline, jadi angkanya sama. Tidak ada angka yang ditulis tangan.
Dashboard juga menampilkan panel backtest 3 tahun (return total, CAGR, max drawdown) dari `backtest_summary.json`, dan memuat gap backtest-vs-forward dari `hasil/metrics.json` bila sudah dihitung. Keduanya berkas hasil hitung ulang, bukan angka yang ditulis tangan.
Definisi uptime mengikuti soal: candle dianggap terproses bila diproses sebelum candle berikutnya ditutup.

## 9. Catatan perubahan setelah freeze
| Tanggal | Perubahan | Mengubah aturan? |
|---|---|---|
| 8 Nov 2026 (`4db74cc`) | Tambah `lib/metrics.js`, `lib/dashboard_html.js`, `api/dashboard.js`, `scripts/hitung_ulang.js`, `scripts/buat_dashboard.js`, `STRATEGI.md`, `README.md`, `REFLEKSI.md`; `backtest.js` menerima jam di `--from/--to`; `replay_test.js` menyimpan log uji | Tidak |
| 8 Nov 2026 (lanjutan) | Panel backtest 3 tahun + panel operasional di dashboard, `backtest_summary.json`, `scripts/buat_refleksi.js` (refleksi otomatis dari `hasil/metrics.json`), `scripts/finalisasi.js` (satu perintah untuk paket ZIP), `hitung_ulang --gap` menambah statistik trade backtest | Tidak |
| [ISI bila ada perbaikan bug] | | |

## 10. Finalisasi paket pengumpulan
Setelah forward test selesai:
```
node scripts/finalisasi.js             # Paket A: --end 2026-11-14T05:00:00Z (14 Nov 12.00 WIB)
node scripts/finalisasi.js --paket B   # Paket B: --end 2026-11-18T00:11:00Z (10 hari penuh, terlambat)
```
Skrip memperbarui data candle, menjalankan backtest 3 tahun, mengunduh log mentah, menghitung metrik + gap, membuat dashboard offline, menyusun `REFLEKSI.md`, lalu membuat `paket_<A|B>_<tanggal>.zip`. Isi dan checklist ada di `PANDUAN_PENGUMPULAN.md` di dalam ZIP. Tidak ada aturan, parameter, atau universe yang diubah.

## 11. Keterbatasan yang diketahui
- Spread dan slippage backtest adalah asumsi awal, dibandingkan dengan snapshot di refleksi.
- Fill live terjadi sesudah candle tertutup (menunggu jadwal), sedangkan backtest mengisi di sekitar harga close. Selisihnya dijelaskan di refleksi.
- Jadwal GitHub Actions bisa terlambat. Waktu tiap panggilan dicatat, dan uptime dihitung dari log itu.
- Jumlah koin dan harga tidak dibulatkan ke `price_increments` Indodax (tidak perlu untuk dry run, tetapi perlu untuk order sungguhan).
- Batas rugi harian dihitung dari equity awal hari. Di backtest, equity awal hari diambil dari langkah keputusan sebelumnya, sedikit berbeda dari live.
- Forward test lebih pendek dari 10 hari pada paket tepat waktu karena freeze terlambat (lihat bagian 1).
