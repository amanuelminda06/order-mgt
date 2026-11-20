/** Login/logout, forced password change, admin reset — DB-backed and audited. */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { NODE_ENV } = require('../../config/env');
const { findUserByUsername, findUserById, setPassword, revokeTokens, appendAudit } = require('../../db/accounts');
const { sign } = require('../../auth/tokens');
const { requireAuth, requirePermission } = require('../../auth/middleware');
const guard = require('../../auth/login-guard');
const { asyncHandler } = require('../../utils/async');

const router = express.Router();

function setSessionCookie(res, token) {
  res.cookie('cd_session', token, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

router.post('/api/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const key = guard.keyFor(username, req.ip);
  if (!guard.allowed(key)) return res.status(429).json({ error: 'Too many attempts' });

  const user = await findUserByUsername(username);
  const ok = user && user.active && bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    guard.fail(key);
    await appendAudit({ actor: user, action: 'auth.login_failed', entityType: 'user', entityId: username, ip: req.ip });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  guard.clear(key);
  const token = sign(user);
  setSessionCookie(res, token);
  await appendAudit({ actor: user, action: 'auth.login', entityType: 'user', entityId: user.id, ip: req.ip });
  res.json({
    success: true,
    token,
    username: user.username,
    role: user.role,
    full_name: user.full_name,
    must_change_password: user.must_change_password,
  });
}));

// Self-service change. Allowed even when must_change_password is true.
router.post('/api/auth/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!bcrypt.compareSync(current_password, req.user.password_hash)) {
    await appendAudit({ actor: req.user, action: 'auth.password_change_failed', entityType: 'user', entityId: req.user.id, ip: req.ip });
    return res.status(401).json({ error: 'Invalid current password' });
  }
  const updated = await setPassword(req.user.id, new_password, false);
  await appendAudit({ actor: req.user, action: 'auth.password_change', entityType: 'user', entityId: req.user.id, ip: req.ip });
  const token = sign(updated);
  setSessionCookie(res, token);
  res.json({ success: true, token });
}));

// Admin reset: generates a temporary password and forces a change on login.
router.post('/api/auth/reset-password', requireAuth, requirePermission('staff.write'), asyncHandler(async (req, res) => {
  const id = Number(req.body && req.body.user_id);
  const target = await findUserById(id);
  if (!target) return res.status(404).json({ error: 'Staff not found' });

  const temporary = crypto.randomBytes(12).toString('base64url');
  const updated = await setPassword(id, temporary, true);
  await appendAudit({
    actor: req.user, action: 'auth.password_reset', entityType: 'user', entityId: id, ip: req.ip,
  });
  res.json({ success: true, temporary_password: temporary, must_change_password: updated.must_change_password });
}));

router.post('/api/logout', requireAuth, asyncHandler(async (req, res) => {
  await revokeTokens(req.user.id);
  await appendAudit({ actor: req.user, action: 'auth.logout', entityType: 'user', entityId: req.user.id, ip: req.ip });
  res.clearCookie('cd_session', { path: '/', sameSite: 'lax', secure: NODE_ENV === 'production' });
  res.json({ success: true });
}));

module.exports = router;
