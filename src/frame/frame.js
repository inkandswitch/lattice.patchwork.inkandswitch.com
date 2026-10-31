import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { nestProviders, frameProviders, projectProviders } from "./providers.js";
import { folderLink, folderTitle, shareUrl, urlFromText } from "./files.js";
import { mountWorkspace } from "./workspace.js";
import { CommentsInspector } from "./comments.js";
import { Inspector } from "./inspector.js";
import { Resizer, remember, remembered, sidebarState } from "./sidebars.js";

// frame.css too, for its menus, before any workspace has brought it
const STYLESHEETS = ["./frame.css", "./shell.css"].map(
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

/**
 * lattice: the account's frame. a top bar; down the left, /home (the
 * account's root folder, whose folders are projects) and /system; in the
 * middle the open project, its files beside its workspace; down the right,
 * inspectors for what's in the workspace (so far, its drafts)
 */
export default function LatticeFrameTool(handle, element) {
  const repo = element.repo;
  const accountUrl = handle.url;

  const links = STYLESHEETS.map((href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    return link;
  });
  element.append(...links);

  // ── /home: the account's root folder, and the projects in it ────────────

  const [home, setHome] = createSignal(null);
  const [homeDoc, setHomeDoc] = createSignal(null);
  let homeHandle = null;
  const readHome = () => setHomeDoc(homeHandle.doc() ?? null);

  async function openHome() {
    const rootFolderUrl = handle.doc()?.rootFolderUrl;
    if (!rootFolderUrl) return;
    homeHandle = await repo.find(rootFolderUrl);
    readHome();
    homeHandle.on("change", readHome);
    setHome(homeHandle);
    await moveOldWorkspace();
  }
  openHome();

  // a project is a folder in /home
  const projects = createMemo(() => {
    const doc = homeDoc();
    return (Array.isArray(doc?.docs) ? doc.docs : [])
      .filter((entry) => String(entry?.type) === "folder")
      .map((entry) => ({ url: String(entry.url), name: String(entry.name ?? "untitled") }))
      .filter((project) => isValidAutomergeUrl(project.url));
  });

  // a project's workspace (its layout) is a doc of its own, linked from its
  // folder as `workspace`. it's what drafts are of: drafts don't do folders,
  // and the overlay forks the folder and the files into a draft anyway, as
  // they're resolved beneath it
  async function newWorkspace(layout = null) {
    return (await repo.create2({ "@patchwork": { type: "lattice:workspace" }, layout })).url;
  }

  async function workspaceFor(projectUrl) {
    const folder = await repo.find(projectUrl);
    const linked = folder.doc()?.workspace;
    if (linked && isValidAutomergeUrl(String(linked))) return String(linked);
    // a project from before workspaces kept its layout on the folder
    const old = folder.doc()?.layout;
    const url = await newWorkspace(old ? JSON.parse(JSON.stringify(old)) : null);
    folder.change((doc) => {
      doc.workspace = url;
      delete doc.layout;
    });
    return url;
  }

  // a project in /home: a folder linking to some files (the same docs, not
  // copies), and a workspace with a copy of a layout of them
  async function addProject(name, urls = [], layout = null) {
    const links = await Promise.all(
      urls.map(async (url) => folderLink(url, (await repo.find(url)).doc())),
    );
    const project = await repo.create2({
      "@patchwork": { type: "folder" },
      title: name,
      docs: links,
      workspace: await newWorkspace(layout ? JSON.parse(JSON.stringify(layout)) : null),
    });
    homeHandle.change((doc) => {
      doc.docs ??= [];
      doc.docs.push({ name, type: "folder", url: project.url });
    });
    return project.url;
  }

  // the files and layout of something from before projects: the account doc
  // (as the frame kept them there), or a knitoutjs-panes doc
  function oldFiles(doc) {
    return (Array.isArray(doc?.files) ? doc.files : [])
      .map(String)
      .filter((url) => isValidAutomergeUrl(url));
  }

  // before projects, the frame kept its files and layout on the account
  // doc. they become a project of their own, once
  async function moveOldWorkspace() {
    const account = handle.doc();
    if (!account?.layout && !account?.files?.length) return;
    await addProject("knitting", oldFiles(account), account.layout);
    handle.change((doc) => {
      delete doc.layout;
      delete doc.files;
    });
  }

  const projectKey = `lattice:${accountUrl}:project`;
  const [chosen, setChosen] = createSignal(remembered(projectKey, null));
  // the chosen project, while it's still in /home; else the first one
  const current = createMemo(() => {
    const all = projects();
    return all.find((project) => project.url === chosen()) ?? all[0] ?? null;
  });
  const currentUrl = createMemo(() => current()?.url ?? null);

  function choose(url) {
    setChosen(url);
    remember(projectKey, url);
  }

  const [renaming, setRenaming] = createSignal(null);

  // a knitoutjs-panes doc found by its url, which could be a project (see
  // importPanes)
  const [panes, setPanes] = createSignal(null);

  // a folder from anywhere (someone else's project, say), by its url: it goes
  // in home under its own title. says what was wrong, or nothing
  async function addFolder(text) {
    setPanes(null);
    const url = urlFromText(text);
    if (!url) return "that isn't an automerge url";
    if (projects().some((project) => project.url === url)) {
      choose(url);
      return null;
    }
    let doc;
    try {
      const found = repo.find(url);
      const later = new Promise((_, reject) => setTimeout(reject, 15000));
      doc = (await Promise.race([found, later])).doc();
    } catch {
      return "couldn't find that doc";
    }
    const type = String(doc?.["@patchwork"]?.type ?? "");
    if (type === "knitoutjs-panes") setPanes(doc);
    if (type !== "folder") return `that's ${type ? `a ${type}` : "not a folder"}`;
    homeHandle.change((home) => {
      home.docs ??= [];
      home.docs.push({ name: folderTitle(doc), type: "folder", url });
    });
    choose(url);
    return null;
  }

  // a knitoutjs-panes doc is a project from before lattice: its files and
  // layout become a project of their own (the panes doc stays as it was)
  async function importPanes(doc) {
    choose(await addProject(folderTitle(doc), oldFiles(doc), doc.layout));
  }

  async function newProject() {
    const url = await addProject("untitled");
    choose(url);
    setRenaming(url);
  }

  // the name shows in /home (the link) and on the folder itself (its title)
  async function renameProject(url, name) {
    setRenaming(null);
    name = name.trim().replace(/^\/+/, "");
    if (!name) return;
    homeHandle.change((doc) => {
      const entry = doc.docs?.find((entry) => String(entry.url) === url);
      if (entry) entry.name = name;
    });
    (await repo.find(url)).change((doc) => {
      doc.title = name;
    });
  }

  // ── sidebars ───────────────────────────────────────────────────────────

  // the folders and the project's files are resizable; the inspector isn't
  // (yet). each opens and closes on its own
  const folders = sidebarState("folders", 200);
  const files = sidebarState("files", 200);
  const inspector = sidebarState("inspector", 300);

  // ── the open project: its own providers, with its workspace doc as the
  //    draft host, around its files, workspace and inspector, so its drafts
  //    are drafts of all of it ─────────────────────────────────────────────

  let main;

  function mountProject(url) {
    main.replaceChildren();
    let dead = false;
    let providers = null;
    let unmount = null;

    workspaceFor(url).then(async (workspaceUrl) => {
      if (dead) return;
      providers = nestProviders(main, projectProviders(workspaceUrl));
      const inner = await providers.ready;
      if (!inner) return;
      // the innermost provider's repo resolves through the draft overlay, so
      // the workspace reads and writes whichever draft is checked out
      const projectRepo = inner.repo ?? repo;
      const [workspace, folder] = await Promise.all([
        projectRepo.find(workspaceUrl),
        projectRepo.find(url),
      ]);
      if (dead) return;

      const area = document.createElement("div");
      area.className = "lattice-workspace";
      const inspector = document.createElement("aside");
      inspector.className = "lattice-inspector";
      inner.append(area, inspector);

      // what the workspace is showing, for the inspectors
      const [showing, setShowing] = createSignal([]);
      let openInWorkspace = null;
      const unmountWorkspace = mountWorkspace({ workspace, folder }, area, {
        repo: projectRepo,
        baseRepo: repo,
        hive: element.hive,
        files,
        onShowing: setShowing,
        onOpen: (open) => (openInWorkspace = open),
      });
      const unmountInspector = render(
        () => html`<${Inspector}
          sections=${[
            { id: "drafts", name: "drafts", render: () => html`<${Drafts} />` },
            {
              id: "comments",
              name: "comments",
              render: () => html`<${CommentsInspector}
                element=${inspector}
                showing=${showing}
                open=${(url) => openInWorkspace?.(url)}
              />`,
            },
          ]}
        />`,
        inspector,
      );
      unmount = () => {
        unmountInspector();
        unmountWorkspace();
      };
    });

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
      <${Toggle} sidebar=${folders} name="folders" at=${2.5} />
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
            title="double click to rename · right click for its links"
            onClick=${() => choose(project.url)}
            onDblClick=${() => setRenaming(project.url)}
            onContextMenu=${(event) => openProjectMenu(event, project)}
          >
            ${project.name}
          </button>`;
  }

  // system's folders are here, but they don't do anything yet
  function SystemItem(props) {
    return html`<span class="lattice-tree-item lattice-system" aria-disabled="true" title="nothing here yet">
      ${props.name}
    </span>`;
  }

  // home's +: a new project, or a folder from anywhere by its url
  let homeMenu;
  const [adding, setAdding] = createSignal(false);
  const [addProblem, setAddProblem] = createSignal(null);

  function openHomeMenu(event) {
    setAddProblem(null);
    setPanes(null);
    const rect = event.currentTarget.getBoundingClientRect();
    homeMenu.style.top = `${rect.bottom + 4}px`;
    homeMenu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 280))}px`;
    homeMenu.showPopover();
  }

  async function onAddFolder(event) {
    event.preventDefault();
    const input = event.currentTarget.elements.url;
    setAdding(true);
    const problem = await addFolder(input.value);
    setAdding(false);
    setAddProblem(problem);
    if (problem) return input.focus();
    input.value = "";
    homeMenu.hidePopover();
  }

  async function onImportPanes() {
    setAdding(true);
    await importPanes(panes());
    setAdding(false);
    setPanes(null);
    setAddProblem(null);
    homeMenu.querySelector("input[name=url]").value = "";
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
        copy share url
        <small>a link to it on this site</small>
      </button>
      <button class="knitoutjs-menu-item" onClick=${() => copyFromMenu(menuProject().url)}>
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
        new project
        <small>an empty folder in projects</small>
      </button>
      <div class="knitoutjs-menu-heading">a folder from anywhere</div>
      <form class="knitoutjs-menu-url" onSubmit=${onAddFolder}>
        <input
          name="url"
          placeholder="automerge:… url"
          aria-label="a folder's automerge url"
          autocomplete="off"
          disabled=${adding}
          onInput=${() => (setAddProblem(null), setPanes(null))}
        />
      </form>
      <p
        class="knitoutjs-menu-hint"
        data-problem=${() => (addProblem() && !panes() ? "" : undefined)}
      >
        ${() => addProblem() ?? (adding() ? "finding it…" : "or a patchwork link to one")}
        <${Show} when=${panes}>
          ${" "}
          <button
            class="lattice-menu-action"
            disabled=${adding}
            title="a new project with its files and layout"
            onClick=${onImportPanes}
          >
            import
          </button>
        <//>
      </p>
    </div>`;
  }

  function Sidebar() {
    return html`<nav
      class="lattice-sidebar"
      aria-label="folders"
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
          title="a new project, or a folder by its url"
          onClick=${openHomeMenu}
        >
          +
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
      <p>${() => (home() ? "no projects yet" : "finding projects…")}</p>
      <${Show} when=${home}>
        <button class="lattice-button" onClick=${() => newProject()}>new project</button>
      <//>
    </div>`;
  }

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
          <${Show} when=${currentUrl} fallback=${html`<${NoProject} />`}>
            <div
              class="lattice-main"
              ref=${(el) => {
                main = el;
                createEffect(() => {
                  const url = currentUrl();
                  if (url) onCleanup(mountProject(url));
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
