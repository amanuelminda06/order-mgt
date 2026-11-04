require('dotenv').config();

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

const USERS = [
  { username: 'admin', fullName: 'Administrator', role: 'admin', env: 'ADMIN_INITIAL_PASSWORD' },
  { username: 'waiter1', fullName: 'Waiter One', role: 'waiter', env: 'WAITER_INITIAL_PASSWORD' },
  { username: 'kitchen1', fullName: 'Kitchen One', role: 'kitchen', env: 'KITCHEN_INITIAL_PASSWORD' },
  { username: 'cashier1', fullName: 'Cashier One', role: 'cashier', env: 'CASHIER_INITIAL_PASSWORD' },
];

async function seedUsers() {
  if (!DB_URL) throw new Error('Missing DATABASE_URL/SUPABASE_DB_URL');
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 20000 });
  await client.connect();
  for (const u of USERS) {
    const password = process.env[u.env];
    if (!password) throw new Error('Missing ' + u.env);
    const hash = bcrypt.hashSync(password, 10);
    await client.query(
      `insert into users (username, password_hash, full_name, role, active, token_version, must_change_password)
       values ($1,$2,$3,$4,true,0,true)
       on conflict (username) do update set
         password_hash = excluded.password_hash,
         full_name = excluded.full_name,
         role = excluded.role,
         active = true,
         must_change_password = true,
         updated_at = now()`,
      [u.username, hash, u.fullName, u.role]
    );
    console.log('  seeded user ' + u.username);
  }
  await client.end();
}

if (require.main === module) {
  seedUsers().catch((e) => { console.error('SEED USERS FAILED:', e.message); process.exit(1); });
}
module.exports = seedUsers;
