/**
 * Shared pg Client factory.
 *
 * Supabase's Supavisor pooler terminates TLS with a self-signed certificate,
 * so TLS must be enabled without full chain verification for *.supabase.com
 * hosts. Local/other databases keep the default (no ssl option).
 */
const { Client } = require('pg');

function dbClient(connectionString, connectionTimeoutMillis = 20000) {
  const options = { connectionString, connectionTimeoutMillis };
  if (String(connectionString).includes('supabase.com')) {
    options.ssl = { rejectUnauthorized: false };
  }
  return new Client(options);
}

module.exports = dbClient;
