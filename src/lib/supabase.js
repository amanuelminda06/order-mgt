/**
 * Supabase REST client (fetch-based, no @supabase/supabase-js dependency).
 *
 * Uses the Supabase project's REST endpoint with the service role key for
 * server-side access. All responses are parsed as JSON.
 */
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = require('../config/env');

const REST = `${SUPABASE_URL}/rest/v1`;
const STORAGE = `${SUPABASE_URL}/storage/v1`;

const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function request(method, path, body) {
  const opts = { method, headers: { ...headers } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${REST}/${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path}: HTTP ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * SELECT rows from a table.
 * @param {string} table
 * @param {Object} filters - key=value pairs applied as ?col=eq.val filters
 * @param {string} select - columns to select
 */
async function select(table, filters = {}, select = '*') {
  const qs = new URLSearchParams({ select });
  for (const [k, v] of Object.entries(filters)) qs.append(k, `eq.${v}`);
  qs.append('order', 'sort_order.asc');
  return request('GET', `${table}?${qs}`);
}

/**
 * INSERT a row into a table.
 */
async function insert(table, data) {
  return request('POST', table, data);
}

/**
 * UPDATE a row by id.
 */
async function update(table, id, data) {
  return request('PATCH', `${table}?id=eq.${id}`, data);
}

/**
 * DELETE a row by id.
 */
async function del(table, id) {
  return request('DELETE', `${table}?id=eq.${id}`);
}

/**
 * Upload a file to a Supabase storage bucket (public bucket).
 * Returns the public URL of the uploaded object.
 */
async function upload(bucket, filename, buffer, contentType) {
  const res = await fetch(`${STORAGE}/object/${bucket}/${filename}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase storage upload: HTTP ${res.status} ${text}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filename}`;
}

module.exports = { select, insert, update, del: del, upload, REST, STORAGE };
