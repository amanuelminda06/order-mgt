require('dotenv').config();

const fs = require('fs');
const path = require('path');
const dbClient = require('./db-client');

const SQL_DIR = path.join(__dirname, '..', 'sql');
const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

const BUCKETS = [
  { id: 'logo', file_size_limit: 2 * 1024 * 1024, allowed_mime_types: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] },
  { id: 'hero', file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] },
  { id: 'menu-items', file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] },
];

function readSql(name) { return fs.readFileSync(path.join(SQL_DIR, name), 'utf8'); }

async function applySql(client, name) {
  process.stdout.write('  applying ' + name + ' ... ');
  await client.query(readSql(name));
  console.log('ok');
}

async function ensureBuckets() {
  if (!URL || !SERVICE_KEY) { console.log('  skipping buckets (no SUPABASE_URL/SERVICE_KEY)'); return; }
  process.stdout.write('  creating storage buckets ... ');
  const created = [];
  for (const b of BUCKETS) {
    const res = await fetch(URL + '/storage/v1/bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SERVICE_KEY },
      body: JSON.stringify({ name: b.id, public: true, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types }),
    });
    if (res.ok) created.push(b.id);
    else {
      const text = await res.text();
      if (text.includes('already exists') || res.status === 409) created.push(b.id + ' (exists)');
      else throw new Error('bucket ' + b.id + ': HTTP ' + res.status + ' ' + text);
    }
  }
  console.log('ok -> ' + created.join(', '));
}

const CHECKS = [
  ['8 tables', "select count(*) n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'", (r) => Number(r.n) === 8],
  ['users table', "select count(*) n from information_schema.tables where table_schema='public' and table_name='users'", (r) => Number(r.n) === 1],
  ['dining_tables table', "select count(*) n from information_schema.tables where table_schema='public' and table_name='dining_tables'", (r) => Number(r.n) === 1],
  ['no payments table', "select count(*) n from information_schema.tables where table_schema='public' and table_name='payments'", (r) => Number(r.n) === 0],
  ['30 dining tables', 'select count(*) n from dining_tables', (r) => Number(r.n) === 30],
  ['qr_token unique', 'select count(*) n from (select distinct qr_token from dining_tables) x', (r) => Number(r.n) === 30],
  ['qr_token server default', "select count(*) n from information_schema.columns where table_schema='public' and table_name='dining_tables' and column_name='qr_token' and column_default like '%gen_random_bytes%'", (r) => Number(r.n) === 1],
  ['qr_token unique index', "select count(*) n from pg_indexes where schemaname='public' and tablename='dining_tables' and indexname='dining_tables_qr_token_key'", (r) => Number(r.n) === 1],
  ['create_order RPC', "select count(*) n from pg_proc where proname='create_order' and pronamespace='public'::regnamespace", (r) => Number(r.n) >= 1],
  ['order_no sequence starts at 1001', "select min_value::int n from pg_sequences where sequencename='order_number_seq'", (r) => Number(r.n) === 1001],
  ['order_no unique', "select count(*) n from pg_constraint where conrelid='orders'::regclass and contype='u' and pg_get_constraintdef(oid) like '%order_no%'", (r) => Number(r.n) === 1],
  ['public_token unique', "select count(*) n from pg_constraint where conrelid='orders'::regclass and contype='u' and pg_get_constraintdef(oid) like '%public_token%'", (r) => Number(r.n) === 1],
  ['no order_status type', "select count(*) n from pg_type where typname='order_status'", (r) => Number(r.n) === 0],
  ['no status column', "select count(*) n from information_schema.columns where table_schema='public' and table_name='orders' and column_name='status'", (r) => Number(r.n) === 0],
  ['no vat columns', "select count(*) n from information_schema.columns where table_schema='public' and table_name='orders' and column_name like 'vat%'", (r) => Number(r.n) === 0],
  ['no calc_order_total', "select count(*) n from pg_proc where proname='calc_order_total'", (r) => Number(r.n) === 0],
  ['currency = ETB', "select value#>>'{}' n from settings where key='currency_code'", (r) => r.n === 'ETB'],
  ['ordering_enabled = true', "select value#>>'{}' n from settings where key='ordering_enabled'", (r) => r.n === 'true'],
  ['telegram_language = bilingual', "select value#>>'{}' n from settings where key='telegram_language'", (r) => r.n === 'bilingual'],
  ['vat_mode = inclusive (display only)', "select value#>>'{}' n from settings where key='vat_mode'", (r) => r.n === 'inclusive'],
  ['vat_rate = 15 (display only)', "select value#>>'{}' n from settings where key='vat_rate'", (r) => r.n === '15'],
  ['must_change_password column', "select count(*) n from information_schema.columns where table_schema='public' and table_name='users' and column_name='must_change_password'", (r) => Number(r.n) === 1],
  ['no require_waiter_confirmation', "select count(*) n from settings where key='require_waiter_confirmation'", (r) => Number(r.n) === 0],
  ['3 roles', "select count(distinct role)::int n from users", (r) => Number(r.n) === 3],
  ['no kitchen/bartender role', "select count(*) n from pg_enum where enumlabel in ('kitchen','bartender') and enumtypid=(select oid from pg_type where typname='user_role')", (r) => Number(r.n) === 0],
  ['3 seed users', "select count(*) n from users where username in ('admin','waiter1','cashier1')", (r) => Number(r.n) === 3],
  ['cancel reason check', "select count(*) n from pg_constraint where conrelid='orders'::regclass and contype='c' and pg_get_constraintdef(oid) like '%cancel_reason%'", (r) => Number(r.n) >= 1],
  ['15 menu categories', 'select count(*) n from menu_categories', (r) => Number(r.n) === 15],
  ['118 menu items', 'select count(*) n from menu_items', (r) => Number(r.n) === 118],
  ['9 food + 6 drink categories', "select count(*) filter (where section='food')::int f, count(*) filter (where section='drink')::int d from menu_categories", (r) => Number(r.f) === 9 && Number(r.d) === 6],
  ['every item has a category', 'select count(*) n from menu_items m left join menu_categories c on c.id=m.category_id where c.id is null', (r) => Number(r.n) === 0],
  ['all prices safe', 'select count(*) n from menu_items where price < 0 or price <> round(price,2)', (r) => Number(r.n) === 0],
  ['sample price', "select price::text n from menu_items where name='Delight Special Pizza'", (r) => r.n === '1200.00'],
  ['brand name', "select value#>>'{}' n from settings where key='brand_name'", (r) => r.n === 'Cupcake Delights'],
  ['RLS on all 8 tables', "select count(*) n from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='public' and c.relkind='r' and c.relrowsecurity", (r) => Number(r.n) === 8],
  ['no policies on app tables', "select count(*) n from pg_policies where schemaname='public' and tablename in ('users','menu_categories','menu_items','dining_tables','orders','order_items','audit_log','settings')", (r) => Number(r.n) === 0],
  ['audit triggers', "select count(*) n from pg_trigger where tgrelid='audit_log'::regclass and not tgisinternal", (r) => Number(r.n) === 2],
];

