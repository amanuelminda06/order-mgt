/**
 * Shared target selection for smoke scripts.
 *
 * Default: the disposable project in .env.test, which must be provably
 * separate from the live project in .env. `assertIsolated()` remains strict and
 * is the only guard used by db-reset.js.
 *
 * Explicit override: ALLOW_LIVE_SMOKE=1 points smoke/seed/cleanup at the live
 * project in .env. This does NOT relax the reset guard. It exists because the
 * owner authorised live smoke with dedicated smoke_* users only.
 */
const path = require('path');

require('dotenv').config(); // .env      -> live project
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') }); // test project

const LIVE_DB = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const TEST_DB = process.env.TEST_DATABASE_URL;
const ALLOW_LIVE_SMOKE = process.env.ALLOW_LIVE_SMOKE === '1';

function project(url) {
  return String(url || '').match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1] || null;
}

function assertIsolated() {
  if (!TEST_DB) {
    throw new Error('Missing TEST_DATABASE_URL in .env.test (copy .env.test.example)');
  }
  if (!process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY in .env.test');
  }
  if (LIVE_DB && TEST_DB === LIVE_DB) {
    throw new Error('Refusing to run: TEST_DATABASE_URL equals the live DATABASE_URL');
  }

  const liveProject = project(process.env.SUPABASE_URL);
  if (!liveProject) {
    throw new Error('Live SUPABASE_URL missing from .env — cannot prove the test project is separate');
  }
  const testProject = project(process.env.TEST_SUPABASE_URL);
  if (testProject && testProject === liveProject) {
    throw new Error('Refusing to run: test Supabase project equals the live project (' + liveProject + ')');
  }
  if (String(TEST_DB).includes(liveProject)) {
    throw new Error('Refusing to run: TEST_DATABASE_URL points at the live Supabase project (' + liveProject + ')');
  }
}

/** Explicit, audited opt-in to smoke against the live project. Never used by reset. */
function assertLiveSmoke() {
  if (!ALLOW_LIVE_SMOKE) {
    throw new Error('Live smoke is disabled. Set ALLOW_LIVE_SMOKE=1 to target the live project explicitly.');
  }
  if (!LIVE_DB || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Live DATABASE_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');
  }
  const liveProject = project(process.env.SUPABASE_URL);
  if (!liveProject || !String(LIVE_DB).includes(liveProject)) {
    throw new Error('DATABASE_URL does not match SUPABASE_URL project ' + liveProject);
  }
}

/** Resolve and activate the target env for seed/smoke/cleanup scripts. */
function useSmokeEnv() {
  if (ALLOW_LIVE_SMOKE) {
    assertLiveSmoke();
    process.env.DATABASE_URL = LIVE_DB;
    process.env.SUPABASE_DB_URL = LIVE_DB;
    return { live: true, databaseUrl: LIVE_DB, supabaseUrl: process.env.SUPABASE_URL };
  }
  assertIsolated();
  process.env.DATABASE_URL = TEST_DB;
  process.env.SUPABASE_DB_URL = TEST_DB;
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.TEST_SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
  }
  return {
    live: false, databaseUrl: TEST_DB, supabaseUrl: process.env.SUPABASE_URL,
  };
}

/** Legacy name used by the destructive test-only reset script. */
function useTestEnv() {
  assertIsolated();
  process.env.DATABASE_URL = TEST_DB;
  process.env.SUPABASE_DB_URL = TEST_DB;
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.TEST_SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
  }
}

module.exports = {
  assertIsolated, assertLiveSmoke, useSmokeEnv, useTestEnv, project, ALLOW_LIVE_SMOKE,
};
