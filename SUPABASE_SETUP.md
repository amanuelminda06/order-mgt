# Supabase Setup — Cupcake Delights (simplified scope)

Run these steps in order. The SQL files are idempotent where possible.

> **Scope:** 8 tables, 3 roles (`admin`, `cashier`, `waiter`). No order status
> flow, no payments, no kitchen role, no `require_waiter_confirmation`. VAT is
> **display only** (`vat_mode`, `vat_rate`) and is never added to totals.
>
> **Existing live project:** use the in-place migration in § 1b. **Never run
> `npm run reset` against the live project** — it holds the real menu,
> categories, settings and table tokens. Reset is test-only (§ 6).

---

## 0. Prerequisites

Supabase project → **Project URL**, **Service Role Key**, **Anon Key**. `.env`:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # server only, never exposed
SUPABASE_ANON_KEY=<anon key>
DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres
                                               # transaction pooler for backup/migrate/verify
BASE_URL=https://<your-vercel-domain>
JWT_SECRET=<random 32+ bytes>                  # HMAC session tokens
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ADMIN_INITIAL_PASSWORD=
WAITER_INITIAL_PASSWORD=
CASHIER_INITIAL_PASSWORD=
```

`DATABASE_URL` (or `SUPABASE_DB_URL`) is required only for `npm run backup`,
`npm run migrate`, `npm run verify:db`, `npm run setup` and the test scripts.
Use the **transaction pooler** connection string (port 6543) — the direct host
`db.<ref>.supabase.co:5432` may be IPv6-only. `scripts/db-client.js` enables TLS
with `rejectUnauthorized: false` for Supabase hosts because the pooler presents
a self-signed certificate. Never commit `.env` or `.env.test`. The service-role
key bypasses RLS and must stay server-side.

### Telegram bot

The bot token is verified (`getMe` → `@Cupcakedelight_orders_bot`). Press
**Start** in the bot (or add it to a staff group as admin), then:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

Copy `"chat":{"id":…}` into `TELEGRAM_CHAT_ID` (group ids are negative). When
unset, notifications are a no-op — **never an order failure**.

---

## 1. Schema (fresh project only)

Dashboard → SQL Editor → paste `sql/001_schema.sql` → Run. Summary:

| Table | Purpose |
|---|---|
| `users` | staff accounts; `role user_role`, `must_change_password`, `token_version` |
| `menu_categories` / `menu_items` | menu, including `name_am` / `description_am` |
| `dining_tables` | 30 tables, random `qr_token`, deactivate-only |
| `orders` | received orders + staff cancellation, random `public_token` |
| `order_items` | name/price snapshots for the receipt |
| `audit_log` | append-only staff/action trail |
| `settings` | brand, currency, `default_language`, `ordering_enabled`, `telegram_language`, `vat_mode`, `vat_rate` |

Key DDL (full definition is in the file):

```sql
create type user_role as enum ('admin','cashier','waiter');
create sequence order_number_seq start 1001 minvalue 1001;

create table orders (
  id            bigserial primary key,
  order_no      integer not null unique default nextval('order_number_seq'),
  public_token  text not null unique default encode(gen_random_bytes(24), 'hex'),
  table_id      bigint not null references dining_tables(id) on delete restrict,
  currency      text not null default 'ETB',
  total         numeric(12,2) not null check (total >= 0),
  special_notes text,
  cancel_reason text,
  cancelled_by  bigint references users(id) on delete set null,
  cancelled_at  timestamptz,
  placed_by     bigint references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (cancel_reason is null or btrim(cancel_reason) <> ''),
  check ((cancel_reason is null) = (cancelled_at is null))
);

