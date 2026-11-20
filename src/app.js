/**
 * Application factory.
 *
 * Middleware and routers are registered in exactly the order the original
 * single-file server.js used them, so matching behaviour is unchanged:
 * static files win over page routes, and the catch-all redirect is last.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./modules/auth/routes');
const tableRoutes = require('./modules/tables/routes');
const menuRoutes = require('./modules/menu/routes');
const categoryRoutes = require('./modules/categories/routes');
const orderRoutes = require('./modules/orders/routes');
const userRoutes = require('./modules/users/routes');
const analyticsRoutes = require('./modules/analytics/routes');
const settingsRoutes = require('./modules/settings/routes');
const auditRoutes = require('./modules/audit/routes');
const pageRoutes = require('./modules/pages/routes');

function createApp() {
  const app = express();

  app.use(cors());
  // Menu photos arrive as base64 data URLs, so the JSON body can exceed the
  // 100kb default (5 MB image ≈ 6.7 MB encoded).
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Order matters: pages router carries the catch-all, so it goes last.
  app.use(authRoutes);
  app.use(tableRoutes);
  app.use(menuRoutes);
  app.use(categoryRoutes);
  app.use(orderRoutes);
  app.use(userRoutes);
  app.use(analyticsRoutes);
  app.use(settingsRoutes);
  app.use(auditRoutes);
  // Unknown API paths never fall through to the SPA redirect.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(pageRoutes);

  return app;
}

module.exports = createApp;
