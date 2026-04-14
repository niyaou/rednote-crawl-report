const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { ensureDir } = require('./utils');

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(destPath);
    client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(destPath);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function downloadImages(noteId, imageList, baseDir) {
  const noteDir = path.join(baseDir, String(noteId));
  ensureDir(noteDir);
  const saved = [];

  for (let i = 0; i < imageList.length; i++) {
    const img = imageList[i];
    const url = img.url_default || img.url || img.trace_id;
    if (!url || !url.startsWith('http')) continue;

    const ext = path.extname(new URL(url).pathname).split('?')[0] || '.jpg';
    const dest = path.join(noteDir, `${i + 1}${ext}`);
    try {
      await downloadImage(url, dest);
      saved.push(dest);
    } catch (err) {
      console.warn(`  ⚠️ Image download failed: ${url} — ${err.message}`);
    }
  }

  return { noteDir, savedPaths: saved };
}

module.exports = { downloadImages };
