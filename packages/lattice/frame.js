import { createSignal, createMemo, createEffect, on, onCleanup, untrack, For, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { nestProviders, frameProviders, projectProviders } from "./providers.js";
import { shareUrl } from "./files.js";
import { PROJECT_TYPES, latticeOptions } from "./project.js";
import { CommentsInspector } from "./comments.js";
import { Inspector } from "./inspector.js";
import { projectTitle, typeOf } from "../wm/doc/project.js";
import { createProject, mountProject, mountUpdate, partsFrom } from "../wm/project-view.js";
import { isOldLatticeFolder, updateLatticeFolder, updatedTo } from "./migrate.js";
import { OLD_KNITOUTJS_TYPES, isOldKnitoutjs, updateKnitoutjs } from "../knitoutjs/app/migrate.js";
import { createDoc, findSoon, urlFromText } from "../wm/patchwork/docs.js";
import { seedActive } from "../wm/active.js";
import { downloadArchive, isArchive, unpackArchive } from "./archive.js";
import { folderTitle } from "../wm/folder.js";
import { directoryTitle } from "../wm/directory.js";
import { Resizer, remember, remembered, sidebarState } from "../wm/ui/sidebars.js";
import { icon } from "../wm/ui/icons.js";
import { tooltips } from "../wm/ui/tooltip.js";
import { roughFilters } from "../knitoutjs/look.js";
import { useThemes } from "./themes.js";
import { SettingsPage } from "./settings-page.js";
import { RepoContext, makeDocumentProjection, useDocument } from "./vendor/solid-automerge.js";
import { colourFor, pointerCursor } from "./pointer.js";
import { useToolStorage } from "./storage.js";

// wm's, too, for its menus, before any project has brought it; knitout.js's
// look, which lattice wears; and the fonts lattice brings
const STYLESHEETS = ["./fonts/fonts.css", "../wm/wm.css", "../knitoutjs/look.css", "./shell.css"].map(
  (path) => new URL(path, import.meta.url).href,
);

// where this frame came from, when it isn't the site it's running in: a
// dev server's, given as ?dev= (see src/main.ts)
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

  const links = STYLESHEETS.map((href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    return link;
  });
  // nothing's drawn till they're in (or have failed), so it's never seen
  // unstyled
  const styled = Promise.all(
    links.map((link) => new Promise((resolve) => (link.onload = link.onerror = resolve))),
  );
  element.append(...links);
  roughFilters();
  tooltips(".lattice-shell");

  // the frame is the account doc's tool, so its providers are the account's
  const providers = nestProviders(element, frameProviders(handle.url));
  let dispose = null;
  let dead = false;
  Promise.all([providers.ready, styled]).then(([inner]) => {
    if (!inner || dead) return;
    dispose = render(
      () => html`<${RepoContext.Provider} value=${repo}>
        <${Frame} handle=${handle} element=${inner} repo=${repo} baseRepo=${baseRepo} hive=${hive} />
      <//>`,
      inner,
    );
  });

  return () => {
    dead = true;
    dispose?.();
    providers.remove();
    for (const link of links) link.remove();
  };
}

/**
 * the frame itself, in the account's providers (`element`): everything it
 * keeps is solid's, and goes when it does
 */
