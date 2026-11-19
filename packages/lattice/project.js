// lattice's project tool: wm's workspace on a project, with lattice's tools.
// the frame shows the same in its middle
import { createRoot } from "solid-js";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { mountProject } from "../wm/project-view.js";
import { datatypeItem } from "../wm/patchwork/docs.js";
import { knitout } from "../knitoutjs/wm.js";
import { wearLook } from "../knitoutjs/look.js";
import { isOldKnitoutjs, updateKnitoutjs, OLD_KNITOUTJS_TYPES } from "../knitoutjs/app/migrate.js";
import { tools } from "./files.js";
import { newMachine, newSwatch, newYarn } from "./profile-docs.js";
import { useToolStorage } from "./storage.js";

// lattice's and knitoutjs's: the same shape, each with its own type
export const PROJECT_TYPES = ["lattice:project", "knitoutjs-project"];

// the tools that show a whole project: never offered in a pane of one
export const PROJECT_TOOLS = ["knitoutjs-project", "lattice:project", "lattice", ...OLD_KNITOUTJS_TYPES];

const PROFILES = [
  { icon: "build", label: "machine", detail: "a knitting machine: its gauge, beds and stitch table", make: newMachine },
  { icon: "link", label: "yarn", detail: "a yarn: what it is, its count, and its swatches", make: newYarn },
  { icon: "fit", label: "swatch", detail: "a swatch: how it was knit, and what it measures", make: newSwatch },
];

// a patternstoat (the wristwarmer, to start from), the charm it's knitted
// with and the .k it writes, side by side, built once so there's something
// to see: as knitoutjs's newPattern makes a .js and its .k
async function newPatternstoat(api) {
  const [{ newCharm }, stoats, { buildInto }, { setBuild }] = await Promise.all([
    import("../patternstoat/charm.js"),
    import("../patternstoat/patternstoat.js"),
    import("../patternstoat/build-into.js"),
    import("../knitoutjs/core/builds.js"),
  ]);
  const charm = await api.repo.create2({ ...newCharm(), title: "wristwarmer" });
  const k = await api.createFile("wristwarmer.k");
  const doc = stoats.newPatternstoat({ charm: charm.url });
  stoats.paintWristwarmer(doc);
  const stoat = await api.repo.create2({ ...doc, title: "wristwarmer", knitoutTarget: k });
  api.openRow([
    [
      { url: stoat.url, tool: "patternstoat" },
      { url: charm.url, tool: "arrangement" },
    ],
    [{ url: k, tool: "visualizer" }],
  ]);
  setBuild(stoat.url, { state: "running" });
  const { error } = await buildInto(stoat, await api.repo.find(k), api.repo);
  setBuild(stoat.url, error ? { state: "error", message: error.message } : { state: "ok" });
}

// what lattice adds to the + menu, after knitoutjs's: markdown, a
// patternwitch, a skitch, and while alt is held, a patternstoat, a charm, a
// machine, a yarn, a swatch and a terminal. `baseRepo` is the
// repo under any draft overlay: latticex shares on the doc itself, never on
// a draft's copy of it
function lattice(baseRepo, hive) {
  return {
    name: "lattice",
    // a patternstoat's charm: linked, so they light up together, and are
    // one lineage in the files. (its type's patternstoat.js's
    // PATTERNSTOAT_TYPE, written out: that's only loaded when it's needed)
    watch(doc) {
      const charm = String(doc?.charm ?? "");
      return { charm: doc?.["@patchwork"]?.type === "lattice:patternstoat" && isValidAutomergeUrl(charm) ? charm : null };
    },
    links(url, api) {
      const charm = api.docInfo(url).ext?.lattice?.charm;
      return charm ? [{ url: charm, live: true }] : [];
    },
    menu: () => [
      datatypeItem({ type: "markdown", icon: "text", label: "markdown" }, hive),
      datatypeItem({ type: "patternwitch", icon: "grid", label: "patternwitch", detail: "a pixel painter: a grid in a few colours" }, hive),
      datatypeItem({ type: "skitch", icon: "pencil", label: "skitch", detail: "a sketch: paint, ink, a marker and shapes, clean or sketchy" }, hive),
      {
        icon: "grid",
        label: "patternstoat",
        detail: "a design in colours that stand for stitches, built into a .k with a charm",
        alt: true,
        create: newPatternstoat,
      },
      {
        icon: "grid",
        label: "charm",
        detail: "a colour arrangement: what each colour of a patternstoat does",
        alt: true,
        async create(api) {
          const { newCharm } = await import("../patternstoat/charm.js");
          return { url: (await api.repo.create2(newCharm())).url, tool: "arrangement" };
        },
      },
      ...PROFILES.map(({ icon, label, detail, make }) => ({
        icon,
        label,
        detail,
        alt: true,
        async create(api) {
          return (await api.repo.create2(make())).url;
        },
      })),
      {
        icon: "terminal",
        label: "terminal",
        detail: "shared from your computer with latticex",
        alt: true,
        async create() {
          const terminal = await baseRepo.create2({ "@patchwork": { type: "latticex" }, title: "terminal" });
          return terminal.url;
        },
      },
    ],
  };
}

// what lattice's workspace has: its tools, knitoutjs's extension and its
// own, and knitoutjs's projects from before, which it updates
export function latticeOptions(baseRepo, hive) {
  return {
    tools,
    extensions: [knitout, lattice(baseRepo, hive)],
    self: PROJECT_TOOLS,
    old: { is: isOldKnitoutjs, update: updateKnitoutjs, auto: true },
  };
}

export default function LatticeProjectTool(handle, element) {
  // knitout.js's look, which the frame wears too
  wearLook();
  const repo = element.repo;
  const baseRepo = repo.baseRepo ?? repo;
  return createRoot((dispose) => {
    // your pointer, an arrow or a mouse, as you chose it in lattice's settings
    const [mine] = useToolStorage(element, "lattice", { repo: baseRepo });
    const unmount = mountProject(element, {
      project: handle,
      repo,
      baseRepo,
      hive: element.hive,
      pointer: () => (mine()?.pointer === "mouse" ? "mouse" : "arrow"),
      ...latticeOptions(baseRepo, element.hive),
    });
    return () => {
      unmount();
      dispose();
    };
  });
}
