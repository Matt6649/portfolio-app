const express = require('express');
const config = require('../config');
const webauthn = require('../webauthn');

const router = express.Router();

router.get('/mode', (req, res) => {
  res.json({
    mode: config.authMode,
    publicPort: config.publicPort,
    setupRequired: config.authMode === 'passkey' && !webauthn.hasAnyCredential(),
  });
});

router.get('/session', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---- Passkey registration (first-time setup, gated by SETUP_TOKEN; or
// adding an extra device once already logged in) ----

router.post('/register/begin', async (req, res) => {
  const alreadyHasCreds = webauthn.hasAnyCredential();
  const isLoggedIn = !!(req.session && req.session.authenticated);

  if (alreadyHasCreds && !isLoggedIn) {
    return res.status(403).json({ error: 'Passkey already set up. Log in to add another device.' });
  }

  if (!alreadyHasCreds) {
    const token = req.body.setupToken || '';
    if (!config.setupToken || token !== config.setupToken) {
      return res.status(403).json({ error: 'Invalid or missing setup token' });
    }
  }

  try {
    const options = await webauthn.beginRegistration(req.sessionID, req.body.deviceLabel);
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/register/finish', async (req, res) => {
  try {
    await webauthn.finishRegistration(req.sessionID, req.body);
    req.session.authenticated = true;
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Passkey login ----

router.post('/login/begin', async (req, res) => {
  try {
    const options = await webauthn.beginAuthentication(req.sessionID);
    res.json(options);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login/finish', async (req, res) => {
  try {
    await webauthn.finishAuthentication(req.sessionID, req.body);
    req.session.authenticated = true;
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
