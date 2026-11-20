/**
 * Remove mutable rows created by smoke.js from the selected smoke target.
 *
 * On the live project the dedicated smoke_* users are DEACTIVATED, not deleted,
 * and the append-only audit_log is left untouched for the documented one-time
 * pre-handover purge (sql/011_purge_audit_live.sql).
 */
const { useSmokeEnv } = require('./test-env');
useSmokeEnv();
const dbClient = require('./db-client');

async function cleanup() {
  const client = dbClient(process.env.DATABASE_URL);
  await client.connect();
  try {
    await client.query('begin');
    // Orders placed by the smoke suite carry a marker in special_notes.
    await client.query(`
      delete from order_items where order_id in (
        select id from orders where special_notes like 'SMOKE%'
      )
    `);
    await client.query("delete from orders where special_notes like 'SMOKE%'");
    await client.query("delete from menu_items where name in ('SMOKE ITEM','SMOKE ITEM 2')");
    await client.query("delete from menu_categories where name in ('SMOKE CAT','SMOKE CAT 2')");
    // smoke.js creates one high-numbered table and deactivates it; remove that
    // exact reserved row so live keeps no test tables. Real tables are 1..30.
    await client.query("delete from dining_tables where table_number >= 90000 and name like 'SMOKE TABLE %'");
    // Do NOT delete extra smoke users: audit_log.actor_user_id has an ON DELETE
    // SET NULL FK, and the append-only trigger rejects that implicit UPDATE.
    // Deactivate every smoke-named account instead; they are clearly tagged.
    await client.query(`
      update users set active=false, token_version=token_version+1, updated_at=now()
       where username like 'smoke%' or username = 'badrole'
    `);
    await client.query('commit');
    console.log('Smoke rows removed; smoke_* users deactivated (audit_log left append-only).');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  cleanup().catch((e) => { console.error('SMOKE CLEANUP FAILED:', e.message); process.exit(1); });
}
module.exports = cleanup;
