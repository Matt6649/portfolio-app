const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./config');
require('./db'); // ensures the schema exists before anything else runs
const { getPortfolio } = require('./portfolio');
const { fontOrDefault } = require('./fonts');
const { socialIcon } = require('./icons');
const { basicAuth, requireSession } = require('./auth-middleware');
const { startScheduler } = require('./scheduler');

const authApi = require('./routes/auth-api');
const adminApi = require('./routes/admin-api');
const publicApi = require('./routes/public-api');

// ---------------------------------------------------------------------
// Public portfolio app - safe to expose to the internet.
// ---------------------------------------------------------------------
const publicApp = express();

const indexTemplatePath = path.join(__dirname, '..', 'public', 'index.html');
const fontsDir = path.join(__dirname, '..', 'node_modules', '@fontsource-variable');

function escapeHtmlAttr(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// White or near-black, whichever reads better on top of the accent colour.
function readableOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#141416' : '#ffffff';
}

// The profile header, theme (colours, fonts, cover style) and meta tags
// are rendered here on the server, so the page paints in its final look
// immediately and search engines / link previews see real content. The
// article list is embedded as JSON and rendered by public/app.js, which
// also handles search and filtering.
function renderPublicIndex(req) {
  const data = getPortfolio();
  const { profile, socials } = data;
  const esc = escapeHtmlAttr;

  const title = profile.page_title || (profile.name ? `${profile.name} — Portfolio` : 'Portfolio');
  const description = profile.meta_description || profile.bio || profile.tagline || '';
  const imagePath = profile.cover_path || profile.photo_path || '';
  const imageUrl = imagePath ? `${req.protocol}://${req.get('host')}${imagePath}` : '';

  const headingFont = fontOrDefault(profile.heading_font, 'serif');
  const bodyFont = fontOrDefault(profile.font_style, 'sans');
  const fontLinks = [...new Set([headingFont.pkg, bodyFont.pkg].filter(Boolean))]
    .map((pkg) => `<link rel="stylesheet" href="/fonts/${pkg}/wght.css" />`);

  const accent = /^#[0-9a-fA-F]{6}$/.test(profile.accent_color || '') ? profile.accent_color : '#2d5bff';
  const themeVars = [
    `--accent:${accent}`,
    `--on-accent:${readableOn(accent)}`,
    `--font-heading:${headingFont.stack}`,
    `--font-body:${bodyFont.stack}`,
    `--cover-wash:${Number(profile.cover_wash) || 84}%`,
  ].join(';');

  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:type" content="profile" />`,
    imageUrl ? `<meta property="og:image" content="${esc(imageUrl)}" />` : '',
    `<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />`,
    profile.photo_path ? `<link rel="icon" href="${esc(profile.photo_path)}" />` : '',
    ...fontLinks,
    `<style>:root{${themeVars}}</style>`,
  ].filter(Boolean).join('\n');

  const emailSocial = socials.find((s) => (s.platform || '').toLowerCase() === 'email');
  const socialLinks = socials.filter((s) => s !== emailSocial).map((s) => {
    const label = esc(s.label || s.platform);
    return `<a class="icon-btn" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${label}" aria-label="${label}">${socialIcon(s.platform)}</a>`;
  }).join('');

  const slots = {
    coverStyle: ['dark', 'wash', 'accent'].includes(profile.cover_style) ? profile.cover_style : 'dark',
    coverClass: profile.cover_path ? ' has-cover' : '',
    coverBg: profile.cover_path
      ? `<div class="cover-bg" style="background-image:url('${esc(encodeURI(profile.cover_path))}')"></div>`
      : '',
    socials: socialLinks,
    contact: emailSocial
      ? `<a class="contact-pill" href="${esc(emailSocial.url)}">${esc(emailSocial.label || 'Contact me')}</a>`
      : '',
    photo: profile.photo_path
      ? `<img class="hero-photo${profile.photo_shape === 'square' ? ' square' : ''}" src="${esc(profile.photo_path)}" alt="${esc(profile.name || '')}" />`
      : '',
    name: esc(profile.name || 'My Portfolio'),
    tagline: profile.tagline ? `<p class="tagline">${esc(profile.tagline)}</p>` : '',
    bio: profile.bio ? `<p class="bio">${esc(profile.bio)}</p>` : '',
    // "<" is escaped so article text can never close the <script> tag.
    data: JSON.stringify({
      articles: data.articles,
      sections: data.sections,
      showExcerpts: !!profile.show_excerpts,
      showDates: !!profile.show_dates,
      listView: profile.default_view === 'list',
    }).replace(/</g, '\\u003c'),
  };

  return fs.readFileSync(indexTemplatePath, 'utf8')
    .replace(/\{\{(\w+)\}\}/g, (match, key) => (key in slots ? slots[key] : match))
    .replace('<!--HEAD-->', () => head);
}

publicApp.use('/uploads', express.static(config.uploadsDir));
publicApp.use('/fonts', express.static(fontsDir, { maxAge: '30d' }));
publicApp.use('/api', publicApi);
publicApp.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
publicApp.get('*', (req, res) => {
  res.type('html').send(renderPublicIndex(req));
});

publicApp.listen(config.publicPort, () => {
  console.log(`[public] portfolio site listening on port ${config.publicPort}`);
});

// ---------------------------------------------------------------------
// Admin app - dashboard + API. Keep this off the public internet unless
// it's behind HTTPS (see README.md).
// ---------------------------------------------------------------------
const adminApp = express();
adminApp.use(express.json({ limit: '2mb' }));
adminApp.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

const webauthnBrowserBundle = path.join(
  __dirname,
  '..',
  'node_modules',
  '@simplewebauthn',
  'browser',
  'dist',
  'bundle',
  'index.umd.min.js'
);

// In basic-auth mode, protect the whole admin app (including the static
// dashboard page itself) at the network layer, so the browser's native
// Basic Auth prompt appears on first load - relying on it only for the
// JSON API leaves the dashboard silently rendering with no data if a
// fetch() call doesn't trigger the browser's credentials prompt.
if (config.authMode === 'basic') {
  adminApp.use(basicAuth);
}

adminApp.use('/uploads', express.static(config.uploadsDir));
adminApp.use('/fonts', express.static(fontsDir, { maxAge: '30d' }));
adminApp.get('/vendor/simplewebauthn-browser.js', (req, res) => {
  res.sendFile(webauthnBrowserBundle);
});
adminApp.use('/api/auth', authApi);

if (config.authMode === 'basic') {
  adminApp.use('/api/admin', adminApi);
} else {
  adminApp.use('/api/admin', requireSession, adminApi);
}

adminApp.use(express.static(path.join(__dirname, '..', 'admin')));
adminApp.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'index.html'));
});

adminApp.listen(config.adminPort, () => {
  console.log(`[admin] dashboard listening on port ${config.adminPort} (auth mode: ${config.authMode})`);
});

startScheduler();
