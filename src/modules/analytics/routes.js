/** Analytics. Admin only (legacy behaviour). */
const express = require('express');
const { orders } = require('../../db/memory-store');
const { requireAuth, requireAdmin } = require('../../auth/middleware');

const router = express.Router();

router.get('/api/analytics', requireAuth, requireAdmin, (req, res) => {
  const period = req.query.period || 'today';
  let dateFilter = new Date();
  if (period === 'week') dateFilter.setDate(dateFilter.getDate() - 7);
  else if (period === 'month') dateFilter.setMonth(dateFilter.getMonth() - 1);
  else dateFilter.setHours(0, 0, 0, 0);

  const filtered = orders.filter((o) => new Date(o.created_at) >= dateFilter);
  const totalOrders = filtered.length;
  const totalRevenue = filtered.reduce((s, o) => s + o.total, 0);
  const foodOrders = filtered.filter((o) => o.type === 'food');
  const barOrders = filtered.filter((o) => o.type === 'bar');
  const foodRevenue = foodOrders.reduce((s, o) => s + o.total, 0);
  const barRevenue = barOrders.reduce((s, o) => s + o.total, 0);

  const itemCounts = {};
  filtered.forEach((o) => o.items.forEach((i) => { itemCounts[i.name] = (itemCounts[i.name] || 0) + i.quantity; }));
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const hourlyData = {};
  filtered.forEach((o) => {
    const h = new Date(o.created_at).getHours();
    hourlyData[h] = (hourlyData[h] || 0) + 1;
  });

  const completed = filtered.filter((o) => o.status === 'completed');
  const avgOrderValue = completed.length > 0 ? completed.reduce((s, o) => s + o.total, 0) / completed.length : 0;

  res.json({
    totalOrders,
    totalRevenue: totalRevenue.toFixed(2),
    foodRevenue: foodRevenue.toFixed(2),
    barRevenue: barRevenue.toFixed(2),
    foodOrdersCount: foodOrders.length,
    barOrdersCount: barOrders.length,
    topItems,
    hourlyData,
    avgOrderValue: avgOrderValue.toFixed(2),
    period,
  });
});

module.exports = router;
