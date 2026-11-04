/**
 * One-shot Supabase provisioning for Cupcake Delight.
 *
 *   node scripts/db-setup.js
 *
 * Applies sql/001_schema.sql, sql/002_seed.sql and sql/003_storage.sql,
 * creates the three Storage buckets, then runs the verification queries
 * from SUPABASE_SETUP.md §7.
 *
 * Safe to re-run: every statement is idempotent.
 * Exits non-zero if any verification check fails.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SQL_DIR = path.join(__dirname, '..', 'sql');
const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.SUPABASE_DB_URL;

const BUCKETS = [
  { id: 'logo', file_size_limit: 2 * 1024 * 1024, allowed_mime_types: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] },
  { id: 'hero', file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] },
  { id: 'menu-items', file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] },
];

function readSql(name) {
  return fs.readFileSync(path.join(SQL_DIR, name), 'utf8');
}

async function applySql(client, name) {
  process.stdout.write(`  applying ${name} ... `);
  await client.query(readSql(name));
  console.log('ok');
}

async function ensureBuckets() {
  process.stdout.write('  creating storage buckets ... ');
  const created = [];
  for (const b of BUCKETS) {
    const res = await fetch(`${URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        name: b.id,
        public: true,
        file_size_limit: b.file_size_limit,
        allowed_mime_types: b.allowed_mime_types,
      }),
    });
    if (res.ok) created.push(b.id);
    else {
      const text = await res.text();
      // 409 = already exists, which is fine for a re-run
      if (text.includes('already exists') || res.status === 409) created.push(`${b.id} (exists)`);
      else throw new Error(`bucket ${b.id}: HTTP ${res.status} ${text}`);
    }
  }
  console.log('ok -> ' + created.join(', '));
}

const CHECKS = [
  ['30 tables seeded', `select count(*) n from tables`, (r) => Number(r.n) === 30],
  ['qr_token unique', `select count(*) n from (select distinct qr_token from tables) x`, (r) => Number(r.n) === 30],
  ['order_no sequence starts at 1001', `select min_value::int n from pg_sequences where sequencename='order_number_seq'`, (r) => Number(r.n) === 1001],
  ['order_no is UNIQUE', `select count(*) n from pg_constraint where conrelid='orders'::regclass and contype='u' and pg_get_constraintdef(oid) like '%order_no%'`, (r) => Number(r.n) === 1],
  ['currency = ETB', `select value#>>'{}' n from settings where key='currency_code'`, (r) => r.n === 'ETB'],
  ['vat_rate = 15', `select value#>>'{}' n from settings where key='vat_rate'`, (r) => r.n === '15'],
  ['vat_mode = inclusive', `select value#>>'{}' n from settings where key='vat_mode'`, (r) => r.n === 'inclusive'],
  ['require_waiter_confirmation = true', `select value#>>'{}' n from settings where key='require_waiter_confirmation'`, (r) => r.n === 'true'],
  ['4 roles, no bartender', `select count(distinct role)::int n from users`, (r) => Number(r.n) === 4],
  ['no bartender role exists', `select count(*) n from pg_enum where enumlabel='bartender' and enumtypid=(select oid from pg_type where typname='user_role')`, (r) => Number(r.n) === 0],
  ['4 seed users active', `select count(*) n from users where active`, (r) => Number(r.n) === 4],
  ['no order_amendments table', `select to_regclass('public.order_amendments') n`, (r) => r.n === null],
  ['no public_token column', `select count(*) n from information_schema.columns where column_name in ('public_token','must_change_password')`, (r) => Number(r.n) === 0],
  ['7 menu categories', `select count(*) n from menu_categories`, (r) => Number(r.n) === 7],
  ['calc_order_total() exists', `select count(*) n from pg_proc where proname='calc_order_total'`, (r) => Number(r.n) === 1],
  ['RLS on all 8 tables', `select count(*) n from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='public' and c.relkind='r' and c.relrowsecurity`, (r) => Number(r.n) === 8],
];

async function verify(client) {
  console.log('\nVerification:');
  let failed = 0;
  for (const [label, sql, ok] of CHECKS) {
    let pass = false;
    let detail = '';
    try {
      const res = await client.query(sql);
      const row = res.rows[0] || {};
      pass = ok(row);
      detail = JSON.stringify(row);
    } catch (e) {
      detail = e.message;
    }
    if (!pass) failed++;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : '  -> ' + detail}`);
  }

  // VAT arithmetic spot-check
  console.log('\nVAT arithmetic (calc_order_total):');
  const cases = [
    ['exclusive 15% on 100.00', '100.00', 'exclusive', 15, '15.00', '115.00'],
    ['inclusive 15% on 115.00', '115.00', 'inclusive', 15, '15.00', '115.00'],
    ['inclusive 0% on 50.00', '50.00', 'inclusive', 0, '0.00', '50.00'],
  ];
  for (const [label, sub, mode, rate, expVat, expTotal] of cases) {
    const r = await client.query(`select vat_amount::text v, total::text t from calc_order_total($1::numeric,$2,$3::numeric)`, [sub, mode, rate]);
    const pass = r.rows[0].v === expVat && r.rows[0].t === expTotal;
    if (!pass) failed++;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label} -> vat ${r.rows[0].v}, total ${r.rows[0].t} (expected ${expVat}/${expTotal})`);
  }
  return failed;
}

async function main() {
  if (!URL || !SERVICE_KEY || !DB_URL) {
    console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_DB_URL in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 20000 });
  await client.connect();

  console.log('Applying SQL:');
  await applySql(client, '001_schema.sql');
  await applySql(client, '002_seed.sql');
  await applySql(client, '003_storage.sql');

  console.log('\nStorage:');
  await ensureBuckets();

  const failed = await verify(client);
  await client.end();

  if (failed) {
    console.error(`\n${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed. Supabase is provisioned.');
}

main().catch((e) => {
  console.error('\nSETUP FAILED:', e.message);
  process.exit(1);
});
