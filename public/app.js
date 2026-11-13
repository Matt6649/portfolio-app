// The profile header is rendered by the server; this script renders the
// article list from the JSON the server embeds in the page, and handles
// search, filters, "show more" and the light/dark toggle.
const data = JSON.parse(document.getElementById('portfolio-data').textContent);
const PAGE_SIZE = 12;
let visibleCount = PAGE_SIZE;

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return (str || '').toString().replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Theme toggle: system -> light -> dark, remembered per browser
// ---------------------------------------------------------------------
const THEME_KEY = 'portfolio-theme';
const THEMES = ['system', 'light', 'dark'];
const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const THEME_ICONS = {
  system: svg('<circle cx="12" cy="12" r="8.500"/><path d="M12 3.500v17a8.500 8.500 0 0 0 0-17Z" fill="currentColor"/>'),
  light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M5.300 18.700l1.400-1.400M17.300 6.700l1.400-1.400"/>'),
  dark: svg('<path d="M20 14.500A8.500 8.500 0 0 1 9.500 4a7 7 0 1 0 10.500 10.500Z"/>'),
};
const EXTERNAL_ICON = svg('<path d="M14 5h5v5M19 5l-8 8M11 6H6.500A1.500 1.500 0 0 0 5 7.500v10A1.500 1.500 0 0 0 6.500 19h10a1.500 1.500 0 0 0 1.500-1.500V13"/>');

let theme = 'system';
try {
  theme = localStorage.getItem(THEME_KEY) || 'system';
} catch {
  // Storage unavailable (private browsing): the toggle still works for this visit.
}

function applyTheme() {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);

  const toggle = $('theme-toggle');
  const label = `Colour theme: ${theme}. Click to change.`;
  toggle.innerHTML = THEME_ICONS[theme];
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
}

$('theme-toggle').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // See above.
  }
  applyTheme();
});

applyTheme();

// ---------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------
function sourceName(a) {
  const url = parseUrl(a.url);
  return a.source_label && a.source_label !== 'Manually added'
    ? a.source_label
    : (url ? url.hostname.replace(/^www\./, '') : 'Article');
}

function renderCard(a, { showFeaturedKicker = true } = {}) {
  const url = parseUrl(a.url);
  const name = sourceName(a);
  const date = data.showDates ? formatDate(a.published_at) : '';
  const kicker = [showFeaturedKicker && a.featured ? '★ Featured' : '', a.section_name]
    .filter(Boolean).join(' · ');

  const iconUrl = a.source_icon || (url ? `${url.origin}/favicon.ico` : '');
  const icon = iconUrl
    ? `<img class="source-icon" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" data-letter="${escapeHtml(name.charAt(0).toUpperCase())}" />`
    : '';

  return `
    <a class="article-card" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">
      <div class="thumb">${a.image_url
        ? `<img class="article-thumb" src="${escapeHtml(a.image_url)}" alt="" loading="lazy" />`
        : ''}</div>
      <div class="article-body">
        ${kicker ? `<div class="kicker">${escapeHtml(kicker)}</div>` : ''}
        <h3 class="article-title">${escapeHtml(a.title)}</h3>
        ${data.showExcerpts && a.excerpt ? `<p class="article-excerpt">${escapeHtml(a.excerpt)}</p>` : ''}
        <div class="article-meta">
          ${icon}
          ${date ? `<span>${date}</span><span aria-hidden="true">·</span>` : ''}
          <span>${escapeHtml(name)}</span>
          ${EXTERNAL_ICON}
        </div>
      </div>
    </a>
  `;
}

// Images are hot-linked from the publishers' sites, so some will fail:
// a missing favicon becomes a lettered badge, a missing photo falls back
// to the card's placeholder background. ("error" doesn't bubble, hence
// the capturing listener.)
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.classList.contains('source-icon')) {
    const badge = document.createElement('span');
    badge.className = 'source-icon';
    badge.textContent = img.dataset.letter || '';
    img.replaceWith(badge);
  } else if (img.classList.contains('article-thumb')) {
    img.remove();
  }
}, true);

function populateFilters() {
  const sources = new Map(data.articles.map((a) => [a.source_url, a.source_label || sourceName(a)]));
  $('source-filter').innerHTML = '<option value="">All sources</option>' +
    [...sources].map(([url, label]) => `<option value="${escapeHtml(url)}">${escapeHtml(label)}</option>`).join('');
  $('source-filter').hidden = sources.size < 2;

  const usedSections = data.sections.filter((s) => data.articles.some((a) => a.section_id === s.id));
  $('section-filter').innerHTML = '<option value="">All sections</option>' +
    usedSections.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  $('section-filter').hidden = usedSections.length === 0;

  $('featured-toggle-wrap').hidden = !data.articles.some((a) => a.featured);
}

function activeFilters() {
  return {
    search: $('search-input').value.trim().toLowerCase(),
    source: $('source-filter').value,
    section: $('section-filter').value,
    featuredOnly: $('featured-filter').checked,
  };
}

function render() {
  const { search, source, section, featuredOnly } = activeFilters();
  const filtering = !!(search || source || section || featuredOnly);

  const matches = data.articles.filter((a) => {
    if (search && !`${a.title} ${a.excerpt || ''} ${a.source_label || ''}`.toLowerCase().includes(search)) return false;
    if (source && a.source_url !== source) return false;
    if (section && String(a.section_id || '') !== section) return false;
    if (featuredOnly && !a.featured) return false;
    return true;
  });

  // The Featured showcase only makes sense on the unfiltered page.
  const featured = data.articles.filter((a) => a.featured);
  $('featured-section').hidden = filtering || featured.length === 0;
  $('featured-articles').classList.toggle('single', featured.length === 1);
  $('featured-articles').innerHTML = featured.map((a) => renderCard(a, { showFeaturedKicker: false })).join('');

  const shown = matches.slice(0, visibleCount);
  $('articles').classList.toggle('list-view', data.listView);
  $('articles').innerHTML = shown.map((a) => renderCard(a)).join('');

  $('empty-state').hidden = data.articles.length > 0;
  $('no-results').hidden = data.articles.length === 0 || matches.length > 0;
  $('show-more').hidden = matches.length <= visibleCount;

  const total = data.articles.length;
  $('article-count').textContent = total === 0 ? ''
    : filtering ? `${matches.length} of ${total}`
    : `${total} article${total === 1 ? '' : 's'}`;
}

function onFilterChange() {
  visibleCount = PAGE_SIZE;
  render();
}

$('search-input').addEventListener('input', onFilterChange);
['source-filter', 'section-filter', 'featured-filter'].forEach((id) => {
  $(id).addEventListener('change', onFilterChange);
});

$('show-more').addEventListener('click', () => {
  visibleCount += PAGE_SIZE;
  render();
});

$('clear-filters').addEventListener('click', () => {
  $('search-input').value = '';
  $('source-filter').value = '';
  $('section-filter').value = '';
  $('featured-filter').checked = false;
  onFilterChange();
});

populateFilters();
render();
