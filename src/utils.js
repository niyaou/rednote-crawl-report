const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseLikes(countStr) {
  if (!countStr) return 0;
  const s = String(countStr).trim();
  if (s.includes('万')) {
    return Math.floor(parseFloat(s.replace('万', '')) * 10000);
  }
  if (s.includes('亿')) {
    return Math.floor(parseFloat(s.replace('亿', '')) * 100000000);
  }
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function formatDate(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = {
  sleep,
  parseLikes,
  ensureDir,
  formatDate,
};
