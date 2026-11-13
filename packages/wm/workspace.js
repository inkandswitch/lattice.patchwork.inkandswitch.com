// wm: a project's panes, and its files down the side. what each app's
// project tool shows (lattice's frame has one in its middle)
import { createSignal, createMemo, createEffect, on, onCleanup, For, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { getHeads, getChangesMetaSince } from "@automerge/automerge";
import {
  getFallbackTool,
  getRegistry,
  getSupportedToolsForType,
} from "@inkandswitch/patchwork-plugins";
import { docColour, fileExtension, shortUrl, newFileDoc, withExtension } from "./doc/files.js";
import * as Layout from "./doc/layout.js";
import { urlFromText, loadDatatype, whenFound } from "./patchwork/docs.js";
import { Resizer, sidebarState } from "./ui/sidebars.js";
import { menuKeys } from "./ui/menus.js";
import { icon } from "./ui/icons.js";
import { readActive, writeActive, activeChannel } from "./active.js";
import { joinRoom, faceImage } from "./presence.js";
import { PANE_TAG, paneRepo, provideViewState } from "./view-state.js";
import { pointerImage } from "./pointer.js";
import { tooltips } from "./ui/tooltip.js";
import { holdSecret, secret } from "./ui/secret.js";
import { scrollsAlong } from "./ui/along.js";
import { rowMenu, showMenuAt } from "./ui/context-menu.js";
import { arrivals } from "./ui/arriving.js";
import { createInk } from "./ink.js";
import { anchorAt, inside, placeAnchor } from "./anchor.js";
import { FOLLOW_GRACE, keptFollow } from "./kept.js";
import { call, hearCalls, inProject, ask, hangUp, onCallIn } from "./call/call.js";
import { CallPrompt, CallFloating, CallStage, Face } from "./call/ui.js";

const STYLESHEET = new URL("./wm.css", import.meta.url).href;

// "just now", "4 min ago": how long since something was done
function ago(time, now) {
  const seconds = (now - time) / 1000;
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `on ${new Date(time).toLocaleDateString()}`;
}

// when a doc was last changed, by anyone: the latest of its newest changes
// (automerge stamps each one with the time, in seconds)
// (just the changes' meta, not inspectChange: that decodes every op in the
// change, and a file with its content in one change costs seconds). a change
// is known by its hash, which is of its content, so its time is worked out
// once, whichever doc or snapshot it's seen in
const changeTimes = new Map();
function editedAt(doc) {
  try {
    const heads = getHeads(doc);
    if (heads.some((hash) => !changeTimes.has(hash))) {
      const wanted = new Set(heads);
      for (const meta of getChangesMetaSince(doc, [])) if (wanted.has(meta.hash)) changeTimes.set(meta.hash, meta.time);
    }
    const latest = Math.max(0, ...heads.map((hash) => changeTimes.get(hash) ?? 0));
    return latest ? latest * 1000 : null;
  } catch {
    return null;
  }
}

// what shows a doc no tool of the app's fits: patchwork's own tool for its
// datatype
const PATCHWORK = {
  id: "patchwork",
  name: "patchwork",
  title: "show this doc with patchwork's own tool for it",
  load: () => import("./patchwork-pane.js"),
};

const MIN_CELL = 80;
const EDGE = 0.22;
const MAX_EDGE = 64;
const CODE_EDGE = 28;
const OUTER_EDGE = 10;

// a drag goes out to everyone else looking this often, and again now and
// then while it's held still. theirs shows until the doc has it, or until
// they've been quiet this long (their page shut mid-drag, say)
const LIVE_EVERY = 33;
// how often your pointer goes to everyone else, at most
const POINTER_EVERY = 50;
const LIVE_QUIET = 4000;

// a floating window: how small it gets, how much of it stays in reach, and
// the edges and corners it's sized by
const FLOAT_MIN = { w: 200, h: 120 };
const FLOAT_REACH = { x: 80, y: 34 };
const FLOAT_EDGES = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];

// a node's fields while it's dragged: its size (a divider) or where it
// floats. anything else that comes over broadcast is ignored
const numbers = (value, keys) =>
  !!value && typeof value === "object" && keys.every((key) => Number.isFinite(value[key]));
function liveFields(fields) {
  const out = {};
  const size = fields?.size;
  if (numbers(size, ["flex"]) || numbers(size, ["px"])) out.size = { ...size };
  if (numbers(fields?.float, ["x", "y", "w", "h", "z"])) out.float = { ...fields.float };
  return Object.keys(out).length ? out : null;
}

// two sizes or two floats are the same
function sameFields(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((key) => a[key] === b[key]);
}

// what can be dragged in: our own tabs, the tools in a tab's tool menu (to
// open that file with that tool somewhere else), and docs from the sidebar
const PANEL_TYPE = "application/x-lattice-wm-panel";
const TOOL_TYPE = "application/x-lattice-wm-tool";
// drags that place a pane, rather than bring a doc in
const LAYOUT_TYPES = [PANEL_TYPE, TOOL_TYPE];
const DOC_TYPES = ["text/x-patchwork-dnd", "text/x-patchwork-urls", "text/uri-list"];

// files from the computer (the finder, the desktop): each is made a file doc
const FILES_TYPE = "Files";
// bigger than this and it's not made a doc: it'd be a long while syncing
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function isOurDrag(dataTransfer) {
  return [...LAYOUT_TYPES, ...DOC_TYPES, FILES_TYPE].some((type) => dataTransfer?.types.includes(type));
}

// files, and only files: not docs, which a page's image dragged in has too
function onlyFiles(dataTransfer) {
  const types = dataTransfer?.types ?? [];
  return types.includes(FILES_TYPE) && ![...LAYOUT_TYPES, "text/x-patchwork-dnd", "text/x-patchwork-urls"].some((type) => types.includes(type));
}

// a file's content as a doc keeps it: text as text (so .js, .k and .md open
// in an editor), anything else as bytes, as pasting an image into markdown
// keeps it (codemirror-markdown's embed.ts)
function fileContent(bytes, mimeType) {
  if (/^(image|audio|video|font)\//.test(mimeType) || bytes.includes(0)) return bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes;
  }
}