async function verify(client) {
  console.log('\nVerification:');
  let failed = 0;
  for (const [label, sql, ok] of CHECKS) {
    let pass = false, detail = '';
    try {
      const res = await client.query(sql);
      const row = res.rows[0] || {};
      pass = ok(row);
      detail = JSON.stringify(row);
    } catch (e) { detail = e.message; }
    if (!pass) failed++;
    console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + label + (pass ? '' : '  -> ' + detail));
  }
  // audit append-only test (rolled back; leaves no rows)
  try {
    await client.query('begin');
    await client.query('insert into audit_log (action, entity_type, entity_id) values ($1,$2,$3)', ['test.append', 'test', '1']);
    await client.query('savepoint upd');
    try {
      await client.query('update audit_log set action=$1 where id=(select max(id) from audit_log)', ['x']);
      failed++; console.log('  FAIL  audit_log UPDATE blocked  -> update succeeded');
    } catch (e) { console.log('  PASS  audit_log UPDATE blocked'); }
    await client.query('rollback to savepoint upd');
    await client.query('savepoint del');
    try {
      await client.query('delete from audit_log where id=(select max(id) from audit_log)');
      failed++; console.log('  FAIL  audit_log DELETE blocked  -> delete succeeded');
    } catch (e) { console.log('  PASS  audit_log DELETE blocked'); }
    await client.query('rollback to savepoint del');
    await client.query('rollback');
  } catch (e) { failed++; console.log('  FAIL  audit_log append test  -> ' + e.message); try { await client.query('rollback'); } catch(_){} }
  return failed;
}

async function main() {
  if (!DB_URL) { console.error('Missing DATABASE_URL/SUPABASE_DB_URL in .env'); process.exit(1); }
  const client = dbClient(DB_URL);
  await client.connect();
  console.log('Applying SQL:');
  await applySql(client, '001_schema.sql');
  await applySql(client, '002_seed.sql');
  await applySql(client, '003_storage.sql');
  await applySql(client, '004_menu.sql');
  console.log('\nStorage:');
  await ensureBuckets();
  console.log('\nSeeding users:');
  const seedUsers = require('./seed-users');
  await seedUsers();
  const failed = await verify(client);
  await client.end();
  if (failed) { console.error('\n' + failed + ' check(s) FAILED'); process.exit(1); }
  console.log('\nAll checks passed. Supabase is provisioned.');
}

if (require.main === module) {
  main().catch((e) => { console.error('\nSETUP FAILED:', e.message); process.exit(1); });
}
module.exports = { main, verify };
