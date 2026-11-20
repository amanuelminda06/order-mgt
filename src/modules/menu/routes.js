/** Menu items. Public read; admin writes. DB-backed and audited. */
const express = require('express');
const { requireAuth, requireAdmin } = require('../../auth/middleware');
const { select, insert, update, del, upload } = require('../../lib/supabase');
const { appendAudit } = require('../../db/accounts');
const { toCents } = require('../../utils/money');
const { asyncHandler } = require('../../utils/async');
const { SUPABASE_URL } = require('../../config/env');

const router = express.Router();

const UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const BUCKETS = ['menu-items', 'logo', 'hero'];

function toItemRow(item) {
  const cat = item.menu_categories || {};
  const section = cat.section || 'food';
  return {
    id: item.id,
    category_id: item.category_id,
    name: item.name,
    name_am: item.name_am || '',
    description: item.description || '',
    description_am: item.description_am || '',
    price: String(item.price ?? '0'),
    category: section === 'drink' ? 'bar' : 'food',
    subcategory: cat.name || '',
    available: item.available === true,
    image: item.image_path || '',
    image_path: item.image_path || '',
    sort_order: item.sort_order || 0,
  };
}

function validPrice(value) {
  try {
    const cents = toCents(String(value));
    return cents >= 0 && /^\d+(\.\d{1,2})?$/.test(String(value).trim());
  } catch (_) {
    return false;
  }
}

async function categoryIdFor(section, name) {
  if (!name) return null;
  const cats = await select('menu_categories', { name, section }, 'id', { order: null });
  return cats[0]?.id ?? null;
}

function audit(req, action, entityId, before = null, after = null) {
  return appendAudit({
    actor: req.user, action, entityType: 'menu_item', entityId,
    before, after, ip: req.ip,
  });
}

router.get('/api/menu', asyncHandler(async (req, res) => {
  let rows = await select('menu_items', {}, '*, menu_categories(name, section)');
  let items = rows.map(toItemRow);
  if (req.query.category) items = items.filter((i) => i.category === req.query.category);
  if (req.query.available === 'true') items = items.filter((i) => i.available);
  res.json(items);
}));

router.post('/api/menu', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, price, category, subcategory, image } = req.body || {};
  if (!name || !validPrice(price)) {
    return res.status(400).json({ error: 'Name and a non-negative price with at most 2 decimals required' });
  }
  const section = category === 'bar' ? 'drink' : 'food';
  const categoryId = await categoryIdFor(section, subcategory);
  if (!categoryId) return res.status(400).json({ error: `Category '${subcategory}' not found in ${section}` });

  const data = {
    name: String(name).slice(0, 200),
    name_am: req.body.name_am || null,
    description: description || '',
    description_am: req.body.description_am || null,
    category_id: categoryId,
    price: String(price),
    available: true,
    image_path: image || null,
    sort_order: Number(req.body.sort_order) || 0,
  };
  const created = await insert('menu_items', data);
  await audit(req, 'menu.create', created[0].id, null, data);
  res.json({ success: true, id: created[0].id });
}));

router.put('/api/menu/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await select('menu_items', { id: req.params.id }, '*, menu_categories(name, section)', { order: null });
  if (!rows.length) return res.status(404).json({ error: 'Item not found' });
  const current = rows[0];
  const before = toItemRow(current);
  const data = {};

  if (req.body.name !== undefined) data.name = String(req.body.name).slice(0, 200);
  if (req.body.name_am !== undefined) data.name_am = req.body.name_am || null;
  if (req.body.description !== undefined) data.description = req.body.description;
  if (req.body.description_am !== undefined) data.description_am = req.body.description_am || null;
  if (req.body.price !== undefined) {
    if (!validPrice(req.body.price)) {
      return res.status(400).json({ error: 'Invalid price' });
    }
    data.price = String(req.body.price);
  }
  if (req.body.available !== undefined) data.available = req.body.available === true || req.body.available === 'true';
  if (req.body.image !== undefined) data.image_path = req.body.image || null;
  if (req.body.image_path !== undefined) data.image_path = req.body.image_path || null;
  if (req.body.sort_order !== undefined) data.sort_order = Number(req.body.sort_order) || 0;

  if (req.body.category !== undefined || req.body.subcategory !== undefined) {
    const currentSection = current.menu_categories?.section === 'drink' ? 'bar' : 'food';
    const section = (req.body.category ?? currentSection) === 'bar' ? 'drink' : 'food';
    const catName = req.body.subcategory ?? current.menu_categories?.name;
    const categoryId = await categoryIdFor(section, catName);
    if (!categoryId) return res.status(400).json({ error: `Category '${catName}' not found in ${section}` });
    data.category_id = categoryId;
  }

  if (!Object.keys(data).length) return res.json({ success: true });
  await update('menu_items', req.params.id, data);
  await audit(req, 'menu.update', req.params.id, before, data);
  res.json({ success: true });
}));

router.patch('/api/menu/:id/availability', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await select('menu_items', { id: req.params.id }, 'id,available', { order: null });
  if (!rows.length) return res.status(404).json({ error: 'Item not found' });
  const available = req.body?.available === true || req.body?.available === 'true';
  await update('menu_items', req.params.id, { available });
  await audit(req, 'menu.availability', req.params.id, { available: rows[0].available }, { available });
  res.json({ success: true });
}));

router.delete('/api/menu/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await select('menu_items', { id: req.params.id }, '*', { order: null });
  if (!rows.length) return res.status(404).json({ error: 'Item not found' });
  await del('menu_items', req.params.id);
  await audit(req, 'menu.delete', req.params.id, rows[0], null);
  res.json({ success: true });
}));

router.post('/api/menu/images', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { name, dataUrl, bucket = 'menu-items' } = req.body || {};
  if (!BUCKETS.includes(bucket)) return res.status(400).json({ error: 'Invalid upload bucket' });
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) return res.status(400).json({ error: 'Expected a base64 image data URL' });
  const ext = UPLOAD_TYPES[match[1].toLowerCase()];
  if (!ext) return res.status(400).json({ error: 'Unsupported image type — use JPG, PNG, WebP or GIF' });
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return res.status(400).json({ error: 'Image is empty' });
  if (buffer.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Image is larger than 5 MB' });

  const base = String(name || 'image')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image';
  const filename = `${base}-${Date.now()}.${ext}`;

  await upload(bucket, filename, buffer, match[1]);
  await appendAudit({
    actor: req.user, action: 'upload.' + bucket, entityType: 'upload', entityId: filename,
    after: { bucket, path: filename }, ip: req.ip,
  });
  res.json({
    success: true,
    path: filename,
    url: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filename}`,
  });
}));

module.exports = router;
