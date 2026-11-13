// Line icons for social/contact links, drawn on a 24x24 grid and coloured
// by the link's own text colour via `currentColor`.
const PATHS = {
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6.5L20.5 7"/>',
  website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.600-3.800-9S9.500 5.600 12 3Z"/>',
  x: '<path d="M4 4l11.500 16H20L8.500 4H4Z"/><path d="m4.500 20 6.300-6.900M13.300 10.600 19.500 4"/>',
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.500 10.500v6M7.500 7.500v.01M11.500 16.500v-3.300a2.250 2.250 0 0 1 4.500 0v3.300M11.500 10.500v6"/>',
  github: '<path d="M9 19c-5 1.500-5-2.500-7-3m14 6v-3.870a3.370 3.370 0 0 0-.940-2.610c3.140-.350 6.440-1.540 6.440-7A5.440 5.440 0 0 0 20 4.770 5.070 5.070 0 0 0 19.910 1S18.730.650 16 2.480a13.380 13.380 0 0 0-7 0C6.270.650 5.090 1 5.090 1A5.070 5.070 0 0 0 5 4.770a5.440 5.440 0 0 0-1.500 3.780c0 5.420 3.300 6.610 6.440 7A3.370 3.370 0 0 0 9 18.130V22"/>',
  instagram: '<rect x="3.500" y="3.500" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r="1" fill="currentColor" stroke="none"/>',
  facebook: '<path d="M15.500 4H14a3.500 3.500 0 0 0-3.500 3.500V21M7.500 12.500h7"/>',
  youtube: '<rect x="2.500" y="5.500" width="19" height="13" rx="4"/><path d="m10.500 9.500 4.500 2.500-4.500 2.500v-5Z" fill="currentColor"/>',
  mastodon: '<path d="M5 9.500C5 6 7 4.500 12 4.500s7 1.500 7 5v3c0 3-2 4.500-7 4.500-1.200 0-2.300-.100-3.200-.300 0 1.600 1.200 2.300 4.200 2.100"/><path d="M8.500 13V9.800a1.750 1.750 0 0 1 3.500 0V12m0-2.200a1.750 1.750 0 0 1 3.500 0V13"/>',
  tiktok: '<path d="M14 3.500v11a3.750 3.750 0 1 1-3.750-3.750M14 3.500c.300 2.600 1.900 4.300 4.750 4.600"/>',
  substack: '<path d="M5 5h14M5 9h14M5 13h14v7.500l-7-3.800-7 3.800V13Z"/>',
  bluesky: '<path d="M12 11.200C10.600 8.300 7.600 5.500 5.300 5 3.600 4.700 3 5.600 3 7c0 1.200.500 4.600.900 5.400.600 1.500 2.300 2 4.200 1.700-2.600.500-3.900 1.700-2.400 3.600 2.300 2.700 4.600.400 6.300-3.300 1.700 3.700 4 6 6.300 3.300 1.500-1.900.200-3.100-2.400-3.600 1.900.300 3.600-.200 4.200-1.700.400-.800.900-4.200.900-5.400 0-1.400-.600-2.300-2.300-2-2.300.500-5.300 3.300-6.700 6.200Z"/>',
};

PATHS.twitter = PATHS.x;

function socialIcon(platform) {
  const paths = PATHS[(platform || '').toLowerCase()] || PATHS.website;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

module.exports = { socialIcon };
