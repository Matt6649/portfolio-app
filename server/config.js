const path = require('path');
require('dotenv').config();

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = {
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  dbPath: path.join(dataDir, 'portfolio.db'),

  publicPort: parseInt(process.env.PUBLIC_PORT || '8080', 10),
  adminPort: parseInt(process.env.ADMIN_PORT || '8081', 10),

  authMode: (process.env.AUTH_MODE || 'passkey').toLowerCase(), // 'passkey' | 'basic'

  setupToken: process.env.SETUP_TOKEN || '',
  rpId: process.env.RP_ID || 'localhost',
  rpName: process.env.RP_NAME || 'Portfolio Admin',
  origin: process.env.ORIGIN || 'http://localhost:8081',
  cookieSecure: (process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true',

  basicAuthUser: process.env.BASIC_AUTH_USER || '',
  basicAuthPass: process.env.BASIC_AUTH_PASS || '',

  sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',

  scanIntervalMinutes: parseInt(process.env.SCAN_INTERVAL_MINUTES || '120', 10),
};
