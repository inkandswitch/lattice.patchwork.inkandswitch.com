import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { nestProviders, frameProviders, projectProviders } from "./providers.js";
import { folderLink } from "./files.js";
import { mountWorkspace } from "./workspace.js";
import { Resizer, remember, remembered, sidebarState } from "./sidebars.js";

const STYLESHEET = new URL("./shell.css", import.meta.url).href;

// where this frame came from, when it isn't the site it's running in: a
// dev server's, given as ?lattice-frame= (see src/main.ts)
const FRAME_ORIGIN = new URL(import.meta.url).origin;
const DEV_FRAME = FRAME_ORIGIN === location.origin ? null : FRAME_ORIGIN;

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

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET;
  element.append(link);

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

  // before projects, the frame kept its files and layout on the account
  // doc. they become a project of their own, once
  async function moveOldWorkspace() {
    const account = handle.doc();
    if (!account?.layout && !account?.files?.length) return;
    const urls = (account.files ?? []).map(String);
    const links = await Promise.all(
      urls.map(async (url) => folderLink(url, (await repo.find(url)).doc())),
    );
    const project = await repo.create2({
      "@patchwork": { type: "folder" },
      title: "knitting",
      docs: links,
      workspace: await newWorkspace(
        account.layout ? JSON.parse(JSON.stringify(account.layout)) : null,
      ),
    });
    homeHandle.change((doc) => {
      doc.docs ??= [];
      doc.docs.push({ name: "knitting", type: "folder", url: project.url });
    });
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

  async function newProject() {
    const project = await repo.create2({
      "@patchwork": { type: "folder" },
      title: "untitled",
      docs: [],
      workspace: await newWorkspace(),
    });
    homeHandle.change((doc) => {
      doc.docs ??= [];
      doc.docs.push({ name: "untitled", type: "folder", url: project.url });
    });
    choose(project.url);
    setRenaming(project.url);
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
      inspector.innerHTML = `<header class="lattice-inspector-heading">drafts</header>`;
      inner.append(area, inspector);
      // made in the page, so it's under the project's providers as it mounts
      const drafts = document.createElement("patchwork-view");
      drafts.className = "lattice-inspector-panel";
      drafts.setAttribute("component", "drafts");
      inspector.append(drafts);

      unmount = mountWorkspace({ workspace, folder }, area, {
        repo: projectRepo,
        baseRepo: repo,
        files,
      });
    });

    return () => {
      dead = true;
      unmount?.();
      providers?.remove();
    };
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
        home${() => (current() ? ` › ${current().name}` : "")}
      </span>
      <span class="lattice-spacer"></span>
      ${DEV_FRAME &&
      html`<button
        class="lattice-dev-frame"
        title=${`this frame is ${DEV_FRAME}'s, not this site's (?lattice-frame=). click to go back to the site's own`}
        onClick=${() => {
          const url = new URL(location.href);
          url.searchParams.set("lattice-frame", "");
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
            title="double click to rename"
            onClick=${() => choose(project.url)}
            onDblClick=${() => setRenaming(project.url)}
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

  function Sidebar() {
    return html`<nav
      class="lattice-sidebar"
      aria-label="folders"
      style=${() => ({ width: `${folders.width()}px` })}
    >
      <${Resizer} sidebar=${folders} />
      <div class="lattice-sidebar-content">
      <div class="lattice-tree-heading">
        <span>home</span>
        <button class="lattice-icon-button" title="new project" onClick=${() => newProject()}>
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
      <p>${() => (home() ? "nothing in home yet" : "finding home…")}</p>
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
    link.remove();
  };
}
