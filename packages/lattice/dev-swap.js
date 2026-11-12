// a dev server's changes to lattice's code, swapped in where you are rather
// than the page reloading: a call carries on, and whoever you're following,
// while the code you're all looking at changes under you
//
// the dev server (vite/frame.ts) serves each of its packages at
// /v<n>/packages/<name>/ too, the same files, and says when its version's
// changed (a long poll, which tunnels pass). a module's kept by its url, so
// imported from the new version's it's a new one, and so is everything it
// imports by a relative path (versioned.js). each of lattice's packages that
// patchwork has (by the url it registered its plugins from) is imported again
// from there, and registered again: patchwork remounts whatever shows one of
// their tools, as it does when a package in a doc changes. what has to
// outlast that is kept page-wide (wm/lasting.js), or in the tab (wm/kept.js)
//
// if any of it doesn't import (a syntax error, half saved), none of it's
// swapped, and it stays as it was till the next change. this file itself is
// the one thing that isn't swapped: what's polling is the first version's
import { getAllRegistries, getRegistry, registerPlugins, unregisterPlugins } from "@inkandswitch/patchwork-plugins";
import { lasting } from "../wm/lasting.js";
import { versioned } from "./versioned.js";

/** swap in each change of the dev server at `origin`'s, from now on (once a page) */
export function swapOnChange(origin) {
  const swapping = lasting("lattice:dev-swap", () => ({ origin: null }));
  if (swapping.origin) return;
  swapping.origin = origin;
  poll(origin);
}

async function poll(origin) {
  const changes = new URL("/packages/lattice/__changes", origin);
  let seen = null;
  let wait = 2000;
  for (;;) {
    let answer;
    try {
      if (seen != null) changes.searchParams.set("since", seen);
      answer = await (await fetch(changes, { cache: "no-store" })).json();
      wait = 2000;
    } catch {
      // the dev server's away (a stopped tunnel answers with cloudflare's own
      // error page, which the browser reports as a cors error): ask less and
      // less often. if it comes back with a new version, that's swapped in
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait = Math.min(wait * 2, 60_000);
      continue;
    }
    const { version, packages } = answer ?? {};
    if (seen != null && version !== seen) {
      try {
        await swap({ origin, version, packages: Array.isArray(packages) ? packages : [] });
      } catch (error) {
        console.error(`lattice: couldn't swap in the dev server's v${version}, so it's as it was`, error);
      }
    }
    seen = version;
  }
}

async function swap(at) {
  // ours, by the url patchwork registered them from: [[was, now]]
  const sources = new Map();
  for (const registry of getAllRegistries().values()) {
    for (const plugin of registry.all()) {
      const url = plugin.importUrl && versioned(plugin.importUrl, at);
      if (url) sources.set(plugin.importUrl, url);
    }
  }
  if (!sources.size) return;

  const swaps = await Promise.all(
    [...sources].map(async ([was, url]) => {
      const mod = await import(/* @vite-ignore */ await entryOf(url));
      const plugins = Array.isArray(mod?.plugins) ? mod.plugins : [];
      // what's in use now is loaded again first, so a mistake in it's found
      // before anything's swapped
      await Promise.all(
        plugins.map((plugin) => {
          const had = plugin?.type && getRegistry(plugin.type).get(plugin.id);
          const inUse = had && !("load" in had) && !("import" in had);
          return inUse && typeof plugin.load === "function" ? plugin.load() : null;
        }),
      );
      return { was, url, plugins };
    }),
  );

  for (const { was, url, plugins } of swaps) {
    registerPlugins(plugins, url);
    // whatever the new version doesn't have any more
    unregisterPlugins(was);
  }
  // the old version's stylesheets, kept in the head (wm/ui/stylesheet.js):
  // what's been taken out of them would stay otherwise
  const now = `${at.origin}/v${at.version}/`;
  for (const link of document.head.querySelectorAll("link[data-lattice-kept]")) {
    if (!link.href.startsWith(now)) link.remove();
  }
  console.info(`lattice: swapped in the dev server's v${at.version}`);
}

// a package's module: `url` if it's one, else its package.json's entry, as
// patchwork finds it (its "patchwork", "browser" or "import" export, or else
// module or main), or the directory itself if it has no package.json
async function entryOf(url) {
  if (/\.m?js$/.test(new URL(url).pathname)) return url;
  const base = url.endsWith("/") ? url : `${url}/`;
  const response = await fetch(new URL("package.json", base), { cache: "no-store" });
  if (!response.ok) return base;
  const pkg = await response.json();
  return new URL(exported(pkg.exports) ?? pkg.module ?? pkg.main ?? "index.js", base).href;
}

function exported(exports) {
  let entry = exports && typeof exports === "object" && "." in exports ? exports["."] : exports;
  while (entry && typeof entry === "object") {
    entry = entry.patchwork ?? entry.browser ?? entry.import ?? entry.default;
  }
  return typeof entry === "string" ? entry : null;
}
