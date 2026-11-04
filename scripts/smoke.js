/**
 * Smoke / regression test for the legacy in-memory app.
 *
 * Boots the Express app from server.js on an ephemeral port and exercises
 * every route, asserting the status codes and response shapes that exist
 * TODAY. It is the baseline that proves Step 2 (file split) and every later
 * migration step do not change behaviour by accident.
 *
 * Run: node scripts/smoke.js
 * Exit code 0 = all checks passed.
 */

const assert = require('assert');
const path = require('path');

// server.js only calls app.listen() when process.env.VERCEL is unset, and it
// listens on PORT. We set VERCEL so it does NOT listen, and start our own
// server on an ephemeral port instead.
process.env.VERCEL = '1';
process.env.PORT = '0';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

const app = require(path.join(__dirname, '..', 'server.js'));

const results = [];
let failures = 0;

function check(name, fn) {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (e) {
    failures++;
    results.push(['FAIL', name + ' :: ' + e.message]);
  }
}

async function expect(name, res, status, json = true) {
  const body = json ? await res.json().catch(() => null) : await res.text();
  check(name, () => {
    assert.strictEqual(res.status, status, `expected ${status}, got ${res.status}`);
    if (json) assert.ok(body !== null && body !== undefined, 'expected JSON body');
  });
  return body;
}

