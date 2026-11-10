// a tool's own doc in the account (account.toolStorage[toolId], made the
// first time it's asked for), found through the frame's tool storage
// provider, and live
import { createSignal, onCleanup } from "solid-js";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { useDocument } from "./vendor/solid-automerge.js";

/**
 * [doc, handle] (solid-automerge's useDocument) of `toolId`'s storage.
 * `element` is in the frame's providers. call it under a solid owner
 */
export function useToolStorage(element, toolId, { repo }) {
  const [url, setUrl] = createSignal();
  const unsubscribe = subscribe(element, { type: "patchwork:tool-storage", toolId }, (value) => {
    if (isValidAutomergeUrl(String(value ?? ""))) setUrl(String(value));
  });
  onCleanup(() => unsubscribe?.());
  return useDocument(url, { repo });
}
