/** Staff user management. Admin only (legacy behaviour). */
const express = require('express');
const bcrypt = require('bcryptjs');
const { staff } = require('../../db/memory-store');
const { requireAuth, requireAdmin } = require('../../auth/middleware');

const router = express.Router();

router.get('/api/staff', requireAuth, requireAdmin, (req, res) => {
  res.json(
    staff.map((s) => ({ id: s.id, username: s.username, full_name: s.full_name, role: s.role, active: s.active }))
  );
});

router.post('/api/staff', requireAuth, requireAdmin, (req, res) => {
  const { username, password, full_name, role } = req.body;
  if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'All fields required' });
  if (staff.find((s) => s.username === username)) return res.status(400).json({ error: 'Username exists' });
  const id = Math.max(...staff.map((s) => s.id), 0) + 1;
  staff.push({ id, username, password: bcrypt.hashSync(password, 10), full_name, role, active: true });
  res.json({ success: true });
});

router.put('/api/staff/:id', requireAuth, requireAdmin, (req, res) => {
  const user = staff.find((s) => s.id === parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'Staff not found' });
  const { full_name, role, active, password } = req.body;
  if (full_name !== undefined) user.full_name = full_name;
  if (role !== undefined) user.role = role;
  if (active !== undefined) user.active = active;
  if (password) user.password = bcrypt.hashSync(password, 10);
  res.json({ success: true });
});

module.exports = router;
