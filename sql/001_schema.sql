-- Cupcake Delight -- 001_schema.sql
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_type where typname='user_role') then
    create type user_role as enum ('admin','waiter','kitchen','cashier');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname='menu_section') then
    create type menu_section as enum ('food','drink','other');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname='order_status') then
    create type order_status as enum ('pending','confirmed','preparing','ready','completed','cancelled');
  else
    alter type order_status add value if not exists 'confirmed';
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
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trial deployments do not force a password change on first login. Drop the
-- legacy flag if an earlier version of this schema created it.
alter table users drop column if exists must_change_password;

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

create table if not exists orders (
  id bigserial primary key,
  order_no integer not null unique default nextval('order_number_seq'),
  table_id bigint not null references dining_tables(id) on delete restrict,
  status order_status not null default 'pending',
  currency text not null default 'ETB',
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  vat_mode text not null check (vat_mode in ('inclusive','exclusive')),
  vat_rate numeric(12,2) not null default 15 check (vat_rate >= 0),
  vat_amount numeric(12,2) not null default 0 check (vat_amount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  special_notes text,
  cancel_reason text,
  cancelled_by bigint references users(id) on delete set null,
  placed_by bigint references users(id) on delete set null,
  updated_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'cancelled' or (cancel_reason is not null and btrim(cancel_reason) <> ''))
);
create index if not exists orders_table_idx on orders (table_id);
create index if not exists orders_status_idx on orders (status);

create table if not exists order_items (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  menu_item_id bigint references menu_items(id) on delete set null,
  name_snapshot text not null,
  name_am_snapshot text,
  price_snapshot numeric(12,2) not null check (price_snapshot >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  notes text
);
create index if not exists order_items_order_idx on order_items (order_id);

create table if not exists payments (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  method text not null default 'cash',
  status text not null default 'completed' check (status in ('pending','completed','failed','refunded')),
  currency text not null default 'ETB',
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

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
alter table payments enable row level security;
alter table audit_log enable row level security;
alter table settings enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname='public' and tablename in
           ('users','menu_categories','menu_items','dining_tables','orders','order_items','payments','audit_log','settings') loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

create or replace function calc_order_total(p_subtotal numeric, p_vat_mode text, p_vat_rate numeric)
returns table (vat_amount numeric, total numeric)
language sql as $$
  select
    case when p_vat_mode='exclusive' then round(p_subtotal * p_vat_rate / 100, 2)
         else round(p_subtotal - (p_subtotal / (1 + p_vat_rate / 100)), 2) end,
    case when p_vat_mode='exclusive' then p_subtotal + round(p_subtotal * p_vat_rate / 100, 2)
         else p_subtotal end;
$$;
