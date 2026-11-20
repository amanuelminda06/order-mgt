# Migration Plan — Cupcake Delights (simplified scope)

Small, separately reviewable steps. `npm run smoke:offline` is the offline
regression guard. By default `npm run smoke` runs only against the disposable
test project in `.env.test`; the owner has explicitly authorised live smoke with
`ALLOW_LIVE_SMOKE=1` using dedicated `smoke_*` users. Every step leaves the
smoke passing, except where a behaviour change is explicitly listed in the step
(those are intentional and the smoke assertions are updated in the same diff).

Steps 1–4 and the Step 4 backend are complete and applied to the live project.
The admin foundation (Step 5) and the simplified customer/staff UI are
implemented and awaiting the final live smoke run.

| # | Step | Behaviour change? | Status |
|---|------|-------------------|--------|
| 1 | Smoke test baseline (`scripts/smoke.js`) | no | done |
| 2 | Split `server.js` into `src/` modules | no | done |
| 3 | Database auth, RBAC, audit (3 roles) | yes — DB-backed tokens; `kitchen` removed; audit reads added | done |
| 4 | In-place simplification migration + Step 3 hardening + simplified orders backend | yes — status flow/payments removed; forced password change; VAT display-only; exact money; token receipts; staff cancel | applied to live 2026-11-20 (backups `backup_pre_simplify_20261120_0740` / `_0742`); RPC `sql/012_step4.sql` applied |
| 5 | **Admin foundation:** menu/category CRUD, Storage uploads (logo/hero/items), tables add/deactivate + QR sheet PDF, settings screen | yes (UI/API) | implemented, pending final smoke |
| 6 | Customer menu: view-only when ordering off, "Order received", receipt link | yes (UI) | implemented, pending final smoke |
| 7 | Staff dashboard: order list, cancel with reason (no status flow) | yes (UI) | implemented, pending final smoke |
| 8 | Telegram save-then-notify, bilingual/Amharic by setting | no order loss on Telegram failure; message text changes | planned |
| 9 | Provisioning cutover, security pass, delete in-memory store and dead code | no (cleanup) | planned |

---

## Applying Step 4 to the live project (owner-run)

The live DB holds real menu items, categories, settings and table tokens.
**Do not run `npm run reset`** — it now refuses to target the live project and
only operates on `.env.test`.

```bash
npm run backup         # creates backup_pre_simplify_YYYYMMDD_HH24MI in the live DB
npm run migrate        # applies sql/010_simplify.sql in place
npm run migrate:step4  # adds the atomic create_order RPC (idempotent)
npm run verify:db      # read-only checks; never applies SQL or seeds
```

`sql/010_simplify.sql` begins with the same snapshot, so pasting it into the
Supabase SQL editor is also safe. It changes only:

- **Roles/users:** `user_role` becomes `('admin','cashier','waiter')`; existing
  `kitchen` users become `waiter`; every existing account gets
  `must_change_password = true`, so each staff member chooses a new password on
  next login.
- **Orders:** drops `payments`, `order_items`, `orders`, `calc_order_total()` and
  `order_status`; recreates simplified `orders`/`order_items` with random
  `public_token`, staff-cancel columns, exact `NUMERIC(12,2)` totals and the
  `line_total = round(price_snapshot * quantity, 2)` check. `order_number_seq`
  is preserved.
- **Settings:** deletes `require_waiter_confirmation`; upserts
  `ordering_enabled`, `telegram_language` and display-only `vat_mode`/`vat_rate`.
  Existing values are never overwritten.

Untouched: `menu_categories`, `menu_items`, `dining_tables`, all other
`settings` rows, `audit_log` history, Storage buckets/objects and
`order_number_seq`. If anything fails, restore from the timestamped backup
schema before retrying.

---

## Test isolation (and the explicit live override)

By default smoke tests never write to the live DB. Copy `.env.test.example` to
`.env.test` and fill it with a **disposable** Supabase project:

```bash
TEST_DATABASE_URL=postgresql://...          # test project, NOT the live URL
TEST_SUPABASE_URL=https://<test-ref>.supabase.co
TEST_SUPABASE_SERVICE_ROLE_KEY=...
TEST_SUPABASE_ANON_KEY=...
SMOKE_ADMIN_PASSWORD=...                     # random, 12+ chars
SMOKE_WAITER_PASSWORD=...
SMOKE_CASHIER_PASSWORD=...
```

`scripts/test-env.js` refuses to run any test/reset/seed script when
`TEST_DATABASE_URL` equals the live `DATABASE_URL`/`SUPABASE_DB_URL`, when the
test Supabase project equals the live project, or when the test DB URL contains
the live project ref. Dedicated `smoke_admin` / `smoke_waiter` / `smoke_cashier`
users are seeded with `must_change_password = false` so the forced-change gate
does not block the suite. Mutable rows are removed by `npm run smoke:cleanup`
after each real run; `audit_log` is append-only by design and is left alone —
reset the test project when a clean audit trail is needed.

