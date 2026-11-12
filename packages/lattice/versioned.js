// lattice's packages from a dev server, at a version: /v<n>/packages/<name>/…
// is the same file as /packages/<name>/…, but a module's kept by its url, so
// imported from there it's a new one, and so is everything it imports by a
// relative path (see dev-swap.js). nothing's imported here: vite's config
// (vite/frame.ts), and node's tests, read it too

const AT = /^\/v\d+(\/packages\/.*)$/;
const PACKAGE = /^\/packages\/([^/]+)\//;

/** `path` without its version, or null if it hasn't one (or climbs out) */
export function unversioned(path) {
  const plain = AT.exec(path)?.[1];
  if (!plain || plain.split("/").includes("..")) return null;
  return plain;
}

/**
 * `url` at `version`, if it's one of `packages` on the dev server at
 * `origin` (at any version, or none); else null
 */
export function versioned(url, { origin, version, packages }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) return null;
  const path = unversioned(parsed.pathname) ?? parsed.pathname;
  const name = PACKAGE.exec(path)?.[1];
  if (!name || !packages.includes(name)) return null;
  return `${origin}/v${version}${path}${parsed.search}`;
}
