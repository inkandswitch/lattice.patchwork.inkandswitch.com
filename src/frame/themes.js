// the theme on the page. which one, for light and for dark, is the account's
// own choice, kept in its theme preferences (the doc patchwork's theme picker
// keeps it in too, at account.toolStorage["theme-preferences"]); lattice puts
// it on the page itself, since nothing else here does.
//
// and your own versions of them: one of the site's themes (its `base`) with
// some of its variables changed. each is a lattice:theme doc, {base, name,
// variables}, that the preferences list as `themes`. editing a theme makes
// one, the first time. after that yours stands in for the site's wherever
// it'd be: in the list, and wherever it's been chosen
import { createSignal } from "solid-js";
import { isValidAutomergeUrl, parseAutomergeUrl } from "@automerge/automerge-repo/slim";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { createDoc } from "./knitoutjs/core/patchwork-docs.js";

export const THEME_TYPE = "lattice:theme";
const PREFERENCES = "theme-preferences";
const MODES = ["light", "dark"];

const string = (value) => (value == null ? "" : String(value));
const isUrl = (value) => isValidAutomergeUrl(string(value));

// the id a theme of yours goes by on the page: <html theme=…>
export const themeIdOf = (url) => `lattice-theme-${parseAutomergeUrl(url).documentId}`;

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const modeNow = () => (darkQuery.matches ? "dark" : "light");

// the site's own, for when nothing's been picked (see patchwork's theming)
function defaultFor(mode) {
  return document.documentElement.getAttribute(`data-theme-${mode}`) || (mode === "dark" ? "gloom" : "lychee");
}

// a theme's stylesheet, fetched once
const sheets = new Map();
async function cssOf(themeId) {
  const style = getRegistry("patchwork:theme").get(themeId)?.style;
  if (!style) return "";
  if (!sheets.has(style)) {
    sheets.set(
      style,
      fetch(style).then((response) => (response.ok ? response.text() : ""), () => ""),
    );
  }
  return sheets.get(style);
}
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * the theme, on the page, from the account's preferences. `element` is in
 * the frame's providers (the preferences doc is its tool storage's). returns
 * what the settings page uses:
 *
 *   mode()            "light" or "dark": which the computer's in
 *   chosen()          {light, dark}: each mode's theme id (yours, if you've
 *                     made yours of the one chosen)
 *   themes()          [{id, name, colorScheme, own?: {url, base, changed}}]
 *   choose(mode, id)
 *   edit(mode)        your own of that mode's theme, made the first time.
 *                     resolves with its url
 *   ready()           whether the preferences are here (choosing and
 *                     editing need them)
 *   stop()
 */
