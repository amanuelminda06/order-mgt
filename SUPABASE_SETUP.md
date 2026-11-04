# Supabase Setup — Cupcake Delight

Step-by-step provisioning guide for the Cupcake Delight trial system.
Run the steps in order. Everything here is idempotent where possible.

> **Status:** schema reflects the FINAL spec (amendments removed, no
> `public_token`, `token_version`-based revocation, no `must_change_password`).

---

## 0. Prerequisites

- A Supabase project (you create it) → **Project URL**, **Service Role Key**, **Anon Key**
- `.env` in the project root:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # server only, never exposed
SUPABASE_ANON_KEY=<anon key>                   # only if client-side reads are added later
BASE_URL=https://<your-vercel-domain>          # used to build QR codes
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
JWT_SECRET=<random 32+ bytes>                  # for HMAC session tokens
```

Never commit `.env`. The service-role key bypasses RLS — it must only ever
live server-side.

---

## 1. Create the schema

Supabase Dashboard → **SQL Editor** → New query → paste `sql/001_schema.sql` → Run.

```sql
-- ── 1. Users (staff) ─────────────────────────────────────────────
create type user_role as enum ('admin', 'waiter', 'kitchen', 'cashier');

create table users (
  id                 bigserial primary key,
  username           text not null unique,
  password_hash      text not null,
  full_name          text not null,
  role               user_role not null,
  active             boolean not null default true,
  -- revocation: bumped on password change/reset, deactivation, logout
  token_version      integer not null default 0,
  password_changed_at timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── 2. Menu categories ───────────────────────────────────────────
create type menu_section as enum ('food', 'drink', 'other');

create table menu_categories (
  id         bigserial primary key,
  name       text not null,
  name_am    text,                          -- Amharic
  section    menu_section not null default 'food',
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, section)
);

