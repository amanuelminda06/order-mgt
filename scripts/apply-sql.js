/** Apply an explicit SQL file to the configured database (no reset, no seed). */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dbClient = require('./db-client');

const file = process.argv[2];

async function applySql() {
  if (!file) throw new Error('Usage: node scripts/apply-sql.js sql/<file>.sql');
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Missing DATABASE_URL/SUPABASE_DB_URL in .env');
  const sql = fs.readFileSync(path.resolve(file), 'utf8');
  const client = dbClient(url);
  await client.connect();
  try {
    console.log('Applying ' + path.basename(file) + '...');
    await client.query(sql);
    console.log('Applied ' + path.basename(file) + '.');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  applySql().catch((e) => { console.error('APPLY FAILED:', e.message); process.exit(1); });
}
module.exports = applySql;
