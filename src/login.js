const fs = require('fs');
const path = require('path');
const { RedNoteCrawler } = require('./crawler');
const { ensureDir } = require('./utils');

async function main() {
  const configPath = process.argv[2] || path.join(__dirname, '..', 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  ensureDir(config.browserDataDir);

  const crawler = new RedNoteCrawler(config, { exists: () => false });

  try {
    await crawler.init();
    await crawler.ensureLogin();
    console.log('\n✅ Login complete. Your session is saved.');
    console.log('You can now run: npm start');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exitCode = 1;
  } finally {
    await crawler.close();
  }
}

main();
