-- Cupcake Delight -- 002_seed.sql
insert into settings (key, value) values
  ('brand_name', '"Cupcake Delights"'),
  ('brand_name_am', '"ኩፕኬክ ደላይት"'),
  ('tagline', '"Freshly baked, every day"'),
  ('tagline_am', '"በየቀኑ አዲስ የተጋገረ"'),
  ('address', '"[PLACEHOLDER - real address pending]"'),
  ('phone', '"[PLACEHOLDER]"'),
  ('email', '"[PLACEHOLDER]"'),
  ('currency_code', '"ETB"'),
  ('currency_symbol', '"ETB"'),
  ('currency_position', '"before"'),
  ('vat_mode', '"inclusive"'),
  ('vat_rate', '15'),
  ('default_language', '"en"'),
  ('require_waiter_confirmation', 'true'),
  ('logo_path', 'null'),
  ('hero_path', 'null')
on conflict (key) do nothing;

insert into dining_tables (table_number, name, capacity, qr_token)
select n, 'Table ' || n, 4, encode(gen_random_bytes(16), 'hex')
from generate_series(1, 30) as n
where not exists (select 1 from dining_tables t where t.table_number = n);
