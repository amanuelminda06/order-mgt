/** Staff user management. Admin only, DB-backed and audited. */
const express = require('express');
const { listUsers, createUser, updateUser, appendAudit } = require('../../db/accounts');
const { requireAuth, requirePermission } = require('../../auth/middleware');
const { ROLES } = require('../../auth/permissions');
const { asyncHandler } = require('../../utils/async');

const router = express.Router();
const adminOnly = [requireAuth, requirePermission('staff.write')];

function publicUser(u) {
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: u.active };
}

router.get('/api/staff', ...adminOnly, asyncHandler(async (req, res) => {
  res.json((await listUsers()).map(publicUser));
}));

router.post('/api/staff', ...adminOnly, asyncHandler(async (req, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'All fields required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if ((await listUsers()).some((u) => u.username === username)) {
    return res.status(400).json({ error: 'Username exists' });
  }
  const user = await createUser({ username, password, full_name, role });
  await appendAudit({
    actor: req.user, action: 'user.create', entityType: 'user', entityId: user.id,
    after: publicUser(user), ip: req.ip,
  });
  res.json({ success: true });
}));

router.put('/api/staff/:id', ...adminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = (await listUsers()).find((u) => u.id === id);
  if (!existing) return res.status(404).json({ error: 'Staff not found' });

  const { full_name, role, active, password } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (password !== undefined && String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const changes = {};
  if (full_name !== undefined) changes.full_name = full_name;
  if (role !== undefined) changes.role = role;
  if (active !== undefined) changes.active = active;
  if (password !== undefined) changes.password = password;

  const updated = await updateUser(id, changes);
  await appendAudit({
    actor: req.user, action: 'user.update', entityType: 'user', entityId: id,
    before: publicUser(existing), after: publicUser(updated), ip: req.ip,
  });
  res.json({ success: true });
}));

module.exports = router;
