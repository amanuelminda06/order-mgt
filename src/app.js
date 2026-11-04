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
const amendmentRoutes = require('./modules/amendments/routes');
const userRoutes = require('./modules/users/routes');
const analyticsRoutes = require('./modules/analytics/routes');
const settingsRoutes = require('./modules/settings/routes');
const pageRoutes = require('./modules/pages/routes');

const { select, insert } = require('./lib/supabase');
const { categories: memCategories, menuItems: memItems } = require('./db/memory-store');

let seeded = false;

async function seedSupabaseIfEmpty() {
  if (seeded) return;
  seeded = true;
  try {
    const existing = await select('menu_categories', {}, 'id');
    if (existing.length) return; // already seeded

    console.log('Supabase menu tables empty — seeding from memory-store...');

    // Insert categories
    const catMap = new Map();
    for (const cat of memCategories) {
      const created = await insert('menu_categories', {
        name: cat.name,
        section: cat.section === 'bar' ? 'drink' : cat.section,
        active: true,
      });
      catMap.set(`${cat.section}:${cat.name}`, created[0].id);
    }

    // Insert items
    for (const item of memItems) {
      const section = item.category === 'bar' ? 'drink' : 'food';
      const catId = catMap.get(`${section}:${item.subcategory}`);
      if (!catId) continue;
      await insert('menu_items', {
        name: item.name,
        description: item.description || '',
        category_id: catId,
        price: item.price,
        available: item.available !== false,
        image_path: item.image || '',
      });
    }
    console.log('Supabase menu tables seeded.');
  } catch (e) {
    console.error('Auto-seed failed (will retry on next start):', e.message);
    seeded = false;
  }
}

function createApp() {
  const app = express();

  app.use(cors());
  // Menu photos arrive as base64 data URLs, so the JSON body can exceed the
  // 100kb default (5 MB image ≈ 6.7 MB encoded).
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Seed Supabase from memory-store on first app creation if tables are empty
  seedSupabaseIfEmpty();

  // Order matters: pages router carries the catch-all, so it goes last.
  app.use(authRoutes);
  app.use(tableRoutes);
  app.use(menuRoutes);
  app.use(categoryRoutes);
  app.use(orderRoutes);
  app.use(amendmentRoutes);
  app.use(userRoutes);
  app.use(analyticsRoutes);
  app.use(settingsRoutes);
  app.use(pageRoutes);

  return app;
}

module.exports = createApp;
