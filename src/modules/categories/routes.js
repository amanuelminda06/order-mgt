/** Menu categories. Public read; admin writes. DB-backed and audited. */
const express = require('express');
const { requireAuth, requireAdmin } = require('../../auth/middleware');
const { select, insert, update, del } = require('../../lib/supabase');
const { appendAudit } = require('../../db/accounts');
const { asyncHandler } = require('../../utils/async');

const router = express.Router();

function toCategoryRow(c) {
  return {
    id: c.id,
    name: c.name,
    name_am: c.name_am || '',
    section: c.section === 'drink' ? 'bar' : c.section,
    sort_order: c.sort_order || 0,
    active: c.active !== false,
  };
}

function dbSection(section) {
  if (section === 'bar' || section === 'drink') return 'drink';
  if (section === 'food') return 'food';
  return null;
}

function audit(req, action, entityId, before = null, after = null) {
  return appendAudit({
    actor: req.user, action, entityType: 'category', entityId,
    before, after, ip: req.ip,
  });
}

router.get('/api/categories', asyncHandler(async (req, res) => {
  let rows = await select('menu_categories', {}, 'id,name,name_am,section,sort_order,active');
  if (req.query.section) {
    const wanted = dbSection(req.query.section) || req.query.section;
    rows = rows.filter((c) => c.section === wanted);
  }
  res.json(rows.map(toCategoryRow));
}));

router.post('/api/categories', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { name, section } = req.body || {};
  const sectionDb = dbSection(section);
  if (!name || !sectionDb) return res.status(400).json({ error: 'Name and section (food/drink) required' });

  const existing = await select('menu_categories', { name, section: sectionDb }, 'id', { order: null });
  if (existing.length) return res.status(400).json({ error: 'Category already exists in this section' });

  const data = {
    name: String(name).slice(0, 100),
    name_am: req.body.name_am || null,
    section: sectionDb,
    sort_order: Number(req.body.sort_order) || 0,
    active: true,
  };
  const created = await insert('menu_categories', data);
  await audit(req, 'category.create', created[0].id, null, data);
  res.json({ success: true, id: created[0].id });
}));

router.put('/api/categories/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await select('menu_categories', { id: req.params.id }, '*', { order: null });
  if (!rows.length) return res.status(404).json({ error: 'Category not found' });
  const data = {};

  if (req.body.name !== undefined) data.name = String(req.body.name).slice(0, 100);
  if (req.body.name_am !== undefined) data.name_am = req.body.name_am || null;
  if (req.body.sort_order !== undefined) data.sort_order = Number(req.body.sort_order) || 0;
  if (req.body.active !== undefined) data.active = req.body.active === true || req.body.active === 'true';
  if (req.body.section !== undefined) {
    const sectionDb = dbSection(req.body.section);
    if (!sectionDb) return res.status(400).json({ error: 'Section must be food or drink' });
    data.section = sectionDb;
  }

  if (!Object.keys(data).length) return res.json({ success: true });
  await update('menu_categories', req.params.id, data);
  await audit(req, 'category.update', req.params.id, rows[0], data);
  res.json({ success: true });
}));

router.delete('/api/categories/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await select('menu_categories', { id: req.params.id }, '*', { order: null });
  if (!rows.length) return res.status(404).json({ error: 'Category not found' });
  const items = await select('menu_items', { category_id: req.params.id }, 'id', { order: null });
  if (items.length) {
    return res.status(409).json({ error: 'Category still has menu items' });
  }
  await del('menu_categories', req.params.id);
  await audit(req, 'category.delete', req.params.id, rows[0], null);
  res.json({ success: true });
}));

module.exports = router;
