/** Menu categories. Public read; admin-only writes. Backed by Supabase. */
const express = require('express');
const { requireAuth, requireAdmin } = require('../../auth/middleware');
const { select, insert, update, del } = require('../../lib/supabase');

const router = express.Router();

/**
 * Map a Supabase category row to the legacy API shape:
 * { id, name, section }
 */
function toCategoryRow(c) {
  return { id: c.id, name: c.name, section: c.section };
}

router.get('/api/categories', async (req, res) => {
  try {
    let rows = await select('menu_categories', {}, 'id,name,section');
    if (req.query.section) rows = rows.filter((c) => c.section === req.query.section);
    res.json(rows.map(toCategoryRow));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/categories', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, section } = req.body;
    if (!name || !section) return res.status(400).json({ error: 'Name and section required' });
    if (!['food', 'drink'].includes(section)) return res.status(400).json({ error: 'Section must be food or drink' });
    const existing = await select('menu_categories', { name, section }, 'id');
    if (existing.length) return res.status(400).json({ error: 'Category already exists in this section' });
    const created = await insert('menu_categories', { name, section, active: true });
    res.json({ success: true, id: created[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/categories/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cat = await select('menu_categories', { id: req.params.id }, 'id');
    if (!cat.length) return res.status(404).json({ error: 'Category not found' });
    const { name, section } = req.body;
    if (name !== undefined) {
      if (section !== undefined && !['food', 'drink'].includes(section)) {
        return res.status(400).json({ error: 'Section must be food or drink' });
      }
    }
    await update('menu_categories', req.params.id, { name, section });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/categories/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cat = await select('menu_categories', { id: req.params.id }, 'id');
    if (!cat.length) return res.status(404).json({ error: 'Category not found' });
    await del('menu_categories', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