export function startThemes(element, repo, hive) {
  const registry = getRegistry("patchwork:theme");
  const [mode, setMode] = createSignal(modeNow());
  const [chosen, setChosen] = createSignal({ light: defaultFor("light"), dark: defaultFor("dark") });
  const [themes, setThemes] = createSignal([]);
  const [ready, setReady] = createSignal(false);
  let prefs = null;
  const own = new Map(); // url → {handle, style, off}
  let dead = false;

  // yours, made of a theme of the site's
  const yoursOf = (id) => themes().find((theme) => theme.own?.base === id);
  const resolve = (id) => yoursOf(id)?.id ?? id;

  function apply() {
    const doc = prefs?.doc();
    const now = {};
    for (const which of MODES) now[which] = resolve(string(doc?.[which]) || defaultFor(which));
    setChosen(now);
    setMode(modeNow());
    document.documentElement.setAttribute("theme", now[modeNow()]);
  }

  function list() {
    const site = registry
      .all()
      .map((theme) => ({ id: theme.id, name: string(theme.name) || theme.id, colorScheme: theme.colorScheme }));
    const yours = [];
    for (const [url, { handle }] of own) {
      const doc = handle?.doc();
      if (!doc) continue;
      const base = site.find((theme) => theme.id === doc.base);
      yours.push({
        id: themeIdOf(url),
        name: base?.name ?? (string(doc.name) || "yours"),
        colorScheme: base?.colorScheme,
        own: {
          url,
          base: string(doc.base),
          changed: Object.values(doc.variables ?? {}).filter((value) => string(value).trim()).length,
        },
      });
    }
    // yours where the site's would be
    const listed = site.map((theme) => yours.find((mine) => mine.own.base === theme.id) ?? theme);
    setThemes([...listed, ...yours.filter((mine) => !listed.includes(mine))]);
  }

  // a theme of yours, on the page: its base's rules under its own id, then
  // what's been changed
  async function install(url) {
    const entry = own.get(url);
    const doc = entry?.handle?.doc();
    if (!doc) return;
    const id = themeIdOf(url);
    const base = string(doc.base);
    const css = (await cssOf(base)).replace(new RegExp(`\\[theme=(["']?)${escape(base)}\\1\\]`, "g"), `[theme="${id}"]`);
    const changed = Object.entries(doc.variables ?? {})
      .filter(([key, value]) => /^--[\w-]+$/.test(key) && string(value).trim())
      .map(([key, value]) => `\t${key}: ${string(value).replace(/[;{}<]/g, "")};`)
      .join("\n");
    if (dead || own.get(url) !== entry) return;
    entry.style.textContent = `${css}\n\n/* changed */\n[theme="${id}"] {\n${changed}\n}\n`;
    list();
    apply();
  }

  // the ones the preferences list: each found, put on the page, and kept up
  // to date
  function syncOwn() {
    const urls = (Array.isArray(prefs?.doc()?.themes) ? prefs.doc().themes : []).map(string).filter(isUrl);
    for (const [url, entry] of own) {
      if (urls.includes(url)) continue;
      entry.off();
      own.delete(url);
    }
    for (const url of urls) {
      if (own.has(url)) continue;
      const style = document.createElement("style");
      style.dataset.latticeTheme = url;
      document.head.append(style);
      const entry = { handle: null, style, off: () => style.remove() };
      own.set(url, entry);
      repo.find(url).then(
        (handle) => {
          if (dead || own.get(url) !== entry) return;
          entry.handle = handle;
          const onChange = () => install(url);
          handle.on("change", onChange);
          entry.off = () => {
            handle.off("change", onChange);
            style.remove();
          };
          install(url);
        },
        () => {},
      );
    }
    list();
  }

  const onPrefs = () => {
    syncOwn();
    apply();
  };
  const unsubscribe = subscribe(element, { type: "patchwork:tool-storage", toolId: PREFERENCES }, (url) => {
    if (dead || !isUrl(url) || prefs?.url === url) return;
    repo.find(url).then((handle) => {
      if (dead) return;
      prefs?.off("change", onPrefs);
      prefs = handle;
      if (!handle.doc()?.["@patchwork"]) {
        handle.change((doc) => {
          doc["@patchwork"] = { type: PREFERENCES };
        });
      }
      handle.on("change", onPrefs);
      setReady(true);
      onPrefs();
    });
  });

  const onRegistered = () => {
    list();
    apply();
  };
  darkQuery.addEventListener("change", apply);
  registry.on("registered", onRegistered);
  list();
  apply();

  function choose(which, id) {
    prefs?.change((doc) => {
      doc[which] = id;
    });
  }

  async function edit(which) {
    const id = chosen()[which];
    const current = themes().find((theme) => theme.id === id);
    if (current?.own) return current.own.url;
    const handle = await createDoc(
      repo,
      { "@patchwork": { type: THEME_TYPE }, base: id, name: current?.name ?? id, variables: {} },
      hive,
    );
    prefs?.change((doc) => {
      doc.themes ??= [];
      if (!doc.themes.includes(handle.url)) doc.themes.push(handle.url);
      doc[which] = themeIdOf(handle.url);
    });
    return handle.url;
  }

  return {
    mode,
    chosen,
    themes,
    ready,
    choose,
    edit,
    stop() {
      dead = true;
      unsubscribe?.();
      prefs?.off("change", onPrefs);
      darkQuery.removeEventListener("change", apply);
      registry.off?.("registered", onRegistered);
      for (const entry of own.values()) entry.off();
      own.clear();
    },
  };
}
