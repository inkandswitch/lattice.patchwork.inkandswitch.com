import { createSignal, createMemo, createEffect, onCleanup, untrack, For, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { nestProviders, frameProviders, projectProviders } from "./providers.js";
import { shareUrl } from "./files.js";
import { latticeOptions } from "./project.js";
import { CommentsInspector } from "./comments.js";
import { Inspector } from "./inspector.js";
import {
  PROJECT_TYPES,
  OLD_KNITOUTJS_TYPES,
  projectTitle,
  typeOf,
} from "./knitoutjs/core/project.js";
import { createProject, mountProject, mountUpdate } from "./knitoutjs/core/project-view.js";
import {
  isOldKnitoutjs,
  isOldLatticeFolder,
  partsFrom,
  updateKnitoutjs,
  updateLatticeFolder,
  updatedTo,
} from "./knitoutjs/core/migrate.js";
import { createDoc, findSoon, urlFromText } from "./knitoutjs/core/patchwork-docs.js";
import { seedActive } from "./knitoutjs/core/active.js";
import { folderTitle } from "./knitoutjs/core/folder.js";
import { directoryTitle } from "./knitoutjs/core/directory.js";
import { Resizer, remember, remembered, sidebarState } from "./knitoutjs/core/sidebars.js";
import { icon } from "./knitoutjs/core/icons.js";

// latticework's, too, for its menus, before any project has brought it
const STYLESHEETS = ["./knitoutjs/core/latticework.css", "./shell.css"].map(
  (path) => new URL(path, import.meta.url).href,
);

// where this frame came from, when it isn't the site it's running in: a
// dev server's, given as ?lattice-frame= (see src/main.ts)
const FRAME_ORIGIN = new URL(import.meta.url).origin;
const DEV_FRAME = FRAME_ORIGIN === location.origin ? null : FRAME_ORIGIN;

// a dev frame has no vite client in this page to reload it when it changes,
// so it asks the dev server, which answers when it has (see vite/frame.ts)
async function reloadOnChange() {
  const changes = new URL("__changes", import.meta.url);
  let seen = null;
  let wait = 2000;
  for (;;) {
    try {
      if (seen != null) changes.searchParams.set("since", seen);
      const { version } = await (await fetch(changes, { cache: "no-store" })).json();
      if (seen != null && version !== seen) return location.reload();
      seen = version;
      wait = 2000;
    } catch {
      // the dev server's away (a stopped tunnel answers with cloudflare's own
      // error page, which the browser reports as a cors error): ask less and
      // less often. if it comes back with a new version, the page reloads
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait = Math.min(wait * 2, 60_000);
    }
  }
}
if (DEV_FRAME) reloadOnChange();

// a sidebar toggle's icon: a window with a column filled, `at` from its left
function sidebarIcon(at) {
  return html`<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" />
    <rect x=${at} y="3.5" width="3" height="9" rx="0.5" fill="currentColor" opacity="0.55" />
  </svg>`;
}

// the types of the root folder's entries that are projects: knitoutjs's and
// lattice's, and knitoutjs's from before (which show a button to update them).
// lattice's from before are folders, and have to be looked in
const ENTRY_TYPES = [...PROJECT_TYPES, ...OLD_KNITOUTJS_TYPES];

const isOld = (entry) => entry.type === "folder" || OLD_KNITOUTJS_TYPES.includes(entry.type);

/**
 * lattice: the account's frame. a top bar; down the left, projects (the
 * projects in the account's root folder) and /system; in the middle the open
 * project, its files beside its panes; down the right, inspectors for what's
 * in the project (its drafts, and comments)
 */
export default function LatticeFrameTool(handle, element) {
  const repo = element.repo;
  // there's no draft overlay above a frame, but updates go to the doc itself
  // all the same
  const baseRepo = repo.baseRepo ?? repo;
  const hive = element.hive;
  const accountUrl = handle.url;

  const links = STYLESHEETS.map((href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    return link;
  });
  element.append(...links);

  // ── projects: the ones in the account's root folder ───────────────────

  const [home, setHome] = createSignal(null);
  const [homeDoc, setHomeDoc] = createSignal(null);
  let homeHandle = null;
  const readHome = () => setHomeDoc(homeHandle.doc() ?? null);

  async function openHome() {
    const rootFolderUrl = String(handle.doc()?.rootFolderUrl ?? "");
    if (!isValidAutomergeUrl(rootFolderUrl)) return;
    homeHandle = await repo.find(rootFolderUrl);
    readHome();
    homeHandle.on("change", readHome);
    setHome(homeHandle);
    await moveOldWorkspace();
  }
  openHome();

  // what the root folder links to: {url, name, type}
  const entries = createMemo(() =>
    (Array.isArray(homeDoc()?.docs) ? homeDoc().docs : [])
      .map((entry) => ({
        url: String(entry?.url ?? ""),
        name: String(entry?.name ?? "untitled"),
        type: String(entry?.type ?? ""),
      }))
      .filter((entry) => isValidAutomergeUrl(entry.url)),
  );

  // which of the root folder's folders are lattice projects from before: a
  // folder's url → true or false, once it's been looked in
  const [looked, setLooked] = createSignal({});
  createEffect(() => {
    for (const entry of entries()) {
      if (entry.type !== "folder" || entry.url in untrack(looked)) continue;
      setLooked((all) => ({ ...all, [entry.url]: null }));
      findSoon(repo, entry.url).then((doc) =>
        setLooked((all) => ({ ...all, [entry.url]: isOldLatticeFolder(doc) })),
      );
    }
  });

  const projects = createMemo(() =>
    entries().filter(
      (entry) => ENTRY_TYPES.includes(entry.type) || (entry.type === "folder" && looked()[entry.url]),
    ),
  );

  // an entry in the root folder, changed: where it points, and what it is
  function changeEntry(url, change) {
    homeHandle.change((doc) => {
      for (const entry of doc.docs ?? []) {
        if (String(entry?.url) !== url) continue;
        if (change.url && String(entry.url) !== change.url) entry.url = change.url;
        if (change.type && String(entry.type) !== change.type) entry.type = change.type;
        if (change.name && String(entry.name) !== change.name) entry.name = change.name;
      }
    });
  }

  function addEntry(entry) {
    homeHandle.change((doc) => {
      doc.docs ??= [];
      doc.docs.push(entry);
    });
  }

  async function newProject() {
    const project = await createProject(repo, { type: "lattice:project", hive });
    addEntry({ name: "untitled", type: "lattice:project", url: project.url });
    choose(project.url);
    setRenaming(project.url);
  }

  // before projects, the frame kept its files and layout on the account
  // doc. they become a project of their own, once
  async function moveOldWorkspace() {
    const account = handle.doc();
    if (!account?.layout && !account?.files?.length) return;
    const title = "knitting";
    const { files, nodes, active } = await partsFrom(
      { title, urls: Array.isArray(account.files) ? account.files : [], tree: account.layout },
      baseRepo,
      hive,
    );
    const project = await createDoc(
      baseRepo,
      { "@patchwork": { type: "lattice:project" }, title, files, nodes },
      hive,
    );
    seedActive(project.url, active);
    addEntry({ name: title, type: "lattice:project", url: project.url });
    handle.change((doc) => {
      delete doc.layout;
      delete doc.files;
    });
  }

  const projectKey = `lattice:${accountUrl}:project`;
  const [chosen, setChosen] = createSignal(remembered(projectKey, null));
  // the chosen project, while it's still in the root folder; else the first
  const current = createMemo(() => {
    const all = projects();
    const found = all.find((project) => project.url === chosen());
    if (found) return found;
    // (a folder that's still being looked in might be it)
    const looking = entries().some(
      (entry) => entry.url === chosen() && entry.type === "folder" && looked()[entry.url] == null,
    );
    return looking ? null : (all[0] ?? null);
  });
  const currentUrl = createMemo(() => current()?.url ?? null);
  // the project shown changes when it does, or when it's updated
  const currentKey = createMemo(() => (current() ? `${current().url} ${current().type}` : null));

  function choose(url) {
    setChosen(url);
    remember(projectKey, url);
  }

  const [renaming, setRenaming] = createSignal(null);

  // a project from anywhere, by its url (or a patchwork link to one): it goes
  // in the root folder under its own title. a folder or a directory becomes a
  // new project, with it as its files. says what was wrong, or nothing
  async function addFromUrl(text) {
    const url = urlFromText(text);
    if (!url) return "that isn't an automerge url";
    if (projects().some((project) => project.url === url)) {
      choose(url);
      return null;
    }
    const doc = await findSoon(repo, url);
    if (!doc) return "couldn't find that doc";
    const type = typeOf(doc);
    if (ENTRY_TYPES.includes(type)) {
      addEntry({ name: projectTitle(doc), type, url });
      choose(url);
      return null;
    }
    if (type === "folder" && isOldLatticeFolder(doc)) {
      const updated = await updatedTo(doc, repo);
      if (updated) return addFromUrl(updated);
      addEntry({ name: folderTitle(doc), type: "folder", url });
      choose(url);
      return null;
    }
    if (type === "folder" || type === "directory") {
      const title = type === "folder" ? folderTitle(doc) : directoryTitle(doc);
      const project = await createProject(repo, { type: "lattice:project", title, files: url, hive });
      addEntry({ name: title, type: "lattice:project", url: project.url });
      choose(project.url);
      return null;
    }
    return "that's not a project, folder or directory";
  }

  // the name shows in the root folder (the link) and on the project itself
  async function renameProject(url, name) {
    setRenaming(null);
    name = name.trim().replace(/^\/+/, "");
    if (!name) return;
    changeEntry(url, { name });
    (await repo.find(url)).change((doc) => {
      doc.title = name;
    });
  }

  // ── sidebars ───────────────────────────────────────────────────────────

  // the projects and the project's files are resizable; the inspector isn't
  // (yet). each opens and closes on its own
  const folders = sidebarState("folders", 200);
  const files = sidebarState("files", 200);
  const inspector = sidebarState("inspector", 300);

  // ── the open project ───────────────────────────────────────────────────

  let main;

  // a project from before: a button to update it, and nothing else. one
  // that's been updated already (somewhere else) is pointed at instead
  function mountOld(entry) {
    let dead = false;
    let unmount = null;
    const box = document.createElement("div");
    box.className = "lattice-panes";
    main.append(box);

    (async () => {
      const doc = await findSoon(repo, entry.url);
      if (dead) return;
      if (entry.type === "folder") {
        const updated = doc && (await updatedTo(doc, repo));
        if (dead) return;
        if (updated) return moved(entry, updated, "lattice:project");
      } else if (doc && !isOldKnitoutjs(doc) && PROJECT_TYPES.includes(typeOf(doc))) {
        return changeEntry(entry.url, { type: typeOf(doc) });
      }
      unmount = mountUpdate(box, async () => {
        if (entry.type === "folder") {
          const folder = await baseRepo.find(entry.url);
          const url = await updateLatticeFolder(folder, baseRepo, { title: entry.name, hive });
          moved(entry, url, "lattice:project");
        } else {
          const project = await baseRepo.find(entry.url);
          await updateKnitoutjs(project, baseRepo, hive);
          changeEntry(entry.url, { type: typeOf(project.doc()) });
        }
      });
    })();

    return () => {
      dead = true;
      unmount?.();
      box.remove();
    };
  }

  // the root folder's entry for an old project points at what it became
  function moved(entry, url, type) {
    changeEntry(entry.url, { url, type });
    if (chosen() === entry.url) choose(url);
  }

  // a project: its own providers, with the project doc as the draft host,
  // around its files, panes and inspector, so its drafts are drafts of all
  // of it
  function mountCurrent(entry) {
    if (isOld(entry)) return mountOld(entry);
    let dead = false;
    let providers = null;
    let unmount = null;

    (async () => {
      providers = nestProviders(main, projectProviders(entry.url));
      const inner = await providers.ready;
      if (!inner || dead) return;
      // the innermost provider's repo resolves through the draft overlay, so
      // the project reads and writes whichever draft is checked out
      const projectRepo = inner.repo ?? repo;
      const project = await projectRepo.find(entry.url);
      if (dead) return;

      const area = document.createElement("div");
      area.className = "lattice-panes";
      const inspectorElement = document.createElement("aside");
      inspectorElement.className = "lattice-inspector";
      inner.append(area, inspectorElement);

      // what the panes are showing, for the inspectors
      const [showing, setShowing] = createSignal([]);
      let openInProject = null;
      const unmountProject = mountProject(area, {
        project,
        repo: projectRepo,
        baseRepo,
        hive,
        sidebar: files,
        onShowing: setShowing,
        onOpen: (open) => (openInProject = open),
        ...latticeOptions(baseRepo),
      });
      const unmountInspector = render(
        () => html`<${Inspector}
          sections=${[
            { id: "drafts", name: "drafts", render: () => html`<${Drafts} />` },
            {
              id: "comments",
              name: "comments",
              render: () => html`<${CommentsInspector}
                element=${inspectorElement}
                showing=${showing}
                open=${(url) => openInProject?.(url)}
              />`,
            },
          ]}
        />`,
        inspectorElement,
      );
      unmount = () => {
        unmountInspector();
        unmountProject();
      };
    })();

    return () => {
      dead = true;
      unmount?.();
      providers?.remove();
    };
  }

  // the drafts package's own panel. made in the page (solid puts it there in
  // the same task), so it's under the project's providers as it mounts
  function Drafts() {
    const drafts = document.createElement("patchwork-view");
    drafts.className = "lattice-inspector-panel";
    drafts.setAttribute("component", "drafts");
    return drafts;
  }

  // ── the pieces ─────────────────────────────────────────────────────────

  function Toggle(props) {
    const { sidebar, name, at } = props;
    return html`<button
      class="lattice-toggle"
      aria-pressed=${() => String(sidebar.open())}
      title=${() => `${sidebar.open() ? "hide" : "show"} the ${name}`}
      onClick=${() => sidebar.setOpen(!sidebar.open())}
    >
      ${sidebarIcon(at)}
    </button>`;
  }

  function TopBar() {
    return html`<header class="lattice-topbar">
      <${Toggle} sidebar=${folders} name="projects" at=${2.5} />
      <${Toggle} sidebar=${files} name="files" at=${5.5} />
      <span class="lattice-breadcrumb">
        projects${() => (current() ? ` › ${current().name}` : "")}
      </span>
      <span class="lattice-spacer"></span>
      ${DEV_FRAME &&
      html`<button
        class="lattice-dev-frame"
        title=${`this frame is ${DEV_FRAME}'s, not this site's (?lattice-frame=). click to go back to the site's own`}
        onClick=${() => {
          const url = new URL(location.href);
          url.searchParams.delete("lattice-frame");
          location.href = url.href;
        }}
      >
        dev frame · ${new URL(DEV_FRAME).host}
      </button>`}
      <${Toggle} sidebar=${inspector} name="inspector" at=${10.5} />
    </header>`;
  }

  function ProjectItem(props) {
    const project = props.project;
    return () =>
      renaming() === project.url
        ? html`<input
            class="lattice-tree-rename"
            value=${project.name}
            aria-label="project name"
            ref=${(el) => queueMicrotask(() => (el.focus(), el.select()))}
            onKeyDown=${(event) => {
              if (event.key === "Enter") renameProject(project.url, event.currentTarget.value);
              if (event.key === "Escape") setRenaming(null);
            }}
            onBlur=${(event) => renameProject(project.url, event.currentTarget.value)}
          />`
        : html`<button
            class="lattice-tree-item"
            aria-current=${() => (currentUrl() === project.url ? "page" : undefined)}
            data-old=${isOld(project) ? "" : undefined}
            title=${isOld(project)
              ? "made with an older version: open it to update it"
              : "double click to rename · right click for its links"}
            onClick=${() => choose(project.url)}
            onDblClick=${() => setRenaming(project.url)}
            onContextMenu=${(event) => openProjectMenu(event, project)}
          >
            <span class="lattice-tree-name">${project.name}</span>
            ${isOld(project) && html`<small class="lattice-tree-old">old</small>`}
          </button>`;
  }

  // system's folders are here, but they don't do anything yet
  function SystemItem(props) {
    return html`<span class="lattice-tree-item lattice-system" aria-disabled="true" title="nothing here yet">
      ${props.name}
    </span>`;
  }

  // the projects' +: a new project, or one from anywhere by its url
  let homeMenu;
  const [adding, setAdding] = createSignal(false);
  const [addProblem, setAddProblem] = createSignal(null);

  function openHomeMenu(event) {
    setAddProblem(null);
    const rect = event.currentTarget.getBoundingClientRect();
    homeMenu.style.top = `${rect.bottom + 4}px`;
    homeMenu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 280))}px`;
    homeMenu.showPopover();
  }

  async function onAddFromUrl(event) {
    event.preventDefault();
    const input = event.currentTarget.elements.url;
    setAdding(true);
    const problem = await addFromUrl(input.value);
    setAdding(false);
    setAddProblem(problem);
    if (problem) return input.focus();
    input.value = "";
    homeMenu.hidePopover();
  }

  // right click on a project
  let projectMenu;
  const [menuProject, setMenuProject] = createSignal(null);

  function openProjectMenu(event, project) {
    event.preventDefault();
    setMenuProject(project);
    projectMenu.style.top = `${Math.min(event.clientY, innerHeight - 100)}px`;
    projectMenu.style.left = `${Math.min(event.clientX, innerWidth - 220)}px`;
    projectMenu.showPopover();
  }

  function copyFromMenu(text) {
    navigator.clipboard?.writeText(text);
    projectMenu.hidePopover();
  }

  function ProjectMenu() {
    return html`<div
      class="knitoutjs-menu lattice-context-menu"
      popover="auto"
      ref=${(el) => (projectMenu = el)}
    >
      <button
        class="knitoutjs-menu-item"
        onClick=${() => copyFromMenu(shareUrl(menuProject().url))}
      >
        ${icon("link")}
        copy share url
        <small>a link to it on this site</small>
      </button>
      <button class="knitoutjs-menu-item" onClick=${() => copyFromMenu(menuProject().url)}>
        ${icon("copy")}
        copy automerge url
        <small>${() => menuProject()?.url.slice(0, 20)}…</small>
      </button>
    </div>`;
  }

  function HomeMenu() {
    return html`<div class="knitoutjs-menu" popover="auto" ref=${(el) => (homeMenu = el)}>
      <button
        class="knitoutjs-menu-item"
        onClick=${() => {
          homeMenu.hidePopover();
          newProject();
        }}
      >
        ${icon("folder")}
        new project
        <small>an empty one</small>
      </button>
      <div class="knitoutjs-menu-heading">from anywhere</div>
      <form class="knitoutjs-menu-url" onSubmit=${onAddFromUrl}>
        <input
          name="url"
          placeholder="automerge:… url"
          aria-label="a project's, folder's or directory's automerge url"
          autocomplete="off"
          disabled=${adding}
          onInput=${() => setAddProblem(null)}
        />
      </form>
      <p class="knitoutjs-menu-hint" data-problem=${() => (addProblem() ? "" : undefined)}>
        ${() => addProblem() ?? (adding() ? "finding it…" : "a project, folder or directory")}
      </p>
    </div>`;
  }

  function Sidebar() {
    return html`<nav
      class="lattice-sidebar"
      aria-label="projects"
      style=${() => ({ width: `${folders.width()}px` })}
    >
      <${Resizer} sidebar=${folders} />
      <${HomeMenu} />
      <${ProjectMenu} />
      <div class="lattice-sidebar-content">
      <div class="lattice-tree-heading">
        <span>projects</span>
        <button
          class="lattice-icon-button"
          title="a new project, or one by its url"
          aria-label="a new project, or one by its url"
          onClick=${openHomeMenu}
        >
          ${icon("plus", 14)}
        </button>
      </div>
      <div class="lattice-tree-children">
        <${For}
          each=${projects}
          fallback=${html`<p class="lattice-tree-empty">no projects yet</p>`}
        >
          ${(project) => html`<${ProjectItem} project=${project} />`}
        <//>
      </div>
      <div class="lattice-tree-heading lattice-system">system</div>
      <div class="lattice-tree-children">
        <${SystemItem} name="packages" />
        <${SystemItem} name="settings" />
      </div>
      </div>
    </nav>`;
  }

  function NoProject() {
    return html`<div class="lattice-no-project">
      <p>${() => (home() && !chosenLooking() ? "no projects yet" : "finding projects…")}</p>
      <${Show} when=${() => home() && !chosenLooking()}>
        <button class="lattice-button" onClick=${() => newProject()}>
          ${icon("plus")} new project
        </button>
      <//>
    </div>`;
  }

  // the chosen project is a folder that's still being looked in
  const chosenLooking = createMemo(() =>
    entries().some(
      (entry) => entry.url === chosen() && entry.type === "folder" && looked()[entry.url] == null,
    ),
  );

  // the frame is the account doc's tool, so its providers are the account's
  const providers = nestProviders(element, frameProviders(accountUrl));
  let dispose = null;
  providers.ready.then((inner) => {
    if (inner) dispose = render(Shell, inner);
  });

  function Shell() {
    return html`<div
        class="knitoutjs-editor-tool lattice-shell"
        data-inspector=${() => (inspector.open() ? "open" : "closed")}
      >
        <${TopBar} />
        <div class="lattice-body">
          <${Show} when=${folders.open}><${Sidebar} /><//>
          <${Show} when=${currentKey} fallback=${html`<${NoProject} />`}>
            <div
              class="lattice-main"
              ref=${(el) => {
                main = el;
                createEffect(() => {
                  if (!currentKey()) return;
                  const entry = untrack(current);
                  onCleanup(mountCurrent(entry));
                });
              }}
            ></div>
          <//>
        </div>
      </div>`;
  }

  return () => {
    homeHandle?.off("change", readHome);
    dispose?.();
    providers.remove();
    for (const link of links) link.remove();
  };
}