function Frame(props) {
  const { handle, element, repo, baseRepo, hive } = props;
  const accountUrl = handle.url;

  // the account, live
  const account = makeDocumentProjection(handle);

  // ── projects: the ones in the account's root folder ───────────────────

  const rootFolderUrl = () => (isValidAutomergeUrl(String(account.rootFolderUrl ?? "")) ? String(account.rootFolderUrl) : undefined);
  const [homeDoc, home] = useDocument(rootFolderUrl);
  const homeHandle = () => home() ?? null;

  // once it's here: the workspace from before projects, and a share link
  createEffect(
    on(home, (found) => {
      if (!found) return;
      untrack(async () => {
        await moveOldWorkspace();
        openShared();
      });
    }),
  );

  // a share link (files.js's shareUrl): #folder=<a project's files>&name=…
  // you get your own project on them, called what theirs is, and the link's
  // taken out of the address
  async function openShared() {
    const params = new URLSearchParams(location.hash.slice(1));
    const shared = params.get("folder");
    if (!shared || !homeHandle()) return;
    const name = params.get("name") ?? "";
    params.delete("folder");
    params.delete("name");
    const rest = params.toString();
    history.replaceState(history.state, "", `${location.pathname}${location.search}${rest ? `#${rest}` : ""}`);
    say("finding it…");
    say(await addFromUrl(shared, { name }), true);
  }
  addEventListener("hashchange", openShared);
  onCleanup(() => removeEventListener("hashchange", openShared));

  // what the root folder links to: {url, name, type}. each the same object
  // while it's the same, so the list keeps its places
  const known = new Map();
  const entries = createMemo(() =>
    (Array.isArray(homeDoc()?.docs) ? homeDoc().docs : [])
      .map((raw) => {
        const url = String(raw?.url ?? "");
        const name = String(raw?.name ?? "untitled");
        const type = String(raw?.type ?? "");
        const key = `${url} ${type} ${name}`;
        if (!known.has(key)) known.set(key, { url, name, type });
        return known.get(key);
      })
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
    homeHandle()?.change((doc) => {
      for (const entry of doc.docs ?? []) {
        if (String(entry?.url) !== url) continue;
        if (change.url && String(entry.url) !== change.url) entry.url = change.url;
        if (change.type && String(entry.type) !== change.type) entry.type = change.type;
        if (change.name && String(entry.name) !== change.name) entry.name = change.name;
      }
    });
  }

  function addEntry(entry) {
    homeHandle()?.change((doc) => {
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
    setPage(null);
  }

  // what's in the middle instead of the project, when it isn't: "settings"
  const [page, setPage] = createSignal(null);

  // the page's title: the file you're in, and its project (as patchwork's
  // own router has it, "<what> | <site>"). when patchwork's router puts its
  // own there, ours goes back
  const [focusedFile, setFocusedFile] = createSignal(null);
  const titleBefore = document.title;
  const siteTitle = titleBefore.split(" | ").pop() || "Patchwork";
  const title = createMemo(() => {
    const what =
      page() === "settings"
        ? "settings"
        : [focusedFile()?.name, current()?.name].filter(Boolean).join(" · ");
    return what ? `${what} | ${siteTitle}` : titleBefore;
  });
  const putTitle = () => {
    if (document.title !== title()) document.title = title();
  };
  createEffect(putTitle);
  const titleWatcher = new MutationObserver(putTitle);
  titleWatcher.observe(document.head, { subtree: true, childList: true, characterData: true });
  onCleanup(() => {
    titleWatcher.disconnect();
    document.title = titleBefore;
  });

  // your contact (your picture and name, down the bottom of the projects)
  const contactUrl = () => {
    const url = String(account.contactUrl ?? "");
    return isValidAutomergeUrl(url) ? url : undefined;
  };
  const [me] = useDocument(contactUrl);
  const myName = () => String(me()?.name ?? "").trim();
  // your mouse, in the frame: your pointer, in your colour
  // (an arrow, or a mouse: lattice's own, in the account's tool storage, so
  // it's yours wherever you open lattice, from as soon as it's loaded)
  const [mine, myStorage] = useToolStorage(element, "lattice", { repo: baseRepo });
  const pointer = {
    kind: () => (mine()?.pointer === "mouse" ? "mouse" : "arrow"),
    set(kind) {
      const handle = myStorage();
      if (handle && handle.doc()?.pointer !== kind) {
        handle.change((doc) => {
          doc.pointer = kind;
        });
      }
    },
  };
  const myColour = () => String(me()?.color ?? "") || (contactUrl() ? colourFor(contactUrl()) : null);
  const myPointer = createMemo(() => pointerCursor(myColour(), pointer.kind()));

  // the headings down the side, folded or not
  const [projectsOpen, setProjectsOpen] = createSignal(remembered("lattice:projects-list:open", true));
  const [packagesOpen, setPackagesOpen] = createSignal(remembered("lattice:packages-list:open", true));
  // (it takes the event: a prop that's a function of nothing is a getter, to
  // solid's html)
  const fold = (open, setOpen, key) => (_event) => {
    setOpen(!open());
    remember(key, open());
  };

  const [renaming, setRenaming] = createSignal(null);

  // your project on a folder (or directory), if you've one already
  async function projectOn(filesUrl) {
    const found = await Promise.all(
      projects()
        .filter((entry) => PROJECT_TYPES.includes(entry.type))
        .map(async (entry) => ({ entry, doc: await findSoon(repo, entry.url, 3000) })),
    );
    return found.find(({ doc }) => String(doc?.files ?? "") === filesUrl)?.entry.url ?? null;
  }

  // a project from anywhere, by its url (or a patchwork link to one): it goes
  // in the root folder under its own title. a folder or a directory is a
  // project's files: you get your own project on it (the one you have, if
  // you've one). says what was wrong, or nothing
  // `name`, for a project made on someone's files: what they call it
  async function addFromUrl(text, { name = "" } = {}) {
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
    // an old lattice project still to be updated (one that's been updated is
    // a folder like any other, linking back to its project)
    if (type === "folder" && isOldLatticeFolder(doc) && !isValidAutomergeUrl(String(doc.project ?? ""))) {
      const updated = await updatedTo(doc, repo);
      if (updated) return addFromUrl(updated);
      addEntry({ name: folderTitle(doc), type: "folder", url });
      choose(url);
      return null;
    }
    if (type === "folder" || type === "directory") {
      const mine = await projectOn(url);
      if (mine) {
        choose(mine);
        return null;
      }
      const title = name.trim() || (type === "folder" ? folderTitle(doc) : directoryTitle(doc));
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

  // the projects, the project's files and the inspector are each resizable,
  // and each opens and closes on its own
  const folders = sidebarState("lattice:folders", 200);
  const files = sidebarState("lattice:files", 200);
  const inspector = sidebarState("lattice:inspector", 300, { open: false });

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
      }, { auto: true });
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
        onFocused: (file) => setFocusedFile(file ? { ...file } : null),
        onOpen: (open) => (openInProject = open),
        // an arrow or a mouse, over the panes, for everyone else
        pointer: pointer.kind,
        ...latticeOptions(baseRepo, hive),
      });
      const unmountInspector = render(() => {
        createEffect(() => (inspectorElement.style.width = `${inspector.width()}px`));
        return html`<${Resizer} sidebar=${inspector} side="left" /><${Inspector}
          sections=${[
            { id: "versions", was: "drafts", name: "versions", render: () => html`<${Versions} />` },
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
        />`;
      }, inspectorElement);
      unmount = () => {
        unmountInspector();
        unmountProject();
        setFocusedFile(null);
      };
    })();

    return () => {
      dead = true;
      unmount?.();
      providers?.remove();
    };
  }

  // the versions package's own panel (packages/versions). made in the page
  // (solid puts it there in the same task), so it's under the project's
  // providers as it mounts
  function Versions() {
    const versions = document.createElement("patchwork-view");
    versions.className = "lattice-inspector-panel";
    versions.setAttribute("component", "versions");
    return versions;
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
        ${() => (page() === "settings" ? "settings" : `projects${current() ? ` › ${current().name}` : ""}`)}
      </span>
      <span class="lattice-spacer"></span>
      ${DEV_FRAME &&
      html`<button
        class="lattice-dev-frame"
        title=${`these packages are ${DEV_FRAME}'s, not this site's (?dev=). click to go back to the site's own`}
        onClick=${() => {
          const url = new URL(location.href);
          url.searchParams.delete("dev");
          location.href = url.href;
        }}
      >
        dev · ${new URL(DEV_FRAME).host}
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
            aria-current=${() => (!page() && currentUrl() === project.url ? "page" : undefined)}
            data-old=${isOld(project) ? "" : undefined}
            title=${isOld(project)
              ? "made with an older version: open it to update it"
              : "double click to rename · right click for menu"}
            onClick=${() => choose(project.url)}
            onDblClick=${() => setRenaming(project.url)}
            onContextMenu=${(event) => openProjectMenu(event, project)}
          >
            <span class="lattice-tree-name">${project.name}</span>
            ${isOld(project) && html`<small class="lattice-tree-old">old</small>`}
          </button>`;
  }

  // a heading down the side that folds what's under it. `open` is whether
  // it's open (a getter: pass the signal)
  function Fold(props) {
    return html`<button class="lattice-fold" aria-expanded=${() => String(props.open)} onClick=${(event) => props.toggle(event)}>
      <span class="lattice-fold-chevron" aria-hidden="true">${icon("chevron-right", 10)}</span>
      ${props.name}
    </button>`;
  }

  // you, down the bottom: your picture and your name, and your settings
  function Me() {
    return html`<footer class="lattice-sidebar-foot">
      <button
        class="lattice-me"
        aria-pressed=${() => String(page() === "settings")}
        aria-label=${() => (myName() ? undefined : "settings")}
        title="settings · you, and the theme"
        onClick=${() => setPage(page() === "settings" ? null : "settings")}
      >
        <${Show} when=${contactUrl} fallback=${html`<span class="lattice-me-nobody"></span>`}>
          <patchwork-view doc-url=${contactUrl} tool-id="contact-avatar"></patchwork-view>
        <//>
        <${Show} when=${myName}><span class="lattice-me-name">${myName}</span><//>
      </button>
    </footer>`;
  }

  // the projects' +: a new project, or one from anywhere by its url, or from
  // a .patchworkfolder. `adding` says what it's doing, while it is
  let homeMenu;
  let archiveInput;
  const [adding, setAdding] = createSignal(null);
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
    setAdding("finding it…");
    const problem = await addFromUrl(input.value);
    setAdding(null);
    setAddProblem(problem);
    if (problem) return input.focus();
    input.value = "";
    homeMenu.hidePopover();
  }

  // under the projects: how a .patchworkfolder dropped or pasted there is
  // going, or what went wrong with it
  const [note, setNote] = createSignal(null);
  let noteTimer = null;
  function say(text, problem = false) {
    clearTimeout(noteTimer);
    setNote(text ? { text, problem } : null);
    if (text && problem) noteTimer = setTimeout(() => setNote(null), 8000);
  }

  // .patchworkfolders: each unpacked into new docs, and what it's of added as
  // if by its url. says what went wrong, or nothing
  async function addArchives(files) {
    const archives = [...(files ?? [])].filter(isArchive);
    if (!archives.length) return "that's not a .patchworkfolder";
    for (const file of archives) {
      let root;
      try {
        root = await unpackArchive(baseRepo, file, hive);
      } catch (error) {
        console.error("[lattice] couldn't unpack", file.name, error);
        return `couldn't unpack ${file.name}: ${String(error?.message ?? error)}`;
      }
      const problem = await addFromUrl(root);
      if (problem) return problem;
    }
    return null;
  }

  // chosen, dropped or pasted: how it's going shows in the + menu, if that's
  // open, else under the projects
  async function takeArchives(files) {
    const inMenu = homeMenu?.matches(":popover-open");
    if (inMenu) {
      setAddProblem(null);
      setAdding("unpacking it…");
    } else say("unpacking…");
    const problem = await addArchives(files);
    if (!inMenu) return say(problem, true);
    setAdding(null);
    setAddProblem(problem);
    if (!problem) homeMenu.hidePopover();
  }

  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
  const [dropping, setDropping] = createSignal(false);

  // right click on a project. what's shared is its files (its folder): whoever
  // opens it gets a project of their own on them. one from before is shared
  // as it is
  let projectMenu;
  const [menuProject, setMenuProject] = createSignal(null);
  const [menuFiles, setMenuFiles] = createSignal(null);
  const [packing, setPacking] = createSignal(null);

  function openProjectMenu(event, project) {
    event.preventDefault();
    setMenuProject(project);
    setPacking(null);
    setMenuFiles(isOld(project) ? project.url : null);
    if (!isOld(project)) {
      findSoon(repo, project.url).then((doc) => {
        const files = String(doc?.files ?? "");
        if (menuProject() === project && isValidAutomergeUrl(files)) setMenuFiles(files);
      });
    }
    projectMenu.style.top = `${Math.min(event.clientY, innerHeight - 140)}px`;
    projectMenu.style.left = `${Math.min(event.clientX, innerWidth - 320)}px`;
    projectMenu.showPopover();
  }

  function copyFromMenu(text) {
    navigator.clipboard?.writeText(text);
    projectMenu.hidePopover();
  }

  async function downloadFromMenu() {
    setPacking("packing it…");
    try {
      await downloadArchive(baseRepo, menuProject().url, hive);
      setPacking(null);
      projectMenu.hidePopover();
    } catch (error) {
      console.error("[lattice] couldn't pack it", error);
      setPacking(`couldn't: ${String(error?.message ?? error)}`);
    }
  }

  function ProjectMenu() {
    return html`<div
      class="lattice-wm-menu lattice-context-menu"
      popover="auto"
      ref=${(el) => (projectMenu = el)}
    >
      <button
        class="lattice-wm-menu-item"
        disabled=${() => !menuFiles()}
        onClick=${() => copyFromMenu(shareUrl(menuFiles(), menuProject()?.name))}
      >
        ${icon("link")}
        copy link
        <small>a link here · they get their own</small>
      </button>
      <button
        class="lattice-wm-menu-item"
        disabled=${() => packing() === "packing it…"}
        onClick=${downloadFromMenu}
      >
        ${icon("download")}
        download
        <small>${() => packing() ?? ".patchworkfolder, files and all"}</small>
      </button>
    </div>`;
  }

  function HomeMenu() {
    return html`<div class="lattice-wm-menu" popover="auto" ref=${(el) => (homeMenu = el)}>
      <button
        class="lattice-wm-menu-item"
        onClick=${() => {
          homeMenu.hidePopover();
          newProject();
        }}
      >
        ${icon("folder")}
        new project
        <small>an empty one</small>
      </button>
      <div class="lattice-wm-menu-heading">from anywhere</div>
      <button class="lattice-wm-menu-item" disabled=${() => !!adding()} onClick=${() => archiveInput.click()}>
        ${icon("file")}
        .patchworkfolder
        <small>from a file</small>
      </button>
      <input
        type="file"
        accept=".patchworkfolder,.zip"
        multiple
        hidden
        ref=${(el) => (archiveInput = el)}
        onChange=${(event) => {
          const files = [...event.currentTarget.files];
          event.currentTarget.value = "";
          if (files.length) takeArchives(files);
        }}
      />
      <form class="lattice-wm-menu-url" onSubmit=${onAddFromUrl}>
        <input
          name="url"
          placeholder="automerge:… url"
          aria-label="a project's, folder's or directory's automerge url, or a .patchworkfolder pasted"
          autocomplete="off"
          disabled=${() => !!adding()}
          onInput=${() => setAddProblem(null)}
        />
      </form>
      <p class="lattice-wm-menu-hint" data-problem=${() => (addProblem() ? "" : undefined)}>
        ${() => addProblem() ?? adding() ?? "a project, folder or directory · or drop or paste a .patchworkfolder"}
      </p>
    </div>`;
  }

  function Sidebar() {
    return html`<nav
      class="lattice-sidebar"
      aria-label="projects"
      style=${() => ({ width: `${folders.width()}px` })}
      data-dropping=${() => (dropping() ? "" : undefined)}
      onDragOver=${(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave=${(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDropping(false);
      }}
      onDrop=${(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDropping(false);
        takeArchives(event.dataTransfer.files);
      }}
      onPaste=${(event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.some(isArchive)) return;
        event.preventDefault();
        takeArchives(files);
      }}
    >
      <${Resizer} sidebar=${folders} />
      <${HomeMenu} />
      <${ProjectMenu} />
      <div class="lattice-sidebar-content">
      <div class="lattice-tree-heading">
        <${Fold}
          name="projects"
          open=${projectsOpen}
          toggle=${fold(projectsOpen, setProjectsOpen, "lattice:projects-list:open")}
        />
        <button
          class="lattice-icon-button"
          title="a new project, or one by its url"
          aria-label="a new project, or one by its url"
          onClick=${openHomeMenu}
        >
          ${icon("plus", 14)}
        </button>
      </div>
      <div class="lattice-tree-children" hidden=${() => !projectsOpen()}>
        <${For}
          each=${projects}
          fallback=${html`<p class="lattice-tree-empty">no projects yet</p>`}
        >
          ${(project) => html`<${ProjectItem} project=${project} />`}
        <//>
        <${Show} when=${note}>
          <p class="lattice-tree-note" data-problem=${() => (note()?.problem ? "" : undefined)}>
            ${() => note()?.text}
          </p>
        <//>
      </div>
      <div class="lattice-tree-heading lattice-packages">
        <${Fold}
          name="packages"
          open=${packagesOpen}
          toggle=${fold(packagesOpen, setPackagesOpen, "lattice:packages-list:open")}
        />
      </div>
      <div class="lattice-tree-children" hidden=${() => !packagesOpen()}></div>
      </div>
      <${Me} />
    </nav>`;
  }

  // the theme, on the page (themes.js), and the settings, in the middle,
  // while they're open
  const themes = useThemes(element, { repo: baseRepo, hive });
  function Settings() {
    return html`<div class="lattice-main lattice-settings-main">
      <${SettingsPage}
        account=${handle}
        accountDoc=${account}
        repo=${baseRepo}
        hive=${hive}
        themes=${themes}
        pointer=${pointer}
      />
    </div>`;
  }

  function NoProject() {
    return html`<div class="lattice-no-project" hidden=${() => page() === "settings"}>
      <p>${() => (homeHandle() && !chosenLooking() ? "no projects yet" : "finding projects…")}</p>
      <${Show} when=${() => homeHandle() && !chosenLooking()}>
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

  onCleanup(() => clearTimeout(noteTimer));

  function Shell() {
    return html`<div
        class="lattice-shell"
        data-inspector=${() => (inspector.open() ? "open" : "closed")}
        style=${() => ({ "--lattice-pointer": myPointer() ?? undefined })}
      >
        <${TopBar} />
        <div class="lattice-body">
          <${Show} when=${folders.open}><${Sidebar} /><//>
          <${Show} when=${() => page() === "settings"}><${Settings} /><//>
          <${Show} when=${currentKey} fallback=${html`<${NoProject} />`}>
            <div
              class="lattice-main"
              hidden=${() => page() === "settings"}
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

  return Shell();
}
