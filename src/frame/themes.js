// the theme on the page. which one is the account's own choice, kept in its
// theme preferences (the doc patchwork's theme picker keeps it in too, at
// account.toolStorage["theme-preferences"]), as `light` and `dark`. lattice
// picks one theme for both, and puts it on the page itself, since nothing
// else here does.
//
// and your own versions of them: one of the site's themes (its `base`) with
// some of its variables changed. each is a lattice:theme doc, {base, name,
// variables}, that the preferences list as `themes`. editing a theme makes
// one, the first time. after that yours stands in for the site's wherever
// it'd be: in the list, and wherever it's been chosen
import { createEffect, createMemo, createResource, createSignal, mapArray, onCleanup } from "solid-js";
import { isValidAutomergeUrl, parseAutomergeUrl } from "@automerge/automerge-repo/slim";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { useDocument } from "./vendor/solid-automerge.js";
import { createDoc } from "./knitoutjs/core/patchwork-docs.js";

export const THEME_TYPE = "lattice:theme";
const PREFERENCES = "theme-preferences";
// a change (a colour being dragged, say) shows at once, and is kept once it's
// stopped changing for this long
const KEEP_AFTER = 300;

const string = (value) => (value == null ? "" : String(value));
const isUrl = (value) => isValidAutomergeUrl(string(value));
const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);

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
function cssOf(themeId) {
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
 * what a theme sets `key` to, before anything of yours: read off a little
 * element of its own, out of sight
 */
export function themeValue(id, key) {
  const probe = document.createElement("div");
  probe.setAttribute("theme", id);
  probe.style.display = "none";
  document.body.append(probe);
  const value = getComputedStyle(probe).getPropertyValue(key).replace(/\s+/g, " ").trim();
  probe.remove();
  return value;
}

/**
 * the theme, on the page, from the account's preferences. call it under a
 * solid owner: it stops when that does. `element` is in the frame's
 * providers (the preferences doc is its tool storage's). returns:
 *
 *   mode()        "light" or "dark": which the computer's in
 *   themes()      [{id, name, colorScheme, own?}]: the site's, with yours in
 *                 place of the ones they're of. `own` is yours (below)
 *   chosenId()    the theme on the page
 *   chosen()      its entry in themes()
 *   choose(id)    for light and dark both
 *   edit()        yours of the chosen theme, made the first time. resolves
 *                 with it
 *   ready()       whether the preferences are here (choosing and editing
 *                 need them)
 *
 * one of yours, as `own`: {url, id, base(), variables(), changed(),
 * set(key, value, {now}), reset()}. `set` shows at once and is kept a
 * moment later (or now)
 */
export function useThemes(element, { repo, hive }) {
  const registry = getRegistry("patchwork:theme");

  // the site's themes, as they're registered (each the same object, so a
  // list of them keeps its places)
  const siteEntries = new Map();
  const readSite = () =>
    registry.all().map((theme) => {
      const name = string(theme.name) || theme.id;
      const known = siteEntries.get(theme.id);
      if (known && known.name === name && known.colorScheme === theme.colorScheme) return known;
      const entry = { id: theme.id, name, colorScheme: theme.colorScheme };
      siteEntries.set(theme.id, entry);
      return entry;
    });
  const [site, setSite] = createSignal(readSite(), { equals: sameList });
  const onRegistered = () => setSite(readSite());
  registry.on("registered", onRegistered);
  onCleanup(() => registry.off?.("registered", onRegistered));

  const [mode, setMode] = createSignal(modeNow());
  const onMode = () => setMode(modeNow());
  darkQuery.addEventListener("change", onMode);
  onCleanup(() => darkQuery.removeEventListener("change", onMode));

  // the preferences: found through the frame's tool storage
  const [prefsUrl, setPrefsUrl] = createSignal();
  const unsubscribe = subscribe(element, { type: "patchwork:tool-storage", toolId: PREFERENCES }, (url) => {
    if (isUrl(url)) setPrefsUrl(string(url));
  });
  onCleanup(() => unsubscribe?.());
  const [prefs, prefsHandle] = useDocument(prefsUrl, { repo });
  createEffect(() => {
    const handle = prefsHandle();
    if (handle && !handle.doc()?.["@patchwork"]) {
      handle.change((doc) => {
        doc["@patchwork"] = { type: PREFERENCES };
      });
    }
  });
  const ready = () => !!prefsHandle();

  // yours: each found, put on the page, and kept up to date
  const ownUrls = createMemo(
    () => (Array.isArray(prefs()?.themes) ? prefs().themes : []).map(string).filter(isUrl),
    [],
    { equals: sameList },
  );
  const own = createMemo(mapArray(ownUrls, (url) => ownTheme(url)));

  function ownTheme(url) {
    const id = themeIdOf(url);
    const [doc, handle] = useDocument(() => url, { repo });
    const base = () => string(doc()?.base);

    // what's been changed but not kept yet
    const [waiting, setWaiting] = createSignal({});
    const variables = createMemo(() => ({ ...(doc()?.variables ?? {}), ...waiting() }));
    const changed = () => Object.values(variables()).filter((value) => string(value).trim()).length;

    // its base's rules under its own id, and then what's changed. the
    // changes are twice as particular, so they're over anything of the base's
    const [css] = createResource(base, cssOf);
    const rules = document.createElement("style");
    const changes = document.createElement("style");
    rules.dataset.latticeTheme = changes.dataset.latticeTheme = url;
    document.head.append(rules, changes);
    onCleanup(() => {
      rules.remove();
      changes.remove();
    });
    createEffect(() => {
      const from = base();
      rules.textContent = from
        ? string(css()).replace(new RegExp(`\\[theme=(["']?)${escape(from)}\\1\\]`, "g"), `[theme="${id}"]`)
        : "";
    });
    createEffect(() => {
      const lines = Object.entries(variables())
        .filter(([key, value]) => /^--[\w-]+$/.test(key) && string(value).trim())
        .map(([key, value]) => `\t${key}: ${string(value).replace(/[;{}<]/g, "")};`);
      changes.textContent = `[theme="${id}"][theme="${id}"] {\n${lines.join("\n")}\n}\n`;
    });

    let timer = null;
    function keep() {
      clearTimeout(timer);
      timer = null;
      const kept = Object.entries(waiting());
      if (!kept.length || !handle()) return;
      handle().change((theme) => {
        theme.variables ??= {};
        for (const [key, value] of kept) {
          if (string(value).trim()) theme.variables[key] = value;
          else delete theme.variables[key];
        }
      });
      setWaiting({});
    }
    onCleanup(keep);

    const name = () => site().find((theme) => theme.id === base())?.name ?? (string(doc()?.name) || "yours");
    return {
      url,
      id,
      own: true,
      get name() {
        return name();
      },
      get colorScheme() {
        return site().find((theme) => theme.id === base())?.colorScheme;
      },
      base,
      variables,
      changed,
      set(key, value, { now = false } = {}) {
        setWaiting((all) => ({ ...all, [key]: value }));
        clearTimeout(timer);
        if (now) keep();
        else timer = setTimeout(keep, KEEP_AFTER);
      },
      reset() {
        clearTimeout(timer);
        setWaiting({});
        handle()?.change((theme) => {
          theme.variables = {};
        });
      },
    };
  }

  // yours where the site's would be, and any of yours of a theme that's gone
  const themes = createMemo(() => {
    const mine = own();
    const listed = site().map((theme) => mine.find((yours) => yours.base() === theme.id) ?? theme);
    return [...listed, ...mine.filter((yours) => !listed.includes(yours))];
  });

  const resolve = (id) => own().find((yours) => yours.base() === id)?.id ?? id;
  const chosenId = createMemo(() => resolve(string(prefs()?.[mode()]) || defaultFor(mode())));
  const chosen = createMemo(() => themes().find((theme) => theme.id === chosenId()) ?? null);
  // on the page. patchwork's own theming puts the site's default back when
  // the computer goes light or dark (it hasn't the preferences, here), so
  // whatever else changes it, it's put back
  const root = document.documentElement;
  const put = () => {
    if (root.getAttribute("theme") !== chosenId()) root.setAttribute("theme", chosenId());
  };
  createEffect(put);
  const watcher = new MutationObserver(put);
  watcher.observe(root, { attributes: true, attributeFilter: ["theme"] });
  onCleanup(() => watcher.disconnect());

  function choose(id) {
    prefsHandle()?.change((doc) => {
      doc.light = id;
      doc.dark = id;
    });
  }

  let making = null;
  async function edit() {
    const current = chosen();
    if (current?.own) return current;
    const from = chosenId();
    making ??= createDoc(
      repo,
      { "@patchwork": { type: THEME_TYPE }, base: from, name: current?.name ?? from, variables: {} },
      hive,
    ).then((handle) => {
      const id = themeIdOf(handle.url);
      prefsHandle()?.change((doc) => {
        doc.themes ??= [];
        if (!doc.themes.includes(handle.url)) doc.themes.push(handle.url);
        doc.light = id;
        doc.dark = id;
      });
      return handle;
    });
    try {
      await making;
    } finally {
      making = null;
    }
    return chosen();
  }

  return { mode, themes, chosenId, chosen, choose, edit, ready };
}