// [{url, name?}], read the same way the sidebar reads its own drops
function droppedDocs(dataTransfer) {
  try {
    const items = JSON.parse(dataTransfer.getData("text/x-patchwork-dnd"))?.items;
    if (Array.isArray(items) && items.length) return items;
  } catch {}
  try {
    const urls = JSON.parse(dataTransfer.getData("text/x-patchwork-urls"));
    if (Array.isArray(urls)) {
      return urls.filter((url) => isValidAutomergeUrl(url)).map((url) => ({ url }));
    }
  } catch {}
  return (dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain"))
    .split(/\r?\n/)
    .map(urlFromText)
    .filter(Boolean)
    .map((url) => ({ url }));
}

// which part of a group the pointer is over: a band along an edge to split,
// or the middle. `band` is the band's width in pixels
function zoneAt(event, rect, band) {
  const across = band ?? Math.min(rect.width * EDGE, MAX_EDGE);
  const down = band ?? Math.min(rect.height * EDGE, MAX_EDGE);
  const distances = {
    left: (event.clientX - rect.left) / across,
    right: (rect.right - event.clientX) / across,
    top: (event.clientY - rect.top) / down,
    bottom: (rect.bottom - event.clientY) / down,
  };
  const [edge, distance] = Object.entries(distances).sort((a, b) => a[1] - b[1])[0];
  return distance < 1 ? edge : "center";
}

// the groups in a read tree, in the order they're laid out
function* groupsIn(node) {
  if (!node) return;
  if (node.type === "group") yield node;
  else for (const child of node.children) yield* groupsIn(child);
}

// a cell's flex, from its node's size: a share of what's left, or fixed
function cellStyle(node, direction) {
  const size = node.size ?? { flex: 1 };
  const style = size.px != null ? { flex: `0 0 ${size.px}px` } : { flex: `${size.flex} 1 0px` };
  const along = direction === "row" ? "width" : "height";
  if (node.min != null) style[`min-${along}`] = `${node.min}px`;
  if (node.max != null) style[`max-${along}`] = `${node.max}px`;
  return style;
}

/**
 * a project's panes, and its files down the side. returns a way to unmount.
 *
 *   layout     the handle of the doc its layout's on, as `nodes` (see
 *              layout.js): the project
 *   files      its files: an adapter, like folder.js's folderFiles
 *   room       the handle of its files' folder or directory, from the repo
 *              under any draft overlay: who else is in the project is
 *              heard over it (presence.js). without one, nobody is
 *   repo       finds and makes docs. through a draft overlay, if there is
 *              one, so what's done here goes into whichever draft is out
 *   baseRepo   for tools that mustn't be forked into a draft (a terminal:
 *              a terminal shares on the original). repo, if not given
 *   hive       the site's keyhive, if it has one, for new docs
 *   tools      the app's tools: {list, for(doc), extension(doc)?}. `list`
 *              is all of them ({id, name, title, position, load, drafts?,
 *              patchworkId?, was?}: `was` is any ids it had before, which
 *              panes saved then still say); `for` is the ones that show a
 *              doc, the first first; `extension` is what a doc's called as a
 *              file, if not what its name says. a doc none of them shows
 *              shows with patchwork's own tool for it
 *   extensions what the app adds to the panes: [{name, watch, links,
 *              status, touched, menu, presence}], each part optional. see
 *              EXTENSIONS below
 *   self       tool ids never offered in a pane (the app's own project and
 *              frame tools: not inside a pane of themselves)
 *   sidebar    the files sidebar's state (sidebars.js), when something else
 *              opens and shuts it (an app's top bar). without one, it keeps
 *              its own, with a strip down the side to open it again
 *   onShowing  hears the docs the panes are showing ({url, name}, one per
 *              pane), for inspectors
 *   onFocused  hears the one you're in ({url, name}, or null): what's
 *              showing in the pane you last clicked in, tabbed to or
 *              opened something in (or the first pane)
 *   onOpen     gets a way to bring a doc forward
 *   pointer    what your pointer looks like to everyone else: a function
 *              giving "arrow" or "mouse" (read in an effect, so it can be a
 *              signal). an arrow, without one
 *
 * EXTENSIONS. each is plain data and functions; it imports nothing of wm's,
 * and gets `api` (below) instead
 *   name                 its own, for what it keeps: its facts on a doc's
 *                        info (info.ext[name]), its presence keys
 *   watch(doc)           plain facts about a doc, kept up to date as
 *                        api.docInfo(url).ext[name]
 *   links(url, api)      the docs this one is linked to: [{url, label?,
 *                        title?, live}]. a live link lights up with it; one
 *                        with a label is a chip in its pane's bar too
 *   status(url, api)     a line at the end of its pane's bar, or null:
 *                        {state, text?, stuck?, action?: {label, icon,
 *                        title, run(from)}}. stuck marks the pane out
 *   touched(url, api)    when it was last done something to, if not edited:
 *                        {verb, at, flash?}: "built 3 min ago" in the files.
 *                        flash tints its panes when at changes
 *   menu(api)            more for the + menu: [{icon, label, detail?, alt?,
 *                        primary?, create(api, groupId)}]. alt ones show
 *                        while alt is held; the primary one is on the empty
 *                        card too (primary is its label there). create
 *                        returns a url (or {url, tool}) to open, or nothing
 *   presence             {[key]: {mine(api), read(value)}}: what of yours
 *                        goes to everyone else, and theirs read back, as
 *                        person.ext[name][key]
 *
 * api: {repo, createFile(name, fields), reveal(url, from, edge, tool),
 * openRow([[{url, tool}]]), files(), people(), docInfo(url), ago(time)}.
 * `from` is what an action's run is handed: the pane it's in
 */
export function mountWorkspace(
  element,
  {
    layout: layoutHandle,
    files,
    room: roomHandle,
    repo,
    baseRepo = repo,
    hive,
    tools,
    extensions = [],
    self = [],
    sidebar,
    onShowing,
    onFocused,
    onOpen,
    pointer: look,
  },
) {
  let root;
  let menu;

  tooltips(".lattice-wm");
  const filesSidebar = sidebar ?? sidebarState("lattice-wm:files", 200, { was: "lattice:files" });

  // a stylesheet added by script doesn't hold up painting, so stay hidden
  // until it's in, or you see the whole thing unstyled first
  const [styled, setStyled] = createSignal(false);

  // ── what's in the project ──────────────────────────────────────────────

  const [layout, setLayout] = createStore({ root: null, floats: [] });
  const [fileUrls, setFileUrls] = createSignal([]);
  const [projectName, setProjectName] = createSignal("");

  // what's being dragged right now, here or by anyone else looking: {[node
  // id]: {fields: {size} or {float}, until}}. it's shown over the doc until
  // the doc has it too, or until it lapses
  const live = new Map();
  let lapse = null;

  // who else is in the project (presence.js): a face each, and their panes.
  // following one, their panes show here instead (read only) until you stop:
  // `following` is their peer id. it's kept in the tab, so it outlasts a
  // reload, and a dev server's changes being swapped in (lattice/dev-swap.js),
  // which mounts all this again: then they're waited for a while, since
  // nobody's been heard yet, them included
  let room = null;
  const [people, setPeople] = createStore([]);
  const theirs = new Map();
  const followKept = keptFollow(roomHandle && `lattice-wm:following:${roomHandle.url}`);
  const [following, setFollowingNow] = createSignal(followKept.initial);
  // following, what pressing on their panes does: "draw" ink on them
  // (ink.js), or "use" them, editing and typing in them as they are yours,
  // while the panes, tabs and scrolling still follow along
  const [followMode, setFollowMode] = createSignal("draw");
  const drawing = () => !!following() && followMode() === "draw";
  // the contact of whoever you follow, to know them by when their peer id
  // changes (refollow, below)
  let followingContact = null;
  // whoever you follow, as last heard. gone (reloading, say), they're kept
  // a while as they were, for them to come back as another peer; till then
  // it's their panes as they last were you see, not yours
  let lastLeader = null;
  let leaderLostAt = 0;
  let leaderGrace = null;
  function leaderNow() {
    const peer = following();
    if (!peer) return null;
    const leader = theirs.get(peer);
    if (leader) {
      lastLeader = leader;
      leaderLostAt = 0;
      return leader;
    }
    if (lastLeader?.peer !== peer || !followingContact) return null;
    if (!leaderLostAt) {
      leaderLostAt = Date.now();
      clearTimeout(leaderGrace);
      leaderGrace = setTimeout(() => readLayout(), FOLLOW_GRACE + 50);
    }
    return Date.now() - leaderLostAt < FOLLOW_GRACE ? lastLeader : null;
  }
  const setFollowing = (peer) => {
    followKept.set(peer);
    setFollowingNow(peer);
  };
  // and not seen in that while: let go
  const followGrace = followKept.initial ? setTimeout(() => readLayout(), FOLLOW_GRACE + 50) : null;
  const [theirActive, setTheirActive] = createStore({});

  function readLayout() {
    const nodes = layoutHandle.doc()?.nodes ?? {};
    const shown = { ...nodes };
    const now = Date.now();
    let soonest = Infinity;
    for (const [id, { fields, until }] of live) {
      const node = nodes[id];
      const caughtUp = node && Object.entries(fields).every(([key, value]) => sameFields(node[key], value));
      if (!node || caughtUp || until <= now) {
        live.delete(id);
        continue;
      }
      shown[id] = { ...node, ...fields };
      soonest = Math.min(soonest, until);
    }
    clearTimeout(lapse);
    if (soonest < Infinity) lapse = setTimeout(readLayout, soonest - now + 10);
    shareLayout(shown);
    const leader = leaderNow();
    if (following() && !leader && !followKept.waiting(following())) setFollowing(null);
    if (leader) followKept.heard();
    if (leader) setTheirActive(reconcile(leader.active));
    setLayout(reconcile(Layout.read(leader ? leader.nodes : shown), { key: "id" }));
  }
  function readFiles() {
    setFileUrls(files.urls());
    setProjectName(files.title());
  }

  // ours goes to the room as it changes, drags and all, for anyone
  // following: at most every LIVE_EVERY, and not when it's the same
  let sharedNodes = "";
  let toShare = null;
  let shareTimer = null;
  function shareLayout(nodes) {
    if (!room) return;
    toShare = nodes;
    shareTimer ??= setTimeout(() => {
      shareTimer = null;
      const json = JSON.stringify(toShare);
      if (json === sharedNodes) return;
      sharedNodes = json;
      room.share("nodes", JSON.parse(json));
    }, LIVE_EVERY);
  }

  // the extensions' presence keys, each under its extension's name
  const presenceKeys = extensions.flatMap((extension) =>
    Object.entries(extension.presence ?? {}).map(([key, { mine, read }]) => ({
      name: extension.name,
      key,
      channel: `${extension.name}:${key}`,
      mine,
      read,
    })),
  );

  if (roomHandle) {
    const reads = Object.fromEntries(presenceKeys.map(({ channel, read }) => [channel, read]));
    room = joinRoom(roomHandle, baseRepo, reads, (list) => {
      theirs.clear();
      for (const person of list) theirs.set(person.peer, person);
      setPeople(
        reconcile(
          list.map(({ peer, contact, name, colour, avatar, pointer, look, shared }) => {
            const ext = {};
            for (const { name, key, channel } of presenceKeys) (ext[name] ??= {})[key] = shared[channel];
            return { peer, contact, name, colour, avatar, pointer, look, ext };
          }),
          { key: "peer" },
        ),
      );
      refollow(list);
      // whoever you follow starting to follow someone else: you stop. you'd
      // only be seeing their copy of someone else's panes, and two people
      // following each other would see nothing of their own
      if (following() && theirs.get(following())?.following) follow(null);
      else if (following()) {
        readLayout();
        showTheirViews();
      }
    });
  }

  // ── a call, in the project (call/call.js): hearing whether there's one
  //    on, and asking, as you arrive, whether you'll join it. the phone,
  //    beside the +, is there while one's on, or while it's not a secret
  //    (ui/secret.js: ctrl, alt and command, tapped together twice)
  const callProject = roomHandle && {
    room: roomHandle,
    repo: baseRepo,
    get name() {
      return projectName();
    },
  };
  const offCallProject = callProject ? inProject(callProject) : () => {};
  const offCalls = callProject
    ? hearCalls(roomHandle, () => {
        if (call.get()?.room !== roomHandle.url) ask(callProject);
      })
    : () => {};
  const callHere = () => !!callProject && call.get()?.room === roomHandle.url;
  const callOn = () => !!callProject && onCallIn(roomHandle.url).length > 0;
  let phone;
  function pressPhone() {
    if (callHere()) return hangUp();
    const box = phone?.getBoundingClientRect();
    ask(callProject, { at: box && { x: box.left, y: box.bottom + 6 }, focus: true });
  }

  // ── what's going on in each pane: wm answers patchwork:view-state for
  //    what's in one (view-state.js), and its scroll is wm's to
  //    watch. yours goes to the room as it changes; following someone, it's
  //    theirs each pane shows, till you scroll or click or type in one
  const noViews = { follow() {}, docOf: () => null, forget() {}, stop() {} };
  const views = roomHandle
    ? provideViewState(element, { room: roomHandle, paneOf, onChange: shareView })
    : noViews;

  // the pane an event's from, by its id
  function paneOf(event) {
    for (const node of event.composedPath()) {
      if (node === element) break;
      if (node instanceof Element && node.localName === PANE_TAG) {
        const id = panelOf(node);
        if (id) return id;
      }
    }
    return null;
  }

  // a pane's view, for everyone else: at most every POINTER_EVERY
  const viewsToShare = new Set();
  let viewTimer = null;
  function shareView(id) {
    if (!room || following()) return;
    viewsToShare.add(id);
    viewTimer ??= setTimeout(() => {
      viewTimer = null;
      for (const id of viewsToShare) {
        const host = hosts.get(id);
        if (!host) continue;
        room.view(id, { url: host.url, tool: host.tool, doc: views.docOf(id), scroll: host.scroll ?? null });
      }
      viewsToShare.clear();
    }, POINTER_EVERY);
  }

  // where an element is in a pane, as child indices, and back. null if it's
  // somewhere else (in a shadow root, say)
  function pathIn(root, el) {
    const path = [];
    for (let at = el; at !== root; at = at.parentElement) {
      if (!at?.parentElement) return null;
      path.unshift([...at.parentElement.children].indexOf(at));
    }
    return path;
  }
  function elementAt(root, path) {
    let at = root;
    for (const index of path) at = at?.children[index];
    return at ?? null;
  }

  const portion = (at, range) =>
    range > 0 ? Math.round(Math.min(1, Math.max(0, at / range)) * 10000) / 10000 : 0;
  function onScroll(host, event) {
    if (following()) return;
    const path = event.target instanceof Element ? pathIn(host.el, event.target) : null;
    if (!path) return;
    const el = event.target;
    host.scroll = {
      path,
      top: portion(el.scrollTop, el.scrollHeight - el.clientHeight),
      left: portion(el.scrollLeft, el.scrollWidth - el.clientWidth),
    };
    shareView(host.id);
  }
  function scrollLike(host, scroll) {
    const el = scroll && elementAt(host.el, scroll.path);
    if (!el) return;
    const top = scroll.top * (el.scrollHeight - el.clientHeight);
    const left = scroll.left * (el.scrollWidth - el.clientWidth);
    if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
    if (Math.abs(el.scrollLeft - left) > 1) el.scrollLeft = left;
  }

  // following someone: each pane shows their view of it, if it's of the same
  // doc in the same tool, and else a view of nothing yet. not following:
  // yours, and back where you'd scrolled
  function showTheirViews() {
    const leader = leaderNow();
    for (const [id, host] of hosts) {
      const view = leader?.views[id];
      const here = view && view.url === host.url && view.tool === host.tool ? view : null;
      views.follow(id, leader ? (here?.doc ?? {}) : null);
      scrollLike(host, leader ? here?.scroll : host.scroll);
    }
  }

  // ── ink (ink.js): following someone, pressing and dragging over their
  //    panes draws, for them to see too. their panes are inert while you
  //    draw, so it's drawn on a sheet over them (InkSheet); switched to
  //    using them (followMode), the sheet lets presses through to the
  //    panes. following goes on till you press their face again
  const inkPanes = new Map();
  const ink = createInk({
    panes: () =>
      [...inkPanes.values()].map(({ body, svg, active }) => {
        const panel = active();
        return {
          body,
          svg,
          panel: panel ? { url: panel.url, tool: panel.tool } : null,
          el: panel ? (hosts.get(panel.id)?.el ?? null) : null,
        };
      }),
    send: (message) => roomHandle?.broadcast(message),
    me: () => room?.me() ?? { colour: "" },
  });
  const onInkMessage = (event) => ink.receive(event.message);
  roomHandle?.on("ephemeral-message", onInkMessage);

  // your pointer, for everyone else: over which doc, in which tool, where
  // in its pane (fractions of it), and over what there (anchor.js), since
  // their panes aren't the size of yours, nor scrolled or zoomed as yours
  // are. `at` is {group, x, y} (client px), or null once it's off the
  // panes. it's worked out as it goes, at most every POINTER_EVERY, and
  // again as what's under it moves (scrolling, zooming) while it doesn't
  let pointerTimer = null;
  let pointerAtNow = null;
  let pointerSent = null;
  function sharePointer(at) {
    if (!room) return;
    pointerAtNow = at;
    pointerTimer ??= setTimeout(() => {
      pointerTimer = null;
      const value = pointerAtNow && pointerFor(pointerAtNow);
      const json = JSON.stringify(value);
      if (json === pointerSent) return;
      pointerSent = json;
      room.share("pointer", value);
    }, POINTER_EVERY);
  }
  function pointerFor({ group, x, y }) {
    const pane = inkPanes.get(group);
    const panel = pane?.active();
    const rect = pane?.body?.getBoundingClientRect();
    if (!panel || !rect?.width || !rect.height) return null;
    const fraction = (n) => Math.round(Math.min(2, Math.max(-1, n)) * 10000) / 10000;
    const value = { url: panel.url, tool: panel.tool, x: fraction((x - rect.left) / rect.width), y: fraction((y - rect.top) / rect.height) };
    // over its tabs, it's where it is by the pane
    if (!inside(rect, x, y)) return value;
    const { anchor, scale, origin } = anchorAt({ body: pane.body, el: hosts.get(panel.id)?.el ?? null }, x, y);
    const px = (n) => Math.round(n * 10) / 10;
    return { ...value, anchor, scale, dx: px(x - origin.x), dy: px(y - origin.y) };
  }
  const pointerAgain = () => pointerAtNow && sharePointer(pointerAtNow);
  document.addEventListener("scroll", pointerAgain, { capture: true, passive: true });
  document.addEventListener("wheel", pointerAgain, { capture: true, passive: true });
  const offPanes = () => sharePointer(null);
  const [pointerFrame, setPointerFrame] = createSignal(0);
  const onHidden = () => document.visibilityState === "hidden" && offPanes();
  document.addEventListener("visibilitychange", onHidden);

  // everyone else's pointer over this panel: theirs over the same doc in the
  // same tool
  const pointersOver = (panel) =>
    panel
      ? people.filter(
          (person) => person.pointer && person.pointer.url === panel.url && person.pointer.tool === panel.tool,
        )
      : [];

  // it's a person that's followed, not one page of theirs: reloading, or a
  // dev server's changes being swapped in, gives them a new peer id. when the
  // one followed goes and they're back as another (the same contact), it's
  // that one that's followed. else you'd be left on their panes as they
  // were, or on yours, and none of their tabs would come
  function refollow(list) {
    const peer = following();
    if (!peer) {
      followingContact = null;
      return;
    }
    const leader = theirs.get(peer);
    if (leader) {
      followingContact = leader.contact || followingContact;
      return;
    }
    const again = followingContact && list.find((person) => person.contact === followingContact);
    if (again) setFollowing(again.peer);
  }

  // someone's panes instead of yours, or yours again (`peer` again, or none)
  function follow(peer) {
    followingContact = (peer && theirs.get(peer)?.contact) || null;
    setFollowing(peer && following() !== peer ? peer : null);
    readLayout();
    showTheirViews();
  }

  readLayout();
  readFiles();
  layoutHandle.on("change", readLayout);
  const offFiles = files.subscribe(readFiles);

  // an edit from layout.js, on the doc's nodes. returns what the edit does.
  // following someone, there's nothing to edit: their panes are theirs
  function updateLayout(edit) {
    if (following()) return [];
    let result;
    layoutHandle.change((doc) => {
      doc.nodes ??= {};
      result = edit(doc.nodes);
    });
    return result;
  }

  const allGroups = () => [layout.root, ...layout.floats].flatMap((node) => [...groupsIn(node)]);
  const findGroup = (id) => allGroups().find((group) => group.id === id) ?? null;

  // the first pane showing a doc: {group, panel}
  function findShowing(url) {
    for (const group of allGroups()) {
      const panel = group.panels.find((panel) => panel.url === url);
      if (panel) return { group, panel };
    }
    return null;
  }

  // which tab each group is showing. it's this browser's, not the doc's
  // (active.js): remembered for next time, and this browser's other tabs
  // follow along
  // (following someone, it's theirs that shows, from the room)
  const [active, setActive] = createStore(readActive(layoutHandle.url));
  // the pane you're in: last clicked in, tabbed to, or shown something in.
  // where things opened from the files go, and whose doc is the one you're on
  const [lastGroupId, setLastGroupId] = createSignal(null);
  const activeIn = (group) =>
    group.panels.find((panel) => panel.id === (following() ? theirActive : active)[group.id]) ??
    group.panels[0];
  const tabChannel = activeChannel(layoutHandle.url, (groupId, panelId) => {
    setActive(groupId, panelId);
    room?.share("active", { ...active });
  });
  room?.share("active", { ...active });

  function showTab(groupId, panelId) {
    if (following() || !groupId || !panelId) return;
    setLastGroupId(groupId);
    if (active[groupId] === panelId) return;
    setActive(groupId, panelId);
    tabChannel.post(groupId, panelId);
    // only what still points at a tab in its group
    const nodes = layoutHandle.doc()?.nodes ?? {};
    const kept = {};
    for (const [group, panel] of Object.entries(active)) if (nodes[panel]?.parent === group) kept[group] = panel;
    writeActive(layoutHandle.url, kept);
    room?.share("active", kept);
  }
  function activate(panelId) {
    showTab(layoutHandle.doc()?.nodes?.[panelId]?.parent, panelId);
  }

  const addFiles = (urls) => files.add(urls);

  // the app's tools: by id (or one they had before), and which show a doc
  const toolById = (id) =>
    id === PATCHWORK.id ? PATCHWORK : tools.list.find((tool) => tool.id === id || tool.was?.includes(id));
  function toolsOf(doc) {
    const fit = tools.for(doc);
    return fit.length ? fit : [PATCHWORK];
  }
  const extensionOf = (doc) => (tools.extension ?? fileExtension)(doc);

  // name, extension and tools of any doc we show, and what each extension
  // makes of it, kept up to date. `changes` counts its changes, for when it
  // was edited (editedAtOf), which is only worked out when it's asked for
  const infos = new Map();
  function docInfo(url) {
    if (!url) return {};
    let entry = infos.get(url);
    if (!entry) {
      const [info, setInfo] = createStore({
        name: shortUrl(url),
        extension: "",
        type: null,
        tools: [],
        ext: {},
        changes: 0,
      });
      entry = { info, off: null, handle: null };
      infos.set(url, entry);
      // someone else's new doc may not be here yet: it's looked for until
      // it is, and only said to be missing once it's been a while
      entry.off = whenFound(
        repo,
        url,
        async (docHandle) => {
          // a doc that isn't a file (markdown, say) may only have a title its
          // datatype can find in it
          const datatype = await loadDatatype(docHandle.doc()?.["@patchwork"]?.type);
          const update = () => {
            const doc = docHandle.doc();
            const extension = extensionOf(doc);
            const named = doc?.name || doc?.title || datatype?.module.getTitle?.(doc);
            setInfo({
              // with its extension, if its name hasn't one
              name: named ? withExtension(named, extension) : shortUrl(url),
              extension,
              type: doc?.["@patchwork"]?.type ?? null,
              tools: toolsOf(doc).map((tool) => tool.id),
              changes: info.changes + 1,
            });
            for (const extension of extensions) {
              if (!extension.watch) continue;
              const facts = extension.watch(doc) ?? null;
              setInfo("ext", extension.name, facts && typeof facts === "object" ? reconcile(facts) : facts);
            }
          };
          if (entry.gone) return;
          entry.handle = docHandle;
          update();
          docHandle.on("change", update);
          entry.off = () => docHandle.off("change", update);
        },
        () => setInfo({ name: `missing ${shortUrl(url)}` }),
      );
    }
    return entry.info;
  }

  // when a doc was last changed, by anyone (automerge stamps each change)
  function editedAtOf(url) {
    const info = docInfo(url);
    if (!info.changes) return null;
    const doc = infos.get(url)?.handle?.doc();
    return doc ? editedAt(doc) : null;
  }

  const projectFiles = createMemo(() =>
    fileUrls().map((url) => {
      const info = docInfo(url);
      return { url, name: info.name, extension: info.extension };
    }),
  );

  async function createFile(name, extra = {}) {
    const taken = new Set(projectFiles().map((file) => file.name));
    const [, stem, ext] = name.match(/^(.*?)(\..*)?$/);
    let unique = name;
    for (let n = 2; taken.has(unique); n++) unique = `${stem}-${n}${ext ?? ""}`;
    const fileHandle = await repo.create2({ ...newFileDoc(unique), ...extra });
    addFiles([fileHandle.url]);
    return fileHandle.url;
  }

  // files from the computer, each a file doc in the project. their urls; what
  // couldn't be, it says so in the pane (groupId)
  async function importFiles(files, groupId) {
    const urls = [];
    const refused = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        refused.push(`${file.name} (it's over ${MAX_FILE_BYTES / 1024 / 1024}MB)`);
        continue;
      }
      try {
        const content = fileContent(new Uint8Array(await file.arrayBuffer()), file.type);
        // a text file with no type of its own gets newFileDoc's
        const mimeType = file.type || (typeof content === "string" ? null : "application/octet-stream");
        urls.push(await createFile(file.name || "untitled", mimeType ? { content, mimeType } : { content }));
      } catch (error) {
        console.error("[lattice-wm] couldn't bring in", file.name, error);
        refused.push(file.name);
      }
    }
    if (refused.length) notify(groupId, `couldn't bring in ${refused.join(", ")}`);
    return urls;
  }

  // ── links: hovering anything that shows a doc lights up every pane that
  //    shows it, and more softly the panes showing the docs it's linked to

  const [hovered, setHovered] = createSignal(null);

  // a doc's links, from each extension: [{url, label?, title?, live}]
  const linksOf = (url) => extensions.flatMap((extension) => extension.links?.(url, api) ?? []);

  // linked = either has a live link to the other
  function linked(a, b) {
    const to = (from, url) => linksOf(from).some((link) => link.live && link.url === url);
    return to(a, b) || to(b, a);
  }

  function glow(url) {
    const lit = hovered();
    if (!lit || !url) return undefined;
    if (lit === url) return "same";
    return linked(lit, url) ? "linked" : undefined;
  }

  const unhover = () => setHovered(null);

  // light a doc up for a moment, when it's been brought forward
  function flashDoc(url) {
    setHovered(url);
    setTimeout(() => hovered() === url && setHovered(null), 900);
  }

  // a doc open in more than one pane is marked out in each, in its colour
  const paneCounts = createMemo(() => {
    const counts = new Map();
    for (const group of allGroups()) {
      for (const url of new Set(group.panels.map((panel) => panel.url))) {
        counts.set(url, (counts.get(url) ?? 0) + 1);
      }
    }
    return counts;
  });
  const inManyPanes = (url) => (paneCounts().get(url) ?? 0) > 1;

  // ── what the extensions say of a doc: a line in its pane's bar, and when
  //    it was last done something to. a "now" that ticks, for how long ago
  const [clock, setClock] = createSignal(Date.now());
  const ticker = setInterval(() => setClock(Date.now()), 15_000);

  const firstOf = (part, url) => {
    for (const extension of extensions) {
      const said = extension[part]?.(url, api);
      if (said) return said;
    }
    return null;
  };
  const statusOf = (url) => firstOf("status", url);
  const touchedOf = (url) => firstOf("touched", url);

  // ── tools: each panel's tool lives in its own element, which moves with
  //    the panel when the layout changes rather than starting over

  // show a linked doc: if it's open already, bring its tab forward and light
  // it up for a moment; if not, open it on one side of the pane asking
  async function reveal(url, fromPanelId, edge, toolId) {
    if (!url) return;
    const showing = findShowing(url);
    if (showing) {
      showTab(showing.group.id, showing.panel.id);
    } else {
      const doc = (await repo.find(url)).doc();
      const tool = toolId ?? toolsOf(doc)[0].id;
      addFiles([url]);
      const [id] = updateLayout((nodes) =>
        Layout.openPanels(nodes, fromPanelId, edge, [Layout.newPanel(url, tool)]),
      );
      activate(id);
    }
    flashDoc(url);
  }

  function panelOf(toolElement) {
    for (const [id, host] of hosts) if (host.el === toolElement) return id;
    return null;
  }

  const toolContext = {
    repo,
    open: (url, toolElement, edge, toolId) => reveal(url, panelOf(toolElement), edge, toolId),
    openIfClosed: (url, toolElement, edge, toolId) =>
      findShowing(url) || reveal(url, panelOf(toolElement), edge, toolId),
    get events() {
      return root;
    },
    project: { files: projectFiles, createFile },
    hover: setHovered,
    // the colour a doc wears here, as a css colour, for a tool to draw in
    docColour: (url) => `var(--lattice-wm-${docColour(url)})`,
  };

  const hosts = new Map();

  function hostFor(panel) {
    const { id, url, tool, patchworkTool } = panel;
    let host = hosts.get(id);
    if (host && host.url === url && host.tool === tool && host.patchworkTool === patchworkTool) {
      return host;
    }
    if (host) destroyHost(id, host);
    host = { id, url, tool, patchworkTool, el: document.createElement(PANE_TAG), cleanup: null };
    host.el.className = "lattice-wm-tool";
    // which tool it is (patchwork's own id, for one of patchwork's), so an
    // app can style what a tool shows in its panes
    host.el.dataset.tool = patchworkTool ?? tool;
    host.el.addEventListener("scroll", (event) => onScroll(host, event), { capture: true, passive: true });
    hosts.set(id, host);
    mountTool(host);
    return host;
  }

  // say a pane's doc is mounted (or not) as a <patchwork-view> would, so
  // providers above know what's open: comments watches those docs for
  // threads, and drafts lists them. from wm's element, which is still in the
  // page when a pane's own has already gone. the tool's id is patchwork's
  // (which it preloads next time), so only one patchwork has: a patchwork
  // tool's, or the `patchworkId` of one of ours, if it has one
  function announce(type, host) {
    const toolId = host.patchworkTool ?? toolById(host.tool)?.patchworkId;
    element.dispatchEvent(
      new CustomEvent(type, {
        detail: toolId ? { url: host.url, toolId } : { url: host.url },
        bubbles: true,
        composed: true,
      }),
    );
  }

  async function mountTool(host) {
    const tool = toolById(host.tool) ?? PATCHWORK;
    // its pane's in the page once its slot has it, just after this
    await null;
    if (host.dead) return;
    // the tool finds docs from its pane, as one in a <patchwork-view> does
    // from that, so what wm answers for a pane (view-state.js) is
    // answered for it, and the rest is answered further up as it was
    host.repo = tool.drafts === false ? baseRepo : paneRepo(baseRepo, host.el);
    try {
      // a doc someone's only just made may take a moment to get here
      const found = new Promise((resolve) => {
        host.stopLooking = whenFound(
          host.repo,
          host.url,
          resolve,
          () => {
            if (host.dead) return;
            host.el.dataset.state = "waiting";
            host.el.textContent = "still looking for this";
          },
        );
      });
      const [docHandle, module] = await Promise.all([found, tool.load()]);
      if (host.dead) return;
      if (host.el.dataset.state === "waiting") {
        delete host.el.dataset.state;
        host.el.replaceChildren();
      }
      host.cleanup = module.default(docHandle, host.el, {
        ...toolContext,
        repo: host.repo,
        toolId: host.patchworkTool,
      });
      host.announced = true;
      announce("patchwork:mounted", host);
      if (following()) showTheirViews();
    } catch (error) {
      if (host.dead) return;
      host.el.dataset.state = "broken";
      host.el.textContent = `couldn't open this: ${error.message ?? error}`;
    }
  }

  function destroyHost(id, host) {
    if (host.dead) return;
    host.dead = true;
    host.stopLooking?.();
    host.cleanup?.();
    if (host.announced) announce("patchwork:unmounted", host);
    host.el.remove();
    if (host.repo !== baseRepo) host.repo?.dispose?.();
    if (hosts.get(id) !== host) return;
    hosts.delete(id);
    views.forget(id);
    room?.view(id, null);
  }

  function Slot(props) {
    const panel = props.panel;
    let slot;
    createEffect(() => {
      const host = hostFor(panel);
      slot.replaceChildren(host.el);
      const owner = {};
      host.owner = owner;
      // if nobody picks it up again this tick, it's really gone
      onCleanup(() =>
        queueMicrotask(() => {
          if (host.owner === owner && !host.el.isConnected) {
            destroyHost(panel.id, host);
          }
        }),
      );
    });
    return html`<div class="lattice-wm-slot" ref=${(el) => (slot = el)}></div>`;
  }

  // ── opening things ─────────────────────────────────────────────────────

  const [notice, setNotice] = createSignal(null);
  let noticeTimer;
  function notify(groupId, text) {
    clearTimeout(noticeTimer);
    setNotice({ groupId, text });
    noticeTimer = setTimeout(() => setNotice(null), 3500);
  }

  async function openDocs(urls, groupId, zone = "center", toolId) {
    groupId ??= findGroup(lastGroupId()) ? lastGroupId() : null;
    const panels = [];
    const refused = [];
    for (const url of urls) {
      try {
        const doc = (await repo.find(url)).doc();
        const tools = toolsOf(doc);
        panels.push(Layout.newPanel(url, (tools.find((tool) => tool.id === toolId) ?? tools[0]).id));
      } catch {
        refused.push(shortUrl(url));
      }
    }
    if (panels.length) {
      addFiles(panels.map((panel) => panel.url));
      const [first] = updateLayout((nodes) => Layout.openPanels(nodes, groupId, zone, panels));
      activate(first);
    }
    if (refused.length) {
      notify(groupId, `couldn't find ${refused.join(", ")}`);
    }
  }

  // one of the + menu's makes something, and what it makes opens here
  async function create(groupId, item) {
    let made;
    try {
      made = await item.create(api, groupId);
    } catch (error) {
      notify(groupId, String(error?.message ?? error));
      return;
    }
    if (!made) return;
    const { url, tool } = typeof made === "string" ? { url: made } : made;
    openDocs([url], groupId, "center", tool);
  }

  // groups, side by side on a row of their own: [[{url, tool}]]
  function openRow(groups) {
    const urls = groups.flat().map((panel) => panel.url);
    addFiles([...new Set(urls)]);
    updateLayout((nodes) =>
      Layout.addRow(
        nodes,
        Layout.newSplit(
          "row",
          groups.map((panels) => Layout.newGroup(panels.map((panel) => Layout.newPanel(panel.url, panel.tool)))),
        ),
      ),
    );
  }

  // what an extension's handed
  const api = {
    repo,
    createFile,
    reveal,
    openRow,
    files: projectFiles,
    people: () => people,
    docInfo,
    ago: (time) => ago(time, clock()),
  };

  // what the extensions add to the + menu
  const menuItems = extensions.flatMap((extension) => extension.menu?.(api) ?? []);
  const primaryItem = menuItems.find((item) => item.primary);

  const [menuFor, setMenuFor] = createSignal(null);
  // the menu has more in it while alt is held
  const [altHeld, setAltHeld] = createSignal(false);
  const onAltKey = (event) => {
    if (event.key === "Alt") setAltHeld(event.type === "keydown");
  };
  document.addEventListener("keydown", onAltKey);
  document.addEventListener("keyup", onAltKey);

  // pressing the button a menu came from, while it's open, closes it: the
  // press dismisses it (it's an auto popover), and the click after would
  // open it again, so a press on its opener says not to
  const openers = new Map();
  let pressedOpener = null;
  function onPressWhileOpen(event) {
    pressedOpener = null;
    for (const [popover, opener] of openers) {
      if (popover?.matches(":popover-open") && opener?.contains(event.target)) pressedOpener = opener;
    }
  }
  document.addEventListener("pointerdown", onPressWhileOpen, true);
  // its menus by keyboard (ui/menus.js)
  const menusOff = menuKeys();
  function pressedToClose(popover, opener) {
    const close = pressedOpener === opener;
    pressedOpener = null;
    openers.set(popover, close ? null : opener);
    return close;
  }

  function openMenu(event, groupId) {
    if (pressedToClose(menu, event.currentTarget)) return;
    setAltHeld(event.altKey);
    setMenuFor(groupId);
    const rect = event.currentTarget.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 280))}px`;
    menu.showPopover();
  }

  // ── what a pane's shown with: one of ours, or, for a doc we've no tool
  //    of our own for, one of the patchwork tools for its datatype (patchwork's
  //    own pick, unless the pane says which). those arrive as packages load

  const patchworkTools = getRegistry("patchwork:tool");
  const [patchworkToolsChanged, setPatchworkToolsChanged] = createSignal(0);
  const offPatchworkTools = patchworkTools.on("changed", () =>
    setPatchworkToolsChanged((n) => n + 1),
  );

  // the one patchwork would pick first. not frames, nor the app's own tools
  // (not inside a pane of themselves)
  function patchworkToolsFor(type) {
    patchworkToolsChanged();
    if (!type) return [];
    let first;
    try {
      first = getFallbackTool({ "@patchwork": { type } })?.id;
    } catch {}
    return getSupportedToolsForType(type)
      .filter(
        (tool) =>
          !tool.unlisted &&
          !tool.forTitleBar &&
          !tool.tags?.includes("frame-tool") &&
          !self.includes(tool.id),
      )
      .sort((a, b) => (b.id === first) - (a.id === first) || a.name.localeCompare(b.name));
  }

  // [{tool, patchworkTool?, name, title}]
  function toolChoices(url) {
    const info = docInfo(url);
    return info.tools
      .map(toolById)
      .filter(Boolean)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .flatMap((tool) => {
        const theirs = tool.id === "patchwork" ? patchworkToolsFor(info.type) : [];
        if (!theirs.length) return [{ tool: tool.id, name: tool.name, title: tool.title }];
        return theirs.map((theirTool) => ({
          tool: tool.id,
          patchworkTool: theirTool.id,
          name: theirTool.name.toLowerCase(),
          title: `patchwork's ${theirTool.name} tool`,
        }));
      });
  }

  function shownWith(panel) {
    const choices = toolChoices(panel.url);
    return (
      choices.find(
        (choice) =>
          choice.tool === panel.tool &&
          (!panel.patchworkTool || choice.patchworkTool === panel.patchworkTool),
      ) ?? null
    );
  }

  function toolName(panel) {
    return shownWith(panel)?.name ?? toolById(panel.tool)?.name ?? panel.tool;
  }

  // a tab's tool menu: what it's shown with, and what else it could be
  let toolMenu;
  const [toolMenuFor, setToolMenuFor] = createSignal(null);

  // a file's new name, from its tab or the files: a name without an
  // extension keeps the one it had
  async function renameFile(url, name) {
    name = String(name ?? "").trim();
    if (!name || name === docInfo(url).name) return;
    (await repo.find(url)).change((doc) => {
      doc.name = name;
      doc.extension = fileExtension({ name }) || doc.extension || "";
    });
  }

  // a tab's own focus, by its panel's id, once it's been drawn (showing it
  // or closing its neighbour redraws the bar)
  function focusTab(panelId) {
    queueMicrotask(() =>
      element.querySelector(`.lattice-wm-tab[data-panel="${panelId}"] > [role="tab"]`)?.focus(),
    );
  }

  function openToolMenu(event, panel, groupId) {
    if (pressedToClose(toolMenu, event.currentTarget)) return;
    openToolMenuAt(event.currentTarget, panel, groupId);
  }

  // `under` is what it hangs from: the tab's tool button
  function openToolMenuAt(under, panel, groupId) {
    setToolMenuFor({ panel, groupId });
    const rect = under.getBoundingClientRect();
    toolMenu.style.top = `${rect.bottom + 4}px`;
    toolMenu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 220))}px`;
    toolMenu.showPopover();
  }

  function fromMenu(action) {
    return (...args) => {
      const groupId = menuFor();
      menu.hidePopover();
      action(groupId, ...args);
    };
  }

  function onOpenUrl(event) {
    event.preventDefault();
    const input = event.currentTarget.elements.url;
    const url = urlFromText(input.value);
    if (!url) {
      input.setCustomValidity("that isn't an automerge url");
      input.reportValidity();
      return;
    }
    input.value = "";
    fromMenu((groupId) => openDocs([url], groupId))();
  }

  // ── dragging tabs and docs ─────────────────────────────────────────────

  const [dragging, setDragging] = createSignal(false);
  // dropping along the frame's own edge splits the whole layout, so a row
  // can run all the way across (a .k and its visualizer above everything)
  const [outerZone, setOuterZone] = createSignal(null);

  function outerEdgeAt(event) {
    if (!layout.root) return null;
    const rect = root.getBoundingClientRect();
    if (event.clientX - rect.left < OUTER_EDGE) return "left";
    if (rect.right - event.clientX < OUTER_EDGE) return "right";
    if (event.clientY - rect.top < OUTER_EDGE) return "top";
    if (rect.bottom - event.clientY < OUTER_EDGE) return "bottom";
    return null;
  }

  // the pane under the pointer while something's dragged over, and where in
  // it: {groupId, zone, lineTop}. the panes only show this; wm works
  // it out, at its root, so nothing inside a pane (an editor, a canvas) can
  // take the drop first
  const [dropTarget, setDropTarget] = createSignal(null);
  const dropTargets = new Map(); // group id → (event) => {zone, lineTop}

  // browsers often leave dragleave's relatedTarget empty, so count instead:
  // every element entered is left again
  let entered = 0;

  // the drop effect to answer with, for what's being dragged
  function dropEffectFor(dataTransfer) {
    return dataTransfer.types.includes(PANEL_TYPE) ? "move" : "copy";
  }

  // files over the text of a text editor are the editor's, as anywhere else:
  // markdown makes an image dropped into it an embed. the pane's edges, its
  // tabs and anywhere not text still place them as panes
  function intoEditor(event) {
    if (!onlyFiles(event.dataTransfer) || outerEdgeAt(event)) return false;
    const target = dropTargetAt(event);
    if (!target || target.outer || target.zone !== "center" || target.onTabs) return false;
    return event.composedPath().some((node) => node instanceof Element && node.classList.contains("cm-content"));
  }

  function onRootDragEnter(event) {
    if (!isOurDrag(event.dataTransfer)) return;
    // safari only lets an element be dropped on if it cancels dragenter as
    // well as dragover (as the spec says); chrome only needs dragover
    event.preventDefault();
    event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer);
    entered++;
    setDragging(true);
  }
  function onRootDragLeave() {
    if (!dragging()) return;
    entered = Math.max(0, entered - 1);
    if (entered === 0) stopDragging();
  }
  function stopDragging() {
    entered = 0;
    setDragging(false);
    setOuterZone(null);
    setDropTarget(null);
  }
  // dragged away somewhere else on the page, or let go of
  const onDocumentDragOver = (event) => {
    if (dragging() && !root.contains(event.target)) stopDragging();
  };
  document.addEventListener("dragover", onDocumentDragOver);
  document.addEventListener("dragend", stopDragging);
  document.addEventListener("drop", stopDragging);

  // where a drop would land: the outer edge, a pane and a zone of it, or
  // (with nothing open) the whole frame
  function dropTargetAt(event) {
    const outer = outerEdgeAt(event);
    if (outer) return { groupId: layout.root.id, zone: outer, outer: true };
    const section = event.target.closest?.(".lattice-wm-group");
    const zoneFor = section && dropTargets.get(section.dataset.group);
    if (zoneFor) return { groupId: section.dataset.group, ...zoneFor(event) };
    if (!layout.root) return { groupId: null, zone: "center" };
    return null;
  }

  function onRootDragOver(event) {
    if (!isOurDrag(event.dataTransfer)) return;
    if (intoEditor(event)) {
      setOuterZone(null);
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer);
    if (!dragging()) setDragging(true);
    const target = dropTargetAt(event);
    setOuterZone(target?.outer ? target.zone : null);
    setDropTarget(target && !target.outer ? target : null);
  }

  function onRootDrop(event) {
    if (!isOurDrag(event.dataTransfer)) return;
    if (intoEditor(event)) {
      stopDragging();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = dropTargetAt(event);
    stopDragging();
    if (!target) return;
    const group = target.groupId && findGroup(target.groupId);
    drop(event, target.groupId, target.zone, group ? activeIn(group) : null);
  }

  function listenForDrops(el) {
    el.addEventListener("dragenter", onRootDragEnter, true);
    el.addEventListener("dragleave", onRootDragLeave, true);
    el.addEventListener("dragover", onRootDragOver, true);
    el.addEventListener("drop", onRootDrop, true);
  }

  function drop(event, groupId, zone, activePanel) {
    const dataTransfer = event.dataTransfer;
    const panelId = dataTransfer.getData(PANEL_TYPE);
    if (panelId) {
      updateLayout((nodes) => Layout.movePanel(nodes, panelId, groupId, zone));
      activate(panelId);
      return;
    }
    const tool = dataTransfer.getData(TOOL_TYPE);
    if (tool) {
      const { url, id, patchworkTool } = JSON.parse(tool);
      const at = zone === "code" ? "center" : zone;
      const [made] = updateLayout((nodes) =>
        Layout.openPanels(nodes, groupId, at, [Layout.newPanel(url, id, patchworkTool)]),
      );
      activate(made);
      return;
    }
    const docs = droppedDocs(dataTransfer);
    // files from the computer: made docs, then opened there like any other.
    // read now, as the drop's data goes once it's over
    const files = !docs.length && dataTransfer.types.includes(FILES_TYPE) ? [...dataTransfer.files] : [];
    if (files.length) {
      const at = zone === "code" ? "center" : zone;
      importFiles(files, groupId).then((urls) => urls.length && openDocs(urls, groupId, at));
      return;
    }
    if (zone === "code") {
      hosts.get(activePanel?.id)?.el.dropInto?.drop(docs, event.clientX, event.clientY);
      return;
    }
    openDocs(
      docs.map((doc) => doc.url),
      groupId,
      zone,
    );
  }

  // ── live drags: a divider or a floating window, shown as it goes, here
  //    and to everyone else looking (over the project's broadcast), and
  //    written to the doc once, when it's let go of

  // what's being dragged here: a divider's direction, "move", or the edge a
  // floating window's being sized by. it sets the cursor
  const [resizing, setResizing] = createSignal(null);

  const me = Layout.newId();
  let sent = 0;
  let outgoing = {};
  let sendTimer = null;

  function send() {
    clearTimeout(sendTimer);
    sendTimer = null;
    if (!Object.keys(outgoing).length) return;
    try {
      layoutHandle.broadcast({ "lattice-wm": "drag", from: me, n: ++sent, nodes: outgoing });
    } catch {}
    outgoing = {};
  }

  // theirs. messages can come out of order, so an older one is dropped
  const heard = new Map();
  function onDragMessage({ message }) {
    if (message?.["lattice-wm"] !== "drag" || typeof message.from !== "string" || message.from === me) return;
    if (!(message.n > (heard.get(message.from) ?? 0))) return;
    heard.set(message.from, message.n);
    const until = Date.now() + LIVE_QUIET;
    for (const [id, fields] of Object.entries(message.nodes ?? {})) {
      const checked = liveFields(fields);
      if (checked) live.set(id, { fields: checked, until });
    }
    readLayout();
  }
  layoutHandle.on("ephemeral-message", onDragMessage);

  // a drag from `event`'s pointer: fieldsAt(event) says what the nodes are
  // now ({[id]: {size} or {float}}), and write(nodes, fields) puts that in
  // the doc when it's let go of
  function dragLive(event, cursor, fieldsAt, write) {
    if (following()) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setResizing(cursor);
    let fields = null;
    // held still, it still goes out now and then, so it doesn't lapse
    const beat = setInterval(() => {
      if (fields) Object.assign(outgoing, fields), send();
    }, LIVE_QUIET / 3);

    function onMove(event) {
      fields = fieldsAt(event);
      for (const [id, each] of Object.entries(fields)) live.set(id, { fields: each, until: Infinity });
      readLayout();
      Object.assign(outgoing, fields);
      sendTimer ??= setTimeout(send, LIVE_EVERY);
    }

    function onUp() {
      clearInterval(beat);
      setResizing(null);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      if (!fields) return;
      send();
      for (const id of Object.keys(fields)) {
        const entry = live.get(id);
        if (entry) entry.until = Date.now() + LIVE_QUIET;
      }
      updateLayout((nodes) => write(nodes, fields));
      readLayout();
    }

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  // a divider: the two cells either side of it. a fixed one stays fixed (in
  // px), and two flexible ones share what they had between them
  function startResize(event, split, left) {
    if (event.button !== 0) return;
    const resizer = event.currentTarget;
    const row = split.direction === "row";
    const a = split.children[left];
    const b = split.children[left + 1];
    const length = (el) => el.getBoundingClientRect()[row ? "width" : "height"];
    const lengthA = length(resizer.previousElementSibling);
    const pair = lengthA + length(resizer.nextElementSibling);
    const lowest = Math.max(Math.min(MIN_CELL, pair / 2), a.min ?? 0, pair - (b.max ?? Infinity));
    const highest = Math.min(pair - Math.max(Math.min(MIN_CELL, pair / 2), b.min ?? 0), a.max ?? Infinity);
    const sizeA = { ...a.size };
    const sizeB = { ...b.size };
    const start = row ? event.clientX : event.clientY;

    function sizesFor(lengthOfA) {
      const lengthOfB = pair - lengthOfA;
      if (sizeA.px != null && sizeB.px != null) {
        return [{ px: Math.round(lengthOfA) }, { px: Math.round(lengthOfB) }];
      }
      if (sizeA.px != null) return [{ px: Math.round(lengthOfA) }, sizeB];
      if (sizeB.px != null) return [sizeA, { px: Math.round(lengthOfB) }];
      const flex = sizeA.flex + sizeB.flex;
      return [{ flex: (flex * lengthOfA) / pair }, { flex: (flex * lengthOfB) / pair }];
    }

    dragLive(
      event,
      row ? "row" : "column",
      (event) => {
        const delta = (row ? event.clientX : event.clientY) - start;
        const [one, two] = sizesFor(Math.min(Math.max(lengthA + delta, lowest), Math.max(lowest, highest)));
        return { [a.id]: { size: one }, [b.id]: { size: two } };
      },
      (nodes, fields) => Layout.resize(nodes, { [a.id]: fields[a.id].size, [b.id]: fields[b.id].size }),
    );
  }

  // ── floating windows: moved by their tab bars, sized by their edges and
  //    corners, and brought to the front when touched

  // how big the frame is, to keep floats in reach on a smaller screen than
  // the one they were put on
  const [frameSize, setFrameSize] = createSignal(null);
  const frameObserver = new ResizeObserver(([entry]) =>
    setFrameSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
  );

  // where a float shows: where it is, kept in reach
  function floatBox(float) {
    const frame = frameSize();
    if (!frame) return float;
    const w = Math.min(float.w, frame.w);
    const h = Math.min(float.h, frame.h);
    return {
      w,
      h,
      x: Math.max(FLOAT_REACH.x - w, Math.min(float.x, frame.w - FLOAT_REACH.x)),
      y: Math.max(0, Math.min(float.y, frame.h - FLOAT_REACH.y)),
    };
  }

  // the top node a panel, group or split is in, from the doc
  function topOf(id) {
    const nodes = layoutHandle.doc()?.nodes ?? {};
    while (nodes[id]?.parent != null) id = nodes[id].parent;
    return nodes[id] ? id : null;
  }
  const isFloating = (id) => !!layoutHandle.doc()?.nodes?.[topOf(id)]?.float;

  function raise(node) {
    if (layout.floats.at(-1)?.id === node.id) return;
    const float = layoutHandle.doc()?.nodes?.[node.id]?.float;
    if (float) updateLayout((nodes) => Layout.float(nodes, node.id, float));
  }

  // "move", or an edge or corner: "n", "se"…
  function startFloat(event, node, edge) {
    if (event.button !== 0 || !node.float) return;
    event.preventDefault();
    const from = { ...floatBox(node.float), z: node.float.z };
    const sides = edge === "move" ? "" : edge;
    const sx = event.clientX;
    const sy = event.clientY;
    // sized, it stops at the frame's edges, so its own stay in reach
    const frame = frameSize() ?? { w: Infinity, h: Infinity };
    const most = {
      e: Math.max(FLOAT_MIN.w, frame.w - from.x),
      s: Math.max(FLOAT_MIN.h, frame.h - from.y),
      w: Math.max(FLOAT_MIN.w, from.x + from.w),
      n: Math.max(FLOAT_MIN.h, from.y + from.h),
    };
    dragLive(
      event,
      edge,
      (event) => {
        const dx = event.clientX - sx;
        const dy = event.clientY - sy;
        let { x, y, w, h } = from;
        if (edge === "move") {
          x += dx;
          y += dy;
        }
        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
        if (sides.includes("e")) w = clamp(from.w + dx, FLOAT_MIN.w, most.e);
        if (sides.includes("s")) h = clamp(from.h + dy, FLOAT_MIN.h, most.s);
        if (sides.includes("w")) {
          w = clamp(from.w - dx, FLOAT_MIN.w, most.w);
          x = from.x + from.w - w;
        }
        if (sides.includes("n")) {
          h = clamp(from.h - dy, FLOAT_MIN.h, most.n);
          y = from.y + from.h - h;
        }
        const box = floatBox({ x, y, w, h });
        const float = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(w), h: Math.round(h), z: from.z };
        return { [node.id]: { float } };
      },
      (nodes, fields) => Layout.float(nodes, node.id, fields[node.id].float),
    );
  }

  // a tab, out of the tiles: over where it was, a bit smaller
  function floatPanel(panel, groupId) {
    const frame = root.getBoundingClientRect();
    const section = root.querySelector(`[data-group="${CSS.escape(groupId)}"]`);
    const rect = section?.getBoundingClientRect() ?? frame;
    const w = Math.round(Math.min(Math.max(rect.width * 0.8, 320), frame.width));
    const h = Math.round(Math.min(Math.max(rect.height * 0.8, 240), frame.height));
    const x = Math.round(Math.max(0, rect.left - frame.left + (rect.width - w) / 2));
    const y = Math.round(Math.max(0, rect.top - frame.top + (rect.height - h) / 2));
    updateLayout((nodes) => Layout.float(nodes, panel.id, { x, y, w, h }));
    activate(panel.id);
  }

  // a floating tab, back in the tiles: in the pane last used, if that's tiled
  function dockPanel(panel) {
    updateLayout((nodes) => Layout.dock(nodes, panel.id, lastGroupId()));
    activate(panel.id);
  }

  // ── the pieces ─────────────────────────────────────────────────────────

  function Node(props) {
    return () =>
      props.node.type === "split"
        ? html`<${Split} node=${props.node} />`
        : html`<${Group} node=${props.node} />`;
  }

  function Split(props) {
    const split = props.node;
    return html`<div class="lattice-wm-split" data-direction=${() => split.direction}>
      <${For} each=${() => split.children}>
        ${(child, index) => [
          () =>
            index() > 0 &&
            html`<div
              class="lattice-wm-divider"
              role="separator"
              aria-orientation=${() => (split.direction === "row" ? "vertical" : "horizontal")}
              onPointerDown=${(event) => startResize(event, split, index() - 1)}
            ></div>`,
          html`<div class="lattice-wm-cell" style=${() => cellStyle(child, split.direction)}>
            <${Node} node=${child} />
          </div>`,
        ]}
      <//>
    </div>`;
  }

  // a group or split floating over the tiles. its tab bars move it (where
  // there aren't tabs), and its edges size it
  function Float(props) {
    const node = props.node;
    return html`<div
      class="lattice-wm-float"
      data-float=${node.id}
      style=${() => {
        const box = floatBox(node.float);
        return {
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.w}px`,
          height: `${box.h}px`,
          "z-index": 10 + node.float.z,
        };
      }}
      ref=${(el) => {
        // before anything in it (an editor, say) can keep the pointer to itself
        el.addEventListener("pointerdown", () => raise(node), true);
      }}
      onPointerDown=${(event) => {
        if (event.target.matches?.(".lattice-wm-tabs, .lattice-wm-tablist")) startFloat(event, node, "move");
      }}
    >
      <${Node} node=${node} />
      ${FLOAT_EDGES.map(
        (edge) => html`<div
          class="lattice-wm-float-edge"
          data-edge=${edge}
          onPointerDown=${(event) => startFloat(event, node, edge)}
        ></div>`,
      )}
    </div>`;
  }

  function Group(props) {
    const group = props.node;
    const active = createMemo(() => activeIn(group));
    let tabs;
    let body;
    let section;

    // where the selected tab is, across the pane, for the line round it
    // (.lattice-wm-ring): it's open there. measured whenever the tabs
    // move, change or scroll
    const [ring, setRing] = createSignal({});
    function measureRing() {
      if (!section || !tabs) return;
      const box = section.getBoundingClientRect();
      const tab = tabs.querySelector(".lattice-wm-tab[data-selected]")?.getBoundingClientRect();
      setRing({
        "--lattice-wm-ring-top": `${tabs.offsetHeight}px`,
        "--lattice-wm-ring-start": `${tab ? tab.left - box.left : 0}px`,
        "--lattice-wm-ring-end": `${tab ? tab.right - box.left : 0}px`,
      });
    }
    let ringFrame = null;
    const remeasure = () => {
      if (ringFrame == null) ringFrame = requestAnimationFrame(() => ((ringFrame = null), measureRing()));
    };
    const ringResized = new ResizeObserver(remeasure);
    // where ink's drawn on this pane (ink.js)
    let inkSvg;
    inkPanes.set(group.id, {
      get body() {
        return body;
      },
      get svg() {
        return inkSvg;
      },
      active,
    });
    onCleanup(() => inkPanes.delete(group.id));
    const ringChanged = new MutationObserver(remeasure);
    onCleanup(() => {
      ringResized.disconnect();
      ringChanged.disconnect();
      cancelAnimationFrame(ringFrame);
    });

    // which part of this pane a drag is over: the tab bar (as a tab), a band
    // along an edge (to split), over .js code (to import), or the middle
    function zoneFor(event) {
      const types = event.dataTransfer.types;
      const placing = LAYOUT_TYPES.some((type) => types.includes(type));
      const onTabs = tabs.contains(event.target);
      const rect = body.getBoundingClientRect();
      // over code that docs can be imported into, most of it is for that
      // (not files from the computer: they're no docs yet)
      const into = placing || onlyFiles(event.dataTransfer) ? null : hosts.get(active()?.id)?.el.dropInto;
      // over the tabs, it joins them (at the end), which the tab bar shows
      if (onTabs) return { zone: "center", lineTop: null, onTabs: true };
      // files over an editor's text are mostly its (intoEditor), as code is
      // an importer's: just a thin band along each edge splits
      const overText =
        onlyFiles(event.dataTransfer) &&
        event.composedPath().some((node) => node instanceof Element && node.classList.contains("cm-content"));
      const zone = zoneAt(event, rect, into || overText ? CODE_EDGE : undefined);
      if (zone === "center" && into) {
        const line = into.lineAt(event.clientX, event.clientY);
        if (line) return { zone: "code", lineTop: line.top - rect.top };
      }
      return { zone, lineTop: null };
    }
    dropTargets.set(group.id, zoneFor);
    onCleanup(() => {
      if (dropTargets.get(group.id) === zoneFor) dropTargets.delete(group.id);
    });

    const target = () => (dropTarget()?.groupId === group.id ? dropTarget() : null);
    // what dropping onto the tool says it does ("import here")
    const dropLabel = () => hosts.get(active()?.id)?.el.dropInto?.label;
    const onTabs = () => !!target()?.onTabs;
    // the pane's own hint, unless it's going in among the tabs
    const zone = () => (onTabs() ? null : (target()?.zone ?? null));
    const codeLine = () => target()?.lineTop ?? null;

    return html`<section
      class="lattice-wm-group"
      data-group=${group.id}
      ref=${(el) => {
        section = el;
        ringResized.observe(el);
      }}
      onPointerDown=${() => setLastGroupId(group.id)}
      onFocusIn=${() => setLastGroupId(group.id)}
      onPointerMove=${(event) => {
        // following and drawing, the ink sheet's over this and says where
        if (drawing()) return;
        sharePointer({ group: group.id, x: event.clientX, y: event.clientY });
      }}
      onPointerLeave=${offPanes}
    >
      <header
        class="lattice-wm-tabs"
        data-drop=${() => (onTabs() ? "" : undefined)}
        ref=${(el) => {
          tabs = el;
          ringResized.observe(el);
          ringChanged.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-selected"] });
        }}
        onScroll=${remeasure}
      >
        <div class="lattice-wm-tablist" role="tablist" aria-label="tabs" ref=${(el) => ringResized.observe(el)}>
          <${For} each=${() => group.panels}>
            ${(panel) => html`<${Tab} panel=${panel} group=${group} active=${() => active() === panel} />`}
          <//>
        </div>
        <${Show} when=${onTabs}>
          <div class="lattice-wm-tab-slot" aria-hidden="true"></div>
        <//>
        <button
          class="lattice-wm-add"
          title="open a file here, or start a new one"
          aria-label="open a file here, or start a new one"
          onClick=${(event) => openMenu(event, group.id)}
        >
          <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12">
            <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </header>
      ${() => {
        const panel = active();
        return panel && html`<${Bar} panel=${panel} />`;
      }}
      <div class="lattice-wm-body" ref=${(el) => (body = el)}>
        <${For} each=${() => group.panels}>
          ${(panel) => html`<${Panel} panel=${panel} active=${() => active() === panel} />`}
        <//>
        <${Show} when=${dragging}>
          <div class="lattice-wm-dropzone">
            <div class="lattice-wm-drop-hint" data-zone=${zone}></div>
            <${Show} when=${() => zone() === "code"}>
              <div class="lattice-wm-drop-line" style=${() => ({ top: `${codeLine()}px` })}>
                <${Show} when=${dropLabel}><span>${dropLabel}</span><//>
              </div>
            <//>
          </div>
        <//>
        <${Show} when=${() => notice()?.groupId === group.id}>
          <div class="lattice-wm-notice">${() => notice()?.text}</div>
        <//>
        <svg class="lattice-wm-ink" aria-hidden="true" ref=${(el) => (inkSvg = el)}></svg>
        <div class="lattice-wm-pointers" aria-hidden="true">
          <${For} each=${() => pointersOver(active())}>
            ${(person) => {
              const image = () => pointerImage(person.colour, person.look);
              // their face on it, while you're in a call with them
              const inCall = createMemo(() => (call.cursors() ? (call.find(person)?.id ?? null) : null));
              // over what it's over for them, wherever that is in yours now
              // (hidden while that's nowhere to be seen). from before
              // pointers said, where it is in their pane
              const place = createMemo(() => {
                pointerFrame();
                const pointer = person.pointer;
                if (!pointer?.anchor || !body) {
                  return { left: `${(pointer?.x ?? 0) * 100}%`, top: `${(pointer?.y ?? 0) * 100}%`, visibility: "visible" };
                }
                const at = placeAnchor(pointer.anchor, pointer.scale, { body, el: hosts.get(active()?.id)?.el ?? null });
                if (!at) return { left: "0px", top: "0px", visibility: "hidden" };
                const rect = body.getBoundingClientRect();
                return {
                  left: `${at.x + pointer.dx * at.k - rect.left}px`,
                  top: `${at.y + pointer.dy * at.k - rect.top}px`,
                  visibility: "visible",
                };
              });
              return html`<div
                class="lattice-wm-pointer"
                data-look=${() => person.look}
                style=${() => ({
                  ...place(),
                  "--lattice-wm-button-fill": person.colour,
                })}
              >
                <img
                  src=${() => image()?.src}
                  width=${() => image()?.size}
                  height=${() => image()?.size}
                  style=${() => ({ translate: `${-(image()?.x ?? 0)}px ${-(image()?.y ?? 0)}px` })}
                  alt=""
                />
                <span class="lattice-wm-pointer-name">${() => person.name}</span>
                ${() => {
                  const id = inCall();
                  return id ? html`<span class="lattice-wm-pointer-face"><${Face} id=${id} size=${44} title=${false} /></span>` : null;
                }}
              </div>`;
            }}
          <//>
        </div>
      </div>
      <div
        class="lattice-wm-ring"
        aria-hidden="true"
        data-colour=${() => active() && docColour(active().url)}
        data-glow=${() => active() && glow(active().url)}
        data-shared=${() => (active() && inManyPanes(active().url) ? "" : undefined)}
        style=${ring}
      ></div>
    </section>`;
  }

  function Panel(props) {
    const panel = props.panel;
    const info = docInfo(panel.url);
    let flash;

    // something an extension says was done to the doc it shows, here or by
    // anyone else, tints it for a moment, so you can see it
    createEffect(
      on(
        () => {
          const touched = touchedOf(panel.url);
          return touched?.flash ? touched.at : null;
        },
        (at, before) => {
          if (before == null || at == null || at === before) return;
          flash?.animate([{ opacity: 0.35 }, { opacity: 0 }], {
            duration: 700,
            easing: "ease-out",
          });
        },
        { defer: true },
      ),
    );

    return html`<div
      class="lattice-wm-panel"
      hidden=${() => !props.active}
      data-colour=${() => docColour(panel.url)}
      data-glow=${() => glow(panel.url)}
      data-shared=${() => (inManyPanes(panel.url) ? "" : undefined)}
      data-stuck=${() => (statusOf(panel.url)?.stuck ? "" : undefined)}
      onPointerEnter=${() => setHovered(panel.url)}
      onPointerLeave=${unhover}
    >
      <${Slot} panel=${panel} />
      <div class="lattice-wm-flash" ref=${(el) => (flash = el)}></div>
    </div>`;
  }

  function Tab(props) {
    const { panel, group } = props;
    const info = docInfo(panel.url);
    const [renaming, setRenaming] = createSignal(false);

    function rename(name) {
      setRenaming(false);
      renameFile(panel.url, name);
    }

    function onKeyDown(event) {
      if (event.key === "Enter") rename(event.currentTarget.value);
      if (event.key === "Escape") setRenaming(false);
    }

    let toolButton;
    // the tab, by keyboard: the arrows (and home and end) go along the tabs,
    // showing each; alt+down or the menu key is the tool menu; delete closes
    // it; f2 renames it
    function onTabKeyDown(event) {
      if (event.target !== event.currentTarget) return;
      const panels = group.panels;
      const at = panels.indexOf(panel);
      const goTo = (index) => {
        event.preventDefault();
        const next = panels[(index + panels.length) % panels.length];
        if (!next) return;
        showTab(group.id, next.id);
        focusTab(next.id);
      };
      if (event.key === "ArrowRight") goTo(at + 1);
      else if (event.key === "ArrowLeft") goTo(at - 1);
      else if (event.key === "Home") goTo(0);
      else if (event.key === "End") goTo(panels.length - 1);
      else if ((event.key === "ArrowDown" && event.altKey) || event.key === "ContextMenu") {
        event.preventDefault();
        showTab(group.id, panel.id);
        openToolMenuAt(toolButton, panel, group.id);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const neighbour = panels[at + 1] ?? panels[at - 1];
        updateLayout((nodes) => Layout.remove(nodes, panel.id));
        if (neighbour) focusTab(neighbour.id);
        // its pane's gone with it: the next pane's tab, so you're not lost
        else queueMicrotask(() => element.querySelector('[role="tab"][aria-selected="true"]')?.focus());
      } else if (event.key === "F2") {
        event.preventDefault();
        setRenaming(true);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showTab(group.id, panel.id);
      }
    }

    return html`<div
      class="lattice-wm-tab"
      draggable="true"
      data-panel=${panel.id}
      data-selected=${() => (props.active ? "" : undefined)}
      data-colour=${() => docColour(panel.url)}
      data-glow=${() => glow(panel.url)}
      data-shared=${() => (inManyPanes(panel.url) ? "" : undefined)}
      title=${() => `${info.name}\ndrag to move it, or onto a pane's edge to split it\ndouble click the name to rename`}
      onClick=${() => showTab(group.id, panel.id)}
      onDragStart=${(event) => {
        event.dataTransfer.setData(PANEL_TYPE, panel.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onPointerEnter=${() => setHovered(panel.url)}
      onPointerLeave=${unhover}
    >
      <span
        class="lattice-wm-tab-title"
        role="tab"
        tabindex=${() => (props.active ? "0" : "-1")}
        aria-selected=${() => String(!!props.active)}
        aria-label=${() => `${info.name}, ${toolName(panel)}`}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Alt+ArrowDown Delete F2"
        onKeyDown=${onTabKeyDown}
      >
        <span class="lattice-wm-swatch"></span>
        ${() =>
          renaming()
            ? html`<input
                class="lattice-wm-rename"
                value=${info.name}
                aria-label="name"
                ref=${(el) => queueMicrotask(() => (el.focus(), el.select()))}
                onKeyDown=${onKeyDown}
                onBlur=${(event) => rename(event.currentTarget.value)}
                onClick=${(event) => event.stopPropagation()}
              />`
            : html`<span
                class="lattice-wm-tab-name"
                title="double click to rename"
                onDblClick=${() => setRenaming(true)}
              >
                ${() => info.name}
              </span>`}
      </span>
      <button
        class="lattice-wm-tab-tool"
        aria-haspopup="menu"
        tabindex="-1"
        aria-hidden="true"
        ref=${(el) => (toolButton = el)}
        title="what it's shown with: change it here, or open it with something else in a new tab"
        onClick=${(event) => {
          event.stopPropagation();
          showTab(group.id, panel.id);
          openToolMenu(event, panel, group.id);
        }}
      >
        <span class="lattice-wm-tab-tool-name">${() => toolName(panel)}</span>
        <svg class="lattice-wm-tab-tool-arrow" aria-hidden="true" viewBox="0 0 10 6" width="10" height="6">
          <path d="M0 0h10L5 6z" fill="currentColor" />
        </svg>
      </button>
      <button
        class="lattice-wm-close"
        title="close"
        tabindex="-1"
        aria-hidden="true"
        onClick=${(event) => {
          event.stopPropagation();
          updateLayout((nodes) => Layout.remove(nodes, panel.id));
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 10 10" width="10" height="10">
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
    </div>`;
  }

  // the line under the tabs: which doc this is, what it's linked to, and
  // what the extensions say of it
  function Bar(props) {
    const panel = props.panel;
    // a chip each for its labelled links, made again only when they change
    const chips = createMemo(() => linksOf(panel.url).filter((link) => link.label), [], {
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    });

    // nothing to say, no bar: the tab runs straight into the tool
    return html`<${Show} when=${() => chips().length || statusOf(panel.url)}>
      <div class="lattice-wm-bar">
        <${For} each=${chips}>
          ${(link) => html`<button
            class="lattice-wm-link"
            title=${link.title ?? ""}
            onClick=${() => reveal(link.url, panel.id, "left")}
            data-colour=${docColour(link.url)}
            data-stale=${link.live ? undefined : ""}
            onPointerEnter=${() => setHovered(link.url)}
            onPointerLeave=${unhover}
          >
            ${link.label}
            <span class="lattice-wm-swatch"></span>
            <span class="lattice-wm-link-name">${() => docInfo(link.url).name}</span>
          </button>`}
        <//>
        <span class="lattice-wm-spacer"></span>
        <${Status} panel=${panel} />
      </div>
    <//>`;
  }

  // what an extension says of the doc: a line, and something to do about it
  function Status(props) {
    const panel = props.panel;
    const status = () => statusOf(panel.url);
    return html`<${Show} when=${status}>
      <span class="lattice-wm-status" data-state=${() => status()?.state}>
        ${() => status()?.text ?? ""}
        ${() => {
          const action = status()?.action;
          return (
            action &&
            html`<button
              class="lattice-wm-status-action"
              title=${action.title ?? ""}
              onClick=${() => action.run(panel.id)}
            >
              ${action.icon ? icon(action.icon) : ""} ${action.label}
            </button>`
          );
        }}
      </span>
    <//>`;
  }

  function Empty() {
    return html`<div class="lattice-wm-empty">
      <div class="lattice-wm-empty-card">
        <h2 class="lattice-wm-heading">nothing's open</h2>
        <p>drag anything in from the files, or</p>
        <div class="lattice-wm-empty-actions">
          ${primaryItem &&
          html`<button class="lattice-wm-button" onClick=${() => create(null, primaryItem)}>
            ${icon(primaryItem.icon)} ${primaryItem.primary === true ? primaryItem.label : primaryItem.primary}
          </button>`}
          <button class="lattice-wm-button" onClick=${(event) => openMenu(event, null)}>
            ${icon("folder")} open…
          </button>
        </div>
        <${Show} when=${() => notice() && !notice().groupId}>
          <p class="lattice-wm-empty-notice">${() => notice()?.text}</p>
        <//>
      </div>
    </div>`;
  }

  function Menu() {
    const item = (name, label, detail, onClick) => html`<button
      class="lattice-wm-menu-item"
      onClick=${onClick}
    >
      ${icon(name)}
      ${label}
      <small>${detail}</small>
    </button>`;

    return html`<div
      class="lattice-wm-menu"
      popover="auto"
      ref=${(el) => (menu = el)}
      onToggle=${(event) => event.newState === "closed" && setMenuFor(null)}
    >
      <${Show} when=${menuItems.length}>
        <div class="lattice-wm-menu-heading">new</div>
      <//>
      ${menuItems.map(
        (made) => html`<${Show} when=${() => !made.alt || altHeld()}>
          ${item(made.icon, made.label, made.detail ?? "", fromMenu((groupId) => create(groupId, made)))}
        <//>`,
      )}
      <div class="lattice-wm-menu-heading">in this project</div>
      <${For}
        each=${() => projectFiles()}
        fallback=${html`<div class="lattice-wm-menu-empty">nothing yet</div>`}
      >
        ${(file) => html`<button
          class="lattice-wm-menu-item lattice-wm-menu-file"
          data-colour=${docColour(file.url)}
          onClick=${fromMenu((groupId) => openDocs([file.url], groupId))}
          onPointerEnter=${() => setHovered(file.url)}
          onPointerLeave=${unhover}
        >
          <span class="lattice-wm-swatch"></span>
          ${file.name}
        </button>`}
      <//>
      <form class="lattice-wm-menu-url" onSubmit=${onOpenUrl}>
        <input
          name="url"
          placeholder="automerge:… url"
          autocomplete="off"
          onInput=${(event) => event.currentTarget.setCustomValidity("")}
        />
      </form>
      <p class="lattice-wm-menu-hint">or drag anything in from the files</p>
    </div>`;
  }

  function ToolMenu() {
    const tools = () => {
      const panel = toolMenuFor()?.panel;
      return panel ? toolChoices(panel.url) : [];
    };
    const isChosen = (tool) => {
      const panel = toolMenuFor()?.panel;
      const chosen = panel && shownWith(panel);
      return !!chosen && chosen.tool === tool.tool && chosen.patchworkTool === tool.patchworkTool;
    };

    function choose(tool) {
      const { panel } = toolMenuFor();
      toolMenu.hidePopover();
      updateLayout((nodes) => Layout.setTool(nodes, panel.id, tool.tool, tool.patchworkTool));
    }

    // what dragging a tab does, for the keyboard (and anyone): onto its own
    // pane's edge (`groupId` null), or in among another pane's tabs
    function moveTo(groupId, zone) {
      const { panel, groupId: from } = toolMenuFor();
      toolMenu.hidePopover();
      updateLayout((nodes) => Layout.movePanel(nodes, panel.id, groupId ?? from, zone));
      activate(panel.id);
      focusTab(panel.id);
    }
    const allPanes = () => [...groupsIn(layout.root), ...layout.floats.flatMap((float) => [...groupsIn(float)])];
    // the other panes, each by what it's showing
    const otherPanes = createMemo(() => {
      const from = toolMenuFor()?.groupId;
      if (!from) return [];
      return allPanes()
        .filter((group) => group.id !== from && group.panels.length)
        .map((group) => ({ id: group.id, shows: activeIn(group) }));
    });
    // a pane's only tab can't be split off from it
    const canSplit = () => {
      const from = toolMenuFor()?.groupId;
      return (allPanes().find((group) => group.id === from)?.panels.length ?? 0) > 1;
    };

    function openInNewTab(tool) {
      const { panel, groupId } = toolMenuFor();
      toolMenu.hidePopover();
      const [made] = updateLayout((nodes) =>
        Layout.openPanels(nodes, groupId, "center", [
          Layout.newPanel(panel.url, tool.tool, tool.patchworkTool),
        ]),
      );
      activate(made);
    }

    return html`<div
      class="lattice-wm-menu lattice-wm-tool-menu"
      popover="auto"
      role="menu"
      ref=${(el) => (toolMenu = el)}
      onToggle=${(event) => event.newState === "closed" && setToolMenuFor(null)}
    >
      <div class="lattice-wm-menu-heading">show with</div>
      <${For} each=${tools}>
        ${(tool) => html`<div class="lattice-wm-tool-option">
          <button
            class="lattice-wm-menu-item"
            role="menuitemradio"
            aria-checked=${() => String(isChosen(tool))}
            title=${`${tool.title}\nclick to show it with this here, or drag it to a tab bar or a pane's edge to open it there too`}
            draggable="true"
            onClick=${() => choose(tool)}
            onDragStart=${(event) => {
              event.dataTransfer.setData(
                TOOL_TYPE,
                JSON.stringify({
                  url: toolMenuFor().panel.url,
                  id: tool.tool,
                  patchworkTool: tool.patchworkTool,
                }),
              );
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            ${tool.name}
          </button>
          <button
            class="lattice-wm-open-new"
            title=${`open it with ${tool.name} in a new tab`}
            aria-label=${`open it with ${tool.name} in a new tab`}
            onClick=${() => openInNewTab(tool)}
          >
            ${icon("open-new", 12)}
          </button>
        </div>`}
      <//>
      <div class="lattice-wm-menu-rule" role="separator"></div>
      <${Show} when=${() => canSplit() || otherPanes().length}>
        <div class="lattice-wm-menu-heading">move it</div>
      <//>
      <${Show} when=${canSplit}>
        <button class="lattice-wm-menu-item" role="menuitem" onClick=${() => moveTo(null, "right")}>
          split right
        </button>
        <button class="lattice-wm-menu-item" role="menuitem" onClick=${() => moveTo(null, "bottom")}>
          split down
        </button>
      <//>
      <${For} each=${otherPanes}>
        ${(other) => html`<button
          class="lattice-wm-menu-item lattice-wm-menu-file"
          role="menuitem"
          data-colour=${() => docColour(other.shows.url)}
          onClick=${() => moveTo(other.id, "center")}
        >
          <span class="lattice-wm-swatch"></span>
          ${() => `in with ${docInfo(other.shows.url).name}`}
        </button>`}
      <//>
      <button
        class="lattice-wm-menu-item"
        role="menuitem"
        onClick=${() => {
          const { panel, groupId } = toolMenuFor();
          toolMenu.hidePopover();
          if (isFloating(panel.id)) dockPanel(panel);
          else floatPanel(panel, groupId);
        }}
      >
        ${() => {
          const panel = toolMenuFor()?.panel;
          return panel && isFloating(panel.id) ? "dock" : "float";
        }}
      </button>
    </div>`;
  }

  // a file from the list: brought forward if it's showing, else opened in
  // the pane last used. following someone, it stops, and it's yours it opens
  // in
  function open(url) {
    if (following()) follow(null);
    const showing = findShowing(url);
    if (showing) {
      showTab(showing.group.id, showing.panel.id);
      flashDoc(url);
    } else {
      openDocs([url], null);
    }
  }

  // taking a file out of the project: it's forgotten and its panes close.
  // the doc itself is still there for anything else that links to it
  function removeFile(url) {
    files.remove(url);
    updateLayout((nodes) => {
      for (const id of Object.keys(nodes)) {
        if (nodes[id]?.type === "panel" && nodes[id].url === url) Layout.remove(nodes, id);
      }
    });
  }

  // a file's menu (ui/context-menu.js), as a project's is in lattice's
  // sidebar: renaming it,
  // and taking it out of the project, which asks twice. delete on the file
  // opens it asking already
  let fileMenu;
  const [fileMenuFor, setFileMenuFor] = createSignal(null);
  const [fileMenuOpen, setFileMenuOpen] = createSignal(false);
  const [fileRemoving, setFileRemoving] = createSignal(false);
  function openFileMenu(at, url, { removing = false } = {}) {
    setFileMenuFor(url);
    setFileRemoving(removing);
    showMenuAt(fileMenu, at);
  }

  function removeFromMenu(url) {
    if (!fileRemoving()) return setFileRemoving(true);
    fileMenu.hidePopover();
    removeFile(url);
  }

  // when a doc was last done something to: what an extension says (built,
  // say), or else when it was edited. {verb, at}, or null
  function lastDone(url) {
    const touched = touchedOf(url);
    if (touched) return touched;
    const at = editedAtOf(url);
    return at ? { verb: "edited", at } : null;
  }

  // "built 3 min ago", "edited just now"
  function lastTouched(url) {
    const done = lastDone(url);
    return done ? `${done.verb} ${ago(done.at, clock())}` : "";
  }

  // the same, to the minute, for its tooltip
  function touchedWhen(url) {
    const done = lastDone(url);
    if (!done) return "";
    const when = ago(done.at, clock());
    const exactly = new Date(done.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    return `${done.verb} ${when.startsWith("on ") ? exactly : `${when} · ${exactly}`}`;
  }

  // the project's files, down the side of its panes
  function Files() {
    // the file whose name is being changed, in the files: double click it,
    // or f2 on it
    const [renamingFile, setRenamingFile] = createSignal(null);
    function finishRename(url, name) {
      if (renamingFile() !== url) return;
      setRenamingFile(null);
      if (name != null) renameFile(url, name);
      queueMicrotask(() =>
        element.querySelector(`.lattice-wm-file[data-url="${url}"] .lattice-wm-file-open`)?.focus({ preventScroll: true }),
      );
    }
    // files from the computer, dropped here: into the project, not opened
    const [filesOver, setFilesOver] = createSignal(false);
    // a file made or added while you're here comes in (ui/arriving.js)
    const arriving = arrivals();
    return html`<nav
      class="lattice-wm-files"
      aria-label="files"
      data-drop=${() => (filesOver() ? "" : undefined)}
      style=${() => ({ width: `${filesSidebar.width()}px` })}
      onDragOver=${(event) => {
        if (!onlyFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setFilesOver(true);
      }}
      onDragLeave=${(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFilesOver(false);
      }}
      onDrop=${(event) => {
        setFilesOver(false);
        if (!onlyFiles(event.dataTransfer)) return;
        event.preventDefault();
        importFiles([...event.dataTransfer.files], lastGroupId());
      }}
    >
      <${Resizer} sidebar=${filesSidebar} />
      <div class="lattice-wm-sidebar-content">
        <header class="lattice-wm-files-heading">
          <span class="lattice-wm-path" title=${() => projectName()}>${projectName}</span>
          <${Faces} />
          <${Show} when=${() => callProject && (secret() || callHere() || callOn())}>
            <button
              class="lattice-wm-icon-button lattice-wm-phone"
              ref=${(el) => {
                phone = el;
                holdSecret(el);
              }}
              data-on=${() => (callHere() ? "" : undefined)}
              data-ringing=${() => (callOn() && !callHere() ? "" : undefined)}
              title=${() => (callHere() ? "hang up" : callOn() ? "join the call" : "call everyone here")}
              aria-label=${() => (callHere() ? "hang up" : callOn() ? "join the call" : "call everyone here")}
              onClick=${pressPhone}
            >
              ${() => icon(callHere() ? "hang-up" : "phone", 14)}
            </button>
          <//>
          <button
            class="lattice-wm-icon-button"
            title="a new file, or open one"
            aria-label="a new file, or open one"
            onClick=${(event) => openMenu(event, null)}
          >
            ${icon("plus", 14)}
          </button>
        </header>
        <${For}
          each=${projectFiles}
          fallback=${html`<p class="lattice-wm-files-empty">no files yet</p>`}
        >
          ${(file) => html`<div
            class="lattice-wm-file"
            data-url=${file.url}
            data-colour=${docColour(file.url)}
            data-showing=${() => (findShowing(file.url) ? "" : undefined)}
            data-menu=${() => (fileMenuFor() === file.url && fileMenuOpen() ? "" : undefined)}
            data-arriving=${arriving(file.url)}
            draggable="true"
            ref=${rowMenu((at) => openFileMenu(at, file.url))}
            onDragStart=${(event) => {
              event.dataTransfer.setData(
                "text/x-patchwork-dnd",
                JSON.stringify({ items: [{ url: file.url, name: file.name }] }),
              );
              event.dataTransfer.effectAllowed = "copy";
            }}
            onPointerEnter=${() => setHovered(file.url)}
            onPointerLeave=${unhover}
          >
            ${() =>
              renamingFile() === file.url
                ? html`<div class="lattice-wm-file-open" data-renaming="">
                    <span class="lattice-wm-swatch"></span>
                    <input
                      class="lattice-wm-rename lattice-wm-file-rename"
                      value=${file.name}
                      aria-label=${`a new name for ${file.name}`}
                      ref=${(el) => queueMicrotask(() => (el.focus(), el.select()))}
                      onKeyDown=${(event) => {
                        if (event.key === "Enter") finishRename(file.url, event.currentTarget.value);
                        if (event.key === "Escape") finishRename(file.url, null);
                      }}
                      onBlur=${(event) => finishRename(file.url, event.currentTarget.value)}
                    />
                  </div>`
                : html`<button
                    class="lattice-wm-file-open"
                    title=${() =>
                      [file.name, touchedWhen(file.url), "click to open it, or drag it onto a pane · double click to rename · right click for menu"]
                        .filter(Boolean)
                        .join("\n")}
                    onClick=${() => open(file.url)}
                    onDblClick=${() => setRenamingFile(file.url)}
                    onKeyDown=${(event) => {
                      if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault();
                        const box = event.currentTarget.getBoundingClientRect();
                        openFileMenu({ x: box.left + 10, y: box.bottom - 4 }, file.url, { removing: true });
                      }
                      if (event.key === "F2") {
                        event.preventDefault();
                        setRenamingFile(file.url);
                      }
                    }}
                  >
                    <span class="lattice-wm-swatch"></span>
                    <span class="lattice-wm-file-name">${() => file.name}</span>
                    <span class="lattice-wm-file-when" title=${() => touchedWhen(file.url)}>
                      <span>${() => lastTouched(file.url)}</span>
                    </span>
                  </button>`}
          </div>`}
        <//>
      </div>
      <${FileMenu} rename=${setRenamingFile} />
    </nav>`;
  }

  function FileMenu(props) {
    const url = fileMenuFor;
    return html`<div
      class="lattice-wm-menu lattice-wm-file-menu"
      popover="auto"
      role="menu"
      ref=${(el) => (fileMenu = el)}
      onToggle=${(event) => {
        setFileMenuOpen(event.newState === "open");
        if (event.newState === "closed") {
          setFileRemoving(false);
        }
      }}
    >
      <button
        class="lattice-wm-menu-item"
        role="menuitem"
        onClick=${() => {
          const at = url();
          fileMenu.hidePopover();
          props.rename(at);
        }}
      >
        ${icon("pencil")} rename
      </button>
      <button
        class="lattice-wm-menu-item"
        role="menuitem"
        data-first=${() => (fileRemoving() ? "" : undefined)}
        data-danger=${() => (fileRemoving() ? "" : undefined)}
        title=${() => `take it out of ${projectName()} (the doc itself stays)`}
        onClick=${() => removeFromMenu(url())}
      >
        ${icon("close")} ${() => (fileRemoving() ? "remove?" : "remove")}
      </button>
    </div>`;
  }

  // who else is here: a face each. clicking one follows them, clicking it
  // again (or escape) stops
  function Faces() {
    // someone coming while you're here comes in (ui/arriving.js)
    const arriving = arrivals();
    return html`<${Show} when=${() => people.length}>
      <span class="lattice-wm-faces" role="group" aria-label="who's here" ref=${scrollsAlong}>
        <${For} each=${() => people}>
          ${(person) => {
            const image = () => faceImage(person.avatar);
            return html`<button
              class="lattice-wm-face"
              data-arriving=${arriving(person.peer)}
              style=${() => ({
                "--lattice-wm-face": person.colour || null,
                "background-image": image() ? `url("${image()}")` : null,
              })}
              aria-pressed=${() => String(following() === person.peer)}
              aria-label=${() => (following() === person.peer ? `stop following ${person.name}` : `follow ${person.name}`)}
              title=${() => (following() === person.peer ? `stop following ${person.name}` : `follow ${person.name}`)}
              onClick=${() => follow(person.peer)}
            >
              ${() => (image() ? "" : (person.name[0] ?? "?").toUpperCase())}
            </button>`;
          }}
        <//>
      </span>
    <//>`;
  }

  // following, a sheet over their panes to draw on (ink.js), the size of
  // the frame. your pointer goes to everyone from here too, as the panes
  // under it are inert. on it, at the corner of the line round their panes,
  // who it is you're following: pressed, you stop
  function InkSheet() {
    const leader = () => people.find((person) => person.peer === following());
    const box = () => {
      frameSize();
      const rect = root?.getBoundingClientRect();
      return rect
        ? { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }
        : { display: "none" };
    };
    function pointAt(event) {
      const { clientX: x, clientY: y } = event;
      for (const [group, { body, active }] of inkPanes) {
        const rect = body?.getBoundingClientRect();
        if (active() && rect?.width && rect.height && inside(rect, x, y)) return { group, x, y };
      }
      return null;
    }
    const modeButton = (mode, label, title) => html`<button
      class="lattice-wm-follow-mode"
      aria-pressed=${() => String(followMode() === mode)}
      title=${title}
      onPointerDown=${(event) => event.stopPropagation()}
      onClick=${() => setFollowMode(mode)}
    >
      ${label}
    </button>`;
    return html`<div
      class="lattice-wm-ink-sheet"
      data-mode=${followMode}
      style=${box}
      onPointerDown=${(event) => {
        if (followMode() === "draw" && ink.start(event)) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove=${(event) => {
        ink.move(event);
        sharePointer(pointAt(event));
      }}
      onPointerUp=${() => ink.end()}
      onPointerCancel=${() => ink.end()}
      onLostPointerCapture=${() => ink.end()}
      onPointerLeave=${offPanes}
    >
      <div
        class="lattice-wm-following-tag"
        style=${() => ({ "--lattice-wm-button-fill": followingColour() })}
      >
        <button
          class="lattice-wm-following-who"
          title="stop following"
          onPointerDown=${(event) => event.stopPropagation()}
          onClick=${() => follow(null)}
        >
          following ${() => leader()?.name ?? "someone"}
        </button>
        <span class="lattice-wm-follow-modes" role="group" aria-label="pressing on their panes">
          ${modeButton("draw", "draw", "draw on their panes, for them to see")}
          ${modeButton("use", "type", "use their panes: edit, select, and type in terminals, still following")}
        </span>
      </div>
    </div>`;
  }

  // the colour round the panes while they're someone else's
  const followingColour = () => people.find((person) => person.peer === following())?.colour || null;

  // the files, shut, when nothing else opens them: a strip to open them
  function FilesShut() {
    return html`<button
      class="lattice-wm-files-shut"
      title="show the files"
      onClick=${() => filesSidebar.setOpen(true)}
    >
      files
    </button>`;
  }

  onOpen?.(open);

  // what each pane is showing: its active panel's doc
  function showing() {
    const docs = [];
    for (const group of allGroups()) {
      const panel = activeIn(group);
      if (panel && !docs.some((doc) => doc.url === panel.url)) {
        docs.push({ url: panel.url, name: docInfo(panel.url).name });
      }
    }
    return docs;
  }

  // the doc in the pane you're in
  function focused() {
    const group = findGroup(lastGroupId()) ?? allGroups()[0];
    const panel = group && activeIn(group);
    return panel ? { url: panel.url, name: docInfo(panel.url).name } : null;
  }

  const dispose = render(() => {
    // while anyone's pointer is about, it's placed again every frame: what
    // it's over moves under it as you scroll, zoom and type
    const pointersAbout = createMemo(() => people.some((person) => person.pointer));
    createEffect(() => {
      if (!pointersAbout()) return;
      let frame = requestAnimationFrame(function tick() {
        setPointerFrame((n) => n + 1);
        frame = requestAnimationFrame(tick);
      });
      onCleanup(() => cancelAnimationFrame(frame));
    });
    createEffect(() => onShowing?.(showing()));
    createEffect(() => onFocused?.(focused()));
    createEffect(() => room?.share("look", look?.() === "mouse" ? "mouse" : "arrow"));
    // who you're following, for anyone following you (they stop)
    createEffect(() => room?.share("following", following()));
    // what the extensions share of yours, for everyone else, as it changes
    for (const { channel, mine } of presenceKeys) {
      let sent = "";
      createEffect(() => {
        if (!room) return;
        const json = JSON.stringify(mine(api) ?? null);
        if (json === sent) return;
        sent = json;
        room.share(channel, JSON.parse(json));
      });
    }
    return html`<link
        rel="stylesheet"
        href=${STYLESHEET}
        onLoad=${() => setStyled(true)}
        onError=${() => setStyled(true)}
      />
      <div
        class="lattice-wm lattice-wm-project"
        style=${() => (styled() ? {} : { visibility: "hidden" })}
      >
        <${Show} when=${filesSidebar.open} fallback=${sidebar ? null : html`<${FilesShut} />`}>
          <${Files} />
        <//>
        <div
          class="lattice-wm-frame"
          ref=${(el) => {
            root = el;
            listenForDrops(el);
            frameObserver.observe(el);
          }}
          data-resizing=${resizing}
          data-following=${() => (following() ? "" : undefined)}
          inert=${drawing}
          style=${() => ({ "--lattice-wm-following": followingColour() })}
        >
          ${() => (layout.root ? html`<${Node} node=${layout.root} />` : html`<${Empty} />`)}
          <${For} each=${() => layout.floats}>${(node) => html`<${Float} node=${node} />`}<//>
          <${Show} when=${outerZone}>
            <div class="lattice-wm-outer-hint" data-zone=${outerZone}></div>
          <//>
          <${Menu} />
          <${ToolMenu} />
        </div>
        <${Show} when=${following}><${InkSheet} /><//>
        <${Show} when=${() => callProject}>
          <${CallPrompt} near=${() => phone?.isConnected ? phone : root} />
          <${CallFloating} panes=${() => root} />
        <//>
        <${Show} when=${() => callProject}>
          <${CallStage}
            box=${() => {
              // over the panes: where they are in the project
              frameSize();
              return root
                ? { left: `${root.offsetLeft}px`, top: `${root.offsetTop}px`, width: `${root.offsetWidth}px`, height: `${root.offsetHeight}px` }
                : { display: "none" };
            }}
          />
        <//>
      </div>`;
  }, element);

  return function unmount() {
    layoutHandle.off("change", readLayout);
    layoutHandle.off("ephemeral-message", onDragMessage);
    clearTimeout(pointerTimer);
    document.removeEventListener("visibilitychange", onHidden);
    document.removeEventListener("scroll", pointerAgain, { capture: true });
    document.removeEventListener("wheel", pointerAgain, { capture: true });
    views.stop();
    room?.stop();
    clearTimeout(shareTimer);
    clearTimeout(viewTimer);
    roomHandle?.off("ephemeral-message", onInkMessage);
    ink.stop();
    tabChannel.close();
    frameObserver.disconnect();
    clearTimeout(lapse);
    clearTimeout(followGrace);
    clearTimeout(leaderGrace);
    clearTimeout(sendTimer);
    offFiles();
    document.removeEventListener("dragover", onDocumentDragOver);
    document.removeEventListener("dragend", stopDragging);
    document.removeEventListener("drop", stopDragging);
    document.removeEventListener("keydown", onAltKey);
    document.removeEventListener("pointerdown", onPressWhileOpen, true);
    menusOff();
    document.removeEventListener("keyup", onAltKey);
    offCalls();
    offCallProject();
    clearTimeout(noticeTimer);
    clearInterval(ticker);
    offPatchworkTools();
    for (const [id, host] of hosts) destroyHost(id, host);
    for (const entry of infos.values()) {
      entry.gone = true;
      entry.off?.();
    }
    dispose();
  };
}
