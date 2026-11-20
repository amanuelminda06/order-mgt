/**
 * Minimal in-process Supabase REST stub for the Step 4 offline smoke run.
 *
 * It seeds users, categories, menu items, dining tables and settings from the
 * legacy fixtures, implements the create_order RPC with exact decimal money,
 * and serves the nested selects the simplified orders API needs. Storage is
 * intentionally not implemented: smoke only exercises upload validation, which
 * fails before an upload is attempted.
 */
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const {
  categories, menuItems, staff, tables, settings: fixtureSettings,
} = require('../src/db/memory-store');
const { toCents, fromCents } = require('../src/utils/money');

const PASSWORD_ENV = {
  smoke_admin: 'SMOKE_ADMIN_PASSWORD',
  smoke_waiter: 'SMOKE_WAITER_PASSWORD',
  smoke_cashier: 'SMOKE_CASHIER_PASSWORD',
};

// JSONB columns arrive as JSON text over PostgREST; parseValue mirrors
// src/db/settings.js so ordering_enabled/vat_rate behave like the real DB.
function parseValue(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return value; }
  }
  return value;
}

function seed() {
  const users = staff.map((u) => {
    const password = process.env[PASSWORD_ENV[u.username]];
    if (!password) throw new Error('Missing ' + PASSWORD_ENV[u.username] + ' (fill .env.test)');
    return {
      ...u,
      password_hash: bcrypt.hashSync(password, 10),
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
    };
  });

  const cats = categories.map((c, i) => ({
    id: c.id,
    name: c.name,
    name_am: null,
    // DB stores drinks as 'drink'; the API maps it back to 'bar'.
    section: c.section === 'bar' ? 'drink' : c.section,
    sort_order: i + 1,
    active: true,
  }));

  const items = menuItems.map((m, i) => ({
    id: m.id,
    name: m.name,
    name_am: null,
    description: m.description || '',
    description_am: null,
    price: String(m.price),
    available: m.available !== false,
    image_path: m.image || '',
    sort_order: i + 1,
    category_id: cats.find((c) => c.name === m.subcategory &&
      c.section === (m.category === 'bar' ? 'drink' : 'food')).id,
  }));

  const diningTables = tables.map((t) => ({
    id: t.id,
    table_number: t.table_number,
    name: t.name,
    capacity: t.capacity,
    qr_token: crypto.randomBytes(16).toString('hex'),
    active: true,
  }));

  // sql/002_seed.sql settings, represented as JSONB text values.
  const settingsMap = {
    ...fixtureSettings,
    brand_name: 'Cupcake Delights',
    currency_code: 'ETB',
    currency_symbol: 'ETB',
    currency_position: 'before',
    vat_mode: 'inclusive',
    vat_rate: 15,
    ordering_enabled: fixtureSettings.ordering_enabled !== false,
  };
  const settings = Object.entries(settingsMap)
    .map(([key, value]) => ({ key, value: JSON.stringify(value) }));

  return {
    users,
    menu_categories: cats,
    menu_items: items,
    dining_tables: diningTables,
    settings,
    audit_log: [],
    orders: [],
    order_items: [],
    orderCounter: 1001,
  };
}

function matches(row, filterKey, rawValue) {
  const value = String(rawValue).startsWith('eq.') ? String(rawValue).slice(3) : String(rawValue);
  const actual = row[filterKey];
  if (actual && typeof actual === 'object') return false;
  return String(actual) === value;
}

/** Embed relations the same way PostgREST does for the orders SELECTs. */
function withEmbeds(db, table, row) {
  const out = { ...row };
  if (table === 'orders') {
    out.dining_tables = db.dining_tables.find((t) => Number(t.id) === Number(row.table_id)) || null;
    out.order_items = db.order_items.filter((i) => Number(i.order_id) === Number(row.id));
  }
  if (table === 'menu_items') {
    out.menu_categories = db.menu_categories.find((c) => c.id === row.category_id) || null;
  }
  return out;
}

