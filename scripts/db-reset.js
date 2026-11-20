/**
 * DESTRUCTIVE — disposable TEST project only.
 *
 * The live database is never reset: it holds the real menu, categories and
 * table tokens. This script refuses to run unless ALL of the following hold:
 *   - .env.test defines a TEST_DATABASE_URL distinct from the live URL
 *   - the test Supabase project differs from the live project
 *   - ALLOW_TEST_RESET=1 is set (use `npm run reset:test`)
 */
require('./test-env').useTestEnv();

if (process.env.ALLOW_TEST_RESET !== '1') {
  console.error('Refusing to reset: set ALLOW_TEST_RESET=1 (npm run reset:test).');
  process.exit(1);
}

const dbClient = require('./db-client');
const DB_URL = process.env.DATABASE_URL; // now the TEST url

async function reset() {
  const client = dbClient(DB_URL);
  await client.connect();
  try {
    const exists = await client.query("select to_regclass('public.orders') as t");
    if (exists.rows[0].t) {
      const r = await client.query('select count(*)::int n from orders');
      if (r.rows[0].n > 0) {
        throw new Error('Refusing to reset: test orders table has ' + r.rows[0].n + ' row(s). Clear it first.');
      }
    }
    console.log('Resetting TEST database only...');
    await client.query(`
      drop table if exists order_items, orders, audit_log, settings, menu_items, menu_categories, dining_tables, users cascade;
      drop table if exists tables cascade;
      drop sequence if exists order_number_seq cascade;
      drop type if exists user_role, menu_section cascade;
    `);
    // Remove any in-DB backup snapshots left by migration rehearsals.
    await client.query(`
      do $$
      declare s record;
      begin
        for s in select schema_name from information_schema.schemata
                 where schema_name like 'backup_pre_simplify_%' loop
          execute format('drop schema %I cascade', s.schema_name);
        end loop;
      end $$;
    `);
  } finally {
    await client.end();
  }
  console.log('Rebuilding via db-setup (still pointed at TEST)...');
  const setup = require('./db-setup');
  await setup.main();
  console.log('TEST database rebuilt. Now run `npm run seed:smoke-users`.');
}

reset().catch((e) => { console.error('TEST RESET FAILED:', e.message); process.exit(1); });