For a quick local check without network, `npm run smoke:offline` uses an
in-process REST stub (`scripts/fake-supabase.js`) and the same smoke assertions.

**Owner override for this project:** the owner explicitly asked to smoke the
live database rather than create a throwaway project. With `ALLOW_LIVE_SMOKE=1`,
`npm run seed:smoke-users`, `npm run smoke` and `npm run smoke:cleanup` target
`.env` instead. They still use **only** `smoke_admin` / `smoke_waiter` /
`smoke_cashier`; cleanup deactivates those users and removes tagged data.
`npm run reset` is unaffected — it still refuses to target live.

---

## One-time live audit purge (before handover)

The migration and smoke never modify the live `audit_log` except by appending
rows. **After the final smoke run and immediately before handover**, the owner
should remove legacy/seed/test entries **manually**, in a logged session, using
the procedure in `SUPABASE_SETUP.md` § 9. Do not run smoke after that purge. It
records an `audit.purge` row, temporarily removes the two trigger guards,
deletes the old rows and restores the exact trigger definitions. The append-only rule stays in
the schema and is never weakened in application or migration code.

---

## Scope change — what is gone

Removed from the product, not deferred:

- `kitchen` role and the `kitchen1` seed user. Roles are exactly **admin,
  cashier, waiter**.
- Order status flow (`pending → preparing → ready → completed`), all status
  endpoints and the "ready"/"completed" Telegram messages.
- `payments` table and `calc_order_total()`. **VAT is restored as display-only
  settings** (`vat_mode`, `vat_rate`): shown in settings/receipts, never added
  to a total. Totals are computed server-side from DB prices with exact
  decimals (`src/utils/money.js` works in integer cents), with price snapshots
  and a `line_total` check retained on `order_items`.
- `require_waiter_confirmation`.
- Amendments, order deletion, and any customer edit/cancel path. An order is
  "received"; only staff may cancel and a reason is mandatory (audited).
- Customer tracking by sequential number. The receipt URL carries a random
  `public_token`; `order_no` is staff-only.
- Legacy auth tokens and all demo credentials in source and `.env` (grep for
  `Admin123`/`Waiter123`/`Cashier123`/`kitchen1`/`btoa`/`atob` returns nothing);
  the only token format is the HMAC-signed one below.

---

## Step 3 note — auth, RBAC, audit

- **Tokens:** HMAC-SHA256 signed `base64url({uid,ver}).base64url(sig)` using
  `JWT_SECRET`. `uid` is the DB user id, `ver` is `users.token_version`.
  No expiry; bumping `token_version` (password change, deactivation, role
  change, reset, logout) revokes all existing sessions. There is no legacy
  base64 token fallback.
- **Session delivery:** login sets an `HttpOnly` `cd_session` cookie
  (`Secure` in production, `SameSite=Lax`, path `/`). `requireAuth` accepts the
  cookie or the `Authorization` header so API clients keep working.
- **Forced password change:** all pre-migration accounts and admin-reset
  accounts have `must_change_password = true`. Every endpoint except
  `POST /api/auth/change-password` and `POST /api/logout` returns
  `403 { error: 'password_change_required' }` for those users. The admin login
  screen detects the flag and shows a "set a new password" form before entering
  the dashboard; changing the password clears the flag and issues a fresh token.
- **Reset:** admin-only `POST /api/auth/reset-password` generates a random
  temporary password, sets `must_change_password = true`, bumps
  `token_version` and audits `auth.password_reset`. The temporary password is
  returned once and is never stored in plaintext.
- **Login:** looked up in the `users` table (service-role REST), `bcryptjs`
  compare, 5 failures per username/IP in 15 minutes. Failed logins are audited
  as `auth.login_failed`; successful ones as `auth.login`.
- **Request context:** `requireAuth` verifies the signature, reloads the user
  from the DB and attaches `req.user`; `requireRole(...roles)` checks the
  *current* DB role, never a role claim from the token. `requireAdmin` is an
  alias for `requireRole('admin')`.
- **Role matrix** (enforced by `src/auth/permissions.js`, reused by later
  steps):

  | Action | admin | cashier | waiter |
  |---|:---:|:---:|:---:|
  | menu, prices, categories, staff, settings, analytics, audit read | ✓ | — | — |
  | toggle `ordering_enabled` (audited) | ✓ | ✓ | — |
  | view orders / cancel with reason | ✓ | ✓ | ✓ |
  | place order (public) | — | — | — |

- **Audit:** append-only `audit_log` rows for login (including failures),
  logout, password change/reset, staff create/update, ordering toggle, order
  place/cancel, settings and menu mutations. Actions are stable codes
  (`user.create`, `ordering.toggle`, `order.cancel`, …). Client IPs are stored
  for staff actions. Audit writes never block or delete an order.
- **Other hardening:** unknown `/api/*` paths return JSON `404` instead of
  falling through to the SPA redirect; `src/config/env.js` fails fast on
  missing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`JWT_SECRET` (and rejects
  the dev-only secret in production).

`CODE_PLAN.md` has the file-by-file contracts for Steps 3–9.
