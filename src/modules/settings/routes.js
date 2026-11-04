/** Settings. Public read; admin-only write (legacy behaviour). */
const express = require('express');
const { settings } = require('../../db/memory-store');
const { requireAuth, requireAdmin } = require('../../auth/middleware');

const router = express.Router();

router.get('/api/settings', (req, res) => res.json(settings));

router.put('/api/settings', requireAuth, requireAdmin, (req, res) => {
  settings[req.body.key] = req.body.value;
  res.json({ success: true });
});

module.exports = router;
