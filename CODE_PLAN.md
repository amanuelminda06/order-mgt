# Code Plan — Cupcake Delights (simplified scope)

Companion to `MIGRATION_PLAN.md`. Records the implementation decisions so each
step can be built and reviewed without re-litigating contracts.

## Shared contracts

### Roles and permissions

`src/auth/permissions.js` exports `ROLES = ['admin', 'cashier', 'waiter']` and
`PERMISSIONS` (action → allowed roles). `requireRole(...roles)` reads
`req.user.role` from the freshly loaded DB row. Never trust a role in a token.

| Permission | admin | cashier | waiter |
|:---|:---:|:---:|:---:|
| `menu.write`, `staff.write`, `settings.write`, `analytics.read`, `audit.read` | ✓ | — | — |
| `ordering.toggle` | ✓ | ✓ | — |
| `order.read`, `order.cancel` | ✓ | ✓ | ✓ |

### Auth token and session

`src/auth/tokens.js`: `sign(user) -> "<base64url({uid,ver,iat})>.<base64url(HMAC-SHA256)>"`.
`verify(token)` returns the payload or `null`; uses `timingSafeEqual`.
`JWT_SECRET` is required outside tests. No role/username in the payload and no
legacy token format. Login also sets the `cd_session` cookie
(`HttpOnly`, `SameSite=Lax`, `Secure` in production); `src/auth/middleware.js`
reads the cookie first, then the `Authorization` header.

### Forced password change

`users.must_change_password` is set on every pre-migration account and on admin
reset, but enforcement is gated by `FORCE_PASSWORD_CHANGE` (default `false`,
set to `true` in `.env` to switch on at real deployment). When enabled,
`requireAuth` blocks all endpoints except
`POST /api/auth/change-password` and `POST /api/logout` with
`403 { error: 'password_change_required' }`. Self-service change verifies the
current password, writes a new bcrypt hash, clears the flag, bumps
`token_version` and returns a new token. Admin reset generates a temporary
password with `crypto.randomBytes`, sets the flag, bumps the version and audits
`auth.password_reset`.

### Money and VAT

`src/utils/money.js` converts DB `NUMERIC` strings to integer cents, so JS
floats never touch a total. Prices are resolved server-side from `menu_items`
for every order; `order_items` stores `price_snapshot` and `quantity` with a DB
check that `line_total = round(price_snapshot * quantity, 2)`. `settings`
`vat_mode` / `vat_rate` are **display only** (`vatDisplay()`); they never change
an order total.

### Audit

`src/db/accounts.js` / `appendAudit` writes to `audit_log` via the service-role
client (never via the browser). `AUTH_STORE=memory` keeps an in-process array
for small unit checks; the smoke suite uses the DB implementation against
`scripts/fake-supabase.js` (offline) or the disposable test project (real).
Action codes: `auth.login`, `auth.login_failed`, `auth.logout`,
`auth.password_change`, `auth.password_change_failed`, `auth.password_reset`,
`user.create`, `user.update`, `ordering.toggle`, `order.place`, `order.cancel`,
`settings.update`, `menu.create`, `menu.update`, `menu.delete`, `category.*`,
`table.*`, `upload.*`. The append-only triggers are never removed by app or
migration code.

### i18n

`src/i18n/strings.js` is the only place with UI/Telegram copy. Keys are plain
short words (`orderReceived`, `newOrder`, `cancel`, `total`, `received`, …).
Each value is `{ en, am }`; `default_language` decides the initial choice.
Customer menu and staff dashboard both render an `EN / አማ` toggle and persist
the choice in `localStorage`. Amharic is LTR; no RTL layout needed.

---

## Step 3 — database auth, RBAC, audit (done)

- `src/config/env.js`: `JWT_SECRET`, fail-fast `validateConfig()`.
- `src/lib/supabase.js`: overridable `order` in `select()`, `Prefer:
  return=representation` on writes.
- `src/db/accounts.js`, `src/auth/tokens.js`, `src/auth/middleware.js`,
  `src/auth/permissions.js`, `src/auth/login-guard.js`: async repository,
  HMAC verification, DB reload, forced-change gate, role checks, login rate
  limit.
- `src/modules/auth/routes.js`: login/logout, change/reset password, failed
  login and password event audits, HttpOnly cookie.
- `src/modules/users/routes.js`: async, audited; bump `token_version` on
  password/role/deactivation changes; only three roles.
- `src/modules/audit/routes.js`: `GET /api/audit?limit=` — admin only.
- `src/app.js`: audit router; JSON `404` for unknown `/api/*`; `src/utils/async.js`
  wraps async handlers so rejections become JSON 500s.
- `src/utils/money.js`: exact integer-cent arithmetic and display-only VAT.

## Step 4 — in-place migration + simplified orders backend (done)

