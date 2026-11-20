/** Restaurant settings repository (DB-backed, JSONB values). */
const { select, upsert } = require('../lib/supabase');

function parseValue(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return value; }
  }
  return value;
}

async function getSettings() {
  const rows = await select('settings', {}, 'key,value', { order: null });
  const out = {};
  for (const row of rows) out[row.key] = parseValue(row.value);
  // Legacy frontends still ask for restaurant_name.
  if (out.restaurant_name === undefined) out.restaurant_name = out.brand_name || '';
  return out;
}

async function setSetting(key, value) {
  await upsert('settings', { key, value }, 'key');
  return { key, value };
}

async function orderingEnabled() {
  const settings = await getSettings();
  return settings.ordering_enabled !== false && String(settings.ordering_enabled) !== 'false';
}

module.exports = { getSettings, setSetting, orderingEnabled, parseValue };
