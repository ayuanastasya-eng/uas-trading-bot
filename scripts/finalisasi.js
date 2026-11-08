// finalisasi.js — satu perintah untuk menyiapkan paket pengumpulan UAS setelah forward test selesai.
//
// Pakai (Paket A, batas 14 Nov 2026 12.00 WIB):
//   node scripts/finalisasi.js
// Paket B (10 hari penuh, diserahkan terlambat):
//   node scripts/finalisasi.js --paket B
//
// Yang dilakukan, berurutan:
//   1. memperbarui data candle dari Indodax (fetch_history.py)
//   2. backtest 3 tahun penuh -> backtest_summary.json
//   3. mengunduh log mentah dari bot -> logs/
//   4. menghitung ulang semua metrik + gap -> hasil/metrics.json
//   5. membuat dashboard offline -> dashboard_offline.html
//   6. menyusun REFLEKSI.md dari hasil/metrics.json
//   7. menyalin bahan ke folder paket dan membuat ZIP
//
// Tidak ada aturan/parameter/universe yang diubah. Skrip ini hanya membaca log dan menghitung.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const paket = String(arg('--paket', 'A')).toUpperCase();
const defaultEnd = paket === 'B' ? '2026-11-18T00:11:00Z' : '2026-11-14T05:00:00Z';
const END = arg('--end', defaultEnd);
const URL = String(arg('--url', 'https://uas-trading-bot.vercel.app')).replace(/\/$/, '');
const REPO = arg('--repo', 'https://github.com/ayuanastasya-eng/uas-trading-bot');
const stamp = new Date().toISOString().slice(0, 10);
const stageName = arg('--nama', `paket_${paket}_${stamp}`);
const stageDir = path.join(root, stageName);
const zipName = `${stageName}.zip`;
const zipPath = path.join(root, zipName);

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  cp.execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
};

const wib = (iso) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' WIB';
};

