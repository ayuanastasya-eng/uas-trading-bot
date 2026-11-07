'use strict';
// Sidik jari config.json dan signals.js, dicatat di setiap tick sebagai bukti kode/parameter tidak berubah sejak freeze.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex').slice(0, 16);
  } catch (e) {
    return 'unavailable';
  }
}

module.exports = { hashes: () => ({ config_hash: sha('config.json'), signals_hash: sha('signals.js') }) };
