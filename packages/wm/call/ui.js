// a call's faces, and the question before you're in one: for wm's panes, and
// for an app's own (lattice's frame shows the call down the bottom, and in
// its sidebar)
import { createEffect, createMemo, For, Show, onCleanup } from "solid-js";
import html from "solid-js/html";
import { call, onCallIn, join, setFloating } from "./call.js";
import { faceImage } from "../presence.js";
import { colourFor } from "../pointer.js";
import { icon } from "../ui/icons.js";

const initial = (name) => (String(name ?? "")[0] ?? "?").toUpperCase();

// "chee", "chee and mimi", "chee, mimi and agnes"
export function names(list) {
  if (list.length < 2) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

// a <video> of `stream()` (null for none), always quiet: the sound is the
// call's own to play, once
function videoOf(stream) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  let tracks = -1;
  createEffect(() => {
    const now = stream();
    const count = now?.getVideoTracks().length ?? 0;
    // a track added to the stream it already has isn't always picked up
    if (video.srcObject !== now || count !== tracks) {
      video.srcObject = null;
      video.srcObject = now;
    }
    tracks = count;
    if (now) video.play().catch(() => {});
  });
  onCleanup(() => (video.srcObject = null));
  return video;
}

/**
 * someone in the call (`props.id`, or "me" for you), as a round face: their
 * pictures while their camera's on, else their avatar, or their initial.
 * `props.size` is in px; `props.shape` "round" (the default) or "tile"
 */
export function Face(props) {
  const mine = () => props.id === "me";
  const person = () => (mine() ? { ...call.me(), mic: call.get()?.mic, camera: call.get()?.camera } : call.peers().find((peer) => peer.id === props.id));
  const stream = () => (mine() ? call.local() : person()?.camera ? call.stream(props.id) : null);
  const video = videoOf(stream);
  const image = () => faceImage(person()?.avatar);
  return html`<span
    class="lattice-wm-call-face"
    data-shape=${() => props.shape ?? "round"}
    data-mine=${() => (mine() ? "" : undefined)}
    data-camera=${() => (stream() ? "" : undefined)}
    data-connecting=${() => (!mine() && person()?.connection !== "connected" ? "" : undefined)}
    style=${() => ({
      // theirs, or one for them, as presence would give them
      "--lattice-wm-face": person() ? person().colour || colourFor(person().contact || props.id) : null,
      "--lattice-wm-call-size": props.size ? `${props.size}px` : null,
      "background-image": !stream() && image() ? `url("${image()}")` : null,
    })}
    title=${() => (props.title === false ? undefined : mine() ? "you" : person()?.name)}
  >
    ${() => (stream() ? video : image() ? "" : initial(person()?.name))}
    <${Show} when=${() => person() && !person().mic}>
      <span class="lattice-wm-call-muted" aria-label="muted">${icon("mic-off", 9)}</span>
    <//>
  </span>`;
}

/**
 * the question: share your video, and call (or join the one that's on).
 * shows when something asks (call.js's ask), by what asked, or else at the
 * top of `props.near`
 */
