-- ─────────────────────────────────────────────────────────────
-- Cupcake Delight — 001_schema.sql
-- Applied by scripts/db-setup.js (or paste into the SQL Editor).
-- Idempotent: uses IF NOT EXISTS / OR REPLACE throughout.
-- ─────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── 1. Users (staff) ─────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'waiter', 'kitchen', 'cashier');
  end if;
end $$;

create table if not exists users (
  id                  bigserial primary key,
  username            text not null unique,
  password_hash       text not null,
  full_name           text not null,
  role                user_role not null,
  active              boolean not null default true,
  -- revocation: bumped on password change/reset, deactivation, logout
  token_version       integer not null default 0,
  password_changed_at timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── 2. Menu categories ───────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'menu_section') then
    create type menu_section as enum ('food', 'drink', 'other');
  end if;
end $$;

create table if not exists menu_categories (
  id         bigserial primary key,
  name       text not null,
  name_am    text,                          -- Amharic
  section    menu_section not null default 'food',
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, section)
);

-- ── 3. Menu items ────────────────────────────────────────────
create table if not exists menu_items (
  id               bigserial primary key,
  name             text not null,
  name_am          text,
  description      text,
  description_am   text,
  category_id      bigint not null references menu_categories(id) on delete restrict,
  price            numeric(12,2) not null check (price >= 0),
  available        boolean not null default true,
  image_path       text,                    -- Supabase Storage path, NOT a URL
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists menu_items_category_idx on menu_items (category_id);

-- ── 4. Tables (dine-in) ──────────────────────────────────────
-- Deactivate/reactivate only: there is intentionally NO delete endpoint.
create table if not exists tables (
  id           bigserial primary key,
  table_number integer not null unique,
  name         text not null,
  capacity     integer not null default 4,
  qr_token     text not null unique,        -- random 32-char hex
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── 5. Order number sequence (plain, starts at 1001) ─────────
-- Monotonically increasing, never wraps => order_no is UNIQUE.
create sequence if not exists order_number_seq start 1001 minvalue 1001;

-- ── 6. Orders ────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum
      ('pending', 'preparing', 'ready', 'completed', 'cancelled');
  end if;
end $$;

create table if not exists orders (
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
create index if not exists orders_table_idx  on orders (table_id);
create index if not exists orders_status_idx on orders (status);
-- order_no: no extra index needed, the UNIQUE constraint indexes it

-- ── 7. Order items (price/name snapshotted at order time) ────
create table if not exists order_items (
  id               bigserial primary key,
  order_id         bigint not null references orders(id) on delete cascade,
  menu_item_id     bigint references menu_items(id) on delete set null,
  name_snapshot    text not null,
  name_am_snapshot text,
  price_snapshot   numeric(12,2) not null check (price_snapshot >= 0),
  quantity         integer not null check (quantity > 0),
  line_total       numeric(12,2) not null check (line_total >= 0),
  notes            text
);
create index if not exists order_items_order_idx on order_items (order_id);

-- ── 8. Audit log (every staff mutation) ──────────────────────
create table if not exists audit_log (
  id            bigserial primary key,
  actor_user_id bigint references users(id) on delete set null,
  actor_role    text,
  action        text not null,              -- e.g. 'order.cancel', 'user.password_reset'
  entity_type   text not null,              -- 'order','user','menu_item',...
  entity_id     text not null,
  before        jsonb,
  after         jsonb,
  ip            text,
  created_at    timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on audit_log (entity_type, entity_id);
create index if not exists audit_log_actor_idx  on audit_log (actor_user_id, created_at desc);

-- ── 9. Settings (key/value, currency + VAT live here) ────────
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_by bigint references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ── 10. RLS ──────────────────────────────────────────────────
-- order_number_seq is a SEQUENCE, not a table: RLS does not apply.
alter table users            enable row level security;
alter table menu_categories  enable row level security;
alter table menu_items       enable row level security;
alter table tables           enable row level security;
alter table orders           enable row level security;
alter table order_items      enable row level security;
alter table audit_log        enable row level security;
alter table settings         enable row level security;

-- With the service-role key, RLS is bypassed server-side. These policies
-- exist only for optional future client-side reads with the anon key.
drop policy if exists "public menu read"     on menu_items;
create policy "public menu read"
  on menu_items for select using (available = true);

drop policy if exists "public categories read" on menu_categories;
create policy "public categories read"
  on menu_categories for select using (active = true);

-- ── 11. Order total calculation (SQL, no float math) ─────────
create or replace function calc_order_total(
  p_subtotal numeric, p_vat_mode text, p_vat_rate numeric
) returns table (vat_amount numeric, total numeric)
language sql as $$
  select
    case when p_vat_mode = 'exclusive'
         then round(p_subtotal * p_vat_rate / 100, 2)
         else round(p_subtotal - (p_subtotal / (1 + p_vat_rate / 100)), 2)
    end as vat_amount,
    case when p_vat_mode = 'exclusive'
         then p_subtotal + round(p_subtotal * p_vat_rate / 100, 2)
         else p_subtotal
    end as total;
$$;
