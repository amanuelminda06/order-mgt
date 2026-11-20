/** Analytics: admin only, computed from committed DB orders. */
const express = require('express');
const { requireAuth, requireAdmin } = require('../../auth/middleware');
const { listOrders } = require('../../db/orders');
const { toCents, fromCents } = require('../../utils/money');
const { asyncHandler } = require('../../utils/async');

const router = express.Router();

router.get('/api/analytics', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const period = req.query.period || 'today';
  const since = new Date();
  if (period === 'week') since.setDate(since.getDate() - 7);
  else if (period === 'month') since.setMonth(since.getMonth() - 1);
  else since.setHours(0, 0, 0, 0);

  const orders = (await listOrders({ limit: 1000 }))
    .filter((o) => new Date(o.created_at) >= since);

  let revenueCents = 0;
  const itemCounts = {};
  const hourly = {};
  for (const order of orders) {
    revenueCents += toCents(order.total);
    hourly[new Date(order.created_at).getHours()] = (hourly[new Date(order.created_at).getHours()] || 0) + 1;
    for (const item of order.items) {
      itemCounts[item.name] = (itemCounts[item.name] || 0) + item.quantity;
    }
  }

  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  res.json({
    totalOrders: orders.length,
    totalRevenue: fromCents(revenueCents),
    foodRevenue: fromCents(revenueCents),
    barRevenue: '0.00',
    foodOrdersCount: orders.length,
    barOrdersCount: 0,
    topItems,
    hourlyData: hourly,
    avgOrderValue: orders.length ? fromCents(Math.round(revenueCents / orders.length)) : '0.00',
    period,
  });
}));

module.exports = router;