export function CallPrompt(props) {
  let popover;
  let first;
  const asking = call.asking;
  const others = createMemo(() => (asking() ? onCallIn(asking().room.url) : []));
  const elsewhere = () => {
    const now = call.get();
    return now && asking() && now.room !== asking().room.url ? now : null;
  };

  createEffect(() => {
    const now = asking();
    if (!popover) return;
    if (!now) {
      if (popover.matches(":popover-open")) popover.hidePopover();
      return;
    }
    // (a getter: what it's near now)
    const near = props.near?.getBoundingClientRect();
    const at = now.at ?? (near ? { x: near.left + 12, y: near.top + 12 } : { x: 16, y: 16 });
    popover.style.left = `${Math.max(8, Math.min(at.x, innerWidth - 268))}px`;
    popover.style.top = `${Math.max(8, Math.min(at.y, innerHeight - 180))}px`;
    if (!popover.matches(":popover-open")) popover.showPopover();
    // asked for, it's yours to answer; arriving to one, it waits for you
    if (now.focus) first?.focus({ preventScroll: true });
  });

  function go(video) {
    const now = asking();
    call.stopAsking();
    if (now) join(now, { video });
  }

  return html`<div
    class="lattice-wm-call-prompt"
    popover="auto"
    role="dialog"
    aria-label="a call"
    ref=${(el) => (popover = el)}
    onToggle=${(event) => event.newState === "closed" && call.stopAsking()}
  >
    <${Show}
      when=${() => others().length}
      fallback=${html`<p class="lattice-wm-call-prompt-title">start a call here?</p>`}
    >
      <div class="lattice-wm-call-prompt-who">
        <span class="lattice-wm-call-prompt-faces">
          <${For} each=${others}>
            ${(person) => {
              const image = faceImage(person.who.avatar);
              return html`<span
                class="lattice-wm-call-face"
                style=${{ "--lattice-wm-face": person.who.colour || null, "background-image": image ? `url("${image}")` : null }}
                >${image ? "" : initial(person.who.name)}</span
              >`;
            }}
          <//>
        </span>
        <p class="lattice-wm-call-prompt-title">
          ${() => `${names([...new Set(others().map((person) => person.who.name))])} on a call`}
        </p>
      </div>
    <//>
    <p class="lattice-wm-call-prompt-ask">share your video?</p>
    <div class="lattice-wm-call-prompt-buttons">
      <button class="lattice-wm-call-go" ref=${(el) => (first = el)} onClick=${() => go(true)}>
        ${icon("video", 13)} video on
      </button>
      <button class="lattice-wm-call-go" data-quiet="" onClick=${() => go(false)}>${icon("mic", 13)} just voice</button>
    </div>
    <div class="lattice-wm-call-prompt-foot">
      <span>${() => (elsewhere() ? `leaves the call in ${elsewhere().name || "another project"}` : "")}</span>
      <button class="lattice-wm-call-not-now" onClick=${() => call.stopAsking()}>not now</button>
    </div>
  </div>`;
}

// where a floating face starts: down the right, one under another
const startAt = (index) => ({ x: 1 - 108 / innerWidth, y: Math.min(0.8, (96 + index * 108) / innerHeight) });

/** everyone's faces, floating over everything, each where you put it */
export function CallFloating() {
  return html`<${Show} when=${() => call.get() && call.settings.faces === "floating"}>
    <div class="lattice-wm-call-floating">
      <${For} each=${() => call.peers()}>
        ${(peer, index) => {
          const key = () => peer.contact || peer.id;
          const at = () => call.settings.floating[key()] ?? startAt(index());
          let dragging = null;
          function onPointerDown(event) {
            if (event.button !== 0) return;
            const box = event.currentTarget.getBoundingClientRect();
            dragging = { dx: event.clientX - box.left, dy: event.clientY - box.top, at: at() };
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          function onPointerMove(event) {
            if (!dragging) return;
            const x = Math.max(0, Math.min(1, (event.clientX - dragging.dx) / innerWidth));
            const y = Math.max(0, Math.min(1, (event.clientY - dragging.dy) / innerHeight));
            dragging.at = { x, y };
            event.currentTarget.style.left = `${x * 100}%`;
            event.currentTarget.style.top = `${y * 100}%`;
          }
          function onPointerUp() {
            if (dragging) setFloating(key(), dragging.at);
            dragging = null;
          }
          return html`<div
            class="lattice-wm-call-float"
            style=${() => ({ left: `${at().x * 100}%`, top: `${at().y * 100}%` })}
            onPointerDown=${onPointerDown}
            onPointerMove=${onPointerMove}
            onPointerUp=${onPointerUp}
            onPointerCancel=${onPointerUp}
          >
            <${Face} id=${peer.id} size=${88} />
            <span class="lattice-wm-call-float-name">${() => peer.name}</span>
          </div>`;
        }}
      <//>
    </div>
  <//>`;
}

/** everyone's faces, one under another (for a sidebar), and yours last */
export function CallTiles() {
  return html`<div class="lattice-wm-call-tiles">
    <${For} each=${() => call.peers()}>
      ${(peer) => html`<figure class="lattice-wm-call-tile">
        <${Face} id=${peer.id} shape="tile" title=${false} />
        <figcaption>${() => peer.name}</figcaption>
      </figure>`}
    <//>
    <${Show} when=${() => call.get()}>
      <figure class="lattice-wm-call-tile">
        <${Face} id="me" shape="tile" title=${false} />
        <figcaption>you</figcaption>
      </figure>
    <//>
  </div>`;
}