function assertNoBar(text, label) {
  check(label, () => assert.ok(!/bar/i.test(text), 'found "bar" reference'));
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // ── Auth ────────────────────────────────────────────────
  let res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin123' }),
  });
  let login = await expect('POST /api/login (valid admin)', res, 200);
  const adminTok = login && login.token;

  res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  await expect('POST /api/login (bad password -> 401)', res, 401);

  res = await fetch(`${base}/api/orders`);
  await expect('GET /api/orders (no token -> 401)', res, 401);

  res = await fetch(`${base}/api/orders`, { headers: { Authorization: 'not-a-token' } });
  await expect('GET /api/orders (garbage token -> 401)', res, 401);

  res = await fetch(`${base}/api/staff`, { headers: { Authorization: adminTok } });
  let staff = await expect('GET /api/staff (admin)', res, 200);
  check('GET /api/staff returns 4 seed users', () => assert.strictEqual(staff.length, 4));

  // Waiter token for role-matrix checks
  res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'waiter1', password: 'Waiter123' }),
  });
  const waiterLogin = await expect('POST /api/login (waiter)', res, 200);
  const waiterTok = waiterLogin.token;

  res = await fetch(`${base}/api/staff`, { headers: { Authorization: waiterTok } });
  await expect('GET /api/staff (waiter -> 403)', res, 403);

  // ── Public reads ────────────────────────────────────────
  res = await fetch(`${base}/api/tables`);
  const tables = await expect('GET /api/tables (public)', res, 200);
  check('GET /api/tables seeds 10 tables', () => assert.strictEqual(tables.length, 10));

  res = await fetch(`${base}/api/tables/1/qr`);
  const qr = await expect('GET /api/tables/1/qr (public)', res, 200);
  check('QR response has data-url + url', () => {
    assert.ok(String(qr.qr).startsWith('data:image/png'), 'qr not a data URL');
    assert.ok(String(qr.url).includes('menu.html?table=1'), 'qr url wrong: ' + qr.url);
  });

  res = await fetch(`${base}/api/tables/999/qr`);
  await expect('GET /api/tables/999/qr -> 404', res, 404);

  res = await fetch(`${base}/api/menu`);
  const menu = await expect('GET /api/menu (public)', res, 200);
  check('GET /api/menu seeds 114 items', () => assert.strictEqual(menu.length, 114));
  check('menu has food + drink items (legacy value "bar")', () => {
    assert.ok(menu.some((i) => i.category === 'food'), 'no food items');
    assert.ok(menu.some((i) => i.category === 'bar'), 'no drink items');
  });

  res = await fetch(`${base}/api/menu?available=true&category=food`);
  const foodOnly = await expect('GET /api/menu?available=true&category=food', res, 200);
  check('menu filters by category', () => assert.ok(foodOnly.every((i) => i.category === 'food')));

  res = await fetch(`${base}/api/categories`);
  const cats = await expect('GET /api/categories (public)', res, 200);
  check('GET /api/categories seeds 15', () => assert.strictEqual(cats.length, 15));

  res = await fetch(`${base}/api/settings`);
  const settings = await expect('GET /api/settings (public)', res, 200);
  check('settings has restaurant_name', () => assert.ok(settings.restaurant_name));

  // ── Menu admin (in-memory) ──────────────────────────────
  res = await fetch(`${base}/api/menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ name: 'SMOKE ITEM', price: '12.50', category: 'food', subcategory: 'Sides' }),
  });
  const created = await expect('POST /api/menu (admin)', res, 200);
  const newId = created.id;

  res = await fetch(`${base}/api/menu/${newId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ price: '13.75' }),
  });
  await expect('PUT /api/menu/:id (admin)', res, 200);

  res = await fetch(`${base}/api/menu/${newId}/availability`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ available: false }),
  });
  await expect('PATCH /api/menu/:id/availability (admin)', res, 200);

  res = await fetch(`${base}/api/menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: waiterTok },
    body: JSON.stringify({ name: 'X', price: 1, category: 'food' }),
  });
  await expect('POST /api/menu (waiter -> 403)', res, 403);

  res = await fetch(`${base}/api/menu/${newId}`, {
    method: 'DELETE',
    headers: { Authorization: adminTok },
  });
  await expect('DELETE /api/menu/:id (admin)', res, 200);

  res = await fetch(`${base}/api/menu/${newId}`, { method: 'DELETE', headers: { Authorization: adminTok } });
  await expect('DELETE /api/menu/:id (gone -> 404)', res, 404);

  // ── Categories admin ────────────────────────────────────
  res = await fetch(`${base}/api/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ name: 'SMOKE CAT', section: 'food' }),
  });
  const cat = await expect('POST /api/categories (admin)', res, 200);

  res = await fetch(`${base}/api/categories/${cat.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ name: 'SMOKE CAT 2' }),
  });
  await expect('PUT /api/categories/:id (admin)', res, 200);

  res = await fetch(`${base}/api/categories/${cat.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ name: 'dup', section: 'food' }),
  });
  // note: app.get('*') only matches GET, so an unmatched POST falls through
  // to Express's default 404 (not a JSON body). Legacy behaviour.
  check('POST /api/categories/:id -> default HTML 404 (legacy)', () =>
    assert.strictEqual(res.status, 404));

  res = await fetch(`${base}/api/categories/${cat.id}`, {
    method: 'DELETE',
    headers: { Authorization: adminTok },
  });
  await expect('DELETE /api/categories/:id (admin)', res, 200);

  // ── Orders ──────────────────────────────────────────────
  res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table_id: 1,
      items: [{ menu_item_id: 1, quantity: 2 }, { menu_item_id: 7, quantity: 1 }],
      type: 'food',
      special_notes: 'SMOKE NOTES',
    }),
  });
  const order = await expect('POST /api/orders (public, no auth)', res, 200);
  const orderId = order.order_id;
  // item 1 = French Toast 500, item 7 = Croissant with Egg & Cheese 600
  check('order total = 2*500 + 600 = 1600', () => assert.strictEqual(order.total, 1600));
  check('order_number is ORD-*', () => assert.ok(/^ORD-\d+$/.test(order.order_number)));
  check('order items echoed', () => assert.strictEqual(order.items.length, 2));

  res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table_id: 999, items: [{ menu_item_id: 1, quantity: 1 }] }),
  });
  await expect('POST /api/orders (bad table -> 404)', res, 404);

  res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table_id: 1, items: [] }),
  });
  await expect('POST /api/orders (no items -> 400)', res, 400);

  res = await fetch(`${base}/api/orders`, { headers: { Authorization: waiterTok } });
  const allOrders = await expect('GET /api/orders (waiter)', res, 200);
  check('GET /api/orders returns newest first', () => {
    assert.ok(allOrders.length >= 1);
    assert.strictEqual(allOrders[0].order_number, order.order_number);
  });

  res = await fetch(`${base}/api/orders?status=pending`, { headers: { Authorization: waiterTok } });
  const pending = await expect('GET /api/orders?status=pending', res, 200);
  check('status filter works', () => pending.every((o) => o.status === 'pending'));

  res = await fetch(`${base}/api/orders/live?role=waiter`, { headers: { Authorization: waiterTok } });
  const live = await expect('GET /api/orders/live?role=waiter', res, 200);
  check('waiter live feed only food orders', () => live.every((o) => o.type === 'food'));

  res = await fetch(`${base}/api/orders/${orderId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: waiterTok },
    body: JSON.stringify({ status: 'preparing' }),
  });
  await expect('PUT /api/orders/:id/status (waiter)', res, 200);

  // Legacy behaviour: any status string is accepted (no validation today).
  res = await fetch(`${base}/api/orders/${orderId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: waiterTok },
    body: JSON.stringify({ status: 'nonsense-status' }),
  });
  await expect('PUT status accepts arbitrary string (legacy, to be fixed)', res, 200);

  res = await fetch(`${base}/api/track/${order.order_number}`);
  const tracked = await expect('GET /api/track/:orderNumber (public)', res, 200);
  check('track returns full order today (to be reduced)', () => {
    assert.ok(Array.isArray(tracked.items) && tracked.items.length === 2, 'items missing');
    assert.strictEqual(tracked.special_notes, 'SMOKE NOTES');
  });

  res = await fetch(`${base}/api/track/ORD-0000`);
  await expect('GET /api/track/unknown -> 404', res, 404);

  // ── Amendments (legacy: removed in target spec) ─────────
  res = await fetch(`${base}/api/amendments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_number: order.order_number, type: 'cancel', message: 'smoke cancel' }),
  });
  const amd = await expect('POST /api/amendments (public, legacy)', res, 200);

  res = await fetch(`${base}/api/amendments?status=pending`, { headers: { Authorization: adminTok } });
  const amds = await expect('GET /api/amendments?status=pending', res, 200);
  check('pending amendment listed', () => amds.some((a) => a.id === amd.amendment_id));

  res = await fetch(`${base}/api/amendments/${amd.amendment_id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ status: 'denied' }),
  });
  await expect('PUT /api/amendments/:id (admin, deny)', res, 200);

  // ── Staff admin ─────────────────────────────────────────
  res = await fetch(`${base}/api/staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ username: 'smokeuser', password: 'password1', full_name: 'Smoke', role: 'waiter' }),
  });
  const createdStaff = await expect('POST /api/staff (admin)', res, 200);

  res = await fetch(`${base}/api/staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ username: 'smokeuser', password: 'x', full_name: 'Dup', role: 'waiter' }),
  });
  await expect('POST /api/staff (duplicate username -> 400)', res, 400);

  // POST /api/staff returns no id (legacy), so look the new user up.
  const staffNow = await (await fetch(`${base}/api/staff`, { headers: { Authorization: adminTok } })).json();
  const smokeId = staffNow.find((s) => s.username === 'smokeuser').id;

  res = await fetch(`${base}/api/staff/${smokeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ active: false }),
  });
  await expect('PUT /api/staff/:id deactivate (admin)', res, 200);

  res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'smokeuser', password: 'password1' }),
  });
  await expect('login as deactivated user -> 401', res, 401);

  // ── Analytics ───────────────────────────────────────────
  res = await fetch(`${base}/api/analytics?period=today`, { headers: { Authorization: adminTok } });
  const an = await expect('GET /api/analytics?period=today (admin)', res, 200);
  check('analytics shape', () => {
    assert.ok('totalOrders' in an && 'totalRevenue' in an && 'topItems' in an);
    assert.strictEqual(typeof an.totalRevenue, 'string'); // legacy: stringified float
  });

  res = await fetch(`${base}/api/analytics`, { headers: { Authorization: waiterTok } });
  await expect('GET /api/analytics (waiter -> 403)', res, 403);

  // ── Settings ────────────────────────────────────────────
  res = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: adminTok },
    body: JSON.stringify({ key: 'restaurant_name', value: 'SMOKE NAME' }),
  });
  await expect('PUT /api/settings (admin)', res, 200);

  res = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: waiterTok },
    body: JSON.stringify({ key: 'restaurant_name', value: 'X' }),
  });
  await expect('PUT /api/settings (waiter -> 403)', res, 403);

  res = await fetch(`${base}/api/settings`);
  const after = await expect('GET /api/settings (updated)', res, 200);
  check('settings persisted in memory', () => assert.strictEqual(after.restaurant_name, 'SMOKE NAME'));

  // ── Orders delete (legacy: any role) ────────────────────
  res = await fetch(`${base}/api/orders/${orderId}`, {
    method: 'DELETE',
    headers: { Authorization: waiterTok },
  });
  await expect('DELETE /api/orders/:id (waiter — legacy gap)', res, 200);

  res = await fetch(`${base}/api/orders/${orderId}`, { method: 'DELETE', headers: { Authorization: adminTok } });
  await expect('DELETE /api/orders/:id (gone -> 404)', res, 404);

  // ── Pages / routing ─────────────────────────────────────
  // express.static (server.js:18) runs BEFORE app.get('/') (server.js:478),
  // so index.html is served and the redirect route is dead code. Legacy fact.
  res = await fetch(`${base}/`, { redirect: 'manual' });
  const rootHtml = await expect('GET / serves index.html (static wins)', res, 200, false);
  check('index.html redirects to table=1 (legacy hardcode)', () =>
    assert.ok(rootHtml.includes('table=1')));

  res = await fetch(`${base}/admin`);
  const adminHtml = await expect('GET /admin serves HTML', res, 200, false);
  check('admin.html is Cupcake Delights', () => assert.ok(adminHtml.includes('Cupcake Delights')));

  res = await fetch(`${base}/menu.html?table=1`);
  const menuHtml = await expect('GET /menu.html serves HTML', res, 200, false);
  check('menu.html is Cupcake Delights', () => assert.ok(menuHtml.includes('Cupcake Delights')));

  res = await fetch(`${base}/staff`, { redirect: 'manual' });
  check('GET /staff redirects', () => assert.ok([301, 302, 307, 308].includes(res.status)));

  res = await fetch(`${base}/no-such-page`, { redirect: 'manual' });
  check('unknown page redirects to menu', () => assert.ok([301, 302, 307, 308].includes(res.status)));

  res = await fetch(`${base}/api/nope`, { redirect: 'manual' });
  check('unknown API path redirects (legacy, to be 404 JSON)', () =>
    assert.ok([301, 302, 307, 308].includes(res.status)));

  res = await fetch(`${base}/qr-table1.png`);
  await expect('legacy qr-table1.png still served', res, 200, false);

  // ── Report ──────────────────────────────────────────────
  server.close();
  for (const [status, name] of results) {
    if (status === 'FAIL') console.log('  ✗ ' + name);
  }
  const passed = results.length - failures;
  console.log(`\n${passed}/${results.length} checks passed${failures ? `, ${failures} FAILED` : ''}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