create table order_items (
  ...
  price_snapshot numeric(12,2) not null check (price_snapshot >= 0),
  quantity       integer not null check (quantity > 0),
  line_total     numeric(12,2) not null
    check (line_total = round(price_snapshot * quantity, 2))
);
```

Deliberate omissions: **no** `order_status`, `payments`, VAT columns on
`orders`, `calc_order_total()`, `order_amendments`,
`require_waiter_confirmation`, or `kitchen` role. `vat_mode`/`vat_rate` live in
`settings` as display values only. `audit_log` has triggers that reject UPDATE
and DELETE (`audit_log_no_update`, `audit_log_no_delete`).

---

## 1b. In-place migration (existing live project)

Back up first, then migrate. Both steps need `DATABASE_URL`:

```bash
npm run backup    # creates backup_pre_simplify_YYYYMMDD_HH24MI
npm run migrate   # applies sql/010_simplify.sql
```

The migration snapshots affected tables into a timestamped schema **before**
any destructive DDL, then:

- replaces `user_role` with `('admin','cashier','waiter')` (`kitchen` →
  `waiter`) and adds `must_change_password = true` for every existing account;
- drops `payments`, `order_items`, `orders`, `calc_order_total()` and
  `order_status`, then recreates the simplified orders with `public_token`,
  cancel fields, exact `NUMERIC(12,2)` totals and the `line_total` check;
- deletes `require_waiter_confirmation` and upserts `ordering_enabled`,
  `telegram_language`, `vat_mode`, `vat_rate` (existing values are kept).

Preserved: `menu_categories`, `menu_items`, `dining_tables`, other settings,
`audit_log`, Storage and `order_number_seq`. If anything fails, restore from
the backup schema before retrying.

After migrating, existing accounts carry `must_change_password = true`, but the
enforcement gate is **off by default** for the trial deployment. To require a
new password at next login, set `FORCE_PASSWORD_CHANGE=true` in `.env` and
restart — no migration needed. The manager can change their own password
(header → **Change Password**) or reset any staff password (Staff tab →
**Reset password**) regardless of the toggle.

---

## 2. RLS

All 8 tables have RLS enabled; the server uses the service-role key, so no
policies are needed. Anon-key policies may be added later for public menu reads
if a browser client is introduced. (The sequence needs no RLS.)

---

## 3. Storage buckets

`logo` (2 MB), `hero` (5 MB), `menu-items` (5 MB) — public read, png/jpg/webp
(`svg` also allowed for `logo`). Store only bucket-relative paths in
`image_path` / settings, never full URLs. `npm run setup` creates these buckets.

---

## 4. Seed data

`sql/002_seed.sql` inserts settings and 30 `dining_tables` with random
`qr_token`s. Notable settings:

| key | value | meaning |
|---|---|---|
| `ordering_enabled` | `true` | admin/cashier can toggle; customers see view-only menu when off |
| `telegram_language` | `bilingual` | `en`, `am` or `bilingual` |
| `default_language` | `en` | initial EN/አማ choice in UI |
| `vat_mode` / `vat_rate` | `inclusive` / `15` | **display only**, never added to totals |
| `currency_code` / `currency_symbol` | `ETB` | receipt + dashboard display |

`node scripts/seed-users.js` seeds 3 users from the `*_INITIAL_PASSWORD`
variables: `admin`, `waiter1`, `cashier1`. **There is no `kitchen1`.** Every
seeded user has `must_change_password = true`.

`sql/004_menu.sql` seeds 15 categories / 118 items (9 food + 6 drink sections)
and refuses to run once `order_items` exist, so live receipts cannot be
orphaned. Existing databases get the printed-menu price updates via
`npm run migrate:menu` (`sql/013_menu_update.sql`).

Provision a **fresh** project with:

```bash
npm run setup     # apply 001–004, buckets, users, verification
```

---

## 5. Order numbers and receipts

`order_no` comes from a plain Postgres sequence (1001, never wraps) and is
**staff-only**. The public receipt URL uses the random `public_token`
(`/receipt/<token>` / `GET /api/receipt/:token`), never the sequential number.
Orders are inserted and committed **before** Telegram is contacted; a failed
notification is audited, never fatal.

`ordering_enabled=false` is enforced in `POST /api/orders` on the server.
Menu and prices remain editable by admin regardless of the toggle. Totals are
computed server-side from DB prices in integer cents (`src/utils/money.js`);
VAT settings are display only.

### Step 4 API

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/orders` | public | `{table_id,items:[{menu_item_id,quantity}]}` → `{order_no,public_token,total,total_cents,items}`. 409 when ordering is off. |
| GET | `/api/receipt/:token` | public | Token-only; unknown token → 404. |
| GET | `/api/orders`, `/api/orders/live` | all 3 staff roles | Newest first; `live` omits cancelled orders. |
| POST | `/api/orders/:id/cancel` | all 3 staff roles | `{reason}` mandatory; audit `order.cancel`. |
| GET/PUT | `/api/settings` | public / admin | DB-backed JSONB settings; audit `settings.update`. |
| PUT | `/api/settings/ordering` | admin, cashier | `{enabled}`; audit `ordering.toggle`. |
| GET/POST | `/api/tables`, `/api/tables/:id/qr` | public reads | Admin can create/deactivate tables; `GET /api/tables/qr-sheet.pdf` prints all active tables. |
| GET/POST/PUT/DELETE | `/api/menu`, `/api/categories` | public read, admin write | Includes `available`, `sort_order`, bilingual fields and Storage image paths. |

