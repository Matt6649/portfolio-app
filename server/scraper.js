const fetch = require('node-fetch');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const { db, MANUAL_SOURCE_URL } = require('./db');

const USER_AGENT = 'PersonalPortfolioBot/1.0 (self-hosted portfolio; scans author pages for public articles)';
const FETCH_TIMEOUT_MS = 15000;
const MAX_ARCHIVE_PAGES = 200;
const PAGE_CRAWL_DELAY_MS = 350;

const rssParser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { 'User-Agent': USER_AGENT },
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  url = url.replace(/\/+$/, '');
  return url;
}

function stripWpPostSuffix(html) {
  return (html || '').replace(/<p>\s*The post[\s\S]*?appeared first on[\s\S]*?<\/p>\s*$/i, '');
}

function htmlToText(html) {
  if (!html) return '';
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  return $('#root').text().replace(/\s+/g, ' ').trim();
}

function extractFirstImage(html) {
  if (!html) return '';
  const match = html.match(/<img[^>]+src=["']([^"'>]+)["']/i);
  return match ? match[1] : '';
}

function looksLikePlaceholder(src) {
  if (!src) return true;
  if (src.startsWith('data:')) return true;
  return /blank\.gif|placeholder|lazy(?:load)?\.(png|gif|svg)/i.test(src);
}

// Lazy-load plugins commonly leave a 1x1 placeholder in `src` and the
// real image in a `data-*` attribute, swapped in by JS that never runs
// here. Prefer the real source when the visible one looks like a stub.
function pickImageSrc($img) {
  if (!$img || $img.length === 0) return '';
  const src = $img.attr('src') || '';
  if (!looksLikePlaceholder(src)) return src;

  const fallback =
    $img.attr('data-src') ||
    $img.attr('data-lazy-src') ||
    $img.attr('data-original') ||
    $img.attr('data-srcset') ||
    $img.attr('srcset') ||
    '';

  if (!fallback) return src;
  // srcset-style values are "url size, url size, ..." - take the first url.
  return fallback.split(',')[0].trim().split(' ')[0];
}

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Feeds often append tracking parameters (Medium adds ?source=rss-...),
// which would make the same article look like a new URL on every scan.
function stripTracking(url) {
  try {
    const u = new URL(url);
    [...u.searchParams.keys()]
      .filter((key) => key === 'source' || key.startsWith('utm_'))
      .forEach((key) => u.searchParams.delete(key));
    return u.toString();
  } catch {
    return url;
  }
}

// WordPress exposes <author-url>/feed/; Medium (and Medium-hosted
// publications) expose /feed/<path> instead.
function feedCandidates(baseUrl) {
  const candidates = [`${baseUrl}/feed/`];
  try {
    const u = new URL(baseUrl);
    if (u.hostname === 'medium.com' || u.hostname.endsWith('.medium.com')) {
      candidates.unshift(`${u.origin}/feed${u.pathname}`);
    }
  } catch {
    // normalizeBaseUrl already produced something URL-shaped; ignore.
  }
  return candidates;
}

async function tryFeedScan(baseUrl) {
  for (const feedUrl of feedCandidates(baseUrl)) {
    const { ok, text, contentType } = await fetchText(feedUrl);
    const looksLikeXml = contentType.includes('xml') || /^\s*<\?xml/.test(text || '');
    if (!ok || !looksLikeXml) continue;

    const feed = await rssParser.parseString(text);
    const items = (feed.items || []).map((item) => {
      const contentHtml = item.contentEncoded || item.content || item.summary || '';
      return {
        title: (item.title || '').trim(),
        url: stripTracking(item.link),
        publishedAt: toIsoDate(item.isoDate || item.pubDate),
        excerpt: htmlToText(stripWpPostSuffix(item.content || item.summary || contentHtml)).slice(0, 400),
        imageUrl: extractFirstImage(contentHtml),
      };
    }).filter((item) => item.title && item.url);

    if (items.length > 0) return items;
  }
  return null;
}

