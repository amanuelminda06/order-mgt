/** Apply the in-place simplification migration (never a reset). */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dbClient = require('./db-client');

const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

async function migrate() {
  if (!DB_URL) throw new Error('Missing DATABASE_URL/SUPABASE_DB_URL in .env');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '010_simplify.sql'), 'utf8');
  const client = dbClient(DB_URL);
  await client.connect();
  try {
    console.log('Applying 010_simplify.sql (backup is the first statement)...');
    await client.query(sql);
    console.log('Migration applied. For a fresh/test DB run `npm run setup`;');
    console.log('for the live DB use the verification queries in SUPABASE_SETUP.md § 7.');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  migrate().catch((e) => { console.error('MIGRATION FAILED:', e.message); process.exit(1); });
}
module.exports = migrate;
