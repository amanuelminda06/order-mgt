/** Menu categories. Public read; admin-only writes (legacy behaviour). */
const express = require('express');
const { categories, counters } = require('../../db/memory-store');
const { requireAuth, requireAdmin } = require('../../auth/middleware');

const router = express.Router();

router.get('/api/categories', (req, res) => {
  let result = [...categories];
  if (req.query.section) result = result.filter((c) => c.section === req.query.section);
  res.json(result);
});

router.post('/api/categories', requireAuth, requireAdmin, (req, res) => {
  const { name, section } = req.body;
  if (!name || !section) return res.status(400).json({ error: 'Name and section required' });
  if (!['food', 'bar'].includes(section)) return res.status(400).json({ error: 'Section must be food or bar' });
  if (categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.section === section)) {
    return res.status(400).json({ error: 'Category already exists in this section' });
  }
  counters.categoryId++;
  categories.push({ id: counters.categoryId, name, section });
  res.json({ success: true, id: counters.categoryId });
});

router.put('/api/categories/:id', requireAuth, requireAdmin, (req, res) => {
  const cat = categories.find((c) => c.id === parseInt(req.params.id));
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const { name, section } = req.body;
  if (name !== undefined) cat.name = name;
  if (section !== undefined) {
    if (!['food', 'bar'].includes(section)) return res.status(400).json({ error: 'Section must be food or bar' });
    cat.section = section;
  }
  res.json({ success: true });
});

router.delete('/api/categories/:id', requireAuth, requireAdmin, (req, res) => {
  const idx = categories.findIndex((c) => c.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Category not found' });
  categories.splice(idx, 1);
  res.json({ success: true });
});

module.exports = router;
