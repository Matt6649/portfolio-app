const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { db, MANUAL_SOURCE_URL, getOrCreateManualSource } = require('../db');
const config = require('../config');
const { scanSource, fullScanSource, normalizeBaseUrl } = require('../scraper');
const { scanAllSources } = require('../scheduler');
const { FONT_IDS } = require('../fonts');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, `${file.fieldname}-${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  },
});

// ---- Profile ----

router.get('/profile', (req, res) => {
  const profile = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  res.json(profile);
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const PHOTO_SHAPES = ['circle', 'square'];
const VIEWS = ['grid', 'list'];
const COVER_STYLES = ['dark', 'wash', 'accent'];

router.put('/profile', (req, res) => {
  const {
    name, tagline, bio, accentColor,
    coverWash, coverStyle, photoShape, fontStyle, headingFont,
    showExcerpts, showDates, defaultView,
    pageTitle, metaDescription,
  } = req.body;

  if (accentColor && !HEX_COLOR.test(accentColor)) {
    return res.status(400).json({ error: 'accentColor must be a hex color like #2d5bff' });
  }
  if (fontStyle && !FONT_IDS.includes(fontStyle)) {
    return res.status(400).json({ error: `fontStyle must be one of: ${FONT_IDS.join(', ')}` });
  }
  if (headingFont && !FONT_IDS.includes(headingFont)) {
    return res.status(400).json({ error: `headingFont must be one of: ${FONT_IDS.join(', ')}` });
  }
  if (photoShape && !PHOTO_SHAPES.includes(photoShape)) {
    return res.status(400).json({ error: `photoShape must be one of: ${PHOTO_SHAPES.join(', ')}` });
  }
  if (defaultView && !VIEWS.includes(defaultView)) {
    return res.status(400).json({ error: `defaultView must be one of: ${VIEWS.join(', ')}` });
  }
  if (coverStyle && !COVER_STYLES.includes(coverStyle)) {
    return res.status(400).json({ error: `coverStyle must be one of: ${COVER_STYLES.join(', ')}` });
  }
  const wash = coverWash === undefined || coverWash === null || coverWash === '' ? null : Number(coverWash);
  if (wash !== null && (Number.isNaN(wash) || wash < 40 || wash > 95)) {
    return res.status(400).json({ error: 'coverWash must be a number between 40 and 95' });
  }

  const current = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  db.prepare(
    `UPDATE profile SET
       name = ?, tagline = ?, bio = ?,
       accent_color = ?, cover_wash = ?, cover_style = ?, photo_shape = ?,
       font_style = ?, heading_font = ?,
       show_excerpts = ?, show_dates = ?, default_view = ?,
       page_title = ?, meta_description = ?, updated_at = ?
     WHERE id = 1`
  ).run(
    name === undefined ? current.name : name,
    tagline === undefined ? current.tagline : tagline,
    bio === undefined ? current.bio : bio,
    accentColor || current.accent_color,
    wash === null ? current.cover_wash : wash,
    coverStyle || current.cover_style,
    photoShape || current.photo_shape,
    fontStyle || current.font_style,
    headingFont || current.heading_font,
    showExcerpts === undefined ? current.show_excerpts : (showExcerpts ? 1 : 0),
    showDates === undefined ? current.show_dates : (showDates ? 1 : 0),
    defaultView || current.default_view,
    pageTitle === undefined ? current.page_title : pageTitle,
    metaDescription === undefined ? current.meta_description : metaDescription,
    new Date().toISOString()
  );
  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

router.post('/profile/photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  db.prepare('UPDATE profile SET photo_path = ?, updated_at = ? WHERE id = 1').run(
    `/uploads/${req.file.filename}`,
    new Date().toISOString()
  );
  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

router.post('/profile/cover', upload.single('cover'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  db.prepare('UPDATE profile SET cover_path = ?, updated_at = ? WHERE id = 1').run(
    `/uploads/${req.file.filename}`,
    new Date().toISOString()
  );
  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

router.delete('/profile/cover', (req, res) => {
  db.prepare("UPDATE profile SET cover_path = '', updated_at = ? WHERE id = 1").run(
    new Date().toISOString()
  );
  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

// ---- Sources ----

router.get('/sources', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM sources WHERE url != ? ORDER BY created_at DESC').all(MANUAL_SOURCE_URL)
  );
});

router.post('/sources', (req, res) => {
  const url = normalizeBaseUrl(req.body.url || '');
  if (!url) return res.status(400).json({ error: 'A URL is required' });

  try {
    const info = db.prepare(
      'INSERT INTO sources (url, label, created_at) VALUES (?, ?, ?)'
    ).run(url, req.body.label || '', new Date().toISOString());
    res.json(db.prepare('SELECT * FROM sources WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(400).json({ error: err.message.includes('UNIQUE') ? 'That source is already added' : err.message });
  }
});

router.delete('/sources/:id', (req, res) => {
  db.prepare('DELETE FROM sources WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/sources/:id/scan', async (req, res) => {
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  try {
    const result = await scanSource(source);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sources/:id/full-scan', async (req, res) => {
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  try {
    const result = await fullScanSource(source);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scan-all', async (req, res) => {
  await scanAllSources();
  res.json({ ok: true });
});

// ---- Sections ----

router.get('/sections', (req, res) => {
  res.json(db.prepare('SELECT * FROM sections ORDER BY sort_order ASC, id ASC').all());
});

router.post('/sections', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A name is required' });
  const info = db.prepare(
    'INSERT INTO sections (name, sort_order, created_at) VALUES (?, ?, ?)'
  ).run(name, req.body.sortOrder || 0, new Date().toISOString());
  res.json(db.prepare('SELECT * FROM sections WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/sections/:id', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A name is required' });
  db.prepare('UPDATE sections SET name = ?, sort_order = ? WHERE id = ?').run(
    name,
    req.body.sortOrder || 0,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM sections WHERE id = ?').get(req.params.id));
});

router.delete('/sections/:id', (req, res) => {
  db.prepare('DELETE FROM sections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Articles ----

const ARTICLE_SELECT = `
  SELECT articles.*, sources.label as source_label, sources.url as source_url,
         sections.name as section_name
  FROM articles
  JOIN sources ON sources.id = articles.source_id
  LEFT JOIN sections ON sections.id = articles.section_id
