/**
 * Small in-process login rate limiter: 5 failures per device in 15 minutes,
 * plus a looser per-IP cap (20) so rotating a browser id cannot bypass it.
 *
 * The device id keeps staff using the same account on different devices (often
 * behind the same public IP) from sharing a lockout.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const IP_MAX_FAILURES = 20;
const attempts = new Map();

function cleanDevice(deviceId) {
  return String(deviceId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function identity(username, ip) {
  return `${String(username || '').toLowerCase()}|${String(ip || 'unknown').replace(/^::ffff:/, '')}`;
}

function keyFor(username, ip, deviceId) {
  return `${identity(username, ip)}|${cleanDevice(deviceId) || 'default'}`;
}

// '#' cannot appear in a cleaned device id, so this never collides.
function ipKeyFor(username, ip) {
  return `${identity(username, ip)}|#ip`;
}

function liveEntry(key) {
  const entry = attempts.get(key);
  if (entry && Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return null;
  }
  return entry || null;
}

function limitOf(entry, fallback) {
  return entry && entry.limit ? entry.limit : fallback;
}

function allowed(key, limit = MAX_FAILURES) {
  const entry = liveEntry(key);
  return !entry || entry.count < limitOf(entry, limit);
}

/** Seconds left before a blocked key can be tried again (0 when not blocked). */
function retryAfter(key, limit = MAX_FAILURES) {
  const entry = liveEntry(key);
  if (!entry || entry.count < limitOf(entry, limit)) return 0;
  return Math.max(1, Math.ceil((WINDOW_MS - (Date.now() - entry.first)) / 1000));
}

function fail(key, limit = MAX_FAILURES) {
  const entry = liveEntry(key);
  if (!entry) attempts.set(key, { count: 1, first: Date.now(), limit });
  else {
    entry.count++;
    entry.limit = limit;
  }
}

function clear(key) {
  attempts.delete(key);
}

/** Admin escape hatch: clear every lockout right away. */
function resetAll() {
  attempts.clear();
}

module.exports = {
  keyFor, ipKeyFor, allowed, fail, clear, retryAfter, resetAll,
  WINDOW_MS, MAX_FAILURES, IP_MAX_FAILURES,
};