(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const endMs = Date.parse(END);
  if (!Number.isFinite(endMs)) throw new Error(`--end tidak valid: ${END}`);
  if (endMs > Date.now()) {
    console.warn(`\nPERINGATAN: batas data ${END} (${wib(END)}) belum tercapai.`);
    console.warn('Skrip tetap jalan, tetapi data dan log belum lengkap. Jalankan lagi setelah waktu itu.\n');
  }

  console.log(`Paket ${paket} — batas data ${END} (${wib(END)})`);
  console.log(`Repo: ${REPO}`);
  console.log(`Dashboard: ${URL}/api/dashboard?end=${encodeURIComponent(END)}`);

  // 1. Data harga terbaru
  if (!has('--skip-fetch')) {
    run('python', ['fetch_history.py', '--pairs', ...cfg.universe, '--tf', '240', '--start', '2023-10-01']);
  } else {
    console.log('\n--skip-fetch: data harga tidak diperbarui.');
  }

  // 2. Backtest 3 tahun penuh (alat, bukan bot live)
  run('node', ['backtest.js']);
  fs.copyFileSync(path.join(root, 'out', 'summary.json'), path.join(root, 'backtest_summary.json'));

  // 3. Log mentah dari bot
  run('node', ['scripts/hitung_ulang.js', '--url', URL, '--unduh']);

  // 4. Hitung ulang + gap backtest vs forward pada jendela candle yang sama
  run('node', ['scripts/hitung_ulang.js', '--end', END, '--gap']);

  // 5. Dashboard offline mandiri
  run('node', ['scripts/buat_dashboard.js', '--end', END, '--gap']);

  // 6. Refleksi dari angka metrics.json
  run('node', ['scripts/buat_refleksi.js', '--metrics', 'hasil/metrics.json', '--out', 'REFLEKSI.md']);

  // 7. Susun folder paket
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const dirs = ['api', 'lib', 'scripts', 'test', '.github', 'logs', 'hasil', 'data'];
  const files = [
    'README.md', 'STRATEGI.md', 'REFLEKSI.md', 'package.json', 'config.json', 'signals.js',
    'backtest.js', 'fetch_history.py', 'universe_select.py', 'universe.csv', 'backtest_summary.json',
    'dashboard_offline.html', 'vercel.json', '.env.example', '.gitignore',
  ];
  // REFLEKSI_preview/backup dan artefak sementara tidak ikut ke paket final.
  const keep = (src) => !/[\\/](\.env($|\.)|node_modules|\.vercel|out|out_|paket_|REFLEKSI_)/.test(src);

  for (const d of dirs) {
    const src = path.join(root, d);
    if (!fs.existsSync(src)) { console.warn(`  lewati folder yang belum ada: ${d}/`); continue; }
    fs.cpSync(src, path.join(stageDir, d), { recursive: true, filter: keep });
  }
  for (const f of files) {
    const src = path.join(root, f);
    if (!fs.existsSync(src)) { console.warn(`  lewati berkas yang belum ada: ${f}`); continue; }
    fs.copyFileSync(src, path.join(stageDir, f));
  }
  // Hasil backtest 3 tahun lengkap (trades/orders/equity/signals), bukan hanya ringkasannya.
  if (fs.existsSync(path.join(root, 'out'))) {
    fs.cpSync(path.join(root, 'out'), path.join(stageDir, 'hasil', 'backtest_3tahun'), { recursive: true });
  }

  const guide = `# Panduan Pengumpulan UAS — Paket ${paket}

Berkas ini dibuat otomatis oleh \`scripts/finalisasi.js\`. Tanggal pembuatan: ${new Date().toISOString()}.

## Yang ditempel di kolom catatan RISE
- Link dashboard Vercel: ${URL}/api/dashboard?end=${encodeURIComponent(END)}
- Link repositori GitHub: ${REPO}
- Paket: ${paket} — batas data ${END} (${wib(END)})

## Isi ZIP
- Kode bot, backtest, dan skrip hitung ulang (\`api/\`, \`lib/\`, \`signals.js\`, \`backtest.js\`, \`scripts/\`, \`test/\`, \`vercel.json\`)
- \`README.md\` (cara jalan dan deploy), \`STRATEGI.md\` (strategi + perubahan dari UTS), \`REFLEKSI.md\`
- \`logs/\` — log mentah forward test (tick, order, equity harian, error, kill switch, snapshot order book, sinyal)
- \`hasil/metrics.json\` + \`hasil/backtest_jendela/\` — hasil hitung ulang dan backtest jendela yang sama
- \`hasil/backtest_3tahun/\` — hasil backtest 3 tahun lengkap (trades, orders, equity, signals, summary)
- \`dashboard_offline.html\` — dashboard mandiri, bisa dibuka tanpa internet
- \`backtest_summary.json\` — ringkasan backtest 3 tahun (return, CAGR, max drawdown)
- \`data/\` — candle historis yang dipakai backtest
- \`.env.example\` — contoh nama variabel, tanpa nilai rahasia

## Jangan
- Jangan mengubah \`signals.js\`, \`config.json\`, atau \`lib/engine.js\` setelah freeze \`9a63a1e\`.
- Jangan force-push atau menulis ulang riwayat commit.
- Jangan memasukkan \`.env\`, token, atau \`CRON_SECRET\` ke ZIP maupun repositori.
- Jangan menulis angka dashboard dengan tangan; semua angka berasal dari \`lib/metrics.js\`.

## Catatan jujur
- Freeze sebenarnya: 7 November 2026 (commit \`9a63a1e\`), bukan 4 November 2026.
- Forward test dimulai 8 November 2026 ±07.11 WIB.
- Paket A dipotong ${wib(END)}; periode ini lebih pendek dari 10 hari penuh dan dijelaskan di \`REFLEKSI.md\`.
`;
  fs.writeFileSync(path.join(stageDir, 'PANDUAN_PENGUMPULAN.md'), guide);

  // 8. ZIP
  fs.rmSync(zipPath, { force: true });
  try {
    run('tar', ['-a', '-c', '-f', zipName, stageName]);
  } catch (e) {
    console.warn('\ntar gagal, mencoba Compress-Archive...');
    run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stageDir}' -DestinationPath '${zipPath}' -Force`]);
  }

  const zipSize = fs.existsSync(zipPath) ? (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2) : '?';
  console.log('\n============================================');
  console.log(`SELESAI. Folder: ${stageName}/`);
  console.log(`ZIP: ${zipName} (${zipSize} MB)`);
  console.log(`Dashboard: ${URL}/api/dashboard?end=${encodeURIComponent(END)}`);
  console.log(`GitHub: ${REPO}`);
  console.log('Buka PANDUAN_PENGUMPULAN.md di folder paket untuk checklist.');
  console.log('============================================\n');

  // 9. Opsional: commit + push bukti log (tanpa menulis ulang riwayat)
  if (has('--commit')) {
    run('git', ['add', '-A']);
    run('git', ['commit', '-m', `Paket ${paket}: log final, metrik, dashboard offline, refleksi (aturan tidak berubah)`]);
    run('git', ['push', 'origin', 'main']);
  } else {
    console.log('Kalau ingin menyimpan log final ke GitHub juga, jalankan:');
    console.log('  git add -A');
    console.log(`  git commit -m "Paket ${paket}: log final, metrik, dashboard offline, refleksi (aturan tidak berubah)"`);
    console.log('  git push origin main\n');
  }
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
