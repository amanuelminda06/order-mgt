/** Menu items. Public read; admin-only writes (legacy behaviour). */
const express = require('express');
const { menuItems } = require('../../db/memory-store');
const { requireAuth, requireAdmin } = require('../../auth/middleware');

const router = express.Router();

router.get('/api/menu', (req, res) => {
  let items = [...menuItems];
  if (req.query.category) items = items.filter((i) => i.category === req.query.category);
  if (req.query.available === 'true') items = items.filter((i) => i.available);
  res.json(items);
});

router.post('/api/menu', requireAuth, requireAdmin, (req, res) => {
  const { name, description, price, category, subcategory, image } = req.body;
  if (!name || !price || !category) return res.status(400).json({ error: 'Name, price, and category required' });
  const id = Math.max(...menuItems.map((i) => i.id), 0) + 1;
  menuItems.push({
    id,
    name,
    description: description || '',
    price: parseFloat(price),
    category,
    subcategory: subcategory || '',
    available: true,
    image: image || '',
  });
  res.json({ success: true, id });
});

router.put('/api/menu/:id', requireAuth, requireAdmin, (req, res) => {
  const item = menuItems.find((i) => i.id === parseInt(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const { name, description, price, category, subcategory, available, image } = req.body;
  if (name !== undefined) item.name = name;
  if (description !== undefined) item.description = description;
  if (price !== undefined) item.price = parseFloat(price);
  if (category !== undefined) item.category = category;
  if (subcategory !== undefined) item.subcategory = subcategory;
  if (available !== undefined) item.available = available === 'true' || available === true;
  if (image !== undefined) item.image = image;
  res.json({ success: true });
});

router.delete('/api/menu/:id', requireAuth, requireAdmin, (req, res) => {
  const idx = menuItems.findIndex((i) => i.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  menuItems.splice(idx, 1);
  res.json({ success: true });
});

router.patch('/api/menu/:id/availability', requireAuth, requireAdmin, (req, res) => {
  const item = menuItems.find((i) => i.id === parseInt(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  item.available = req.body.available;
  res.json({ success: true });
});

module.exports = router;
