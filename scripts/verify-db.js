/** Run only the schema/data verification checks — never applies SQL or seeds. */
require('dotenv').config();
const dbClient = require('./db-client');
const { verify } = require('./db-setup');

async function verifyDb() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Missing DATABASE_URL/SUPABASE_DB_URL in .env');
  const client = dbClient(url);
  await client.connect();
  try {
    const failed = await verify(client);
    if (failed) throw new Error(failed + ' check(s) FAILED');
    console.log('\nAll verification checks passed.');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  verifyDb().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
}
module.exports = verifyDb;
