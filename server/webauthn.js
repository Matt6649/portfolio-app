const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { db, getMeta } = require('./db');
const config = require('./config');

// Short-lived challenge storage, keyed by express session id. Challenges
// are only needed for the ~60s between "begin" and "finish" of a
// register/login round trip, so an in-memory map is fine.
const pendingChallenges = new Map();

function adminUserId() {
  return getMeta('admin_user_id');
}

function listCredentials() {
  return db.prepare('SELECT * FROM credentials').all();
}

function hasAnyCredential() {
  return listCredentials().length > 0;
}

function b64urlToBuffer(b64url) {
  return Buffer.from(b64url, 'base64url');
}

async function beginRegistration(sessionId, deviceLabel) {
  const existing = listCredentials().map((c) => ({
    id: c.credential_id,
    transports: JSON.parse(c.transports || '[]'),
  }));

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userID: Buffer.from(adminUserId()),
    userName: 'admin',
    attestationType: 'none',
    excludeCredentials: existing,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  pendingChallenges.set(sessionId, {
    challenge: options.challenge,
    deviceLabel: deviceLabel || '',
    createdAt: Date.now(),
  });

  return options;
}

async function finishRegistration(sessionId, response) {
  const pending = pendingChallenges.get(sessionId);
  if (!pending) throw new Error('No registration in progress for this session');
  pendingChallenges.delete(sessionId);

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey registration could not be verified');
  }

  const { credential } = verification.registrationInfo;

  db.prepare(
    `INSERT INTO credentials (credential_id, public_key, counter, transports, device_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    credential.id,
    Buffer.from(credential.publicKey).toString('base64url'),
    credential.counter,
    JSON.stringify(response.response.transports || []),
    pending.deviceLabel,
    new Date().toISOString()
  );

  return true;
}

async function beginAuthentication(sessionId) {
  const creds = listCredentials();
  if (creds.length === 0) throw new Error('No passkeys registered yet');

  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    userVerification: 'preferred',
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: JSON.parse(c.transports || '[]'),
    })),
  });

  pendingChallenges.set(sessionId, { challenge: options.challenge, createdAt: Date.now() });
  return options;
}

async function finishAuthentication(sessionId, response) {
  const pending = pendingChallenges.get(sessionId);
  if (!pending) throw new Error('No login in progress for this session');
  pendingChallenges.delete(sessionId);

  const row = db.prepare('SELECT * FROM credentials WHERE credential_id = ?').get(response.id);
  if (!row) throw new Error('Unknown passkey');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
    credential: {
      id: row.credential_id,
      publicKey: b64urlToBuffer(row.public_key),
      counter: row.counter,
      transports: JSON.parse(row.transports || '[]'),
    },
  });

  if (!verification.verified) throw new Error('Passkey login could not be verified');

  db.prepare('UPDATE credentials SET counter = ? WHERE credential_id = ?').run(
    verification.authenticationInfo.newCounter,
    row.credential_id
  );

  return true;
}

module.exports = {
  hasAnyCredential,
  listCredentials,
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
};
