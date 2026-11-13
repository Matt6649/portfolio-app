// Fonts the admin can choose for headings and body text. Entries with a
// `pkg` are self-hosted from the matching @fontsource-variable npm package
// (served under /fonts), so nothing is loaded from a third-party CDN.
const FONTS = {
  sans: { stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  serif: { stack: 'Georgia, "Times New Roman", Times, serif' },
  mono: { stack: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace' },
  playfair: { pkg: 'playfair-display', stack: '"Playfair Display Variable", Georgia, serif' },
  fraunces: { pkg: 'fraunces', stack: '"Fraunces Variable", Georgia, serif' },
  'source-serif': { pkg: 'source-serif-4', stack: '"Source Serif 4 Variable", Georgia, serif' },
  inter: { pkg: 'inter', stack: '"Inter Variable", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' },
  'dm-sans': { pkg: 'dm-sans', stack: '"DM Sans Variable", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' },
  'space-grotesk': { pkg: 'space-grotesk', stack: '"Space Grotesk Variable", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' },
  'jetbrains-mono': { pkg: 'jetbrains-mono', stack: '"JetBrains Mono Variable", ui-monospace, Menlo, Consolas, monospace' },
};

const FONT_IDS = Object.keys(FONTS);

function fontOrDefault(id, fallbackId) {
  return FONTS[id] || FONTS[fallbackId];
}

module.exports = { FONTS, FONT_IDS, fontOrDefault };
