/** Authentication + RBAC middleware (DB-backed, HMAC token). */
const { verify } = require('./tokens');
const { can } = require('./permissions');
const { findUserById } = require('../db/accounts');
const { asyncHandler } = require('../utils/async');

function cookieValue(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// HttpOnly cookie is the primary browser credential; the header keeps API
// clients working. SameSite=Lax on the cookie blocks cross-site POSTs.
function tokenFromRequest(req) {
  return cookieValue(req, 'cd_session') || req.headers['authorization'];
}

const PASSWORD_CHANGE_ALLOWED = ['/api/auth/change-password', '/api/logout'];

const requireAuth = asyncHandler(async (req, res, next) => {
  const payload = verify(tokenFromRequest(req));
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  // Reload on every request so role/deactivation changes take effect and a
  // token_version bump revokes old sessions immediately.
  const user = await findUserById(payload.uid);
  if (!user || !user.active || user.token_version !== payload.ver) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  if (user.must_change_password && !PASSWORD_CHANGE_ALLOWED.includes(req.path)) {
    return res.status(403).json({ error: 'password_change_required' });
  }
  next();
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}

function requirePermission(action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!can(req.user.role, action)) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}

const requireAdmin = requireRole('admin');

module.exports = { requireAuth, requireAdmin, requireRole, requirePermission, cookieValue, tokenFromRequest };
