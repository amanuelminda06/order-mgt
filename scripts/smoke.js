/**
 * Smoke / regression suite for the simplified Step 4 API.
 *
 * Boots the real Express app from server.js on an ephemeral port and exercises
 * the public order/receipt flow, staff order lists and cancellation, plus the
 * auth, menu, category, table, settings and audit contracts around it.
 *
 * Modes:
 *   npm run smoke:offline          in-process Supabase stub, no network
 *   ALLOW_LIVE_SMOKE=1 npm run smoke
 *                                live project, dedicated smoke_* users only
 *
 * Exit code 0 = every named check passed.
 */

const assert = require('assert');
const path = require('path');

// test-env loads .env then .env.test and resolves the target. assertIsolated()
// stays strict for the destructive reset script; useSmokeEnv() is the explicit
// opt-in that may point smoke/seed/cleanup at the live project.
const { useSmokeEnv } = require('./test-env');

// server.js only calls app.listen() when process.env.VERCEL is unset; we bind
// our own ephemeral port so the suite never touches the configured PORT.
process.env.VERCEL = '1';
process.env.PORT = '0';
process.env.AUTH_STORE = 'db';
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_CHAT_ID = '';
// The gate is off by default for handover; the smoke suite still verifies it.
process.env.FORCE_PASSWORD_CHANGE = 'true';

const OFFLINE = process.env.SMOKE_OFFLINE === '1';
if (OFFLINE && process.env.ALLOW_LIVE_SMOKE === '1') {
  throw new Error('Choose one target: SMOKE_OFFLINE=1 or ALLOW_LIVE_SMOKE=1, not both');
}
const target = useSmokeEnv();

const requiredPasswords = [
  'SMOKE_ADMIN_PASSWORD', 'SMOKE_WAITER_PASSWORD', 'SMOKE_CASHIER_PASSWORD',
];
const missing = requiredPasswords.filter((k) => !process.env[k]);
if (missing.length) throw new Error('Missing smoke password env vars: ' + missing.join(', '));

const { startFakeSupabase } = require('./fake-supabase');
let app;

const results = [];
let failures = 0;
const state = {
  originalSettings: null,
  settingsChanged: false,
  adminTok: null,
  waiterTok: null,
  cashierTok: null,
  marker: 'SMOKE ' + Date.now(),
};

// Extra staff accounts use a per-run suffix: the append-only audit trail means
// cleanup can only DEACTIVATE (never delete) smoke users, so fixed usernames
// would collide on the next live run.
const RUN_SUFFIX = String(Date.now()).slice(-9);
const EXTRA_USER = 'smokeuser_' + RUN_SUFFIX;
const PW_USER = 'smoke_pw_' + RUN_SUFFIX;

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
    if (res.status !== status) {
      const snippet = typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)?.slice(0, 300);
      throw new Error(`expected ${status}, got ${res.status}; body: ${snippet}`);
    }
    if (json) assert.ok(body !== null && body !== undefined, 'expected JSON body');
  });
  return body;
}

