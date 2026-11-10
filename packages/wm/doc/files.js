// what wm knows about the docs in a project's panes: what they're called, and
// the colour each wears. nothing imported, like the rest of doc/

// "js", "k", or whatever else the file says it is
export function fileExtension(doc) {
  if (doc?.extension) return doc.extension.replace(/^\./, "").toLowerCase();
  const match = doc?.name?.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

// a doc's name, with its extension (a UnixFileEntry's `extension`, or what
// the app says it is) after it, if the name hasn't one of its own. so
// everything shows as a file: notes.md, kniterate.machine
export function withExtension(name, extension) {
  name = String(name ?? "");
  extension = String(extension ?? "").replace(/^\./, "");
  if (!name || !extension || /\.[^.\s/]+$/.test(name)) return name;
  return `${name}.${extension}`;
}

// each doc gets a colour of its own, so every pane showing it wears the same
// one. the colours are tokens in wm.css
export const DOC_COLOURS = ["cherry", "blue", "stem", "lilac", "peach", "butter"];

export function docColour(url) {
  let hash = 0;
  for (const char of url ?? "") hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return DOC_COLOURS[Math.abs(hash) % DOC_COLOURS.length];
}

// automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu → 4NMNnk…
export function shortUrl(url) {
  return url ? url.replace(/^automerge:/, "").slice(0, 6) + "…" : "";
}

export function newFileDoc(name, content = "") {
  const extension = fileExtension({ name });
  return {
    "@patchwork": { type: "file" },
    name,
    extension,
    mimeType: extension === "js" ? "text/javascript" : "text/plain",
    content,
  };
}
