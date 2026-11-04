/**
 * Amendment (edit/cancel) requests — LEGACY, SCHEDULED FOR REMOVAL.
 *
 * The final spec deletes amendments entirely (no table, no endpoints, no UI)
 * and replaces them with a direct cancel flow. This module is kept only so
 * the file-split step changes nothing; delete it in the "remove amendments"
 * step together with the admin/menu UI that calls it.
 */
const express = require('express');
const { orders, amendments, counters } = require('../../db/memory-store');
const { requireAuth } = require('../../auth/middleware');
const { sendTelegram } = require('../../notifications/telegram');
const { now } = require('../../utils/time');

const router = express.Router();

router.post('/api/amendments', async (req, res) => {
  const { order_number, type, message } = req.body;
  if (!order_number || !type || !message) {
    return res.status(400).json({ error: 'Order number, type, and message required' });
  }
  const order = orders.find((o) => o.order_number === order_number);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'completed' || order.status === 'cancelled') {
    return res.status(400).json({ error: 'Cannot amend a completed or cancelled order' });
  }
  const pending = amendments.find((a) => a.order_id === order.id && a.status === 'pending');
  if (pending) return res.status(400).json({ error: 'You already have a pending request for this order' });

  counters.amendmentId++;
  const amendment = {
    id: counters.amendmentId,
    order_id: order.id,
    order_number: order.order_number,
    type,
    message,
    status: 'pending',
    created_at: now(),
  };
  amendments.push(amendment);

  const emoji = type === 'cancel' ? '❌' : '✏️';
  await sendTelegram(
    `${emoji} <b>AMENDMENT REQUEST</b>\n\n📋 Order: <b>${order.order_number}</b>\n🪑 Table: ${order.table_name}\n📌 Type: ${type.toUpperCase()}\n💬 ${message}`
  );

  res.json({ success: true, amendment_id: amendment.id });
});

router.get('/api/amendments', requireAuth, (req, res) => {
  let result = [...amendments].reverse();
  if (req.query.status) result = result.filter((a) => a.status === req.query.status);
  res.json(result);
});

router.put('/api/amendments/:id', requireAuth, async (req, res) => {
  const amendment = amendments.find((a) => a.id === parseInt(req.params.id));
  if (!amendment) return res.status(404).json({ error: 'Amendment not found' });
  const { status } = req.body;
  if (!['approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Status must be approved or denied' });
  amendment.status = status;
  amendment.resolved_at = now();

  const order = orders.find((o) => o.id === amendment.order_id);
  if (status === 'approved') {
    if (amendment.type === 'cancel' && order) {
      order.status = 'cancelled';
      order.updated_at = now();
      await sendTelegram(`❌ Order <b>${order.order_number}</b> has been CANCELLED per customer request.`);
    } else {
      await sendTelegram(`✅ Amendment APPROVED for Order <b>${amendment.order_number}</b> (${amendment.type}).`);
    }
  } else {
    await sendTelegram(`🚫 Amendment DENIED for Order <b>${amendment.order_number}</b> (${amendment.type}).`);
  }

  res.json({ success: true });
});

module.exports = router;
