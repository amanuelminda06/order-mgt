# Migration Plan — Cupcake Delights

Small, separately reviewable steps. Each step must leave `node scripts/smoke.js`
at **76/76** (or the diff must be an *intended* behaviour change, called out in
the step description).

| # | Step | Behaviour change? |
|---|------|-------------------|
| 1 | Smoke test baseline (`scripts/smoke.js`) | no |
| 2 | Split `server.js` into `src/` modules | no |
| 3 | Config validation, JSON 404 for `/api/*`, request validation on writes | minor (bad input now 4xx JSON instead of 200/HTML 302) |
| 4 | Hardened auth: HMAC token with `user_id` + `token_version`, login rate limiting, remove default creds | yes (token format) |
| 5 | RBAC + order transition matrix, audit log | **yes (see note below)** |
| 6 | Supabase provisioning (`SUPABASE_SETUP.md`, schema + seed) | no (parallel) |
| 7 | Read paths move to Supabase | no (same shapes) |
| 8 | Money: all totals in SQL `NUMERIC(12,2)`, currency + VAT settings | yes (response shapes) |
| 9 | Orders & cancellations on DB, `order_no` sequence | yes (amendments removed) |
| 10 | Tables + `qr_token`, bulk QR, `menu.html?t=` | yes (URL contract) |
| 11 | Supabase Storage uploads (logo, hero, item images) | yes (new endpoint) |
| 12 | Frontend rework: single cart, role views, settings tab | yes (UI) |
| 13 | i18n EN/AM | yes (UI) |
| 14 | Telegram hardening + i18n + configured currency | no (external only) |
| 15 | Vercel `rewrites`, static via CDN, enforced `BASE_URL`, analytics TZ | yes (routing) |
| 16 | Security pass: output escaping, CORS allowlist, helmet, rate limits | yes (headers) |
| 17 | Cutover: delete in-memory store and dead code, README rewrite | no (cleanup) |

---

## Step 5 note — `DELETE /api/orders/:id` is removed

The legacy endpoint `DELETE /api/orders/:id` (`src/modules/orders/routes.js`)
is currently open to **any authenticated role** and hard-deletes an order with
no audit trail.

**It will be removed entirely in Step 5 (RBAC) and replaced by cancellation:**

- New action: `PUT /api/orders/:id/cancel` (or `status=cancelled` through the
  guarded transition path — decided at implementation).
- **`cancel_reason` is mandatory** — rejected with 400 if missing or blank.
- **Who may cancel:**
  - `waiter` or `admin` while status is `pending` (before `preparing`)
  - `admin` only once status is `preparing` or later
- The order is **never deleted** — it moves to `cancelled` and stays in history.
- Every cancellation writes an `audit_log` row: actor, role, before/after
  status, `cancel_reason`, timestamp.

There will be **no** order-deletion endpoint after Step 5.

---

## Open items to settle during implementation

- Exact cancel endpoint shape (dedicated route vs. guarded status transition).
- Whether `pending → cancelled` also needs a Telegram message (currently only
  amendment-driven cancels notify).
- `require_waiter_confirmation` (default `true`): who performs the confirming
  action and from which view — waiter live board.
