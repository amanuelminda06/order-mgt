/**
 * Simplified orders API (Step 4).
 *
 *   POST /api/orders          public placement, DB-priced, one transaction
 *   GET  /api/orders          staff list (all three roles)
 *   GET  /api/orders/live     staff live feed (uncancelled, newest first)
 *   POST /api/orders/:id/cancel  staff cancel with mandatory reason
 *   GET  /api/receipt/:token  public, token-only receipt
 *
 * There is deliberately no status flow, amendment flow, customer edit, or
 * order deletion. The random public_token is the only public lookup key.
 */
const express = require('express');
const { requireAuth, requirePermission } = require('../../auth/middleware');
const { appendAudit } = require('../../db/accounts');
const { orderingEnabled } = require('../../db/settings');
const {
  placeOrder, listOrders, getReceipt, cancelOrder, getOrder, rpcErrorStatus,
} = require('../../db/orders');
const { sendTelegram } = require('../../notifications/telegram');
const { asyncHandler } = require('../../utils/async');

const router = express.Router();

function cleanItems(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.map((item) => ({
    menu_item_id: Number(item.menu_item_id),
    quantity: Number(item.quantity),
    notes: typeof item.notes === 'string' ? item.notes.slice(0, 500) : null,
  }));
}

router.post('/api/orders', asyncHandler(async (req, res) => {
  const items = cleanItems(req.body && req.body.items);
  if (!req.body || !req.body.table_id || !items) {
    return res.status(400).json({ error: 'Table and items required' });
  }
  if (items.some((i) => !Number.isInteger(i.menu_item_id) || !Number.isInteger(i.quantity))) {
    return res.status(400).json({ error: 'Invalid item' });
  }

  let enabled;
  try {
    enabled = await orderingEnabled();
  } catch (e) {
    return res.status(500).json({ error: 'Unable to check ordering setting' });
  }
  if (!enabled) return res.status(409).json({ error: 'Ordering is currently disabled' });

  let order;
  try {
    order = await placeOrder({
      table_id: req.body.table_id,
      items,
      special_notes: typeof req.body.special_notes === 'string' ? req.body.special_notes.slice(0, 1000) : null,
    });
  } catch (e) {
    return res.status(rpcErrorStatus(e.message)).json({ error: e.message });
  }

  await appendAudit({
    actor: null,
    action: 'order.place',
    entityType: 'order',
    entityId: order.order_no,
    after: { order_no: order.order_no, total: order.total, table_id: req.body.table_id },
    ip: req.ip,
  });

  // Order is already committed. On Vercel serverless the runtime can freeze
  // after the response, so await delivery (sendTelegram swallows its own errors).
  const lines = order.items.map((i) => `  ${i.quantity}x ${i.name}`).join('\n');
  await sendTelegram(`🍽 <b>NEW ORDER</b>\n\n📋 <b>${order.order_no}</b>\n💰 ETB ${order.total}\n\n<b>Items:</b>\n${lines}`)
    .catch(() => {});

  res.json(order);
}));

router.get('/api/orders', requireAuth, asyncHandler(async (req, res) => {
  const orders = await listOrders({ limit: 200 });
  if (req.query.cancelled === 'false' || req.query.uncancelled === 'true') {
    return res.json(orders.filter((o) => !o.cancelled));
  }
  res.json(orders);
}));

router.get('/api/orders/live', requireAuth, asyncHandler(async (req, res) => {
  const orders = await listOrders({ limit: 100 });
  res.json(orders.filter((o) => !o.cancelled));
}));

router.post('/api/orders/:id/cancel', requireAuth, requirePermission('order.cancel'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!Number.isInteger(id) || !reason) return res.status(400).json({ error: 'Cancellation reason required' });

  const existing = await getOrder(id);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (existing.cancelled) return res.status(409).json({ error: 'Order already cancelled' });

  const updated = await cancelOrder(id, reason, req.user.id);
  await appendAudit({
    actor: req.user,
    action: 'order.cancel',
    entityType: 'order',
    entityId: existing.order_no,
    before: { cancelled: false },
    after: { cancelled: true, reason },
    ip: req.ip,
  });
  res.json({ success: true, order: updated });
}));

// Token-only. Never accept or require an order number here.
router.get('/api/receipt/:token', asyncHandler(async (req, res) => {
  const receipt = await getReceipt(req.params.token);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
  res.json(receipt);
}));

module.exports = router;