There is no status endpoint, amendment route, customer edit, or order deletion.

---

## 6. Tests — isolated by default, explicit live override

By default smoke tests target a disposable project only. Copy
`.env.test.example` to `.env.test` and fill it with a separate Supabase project
plus dedicated smoke users:

```bash
TEST_DATABASE_URL=postgresql://...          # disposable project
TEST_SUPABASE_URL=https://<test-ref>.supabase.co
TEST_SUPABASE_SERVICE_ROLE_KEY=...
TEST_SUPABASE_ANON_KEY=...
SMOKE_ADMIN_PASSWORD=<random>
SMOKE_WAITER_PASSWORD=<random>
SMOKE_CASHIER_PASSWORD=<random>
```

`npm run smoke` targets that project and refuses to start if
`TEST_DATABASE_URL` equals the live `DATABASE_URL`, if the test project equals
the live project, or if the test DB URL contains the live project ref. It seeds
`smoke_admin` / `smoke_waiter` / `smoke_cashier` (with
`must_change_password = false`) via `npm run seed:smoke-users`, creates tagged
rows and removes them with `npm run smoke:cleanup`. `audit_log` is append-only
and is left intact — reset the test project when a clean trail is needed.

`npm run smoke:offline` uses an in-process REST stub for network-free checks.

**Live override (explicitly authorised for this project):** set
`ALLOW_LIVE_SMOKE=1` to point `seed:smoke-users`, `smoke` and `smoke:cleanup` at
`.env`. The same restrictions apply: only `smoke_*` accounts are used, cleanup
**deactivates** them (never the real admin) and removes tagged data, and the
append-only audit rows stay until the one-time purge in § 9. Do not smoke after
that purge.

`npm run reset` is **test-only**: it requires both an isolated `.env.test` and
`ALLOW_TEST_RESET=1` (`npm run reset:test`). It can never drop live tables, and
`ALLOW_LIVE_SMOKE` does not change that guard.

---

## 7. Verification

After `npm run setup`, the script checks: 8 tables, 3 roles / 3 seed users,
no payments/status/VAT columns, `public_token` unique, cancel-reason check,
`must_change_password` and display-only VAT settings, 30 tables, 15/118 menu
rows, settings, RLS on 8 tables and append-only audit triggers.

Useful queries:

```sql
select distinct role from users;                       -- admin, cashier, waiter
select to_regclass('public.payments');                 -- null
select column_name from information_schema.columns
 where table_name='orders' and column_name in ('status','public_token','cancel_reason');
select key, value from settings
 where key in ('ordering_enabled','telegram_language','vat_mode','vat_rate');
select count(*) from information_schema.columns
 where table_name='users' and column_name='must_change_password';  -- 1
```

