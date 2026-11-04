/**
 * Authentication middleware.
 *
 * LEGACY TOKEN FORMAT — deliberately unchanged in this step:
 *   token = base64("<username>:<timestamp>")
 * Verification decodes it and reads the substring before the first ":".
 * There is no signature, no expiry and no revocation. This is replaced by
 * HMAC + token_version in a later step; do not build new code on top of it.
 */
const { staff } = require('../db/memory-store');

function requireAuth(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const username = Buffer.from(token, 'base64').toString('utf-8').split(':')[0];
  const user = staff.find((s) => s.username === username && s.active);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { requireAuth, requireAdmin };
