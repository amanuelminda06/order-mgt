/** Restaurant settings: public read, admin writes, admin/cashier ordering toggle. */
const express = require('express');
const { requireAuth, requirePermission } = require('../../auth/middleware');
const { getSettings, setSetting } = require('../../db/settings');
const { appendAudit } = require('../../db/accounts');
const { asyncHandler } = require('../../utils/async');

const router = express.Router();

router.get('/api/settings', asyncHandler(async (req, res) => {
  res.json(await getSettings());
}));

router.put('/api/settings/ordering', requireAuth, requirePermission('ordering.toggle'), asyncHandler(async (req, res) => {
  const enabled = req.body?.enabled === true || req.body?.enabled === 'true';
  const before = await getSettings();
  await setSetting('ordering_enabled', enabled);
  await appendAudit({
    actor: req.user,
    action: 'ordering.toggle',
    entityType: 'settings',
    entityId: 'ordering_enabled',
    before: { ordering_enabled: before.ordering_enabled },
    after: { ordering_enabled: enabled },
    ip: req.ip,
  });
  res.json({ success: true, ordering_enabled: enabled });
}));

router.put('/api/settings', requireAuth, requirePermission('settings.write'), asyncHandler(async (req, res) => {
  const { key, value } = req.body || {};
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'Setting key required' });
  if (value === undefined) return res.status(400).json({ error: 'Setting value required' });

  const before = await getSettings();
  await setSetting(key, value);
  await appendAudit({
    actor: req.user,
    action: 'settings.update',
    entityType: 'settings',
    entityId: key,
    before: { [key]: before[key] ?? null },
    after: { [key]: value },
    ip: req.ip,
  });
  res.json({ success: true, key, value });
}));

module.exports = router;
