// a way into this tab from the dev server it's from, for `pnpm page` on the
// computer that's running it (scripts/page.mjs, vite/page-bridge.js): it
// asks the dev server what to run, runs it, and says what came of it.
// only with the dev server's token, which a link gives it once, in its
// fragment (#page=…, which never reaches a server): without that, it never
// asks. so a ?dev= link sent to someone else lets nothing in
//
// what's run is given `lattice`, the helpers below: projects, files, and
// looking at the page. the frame hands over what they need when it mounts
// (providePage); whichever frame's newest is the one they use
import { updateText } from "@automerge/automerge";
import { lasting } from "../wm/lasting.js";
import { createProject, filesOf } from "../wm/project-view.js";
import { createDoc, describeDoc } from "../wm/patchwork/docs.js";
import { newFileDoc } from "../wm/doc/files.js";
import { compile, describeElement, toJSONSafe } from "./page-run.js";

const LOGS_KEPT = 200;

// kept page-wide: a swapped-in version of this module (dev-swap.js) uses the
// same, and its helpers are the ones used from then on
const state = lasting("lattice:page", () => ({
  started: false,
  frame: null,
  helpers: null,
  logs: [],
}));

const tokenKey = (origin) => `lattice-page:${origin}`;

/** the frame's repo, hive, home folder, projects and `choose`, till it goes */
export function providePage(frame) {
  state.frame = frame;
  return () => {
    if (state.frame === frame) state.frame = null;
  };
}

function frame() {
  if (!state.frame) throw new Error("the frame isn't here yet (or there's no account)");
  return state.frame;
}

async function find(url) {
  const handle = await frame().repo.find(url);
  if (!handle) throw new Error(`couldn't find ${url}`);
  return handle;
}

async function projectFiles(projectUrl) {
  const project = await find(projectUrl);
  const files = project.doc()?.files;
  if (!files) throw new Error(`${projectUrl} has no files: is it a project?`);
  return filesOf(await find(files), frame().repo);
}

