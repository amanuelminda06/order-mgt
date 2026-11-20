/**
 * Staff accounts + audit repository.
 *
 * AUTH_STORE=db (default) uses Supabase REST with the service-role key.
 * AUTH_STORE=memory is an offline test seam used by scripts/smoke.js; it uses
 * the seeded fixture in memory-store and keeps audits in process.
 */
const bcrypt = require('bcryptjs');
const { AUTH_STORE } = require('../config/env');
const { select, insert, update } = require('../lib/supabase');
const { staff } = require('./memory-store');

// must_change_password must be selected or the forced-change gate never fires.
const USER_COLUMNS = 'id,username,password_hash,full_name,role,active,token_version,must_change_password,password_changed_at';
const memoryAudits = [];

function normalize(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    password_hash: user.password_hash,
    full_name: user.full_name,
    role: user.role,
    active: user.active !== false,
    token_version: user.token_version || 0,
    must_change_password: user.must_change_password === true,
    password_changed_at: user.password_changed_at || null,
  };
}

async function findUserByUsername(username) {
  if (AUTH_STORE === 'memory') {
    return normalize(staff.find((u) => u.username === username));
  }
  const rows = await select('users', { username }, USER_COLUMNS, { order: null });
  return normalize(rows[0]);
}

async function findUserById(id) {
  if (AUTH_STORE === 'memory') {
    return normalize(staff.find((u) => u.id === Number(id)));
  }
  const rows = await select('users', { id }, USER_COLUMNS, { order: null });
  return normalize(rows[0]);
}

async function listUsers() {
  if (AUTH_STORE === 'memory') return staff.map(normalize);
  return (await select('users', {}, USER_COLUMNS, { order: 'id.asc' })).map(normalize);
}

async function createUser({ username, password, full_name, role }) {
  const password_hash = bcrypt.hashSync(password, 10);
  if (AUTH_STORE === 'memory') {
    if (staff.some((u) => u.username === username)) return null;
    const user = {
      id: Math.max(0, ...staff.map((u) => u.id)) + 1,
      username, password_hash, full_name, role, active: true, token_version: 0,
    };
    staff.push(user);
    return normalize(user);
  }
  const rows = await insert('users', { username, password_hash, full_name, role, active: true });
  return normalize(rows[0]);
}

async function updateUser(id, changes) {
  const data = { ...changes };
  if (data.password) {
    data.password_hash = bcrypt.hashSync(data.password, 10);
    data.password_changed_at = new Date().toISOString();
    delete data.password;
  }
  // Any security-relevant change revokes existing sessions.
  if (data.password_hash || data.active === false || data.role) {
    data.token_version = (await findUserById(id)).token_version + 1;
  }
  data.updated_at = new Date().toISOString();

  if (AUTH_STORE === 'memory') {
    const user = staff.find((u) => u.id === Number(id));
    if (!user) return null;
    Object.assign(user, data);
    if (data.password_hash) delete user.password;
    return normalize(user);
  }
  const rows = await update('users', id, data);
  return normalize(rows[0]);
}

async function setPassword(id, newPassword, mustChange = true) {
  return updateUser(id, { password: newPassword, must_change_password: mustChange });
}

async function revokeTokens(id) {
  const user = await findUserById(id);
  if (!user) return;
  const data = { token_version: user.token_version + 1, updated_at: new Date().toISOString() };
  if (AUTH_STORE === 'memory') {
    Object.assign(staff.find((u) => u.id === Number(id)), data);
    return;
  }
  await update('users', id, data);
}

async function appendAudit({ actor, action, entityType, entityId, before = null, after = null, ip = null }) {
  const row = {
    actor_user_id: actor && actor.id ? actor.id : null,
    actor_role: actor ? actor.role : null,
    action,
    entity_type: entityType,
    entity_id: String(entityId),
    before,
    after,
    ip,
  };
  if (AUTH_STORE === 'memory') {
    memoryAudits.push({ id: memoryAudits.length + 1, created_at: new Date().toISOString(), ...row });
    return;
  }
  await insert('audit_log', row);
}

async function listAudit(limit = 50) {
  if (AUTH_STORE === 'memory') {
    return memoryAudits.slice(-limit).reverse();
  }
  return select('audit_log', {}, '*', { order: 'id.desc' }).then((rows) => rows.slice(0, limit));
}

module.exports = {
  findUserByUsername, findUserById, listUsers, createUser, updateUser, setPassword, revokeTokens,
  appendAudit, listAudit, memoryAudits,
};
