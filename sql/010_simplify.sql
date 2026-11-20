-- Cupcake Delight -- 010_simplify.sql
-- IN-PLACE migration for the live project. DO NOT run scripts/db-reset.js.
-- Preserves: menu_categories, menu_items, dining_tables, settings rows (except
-- the one removed key), audit_log history, Storage buckets/objects, and the
-- order_number_seq sequence.
-- Backs up affected tables into a new schema BEFORE any destructive DDL.

create extension if not exists pgcrypto;

-- 0. Backup snapshot -------------------------------------------------------
do $migration$
declare
  base text := 'backup_pre_simplify_' || to_char(now(), 'YYYYMMDD_HH24MI');
  snap text;
  suffix int := 1;
  t text;
begin
  snap := base;
  while to_regnamespace(snap) is not null loop
    snap := base || '_' || suffix;
    suffix := suffix + 1;
  end loop;
  execute format('create schema %I', snap);
  foreach t in array array[
    'users','menu_categories','menu_items','dining_tables',
    'orders','order_items','payments','audit_log','settings'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('create table %I.%I as table public.%I', snap, t, t);
    end if;
  end loop;
  raise notice 'BACKUP SCHEMA CREATED: %', snap;
end
$migration$;

-- 1. Roles: admin, cashier, waiter only. Any legacy role -> waiter. ---------
-- Backup tables copy column types too, so detach them from the enums we are
-- about to replace/drop; otherwise DROP TYPE fails while a snapshot uses it.
do $migration$
declare s record;
begin
  for s in
    select table_schema, table_name, column_name
      from information_schema.columns
     where table_schema like 'backup_pre_simplify_%'
       and data_type = 'USER-DEFINED'
       and udt_name in ('user_role','order_status')
  loop
    execute format(
      'alter table %I.%I alter column %I type text using %I::text',
      s.table_schema, s.table_name, s.column_name, s.column_name
    );
  end loop;
end
$migration$;

do $migration$
declare
  legacy_labels text;
begin
  if to_regtype('user_role') is null then
    execute $sql$create type user_role as enum ('admin','cashier','waiter')$sql$;
    execute $sql$
      alter table public.users alter column role type user_role
      using (case when role::text in ('admin','cashier') then role::text else 'waiter' end)::user_role
    $sql$;
    execute $sql$alter table public.users alter column role set default 'waiter'$sql$;
    return;
  end if;

  select string_agg(distinct e.enumlabel, ', ') into legacy_labels
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'user_role'
     and e.enumlabel not in ('admin','cashier','waiter');

  if legacy_labels is not null then
    raise notice 'Migrating legacy roles (% ) to waiter', legacy_labels;
    execute 'alter table public.users alter column role drop default';
    execute 'alter type user_role rename to user_role_old';
    execute $sql$create type user_role as enum ('admin','cashier','waiter')$sql$;
    execute $sql$
      alter table public.users alter column role type user_role
      using (case when role::text in ('admin','cashier') then role::text else 'waiter' end)::user_role
    $sql$;
    execute $sql$alter table public.users alter column role set default 'waiter'$sql$;
    execute 'drop type user_role_old';
  end if;
end
$migration$;

-- 2. Forced password change on next login for every existing account. ------
alter table public.users add column if not exists must_change_password boolean not null default true;
update public.users set must_change_password = true;

-- 3. Drop legacy order/payment objects (data was already confirmed empty). -
drop table if exists order_items cascade;
drop table if exists payments cascade;
drop table if exists orders cascade;
-- Drop every overload, whatever its argument types are in the live schema.
do $migration$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'calc_order_total'
  loop
    execute format('drop function if exists %s cascade', fn.sig);
  end loop;
end
$migration$;
drop type if exists order_status;
create sequence if not exists order_number_seq start 1001 minvalue 1001;

-- 4. Simplified orders: "received" only, staff cancel, random public_token.
create table orders (
  id bigserial primary key,
  order_no integer not null unique default nextval('order_number_seq'),
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
create index orders_table_idx on orders (table_id);
create index orders_created_idx on orders (created_at desc);

create table order_items (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  menu_item_id bigint references menu_items(id) on delete set null,
  name_snapshot text not null,
  name_am_snapshot text,
  price_snapshot numeric(12,2) not null check (price_snapshot >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(12,2) not null
    check (line_total = round(price_snapshot * quantity, 2)),
  notes text
);
create index order_items_order_idx on order_items (order_id);

alter table orders enable row level security;
alter table order_items enable row level security;

-- 5. Settings: remove confirmation flag, add toggle/language, restore VAT as
--    DISPLAY-ONLY values. Existing values are never overwritten.
delete from settings where key = 'require_waiter_confirmation';
insert into settings (key, value) values
  ('ordering_enabled',   'true'),
  ('telegram_language',  '"bilingual"'),
  ('vat_mode',           '"inclusive"'),
  ('vat_rate',           '15')
on conflict (key) do nothing;

-- audit_log triggers remain append-only; no policies are added.
