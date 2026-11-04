/** Shared time helpers. */

function now() {
  return new Date().toISOString();
}

/** Legacy helper retained for behaviour parity (currently unused by routes). */
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ago';
}

module.exports = { now, timeAgo };
