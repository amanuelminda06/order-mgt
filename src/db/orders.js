/** Orders repository: DB-backed, token-only receipts, exact decimal totals. */
const { select, update, rpc } = require('../lib/supabase');
const { toCents, fromCents } = require('../utils/money');

const ORDER_COLUMNS = 'id,order_no,public_token,table_id,currency,total,special_notes,cancel_reason,cancelled_by,cancelled_at,created_at,updated_at,dining_tables(name,table_number),order_items(id,name_snapshot,quantity,line_total,notes)';

// Postgres NUMERIC arrives through PostgREST as "1000" or "1000.00" depending
// on scale; always expose a canonical 2-decimal string via exact integer cents.
function money(value) {
  if (value === null || value === undefined) return null;
  try {
    return fromCents(toCents(String(value)));
  } catch (_) {
    return String(value);
  }
}

function mapItem(item) {
  return {
    id: item.id,
    name: item.name_snapshot,
    quantity: item.quantity,
    line_total: money(item.line_total),
    notes: item.notes || '',
  };
}

function mapOrder(order) {
  const table = order.dining_tables || {};
  return {
    id: order.id,
    order_no: order.order_no,
    public_token: order.public_token,
    table_id: order.table_id,
    table_name: table.name || '',
    table_number: table.table_number || null,
    currency: order.currency || 'ETB',
    total: money(order.total),
    special_notes: order.special_notes || '',
    cancel_reason: order.cancel_reason || null,
    cancelled_at: order.cancelled_at || null,
    cancelled: Boolean(order.cancelled_at),
    created_at: order.created_at,
    items: (order.order_items || []).map(mapItem),
  };
}

async function placeOrder({ table_id, items, special_notes, placed_by }) {
  const result = await rpc('create_order', {
    p_table_id: Number(table_id),
    p_items: items,
    p_notes: special_notes || null,
    p_placed_by: placed_by || null,
  });
  const row = result && (result.create_order || result);
  return {
    success: true,
    order_no: row.order_no,
    public_token: row.public_token,
    currency: row.currency || 'ETB',
    total: money(row.total),
    total_cents: Number(row.total_cents),
    items: (row.items || []).map((i) => ({
      menu_item_id: i.menu_item_id,
      name: i.name,
      quantity: i.quantity,
      line_total: money(i.line_total),
    })),
  };
}

async function listOrders({ limit = 100 } = {}) {
  const rows = await select('orders', {}, ORDER_COLUMNS, { order: 'id.desc' });
  return rows.slice(0, limit).map(mapOrder);
}

async function getOrder(id) {
  const rows = await select('orders', { id }, ORDER_COLUMNS, { order: null });
  return rows[0] ? mapOrder(rows[0]) : null;
}

async function getReceipt(token) {
  const rows = await select(
    'orders',
    { public_token: token },
    'order_no,public_token,currency,total,special_notes,cancel_reason,cancelled_at,created_at,dining_tables(name,table_number),order_items(name_snapshot,quantity,line_total,notes)',
    { order: null }
  );
  if (!rows[0]) return null;
  const order = mapOrder(rows[0]);
  return {
    order_no: order.order_no,
    public_token: order.public_token,
    table_name: order.table_name,
    table_number: order.table_number,
    currency: order.currency,
    total: order.total,
    special_notes: order.special_notes,
    created_at: order.created_at,
    cancelled: order.cancelled,
    cancel_reason: order.cancel_reason,
    items: order.items,
  };
}

async function cancelOrder(id, reason, actorId) {
  const rows = await update('orders', id, {
    cancel_reason: reason,
    cancelled_by: actorId || null,
    cancelled_at: new Date().toISOString(),
  });
  return rows[0] ? mapOrder(rows[0]) : getOrder(id);
}

function rpcErrorStatus(message) {
  if (/ordering_disabled/.test(message)) return 409;
  if (/table_not_found|table_required|menu_item_unavailable|invalid_menu_item/.test(message)) return 404;
  if (/items_required|invalid_quantity/.test(message)) return 400;
  return 400;
}

module.exports = {
  placeOrder, listOrders, getOrder, getReceipt, cancelOrder, rpcErrorStatus, mapOrder,
};