-- ── 3. Menu items ────────────────────────────────────────────────
create table menu_items (
  id             bigserial primary key,
  name           text not null,
  name_am        text,
  description    text,
  description_am text,
  category_id    bigint not null references menu_categories(id) on delete restrict,
  price          numeric(12,2) not null check (price >= 0),
  available      boolean not null default true,
  image_path     text,                      -- Supabase Storage path, NOT a URL
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index menu_items_category_idx on menu_items (category_id);

-- ── 4. Tables (dine-in) ──────────────────────────────────────────
-- Deactivate/reactivate only: there is intentionally NO delete endpoint.
create table tables (
  id           bigserial primary key,
  table_number integer not null unique,
  name         text not null,
  capacity     integer not null default 4,
  qr_token     text not null unique,        -- random 32-char hex
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── 5. Order number sequence (plain, starts at 1001) ─────────────
-- A normal Postgres SEQUENCE: monotonically increasing, never wraps.
create sequence order_number_seq start 1001 minvalue 1001;

-- ── 6. Orders ────────────────────────────────────────────────────
create type order_status as enum
  ('pending', 'preparing', 'ready', 'completed', 'cancelled');

create table orders (
  id            bigserial primary key,
  -- Sequential from 1001, never wraps, therefore unique.
  order_no      integer not null unique,
  table_id      bigint not null references tables(id) on delete restrict,
  status        order_status not null default 'pending',

  -- Money: all arithmetic happens in SQL on NUMERIC, never in JS.
  currency      text not null default 'ETB',
  subtotal      numeric(12,2) not null default 0 check (subtotal >= 0),
  -- per-order VAT snapshot (settings may change later)
  vat_mode      text not null check (vat_mode in ('inclusive','exclusive')),
  vat_rate      numeric(5,2) not null default 15 check (vat_rate >= 0),
  vat_amount    numeric(12,2) not null default 0 check (vat_amount >= 0),
  total         numeric(12,2) not null default 0 check (total >= 0),

  special_notes text,
  -- cancellation (replaces the old amendments flow)
  cancel_reason text,
  cancelled_by  bigint references users(id) on delete set null,

  placed_by     bigint references users(id) on delete set null,  -- null = QR customer
  updated_by    bigint references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  check (status <> 'cancelled' or cancel_reason is not null)
);
create index orders_table_idx  on orders (table_id);
create index orders_status_idx on orders (status);
-- order_no: no extra index needed, the UNIQUE constraint indexes it

-- ── 7. Order items (price/name snapshotted at order time) ────────
create table order_items (
  id              bigserial primary key,
  order_id        bigint not null references orders(id) on delete cascade,
  menu_item_id    bigint references menu_items(id) on delete set null,
  name_snapshot   text not null,
  name_am_snapshot text,
  price_snapshot  numeric(12,2) not null check (price_snapshot >= 0),
  quantity        integer not null check (quantity > 0),
  line_total      numeric(12,2) not null check (line_total >= 0),
  notes           text
);
create index order_items_order_idx on order_items (order_id);

-- ── 8. Audit log (every staff mutation) ──────────────────────────
create table audit_log (
  id             bigserial primary key,
  actor_user_id  bigint references users(id) on delete set null,
  actor_role     text,
  action         text not null,             -- e.g. 'order.cancel', 'user.password_reset'
  entity_type    text not null,             -- 'order', 'user', 'menu_item', ...
  entity_id      text not null,
  before         jsonb,
  after          jsonb,
  ip             text,
  created_at     timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);
create index audit_log_actor_idx  on audit_log (actor_user_id, created_at desc);

-- ── 9. Settings (key/value, currency + VAT live here) ────────────
create table settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  bigint references users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
```

**Notes on deliberate omissions**
- No `order_amendments` table — amendments were removed from the spec.
- No `public_token` / `qr_token` on orders — customers track by `order_no`.
- No `must_change_password` column — password changes are never forced.
- `orders.order_no` **is** unique: the sequence starts at 1001 and never wraps.

---

## 2. Enable RLS

```sql
alter table users            enable row level security;
alter table menu_categories  enable row level security;
alter table menu_items       enable row level security;
alter table tables           enable row level security;
alter table orders           enable row level security;
alter table order_items      enable row level security;
alter table audit_log        enable row level security;
alter table settings         enable row level security;
-- order_number_seq is a SEQUENCE, not a table: RLS does not apply to it.
-- (Everything else above is a table and must have RLS enabled.)

-- With the service-role key, RLS is bypassed server-side, so no policies
-- are needed for the API. These two policies only matter if you later add
-- client-side reads with the anon key:

create policy "public menu read"
  on menu_items for select using (available = true);
create policy "public categories read"
  on menu_categories for select using (active = true);
```

If you do **not** plan any client-side Supabase access, you can skip the
policies and keep RLS on with zero policies (deny-all for anon) — that is the
safer default.

---

## 3. Storage buckets

Dashboard → **Storage** → New bucket, three times:

| Bucket | Public URL | Allowed types | Max size | Purpose |
|---|---|---|---|---|
| `logo` | public read | png, jpg, svg, webp | 2 MB | Brand logo |
| `hero` | public read | png, jpg, webp | 5 MB | Hero background |
| `menu-items` | public read | png, jpg, webp | 5 MB | Menu item photos |

Then **Storage → Policies** — allow authenticated/service writes only:

```sql
create policy "admin upload logo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'logo');
create policy "admin upload hero"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'hero');
create policy "admin upload menu items"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-items');
create policy "public read assets"
  on storage.objects for select
  using (bucket_id in ('logo','hero','menu-items'));
```

**Naming convention:** store only the *path* in the DB
(`logo/cupcake-delight.png`), never a full URL — public URLs embed the
project ref and would break if the bucket policy changes. The API resolves
paths to signed/public URLs at read time.

---

## 4. Seed data

Run `sql/002_seed.sql`.

**4a. Settings (placeholders until real content arrives)**

```sql
insert into settings (key, value) values
  ('brand_name',            '"Cupcake Delight"'),
  ('brand_name_am',         '"ኩፕኬክ ደላይት"'),
  ('tagline',               '"Freshly baked, every day"'),
  ('tagline_am',            '"በየቀኑ አዲስ የተጋገረ"'),
  ('address',               '"[PLACEHOLDER — real address pending]"'),
  ('phone',                 '"[PLACEHOLDER]"'),
  ('email',                 '"[PLACEHOLDER]"'),
  ('currency_code',         '"ETB"'),
  ('currency_symbol',       '"ETB"'),
  ('currency_position',     '"before"'),      -- renders "ETB 1,234.56"
  ('vat_mode',              '"inclusive"'),   -- 'inclusive' | 'exclusive'
  ('vat_rate',              '15'),            -- set 0 if not VAT-registered
  ('default_language',      '"en"'),          -- 'en' | 'am'
  ('require_waiter_confirmation', 'true'),    -- default ON
  ('logo_path',             'null'),          -- set after upload
  ('hero_path',             'null')           -- set after upload
on conflict (key) do nothing;
```

**4b. Staff users** — placeholder password, rotated on first login:

```sql
-- Replace 'CHANGE_ME_MIN_8_CHARS' before running.
insert into users (username, password_hash, full_name, role, token_version) values
  ('admin',     crypt('CHANGE_ME_MIN_8_CHARS', gen_salt('bf', 10)), 'Administrator', 'admin', 0),
  ('waiter1',   crypt('CHANGE_ME_MIN_8_CHARS', gen_salt('bf', 10)), 'Waiter One',    'waiter', 0),
  ('kitchen1',  crypt('CHANGE_ME_MIN_8_CHARS', gen_salt('bf', 10)), 'Kitchen One',   'kitchen', 0),
  ('cashier1',  crypt('CHANGE_ME_MIN_8_CHARS', gen_salt('bf', 10)), 'Cashier One',   'cashier', 0);
```

> `crypt()` needs `pgcrypto`:
> `create extension if not exists pgcrypto;`

**4c. 30 tables** with random `qr_token`:

```sql
insert into tables (table_number, name, capacity, qr_token)
select n,
       'Table ' || n,
       4,
       encode(gen_random_bytes(16), 'hex')     -- 32-char hex token
from generate_series(1, 30) as n;
```

**4d. Menu categories** (food / drink sections; drinks are categories, not a
separate "bar"):

```sql
insert into menu_categories (name, name_am, section, sort_order) values
  ('Cakes',        'ኬክ',      'food',  1),
  ('Pastries',     'የጤማ እህሎች','food',  2),
  ('Sandwiches',   'ሳንድዊች',  'food',  3),
  ('Coffee',       'ቡና',      'drink', 1),
  ('Tea',          'ሻይ',      'drink', 2),
  ('Juices',       'ጭማሪ',    'drink', 3),
  ('Cold Drinks',  'ቀዝቃዛ መጠጦች','drink', 4);
```

Menu items are **not** seeded — the real menu arrives later. Seed 2–3
clearly-labelled placeholders if you need to test the upload flow:

```sql
insert into menu_items (name, description, category_id, price) values
  ('[PLACEHOLDER] Sample Cake', 'Replace via admin upload', 
   (select id from menu_categories where name = 'Cakes'), 100.00);
```

---

## 5. Order number generation (plain sequence from 1001)

```sql
create sequence order_number_seq start 1001 minvalue 1001;
```

Nothing else is required — call it with `nextval('order_number_seq')` when
creating an order. The sequence only ever increases, never wraps, so
`orders.order_no` is **UNIQUE** and an old number can never be reused. The
public tracker can therefore look the order up directly:

```sql
select order_no, status from orders where order_no = $1;
```

---

## 6. Order total calculation (SQL, no float math)

Totals are computed in the database so JS never touches money:

```sql
create or replace function calc_order_total(
  p_subtotal numeric, p_vat_mode text, p_vat_rate numeric
) returns table (vat_amount numeric, total numeric)
language sql as $$
  select
    case when p_vat_mode = 'exclusive'
         then round(p_subtotal * p_vat_rate / 100, 2)
         else round(p_subtotal - (p_subtotal / (1 + p_vat_rate / 100)), 2)
    end as vat,
    case when p_vat_mode = 'exclusive'
         then p_subtotal + round(p_subtotal * p_vat_rate / 100, 2)
         else p_subtotal
    end as total;
$$;
```

- **exclusive** → cart shows a "VAT excluded" note, VAT added at checkout
- **inclusive** → no note, VAT already inside the price
- The chosen `vat_mode` and `vat_rate` are **copied onto the order row** so a
  later settings change never rewrites history.

---

## 7. Verifying the setup

```sql
-- expect 30
select count(*) from tables;
-- expect 1001 (first call consumes it; the next order gets 1002)
select nextval('order_number_seq');
-- order_no must be unique
select conname from pg_constraint where conrelid='orders'::regclass and contype='u';
-- expect 'ETB', 15, 'inclusive'
select value from settings where key in ('currency_code','vat_rate','vat_mode');
-- expect 4 roles, no bartender
select distinct role from users;
-- confirm amendments are gone
select to_regclass('public.order_amendments');   -- expect null
-- confirm no public_token anywhere
select column_name from information_schema.columns
 where column_name in ('public_token','must_change_password');  -- expect 0 rows
```

Then, in the app: log in as admin → **Tables & QR** should show 30 cards
(each QR pointing at `menu.html?t=<token>` once the token step lands).

---

## 8. Assumptions recorded

1. **Order numbers start at 1001 and increase forever — no wrap-around.**
   `orders.order_no` is therefore `UNIQUE`, an old number is never reused, and
   the public tracker resolves a number to exactly one order. No random
   suffix.
2. **No `must_change_password`** — password changes are never forced. Admin
   can change any user's password; every user can change their own. Min 8
   characters. `password_changed_at` is retained for audit only.
3. **`token_version`** starts at 0 and is incremented on password change,
   password reset, deactivation and logout. Tokens carry `user_id` +
   `token_version`, are HMAC-signed, and have **no fixed expiry**.
4. **No `order_amendments`** table, endpoints or UI. Cancellation replaces it:
   waiter or admin before `preparing`, admin only at/after `preparing`,
   `cancel_reason` mandatory, always audit-logged.
5. **No `public_token`** on orders. Tracking is by sequential `order_no` and
   returns **only** `{order_no, status}` — never items, notes, table or
   prices — and is rate-limited.
6. **`require_waiter_confirmation` defaults to `true`**: a customer order sits
   at `pending` until a waiter confirms it; kitchen can then start.
7. **Currency** is `ETB`, displayed as `ETB 1,234.56`. `vat_rate` defaults to
   `15`, set to `0` if the client turns out not to be VAT-registered.
8. **Tables**: 30 plain tables (`Table 1`–`Table 30`), capacity 4. Admin can
   add tables, deactivate/reactivate, and regenerate `qr_token`. **No hard
   delete** — the endpoint is not exposed at all. Inactive tables are hidden
   from the customer selector and waiter list; their QR shows a friendly
   "table not available" page.
9. **Walk-ins**: a waiter may place an order for any active table from a list,
   with no QR scan.
10. **Roles** are exactly `admin`, `waiter`, `kitchen`, `cashier`. The
    `bartender` role and the food/bar order split are gone; drinks are an
    ordinary menu category handled by the same kitchen.
11. **One order per cart** — no more splitting into a food order and a bar
    order.
12. **Images** are uploaded to Supabase Storage and stored as `image_path`
    (bucket-relative), never as a full URL. Limits: logo 2 MB, hero/menu 5
    MB, png/jpg/svg/webp only.
13. **Content is placeholder** — real menu, logo, hero and address arrive
    later and are replaced through the admin upload screens. Placeholders are
    clearly marked `[PLACEHOLDER]`.
14. **RLS is enabled**; the server uses the service-role key. Anon-key
    policies exist only for public menu/category reads if client-side access
    is added later.
15. **Language**: English and Amharic. `default_language` is `en`; menu items
    carry `name_am` / `description_am`; the user toggle persists per device.
    Amharic is LTR, so no RTL handling is required.
16. **Telegram stays optional** — no-op when `TELEGRAM_BOT_TOKEN` /
    `TELEGRAM_CHAT_ID` are unset — and messages become localized and use the
    configured currency (the legacy hardcoded `ETB` goes away with them).
17. **`order_number_seq` is a plain Postgres `SEQUENCE` starting at 1001** —
    no wrap-around, so `order_no` is unique forever. Postgres sequences are
    allocation-based (nextval is atomic), so concurrent orders cannot receive
    the same number.
18. **Audit scope**: every staff mutation (orders, status changes,
    cancellations, menu, categories, tables, users, passwords, settings,
    uploads) writes to `audit_log` with before/after JSON. Customer reads are
    not audited.

---

## 9. Checklist

- [ ] Project created, `.env` filled in
- [ ] `001_schema.sql` run — no errors
- [ ] RLS enabled on all 8 tables (the sequence needs none)
- [ ] `pgcrypto` extension enabled
- [ ] Three storage buckets created with policies
- [ ] `002_seed.sql` run — settings, users, 30 tables, categories
- [ ] `order_number_seq` created as a SEQUENCE starting at 1001
- [ ] `calc_order_total()` created
- [ ] Verification queries in §7 all return expected values
- [ ] Placeholder admin password rotated
