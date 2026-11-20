/** Dining tables: public menu data, staff QR codes, admin table management. */
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { select, insert, update } = require('../../lib/supabase');
const { BASE_URL } = require('../../config/env');
const { requireAuth, requirePermission } = require('../../auth/middleware');
const { appendAudit } = require('../../db/accounts');
const { asyncHandler } = require('../../utils/async');

const router = express.Router();
const adminTable = [requireAuth, requirePermission('table.write')];

function mapTable(t) {
  return {
    id: t.id,
    table_number: t.table_number,
    name: t.name,
    capacity: t.capacity ?? 4,
    active: t.active !== false,
    qr_token: t.qr_token || null,
  };
}

async function listTables(includeInactive = false) {
  const rows = await select('dining_tables', {}, 'id,table_number,name,capacity,qr_token,active', {
    order: 'table_number.asc',
  });
  return rows.map(mapTable).filter((t) => includeInactive || t.active);
}

function menuUrl(table) {
  return `${BASE_URL}/menu.html?table=${table.table_number}`;
}

async function qrDataUrl(table) {
  return QRCode.toDataURL(menuUrl(table), {
    width: 400,
    margin: 2,
    color: { dark: '#2c1810', light: '#ffffff' },
  });
}

router.get('/api/tables', asyncHandler(async (req, res) => {
  res.json(await listTables(req.query.includeInactive === 'true'));
}));

// Must be registered before /api/tables/:id/qr.
router.get('/api/tables/qr-sheet.pdf', ...adminTable, asyncHandler(async (req, res) => {
  const tables = await listTables();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="cupcake-table-qr-sheet.pdf"');

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);
  doc.fontSize(18).text('Cupcake Delights — Table QR Codes', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#666').text('Scan to open the menu and place an order', { align: 'center' });
  doc.moveDown(1).fillColor('#000');

  const cols = 3;
  const cellW = (doc.page.width - 80) / cols;
  const cellH = 165;
  let col = 0;
  let row = 0;
  let y = doc.y;

  for (const table of tables) {
    if (y + cellH > doc.page.height - 40) {
      doc.addPage();
      y = 50;
      col = 0;
      row = 0;
    }
    const x = 40 + col * cellW;
    doc.roundedRect(x + 4, y + 4, cellW - 8, cellH - 8, 6).stroke();
    const png = await QRCode.toBuffer(menuUrl(table), {
      type: 'png', width: 220, margin: 1,
      color: { dark: '#2c1810', light: '#ffffff' },
    });
    const size = 86;
    doc.image(png, x + (cellW - size) / 2, y + 12, { width: size, height: size });
    doc.fontSize(11).text(table.name || `Table ${table.table_number}`, x + 8, y + 108, {
      width: cellW - 16, align: 'center',
    });
    doc.fontSize(8).fillColor('#666').text(`Table #${table.table_number}`, x + 8, y + 126, {
      width: cellW - 16, align: 'center',
    });
    doc.fillColor('#000');

    col += 1;
    if (col >= cols) {
      col = 0;
      row += 1;
      y += cellH;
    }
  }
  doc.end();
}));

router.get('/api/tables/:id/qr', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await select('dining_tables', { id }, 'id,table_number,name,capacity,qr_token,active', { order: null });
  const table = rows[0] ? mapTable(rows[0]) : null;
  if (!table) return res.status(404).json({ error: 'Table not found' });
  const qr = await qrDataUrl(table);
  res.json({ qr, url: menuUrl(table), table });
}));

router.post('/api/tables', ...adminTable, asyncHandler(async (req, res) => {
  const tableNumber = Number(req.body?.table_number);
  if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
    return res.status(400).json({ error: 'Valid table_number required' });
  }
  const existing = await select('dining_tables', { table_number: tableNumber }, 'id', { order: null });
  if (existing.length) return res.status(400).json({ error: 'Table number already exists' });

  const capacity = Number(req.body?.capacity) || 4;
  const name = String(req.body?.name || `Table ${tableNumber}`).slice(0, 100);
  const qrToken = crypto.randomBytes(16).toString('hex');
  const created = await insert('dining_tables', {
    table_number: tableNumber, name, capacity, qr_token: qrToken, active: true,
  });
  const table = mapTable(created[0]);
  await appendAudit({
    actor: req.user, action: 'table.create', entityType: 'table', entityId: table.id,
    after: table, ip: req.ip,
  });
  res.json({ success: true, ...table });
}));

// Deactivate only — QR tokens and historical orders must remain resolvable.
router.post('/api/tables/:id/deactivate', ...adminTable, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await select('dining_tables', { id }, 'id,table_number,name,capacity,qr_token,active', { order: null });
  if (!rows.length) return res.status(404).json({ error: 'Table not found' });
  const before = mapTable(rows[0]);
  await update('dining_tables', id, { active: false });
  await appendAudit({
    actor: req.user, action: 'table.deactivate', entityType: 'table', entityId: id,
    before, after: { ...before, active: false }, ip: req.ip,
  });
  res.json({ success: true });
}));

module.exports = router;
