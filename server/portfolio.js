const { db } = require('./db');

function getPortfolio() {
  const profile = db.prepare(
    `SELECT name, tagline, bio, photo_path, cover_path, accent_color,
            cover_wash, cover_style, photo_shape, font_style, heading_font,
            show_excerpts, show_dates, default_view, page_title, meta_description
     FROM profile WHERE id = 1`
  ).get();
  const socials = db.prepare('SELECT platform, label, url FROM socials ORDER BY sort_order ASC, id ASC').all();
  const sections = db.prepare('SELECT id, name FROM sections ORDER BY sort_order ASC, id ASC').all();
  const articles = db.prepare(
    `SELECT articles.title, articles.url, articles.excerpt, articles.image_url, articles.published_at,
            articles.featured, articles.section_id,
            sources.label as source_label, sources.url as source_url, sources.icon_url as source_icon,
            sections.name as section_name
     FROM articles
     JOIN sources ON sources.id = articles.source_id
     LEFT JOIN sections ON sections.id = articles.section_id
     ORDER BY articles.published_at IS NULL, articles.published_at DESC, articles.id ASC
     LIMIT 1000`
  ).all();

  return { profile, socials, sections, articles };
}

module.exports = { getPortfolio };
