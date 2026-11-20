/** Seed dedicated smoke_* users into the selected smoke target (never real staff). */
const { useSmokeEnv } = require('./test-env');
const target = useSmokeEnv();
const dbClient = require('./db-client');
const bcrypt = require('bcryptjs');

const USERS = [
  ['smoke_admin', 'SMOKE_ADMIN_PASSWORD', 'admin'],
  ['smoke_waiter', 'SMOKE_WAITER_PASSWORD', 'waiter'],
  ['smoke_cashier', 'SMOKE_CASHIER_PASSWORD', 'cashier'],
];

async function seedSmokeUsers() {
  const client = dbClient(process.env.DATABASE_URL);
  await client.connect();
  try {
    for (const [username, envKey, role] of USERS) {
      const password = process.env[envKey];
      if (!password) throw new Error('Missing ' + envKey + ' in .env.test');
      await client.query(
        `insert into public.users (username, password_hash, full_name, role, active, token_version, must_change_password)
         values ($1,$2,$3,$4,true,0,false)
         on conflict (username) do update set
           password_hash=excluded.password_hash, role=excluded.role, active=true,
           token_version=0, must_change_password=false, updated_at=now()`,
        [username, bcrypt.hashSync(password, 10), username, role]
      );
      console.log('  seeded ' + username + (target.live ? ' (live target)' : ''));
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  seedSmokeUsers().catch((e) => { console.error('SMOKE USER SEED FAILED:', e.message); process.exit(1); });
}
module.exports = seedSmokeUsers;