// Archive listings rarely carry a publish date, so read it (plus a
// share image and summary, if still missing) from the article's own
// <meta> tags / JSON-LD.
async function fetchArticleDetails(url) {
  const { ok, text } = await fetchText(url);
  if (!ok) return {};
  const $ = cheerio.load(text);
  const meta = (selector) => ($(selector).attr('content') || '').trim();

  let publishedAt = toIsoDate(
    meta('meta[property="article:published_time"]') ||
    meta('meta[name="article:published_time"]') ||
    meta('meta[itemprop="datePublished"]') ||
    meta('meta[name="date"]')
  );
  if (!publishedAt) {
    const ld = text.match(/"datePublished"\s*:\s*"([^"]+)"/);
    publishedAt = toIsoDate(ld && ld[1]) || toIsoDate($('time[datetime]').first().attr('datetime'));
  }

  return {
    publishedAt,
    imageUrl: meta('meta[property="og:image"]'),
    excerpt: htmlToText(meta('meta[property="og:description"]') || meta('meta[name="description"]'))
      .replace(/\s*\[(?:…|\.\.\.)\]\s*$/, '…')
      .slice(0, 400),
  };
}

// Records the site's own icon (shown next to each article) the first time
// a source is scanned. Sites declare it in <link rel="icon">; /favicon.ico
// is only a convention and often missing.
async function ensureSourceIcon(source) {
  if (source.icon_url) return;
  try {
    const origin = new URL(normalizeBaseUrl(source.url)).origin;
    const { ok, text } = await fetchText(origin);
    if (!ok) return;
    const $ = cheerio.load(text);
    const href = $('link[rel~="icon"]').first().attr('href') || $('link[rel="apple-touch-icon"]').first().attr('href');
    if (!href) return;
    db.prepare('UPDATE sources SET icon_url = ? WHERE id = ?').run(new URL(href, origin).toString(), source.id);
  } catch {
    // Purely cosmetic - the page falls back to a lettered badge.
  }
}

const MAX_ENRICH_PER_SCAN = 80;

// Only ever fills in fields that are currently empty.
async function enrichArticles(sourceId) {
  const rows = db.prepare(
    `SELECT id, url FROM articles
     WHERE source_id = ? AND (published_at IS NULL OR image_url = '' OR excerpt = '')
     LIMIT ?`
  ).all(sourceId, MAX_ENRICH_PER_SCAN);

  const update = db.prepare(
    `UPDATE articles SET
       published_at = COALESCE(published_at, ?),
       image_url = CASE WHEN image_url = '' THEN ? ELSE image_url END,
       excerpt = CASE WHEN excerpt = '' THEN ? ELSE excerpt END
     WHERE id = ?`
  );

  let enriched = 0;
  for (const row of rows) {
    try {
      const details = await fetchArticleDetails(row.url);
      update.run(details.publishedAt || null, details.imageUrl || '', details.excerpt || '', row.id);
      if (details.publishedAt) enriched += 1;
    } catch {
      // One unreachable article shouldn't fail the whole scan.
    }
    await sleep(PAGE_CRAWL_DELAY_MS);
  }
  return enriched;
}

// Best-effort single-page fallback for non-WordPress (or feed-blocked) sites.
async function tryGenericHtmlScan(pageUrl) {
  const { ok, text } = await fetchText(pageUrl);
  if (!ok) return [];

  const $ = cheerio.load(text);
  // Lazy-loading themes often stuff a duplicate <img> (or the whole markup,
  // for <template>) as JS-less fallback content; cheerio/htmlparser2 treats
  // that as plain text, which fools naive "longest text in an <a>"
  // heuristics into picking image links instead of headlines. Strip it
  // before scanning.
  $('noscript, template, script, style').remove();

  const candidates = $('article, .post, .entry, [class*="post-"], [class*="article"]');
  const scope = candidates.length > 0 ? candidates : $('body');

  const items = [];
  const seen = new Set();

  scope.each((_, el) => {
    const $el = $(el);
    // Themes wrap the headline either as <h2><a>...</a></h2> or as
    // <a><h2>...</h2></a> - try both shapes before falling back to
    // "longest text in any link".
    const titleSelectors = 'h1 a[href], h2 a[href], h3 a[href], h4 a[href], .entry-title a[href], .post-title a[href], [class*="title"] a[href]';
    const wrappingSelectors = 'a[href]:has(h1), a[href]:has(h2), a[href]:has(h3), a[href]:has(h4)';
    let link = $el.find(titleSelectors).first();
    if (!link || link.length === 0) link = $el.find(wrappingSelectors).first();
    if (!link || link.length === 0) {
      link = $el.find('a[href]').filter((__, a) => $(a).text().trim().length > 8).first();
    }
    if (!link || link.length === 0) return;

    const href = link.attr('href');
    const title = link.text().trim();
    if (!href || !title || seen.has(href)) return;
    seen.add(href);

    const dateEl = $el.find('time').first();
    const publishedAt = dateEl.attr('datetime') || dateEl.text().trim() || null;
    const img = pickImageSrc($el.find('img').first());
    const excerpt = $el.find('p').first().text().trim().slice(0, 400);

    items.push({
      title,
      url: new URL(href, pageUrl).toString(),
      publishedAt: publishedAt ? new Date(publishedAt).toString() !== 'Invalid Date' ? new Date(publishedAt).toISOString() : null : null,
      excerpt,
      imageUrl: img ? new URL(img, pageUrl).toString() : '',
    });
  });

  return items;
}

