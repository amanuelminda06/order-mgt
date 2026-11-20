/** Create an in-DB snapshot of every table touched by 010_simplify.sql. */
require('dotenv').config();
const dbClient = require('./db-client');

const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

const BACKUP_SQL = `
do $$
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
end $$;
`;

async function backup() {
  if (!DB_URL) throw new Error('Missing DATABASE_URL/SUPABASE_DB_URL in .env');
  const client = dbClient(DB_URL);
  await client.connect();
  await client.query(BACKUP_SQL);
  const { rows } = await client.query(
    "select schema_name from information_schema.schemata where schema_name like 'backup_pre_simplify_%' order by schema_name desc limit 1"
  );
  await client.end();
  console.log('Backup schema: ' + rows[0].schema_name);
  return rows[0].schema_name;
}

if (require.main === module) {
  backup().catch((e) => { console.error('BACKUP FAILED:', e.message); process.exit(1); });
}
module.exports = backup;
