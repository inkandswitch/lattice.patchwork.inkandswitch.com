// a .k built into a .kc: kcode, the format a Kniterate machine reads. the
// converting is the app's (lattice's kcode.js has one); this is what's
// written, on both sides, so the .kc can say what it was made from and
// notice when that's moved. like ./run.js's runInto for a .js and its .k
import { ImmutableString } from "@automerge/automerge";
import { docText, knitoutOf, textHash } from "./files.js";
import { kcodeSourcesComment } from "./sources.js";

// convert the .k (as it is now, pinned) and write it into the .kc: its first
// line says what it was made from (the .k at those heads, then everything
// the .k was), and the .kc remembers the .k, its text's hash, when, and the
// same sources. the .k remembers where it goes. kcode goes in stored whole,
// as a built .k's knitout does. a conversion that fails leaves both as they
// were. `convert(text, name, options)` gives {kcode?, error?, warnings}; this
// gives {error?, warnings}
export async function buildKcode(kHandle, kcHandle, convert) {
  // the text and its pin, both from one version of the .k
  const pinned = kHandle.view(kHandle.heads());
  const k = pinned.doc();
  const text = docText(k);
  const kSources = knitoutOf(k).sources;
  const name = String(kcHandle.doc()?.name ?? k?.name ?? "pattern").replace(/\.kc?$/, "");
  const result = await convert(text, name, {});
  const warnings = result?.warnings ?? [];
  if (result?.error != null || typeof result?.kcode !== "string") {
    return { error: String(result?.error ?? "no kcode came back"), warnings };
  }
  kcHandle.change((doc) => {
    doc.content = new ImmutableString(`${kcodeSourcesComment(pinned.url, kSources)}\n${result.kcode}`);
    doc.kcodeSource = kHandle.url;
    doc.kcodeSourceHash = textHash(text);
    doc.kcodeBuiltAt = Date.now();
    doc.kcodeSources = [pinned.url, ...kSources];
  });
  if (knitoutOf(kHandle.doc()).kcodeTarget !== kcHandle.url) {
    kHandle.change((doc) => {
      doc.kcodeTarget = kcHandle.url;
    });
  }
  return { warnings };
}
