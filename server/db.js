const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { dataDir, uploadsDir, dbPath } = require('./config');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT DEFAULT '',
    tagline TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    photo_path TEXT DEFAULT '',
    cover_path TEXT DEFAULT '',
    accent_color TEXT DEFAULT '#2d5bff',
    cover_wash INTEGER DEFAULT 84,
    cover_style TEXT DEFAULT 'dark',
    photo_shape TEXT DEFAULT 'circle',
    font_style TEXT DEFAULT 'sans',
    heading_font TEXT DEFAULT 'serif',
    show_excerpts INTEGER DEFAULT 1,
    show_dates INTEGER DEFAULT 1,
    default_view TEXT DEFAULT 'grid',
    page_title TEXT DEFAULT '',
    meta_description TEXT DEFAULT '',
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    label TEXT DEFAULT '',
    last_scanned_at TEXT,
    last_status TEXT DEFAULT 'never scanned',
    icon_url TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    excerpt TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    published_at TEXT,
    discovered_at TEXT NOT NULL,
    featured INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);

  CREATE TABLE IF NOT EXISTS socials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    label TEXT DEFAULT '',
    url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT DEFAULT '[]',
    device_label TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

// CREATE TABLE IF NOT EXISTS doesn't retroactively add columns to a table
// that already existed from an earlier version - patch those in manually.
const profileColumns = new Set(db.prepare('PRAGMA table_info(profile)').all().map((c) => c.name));
if (!profileColumns.has('cover_path')) {
  db.exec("ALTER TABLE profile ADD COLUMN cover_path TEXT DEFAULT ''");
}
if (!profileColumns.has('accent_color')) {
  db.exec("ALTER TABLE profile ADD COLUMN accent_color TEXT DEFAULT '#2d5bff'");
}
if (!profileColumns.has('cover_wash')) {
  db.exec('ALTER TABLE profile ADD COLUMN cover_wash INTEGER DEFAULT 84');
}
if (!profileColumns.has('photo_shape')) {
  db.exec("ALTER TABLE profile ADD COLUMN photo_shape TEXT DEFAULT 'circle'");
}
if (!profileColumns.has('font_style')) {
  db.exec("ALTER TABLE profile ADD COLUMN font_style TEXT DEFAULT 'sans'");
}
if (!profileColumns.has('heading_font')) {
  db.exec("ALTER TABLE profile ADD COLUMN heading_font TEXT DEFAULT 'serif'");
}
if (!profileColumns.has('cover_style')) {
  db.exec("ALTER TABLE profile ADD COLUMN cover_style TEXT DEFAULT 'dark'");
}
if (!profileColumns.has('show_excerpts')) {
  db.exec('ALTER TABLE profile ADD COLUMN show_excerpts INTEGER DEFAULT 1');
}
if (!profileColumns.has('show_dates')) {
  db.exec('ALTER TABLE profile ADD COLUMN show_dates INTEGER DEFAULT 1');
}
if (!profileColumns.has('default_view')) {
  db.exec("ALTER TABLE profile ADD COLUMN default_view TEXT DEFAULT 'grid'");
}
if (!profileColumns.has('page_title')) {
  db.exec("ALTER TABLE profile ADD COLUMN page_title TEXT DEFAULT ''");
}
if (!profileColumns.has('meta_description')) {
  db.exec("ALTER TABLE profile ADD COLUMN meta_description TEXT DEFAULT ''");
}

const sourceColumns = new Set(db.prepare('PRAGMA table_info(sources)').all().map((c) => c.name));
if (!sourceColumns.has('icon_url')) {
  db.exec("ALTER TABLE sources ADD COLUMN icon_url TEXT DEFAULT ''");
}

const articleColumns = new Set(db.prepare('PRAGMA table_info(articles)').all().map((c) => c.name));
if (!articleColumns.has('section_id')) {
  db.exec('ALTER TABLE articles ADD COLUMN section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL');
}
if (!articleColumns.has('featured')) {
  db.exec('ALTER TABLE articles ADD COLUMN featured INTEGER NOT NULL DEFAULT 0');
}

// Seed the single profile row if missing.
const profileRow = db.prepare('SELECT id FROM profile WHERE id = 1').get();
if (!profileRow) {
  db.prepare(
    'INSERT INTO profile (id, name, tagline, bio, photo_path, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
  ).run('', '', '', '', new Date().toISOString());
}

function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

if (!getMeta('admin_user_id')) {
  setMeta('admin_user_id', require('crypto').randomUUID());
}

// Manually-added articles still need a `sources` row to satisfy the
// articles.source_id foreign key, but this one is never scanned - it's
// filtered out of the sources list and skipped by the scheduler/scraper
// (see MANUAL_SOURCE_URL usages in scraper.js, scheduler.js, admin-api.js).
const MANUAL_SOURCE_URL = 'manual://articles';

function getOrCreateManualSource() {
  const existing = db.prepare('SELECT * FROM sources WHERE url = ?').get(MANUAL_SOURCE_URL);
  if (existing) return existing;
  const info = db.prepare(
    'INSERT INTO sources (url, label, created_at) VALUES (?, ?, ?)'
  ).run(MANUAL_SOURCE_URL, 'Manually added', new Date().toISOString());
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(info.lastInsertRowid);
}

module.exports = { db, getMeta, setMeta, MANUAL_SOURCE_URL, getOrCreateManualSource };