function element(selector) {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

// what matters for why something's where it is, or isn't
const LAYOUT_STYLES = [
  "display", "position", "inset", "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "padding", "border-width", "box-sizing", "overflow", "flex", "flex-direction", "flex-wrap",
  "align-items", "justify-content", "gap", "grid-template-columns", "grid-template-rows", "grid-area",
  "z-index", "visibility", "opacity", "transform", "color", "background-color", "font-family", "font-size",
  "line-height", "pointer-events",
];

function tree(node, depth, text) {
  const described = describeElement(node, { text });
  const children = [...node.children, ...(node.shadowRoot ? node.shadowRoot.children : [])];
  if (children.length) {
    described.children =
      depth > 0 ? children.map((child) => tree(child, depth - 1, text)) : `${children.length} more`;
  }
  if (node.shadowRoot) described.shadow = true;
  return described;
}

const helpers = {
  get repo() {
    return frame().repo;
  },
  get hive() {
    return frame().hive;
  },
  get home() {
    return frame().home();
  },

  /** the account's projects: name, type and url */
  projects() {
    return frame()
      .projects()
      .map(({ name, type, url }) => ({ name, type, url }));
  },

  /** show the project at `url` */
  open(url) {
    frame().choose(url);
    return url;
  },

  /** a new lattice project called `title`, in the sidebar, shown unless `open` is false. its url */
  async newProject(title = "untitled", { open = true } = {}) {
    const { repo, hive, home, choose } = frame();
    const folder = home();
    if (!folder) throw new Error("there's no home folder yet");
    const project = await createProject(repo, { type: "lattice:project", title, hive });
    folder.change((doc) => {
      doc.docs ??= [];
      doc.docs.push({ name: title, type: "lattice:project", url: project.url });
    });
    if (open) choose(project.url);
    return project.url;
  },

  /** the project's files: name, type and url */
  async files(projectUrl) {
    const files = await projectFiles(projectUrl);
    return Promise.all(
      files.urls().map(async (url) => ({ url, ...(await describeDoc(url, frame().repo)) })),
    );
  },

  /** a new file in the project, named `name` (or name-2, …, if that's taken). its url */
  async addFile(projectUrl, name, content = "") {
    const { repo, hive } = frame();
    const files = await projectFiles(projectUrl);
    const taken = new Set(
      (await Promise.all(files.urls().map((url) => describeDoc(url, repo)))).map((doc) => doc.name),
    );
    const [, stem, ext] = name.match(/^(.*?)(\..*)?$/);
    let unique = name;
    for (let n = 2; taken.has(unique); n++) unique = `${stem}-${n}${ext ?? ""}`;
    const file = await createDoc(repo, newFileDoc(unique, content), hive);
    await files.add([file.url]);
    return file.url;
  },

  /** a file's content, if it's text; else the whole doc */
  async read(url) {
    const doc = (await find(url)).doc();
    return typeof doc?.content === "string" ? doc.content : doc;
  },

  /** a file's content made `content`, as edits to what's there, so it merges */
  async write(url, content) {
    const handle = await find(url);
    handle.change((doc) => {
      if (typeof doc.content === "string" && typeof content === "string") updateText(doc, ["content"], content);
      else doc.content = content;
    });
    return url;
  },

  /** the elements at `selector`, `depth` down, briefly */
  dom(selector = "body", { depth = 3, text = 80 } = {}) {
    return tree(element(selector), depth, text);
  },

  /** the first element at `selector`: where it is, how many match, and its layout styles */
  inspect(selector) {
    const found = element(selector);
    const style = getComputedStyle(found);
    return {
      ...describeElement(found),
      matches: document.querySelectorAll(selector).length,
      style: Object.fromEntries(LAYOUT_STYLES.map((name) => [name, style.getPropertyValue(name)])),
    };
  },

  /** the console's errors and warnings, and what wasn't caught, latest last */
  logs() {
    return state.logs;
  },
};

function keepLogs() {
  const keep = (level, parts) => {
    const text = parts
      .map((part) => (typeof part === "string" ? part : JSON.stringify(toJSONSafe(part, { depth: 3, chars: 2000 }))))
      .join(" ");
    state.logs.push({ level, at: new Date().toISOString(), text });
    if (state.logs.length > LOGS_KEPT) state.logs.splice(0, state.logs.length - LOGS_KEPT);
  };
  for (const level of ["error", "warn"]) {
    const original = console[level];
    console[level] = (...parts) => {
      try {
        keep(level, parts);
      } catch {}
      return original.apply(console, parts);
    };
  }
  addEventListener("error", (event) => keep("uncaught", [event.error ?? event.message]));
  addEventListener("unhandledrejection", (event) => keep("unhandled", [event.reason]));
}

// the token for `origin`: from the address, if it's there (and it's taken
// out), or what this browser was given before
function takeToken(origin) {
  const params = new URLSearchParams(location.hash.slice(1));
  const given = params.get("page");
  if (given) {
    params.delete("page");
    const rest = params.toString();
    history.replaceState(history.state, "", `${location.pathname}${location.search}${rest ? `#${rest}` : ""}`);
    try {
      localStorage.setItem(tokenKey(origin), given);
    } catch {}
    return given;
  }
  try {
    return localStorage.getItem(tokenKey(origin));
  } catch {
    return null;
  }
}

/** ask the dev server at `origin` what to run, from now on (once a page) */
export function pageBridge(origin) {
  // a newer version's helpers are the ones used
  state.helpers = helpers;
  if (state.started) return;
  state.started = true;
  keepLogs();
  const tab = crypto.randomUUID().slice(0, 8);
  let token = takeToken(origin);
  let asking = false;

  const post = (route, body) =>
    fetch(new URL(`/__lattice-page/${route}`, origin), {
      method: "POST",
      // a "simple" request, with no preflight: the token's in the body
      // (vite/page-bridge.js says why)
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ ...body, token }),
      cache: "no-store",
    });

  async function run(command) {
    let answer;
    try {
      const value = await compile(command.code)(state.helpers);
      answer = { ok: true, value: toJSONSafe(value) };
    } catch (error) {
      answer = { ok: false, error: String(error?.message ?? error), stack: error?.stack };
    }
    try {
      await post("result", { tab, id: command.id, ...answer });
    } catch (error) {
      console.warn("lattice: couldn't say what came of a command from the dev server", error);
    }
  }

  async function ask() {
    if (asking || !token) return;
    asking = true;
    let wait = 2000;
    while (token) {
      let answer;
      try {
        answer = await post("next", { tab, url: location.href, title: document.title, focused: document.hasFocus() });
      } catch {
        // the dev server's away: ask less and less often, as dev-swap does
        await new Promise((resolve) => setTimeout(resolve, wait));
        wait = Math.min(wait * 2, 60_000);
        continue;
      }
      wait = 2000;
      if (answer.status === 404) {
        // not this server's token (a new one, or it's gone): wait to be given one
        console.warn("lattice: the dev server doesn't know this tab's token; `pnpm page link` makes a link that does");
        try {
          localStorage.removeItem(tokenKey(origin));
        } catch {}
        token = null;
        break;
      }
      const command = answer.ok ? (await answer.json().catch(() => null))?.command : null;
      if (!answer.ok) await new Promise((resolve) => setTimeout(resolve, 2000));
      if (command) run(command);
    }
    asking = false;
  }

  // a link with the token, pasted into this tab: only the fragment's new, so
  // there's no reload
  addEventListener("hashchange", () => {
    const given = takeToken(origin);
    if (given && given !== token) {
      token = given;
      ask();
    }
  });
  ask();
}