- `sql/010_simplify.sql`: timestamped backup schema, role replacement
  (`kitchen` → `waiter`), `must_change_password`, drop payments/status,
  simplified orders with `public_token` and cancel fields, exact `line_total`
  check, display-only VAT settings. Never touches menu/tables/Storage.
- `sql/012_step4.sql` (`npm run migrate:step4`): idempotent `create_order(jsonb)`
  RPC. It resolves prices and inserts `orders` + `order_items` in ONE database
  transaction, generates `public_token` in the DB, and returns exact decimal
  totals. The API commits before any Telegram notification.
- `scripts/backup-db.js` / `scripts/migrate.js` (`npm run backup` / `migrate`):
  run the snapshot and migration via `DATABASE_URL`.
- `scripts/db-setup.js`: verification adds `must_change_password` and VAT
  display settings; `scripts/db-reset.js` is test-only (`ALLOW_TEST_RESET=1`).
- `src/modules/settings/routes.js`: public read exposes `ordering_enabled`;
  `PUT /api/settings/ordering` (admin/cashier) toggles it and audits the change.
  Admin keeps all menu/price writes regardless of the toggle.
- `POST /api/orders`: reject `409` when `ordering_enabled=false`, resolved
  server-side. Resolve prices from DB, insert `orders` + `order_items` in one
  transaction using `src/utils/money.js`, return `{ order_no, public_token,
  total }`. Commit before any Telegram call.
- `GET /api/receipt/:token`: public, lookup by random `public_token` only,
  never `order_no`; unknown token → 404.
- `POST /api/orders/:id/cancel` (admin/cashier/waiter): mandatory non-blank
  `reason`; sets cancel columns and audits. No DELETE/status endpoint and no
  customer edit/cancel route.
- Delete `src/modules/amendments/routes.js` and all `status`/`payments` code.

## Step 5 — admin foundation (menu, media, tables, settings) (implemented)

Placed **before** the customer menu so staff can provision everything the
customer flow reads. All routes require the permissions in the shared matrix.

- **Menu/category CRUD:** `src/modules/menu/routes.js` and
  `src/modules/categories/routes.js` become DB-backed (service-role REST), with
  create/update/delete, `available` flag, `sort_order`, bilingual
  `name_am`/`description_am`, and audit codes `menu.*` / `category.*`. Category
  delete is rejected while it still has items. Prices are validated as
  max-two-decimal, non-negative `NUMERIC`.
- **Storage uploads:** `POST /api/menu/images` accepts an image data URL,
  validates MIME/size, and uploads to the existing `logo`, `hero` and
  `menu-items` buckets via service-role REST. Settings store bucket-relative
  paths for logo/hero; `menu_items.image_path` stores the item photo path.
  Existing `public/uploads` files are migrated to Storage in Step 9.
- **Tables:** `src/modules/tables/routes.js` gains admin-only create and
  deactivate (never hard-delete, to keep receipt/order references valid).
  `qr_token` is generated server-side. `GET /api/tables/:id/qr` keeps returning
  a QR data URL; add a printable multi-table **QR sheet PDF** endpoint that
  renders all active tables on A4 pages for printing.
- **Settings screen:** `public/admin.html` gains a settings tab for brand,
  currency, language, `ordering_enabled`, `telegram_language` and the
  display-only `vat_mode`/`vat_rate` (clearly labelled "display only — not added
  to totals"). Writes go through `PUT /api/settings` and are audited.
- Smoke additions: admin-only RBAC denials for each write, upload validation
  (bad MIME/size), deactivate-not-delete, and settings persistence.

## Step 6 — customer menu (implemented)

- `public/menu.html`: read `ordering_enabled`; when off, hide cart/order button
  and show a short view-only notice. Prices remain visible.
- After submit show `orderReceived` and a receipt link using `public_token`
  (never `order_no`). Use the externalized EN/አማ strings and toggle.

## Step 7 — staff dashboard (simplified; implemented in admin.html)

- `public/staff.html`: one order list (newest first, staff sees `order_no`),
  `setInterval` refresh, new-id diff → highlight + short sound (muted until
  first interaction for browser autoplay rules), cancel dialog with reason.
  EN/አማ toggle using the same string catalog.

## Step 8 — Telegram

- `src/notifications/telegram.js`: build messages from `src/i18n/strings.js`
  with `telegram_language` = `bilingual` (default) | `am` | `en`; configured
  currency, no hardcoded `ETB`.
- Order placement awaits the DB commit, then calls Telegram in a separate
  try/catch; send failure logs + audits `telegram.failed` but the API still
  returns success. No retry that can duplicate an order.

## Step 9 — cutover

- Delete `src/db/memory-store.js`, the `AUTH_STORE=memory` seam and
  `scripts/fake-supabase.js` once all smoke runs against the real test project.
- Move `public/uploads` assets into Storage and update stored paths.
- Final security pass and removal of `status`/`payments`/amendment dead code.
