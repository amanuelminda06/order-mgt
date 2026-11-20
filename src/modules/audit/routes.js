/** Audit log read — admin only. The table itself is append-only. */
const express = require('express');
const { listAudit } = require('../../db/accounts');
const { requireAuth, requirePermission } = require('../../auth/middleware');
const { asyncHandler } = require('../../utils/async');

const router = express.Router();

router.get('/api/audit', requireAuth, requirePermission('audit.read'), asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  res.json(await listAudit(limit));
}));

module.exports = router;