async function startFakeSupabase() {
  const db = seed();
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // Atomic order placement (sql/012_step4.sql). Prices are resolved from the
  // seeded menu; totals use integer minor units and the counter starts at 1001.
  app.post('/rest/v1/rpc/create_order', (req, res) => {
    const fail = (message) => res.status(400).json({ message });

    const ordering = db.settings.find((s) => s.key === 'ordering_enabled');
    if (ordering && parseValue(ordering.value) === false) return fail('ordering_disabled');

    const tableId = Number(req.body && req.body.p_table_id);
    const table = db.dining_tables.find((t) => Number(t.id) === tableId && t.active !== false);
    if (!table) return fail('table_not_found');

    const requested = req.body && req.body.p_items;
    if (!Array.isArray(requested) || requested.length === 0) return fail('items_required');

    const lines = [];
    let totalCents = 0;
    for (const item of requested) {
      const qty = Number(item && item.quantity);
      if (!Number.isInteger(qty) || qty <= 0 || qty > 100) return fail('invalid_quantity');
      if (item.menu_item_id === undefined || item.menu_item_id === null || item.menu_item_id === '') {
        return fail('invalid_menu_item');
      }
      const menu = db.menu_items.find((m) => Number(m.id) === Number(item.menu_item_id) && m.available === true);
      if (!menu) return fail('menu_item_unavailable');

      const priceCents = toCents(menu.price);
      const lineCents = priceCents * qty;
      totalCents += lineCents;
      const notes = typeof item.notes === 'string' && item.notes.trim() ? item.notes.trim() : null;
      lines.push({
        menu_item_id: menu.id,
        name: menu.name,
        name_am: menu.name_am || null,
        price: fromCents(priceCents),
        quantity: qty,
        line_total: fromCents(lineCents),
        notes,
      });
    }

    const id = Math.max(0, ...db.orders.map((o) => Number(o.id) || 0)) + 1;
    const orderNo = db.orderCounter++;
    const order = {
      id,
      order_no: orderNo,
      public_token: crypto.randomBytes(24).toString('hex'),
      table_id: tableId,
      currency: 'ETB',
      total: fromCents(totalCents),
      special_notes: typeof req.body.p_notes === 'string' && req.body.p_notes.trim()
        ? req.body.p_notes.trim() : null,
      cancel_reason: null,
      cancelled_by: null,
      cancelled_at: null,
      placed_by: req.body.p_placed_by || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.orders.push(order);
    for (const line of lines) {
      db.order_items.push({
        id: Math.max(0, ...db.order_items.map((i) => Number(i.id) || 0)) + 1,
        order_id: id,
        menu_item_id: line.menu_item_id,
        name_snapshot: line.name,
        name_am_snapshot: line.name_am,
        price_snapshot: line.price,
        quantity: line.quantity,
        line_total: line.line_total,
        notes: line.notes,
      });
    }

    // PostgREST returns a JSON object for a scalar jsonb-returning function.
    return res.json({
      order_no: order.order_no,
      public_token: order.public_token,
      currency: order.currency,
      total: order.total,
      total_cents: totalCents,
      items: lines,
    });
  });

  app.all('/rest/v1/:table', (req, res) => {
    const table = req.params.table;
    if (!db[table]) return res.status(404).json({ message: 'unknown table ' + table });
    const rows = db[table];

    if (req.method === 'GET') {
      const filters = Object.entries(req.query).filter(([k]) => !['select', 'order'].includes(k));
      let result = rows.filter((row) => filters.every(([k, v]) => matches(row, k, v)));
      const order = String(req.query.order || 'sort_order.asc');
      const [col, direction] = order.split('.');
      result.sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return direction === 'desc' ? -cmp : cmp;
      });

      result = result.map((row) => withEmbeds(db, table, row));

      // Mirror PostgREST projections: a `select=id,name` request must not leak
      // other columns, so offline smoke catches missing-column bugs.
      const requested = req.query.select
        ? String(req.query.select).split(',').map((s) => s.trim())
        : null;
      if (requested && !requested.includes('*')) {
        result = result.map((row) => {
          const projected = {};
          for (const key of requested) {
            const column = key.split('(')[0].trim(); // embeds: dining_tables(...)
            if (column in row) projected[column] = row[column];
          }
          return projected;
        });
      }
      return res.json(result);
    }

    if (req.method === 'POST') {
      const bodyRows = Array.isArray(req.body) ? req.body : [req.body];
      const written = [];
      for (const item of bodyRows) {
        const row = { ...item };
        // settings upserts conflict on `key`, not on the synthetic id.
        if (table === 'settings' && req.query.on_conflict === 'key') {
          const idx = rows.findIndex((r) => r.key === row.key);
          if (idx !== -1) {
            rows[idx] = { ...rows[idx], ...row };
            written.push(rows[idx]);
            continue;
          }
        }
        if (!row.id) row.id = Math.max(0, ...rows.map((r) => Number(r.id) || 0)) + 1;
        if (table === 'audit_log') row.created_at = new Date().toISOString();
        rows.push(row);
        written.push(row);
      }
      return res.status(201).json(written);
    }

    const id = Number(String(req.query.id || '').replace('eq.', ''));
    const idx = rows.findIndex((r) => Number(r.id) === id);
    if (idx === -1) return res.json([]);
    if (req.method === 'PATCH') {
      rows[idx] = { ...rows[idx], ...req.body, updated_at: new Date().toISOString() };
      const response = table === 'orders' ? withEmbeds(db, table, rows[idx]) : rows[idx];
      return res.json([response]);
    }
    if (req.method === 'DELETE') {
      const [removed] = rows.splice(idx, 1);
      return res.json([removed]);
    }
    return res.status(405).json({ message: 'method not allowed' });
  });

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

module.exports = { startFakeSupabase };
