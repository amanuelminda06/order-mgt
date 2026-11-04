/** Tables + QR codes. Public reads (legacy behaviour). */
const express = require('express');
const QRCode = require('qrcode');
const { tables } = require('../../db/memory-store');
const { BASE_URL } = require('../../config/env');

const router = express.Router();

router.get('/api/tables', (req, res) => res.json(tables));

router.get('/api/tables/:id/qr', async (req, res) => {
  const table = tables.find((t) => t.id === parseInt(req.params.id));
  if (!table) return res.status(404).json({ error: 'Table not found' });
  const url = `${BASE_URL}/menu.html?table=${table.table_number}`;
  try {
    const qr = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: '#2c1810', light: '#ffffff' },
    });
    res.json({ qr, url, table });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
