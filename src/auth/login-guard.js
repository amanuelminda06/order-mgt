/** Small in-process login rate limiter: 5 failures per key in 15 minutes. */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const attempts = new Map();

function keyFor(username, ip) {
  return `${username}|${ip || 'unknown'}`;
}

function allowed(key) {
  const entry = attempts.get(key);
  if (!entry) return true;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return true;
  }
  return entry.count < MAX_FAILURES;
}

function fail(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count++;
  }
}

function clear(key) {
  attempts.delete(key);
}

module.exports = { keyFor, allowed, fail, clear };
