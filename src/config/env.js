/**
 * Central configuration, loaded from environment variables.
 * dotenv is initialised here so any entry point (server.js, scripts, tests)
 * gets the same values.
 */
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Smoke tests set their own secret. Production must supply JWT_SECRET.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-do-not-use-in-production';
// 'db' (default) or 'memory' (offline smoke fixture).
const AUTH_STORE = process.env.AUTH_STORE || 'db';
// Forced password change is OFF until the owner switches it on for the real
// deployment (FORCE_PASSWORD_CHANGE=true). The DB flag and the change/reset
// flows stay available so it can be enabled later without a code change.
const FORCE_PASSWORD_CHANGE = process.env.FORCE_PASSWORD_CHANGE === 'true';

function validateConfig() {
  const required = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET };
  if (AUTH_STORE === 'memory') return; // offline test seam
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error('Missing required config: ' + missing.join(', '));
  if (NODE_ENV === 'production' && JWT_SECRET.startsWith('dev-only-secret')) {
    throw new Error('JWT_SECRET must be set to a random value in production');
  }
}

module.exports = {
  NODE_ENV,
  PORT,
  BASE_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  JWT_SECRET,
  AUTH_STORE,
  FORCE_PASSWORD_CHANGE,
  validateConfig,
};
