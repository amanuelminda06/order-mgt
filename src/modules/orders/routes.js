/**
 * Orders: placement, listing, live feed, status changes, deletion, tracking.
 *
 * LEGACY BEHAVIOUR PRESERVED (fixed in later steps):
 *   - POST /api/orders is unauthenticated and takes table_id from the client
 *   - PUT  /api/orders/:id/status accepts any status string, any role
 *   - GET  /api/track/:orderNumber returns the FULL order to anyone
 *   - DELETE is allowed for any authenticated role
 *   - order id = orders.length + 1 (collides after a delete)
 */
const express = require('express');
const { tables, menuItems, orders, amendments, generateOrderNumber } = require('../../db/memory-store');
const { requireAuth } = require('../../auth/middleware');
const { sendTelegram } = require('../../notifications/telegram');
const { now } = require('../../utils/time');

const router = express.Router();

router.post('/api/orders', async (req, res) => {
  const { table_id, items, type, special_notes } = req.body;
  if (!table_id || !items || items.length === 0) return res.status(400).json({ error: 'Table and items required' });

  const table = tables.find((t) => t.table_number === parseInt(table_id));
  if (!table) return res.status(404).json({ error: 'Table not found' });

  const orderNumber = generateOrderNumber();
  let total = 0;
  const orderItems = [];

  for (const item of items) {
    const menuItem = menuItems.find((m) => m.id === item.menu_item_id);
    if (menuItem) {
      total += menuItem.price * item.quantity;
      orderItems.push({
        menu_item_id: menuItem.id,
        name: menuItem.name,
        quantity: item.quantity,
        price: menuItem.price,
        notes: item.notes || '',
      });
    }
  }

  const order = {
    id: orders.length + 1,
    order_number: orderNumber,
    table_id: table.id,
    table_name: table.name,
    table_number: table.table_number,
    type: type || 'food',
    status: 'pending',
    total,
    items: orderItems,
    special_notes: special_notes || '',
    created_at: now(),
  };

  orders.push(order);

  const itemList = orderItems.map((i) => `  ${i.quantity}x ${i.name}`).join('\n');
  const emoji = type === 'bar' ? '🍸' : '🍽';
  const telegramMsg = `${emoji} <b>NEW ${type === 'bar' ? 'BAR' : 'FOOD'} ORDER</b>

📋 <b>${orderNumber}</b>
🪑 Table ${table.name} (#${table.table_number})
⏰ ${new Date().toLocaleTimeString()}
💰 <b>ETB ${total.toFixed(2)}</b>

<b>Items:</b>
${itemList}
${special_notes ? `\n📝 <i>${special_notes}</i>` : ''}`;

  await sendTelegram(telegramMsg);

  res.json({
    success: true,
    order_number: orderNumber,
    order_id: order.id,
    total: order.total,
    items: orderItems.map((i) => `${i.quantity}x ${i.name}`),
  });
});

router.get('/api/orders', requireAuth, (req, res) => {
  let result = [...orders].reverse();
  if (req.query.status && req.query.status !== 'all') result = result.filter((o) => o.status === req.query.status);
  if (req.query.type) result = result.filter((o) => o.type === req.query.type);
  res.json(result);
});

router.get('/api/orders/live', requireAuth, (req, res) => {
  let result = orders.filter((o) => ['pending', 'preparing'].includes(o.status)).reverse();
  if (req.query.role === 'bartender') result = result.filter((o) => o.type === 'bar');
  else if (req.query.role === 'waiter') result = result.filter((o) => o.type === 'food');
  res.json(result);
});

router.put('/api/orders/:id/status', requireAuth, async (req, res) => {
  const order = orders.find((o) => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = req.body.status;
  order.updated_at = now();
  if (order.status === 'ready') {
    await sendTelegram(`✅ Order <b>${order.order_number}</b> for Table ${order.table_name} is READY!`);
  }
  if (order.status === 'completed') {
    await sendTelegram(`🏁 Order <b>${order.order_number}</b> COMPLETED · Table ${order.table_name} · ETB ${order.total.toFixed(2)}`);
  }
  res.json({ success: true });
});

router.delete('/api/orders/:id', requireAuth, (req, res) => {
  const idx = orders.findIndex((o) => o.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });
  orders.splice(idx, 1);
  res.json({ success: true });
});

// Legacy full-detail public tracker — replaced by status-only in a later step.
router.get('/api/track/:orderNumber', (req, res) => {
  const order = orders.find((o) => o.order_number === req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const pendingAmendments = amendments.filter((a) => a.order_id === order.id && a.status === 'pending');
  res.json({ ...order, pending_amendments: pendingAmendments });
});

module.exports = router;
