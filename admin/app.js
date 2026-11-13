const state = { mode: 'passkey' };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function statusClass(status) {
  if (!status) return '';
  if (status.startsWith('ok')) return 'status-ok';
  if (status.startsWith('warning')) return 'status-warning';
  if (status.startsWith('error')) return 'status-error';
  return '';
}

// ---------------------------------------------------------------------
// Auth / login
// ---------------------------------------------------------------------

async function initAuth() {
  const modeInfo = await api('/api/auth/mode');
  state.mode = modeInfo.mode;
  // The public site is a separate listener; this link assumes it's reachable
  // on the same host as the dashboard (true locally and over an SSH tunnel).
  document.getElementById('view-site-link').href =
    `${location.protocol}//${location.hostname}:${modeInfo.publicPort}/`;

  if (state.mode === 'basic') {
    // The browser handles the Basic Auth prompt itself on the first
    // request to a protected /api/admin/* route.
    document.getElementById('logout-btn').hidden = true;
    showDashboard();
    return;
  }

  document.getElementById('logout-btn').hidden = false;

  const { authenticated } = await api('/api/auth/session');
  if (authenticated) {
    showDashboard();
    return;
  }

  show(document.getElementById('login-view'));
  hide(document.getElementById('dashboard-view'));

  if (modeInfo.setupRequired) {
    show(document.getElementById('setup-panel'));
  } else {
    show(document.getElementById('login-panel'));
  }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    const options = await api('/api/auth/login/begin', { method: 'POST' });
    const authResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    await api('/api/auth/login/finish', { method: 'POST', body: JSON.stringify(authResp) });
    showDashboard();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('setup-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('setup-error');
  errorEl.textContent = '';
  const setupToken = document.getElementById('setup-token').value;
  const deviceLabel = document.getElementById('device-label').value;
  try {
    const options = await api('/api/auth/register/begin', {
      method: 'POST',
      body: JSON.stringify({ setupToken, deviceLabel }),
    });
    const regResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    await api('/api/auth/register/finish', { method: 'POST', body: JSON.stringify(regResp) });
    showDashboard();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('add-passkey-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('add-passkey-error');
  errorEl.textContent = '';
  const deviceLabel = document.getElementById('new-device-label').value;
  try {
    const options = await api('/api/auth/register/begin', {
      method: 'POST',
      body: JSON.stringify({ deviceLabel }),
    });
    const regResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    await api('/api/auth/register/finish', { method: 'POST', body: JSON.stringify(regResp) });
    document.getElementById('new-device-label').value = '';
    await loadPasskeyPanel();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

function loadPasskeyPanel() {
  if (state.mode !== 'passkey') return;
  show(document.getElementById('passkey-panel'));
  document.getElementById('passkey-count').textContent =
    'Passkey login is active. You can register additional devices below.';
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------

async function showDashboard() {
  hide(document.getElementById('login-view'));
  show(document.getElementById('dashboard-view'));
  loadProfile().catch(reportError);
  loadSources().catch(reportError);
  loadSocials().catch(reportError);
  loadPasskeyPanel();
  // Sections must be loaded before articles, so the per-article section
  // dropdowns have their options ready.
  await loadSections().catch(reportError);
  await loadArticles().catch(reportError);
}

function reportError(err) {
  console.error(err);
  let banner = document.getElementById('fatal-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'fatal-error-banner';
    banner.style.cssText = 'background:#d64545;color:#fff;padding:12px 16px;border-radius:8px;margin-bottom:16px;';
    document.getElementById('dashboard-view').prepend(banner);
  }
  banner.textContent = `Something went wrong talking to the server: ${err.message}. Try reloading the page.`;
}

async function loadProfile() {
  const profile = await api('/api/admin/profile');
  document.getElementById('profile-name').value = profile.name || '';
  document.getElementById('profile-tagline').value = profile.tagline || '';
  document.getElementById('profile-bio').value = profile.bio || '';

  const accent = profile.accent_color || '#2d5bff';
  document.getElementById('accent-color-swatch').value = accent;
  document.getElementById('accent-color-text').value = accent;

  const preview = document.getElementById('photo-preview');
  if (profile.photo_path) {
    preview.src = profile.photo_path;
    show(preview);
  }

  const coverPreview = document.getElementById('cover-preview');
  const removeCoverBtn = document.getElementById('remove-cover-btn');
  if (profile.cover_path) {
    coverPreview.src = profile.cover_path;
    show(coverPreview);
    show(removeCoverBtn);
  } else {
    hide(coverPreview);
    hide(removeCoverBtn);
  }

  document.getElementById('cover-wash-slider').value = profile.cover_wash || 84;
  document.getElementById('cover-style-select').value = profile.cover_style || 'dark';
  document.getElementById('photo-shape-select').value = profile.photo_shape || 'circle';
  document.getElementById('heading-font-select').value = profile.heading_font || 'serif';
  document.getElementById('font-style-select').value = profile.font_style || 'sans';
  document.getElementById('default-view-select').value = profile.default_view || 'grid';
  document.getElementById('show-excerpts-check').checked = !!profile.show_excerpts;
  document.getElementById('show-dates-check').checked = !!profile.show_dates;
  document.getElementById('page-title-input').value = profile.page_title || '';
  document.getElementById('meta-description-input').value = profile.meta_description || '';
}

const THEME_PRESETS = {
  editorial: { accentColor: '#9a6b2f', headingFont: 'playfair', fontStyle: 'inter', coverStyle: 'dark', photoShape: 'circle' },
  literary: { accentColor: '#7a2e3b', headingFont: 'fraunces', fontStyle: 'source-serif', coverStyle: 'dark', photoShape: 'circle' },
  modern: { accentColor: '#2d5bff', headingFont: 'inter', fontStyle: 'inter', coverStyle: 'wash', photoShape: 'circle' },
  bold: { accentColor: '#e0532f', headingFont: 'space-grotesk', fontStyle: 'dm-sans', coverStyle: 'accent', photoShape: 'square' },
  minimal: { accentColor: '#3d3d3d', headingFont: 'jetbrains-mono', fontStyle: 'sans', coverStyle: 'wash', photoShape: 'square' },
};

document.getElementById('theme-presets').addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-preset-btn');
  if (!btn) return;
  const preset = THEME_PRESETS[btn.dataset.theme];
  if (!preset) return;

  accentSwatch.value = preset.accentColor;
  accentText.value = preset.accentColor;
  document.getElementById('heading-font-select').value = preset.headingFont;
  document.getElementById('font-style-select').value = preset.fontStyle;
  document.getElementById('cover-style-select').value = preset.coverStyle;
  document.getElementById('photo-shape-select').value = preset.photoShape;

  const savedMsg = document.getElementById('display-settings-saved');
  savedMsg.style.color = '';
  savedMsg.textContent = 'Theme applied - click Save to keep it';
});

document.getElementById('save-display-settings-btn').addEventListener('click', async () => {
  const savedMsg = document.getElementById('display-settings-saved');
  savedMsg.textContent = '';
  const accentColor = accentText.value.trim();
  if (accentColor && !HEX_COLOR_RE.test(accentColor)) {
    savedMsg.style.color = 'var(--danger)';
    savedMsg.textContent = 'Accent colour must be a hex code like #2d5bff';
    return;
  }
  await api('/api/admin/profile', {
    method: 'PUT',
    body: JSON.stringify({
      accentColor: accentColor || undefined,
      coverWash: document.getElementById('cover-wash-slider').value,
      coverStyle: document.getElementById('cover-style-select').value,
      photoShape: document.getElementById('photo-shape-select').value,
      headingFont: document.getElementById('heading-font-select').value,
      fontStyle: document.getElementById('font-style-select').value,
      defaultView: document.getElementById('default-view-select').value,
      showExcerpts: document.getElementById('show-excerpts-check').checked,
      showDates: document.getElementById('show-dates-check').checked,
      pageTitle: document.getElementById('page-title-input').value,
      metaDescription: document.getElementById('meta-description-input').value,
    }),
  });
  savedMsg.style.color = '';
  savedMsg.textContent = 'Saved';
  setTimeout(() => { savedMsg.textContent = ''; }, 2000);
});

const accentSwatch = document.getElementById('accent-color-swatch');
const accentText = document.getElementById('accent-color-text');
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

accentSwatch.addEventListener('input', () => { accentText.value = accentSwatch.value; });
accentText.addEventListener('input', () => {
  if (HEX_COLOR_RE.test(accentText.value)) accentSwatch.value = accentText.value;
});

document.getElementById('save-profile-btn').addEventListener('click', async () => {
  const savedMsg = document.getElementById('profile-saved');
  savedMsg.textContent = '';
  const accentColor = accentText.value.trim();
  if (accentColor && !HEX_COLOR_RE.test(accentColor)) {
    savedMsg.style.color = 'var(--danger)';
    savedMsg.textContent = 'Accent colour must be a hex code like #2d5bff';
    return;
  }
  await api('/api/admin/profile', {
    method: 'PUT',
    body: JSON.stringify({
      name: document.getElementById('profile-name').value,
      tagline: document.getElementById('profile-tagline').value,
      bio: document.getElementById('profile-bio').value,
      accentColor: accentColor || undefined,
    }),
  });
  savedMsg.style.color = '';
  savedMsg.textContent = 'Saved';
  setTimeout(() => { savedMsg.textContent = ''; }, 2000);
});

document.getElementById('photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('photo', file);
  const profile = await api('/api/admin/profile/photo', { method: 'POST', body: formData });
  const preview = document.getElementById('photo-preview');
  preview.src = `${profile.photo_path}?t=${Date.now()}`;
  show(preview);
});

document.getElementById('cover-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('cover', file);
  const profile = await api('/api/admin/profile/cover', { method: 'POST', body: formData });
  const preview = document.getElementById('cover-preview');
  preview.src = `${profile.cover_path}?t=${Date.now()}`;
  show(preview);
  show(document.getElementById('remove-cover-btn'));
});

document.getElementById('remove-cover-btn').addEventListener('click', async () => {
  if (!confirm('Remove the cover image?')) return;
  await api('/api/admin/profile/cover', { method: 'DELETE' });
  hide(document.getElementById('cover-preview'));
  hide(document.getElementById('remove-cover-btn'));
  document.getElementById('cover-input').value = '';
});

async function loadSources() {
  const sources = await api('/api/admin/sources');
  const tbody = document.querySelector('#sources-table tbody');
  tbody.innerHTML = sources.map((s) => `
    <tr data-id="${s.id}">
      <td>${escapeHtml(s.label || '—')}</td>
      <td><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url)}</a></td>
      <td class="${statusClass(s.last_status)}">${escapeHtml(s.last_status || 'never scanned')}</td>
      <td>${s.last_scanned_at ? new Date(s.last_scanned_at).toLocaleString() : '—'}</td>
      <td class="actions">
        <button class="btn scan-btn">Scan</button>
        <button class="btn full-scan-btn">Full scan</button>
        <button class="btn danger remove-source-btn">Remove</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5">No sources added yet.</td></tr>';
}

document.getElementById('add-source-btn').addEventListener('click', async () => {
  const url = document.getElementById('new-source-url').value.trim();
  const label = document.getElementById('new-source-label').value.trim();
  if (!url) return;
  await api('/api/admin/sources', { method: 'POST', body: JSON.stringify({ url, label }) });
  document.getElementById('new-source-url').value = '';
  document.getElementById('new-source-label').value = '';
  await loadSources();
});

document.querySelector('#sources-table tbody').addEventListener('click', async (e) => {
  const row = e.target.closest('tr');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('scan-btn')) {
    e.target.textContent = 'Scanning…';
    e.target.disabled = true;
    try {
      await api(`/api/admin/sources/${id}/scan`, { method: 'POST' });
    } finally {
      await loadSources();
      await loadArticles();
    }
  }

  if (e.target.classList.contains('full-scan-btn')) {
    e.target.textContent = 'Crawling…';
    e.target.disabled = true;
    try {
      await api(`/api/admin/sources/${id}/full-scan`, { method: 'POST' });
    } finally {
      await loadSources();
      await loadArticles();
    }
  }

  if (e.target.classList.contains('remove-source-btn')) {
    if (!confirm('Remove this source and all articles found from it?')) return;
    await api(`/api/admin/sources/${id}`, { method: 'DELETE' });
    await loadSources();
    await loadArticles();
  }
});

let sectionsCache = [];
let articlesCache = [];

async function loadSections() {
  sectionsCache = await api('/api/admin/sections');
  const tbody = document.querySelector('#sections-table tbody');
  tbody.innerHTML = sectionsCache.map((s) => `
    <tr data-id="${s.id}">
      <td>${escapeHtml(s.name)}</td>
      <td class="actions"><button class="btn danger remove-section-btn">Remove</button></td>
    </tr>
  `).join('') || '<tr><td colspan="2">No sections yet.</td></tr>';
}

document.getElementById('add-section-btn').addEventListener('click', async () => {
  const input = document.getElementById('new-section-name');
  const name = input.value.trim();
  if (!name) return;
  await api('/api/admin/sections', { method: 'POST', body: JSON.stringify({ name }) });
  input.value = '';
  await loadSections();
  await loadArticles();
});

document.querySelector('#sections-table tbody').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('remove-section-btn')) return;
  const row = e.target.closest('tr');
  if (!confirm('Remove this section? Articles in it will become unsectioned.')) return;
  await api(`/api/admin/sections/${row.dataset.id}`, { method: 'DELETE' });
  await loadSections();
  await loadArticles();
});

function sectionOptionsHtml(selectedId) {
  const options = ['<option value="">— none —</option>']
    .concat(sectionsCache.map((s) => `<option value="${s.id}"${String(s.id) === String(selectedId) ? ' selected' : ''}>${escapeHtml(s.name)}</option>`));
  return options.join('');
}

function renderArticlesTable() {
  const query = document.getElementById('article-search').value.trim().toLowerCase();
  const filtered = query
    ? articlesCache.filter((a) => a.title.toLowerCase().includes(query) || (a.excerpt || '').toLowerCase().includes(query))
    : articlesCache;

  document.getElementById('article-total').textContent = articlesCache.length;
  const tbody = document.querySelector('#articles-table tbody');
  tbody.innerHTML = filtered.map((a) => `
    <tr data-id="${a.id}">
      <td><button class="star-btn${a.featured ? ' featured' : ''}" title="${a.featured ? 'Unfeature' : 'Feature'}">${a.featured ? '★' : '☆'}</button></td>
      <td><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a></td>
      <td>${escapeHtml(a.source_label || '')}</td>
      <td><select class="section-select">${sectionOptionsHtml(a.section_id)}</select></td>
      <td>${a.published_at ? new Date(a.published_at).toLocaleDateString() : '—'}</td>
      <td class="actions"><button class="btn danger remove-article-btn">Remove</button></td>
    </tr>
  `).join('') || `<tr><td colspan="6">${query ? 'No articles match your search.' : 'No articles discovered yet.'}</td></tr>`;
}

async function loadArticles() {
  articlesCache = await api('/api/admin/articles');
  renderArticlesTable();
}

document.getElementById('article-search').addEventListener('input', renderArticlesTable);

document.querySelector('#articles-table tbody').addEventListener('click', async (e) => {
  const row = e.target.closest('tr');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('remove-article-btn')) {
    await api(`/api/admin/articles/${id}`, { method: 'DELETE' });
    await loadArticles();
  }

  if (e.target.classList.contains('star-btn')) {
    const article = articlesCache.find((a) => String(a.id) === id);
    await api(`/api/admin/articles/${id}/featured`, {
      method: 'PUT',
      body: JSON.stringify({ featured: !article.featured }),
    });
    await loadArticles();
  }
});

document.querySelector('#articles-table tbody').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('section-select')) return;
  const row = e.target.closest('tr');
  await api(`/api/admin/articles/${row.dataset.id}/section`, {
    method: 'PUT',
    body: JSON.stringify({ sectionId: e.target.value || null }),
  });
  await loadArticles();
});

document.getElementById('add-manual-article-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('manual-article-error');
  errorEl.textContent = '';
  try {
    await api('/api/admin/articles/manual', {
      method: 'POST',
      body: JSON.stringify({
        title: document.getElementById('manual-article-title').value.trim(),
        url: document.getElementById('manual-article-url').value.trim(),
        excerpt: document.getElementById('manual-article-excerpt').value.trim(),
        imageUrl: document.getElementById('manual-article-image').value.trim(),
        publishedAt: document.getElementById('manual-article-date').value,
      }),
    });
    ['title', 'url', 'excerpt', 'image', 'date'].forEach((field) => {
      document.getElementById(`manual-article-${field}`).value = '';
    });
    document.querySelector('.manual-article-form').open = false;
    await loadArticles();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

async function loadSocials() {
  const socials = await api('/api/admin/socials');
  const tbody = document.querySelector('#socials-table tbody');
  tbody.innerHTML = socials.map((s) => `
    <tr data-id="${s.id}">
      <td>${escapeHtml(s.platform)}</td>
      <td>${escapeHtml(s.label || '—')}</td>
      <td>${escapeHtml(s.url)}</td>
      <td class="actions">
        <button class="btn edit-social-btn">Edit</button>
        <button class="btn danger remove-social-btn">Remove</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4">No social buttons added yet.</td></tr>';
}

document.getElementById('add-social-btn').addEventListener('click', async () => {
  const platform = document.getElementById('new-social-platform').value;
  const label = document.getElementById('new-social-label').value.trim();
  let url = document.getElementById('new-social-url').value.trim();
  if (!url) return;
  if (platform === 'email' && !url.startsWith('mailto:') && url.includes('@')) {
    url = `mailto:${url}`;
  }
  await api('/api/admin/socials', { method: 'POST', body: JSON.stringify({ platform, label, url }) });
  document.getElementById('new-social-label').value = '';
  document.getElementById('new-social-url').value = '';
  await loadSocials();
});

document.querySelector('#socials-table tbody').addEventListener('click', async (e) => {
  const row = e.target.closest('tr');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('remove-social-btn')) {
    await api(`/api/admin/socials/${id}`, { method: 'DELETE' });
    await loadSocials();
  }

  if (e.target.classList.contains('edit-social-btn')) {
    const cells = row.querySelectorAll('td');
    const platform = cells[0].textContent;
    const currentLabel = cells[1].textContent === '—' ? '' : cells[1].textContent;
    const currentUrl = cells[2].textContent;
    const newLabel = prompt('Label', currentLabel);
    if (newLabel === null) return;
    const newUrl = prompt('URL', currentUrl);
    if (newUrl === null) return;
    await api(`/api/admin/socials/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ platform, label: newLabel, url: newUrl }),
    });
    await loadSocials();
  }
});

function escapeHtml(str) {
  return (str || '').toString().replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

initAuth().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:40px;color:#d64545">Failed to load admin dashboard: ${escapeHtml(err.message)}</p>`;
});