function api(base, url, { method = 'GET', token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = token;
  return fetch(`${base}${url}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function decodeToken(token) {
  const parts = String(token || '').split('.');
  assert.strictEqual(parts.length, 2, 'token must be a base64url payload + signature');
  const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  // Live uid values are NOT 1: only sanity-check the shape, never the value.
  assert.ok(Number.isInteger(payload.uid) && payload.uid > 0, 'uid must be a positive integer');
  assert.ok(Number.isInteger(payload.ver) && payload.ver >= 0, 'ver must be a non-negative integer');
  assert.ok(Date.now() - payload.iat < 10 * 60 * 1000, 'iat missing or stale');
  assert.ok(parts[1].length >= 40, 'signature missing');
  return payload;
}

function priceCents(value) {
  const text = String(value).trim();
  assert.ok(/^\d+(\.\d{1,2})?$/.test(text), 'price is not a 2-decimal string: ' + text);
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

function money(cents) {
  return (cents / 100).toFixed(2);
}

async function runChecks(base) {
  // ── Auth & RBAC ──────────────────────────────────────────
  let res = await api(base, '/api/login', {
    method: 'POST',
    body: { username: 'smoke_admin', password: process.env.SMOKE_ADMIN_PASSWORD },
  });
  const adminLogin = await expect('POST /api/login (smoke_admin)', res, 200);
  state.adminTok = adminLogin && adminLogin.token;
  check('login response carries token, role and no forced change', () => {
    assert.ok(state.adminTok, 'token missing');
    assert.strictEqual(adminLogin.username, 'smoke_admin');
    assert.strictEqual(adminLogin.role, 'admin');
    assert.strictEqual(adminLogin.must_change_password, false);
  });
  check('token is HMAC-signed {uid,ver,iat} payload', () => {
    const payload = decodeToken(state.adminTok);
    assert.ok(payload.iat, 'iat missing');
  });
  check('login sets HttpOnly SameSite=Lax session cookie', () => {
    const cookie = res.headers.get('set-cookie') || '';
    assert.ok(cookie.includes('cd_session='), 'session cookie missing');
    assert.ok(/httponly/i.test(cookie), 'cookie not HttpOnly');
    assert.ok(/samesite=lax/i.test(cookie), 'cookie not SameSite=Lax');
  });

  res = await api(base, '/api/login', {
    method: 'POST', body: { username: 'smoke_admin', password: 'wrong-password' },
  });
  await expect('POST /api/login (bad password -> 401)', res, 401);

  res = await api(base, '/api/orders');
  await expect('GET /api/orders (no token -> 401)', res, 401);
  res = await api(base, '/api/orders', { token: 'not-a-token' });
  await expect('GET /api/orders (garbage token -> 401)', res, 401);
  const forged = state.adminTok.slice(0, -1) + (state.adminTok.endsWith('A') ? 'B' : 'A');
  res = await api(base, '/api/orders', { token: forged });
  await expect('GET /api/orders (forged signature -> 401)', res, 401);

  res = await api(base, '/api/login', {
    method: 'POST',
    body: { username: 'smoke_waiter', password: process.env.SMOKE_WAITER_PASSWORD },
  });
  const waiterLogin = await expect('POST /api/login (smoke_waiter)', res, 200);
  state.waiterTok = waiterLogin && waiterLogin.token;
  res = await api(base, '/api/login', {
    method: 'POST',
    body: { username: 'smoke_cashier', password: process.env.SMOKE_CASHIER_PASSWORD },
  });
  const cashierLogin = await expect('POST /api/login (smoke_cashier)', res, 200);
  state.cashierTok = cashierLogin && cashierLogin.token;
  check('waiter and cashier tokens are usable and unforced', () => {
    assert.ok(state.waiterTok && state.cashierTok, 'token missing');
    assert.strictEqual(waiterLogin.role, 'waiter');
    assert.strictEqual(cashierLogin.role, 'cashier');
    assert.strictEqual(waiterLogin.must_change_password, false);
    assert.strictEqual(cashierLogin.must_change_password, false);
  });

  res = await api(base, '/api/staff', { token: state.adminTok });
  let staff = await expect('GET /api/staff (admin)', res, 200);
  check('staff has all smoke users and only the three roles', () => {
    assert.ok(Array.isArray(staff) && staff.length >= 3, 'staff list too small');
    for (const username of ['smoke_admin', 'smoke_waiter', 'smoke_cashier']) {
      const user = staff.find((u) => u.username === username);
      assert.ok(user && user.active, username + ' missing or inactive');
    }
    assert.ok(staff.every((u) => ['admin', 'cashier', 'waiter'].includes(u.role)),
      'unexpected role in staff list');
  });
  res = await api(base, '/api/staff', { token: state.waiterTok });
  await expect('GET /api/staff (waiter -> 403)', res, 403);
  res = await api(base, '/api/staff', { token: state.cashierTok });
  await expect('GET /api/staff (cashier -> 403)', res, 403);

  res = await api(base, '/api/audit?limit=200', { token: state.adminTok });
  const earlyAudit = await expect('GET /api/audit?limit=200 (admin)', res, 200);
  check('login events audited (no uid=1 assumption)', () => {
    assert.ok(earlyAudit.some((a) => a.action === 'auth.login'), 'no auth.login entry');
    assert.ok(earlyAudit.some((a) => a.action === 'auth.login_failed'), 'no auth.login_failed entry');
  });
  res = await api(base, '/api/audit', { token: state.cashierTok });
  await expect('GET /api/audit (cashier -> 403)', res, 403);

  // ── Public reads: pick live data dynamically ─────────────
  res = await api(base, '/api/tables');
  const tables = await expect('GET /api/tables (public)', res, 200);
  check('tables expose id, number, name, capacity, active and qr_token', () => {
    assert.ok(Array.isArray(tables) && tables.length >= 1, 'no tables returned');
    for (const t of tables) {
      assert.ok(Number.isInteger(Number(t.id)), 'bad table id');
      assert.ok(Number.isInteger(Number(t.table_number)), 'bad table_number');
      assert.strictEqual(typeof t.name, 'string', 'bad table name');
      assert.strictEqual(typeof t.active, 'boolean', 'bad active flag');
      assert.ok(t.qr_token, 'qr_token missing');
    }
  });
  const table = tables.find((t) => t.active) || tables[0];

  res = await api(base, `/api/tables/${table.id}/qr`);
  const qr = await expect('GET /api/tables/:id/qr (public)', res, 200);
  check('QR response has data URL, menu URL and table', () => {
    assert.ok(String(qr.qr).startsWith('data:image/png'), 'qr not a PNG data URL');
    assert.ok(String(qr.url).includes(`menu.html?table=${table.table_number}`), 'QR url wrong: ' + qr.url);
    assert.strictEqual(Number(qr.table.id), Number(table.id));
  });
  res = await api(base, '/api/tables/999999/qr');
  await expect('GET /api/tables/:id/qr (unknown -> 404)', res, 404);

  res = await api(base, '/api/menu');
  const menu = await expect('GET /api/menu (public)', res, 200);
  check('menu items expose decimal prices and food/bar categories', () => {
    assert.ok(Array.isArray(menu) && menu.length > 0, 'no menu items');
    for (const item of menu) {
      assert.ok(/^\d+(\.\d{1,2})?$/.test(String(item.price)), 'bad price for item ' + item.id);
      assert.ok(['food', 'bar'].includes(item.category), 'bad category for item ' + item.id);
      assert.strictEqual(typeof item.available, 'boolean', 'bad available flag');
      assert.ok('image_path' in item, 'image_path missing');
    }
  });
  // Live has 100+ items with unknown ids/prices: choose one at runtime.
  const item = menu.find((i) => i.available === true);
  assert.ok(item, 'no available menu item to order');
  res = await api(base, `/api/menu?available=true&category=${item.category}`);
  const filteredMenu = await expect('GET /api/menu?available=true&category=...', res, 200);
  check('menu filters by availability and category', () => {
    assert.ok(filteredMenu.length > 0, 'filter returned nothing');
    assert.ok(filteredMenu.every((i) => i.available === true && i.category === item.category),
      'filter leaked rows');
  });

  res = await api(base, '/api/categories');
  const cats = await expect('GET /api/categories (public)', res, 200);
  check('categories expose id/name/section/sort_order/active', () => {
    assert.ok(Array.isArray(cats) && cats.length > 0, 'no categories');
    for (const c of cats) {
      assert.ok(c.id !== undefined && typeof c.name === 'string', 'bad category');
      assert.ok(['food', 'bar'].includes(c.section), 'bad section');
      assert.ok('sort_order' in c && typeof c.active === 'boolean', 'bad category shape');
    }
  });

  res = await api(base, '/api/settings');
  state.originalSettings = await expect('GET /api/settings (public)', res, 200);
  check('settings map has restaurant name and ordering flag', () => {
    assert.ok(state.originalSettings.restaurant_name, 'restaurant_name missing');
    assert.strictEqual(typeof state.originalSettings.ordering_enabled, 'boolean',
      'ordering_enabled is not a boolean');
  });

  // ── Menu admin and upload validation ─────────────────────
  const foodCat = cats.find((c) => c.section === 'food') || cats[0];
  res = await api(base, '/api/menu', {
    method: 'POST', token: state.adminTok,
    body: { name: 'SMOKE ITEM', price: '12.50', category: 'food', subcategory: foodCat.name },
  });
  const createdMenu = await expect('POST /api/menu (admin)', res, 200);
  const menuId = createdMenu && createdMenu.id;
  check('POST /api/menu returns a numeric id', () => assert.ok(Number.isInteger(Number(menuId))));

  res = await api(base, `/api/menu/${menuId}`, {
    method: 'PUT', token: state.adminTok, body: { price: '13.75' },
  });
  await expect('PUT /api/menu/:id (admin)', res, 200);
  res = await api(base, `/api/menu/${menuId}/availability`, {
    method: 'PATCH', token: state.adminTok, body: { available: false },
  });
  await expect('PATCH /api/menu/:id/availability (admin)', res, 200);
  res = await api(base, '/api/menu?available=true');
  const availableMenu = await expect('GET /api/menu?available=true after PATCH', res, 200);
  check('PATCH availability hides the item from public menu', () =>
    assert.ok(!availableMenu.some((i) => Number(i.id) === Number(menuId)), 'item still available'));
  res = await api(base, `/api/menu/${menuId}/availability`, {
    method: 'PATCH', token: state.adminTok, body: { available: true },
  });
  await expect('PATCH /api/menu/:id/availability (restore)', res, 200);

  res = await api(base, '/api/menu', {
    method: 'POST', token: state.waiterTok,
    body: { name: 'X', price: '1.00', category: 'food', subcategory: foodCat.name },
  });
  await expect('POST /api/menu (waiter -> 403)', res, 403);
  res = await api(base, '/api/menu/images', {
    method: 'POST', token: state.adminTok,
    body: { name: 'smoke.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', bucket: 'nope' },
  });
  await expect('POST /api/menu/images (invalid bucket -> 400)', res, 400);
  res = await api(base, '/api/menu/images', {
    method: 'POST', token: state.adminTok,
    body: { name: 'smoke.png', dataUrl: 'not-a-data-url' },
  });
  await expect('POST /api/menu/images (invalid data URL -> 400)', res, 400);
  res = await api(base, '/api/menu/images', {
    method: 'POST', token: state.adminTok,
    body: { name: 'smoke.txt', dataUrl: 'data:text/plain;base64,SGVsbG8=' },
  });
  await expect('POST /api/menu/images (unsupported type -> 400)', res, 400);
  res = await api(base, '/api/menu/images', {
    method: 'POST', token: state.adminTok,
    body: { name: 'huge.png', dataUrl: 'data:image/png;base64,' + 'A'.repeat(7 * 1024 * 1024) },
  });
  await expect('POST /api/menu/images (over 5 MB -> 413)', res, 413);

  res = await api(base, `/api/menu/${menuId}`, { method: 'DELETE', token: state.adminTok });
  await expect('DELETE /api/menu/:id (admin)', res, 200);
  res = await api(base, `/api/menu/${menuId}`, { method: 'DELETE', token: state.adminTok });
  await expect('DELETE /api/menu/:id (gone -> 404)', res, 404);

  // ── Categories admin ─────────────────────────────────────
  res = await api(base, '/api/categories', {
    method: 'POST', token: state.adminTok,
    body: { name: 'SMOKE CAT', section: 'food' },
  });
  const createdCat = await expect('POST /api/categories (admin)', res, 200);
  const catId = createdCat && createdCat.id;
  check('POST /api/categories returns a numeric id', () => assert.ok(Number.isInteger(Number(catId))));
  res = await api(base, `/api/categories/${catId}`, {
    method: 'PUT', token: state.adminTok, body: { name: 'SMOKE CAT 2' },
  });
  await expect('PUT /api/categories/:id (admin)', res, 200);
  res = await api(base, '/api/categories', {
    method: 'POST', token: state.adminTok, body: { name: 'SMOKE CAT 2', section: 'food' },
  });
  await expect('POST /api/categories (duplicate -> 400)', res, 400);
  res = await api(base, '/api/categories', {
    method: 'POST', token: state.waiterTok, body: { name: 'SMOKE CAT 3', section: 'food' },
  });
  await expect('POST /api/categories (waiter -> 403)', res, 403);

  const catWithItems = cats.find((c) => c.name === item.subcategory);
  if (catWithItems) {
    res = await api(base, `/api/categories/${catWithItems.id}`, {
      method: 'DELETE', token: state.adminTok,
    });
    await expect('DELETE /api/categories/:id with items -> 409', res, 409);
  }
  res = await api(base, `/api/categories/${catId}`, { method: 'DELETE', token: state.adminTok });
  await expect('DELETE /api/categories/:id (admin)', res, 200);
  res = await api(base, `/api/categories/${catId}`, { method: 'DELETE', token: state.adminTok });
  await expect('DELETE /api/categories/:id (gone -> 404)', res, 404);

  // ── Tables admin (deactivate; cleanup removes the exact row) ──
  const smokeTableNumber = 90000 + Math.floor(Math.random() * 10000);
  res = await api(base, '/api/tables', {
    method: 'POST', token: state.adminTok,
    body: {
      table_number: smokeTableNumber,
      name: `SMOKE TABLE ${smokeTableNumber}`,
      capacity: 4,
    },
  });
  const createdTable = await expect('POST /api/tables (admin)', res, 200);
  const smokeTableId = createdTable && createdTable.id;
  check('POST /api/tables assigns id, qr_token and active flag', () => {
    assert.ok(smokeTableId && Number(smokeTableId) > 0, 'no table id');
    assert.ok(createdTable.qr_token, 'server-side qr_token missing');
    assert.strictEqual(createdTable.active, true);
  });
  res = await api(base, '/api/tables', {
    method: 'POST', token: state.waiterTok, body: { table_number: smokeTableNumber + 1 },
  });
  await expect('POST /api/tables (waiter -> 403)', res, 403);
  res = await api(base, '/api/tables', {
    method: 'POST', token: state.adminTok,
    body: { table_number: smokeTableNumber, name: 'duplicate' },
  });
  await expect('POST /api/tables (duplicate number -> 400)', res, 400);
  res = await api(base, `/api/tables/${smokeTableId}/deactivate`, {
    method: 'POST', token: state.adminTok,
  });
  await expect('POST /api/tables/:id/deactivate (admin)', res, 200);
  res = await api(base, '/api/tables?includeInactive=true');
  const tablesWithInactive = await expect('GET /api/tables?includeInactive=true', res, 200);
  check('deactivated table is visible with includeInactive', () => {
    const row = tablesWithInactive.find((t) => Number(t.id) === Number(smokeTableId));
    assert.ok(row && row.active === false, 'smoke table not deactivated');
  });
  res = await api(base, '/api/tables');
  const activeTables = await expect('GET /api/tables (default hides inactive)', res, 200);
  check('deactivated table is hidden from the default table list', () =>
    assert.ok(!activeTables.some((t) => Number(t.id) === Number(smokeTableId)),
      'inactive table still listed'));

  // pdfkit is required at app boot: an ESM-only dependency breaks EVERY page,
  // so assert the QR sheet actually renders a PDF (regression guard).
  const pdfResponse = await api(base, '/api/tables/qr-sheet.pdf', { token: state.adminTok });
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  check('GET /api/tables/qr-sheet.pdf renders a PDF', () => {
    assert.strictEqual(pdfResponse.status, 200, 'PDF status ' + pdfResponse.status);
    assert.strictEqual(pdfBytes.slice(0, 4).toString(), '%PDF', 'response is not a PDF');
    assert.ok(pdfBytes.length > 1000, 'PDF is unexpectedly small');
  });

  // ── Staff admin and forced password change ───────────────
  res = await api(base, '/api/staff', {
    method: 'POST', token: state.adminTok,
    body: { username: EXTRA_USER, password: 'password1', full_name: 'Smoke', role: 'waiter' },
  });
  await expect('POST /api/staff (admin)', res, 200);
  res = await api(base, '/api/staff', {
    method: 'POST', token: state.adminTok,
    body: { username: EXTRA_USER, password: 'x', full_name: 'Dup', role: 'waiter' },
  });
  await expect('POST /api/staff (duplicate username -> 400)', res, 400);
  res = await api(base, '/api/staff', {
    method: 'POST', token: state.adminTok,
    body: { username: 'badrole', password: 'password1', full_name: 'Bad', role: 'kitchen' },
  });
  await expect('POST /api/staff (invalid role -> 400)', res, 400);

  res = await api(base, '/api/staff', { token: state.adminTok });
  staff = await expect('GET /api/staff after create', res, 200);
  const smokeUser = staff.find((u) => u.username === EXTRA_USER);
  const smokeUserId = smokeUser && smokeUser.id;
  check('created staff user appears in the list', () => assert.ok(smokeUserId, 'smokeuser not found'));
  res = await api(base, `/api/staff/${smokeUserId}`, {
    method: 'PUT', token: state.adminTok, body: { active: false },
  });
  await expect('PUT /api/staff/:id deactivate (admin)', res, 200);
  res = await api(base, '/api/login', {
    method: 'POST', body: { username: EXTRA_USER, password: 'password1' },
  });
  await expect('login as deactivated user -> 401', res, 401);

  res = await api(base, '/api/staff', {
    method: 'POST', token: state.adminTok,
    body: { username: PW_USER, password: 'InitialPass123', full_name: 'PW', role: 'waiter' },
  });
  await expect('POST /api/staff (password-flow user)', res, 200);
  res = await api(base, '/api/staff', { token: state.adminTok });
  staff = await expect('GET /api/staff before password reset', res, 200);
  const pwId = (staff.find((u) => u.username === PW_USER) || {}).id;
  check('password-flow user id found', () => assert.ok(pwId, 'smoke_test_pw not found'));

  res = await api(base, '/api/auth/reset-password', {
    method: 'POST', token: state.adminTok, body: { user_id: pwId },
  });
  const reset = await expect('POST /api/auth/reset-password (admin)', res, 200);
  check('reset returns temporary password and forced flag', () => {
    assert.ok(reset.temporary_password && reset.temporary_password.length >= 12,
      'temporary password missing');
    assert.strictEqual(reset.must_change_password, true);
  });
  res = await api(base, '/api/login', {
    method: 'POST',
    body: { username: PW_USER, password: reset.temporary_password },
  });
  const pwLogin = await expect('login with temporary password', res, 200);
  check('temporary login is flagged for change', () =>
    assert.strictEqual(pwLogin.must_change_password, true));
  res = await api(base, '/api/orders', { token: pwLogin.token });
  await expect('forced-change user blocked on /api/orders -> 403', res, 403);
  res = await api(base, '/api/auth/change-password', {
    method: 'POST', token: pwLogin.token,
    body: { current_password: 'wrong', new_password: 'SmokeChanged123' },
  });
  await expect('POST /api/auth/change-password (wrong current -> 401)', res, 401);
  res = await api(base, '/api/auth/change-password', {
    method: 'POST', token: pwLogin.token,
    body: { current_password: reset.temporary_password, new_password: 'SmokeChanged123' },
  });
  const changed = await expect('POST /api/auth/change-password', res, 200);
  res = await api(base, '/api/orders', { token: changed.token });
  await expect('new token accepted after password change', res, 200);

  // ── Settings and ordering toggle ─────────────────────────
  res = await api(base, '/api/settings', {
    method: 'PUT', token: state.adminTok,
    body: { key: 'restaurant_name', value: 'SMOKE NAME' },
  });
  await expect('PUT /api/settings (admin)', res, 200);
  state.settingsChanged = true;
  res = await api(base, '/api/settings', {
    method: 'PUT', token: state.waiterTok,
    body: { key: 'restaurant_name', value: 'X' },
  });
  await expect('PUT /api/settings (waiter -> 403)', res, 403);
  res = await api(base, '/api/settings');
  const changedSettings = await expect('GET /api/settings after update', res, 200);
  check('settings update persisted', () =>
    assert.strictEqual(changedSettings.restaurant_name, 'SMOKE NAME'));

  res = await api(base, '/api/settings/ordering', {
    method: 'PUT', token: state.waiterTok, body: { enabled: false },
  });
  await expect('PUT /api/settings/ordering (waiter -> 403)', res, 403);
  res = await api(base, '/api/settings/ordering', {
    method: 'PUT', token: state.cashierTok, body: { enabled: false },
  });
  const disabled = await expect('PUT /api/settings/ordering (cashier)', res, 200);
  check('ordering toggle response reflects disabled state', () =>
    assert.strictEqual(disabled.ordering_enabled, false));
  res = await api(base, '/api/orders', {
    method: 'POST',
    body: {
      table_id: table.id,
      items: [{ menu_item_id: item.id, quantity: 1 }],
      special_notes: state.marker + ' DISABLED',
    },
  });
  await expect('POST /api/orders while ordering disabled -> 409', res, 409);
  res = await api(base, '/api/settings/ordering', {
    method: 'PUT', token: state.cashierTok, body: { enabled: true },
  });
  await expect('PUT /api/settings/ordering (re-enable)', res, 200);

  // ── Orders: DB-priced placement, receipts, lists, cancel ──
  const place = (specialNotes, quantity) => api(base, '/api/orders', {
    method: 'POST',
    body: {
      table_id: table.id,
      items: [{ menu_item_id: item.id, quantity, notes: 'SMOKE item note' }],
      special_notes: specialNotes,
    },
  });

  res = await place(state.marker + ' A', 2);
  const orderA = await expect('POST /api/orders (public, DB-priced)', res, 200);
  const expectedCents = priceCents(item.price) * 2;
  check('order response shape and exact server-side total', () => {
    assert.strictEqual(orderA.success, true);
    assert.ok(Number.isInteger(orderA.order_no) && orderA.order_no >= 1001, 'bad order_no');
    assert.ok(typeof orderA.public_token === 'string' && orderA.public_token.length >= 16,
      'bad public_token');
    assert.strictEqual(orderA.currency, 'ETB');
    assert.strictEqual(orderA.total, money(expectedCents));
    assert.strictEqual(orderA.total_cents, expectedCents);
    assert.strictEqual(orderA.items.length, 1);
    assert.strictEqual(orderA.items[0].name, item.name);
    assert.strictEqual(orderA.items[0].quantity, 2);
    assert.strictEqual(orderA.items[0].line_total, money(expectedCents));
  });

  res = await api(base, '/api/orders', {
    method: 'POST',
    body: { table_id: 999999, items: [{ menu_item_id: item.id, quantity: 1 }] },
  });
  await expect('POST /api/orders (unknown table -> 404)', res, 404);
  res = await api(base, '/api/orders', {
    method: 'POST',
    body: { table_id: table.id, items: [{ menu_item_id: 999999, quantity: 1 }] },
  });
  await expect('POST /api/orders (unknown menu item -> 404)', res, 404);
  res = await api(base, '/api/orders', {
    method: 'POST', body: { table_id: table.id, items: [] },
  });
  await expect('POST /api/orders (empty items -> 400)', res, 400);
  res = await api(base, '/api/orders', {
    method: 'POST',
    body: { table_id: table.id, items: [{ menu_item_id: item.id, quantity: 0 }] },
  });
  await expect('POST /api/orders (zero quantity -> 400)', res, 400);
  res = await api(base, '/api/orders', {
    method: 'POST',
    body: { table_id: table.id, items: [{ menu_item_id: item.id, quantity: 1.5 }] },
  });
  await expect('POST /api/orders (non-integer quantity -> 400)', res, 400);

  res = await place(state.marker + ' B', 1);
  const orderB = await expect('POST /api/orders (second smoke order)', res, 200);
  res = await place(state.marker + ' C', 1);
  const orderC = await expect('POST /api/orders (third smoke order)', res, 200);
  const tokens = [orderA.public_token, orderB.public_token, orderC.public_token];

  res = await api(base, '/api/orders', { token: state.adminTok });
  const adminOrders = await expect('GET /api/orders (admin)', res, 200);
  res = await api(base, '/api/orders', { token: state.waiterTok });
  const allOrders = await expect('GET /api/orders (waiter)', res, 200);
  res = await api(base, '/api/orders', { token: state.cashierTok });
  const cashierOrders = await expect('GET /api/orders (cashier)', res, 200);
  check('all three roles may list orders', () => {
    for (const list of [adminOrders, allOrders, cashierOrders]) {
      assert.ok(Array.isArray(list), 'orders response is not an array');
    }
  });
  // POST /api/orders returns no id by contract; staff lists supply it.
  const idFor = (order) => {
    const row = allOrders.find((o) => o.public_token === order.public_token);
    assert.ok(row && row.id !== undefined, 'order id missing from /api/orders');
    return row.id;
  };
  const orderAId = idFor(orderA);
  const orderBId = idFor(orderB);
  const orderCId = idFor(orderC);
  check('order list is newest-first with the full contract shape', () => {
    assert.ok(allOrders.length >= 3, 'smoke orders missing');
    for (let i = 1; i < allOrders.length; i++) {
      assert.ok(Number(allOrders[i - 1].id) >= Number(allOrders[i].id), 'not newest-first');
    }
    for (const token of tokens) {
      assert.ok(allOrders.some((o) => o.public_token === token), 'missing token ' + token);
    }
    const row = allOrders.find((o) => o.public_token === orderA.public_token);
    for (const key of ['id', 'order_no', 'public_token', 'table_id', 'table_name', 'table_number',
      'currency', 'total', 'special_notes', 'cancelled', 'cancel_reason', 'cancelled_at',
      'created_at', 'items']) {
      assert.ok(key in row, 'order field missing: ' + key);
    }
    assert.strictEqual(row.special_notes, state.marker + ' A');
    assert.strictEqual(row.cancelled, false);
    assert.strictEqual(row.cancel_reason, null);
    assert.strictEqual(Number(row.table_number), Number(table.table_number));
    assert.strictEqual(row.items[0].notes, 'SMOKE item note');
  });

  res = await api(base, '/api/orders?cancelled=false', { token: state.waiterTok });
  const uncancelledBefore = await expect('GET /api/orders?cancelled=false (before cancel)', res, 200);
  check('cancelled=false includes fresh smoke orders', () => {
    for (const token of tokens) {
      assert.ok(uncancelledBefore.some((o) => o.public_token === token), 'missing ' + token);
    }
  });
  res = await api(base, '/api/orders/live', { token: state.adminTok });
  const liveAdmin = await expect('GET /api/orders/live (admin)', res, 200);
  res = await api(base, '/api/orders/live', { token: state.waiterTok });
  const liveWaiter = await expect('GET /api/orders/live (waiter)', res, 200);
  res = await api(base, '/api/orders/live', { token: state.cashierTok });
  const liveCashier = await expect('GET /api/orders/live (cashier)', res, 200);
  check('live feed works for all roles and lists uncancelled orders', () => {
    for (const list of [liveAdmin, liveWaiter, liveCashier]) {
      assert.ok(list.every((o) => o.cancelled === false), 'cancelled order in live feed');
      assert.ok(list.some((o) => o.public_token === orderA.public_token), 'order A missing from live');
    }
  });

  res = await api(base, `/api/receipt/${orderA.public_token}`);
  const receipt = await expect('GET /api/receipt/:public_token (public)', res, 200);
  check('receipt is token-only with exact fields', () => {
    for (const key of ['order_no', 'public_token', 'table_name', 'table_number', 'currency',
      'total', 'created_at', 'cancelled', 'cancel_reason', 'items']) {
      assert.ok(key in receipt, 'receipt field missing: ' + key);
    }
    assert.strictEqual(receipt.order_no, orderA.order_no);
    assert.strictEqual(receipt.public_token, orderA.public_token);
    assert.strictEqual(Number(receipt.table_number), Number(table.table_number));
    assert.strictEqual(receipt.total, orderA.total);
    assert.strictEqual(receipt.currency, 'ETB');
    assert.strictEqual(receipt.cancelled, false);
    assert.strictEqual(receipt.items[0].notes, 'SMOKE item note');
  });
  res = await api(base, `/api/receipt/${orderA.order_no}`);
  await expect('GET /api/receipt/:order_no -> 404 (token only)', res, 404);
  res = await api(base, '/api/receipt/not-a-real-token');
  await expect('GET /api/receipt/:unknown -> 404', res, 404);

  res = await api(base, `/api/orders/${orderAId}/cancel`, {
    method: 'POST', token: state.cashierTok, body: { reason: 'smoke cancel cashier' },
  });
  const cancelledA = await expect('POST /api/orders/:id/cancel (cashier)', res, 200);
  check('cancel response marks the order cancelled', () => {
    assert.strictEqual(cancelledA.success, true);
    assert.strictEqual(cancelledA.order.cancelled, true);
    assert.strictEqual(cancelledA.order.cancel_reason, 'smoke cancel cashier');
    assert.ok(cancelledA.order.cancelled_at, 'cancelled_at missing');
  });
  res = await api(base, `/api/orders/${orderAId}/cancel`, {
    method: 'POST', token: state.waiterTok, body: {},
  });
  await expect('POST /api/orders/:id/cancel (missing reason -> 400)', res, 400);
  res = await api(base, '/api/orders/999999/cancel', {
    method: 'POST', token: state.adminTok, body: { reason: 'smoke' },
  });
  await expect('POST /api/orders/:id/cancel (unknown -> 404)', res, 404);

  // 409 (rather than 403) proves waiter/admin also hold order.cancel.
  res = await api(base, `/api/orders/${orderAId}/cancel`, {
    method: 'POST', token: state.waiterTok, body: { reason: 'smoke waiter' },
  });
  await expect('cancel already-cancelled order (waiter -> 409)', res, 409);
  res = await api(base, `/api/orders/${orderAId}/cancel`, {
    method: 'POST', token: state.adminTok, body: { reason: 'smoke admin' },
  });
  await expect('cancel already-cancelled order (admin -> 409)', res, 409);
  res = await api(base, `/api/orders/${orderBId}/cancel`, {
    method: 'POST', token: state.waiterTok, body: { reason: 'smoke cancel waiter' },
  });
  await expect('POST /api/orders/:id/cancel (waiter)', res, 200);
  res = await api(base, `/api/orders/${orderCId}/cancel`, {
    method: 'POST', token: state.adminTok, body: { reason: 'smoke cancel admin' },
  });
  await expect('POST /api/orders/:id/cancel (admin)', res, 200);

  res = await api(base, '/api/orders?cancelled=false', { token: state.waiterTok });
  const uncancelledAfter = await expect('GET /api/orders?cancelled=false (after cancel)', res, 200);
  check('cancelled=false excludes cancelled smoke orders', () => {
    for (const token of tokens) {
      assert.ok(!uncancelledAfter.some((o) => o.public_token === token), 'still uncancelled: ' + token);
    }
  });
  res = await api(base, '/api/orders', { token: state.waiterTok });
  const listAfter = await expect('GET /api/orders (after cancel)', res, 200);
  check('unfiltered list keeps cancellations with reason and timestamp', () => {
    for (const token of tokens) {
      const row = listAfter.find((o) => o.public_token === token);
      assert.ok(row && row.cancelled === true, 'cancelled flag missing for ' + token);
      assert.ok(row.cancel_reason && row.cancelled_at, 'reason/timestamp missing for ' + token);
    }
  });
  res = await api(base, '/api/orders/live', { token: state.cashierTok });
  const liveAfter = await expect('GET /api/orders/live (after cancel)', res, 200);
  check('live feed excludes cancelled smoke orders', () => {
    for (const token of tokens) {
      assert.ok(!liveAfter.some((o) => o.public_token === token), 'still live: ' + token);
    }
  });
  res = await api(base, `/api/receipt/${orderA.public_token}`);
  const cancelledReceipt = await expect('GET /api/receipt/:token after cancel', res, 200);
  check('receipt reflects cancellation', () => {
    assert.strictEqual(cancelledReceipt.cancelled, true);
    assert.strictEqual(cancelledReceipt.cancel_reason, 'smoke cancel cashier');
  });

  // ── Removed legacy endpoints ─────────────────────────────
  res = await api(base, `/api/orders/${orderAId}/status`, {
    method: 'PUT', token: state.waiterTok, body: { status: 'preparing' },
  });
  await expect('PUT /api/orders/:id/status removed -> 404', res, 404);
  res = await api(base, `/api/orders/${orderAId}`, {
    method: 'DELETE', token: state.waiterTok,
  });
  await expect('DELETE /api/orders/:id removed -> 404', res, 404);
  res = await api(base, `/api/track/${orderA.order_no}`);
  await expect('GET /api/track/:orderNumber removed -> 404', res, 404);
  res = await api(base, '/api/amendments');
  await expect('GET /api/amendments removed -> 404', res, 404);
  res = await api(base, '/api/amendments', {
    method: 'POST', body: { order_number: orderA.order_no, type: 'cancel' },
  });
  await expect('POST /api/amendments removed -> 404', res, 404);

  // ── Analytics & audit ────────────────────────────────────
  res = await api(base, '/api/analytics?period=today', { token: state.adminTok });
  const analytics = await expect('GET /api/analytics?period=today (admin)', res, 200);
  check('analytics shape', () => {
    assert.ok(Number.isInteger(analytics.totalOrders), 'totalOrders not a number');
    assert.strictEqual(typeof analytics.totalRevenue, 'string', 'totalRevenue not a string');
    assert.ok(Array.isArray(analytics.topItems), 'topItems not an array');
    assert.strictEqual(analytics.period, 'today');
  });
  res = await api(base, '/api/analytics', { token: state.waiterTok });
  await expect('GET /api/analytics (waiter -> 403)', res, 403);

  res = await api(base, '/api/audit?limit=200', { token: state.adminTok });
  const audit = await expect('GET /api/audit?limit=200 (final)', res, 200);
  check('all Step 4 actions are audited', () => {
    const actions = new Set(audit.map((a) => a.action));
    for (const action of ['auth.login', 'auth.login_failed', 'auth.password_reset',
      'auth.password_change', 'user.create', 'user.update', 'menu.create', 'menu.update',
      'menu.delete', 'category.create', 'category.delete', 'table.create', 'table.deactivate',
      'settings.update', 'ordering.toggle', 'order.place', 'order.cancel']) {
      assert.ok(actions.has(action), 'missing audit action: ' + action);
    }
  });

  // ── Static pages / routing ───────────────────────────────
  res = await fetch(`${base}/`, { redirect: 'manual' });
  const rootHtml = await expect('GET / serves index.html', res, 200, false);
  check('index.html redirects to table=1', () => assert.ok(rootHtml.includes('table=1')));
  res = await fetch(`${base}/admin`);
  const adminHtml = await expect('GET /admin serves HTML', res, 200, false);
  check('admin.html is Cupcake Delights', () => assert.ok(adminHtml.includes('Cupcake Delights')));
  res = await fetch(`${base}/menu.html?table=1`);
  const menuHtml = await expect('GET /menu.html serves HTML', res, 200, false);
  check('menu.html is Cupcake Delights', () => assert.ok(menuHtml.includes('Cupcake Delights')));
  res = await fetch(`${base}/staff`, { redirect: 'manual' });
  check('GET /staff redirects', () => assert.ok([301, 302, 307, 308].includes(res.status)));
  res = await fetch(`${base}/no-such-page`, { redirect: 'manual' });
  check('unknown page redirects', () => assert.ok([301, 302, 307, 308].includes(res.status)));
  res = await api(base, '/api/nope');
  const unknownApi = await expect('unknown API path -> JSON 404', res, 404);
  check('JSON 404 body', () => assert.strictEqual(unknownApi.error, 'Not found'));
  res = await fetch(`${base}/qr-table1.png`);
  await expect('legacy qr-table1.png still served', res, 200, false);
}

async function restoreSettings(base) {
  if (!state.adminTok || !state.originalSettings) return;
  const original = state.originalSettings.ordering_enabled;
  const enabled = original === true || String(original) === 'true';
  const res = await api(base, '/api/settings/ordering', {
    method: 'PUT', token: state.adminTok, body: { enabled },
  });
  check('restore ordering_enabled to its original value', () =>
    assert.strictEqual(res.status, 200, 'restore failed: ' + res.status));

  if (state.settingsChanged &&
      Object.prototype.hasOwnProperty.call(state.originalSettings, 'restaurant_name')) {
    const restored = await api(base, '/api/settings', {
      method: 'PUT', token: state.adminTok,
      body: { key: 'restaurant_name', value: state.originalSettings.restaurant_name },
    });
    check('restore restaurant_name to its original value', () =>
      assert.strictEqual(restored.status, 200, 'restore failed: ' + restored.status));
  }
}

function report() {
  for (const [status, name] of results) {
    if (status === 'FAIL') console.log('  ✗ ' + name);
  }
  const passed = results.length - failures;
  console.log(`\n${passed}/${results.length} checks passed${failures ? `, ${failures} FAILED` : ''}`);
  console.log(`Target: ${target.live ? 'live (ALLOW_LIVE_SMOKE=1)' : OFFLINE ? 'offline fake' : 'isolated test project'}`);
}

async function main() {
  const fake = OFFLINE ? await startFakeSupabase() : null;
  process.env.SUPABASE_URL = OFFLINE ? fake.url : process.env.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = OFFLINE
    ? 'smoke-test-key' : process.env.SUPABASE_SERVICE_ROLE_KEY;

  app = require(path.join(__dirname, '..', 'server.js'));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await runChecks(base);
  } finally {
    try {
      await restoreSettings(base);
    } catch (e) {
      check('restore settings', () => { throw e; });
    }
    server.close();
    if (fake) fake.close();
    if (!OFFLINE) {
      try {
        await require('./smoke-cleanup')();
      } catch (e) {
        check('smoke cleanup', () => { throw e; });
      }
    }
    report();
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
