const fs = require('fs');
const path = require('path');
const { PostDatabase } = require('./database');
const { RedNoteCrawler } = require('./crawler');
const { generateReport } = require('./report');
const { ensureDir } = require('./utils');

async function main() {
  const configPath = process.argv[2] || path.join(__dirname, '..', 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  ensureDir(config.imageDir);
  ensureDir(path.dirname(config.dbPath));
  ensureDir(config.reportDir);

  const db = new PostDatabase(config.dbPath);
  const crawler = new RedNoteCrawler(config, db);

  let shuttingDown = false;
  process.on('SIGINT', async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n\nReceived Ctrl+C. Shutting down gracefully...');
    db.close();
    await crawler.close();
    process.exit(0);
  });

  try {
    await crawler.init();
    await crawler.ensureLogin();

    for (const keyword of config.keywords) {
      await crawler.processKeyword(keyword);
    }

    generateReport(db, config.reportDir);
    console.log('\n✅ All done!');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
    await crawler.close();
  }
}

main();
