// a call's faces, and the question before you're in one: for wm's panes, and
// for an app's own (lattice's frame shows the call down the bottom, and in
// its sidebar)
import { createEffect, createMemo, For, Show, onCleanup } from "solid-js";
import html from "solid-js/html";
import { call, onCallIn, join, setFloating } from "./call.js";
import { faceImage } from "../presence.js";
import { centreOn } from "./face.js";
import { colourFor } from "../pointer.js";
import { icon } from "../ui/icons.js";

const initial = (name) => (String(name ?? "")[0] ?? "?").toUpperCase();

// "chee", "chee and mimi", "chee, mimi and agnes"
export function names(list) {
  if (list.length < 2) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

// a <video> of `stream()` (null for none), always quiet: the sound is the
// call's own to play, once. it's centred on `face()` (face.js), where that's
// known, as its box and the picture change
function videoOf(stream, face) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  const centre = () => centreOn(video, face());
  video.addEventListener("loadedmetadata", centre);
  video.addEventListener("resize", centre);
  const resized = new ResizeObserver(centre);
  resized.observe(video);
  createEffect(centre);
  onCleanup(() => resized.disconnect());
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
 * `props.size` is in px; `props.shape` "round" (the default) or "tile";
 * `props.muted` false leaves out saying they're muted (it's said beside
 * their name instead)
 */
export function Face(props) {
  const mine = () => props.id === "me";
  const person = () =>
    mine()
      ? { ...call.me(), mic: call.get()?.mic, camera: call.get()?.camera, face: call.get()?.face }
      : call.peers().find((peer) => peer.id === props.id);
  const stream = () => (mine() ? call.local() : person()?.camera ? call.stream(props.id) : null);
  const video = videoOf(stream, () => person()?.face ?? null);
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
    <${Show} when=${() => props.muted !== false && person() && !person().mic}>
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

// a floating face's width, to start with, and as small and big as it goes
const FLOAT_WIDTH = 160;
const FLOAT_MIN = 72;
const FLOAT_MAX = 640;
// where a floating face starts: down the right, one under another
const startAt = (index) => ({
  x: Math.max(0, 1 - (FLOAT_WIDTH + 16) / innerWidth),
  y: Math.min(0.8, (96 + index * (FLOAT_WIDTH * 0.75 + 32)) / innerHeight),
  width: FLOAT_WIDTH,
});

// where a floating face goes: where it was put, but all of it in the window
// (a face sized bigger near an edge moves away from it)
function inWindow({ x, y, width }) {
  const height = width * 0.75 + 24;
  return {
    left: `${Math.max(0, Math.min(x * innerWidth, innerWidth - width - 8))}px`,
    top: `${Math.max(0, Math.min(y * innerHeight, innerHeight - height - 8))}px`,
  };
}

/**
 * everyone's faces, floating over everything, each where you put it and the
 * size you made it: dragged to move, and by its corner to size. each is a
 * circle centred on their face, or, double clicked, the picture's own shape
 * (4:3), none of it cut off (and double clicked again, a circle)
 */
export function CallFloating() {
  return html`<${Show} when=${() => call.get() && call.settings.faces === "floating"}>
    <div class="lattice-wm-call-floating">
      <${For} each=${() => call.peers()}>
        ${(peer, index) => {
          const key = () => peer.contact || peer.id;
          const at = () => ({ ...startAt(index()), ...call.settings.floating[key()] });
          let float;
          // what's being done to it: {sizing, dx, dy (or the width it was), at}
          let dragging = null;
          function onPointerDown(event) {
            if (event.button !== 0) return;
            const box = float.getBoundingClientRect();
            const sizing = !!event.target.closest(".lattice-wm-call-size");
            dragging = sizing
              ? { sizing, x: event.clientX, width: at().width, at: at() }
              : { sizing, dx: event.clientX - box.left, dy: event.clientY - box.top, at: at() };
            float.setPointerCapture(event.pointerId);
            event.preventDefault();
          }
          function onPointerMove(event) {
            if (!dragging) return;
            if (dragging.sizing) {
              const width = Math.round(Math.max(FLOAT_MIN, Math.min(FLOAT_MAX, dragging.width + event.clientX - dragging.x)));
              dragging.at = { ...dragging.at, width };
              Object.assign(float.style, { ...inWindow(dragging.at), width: `${width}px` });
              return;
            }
            const x = Math.max(0, Math.min(1, (event.clientX - dragging.dx) / innerWidth));
            const y = Math.max(0, Math.min(1, (event.clientY - dragging.dy) / innerHeight));
            dragging.at = { ...dragging.at, x, y };
            Object.assign(float.style, inWindow(dragging.at));
          }
          function onPointerUp() {
            if (dragging) setFloating(key(), dragging.at);
            dragging = null;
          }
          const shape = () => (at().shape === "tile" ? "tile" : "round");
          return html`<div
            class="lattice-wm-call-float"
            data-shape=${shape}
            onDblClick=${() => setFloating(key(), { ...at(), shape: shape() === "round" ? "tile" : "round" })}
            ref=${(el) => (float = el)}
            style=${() => ({ ...inWindow(at()), width: `${at().width}px` })}
            onPointerDown=${onPointerDown}
            onPointerMove=${onPointerMove}
            onPointerUp=${onPointerUp}
            onPointerCancel=${onPointerUp}
          >
            <span class="lattice-wm-call-float-picture">
              <${Face} id=${peer.id} shape=${shape} muted=${false} />
              <span class="lattice-wm-call-size" title="drag to size"></span>
            </span>
            <span class="lattice-wm-call-float-name">
              ${() => peer.name}
              <${Show} when=${() => !peer.mic}>
                <span class="lattice-wm-call-float-muted" aria-label="muted">${icon("mic-off", 10)}</span>
              <//>
            </span>
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
