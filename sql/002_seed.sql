-- ─────────────────────────────────────────────────────────────
-- Cupcake Delight — 002_seed.sql
-- Placeholders only: real content, logo and address arrive later
-- and are replaced through the admin upload screens.
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────

-- ── a. Settings ──────────────────────────────────────────────
insert into settings (key, value) values
  ('brand_name',                '"Cupcake Delights"'),
  ('brand_name_am',             '"ኩፕኬክ ደላይት"'),
  ('tagline',                   '"Freshly baked, every day"'),
  ('tagline_am',                '"በየቀኑ አዲስ የተጋገረ"'),
  ('address',                   '"[PLACEHOLDER - real address pending]"'),
  ('phone',                     '"[PLACEHOLDER]"'),
  ('email',                     '"[PLACEHOLDER]"'),
  ('currency_code',             '"ETB"'),
  ('currency_symbol',           '"ETB"'),
  ('currency_position',         '"before"'),   -- renders "ETB 1,234.56"
  ('vat_mode',                  '"inclusive"'),-- 'inclusive' | 'exclusive'
  ('vat_rate',                  '15'),         -- set 0 if not VAT-registered
  ('default_language',          '"en"'),       -- 'en' | 'am'
  ('require_waiter_confirmation','true'),      -- default ON
  ('logo_path',                 'null'),       -- set after upload
  ('hero_path',                 'null')        -- set after upload
on conflict (key) do nothing;

-- ── b. Staff users ───────────────────────────────────────────
-- INITIAL PASSWORDS (change after first login):
--   admin    -> Admin123
--   waiter1  -> Waiter123
--   kitchen1 -> Kitchen123
--   cashier1 -> Cashier123
insert into users (username, password_hash, full_name, role, token_version) values
  ('admin',    crypt('Admin123', gen_salt('bf', 10)),    'Administrator', 'admin',    0),
  ('waiter1',  crypt('Waiter123', gen_salt('bf', 10)),   'Waiter One',    'waiter',   0),
  ('kitchen1', crypt('Kitchen123', gen_salt('bf', 10)),  'Kitchen One',   'kitchen',  0),
  ('cashier1', crypt('Cashier123', gen_salt('bf', 10)),  'Cashier One',   'cashier',  0)
on conflict (username) do nothing;

-- ── c. 30 dine-in tables ─────────────────────────────────────
insert into tables (table_number, name, capacity, qr_token)
select n,
       'Table ' || n,
       4,
       encode(gen_random_bytes(16), 'hex')   -- 32-char hex token
from generate_series(1, 30) as n
where not exists (select 1 from tables t where t.table_number = n);

-- ── d/e. Menu categories & items ──────────────────────────────
-- NOT seeded here: the full menu lives in 004_menu.sql (15 sections,
-- 114 items). db-setup.js applies it right after this file.
