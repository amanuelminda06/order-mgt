-- ─────────────────────────────────────────────────────────────
-- Cupcake Delight — 002_seed.sql
-- Placeholders only: real content, logo and address arrive later
-- and are replaced through the admin upload screens.
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────

-- ── a. Settings ──────────────────────────────────────────────
insert into settings (key, value) values
  ('brand_name',                '"Cupcake Delight"'),
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
-- PLACEHOLDER PASSWORD: CupcakeDelight_2026!
-- Rotate it on first login (admin -> Staff -> change password).
insert into users (username, password_hash, full_name, role, token_version) values
  ('admin',    crypt('CupcakeDelight_2026!', gen_salt('bf', 10)), 'Administrator', 'admin',    0),
  ('waiter1',  crypt('CupcakeDelight_2026!', gen_salt('bf', 10)), 'Waiter One',    'waiter',   0),
  ('kitchen1', crypt('CupcakeDelight_2026!', gen_salt('bf', 10)), 'Kitchen One',   'kitchen',  0),
  ('cashier1', crypt('CupcakeDelight_2026!', gen_salt('bf', 10)), 'Cashier One',   'cashier',  0)
on conflict (username) do nothing;

-- ── c. 30 dine-in tables ─────────────────────────────────────
insert into tables (table_number, name, capacity, qr_token)
select n,
       'Table ' || n,
       4,
       encode(gen_random_bytes(16), 'hex')   -- 32-char hex token
from generate_series(1, 30) as n
where not exists (select 1 from tables t where t.table_number = n);

-- ── d. Menu categories ───────────────────────────────────────
insert into menu_categories (name, name_am, section, sort_order) values
  ('Cakes',       'ኬክ',           'food',  1),
  ('Pastries',    'የጤማ እህሎች',    'food',  2),
  ('Sandwiches',  'ሳንድዊች',       'food',  3),
  ('Coffee',      'ቡና',           'drink', 1),
  ('Tea',         'ሻይ',           'drink', 2),
  ('Juices',      'ጭማሪ',         'drink', 3),
  ('Cold Drinks', 'ቀዝቃዛ መጠጦች', 'drink', 4)
on conflict (name, section) do nothing;

-- ── e. Placeholder menu item (replace via admin upload) ──────
insert into menu_items (name, description, category_id, price)
select '[PLACEHOLDER] Sample Cake',
       'Replace this item with the real menu via the admin panel',
       (select id from menu_categories where name = 'Cakes' and section = 'food'),
       100.00
where not exists (select 1 from menu_items);
