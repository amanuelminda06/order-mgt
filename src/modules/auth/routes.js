/** POST /api/login — public. */
const express = require('express');
const bcrypt = require('bcryptjs');
const { staff } = require('../../db/memory-store');

const router = express.Router();

router.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = staff.find((s) => s.username === username && s.active);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({
    success: true,
    token: Buffer.from(`${username}:${Date.now()}`).toString('base64'),
    username: user.username,
    role: user.role,
    full_name: user.full_name,
  });
});

module.exports = router;
