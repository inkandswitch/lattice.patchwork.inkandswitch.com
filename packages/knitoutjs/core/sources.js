// the docs a build was made from, kept as pinned urls (`automerge:<id>#<heads>`)
// and written into the output as one line, so a .k or a .kc can say what it
// came from and notice when any of it has moved

const KNITOUT_KEY = "x-patchwork-sources";

const bare = (url) => String(url).replace(/^\//, "");

// "automerge:<id>#<heads>" -> "<id>"
export function docIdOf(url) {
  return bare(url).replace(/#.*$/, "").replace(/^automerge:/, "");
}

// "automerge:<id>#<heads>" -> "automerge:<id>"
export function unpinned(url) {
  return `automerge:${docIdOf(url)}`;
}

// what's after the "#" (heads joined with "|", as written), or ""
export function headsOf(url) {
  const at = bare(url).indexOf("#");
  return at < 0 ? "" : bare(url).slice(at + 1);
}

// the sources whose heads now differ from the ones pinned. the first is the
// builder itself, so it's skipped; one whose heads aren't known yet isn't stale
export function staleSources(sources, headsNow) {
  return sources.slice(1).filter((url) => {
    const now = headsNow(unpinned(url));
    return now !== undefined && now !== headsOf(url);
  });
}

const isHeader = (line, index) => line.startsWith(";;") || (index === 0 && line.startsWith(";!"));

// knitout with its sources line (replacing any it had), just after the ;;
// header lines, or first if there are none
export function withSourcesLine(knitout, sources) {
  const lines = knitout.split("\n").filter((line) => !line.startsWith(`${KNITOUT_KEY} `) && line !== KNITOUT_KEY);
  let at = 0;
  while (at < lines.length && isHeader(lines[at], at)) at++;
  lines.splice(at, 0, `${KNITOUT_KEY} ${sources.join(" ")}`);
  return lines.join("\n");
}

// the pinned urls a knitout or kcode text lists, or [] if it has no line
export function readSourcesLine(text) {
  for (const line of text.split("\n")) {
    const match = line.match(/^(?:\/\/ )?x-patchwork-sources(?:\s+(.*))?$/);
    if (match) return (match[1] ?? "").split(/\s+/).filter(Boolean);
  }
  return [];
}

// the first line of a .kc: the .k it was built from, then that .k's own sources
export function kcodeSourcesComment(kPinned, kSources) {
  return `// ${KNITOUT_KEY} ${[kPinned, ...kSources].join(" ")}`;
}
