// lib/auth.js
// Password hashing + signed session tokens, using only Node's built-in `crypto`.
// No external dependencies (no bcrypt, no jsonwebtoken).
const crypto = require('crypto');
const SECRET = process.env.GEARCALL_SECRET || 'gearcall-dev-secret-change-in-production';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const RESET_TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minutes

// ---------- Passwords ----------
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(plain, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(plain, salt, 64).toString('hex');
  // timing-safe compare
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Tokens (HMAC-signed, JWT-like but hand-rolled) ----------
function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}
function createToken(payload) {
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const encoded = base64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(encoded).digest('hex');
  return `${encoded}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', SECRET).update(encoded).digest('hex');
  const a = Buffer.from(sig || '', 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(encoded));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

// ---------- Password-reset tokens ----------
// We never store the raw token in the database — only a SHA-256 hash of it.
// The raw token is only ever emailed to the user, so even a DB leak can't be
// used to reset someone's password.
function generateResetToken() {
  const token = crypto.randomBytes(32).toString('hex'); // sent in the email link
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex'); // stored in DB
  const expires = Date.now() + RESET_TOKEN_TTL_MS;
  return { token, tokenHash, expires };
}
function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  hashPassword, verifyPassword, createToken, verifyToken,
  generateResetToken, hashResetToken, RESET_TOKEN_TTL_MS,
};
