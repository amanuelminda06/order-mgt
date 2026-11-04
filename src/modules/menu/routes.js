/** Menu items. Public read; admin-only writes. Backed by Supabase. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth, requireAdmin } = require('../../auth/middleware');
const { select, insert, update, del, upload } = require('../../lib/supabase');

const router = express.Router();

// Menu photos are sent as base64 data URLs from the admin form and uploaded to
// the Supabase `menu-items` storage bucket, which is public.
const UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Map a Supabase menu_items row (joined with menu_categories) to the legacy
 * API shape: { id, name, description, price, category, subcategory, available, image }
 */
function toItemRow(item) {
  const cat = item.menu_categories || {};
  const section = cat.section || 'food';
  return {
    id: item.id,
    name: item.name,
    description: item.description || '',
    price: parseFloat(item.price || 0),
    category: section === 'drink' ? 'bar' : 'food',
    subcategory: cat.name || '',
    available: item.available === true,
    image: item.image_path || '',
    sort_order: item.sort_order || 0,
  };
}

router.get('/api/menu', async (req, res) => {
  try {
    let rows = await select('menu_items', {}, '*, menu_categories(name, section)');
    let items = rows.map(toItemRow);
    if (req.query.category) items = items.filter((i) => i.category === req.query.category);
    if (req.query.available === 'true') items = items.filter((i) => i.available);
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/menu', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, price, category, subcategory, image } = req.body;
    if (!name || !price || !category) return res.status(400).json({ error: 'Name, price, and category required' });

    // Resolve category_id from menu_categories by name + section
    const section = category === 'bar' ? 'drink' : 'food';
    const cats = await select('menu_categories', { name: subcategory, section }, 'id');
    if (!cats.length) return res.status(400).json({ error: `Category '${subcategory}' not found in ${section}` });

    const created = await insert('menu_items', {
      name,
      description: description || '',
      category_id: cats[0].id,
      price: parseFloat(price),
      available: true,
      image_path: image || '',
    });
    res.json({ success: true, id: created[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/menu/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await select('menu_items', { id: req.params.id }, 'id');
    if (!existing.length) return res.status(404).json({ error: 'Item not found' });

    const { name, description, price, category, subcategory, available, image } = req.body;
    const data = {};

    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (price !== undefined) data.price = parseFloat(price);
    if (available !== undefined) data.available = available === 'true' || available === true;
    if (image !== undefined) data.image_path = image;

    if (category !== undefined || subcategory !== undefined) {
      const section = (category !== undefined ? category : 'food') === 'bar' ? 'drink' : 'food';
      const catName = subcategory !== undefined ? subcategory : null;
      // Fetch current item to get category name if not provided
      const current = await select('menu_items', { id: req.params.id }, '*, menu_categories(name, section)');
      const finalCatName = catName || (current[0]?.menu_categories?.name || '');
      const cats = await select('menu_categories', { name: finalCatName, section }, 'id');
      if (!cats.length) return res.status(400).json({ error: `Category '${finalCatName}' not found in ${section}` });
      data.category_id = cats[0].id;
    }

    await update('menu_items', req.params.id, data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/menu/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await select('menu_items', { id: req.params.id }, 'id');
    if (!existing.length) return res.status(404).json({ error: 'Item not found' });
    await del('menu_items', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/api/menu/:id/availability', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await select('menu_items', { id: req.params.id }, 'id');
    if (!existing.length) return res.status(404).json({ error: 'Item not found' });
    await update('menu_items', req.params.id, { available: req.body.available });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/menu/images — admin only. Uploads to Supabase `menu-items` bucket.
router.post('/api/menu/images', requireAuth, requireAdmin, async (req, res) => {
  try {
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

    const url = await upload('menu-items', filename, buffer, match[1]);
    res.json({ success: true, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
