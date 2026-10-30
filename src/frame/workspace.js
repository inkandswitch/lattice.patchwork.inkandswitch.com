import { createSignal, createMemo, createEffect, on, onCleanup, For, Show } from "solid-js";
import { createStore, reconcile, produce, unwrap } from "solid-js/store";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { getHeads, inspectChange } from "@automerge/automerge";
import {
  getFallbackTool,
  getRegistry,
  getSupportedToolsForType,
} from "@inkandswitch/patchwork-plugins";
import {
  TOOLS,
  toolsFor,
  fileExtension,
  docColour,
  docText,
  shortUrl,
  newFileDoc,
  folderUrls,
  folderLink,
  folderTitle,
  urlFromText,
  textHash,
  createDocOfDatatype,
} from "./files.js";
import {
  findNode,
  findPanel,
  findPanelShowing,
  newPanel,
  newGroup,
  newSplit,
  addRow,
  openPanels,
  movePanel,
  removePanel,
  setTool,
  activate,
} from "./layout.js";
import defaultSource from "./default-source.js";
import { Resizer } from "./sidebars.js";
import { builds, setBuild } from "./builds.js";

const STYLESHEET = new URL("./frame.css", import.meta.url).href;

async function loadDatatype(type) {
  if (!type || type === "file") return undefined;
  try {
    return await getRegistry("patchwork:datatype").load(type);
  } catch {
    return undefined;
  }
}

// "just now", "4 min ago": how long since a .k was built
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
function editedAt(doc) {
  try {
    const times = getHeads(doc).map((hash) => inspectChange(doc, hash)?.time ?? 0);
    const latest = Math.max(0, ...times);
    return latest ? latest * 1000 : null;
  } catch {
    return null;
  }
}

const MIN_CELL = 80;
const EDGE = 0.22;
const MAX_EDGE = 64;
const CODE_EDGE = 28;
const OUTER_EDGE = 10;

// what can be dragged in: our own tabs, the tools in a tab's tool menu (to
// open that file with that tool somewhere else), and docs from the sidebar
const PANEL_TYPE = "application/x-knitoutjs-panel";
const TOOL_TYPE = "application/x-knitoutjs-tool";
// drags that place a pane, rather than bring a doc in
const LAYOUT_TYPES = [PANEL_TYPE, TOOL_TYPE];
const DOC_TYPES = [
  "text/x-patchwork-dnd",
  "text/x-patchwork-urls",
  "text/uri-list",
];

