const { db, MANUAL_SOURCE_URL } = require('./db');
const config = require('./config');
const { scanSource } = require('./scraper');

async function scanAllSources() {
  const sources = db.prepare('SELECT * FROM sources WHERE url != ?').all(MANUAL_SOURCE_URL);
  for (const source of sources) {
    try {
      await scanSource(source);
    } catch (err) {
      db.prepare('UPDATE sources SET last_status = ? WHERE id = ?').run(
        `error: ${err.message}`,
        source.id
      );
    }
  }
}

function startScheduler() {
  if (!config.scanIntervalMinutes || config.scanIntervalMinutes <= 0) return;

  const intervalMs = config.scanIntervalMinutes * 60 * 1000;
  setInterval(() => {
    scanAllSources().catch(() => {});
  }, intervalMs);
}

module.exports = { startScheduler, scanAllSources };