`;

router.get('/articles', (req, res) => {
  res.json(db.prepare(`${ARTICLE_SELECT} ORDER BY published_at DESC`).all());
});

router.delete('/articles/:id', (req, res) => {
  db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/articles/:id/featured', (req, res) => {
  db.prepare('UPDATE articles SET featured = ? WHERE id = ?').run(
    req.body.featured ? 1 : 0,
    req.params.id
  );
  res.json(db.prepare(`${ARTICLE_SELECT} WHERE articles.id = ?`).get(req.params.id));
});

router.put('/articles/:id/section', (req, res) => {
  const sectionId = req.body.sectionId || null;
  db.prepare('UPDATE articles SET section_id = ? WHERE id = ?').run(sectionId, req.params.id);
  res.json(db.prepare(`${ARTICLE_SELECT} WHERE articles.id = ?`).get(req.params.id));
});

router.post('/articles/manual', (req, res) => {
  const { title, url, excerpt, imageUrl, publishedAt } = req.body;

  if (!title || !title.trim()) return res.status(400).json({ error: 'A title is required' });
  if (!/^https?:\/\/.+/i.test(url || '')) {
    return res.status(400).json({ error: 'A valid http(s) URL is required' });
  }

  const existing = db.prepare('SELECT id FROM articles WHERE url = ?').get(url);
  if (existing) return res.status(400).json({ error: 'That article URL is already tracked' });

  let publishedIso = null;
  if (publishedAt) {
    const d = new Date(publishedAt);
    if (!Number.isNaN(d.getTime())) publishedIso = d.toISOString();
  }

  const manualSource = getOrCreateManualSource();
  const info = db.prepare(
    `INSERT INTO articles (source_id, title, url, excerpt, image_url, published_at, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    manualSource.id,
    title.trim(),
    url.trim(),
    (excerpt || '').trim(),
    (imageUrl || '').trim(),
    publishedIso,
    new Date().toISOString()
  );

  res.json(db.prepare(`${ARTICLE_SELECT} WHERE articles.id = ?`).get(info.lastInsertRowid));
});

// ---- Socials ----

router.get('/socials', (req, res) => {
  res.json(db.prepare('SELECT * FROM socials ORDER BY sort_order ASC, id ASC').all());
});

router.post('/socials', (req, res) => {
  const { platform, label, url, sortOrder } = req.body;
  if (!platform || !url) return res.status(400).json({ error: 'platform and url are required' });
  const info = db.prepare(
    'INSERT INTO socials (platform, label, url, sort_order) VALUES (?, ?, ?, ?)'
  ).run(platform, label || '', url, sortOrder || 0);
  res.json(db.prepare('SELECT * FROM socials WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/socials/:id', (req, res) => {
  const { platform, label, url, sortOrder } = req.body;
  db.prepare(
    'UPDATE socials SET platform = ?, label = ?, url = ?, sort_order = ? WHERE id = ?'
  ).run(platform, label || '', url, sortOrder || 0, req.params.id);
  res.json(db.prepare('SELECT * FROM socials WHERE id = ?').get(req.params.id));
});

router.delete('/socials/:id', (req, res) => {
  db.prepare('DELETE FROM socials WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