// Deep, paginated crawl of a WordPress-style author archive
// (".../page/2/", ".../page/3/", ...) to backfill full article history.
// This is heavier on the target site, so it's only run when explicitly
// requested from the admin dashboard, with a short delay between pages.
async function fullArchiveCrawl(baseUrl, onProgress) {
  const collected = [];
  const seen = new Set();

  for (let page = 1; page <= MAX_ARCHIVE_PAGES; page += 1) {
    const pageUrl = page === 1 ? baseUrl : `${baseUrl}/page/${page}/`;
    let result;
    try {
      result = await fetchText(pageUrl);
    } catch (err) {
      break;
    }
    if (!result.ok) break;

    const items = await tryGenericHtmlScan(pageUrl).catch(() => []);
    const newItems = items.filter((item) => !seen.has(item.url));
    if (newItems.length === 0) break;

    newItems.forEach((item) => {
      seen.add(item.url);
      collected.push(item);
    });

    if (onProgress) onProgress({ page, found: collected.length });
    await sleep(PAGE_CRAWL_DELAY_MS);
  }

  return collected;
}

function upsertArticles(sourceId, items) {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO articles (source_id, title, url, excerpt, image_url, published_at, discovered_at)
    VALUES (@source_id, @title, @url, @excerpt, @image_url, @published_at, @discovered_at)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      excerpt = CASE WHEN excluded.excerpt != '' THEN excluded.excerpt ELSE articles.excerpt END,
      image_url = CASE WHEN excluded.image_url != '' THEN excluded.image_url ELSE articles.image_url END,
      published_at = COALESCE(excluded.published_at, articles.published_at)
  `);

  const tx = db.transaction((rows) => {
    for (const row of rows) {
      insert.run({
        source_id: sourceId,
        title: row.title,
        url: row.url,
        excerpt: row.excerpt || '',
        image_url: row.imageUrl || '',
        published_at: row.publishedAt,
        discovered_at: now,
      });
    }
  });

  tx(items);
}

async function scanSource(source) {
  if (source.url === MANUAL_SOURCE_URL) {
    return { count: 0, status: 'ok: manually-added articles are not scanned' };
  }

  const baseUrl = normalizeBaseUrl(source.url);
  let items = null;
  let status = '';

  try {
    items = await tryFeedScan(baseUrl);
  } catch (err) {
    items = null;
  }

  if (items && items.length > 0) {
    status = `ok: found ${items.length} articles via RSS feed`;
  } else {
    try {
      items = await tryGenericHtmlScan(baseUrl);
      status = items.length > 0
        ? `ok: found ${items.length} articles via page scan (no RSS feed detected)`
        : 'warning: no articles found - the site structure may not be supported yet';
    } catch (err) {
      items = [];
      status = `error: ${err.message}`;
    }
  }

  if (items.length > 0) upsertArticles(source.id, items);
  await enrichArticles(source.id);
  await ensureSourceIcon(source);

  db.prepare('UPDATE sources SET last_scanned_at = ?, last_status = ? WHERE id = ?').run(
    new Date().toISOString(),
    status,
    source.id
  );

  return { count: items.length, status };
}

async function fullScanSource(source, onProgress) {
  if (source.url === MANUAL_SOURCE_URL) {
    return { count: 0, status: 'ok: manually-added articles are not scanned' };
  }

  const baseUrl = normalizeBaseUrl(source.url);
  let items = [];
  let status = '';

  try {
    items = await fullArchiveCrawl(baseUrl, onProgress);
    status = `ok: full archive crawl found ${items.length} articles`;
  } catch (err) {
    status = `error: ${err.message}`;
  }

  if (items.length > 0) upsertArticles(source.id, items);
  const dated = await enrichArticles(source.id);
  await ensureSourceIcon(source);
  if (dated > 0) status += `, filled in ${dated} publish dates`;

  db.prepare('UPDATE sources SET last_scanned_at = ?, last_status = ? WHERE id = ?').run(
    new Date().toISOString(),
    status,
    source.id
  );

  return { count: items.length, status };
}

module.exports = { normalizeBaseUrl, scanSource, fullScanSource, enrichArticles, ensureSourceIcon };
