const crypto = require('crypto');
const config = require('./config');

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a || '');
  const bufB = Buffer.from(b || '');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// HTTP Basic Auth middleware - used when AUTH_MODE=basic, and can also be
// layered in front of passkey login for extra defense-in-depth.
function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);

    if (
      timingSafeEqual(user, config.basicAuthUser) &&
      timingSafeEqual(pass, config.basicAuthPass)
    ) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Portfolio Admin"');
  return res.status(401).send('Authentication required');
}

// Session-based check used after a successful passkey login.
function requireSession(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

module.exports = { basicAuth, requireSession };