function isOurDrag(dataTransfer) {
  return [...LAYOUT_TYPES, ...DOC_TYPES].some((type) =>
    dataTransfer?.types.includes(type),
  );
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

/**
 * a project's workspace: the panes showing its files (and anything else).
 * `folder` is the project's folder, whose entries are its files; `workspace`
 * is its workspace doc, whose `layout` is the panes. `repo` resolves through
 * the project's draft overlay, so what's done here goes into whichever draft
 * is checked out; `baseRepo` doesn't, for docs that mustn't be forked into a
 * draft (a terminal: latticex is on the original). `files` is the files
 * column's sidebar state (sidebars.js), which the frame's top bar toggles.
 * `onShowing` hears the docs the panes are showing ({ url, name }, one per
 * pane), for the inspectors; `onOpen` gets a way to bring a doc forward.
 * `hive` is the frame's keyhive, if the site has one, for new docs
 */
export function mountWorkspace(
  { workspace, folder },
  element,
  { repo, baseRepo, hive, files, onShowing, onOpen },
) {
  let root;
  let menu;

  // ── what's in the project ──────────────────────────────────────────────

  const [layout, setLayout] = createStore({ root: null });
  const [fileUrls, setFileUrls] = createSignal([]);
  const [projectName, setProjectName] = createSignal("");

  function readLayout() {
    const doc = workspace.doc();
    const tree = doc?.layout ? JSON.parse(JSON.stringify(doc.layout)) : null;
    setLayout("root", reconcile(tree, { key: "id" }));
  }
  function readFolder() {
    const doc = folder.doc();
    setFileUrls(folderUrls(doc));
    setProjectName(folderTitle(doc));
  }
  readLayout();
  readFolder();
  workspace.on("change", readLayout);
  folder.on("change", readFolder);

  function updateLayout(change) {
    const next = change(structuredClone(unwrap(layout.root) ?? null));
    workspace.change((doc) => {
      doc.layout = next ?? null;
    });
  }

  // the project's files are its folder's entries: a link with the doc's name
  // and type, as patchwork's folder tool makes them
  async function addFiles(urls) {
    const fresh = urls.filter((url) => !fileUrls().includes(url));
    const links = await Promise.all(
      fresh.map(async (url) => {
        const doc = (await repo.find(url)).doc();
        const datatype = await loadDatatype(doc?.["@patchwork"]?.type);
        return folderLink(url, doc, datatype?.module.getTitle?.(doc));
      }),
    );
    folder.change((doc) => {
      doc.docs ??= [];
      const have = folderUrls(doc);
      for (const link of links) if (!have.includes(link.url)) doc.docs.push(link);
    });
  }

  // name, extension and links of any doc we show, kept up to date
  const infos = new Map();
  function docInfo(url) {
    if (!url) return {};
    let entry = infos.get(url);
    if (!entry) {
      const [info, setInfo] = createStore({
        name: shortUrl(url),
        extension: "",
        target: null,
        source: null,
        editable: false,
        copyOf: null,
        type: null,
        builtAt: null,
        editedAt: null,
        sourceHash: null,
        textHash: null,
      });
      entry = { info, off: null };
      infos.set(url, entry);
      repo
        .find(url)
        .then(async (docHandle) => {
          // a doc that isn't a file (markdown, say) may only have a title its
          // datatype can find in it
          const datatype = await loadDatatype(docHandle.doc()?.["@patchwork"]?.type);
          const update = () => {
            const doc = docHandle.doc();
            setInfo({
              name: doc?.name || doc?.title || datatype?.module.getTitle?.(doc) || shortUrl(url),
              extension: fileExtension(doc),
              target: doc?.knitoutTarget ?? null,
              source: doc?.knitoutSource ?? null,
              editable: typeof doc?.content === "string",
              copyOf: doc?.knitoutCopyOf ?? null,
              type: doc?.["@patchwork"]?.type ?? null,
              // a .k: when it was built, and from what code
              builtAt: doc?.knitoutBuiltAt ?? null,
              // anything else: when it was last changed (a built .k's newest
              // change is its whole knitout, which isn't worth unpacking)
              editedAt: doc?.knitoutBuiltAt ? null : editedAt(doc),
              sourceHash: doc?.knitoutSourceHash ?? null,
              // a .js: its code now, to tell the .k it writes is out of date
              textHash: fileExtension(doc) === "js" ? textHash(docText(doc)) : null,
            });
          };
          update();
          docHandle.on("change", update);
          entry.off = () => docHandle.off("change", update);
        })
        .catch(() => setInfo({ name: `missing ${shortUrl(url)}` }));
    }
    return entry.info;
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

  // ── links: hovering anything that shows a doc lights up every pane that
  //    shows it, and more softly the panes showing the docs it's linked to

  const [hovered, setHovered] = createSignal(null);

  // linked = a .js and the .k it writes into now (a .k also remembers which
  // .js wrote it last, but that's history, so it doesn't light up)
  // (and a .k and its editable copy)
  function linked(a, b) {
    const one = docInfo(a);
    const two = docInfo(b);
    return one.target === b || two.target === a || one.copyOf === b || two.copyOf === a;
  }

  function glow(url) {
    const lit = hovered();
    if (!lit || !url) return undefined;
    if (lit === url) return "same";
    return linked(lit, url) ? "linked" : undefined;
  }

  const unhover = () => setHovered(null);

  // a doc open in more than one pane is marked out in each, in its colour
  const paneCounts = createMemo(() => {
    const counts = new Map();
    (function count(node) {
      if (!node) return;
      if (node.type === "split") return node.children.forEach(count);
      for (const url of new Set(node.panels.map((panel) => panel.url))) {
        counts.set(url, (counts.get(url) ?? 0) + 1);
      }
    })(layout.root);
    return counts;
  });
  const inManyPanes = (url) => (paneCounts().get(url) ?? 0) > 1;

  // ── builds: a generated .k says how up to date it is. a "now" that ticks,
  //    for how long ago it was built
  const [clock, setClock] = createSignal(Date.now());
  const ticker = setInterval(() => setClock(Date.now()), 15_000);

  // build a .js into its .k again: by its editor, if it's open in one, so
  // its build bar shows it too
  async function rebuild(jsUrl, kUrl) {
    const builder = builds[jsUrl]?.builder;
    if (builder) return builder.now();
    const [{ runInto }, jsHandle, kHandle] = await Promise.all([
      import("./run.js"),
      repo.find(jsUrl),
      repo.find(kUrl),
    ]);
    setBuild(jsUrl, { state: "running", line: undefined, message: undefined });
    const { error } = await runInto(jsHandle, kHandle, repo);
    setBuild(
      jsUrl,
      error
        ? { state: "error", line: error.line ?? undefined, message: String(error.message ?? error) }
        : { state: "ok" },
    );
  }

  // a build that failed: show the .js, at the line it failed on
  async function showError(jsUrl, fromPanelId) {
    await reveal(jsUrl, fromPanelId, "left", "editor");
    const line = builds[jsUrl]?.line;
    if (line != null) builds[jsUrl]?.builder?.goToLine(line);
  }

  // ── tools: each panel's tool lives in its own element, which moves with
  //    the panel when the layout changes rather than starting over

  // show a linked doc: if it's open already, bring its tab forward and light
  // it up for a moment; if not, open it on one side of the pane asking
  async function reveal(url, fromPanelId, edge, toolId) {
    if (!url) return;
    const showing = findPanelShowing(layout.root, url);
    if (showing) {
      const { group, index } = showing;
      updateLayout((tree) => activate(tree, group.id, group.panels[index].id));
    } else {
      const doc = (await repo.find(url)).doc();
      const tool = toolId ?? toolsFor(fileExtension(doc))[0].id;
      const from = findPanel(layout.root, fromPanelId)?.group.id ?? null;
      addFiles([url]);
      updateLayout((tree) => openPanels(tree, from, edge, [newPanel(url, tool)]));
    }
    setHovered(url);
    setTimeout(() => hovered() === url && setHovered(null), 900);
  }

  // a generated .k is read only (it's stored whole, which keeps big ones
  // fast); this makes a plain-text copy beside it to edit by hand
  async function editableCopy(panel) {
    const doc = (await repo.find(panel.url)).doc();
    const stem = (doc?.name ?? "pattern.k").replace(/\.k$/, "");
    const copy = await createFile(`${stem}-copy.k`, {
      content: docText(doc),
      knitoutCopyOf: panel.url,
    });
    reveal(copy, panel.id, "right", "editor");
  }

  function panelOf(toolElement) {
    for (const [id, host] of hosts) if (host.el === toolElement) return id;
    return null;
  }

  const toolContext = {
    repo,
    open: (url, toolElement, edge) => reveal(url, panelOf(toolElement), edge),
    openIfClosed: (url, toolElement, edge) =>
      findPanelShowing(layout.root, url) || reveal(url, panelOf(toolElement), edge),
    editableCopy: (url, toolElement) => editableCopy({ id: panelOf(toolElement), url }),
    get events() {
      return root;
    },
    project: { files: projectFiles, createFile },
    hover: setHovered,
  };

  const hosts = new Map();

  function hostFor(panel) {
    const { id, url, tool, patchworkTool } = panel;
    let host = hosts.get(id);
    if (host && host.url === url && host.tool === tool && host.patchworkTool === patchworkTool) {
      return host;
    }
    if (host) destroyHost(id, host);
    host = { url, tool, patchworkTool, el: document.createElement("div"), cleanup: null };
    host.el.className = "knitoutjs-tool";
    hosts.set(id, host);
    mountTool(host);
    return host;
  }

  // say a pane's doc is mounted (or not) as a <patchwork-view> would, so the
  // project's providers know what's open: comments watches those docs for
  // threads, and drafts lists them. from the workspace's element, which is
  // still in the page when a pane's own has already gone
  function announce(type, host) {
    element.dispatchEvent(
      new CustomEvent(type, {
        detail: { url: host.url, toolId: `lattice:${host.tool}` },
        bubbles: true,
        composed: true,
      }),
    );
  }

  async function mountTool(host) {
    const tool = TOOLS[host.tool];
    try {
      const [docHandle, module] = await Promise.all([
        (tool.drafts === false ? baseRepo : repo).find(host.url),
        tool.load(),
      ]);
      if (host.dead) return;
      host.cleanup = module.default(docHandle, host.el, {
        ...toolContext,
        toolId: host.patchworkTool,
      });
      host.announced = true;
      announce("patchwork:mounted", host);
    } catch (error) {
      if (host.dead) return;
      host.el.classList.add("knitoutjs-tool-broken");
      host.el.textContent = `couldn't open this: ${error.message ?? error}`;
    }
  }

  function destroyHost(id, host) {
    if (host.dead) return;
    host.dead = true;
    host.cleanup?.();
    if (host.announced) announce("patchwork:unmounted", host);
    host.el.remove();
    if (hosts.get(id) === host) hosts.delete(id);
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
    return html`<div class="knitoutjs-slot" ref=${(el) => (slot = el)}></div>`;
  }

  // ── opening things ─────────────────────────────────────────────────────

  const [notice, setNotice] = createSignal(null);
  let noticeTimer;
  function notify(groupId, text) {
    clearTimeout(noticeTimer);
    setNotice({ groupId, text });
    noticeTimer = setTimeout(() => setNotice(null), 3500);
  }

  // the pane last clicked in: where things opened from the files go
  let lastGroupId = null;

  async function openDocs(urls, groupId, zone = "center") {
    groupId ??= findNode(layout.root, lastGroupId) ? lastGroupId : null;
    const panels = [];
    const refused = [];
    for (const url of urls) {
      try {
        const doc = (await repo.find(url)).doc();
        panels.push(newPanel(url, toolsFor(fileExtension(doc))[0].id));
      } catch {
        refused.push(shortUrl(url));
      }
    }
    if (panels.length) {
      addFiles(panels.map((panel) => panel.url));
      updateLayout((tree) => openPanels(tree, groupId, zone, panels));
    }
    if (refused.length) {
      notify(groupId, `couldn't find ${refused.join(", ")}`);
    }
  }

  // a .js and the .k it writes, side by side on a row of their own
  async function newPattern() {
    const k = await createFile("pattern.k");
    const js = await createFile("pattern.knitout.js", {
      content: defaultSource,
      knitoutTarget: k,
    });
    const row = newSplit("row", [
      newGroup([newPanel(js, "editor")]),
      newGroup([newPanel(k, "visualizer")]),
    ]);
    updateLayout((tree) => addRow(tree, row));
    const [{ runInto }, jsHandle, kHandle] = await Promise.all([
      import("./run.js"),
      repo.find(js),
      repo.find(k),
    ]);
    runInto(jsHandle, kHandle, repo);
  }

  async function newFile(groupId, name) {
    openDocs([await createFile(name)], groupId);
  }

  // a doc of one of patchwork's own datatypes, as its sidebar makes them
  async function newDoc(groupId, type) {
    const datatype = await loadDatatype(type);
    if (!datatype) throw new Error(`no datatype registered for "${type}"`);
    const handle = await createDocOfDatatype(datatype, repo, undefined, hive);
    addFiles([handle.url]);
    openDocs([handle.url], groupId);
  }

  // a doc for latticex to share a terminal over: it shows the command to run
  async function newTerminal(groupId) {
    const terminal = await repo.create2({
      "@patchwork": { type: "latticex" },
      title: "terminal",
    });
    openDocs([terminal.url], groupId);
  }

  const [menuFor, setMenuFor] = createSignal(null);
  // the menu has more in it while alt is held
  const [altHeld, setAltHeld] = createSignal(false);
  const onAltKey = (event) => {
    if (event.key === "Alt") setAltHeld(event.type === "keydown");
  };
  document.addEventListener("keydown", onAltKey);
  document.addEventListener("keyup", onAltKey);

  function openMenu(event, groupId) {
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

  // the one patchwork would pick first. not frames (this one included: it's
  // for folders, but not inside a pane of itself)
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
          tool.id !== "lattice",
      )
      .sort((a, b) => (b.id === first) - (a.id === first) || a.name.localeCompare(b.name));
  }

  // [{tool, patchworkTool?, name, title}]
  function toolChoices(url) {
    const info = docInfo(url);
    return toolsFor(info.extension)
      .sort((a, b) => a.position - b.position)
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
    return shownWith(panel)?.name ?? TOOLS[panel.tool]?.name ?? panel.tool;
  }

  // a tab's tool menu: what it's shown with, and what else it could be
  let toolMenu;
  const [toolMenuFor, setToolMenuFor] = createSignal(null);

  function openToolMenu(event, panel, groupId) {
    setToolMenuFor({ panel, groupId });
    const rect = event.currentTarget.getBoundingClientRect();
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
  // it: {groupId, zone, lineTop}. the panes only show this; the frame works
  // it out, at its root, so nothing inside a pane (an editor, a canvas) can
  // take the drop first
  const [dropTarget, setDropTarget] = createSignal(null);
  const dropTargets = new Map(); // group id → (event) => {zone, lineTop}

  // browsers often leave dragleave's relatedTarget empty, so count instead:
  // every element entered is left again
  let entered = 0;

  // the drop effect to answer with, for what's being dragged
  function dropEffectFor(dataTransfer) {
    const types = dataTransfer.types;
    if (types.includes(PANEL_TYPE)) return "move";
    return "copy";
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
    if (!layout.root) return { groupId: null, zone: "center" };
    const section = event.target.closest?.(".knitoutjs-group");
    const zoneFor = section && dropTargets.get(section.dataset.group);
    return zoneFor ? { groupId: section.dataset.group, ...zoneFor(event) } : null;
  }

  function onRootDragOver(event) {
    if (!isOurDrag(event.dataTransfer)) return;
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
    event.preventDefault();
    event.stopPropagation();
    const target = dropTargetAt(event);
    stopDragging();
    if (!target) return;
    const group = target.groupId && findNode(layout.root, target.groupId);
    const active = group?.panels?.find((panel) => panel.id === group.active) ?? group?.panels?.[0];
    drop(event, target.groupId, target.zone, active);
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
      updateLayout((tree) => movePanel(tree, panelId, groupId, zone));
      return;
    }
    const tool = dataTransfer.getData(TOOL_TYPE);
    if (tool) {
      const { url, id, patchworkTool } = JSON.parse(tool);
      const at = zone === "code" ? "center" : zone;
      updateLayout((tree) => openPanels(tree, groupId, at, [newPanel(url, id, patchworkTool)]));
      return;
    }
    const docs = droppedDocs(dataTransfer);
    if (zone === "code") {
      hosts.get(activePanel.id)?.el.dropInto?.drop(docs, event.clientX, event.clientY);
      return;
    }
    openDocs(docs.map((doc) => doc.url), groupId, zone);
  }

  // ── resizing splits (flex-basis, committed when you let go) ─────────────

  const [resizing, setResizing] = createSignal(null);

  function startResize(event, splitId, left) {
    const resizer = event.currentTarget;
    const box = resizer.parentElement.getBoundingClientRect();
    const split = findNode(layout.root, splitId);
    const row = split.direction === "row";
    resizer.setPointerCapture(event.pointerId);
    setResizing(row ? "row" : "column");

    const start = row ? event.clientX : event.clientY;
    const length = row ? box.width : box.height;
    const sizes = [...split.sizes];
    const pair = sizes[left] + sizes[left + 1];
    const min = Math.min((MIN_CELL / length) * 100, pair / 2);

    function onMove(event) {
      const delta = (((row ? event.clientX : event.clientY) - start) / length) * 100;
      const size = Math.min(Math.max(sizes[left] + delta, min), pair - min);
      setLayout(
        produce((state) => {
          const node = findNode(state.root, splitId);
          node.sizes[left] = size;
          node.sizes[left + 1] = pair - size;
        }),
      );
    }

    function onUp() {
      setResizing(null);
      resizer.removeEventListener("pointermove", onMove);
      resizer.removeEventListener("pointerup", onUp);
      resizer.removeEventListener("pointercancel", onUp);
      updateLayout((tree) => tree);
    }

    resizer.addEventListener("pointermove", onMove);
    resizer.addEventListener("pointerup", onUp);
    resizer.addEventListener("pointercancel", onUp);
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
    return html`<div class="knitoutjs-split" data-direction=${() => split.direction}>
      <${For} each=${() => split.children}>
        ${(child, index) => [
          () =>
            index() > 0 &&
            html`<div
              class="knitoutjs-resizer"
              role="separator"
              aria-orientation=${() => (split.direction === "row" ? "vertical" : "horizontal")}
              onPointerDown=${(event) => startResize(event, split.id, index() - 1)}
            ></div>`,
          html`<div
            class="knitoutjs-cell"
            style=${() => ({
              "flex-basis": `${split.sizes[index()] ?? 100 / split.children.length}%`,
            })}
          >
            <${Node} node=${child} />
          </div>`,
        ]}
      <//>
    </div>`;
  }

  function Group(props) {
    const group = props.node;
    const active = createMemo(
      () => group.panels.find((panel) => panel.id === group.active) ?? group.panels[0],
    );
    let tabs;
    let body;

    // which part of this pane a drag is over: the tab bar (as a tab), a band
    // along an edge (to split), over .js code (to import), or the middle
    function zoneFor(event) {
      const types = event.dataTransfer.types;
      const placing = LAYOUT_TYPES.some((type) => types.includes(type));
      const onTabs = tabs.contains(event.target);
      const rect = body.getBoundingClientRect();
      // over code that docs can be imported into, most of it is for that
      const into = placing ? null : hosts.get(active()?.id)?.el.dropInto;
      const zone = onTabs ? "center" : zoneAt(event, rect, into ? CODE_EDGE : undefined);
      if (zone === "center" && into && !onTabs) {
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
    const zone = () => target()?.zone ?? null;
    const codeLine = () => target()?.lineTop ?? null;

    return html`<section
      class="knitoutjs-group"
      data-group=${group.id}
      onPointerDown=${() => (lastGroupId = group.id)}
    >
      <header class="knitoutjs-tabs" role="tablist" ref=${(el) => (tabs = el)}>
        <${For} each=${() => group.panels}>
          ${(panel) => html`<${Tab} panel=${panel} group=${group} active=${() => active() === panel} />`}
        <//>
      </header>
      ${() => {
        const panel = active();
        return panel && html`<${Bar} panel=${panel} />`;
      }}
      <div class="knitoutjs-body" ref=${(el) => (body = el)}>
        <${For} each=${() => group.panels}>
          ${(panel) => html`<${Panel} panel=${panel} active=${() => active() === panel} />`}
        <//>
        <${Show} when=${dragging}>
          <div class="knitoutjs-dropzone">
            <div class="knitoutjs-drop-hint" data-zone=${zone}></div>
            <${Show} when=${() => zone() === "code"}>
              <div class="knitoutjs-drop-line" style=${() => ({ top: `${codeLine()}px` })}>
                <span>import here</span>
              </div>
            <//>
          </div>
        <//>
        <${Show} when=${() => notice()?.groupId === group.id}>
          <div class="knitoutjs-notice">${() => notice()?.text}</div>
        <//>
      </div>
    </section>`;
  }

  function Panel(props) {
    const panel = props.panel;
    const info = docInfo(panel.url);
    let flash;

    // a new build of the doc it shows (from here or anyone else) tints it for
    // a moment, so you can see what changed it
    createEffect(
      on(
        () => info.builtAt,
        (builtAt, before) => {
          if (before == null || builtAt === before) return;
          flash?.animate([{ opacity: 0.35 }, { opacity: 0 }], {
            duration: 700,
            easing: "ease-out",
          });
        },
        { defer: true },
      ),
    );

    return html`<div
      class="knitoutjs-panel"
      hidden=${() => !props.active}
      data-colour=${() => docColour(panel.url)}
      data-glow=${() => glow(panel.url)}
      data-shared=${() => (inManyPanes(panel.url) ? "" : undefined)}
      onPointerEnter=${() => setHovered(panel.url)}
      onPointerLeave=${unhover}
    >
      <${Slot} panel=${panel} />
      <div class="knitoutjs-flash" ref=${(el) => (flash = el)}></div>
    </div>`;
  }

  function Tab(props) {
    const { panel, group } = props;
    const info = docInfo(panel.url);
    const [renaming, setRenaming] = createSignal(false);

    async function rename(name) {
      setRenaming(false);
      name = name.trim();
      if (!name || name === info.name) return;
      (await repo.find(panel.url)).change((doc) => {
        doc.name = name;
        doc.extension = fileExtension({ name });
      });
    }

    function onKeyDown(event) {
      if (event.key === "Enter") rename(event.currentTarget.value);
      if (event.key === "Escape") setRenaming(false);
    }

    return html`<div
      class="knitoutjs-tab"
      role="tab"
      draggable="true"
      aria-selected=${() => String(props.active)}
      data-colour=${() => docColour(panel.url)}
      data-glow=${() => glow(panel.url)}
      data-shared=${() => (inManyPanes(panel.url) ? "" : undefined)}
      title=${() => `${info.name}\ndrag to move it, or onto a pane's edge to split it\ndouble click the name to rename`}
      onClick=${() => updateLayout((tree) => activate(tree, group.id, panel.id))}
      onDragStart=${(event) => {
        event.dataTransfer.setData(PANEL_TYPE, panel.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onPointerEnter=${() => setHovered(panel.url)}
          onPointerLeave=${unhover}
    >
      <span class="knitoutjs-swatch"></span>
      ${() =>
        renaming()
          ? html`<input
              class="knitoutjs-rename"
              value=${info.name}
              ref=${(el) => queueMicrotask(() => (el.focus(), el.select()))}
              onKeyDown=${onKeyDown}
              onBlur=${(event) => rename(event.currentTarget.value)}
              onClick=${(event) => event.stopPropagation()}
            />`
          : html`<span
              class="knitoutjs-tab-name"
              title="double click to rename"
              onDblClick=${() => setRenaming(true)}
            >
              ${() => info.name}
            </span>`}
      <button
        class="knitoutjs-tab-tool"
        aria-haspopup="menu"
        title="what it's shown with: change it here, or open it with something else in a new tab"
        onClick=${(event) => {
          event.stopPropagation();
          updateLayout((tree) => activate(tree, group.id, panel.id));
          openToolMenu(event, panel, group.id);
        }}
      >
        ${() => toolName(panel)}
        <span aria-hidden="true">▾</span>
      </button>
      <button
        class="knitoutjs-close"
        title="close"
        onClick=${(event) => {
          event.stopPropagation();
          updateLayout((tree) => removePanel(tree, panel.id));
        }}
      >
        ×
      </button>
    </div>`;
  }

  // the line under the tabs: which doc this is, where it came from, and
  // which tools can show it
  function Bar(props) {
    const panel = props.panel;
    const info = docInfo(panel.url);
    const [copied, setCopied] = createSignal(false);

    function copy() {
      navigator.clipboard?.writeText(panel.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }

    return html`<div class="knitoutjs-bar">
      <button
        class="knitoutjs-url"
        data-colour=${() => docColour(panel.url)}
        title=${() => `${panel.url} (click to copy)`}
        onClick=${copy}
        onPointerEnter=${() => setHovered(panel.url)}
        onPointerLeave=${unhover}
      >
        <span class="knitoutjs-swatch"></span>
        ${() => (copied() ? "copied" : shortUrl(panel.url))}
      </button>
      ${() =>
        info.copyOf &&
        html`<button
          class="knitoutjs-link"
          title="open the .k this is a copy of"
          onClick=${() => reveal(info.copyOf, panel.id, "left")}
          data-colour=${docColour(info.copyOf)}
          onPointerEnter=${() => setHovered(info.copyOf)}
          onPointerLeave=${unhover}
        >
          copy of
          <span class="knitoutjs-swatch"></span>
          <span class="knitoutjs-link-name">${() => docInfo(info.copyOf).name}</span>
        </button>`}
      ${() =>
        info.source &&
        html`<button
          class="knitoutjs-link"
          title="open the .js that wrote this"
          onClick=${() => reveal(info.source, panel.id, "left")}
          data-colour=${docColour(info.source)}
          data-stale=${() => (docInfo(info.source).target === panel.url ? undefined : "")}
          onPointerEnter=${() => setHovered(info.source)}
          onPointerLeave=${unhover}
        >
          ${() => (docInfo(info.source).target === panel.url ? "written by" : "last written by")}
          <span class="knitoutjs-swatch"></span>
          <span class="knitoutjs-link-name">${() => docInfo(info.source).name}</span>
        </button>`}
      <span class="knitoutjs-spacer"></span>
      <${BuildStatus} panel=${panel} />
    </div>`;
  }

  // a generated .k's line: built just now, out of date, or its .js failed.
  // only while its .js still writes into it
  function BuildStatus(props) {
    const panel = props.panel;
    const info = docInfo(panel.url);
    const source = () => (info.source ? docInfo(info.source) : null);
    const build = () => builds[info.source] ?? {};
    const outOfDate = () =>
      !!info.sourceHash && !!source()?.textHash && info.sourceHash !== source().textHash;

    function state() {
      if (source()?.target !== panel.url) return null;
      if (build().state === "running") return "running";
      if (build().state === "error") return "error";
      // with autobuild on, it's about to build anyway
      if (outOfDate()) return build().auto && build().builder ? "running" : "stale";
      return "built";
    }

    return html`<${Show} when=${state}>
      <span class="knitoutjs-build-status" data-state=${state}>
        ${() => {
          switch (state()) {
            case "running":
              return "building…";
            case "error":
              return html`<button
                class="knitoutjs-error-line"
                title=${() => `${build().message ?? ""}\nshow the .js, at that line`}
                onClick=${() => showError(info.source, panel.id)}
              >
                ${() => (build().line != null ? `⚠ error on line ${build().line}` : "⚠ error")}
              </button>`;
            case "stale":
              return html`out of date —
                <button
                  class="knitoutjs-rebuild"
                  title="build it again from its .js"
                  onClick=${() => rebuild(info.source, panel.url)}
                >
                  rebuild
                </button>`;
            default:
              return () => (info.builtAt ? `generated ${ago(info.builtAt, clock())}` : "generated");
          }
        }}
      </span>
    <//>`;
  }

  function Empty() {
    return html`<div class="knitoutjs-empty">
      <div class="knitoutjs-empty-card">
        <h2 class="knitoutjs-rough">nothing's open</h2>
        <p>drag a .js, a .k, or anything else in from the files, or</p>
        <div class="knitoutjs-empty-actions">
          <button class="knitoutjs-button" onClick=${() => newPattern()}>
            new pattern
          </button>
          <button class="knitoutjs-button" onClick=${(event) => openMenu(event, null)}>
            open…
          </button>
        </div>
        <${Show} when=${() => notice() && !notice().groupId}>
          <p class="knitoutjs-empty-notice">${() => notice()?.text}</p>
        <//>
      </div>
    </div>`;
  }

  function Menu() {
    const item = (label, detail, onClick) => html`<button
      class="knitoutjs-menu-item"
      onClick=${onClick}
    >
      ${label}
      <small>${detail}</small>
    </button>`;

    return html`<div
      class="knitoutjs-menu"
      popover="auto"
      ref=${(el) => (menu = el)}
      onToggle=${(event) => event.newState === "closed" && setMenuFor(null)}
    >
      <div class="knitoutjs-menu-heading">new</div>
      ${item(".js file", "", fromMenu((groupId) => newFile(groupId, "untitled.knitout.js")))}
      ${item(".k file", "", fromMenu((groupId) => newFile(groupId, "untitled.k")))}
      ${item("markdown", "", fromMenu((groupId) => newDoc(groupId, "markdown")))}
      <${Show} when=${altHeld}>
        ${item("terminal", "shared from your computer with latticex", fromMenu(newTerminal))}
      <//>
      <form class="knitoutjs-menu-url" onSubmit=${onOpenUrl}>
        <input
          name="url"
          placeholder="automerge:… url"
          autocomplete="off"
          onInput=${(event) => event.currentTarget.setCustomValidity("")}
        />
      </form>
      <p class="knitoutjs-menu-hint">or drag anything in from the files</p>
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
      updateLayout((tree) => setTool(tree, panel.id, tool.tool, tool.patchworkTool));
    }

    function openInNewTab(tool) {
      const { panel, groupId } = toolMenuFor();
      toolMenu.hidePopover();
      updateLayout((tree) =>
        openPanels(tree, groupId, "center", [newPanel(panel.url, tool.tool, tool.patchworkTool)]),
      );
    }

    return html`<div
      class="knitoutjs-menu knitoutjs-tool-menu"
      popover="auto"
      role="menu"
      ref=${(el) => (toolMenu = el)}
      onToggle=${(event) => event.newState === "closed" && setToolMenuFor(null)}
    >
      <div class="knitoutjs-menu-heading">show with</div>
      <${For} each=${tools}>
        ${(tool) => html`<div class="knitoutjs-tool-option">
          <button
            class="knitoutjs-menu-item"
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
            class="knitoutjs-open-new"
            title=${`open it with ${tool.name} in a new tab`}
            aria-label=${`open it with ${tool.name} in a new tab`}
            onClick=${() => openInNewTab(tool)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M9 2.5h4.5V7M13.5 2.5 7 9M11.5 9.5v3.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>`}
      <//>
    </div>`;
  }

  // a file from the list: brought forward if it's showing, else opened in
  // the pane last used
  function open(url) {
    const showing = findPanelShowing(layout.root, url);
    if (showing) {
      const { group, index } = showing;
      updateLayout((tree) => activate(tree, group.id, group.panels[index].id));
      setHovered(url);
      setTimeout(() => hovered() === url && setHovered(null), 900);
    } else {
      openDocs([url], null);
    }
  }

  // taking a file out of the project: its folder forgets it and its panes
  // close. the doc itself is still there for anything else that links to it
  function removeFile(url) {
    folder.change((doc) => {
      const docs = doc.docs ?? [];
      for (let i = docs.length - 1; i >= 0; i--) {
        if (String(docs[i]?.url) === url) docs.splice(i, 1);
      }
    });
    updateLayout((tree) => {
      for (let showing; (showing = findPanelShowing(tree, url)); ) {
        tree = removePanel(tree, showing.group.panels[showing.index].id);
      }
      return tree;
    });
  }

  // removing asks twice: the first press arms it for a few seconds
  const [removing, setRemoving] = createSignal(null);
  let removingTimer;
  function askToRemove(url) {
    clearTimeout(removingTimer);
    if (removing() === url) {
      setRemoving(null);
      removeFile(url);
      return;
    }
    setRemoving(url);
    removingTimer = setTimeout(() => setRemoving(null), 3000);
  }

  // the project's files as a family tree. a .k is under the .js that writes
  // it now. one that .js used to write, and an editable copy, are files of
  // their own (at the top), with a ghost of them where they came from: under
  // that .js, or the .k they copy. [{url, name, extension, depth, last,
  // parent, trail, ghost}]: `last` among its siblings, `parent` of the rows
  // under it, `trail`, for each of its ancestors below the top, whether that
  // one has more siblings below (so its line carries on past this row), and
  // `ghost`, "written" or "copied" for a ghost (it has no rows of its own)
  const fileTree = createMemo(() => {
    const list = projectFiles();
    const inProject = new Set(list.map((file) => file.url));
    const children = new Map();
    const addChild = (parent, file, ghost) => {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push({ file, ghost });
    };
    const roots = [];
    for (const file of list) {
      const info = docInfo(file.url);
      const writer = info.source !== file.url && inProject.has(info.source) ? info.source : null;
      const writtenNow = !!writer && docInfo(writer).target === file.url;
      if (writer) addChild(writer, file, writtenNow ? false : "written");
      if (info.copyOf !== file.url && inProject.has(info.copyOf)) addChild(info.copyOf, file, "copied");
      if (!writtenNow) roots.push(file);
    }
    // its own children first, then the ghosts
    for (const kids of children.values()) kids.sort((a, b) => !!a.ghost - !!b.ghost);

    const rows = [];
    const seen = new Set();
    const visit = (file, depth, trail = [], last = true, ghost = false) => {
      if (!ghost) {
        if (seen.has(file.url)) return;
        seen.add(file.url);
      }
      const kids = ghost
        ? []
        : (children.get(file.url) ?? []).filter((kid) => kid.ghost || !seen.has(kid.file.url));
      rows.push({ ...file, depth, trail, last, ghost, parent: kids.length > 0 });
      const kidsTrail = depth ? [...trail, !last] : [];
      kids.forEach((kid, i) =>
        visit(kid.file, depth + 1, kidsTrail, i === kids.length - 1, kid.ghost),
      );
    };
    for (const file of roots) visit(file, 0);
    // files whose parents lead round in a circle
    for (const file of list) visit(file, 0);
    return rows;
  });

  // "built 3 min ago", "edited just now"
  function lastTouched(url) {
    const info = docInfo(url);
    if (info.builtAt) return `built ${ago(info.builtAt, clock())}`;
    if (info.editedAt) return `edited ${ago(info.editedAt, clock())}`;
    return "";
  }

  // the dotted lines joining a row of the tree to its parent and children
  function guides(file) {
    const line = (kind, at) =>
      html`<span class=${`lattice-guide ${kind}`} style=${{ "--at": at }}></span>`;
    return [
      ...file.trail.map((carriesOn, at) => carriesOn && line("", at)),
      file.depth > 0 && line(file.last ? "lattice-guide-last" : "lattice-guide-tee", file.depth - 1),
      file.parent && line("lattice-guide-down", file.depth),
    ].filter(Boolean);
  }

  // the project's files, down the side of its workspace
  function Files() {
    return html`<nav
      class="lattice-files"
      aria-label="files"
      style=${() => ({ width: `${files.width()}px` })}
    >
      <${Resizer} sidebar=${files} />
      <div class="lattice-sidebar-content">
      <header class="lattice-files-heading">
        <span class="lattice-path" title=${() => projectName()}>${projectName}</span>
        <button
          class="lattice-icon-button"
          title="a new file, or open one (hold alt for more)"
          onClick=${(event) => openMenu(event, null)}
        >
          +
        </button>
      </header>
      <${For}
        each=${fileTree}
        fallback=${html`<p class="lattice-files-empty">no files yet</p>`}
      >
        ${(file) => html`<div
          class="lattice-file"
          data-colour=${docColour(file.url)}
          style=${{ "--depth": file.depth }}
          data-ghost=${file.ghost || undefined}
          data-showing=${() =>
            !file.ghost && findPanelShowing(layout.root, file.url) ? "" : undefined}
          data-removing=${() => (removing() === file.url ? "" : undefined)}
          draggable="true"
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
          ${guides(file)}
          <button
            class="lattice-file-open"
            title=${() =>
              file.ghost === "written"
                ? `${file.name} used to be written by this. click to open it`
                : file.ghost === "copied"
                  ? `${file.name} is a copy of this. click to open it`
                  : `${file.name}\nclick to open it, or drag it onto a pane`}
            onClick=${() => open(file.url)}
            onKeyDown=${(event) => {
              if (!file.ghost && (event.key === "Delete" || event.key === "Backspace")) {
                askToRemove(file.url);
              }
            }}
          >
            <span class="knitoutjs-swatch"></span>
            <span class="lattice-file-name">${() => file.name}</span>
          </button>
          ${!file.ghost &&
          html`<span class="lattice-file-when">${() => lastTouched(file.url)}</span>
          <button
            class="lattice-file-remove"
            aria-label=${() => `remove ${file.name} from ${projectName()}`}
            title=${() =>
              removing() === file.url
                ? "click again to remove it"
                : `remove it from ${projectName()} (the doc itself stays)`}
            onClick=${() => askToRemove(file.url)}
          >
            ${() => (removing() === file.url ? "remove?" : "×")}
          </button>`}
        </div>`}
      <//>
      </div>
    </nav>`;
  }

  onOpen?.(open);

  // what each pane is showing: its active panel's doc
  function showing(node, docs = []) {
    if (!node) return docs;
    if (node.type === "split") {
      for (const child of node.children) showing(child, docs);
    } else {
      const panel = node.panels.find((panel) => panel.id === node.active) ?? node.panels[0];
      if (panel && !docs.some((doc) => doc.url === panel.url)) {
        docs.push({ url: panel.url, name: docInfo(panel.url).name });
      }
    }
    return docs;
  }

  const dispose = render(() => {
    createEffect(() => onShowing?.(showing(layout.root)));
    return html`<link rel="stylesheet" href=${STYLESHEET} />
        <div class="knitoutjs-editor-tool lattice-project">
        <${Show} when=${files.open}><${Files} /><//>
        <div
          class="knitoutjs-editor-tool knitoutjs-frame"
          ref=${(el) => {
            root = el;
            listenForDrops(el);
          }}
          data-resizing=${resizing}
        >
          <svg class="knitoutjs-defs" aria-hidden="true">
            <filter id="knitoutjs-rough-1">
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="1" />
              <feDisplacementMap in="SourceGraphic" scale="1.4" />
            </filter>
            <filter id="knitoutjs-rough-2">
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="2" />
              <feDisplacementMap in="SourceGraphic" scale="1.4" />
            </filter>
            <filter id="knitoutjs-rough-3">
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="3" />
              <feDisplacementMap in="SourceGraphic" scale="1.4" />
            </filter>
          </svg>
          ${() => (layout.root ? html`<${Node} node=${layout.root} />` : html`<${Empty} />`)}
          <${Show} when=${outerZone}>
            <div class="knitoutjs-outer-hint" data-zone=${outerZone}></div>
          <//>
          <${Menu} />
          <${ToolMenu} />
        </div>
        </div>`;
  }, element);

  function cleanup() {
    workspace.off("change", readLayout);
    folder.off("change", readFolder);
    document.removeEventListener("dragover", onDocumentDragOver);
    document.removeEventListener("dragend", stopDragging);
    document.removeEventListener("drop", stopDragging);
    document.removeEventListener("keydown", onAltKey);
    document.removeEventListener("keyup", onAltKey);
    clearTimeout(noticeTimer);
    clearTimeout(removingTimer);
    clearInterval(ticker);
    offPatchworkTools();
    for (const [id, host] of hosts) destroyHost(id, host);
    for (const { off } of infos.values()) off?.();
    dispose();
  }

  return cleanup;
}
