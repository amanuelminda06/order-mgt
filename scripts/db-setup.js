require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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
  ['9 tables', "select count(*) n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'", (r) => Number(r.n) === 9],
  ['users table', "select count(*) n from information_schema.tables where table_schema='public' and table_name='users'", (r) => Number(r.n) === 1],
  ['dining_tables table', "select count(*) n from information_schema.tables where table_schema='public' and table_name='dining_tables'", (r) => Number(r.n) === 1],
  ['payments table', "select count(*) n from information_schema.tables where table_schema='public' and table_name='payments'", (r) => Number(r.n) === 1],
  ['30 dining tables', 'select count(*) n from dining_tables', (r) => Number(r.n) === 30],
  ['qr_token unique', 'select count(*) n from (select distinct qr_token from dining_tables) x', (r) => Number(r.n) === 30],
  ['order_no sequence starts at 1001', "select min_value::int n from pg_sequences where sequencename='order_number_seq'", (r) => Number(r.n) === 1001],
  ['order_no unique', "select count(*) n from pg_constraint where conrelid='orders'::regclass and contype='u' and pg_get_constraintdef(oid) like '%order_no%'", (r) => Number(r.n) === 1],
  ['currency = ETB', "select value#>>'{}' n from settings where key='currency_code'", (r) => r.n === 'ETB'],
  ['vat_rate = 15', "select value#>>'{}' n from settings where key='vat_rate'", (r) => r.n === '15'],
  ['vat_mode = inclusive', "select value#>>'{}' n from settings where key='vat_mode'", (r) => r.n === 'inclusive'],
  ['require_waiter_confirmation = true', "select value#>>'{}' n from settings where key='require_waiter_confirmation'", (r) => r.n === 'true'],
  ['4 roles', "select count(distinct role)::int n from users", (r) => Number(r.n) === 4],
  ['no bartender role', "select count(*) n from pg_enum where enumlabel='bartender' and enumtypid=(select oid from pg_type where typname='user_role')", (r) => Number(r.n) === 0],
  ['4 seed users', 'select count(*) n from users', (r) => Number(r.n) === 4],
  ['order_status has confirmed', "select count(*) n from pg_enum where enumlabel='confirmed' and enumtypid=(select oid from pg_type where typname='order_status')", (r) => Number(r.n) === 1],
  ['cancel reason check', "select count(*) n from pg_constraint where conrelid='orders'::regclass and contype='c' and pg_get_constraintdef(oid) like '%cancel_reason%'", (r) => Number(r.n) >= 1],
  ['15 menu categories', 'select count(*) n from menu_categories', (r) => Number(r.n) === 15],
  ['114 menu items', 'select count(*) n from menu_items', (r) => Number(r.n) === 114],
  ['9 food + 6 drink categories', "select count(*) filter (where section='food')::int f, count(*) filter (where section='drink')::int d from menu_categories", (r) => Number(r.f) === 9 && Number(r.d) === 6],
  ['every item has a category', 'select count(*) n from menu_items m left join menu_categories c on c.id=m.category_id where c.id is null', (r) => Number(r.n) === 0],
  ['all prices safe', 'select count(*) n from menu_items where price < 0 or price <> round(price,2)', (r) => Number(r.n) === 0],
  ['sample price', "select price::text n from menu_items where name='Delight Special Pizza'", (r) => r.n === '980.00'],
  ['brand name', "select value#>>'{}' n from settings where key='brand_name'", (r) => r.n === 'Cupcake Delights'],
  ['calc_order_total exists', "select count(*) n from pg_proc where proname='calc_order_total'", (r) => Number(r.n) === 1],
  ['RLS on all 9 tables', "select count(*) n from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='public' and c.relkind='r' and c.relrowsecurity", (r) => Number(r.n) === 9],
  ['no policies on app tables', "select count(*) n from pg_policies where schemaname='public' and tablename in ('users','menu_categories','menu_items','dining_tables','orders','order_items','payments','audit_log','settings')", (r) => Number(r.n) === 0],
  ['audit triggers', "select count(*) n from pg_trigger where tgrelid='audit_log'::regclass and not tgisinternal", (r) => Number(r.n) === 2],
  ['payments money type', "select data_type n from information_schema.columns where table_name='payments' and column_name='amount'", (r) => r.n === 'numeric'],
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
  console.log('\nVAT arithmetic:');
  const cases = [
    ['exclusive 15% on 100.00', '100.00', 'exclusive', 15, '15.00', '115.00'],
    ['inclusive 15% on 115.00', '115.00', 'inclusive', 15, '15.00', '115.00'],
    ['inclusive 0% on 50.00', '50.00', 'inclusive', 0, '0.00', '50.00'],
  ];
  for (const [label, sub, mode, rate, expVat, expTotal] of cases) {
    const r = await client.query('select vat_amount::text v, total::text t from calc_order_total($1::numeric,$2,$3::numeric)', [sub, mode, rate]);
    const pass = r.rows[0].v === expVat && r.rows[0].t === expTotal;
    if (!pass) failed++;
    console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + label + ' -> vat ' + r.rows[0].v + ', total ' + r.rows[0].t);
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
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 20000 });
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
module.exports = { main };
