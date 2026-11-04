/** Menu items. Public read; admin-only writes (legacy behaviour). */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { menuItems } = require('../../db/memory-store');
const { requireAuth, requireAdmin } = require('../../auth/middleware');

const router = express.Router();

// Menu photos are sent as base64 data URLs from the admin form and written to
// public/uploads/menu, which express.static already serves.
const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'public', 'uploads', 'menu');
const UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// POST /api/menu/images — admin only. Returns the public path to store on an item.
router.post('/api/menu/images', requireAuth, requireAdmin, (req, res) => {
  const { name, dataUrl } = req.body || {};
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) return res.status(400).json({ error: 'Expected a base64 image data URL' });
  const ext = UPLOAD_TYPES[match[1].toLowerCase()];
  if (!ext) return res.status(400).json({ error: 'Unsupported image type — use JPG, PNG, WebP or GIF' });
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return res.status(400).json({ error: 'Image is empty' });
  if (buffer.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Image is larger than 5 MB' });

  const base = String(name || 'item')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item';
  const filename = `${base}-${Date.now()}.${ext}`;
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  } catch (e) {
    return res.status(500).json({ error: 'Could not save image' });
  }
  res.json({ success: true, url: `/uploads/menu/${filename}` });
});

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
