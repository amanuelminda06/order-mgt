require('dotenv').config();

const { Client } = require('pg');
const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

async function reset() {
  if (!DB_URL) { console.error('Missing DATABASE_URL/SUPABASE_DB_URL'); process.exit(1); }
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 20000 });
  await client.connect();
  const exists = await client.query("select to_regclass('public.orders') as t");
  if (exists.rows[0].t) {
    const r = await client.query('select count(*)::int n from orders');
    if (r.rows[0].n > 0) {
      console.error('Refusing to reset: orders table has ' + r.rows[0].n + ' row(s).');
      await client.end();
      process.exit(1);
    }
  }
  console.log('Dropping schema objects...');
  await client.query(`
    drop table if exists payments, order_items, orders, audit_log, settings, menu_items, menu_categories, dining_tables, users cascade;
    drop table if exists tables cascade;
    drop sequence if exists order_number_seq cascade;
    drop type if exists order_status, user_role, menu_section cascade;
  `);
  await client.end();
  console.log('Rebuilding via db-setup...');
  const setup = require('./db-setup');
  await setup.main();
}

reset().catch((e) => { console.error('RESET FAILED:', e.message); process.exit(1); });
