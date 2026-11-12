// what's kept in this tab (its sessionStorage, as json): still there after a
// reload, and after a dev server's changes are swapped in (lasting.js), and
// gone with the tab. nothing's kept, and the fallback's what comes back,
// wherever storage can't be had

function tabStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** what's kept as `key`, or `fallback` */
export function kept(key, fallback = null, storage = tabStorage()) {
  try {
    const value = storage?.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** keep `value` as `key` (null or undefined: keep nothing) */
export function keep(key, value, storage = tabStorage()) {
  try {
    if (value == null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {}
}

// how long a follow kept from before is waited for: right after a reload
// (or a swap) nobody's been heard yet, them included
export const FOLLOW_GRACE = 10_000;

/**
 * who you're following, kept as `key` (a peer id, or nothing):
 *
 *   initial         who you were following, or null
 *   waiting(peer)   whether `peer`, followed but not heard yet, is still to
 *                   be waited for: they're who you were following, and it's
 *                   not been `grace` since
 *   heard()         they've been heard: no more waiting
 *   set(peer)       following someone else, or nobody (null)
 */
export function keptFollow(key, { storage, now = Date.now, grace = FOLLOW_GRACE } = {}) {
  const was = key ? kept(key, null, storage) : null;
  const initial = typeof was === "string" && was ? was : null;
  let until = initial ? now() + grace : 0;
  return {
    initial,
    waiting: (peer) => !!peer && peer === initial && now() < until,
    heard() {
      until = 0;
    },
    set(peer) {
      until = 0;
      if (key) keep(key, peer || null, storage);
    },
  };
}