---

## 8. Assumptions recorded

1. Orders start at `order_no` 1001 and are never deleted; cancellation only
   sets `cancel_reason`, `cancelled_by`, `cancelled_at` and is audited.
2. Customers can view the menu and receive a receipt, but cannot edit, cancel
   or look up an order by number. The receipt key is random and unguessable.
3. Tokens: HMAC-signed `uid` + `token_version`, no expiry; revocation by
   bumping the version or logging out. Also delivered as an HttpOnly cookie.
   Role is always reloaded from the DB.
4. Login is rate-limited (5 failures / 15 min per username/IP); auth events
   including failures are audited. `JWT_SECRET` is mandatory in production.
5. Ordering toggle: admin + cashier, audited. Menu/prices: admin only. Order
   view + cancel: admin + cashier + waiter.
6. Prices are the total in the configured currency. VAT is shown from
   `vat_mode`/`vat_rate` for display only and is never added to a total; there
   is no service charge.
7. One order per cart; drinks are ordinary menu categories. No amendments.
8. EN/አማ strings are externalized (`src/i18n/strings.js`, added in Step 6);
   Telegram uses `telegram_language` (`bilingual` default).
9. Dashboard auto-refreshes and highlights/sounds on new orders. Each staff
   role sees the same order list; only reason-bearing cancel is an action.
10. RLS is on everywhere; anon policies are only for future client-side reads.
11. All existing staff are forced to set a new password after the migration.

---

## 9. One-time live audit purge (owner-run, before handover)

The migration and smoke never delete live audit rows. Immediately before
handover, the owner should run the following **manually** in the SQL Editor,
in a logged session. It records the purge itself, removes only the two trigger
guards for the duration of the transaction and restores the exact definitions
from `001_schema.sql`. Do not automate this and do not change the append-only
triggers in application or migration code.

```sql
begin;

insert into audit_log (action, entity_type, entity_id, after)
values (
  'audit.purge', 'audit_log', 'live',
  jsonb_build_object(
    'reason', 'one-time pre-handover cleanup',
    'rows_before', (select count(*) from audit_log)
  )
);

drop trigger audit_log_no_update on audit_log;
drop trigger audit_log_no_delete on audit_log;

delete from audit_log where action <> 'audit.purge';

create trigger audit_log_no_update before update on audit_log
  for each row execute function audit_log_append_only();
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function audit_log_append_only();

commit;

-- Verify: 2 triggers, 1 surviving purge row.
select count(*) as triggers from pg_trigger
 where tgrelid='audit_log'::regclass and not tgisinternal;   -- 2
select action, created_at from audit_log order by id;        -- audit.purge
```

The same procedure is saved as `sql/011_purge_audit_live.sql`. If your
`audit_log` lacks the `after` column, drop that argument and the
`jsonb_build_object(...)` line; the purge row still records the action.

---

## 10. Checklist

- [ ] `.env` filled in (no `KITCHEN_INITIAL_PASSWORD` needed)
- [ ] **Live project:** `npm run backup`, `npm run migrate`, then `npm run migrate:step4`
- [ ] `npm run verify:db` passes (including `create_order` RPC checks)
- [ ] All staff forced to change password on next login
- [ ] Three Storage buckets created
- [ ] 3 staff users seeded (**for fresh projects only**); no `kitchen1`
- [ ] `ordering_enabled`, `telegram_language`, `vat_mode`, `vat_rate` in settings
- [ ] Smoke completed (isolated `.env.test` project, or `ALLOW_LIVE_SMOKE=1` on this live project); `smoke_*` users deactivated
- [ ] `npm run smoke:offline` passes
- [ ] **Last step before handover:** one-time live `audit_log` purge (§ 9); no smoke afterwards
- [ ] Rotate initial passwords
