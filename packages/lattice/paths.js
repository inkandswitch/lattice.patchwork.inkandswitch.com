// what's in the address: /settings, or a project as /projects/<name>-<short>,
// where <short> is the start of its document id. the name is only for
// reading: a project's found by its short id among yours, so renaming it
// doesn't break a link. nothing imported, so it's tested as it is

export const SETTINGS_PATH = "/settings";
// enough of a base58 document id to tell one person's projects apart
export const SHORT_LENGTH = 6;

const documentIdOf = (url) => String(url).replace(/^automerge:/, "").split(/[#/]/)[0];

export const shortIdOf = (url) => documentIdOf(url).slice(0, SHORT_LENGTH);

// a name as it goes in a path: lowercase, its words joined with dashes
export function slugOf(name) {
  const slug = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "project";
}

export const projectPath = ({ url, name }) => `/projects/${slugOf(name)}-${shortIdOf(url)}`;

/**
 * what a path asks for: {page: "settings"}, {short} for a project, or null
 * for anything else (the site's root, say)
 */
export function parsePath(pathname) {
  const path = String(pathname ?? "").replace(/\/+$/, "");
  if (path === SETTINGS_PATH) return { page: "settings" };
  const match = path.match(/^\/projects\/(?:.*-)?([1-9A-HJ-NP-Za-km-z]+)$/);
  if (match && match[1].length >= SHORT_LENGTH) return { short: match[1].slice(0, SHORT_LENGTH) };
  return null;
}

// which of `projects` ({url}) a short id is
export const projectByShort = (projects, short) =>
  projects.find((project) => shortIdOf(project.url) === short) ?? null;
