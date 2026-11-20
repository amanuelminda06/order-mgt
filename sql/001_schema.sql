-- Cupcake Delight -- 001_schema.sql
-- Simplified scope: no order status flow, no payments, no kitchen role.
-- This file is applied by scripts/db-setup.js after a reset (no order data to migrate).
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_type where typname='user_role') then
    create type user_role as enum ('admin','cashier','waiter');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname='menu_section') then
    create type menu_section as enum ('food','drink','other');
  end if;
end $$;

create table if not exists users (
  id bigserial primary key,
  username text not null unique,
  password_hash text not null,
  full_name text not null,
  role user_role not null,
  active boolean not null default true,
  token_version integer not null default 0,
  -- Forced password change on first/admin-reset login.
  must_change_password boolean not null default true,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists menu_categories (
  id bigserial primary key,
  name text not null,
  name_am text,
  section menu_section not null default 'food',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, section)
);

create table if not exists menu_items (
  id bigserial primary key,
  name text not null,
  name_am text,
  description text,
  description_am text,
  category_id bigint not null references menu_categories(id) on delete restrict,
  price numeric(12,2) not null check (price >= 0),
  available boolean not null default true,
  image_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists menu_items_category_idx on menu_items (category_id);

create table if not exists dining_tables (
  id bigserial primary key,
  table_number integer not null unique,
  name text not null,
  capacity integer not null default 4,
  qr_token text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists order_number_seq start 1001 minvalue 1001;

-- An order is created as "received". There is no status column and no
-- transition flow. Cancellation is a staff-only, reason-bearing edit; the
-- order row is never deleted.
create table if not exists orders (
  id bigserial primary key,
  order_no integer not null unique default nextval('order_number_seq'),
  -- Random, unguessable receipt key. The public API never accepts order_no.
  public_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  table_id bigint not null references dining_tables(id) on delete restrict,
  currency text not null default 'ETB',
  total numeric(12,2) not null check (total >= 0),
  special_notes text,
  cancel_reason text,
  cancelled_by bigint references users(id) on delete set null,
  cancelled_at timestamptz,
  placed_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cancel_reason is null or btrim(cancel_reason) <> ''),
  check ((cancel_reason is null) = (cancelled_at is null))
);
create index if not exists orders_table_idx on orders (table_id);
create index if not exists orders_created_idx on orders (created_at desc);

create table if not exists order_items (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  menu_item_id bigint references menu_items(id) on delete set null,
  name_snapshot text not null,
  name_am_snapshot text,
  price_snapshot numeric(12,2) not null check (price_snapshot >= 0),
  quantity integer not null check (quantity > 0),
  -- Exact decimal arithmetic: no float rounding in the application layer.
  line_total numeric(12,2) not null
    check (line_total = round(price_snapshot * quantity, 2)),
  notes text
);
create index if not exists order_items_order_idx on order_items (order_id);

create table if not exists audit_log (
  id bigserial primary key,
  actor_user_id bigint references users(id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on audit_log (entity_type, entity_id);
create index if not exists audit_log_actor_idx on audit_log (actor_user_id, created_at desc);

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_by bigint references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function audit_log_append_only() returns trigger
language plpgsql as $$ begin raise exception 'audit_log is append-only'; end; $$;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update on audit_log
  for each row execute function audit_log_append_only();

drop trigger if exists audit_log_no_delete on audit_log;
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function audit_log_append_only();

alter table users enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table dining_tables enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table audit_log enable row level security;
alter table settings enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname='public' and tablename in
           ('users','menu_categories','menu_items','dining_tables','orders','order_items','audit_log','settings') loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;
