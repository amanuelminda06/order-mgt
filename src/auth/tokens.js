/**
 * HMAC session tokens: base64url({uid,ver,iat}).base64url(signature).
 *
 * `uid` is the DB user id and `ver` is users.token_version. Bumping the
 * version (password change, deactivation, role change) revokes every token.
 * No role or username is stored in the token — RBAC reloads the user.
 */
const crypto = require('crypto');
const { JWT_SECRET } = require('../config/env');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(user) {
  const payload = { uid: user.id, ver: user.token_version || 0, iat: Date.now() };
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verify(token) {
  if (typeof token !== 'string' || token.split('.').length !== 2) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!Number.isInteger(payload.uid) || !Number.isInteger(payload.ver)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = { sign, verify };
