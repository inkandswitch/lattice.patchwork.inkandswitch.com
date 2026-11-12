// a call's faces, and the question before you're in one: for wm's panes, and
// for an app's own (lattice's frame shows the call down the bottom, and in
// its sidebar). someone's face in the call bar, clicked, fills the panes
// (CallStage), and that, double clicked, the screen. in the sidebar, clicked,
// they fill the sidebar's box. floating, each face can be put away, and
// dragged out of the call bar again (DragOut)
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
import html from "solid-js/html";
import { call, onCallIn, join, setFloating, hideFloating, showFloating, toggleStage, setFull, closeStage } from "./call.js";
import { tilesFor } from "./sizes.js";
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
    data-speaking=${() => ((mine() ? call.get()?.speaking : person()?.speaking) ? "" : undefined)}
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

// ── a floating face going to the call bar, and coming out of it ─────────

// on screen, moving: in and out. coming in: out
const EASE_MOVE = "cubic-bezier(0.77, 0, 0.175, 1)";
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// someone's face in the call bar (or, past the ones it has room for, the
// count of the rest): where their floating face goes to, and comes from
function inBar(id) {
  return (
    document.querySelector(`.lattice-call [data-call-face="${CSS.escape(id)}"]`) ??
    (id === "me" ? null : document.querySelector(".lattice-call .lattice-call-more"))
  );
}

// the transform that puts `float`'s picture over `target`, and the origin it's
// from (the picture's middle), or null if either isn't on screen
function towards(float, target) {
  const picture = float.querySelector(".lattice-wm-call-float-picture")?.getBoundingClientRect();
  const box = float.getBoundingClientRect();
  const to = target?.getBoundingClientRect();
  if (!picture?.width || !to?.width) return null;
  const x = picture.left + picture.width / 2;
  const y = picture.top + picture.height / 2;
  return {
    origin: `${x - box.left}px ${y - box.top}px`,
    transform: `translate(${to.left + to.width / 2 - x}px, ${to.top + to.height / 2 - y}px) scale(${to.width / picture.width})`,
  };
}

// put away: it goes into their face in the call bar, then it's gone
function minimise(float, id, done) {
  const to = reducedMotion() ? null : towards(float, inBar(id));
  float.style.pointerEvents = "none";
  const motion = to
    ? float.animate(
        [
          { transformOrigin: to.origin, transform: "none", opacity: 1 },
          { transformOrigin: to.origin, transform: to.transform, opacity: 0.3 },
        ],
        { duration: 240, easing: EASE_MOVE, fill: "forwards" },
      )
    : float.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
  motion.finished.then(done, done);
}

// the ones just dragged out of the call bar: they're where they were let go,
// not coming out of it
const dropped = new Set();

// arriving (you've joined, they have, or faces are floating now): out of
// their face in the call bar to where it goes, one after another
function arrive(float, id, key, index) {
  if (dropped.delete(key) || reducedMotion()) {
    float.animate([{ opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1 }], { duration: 160, easing: EASE_OUT });
    return;
  }
  const from = towards(float, inBar(id));
  if (!from) {
    float.animate([{ opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1 }], { duration: 200, easing: EASE_OUT });
    return;
  }
  float.animate(
    [
      { transformOrigin: from.origin, transform: from.transform, opacity: 0.3 },
      { transformOrigin: from.origin, transform: "none", opacity: 1 },
    ],
    { duration: 280, delay: Math.min(index, 8) * 40, easing: EASE_OUT, fill: "backwards" },
  );
}

/**
 * everyone's faces, floating over everything, each where you put it and the
 * size you made it: dragged to move, and by its corner to size. each is a
 * circle centred on their face, or, double clicked, the picture's own shape
 * (4:3), none of it cut off (and double clicked again, a circle)
 */
export function CallFloating() {
  // you too, last: by id, so each keeps its place as people come and go.
  // not the ones put away (dragged out of the call bar, they're back)
  const ids = createMemo(() =>
    [...call.peers().map((peer) => peer.id), "me"].filter((id) => !call.settings.floating[call.floatKey(id)]?.hidden),
  );
  return html`<${Show} when=${() => call.get() && call.mode() === "floating"}>
    <div class="lattice-wm-call-floating">
      <${For} each=${ids}>
        ${(id, index) => {
          const mine = id === "me";
          const peer = () => (mine ? null : call.peers().find((peer) => peer.id === id));
          const key = () => call.floatKey(id);
          const name = () => (mine ? "you" : peer()?.name);
          const muted = () => (mine ? !call.get()?.mic : !peer()?.mic);
          const at = () => ({ ...startAt(index()), ...call.settings.floating[key()] });
          let float;
          // what's being done to it: {sizing, dx, dy (or the width it was), at}
          let dragging = null;
          function onPointerDown(event) {
            if (event.button !== 0 || event.target.closest(".lattice-wm-call-float-close")) return;
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
            data-mine=${mine ? "" : undefined}
            onDblClick=${() => setFloating(key(), { ...at(), shape: shape() === "round" ? "tile" : "round" })}
            ref=${(el) => {
              float = el;
              // once it's where it goes
              requestAnimationFrame(() => float.isConnected && arrive(float, id, key(), index()));
            }}
            style=${() => ({ ...inWindow(at()), width: `${at().width}px` })}
            onPointerDown=${onPointerDown}
            onPointerMove=${onPointerMove}
            onPointerUp=${onPointerUp}
            onPointerCancel=${onPointerUp}
          >
            <span class="lattice-wm-call-float-picture">
              <${Face} id=${id} shape="tile" muted=${false} />
              <span class="lattice-wm-call-size" title="drag to size"></span>
              <button
                class="lattice-wm-call-float-close"
                aria-label=${() => `minimise ${mine ? "your face" : `${name()}'s face`}`}
                title="minimise to the call bar (drag them out of it to have them back)"
                onClick=${() => minimise(float, id, () => hideFloating(key()))}
                onDblClick=${(event) => event.stopPropagation()}
              >
                ${icon("minimise", 10)}
              </button>
            </span>
            <span class="lattice-wm-call-float-name">
              ${name}
              <${Show} when=${muted}>
                <span class="lattice-wm-call-float-muted" aria-label="muted">${icon("mic-off", 10)}</span>
              <//>
            </span>
          </div>`;
        }}
      <//>
    </div>
  <//>`;
}

// a face dragged out (of the call bar) and let go somewhere else: their
// floating face is back, there. only while faces are floating. returns the
// handlers for what's dragged, and whether what just happened was a drag
// (so it's not a click too)
const DRAG_FROM = 5;
function dragOut(id) {
  let start = null;
  let ghost = null;
  let dragged = false;
  function onPointerDown(event) {
    if (event.button !== 0 || call.mode() !== "floating") return;
    start = { x: event.clientX, y: event.clientY, from: event.currentTarget };
    dragged = false;
  }
  function onPointerMove(event) {
    if (!start) return;
    if (!ghost) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_FROM) return;
      start.from.setPointerCapture(event.pointerId);
      // what's dragged: a copy of their face, pictures and all
      const face = start.from.querySelector(".lattice-wm-call-face");
      ghost = face.cloneNode(true);
      const video = face.querySelector("video");
      const copy = ghost.querySelector("video");
      if (video && copy) {
        copy.srcObject = video.srcObject;
        copy.muted = true;
        copy.play().catch(() => {});
      }
      ghost.classList.add("lattice-wm-call-ghost");
      document.body.append(ghost);
    }
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
  }
  function onPointerUp(event) {
    if (ghost) {
      ghost.remove();
      ghost = null;
      dragged = true;
      // let go on what it came from: never mind
      if (!start.from.closest(".lattice-call")?.contains(document.elementFromPoint(event.clientX, event.clientY))) {
        const width = call.settings.floating[call.floatKey(id)]?.width ?? FLOAT_WIDTH;
        dropped.add(call.floatKey(id));
        showFloating(call.floatKey(id), {
          x: Math.max(0, (event.clientX - width / 2) / innerWidth),
          y: Math.max(0, (event.clientY - 24) / innerHeight),
          width,
        });
      }
    }
    start = null;
  }
  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    // (once: the click after a drag)
    wasDrag: () => {
      const was = dragged;
      dragged = false;
      return was;
    },
  };
}

/** `props.id`'s face (props.children), to drag out of where it is into a floating face */
export function DragOut(props) {
  const drag = dragOut(props.id);
  return html`<span
    class="lattice-wm-call-drag"
    data-call-face=${() => props.id}
    title=${() => (call.mode() === "floating" ? "drag out to float" : undefined)}
    onPointerDown=${drag.handlers.onPointerDown}
    onPointerMove=${drag.handlers.onPointerMove}
    onPointerUp=${drag.handlers.onPointerUp}
    onPointerCancel=${drag.handlers.onPointerCancel}
    onClick=${() => drag.wasDrag()}
  >
    ${props.children}
  </span>`;
}

/**
 * a face to click to fill the panes with them (again: the panes back), or,
 * floating, drag out to float. `props.id`; the rest's what's in it
 */
export function StageButton(props) {
  const drag = dragOut(props.id);
  return html`<button
    class=${() => `lattice-wm-call-stage-button ${props.class ?? ""}`}
    data-call-face=${() => props.id}
    data-staged=${() => (call.stage() === props.id ? "" : undefined)}
    aria-pressed=${() => String(call.stage() === props.id)}
    title=${() =>
      call.stage() === props.id
        ? "back to the panes"
        : call.mode() === "floating"
          ? "fill the panes with them (or drag out to float)"
          : "fill the panes with them"}
    onPointerDown=${drag.handlers.onPointerDown}
    onPointerMove=${drag.handlers.onPointerMove}
    onPointerUp=${drag.handlers.onPointerUp}
    onPointerCancel=${drag.handlers.onPointerCancel}
    onClick=${() => !drag.wasDrag() && toggleStage(props.id)}
  >
    ${props.children}
  </button>`;
}

/**
 * everyone's faces, for a sidebar, yours last: big while there are few, two
 * across when there are more, and past that a list, whoever spoke last at
 * the top. one clicked fills the box, you in its corner; clicked again, all
 * of them
 */
export function CallTiles() {
  const [focus, setFocus] = createSignal(null);
  const focused = () => (focus() && call.peers().some((peer) => peer.id === focus()) ? focus() : null);
  const count = () => call.peers().length + 1;
  const layout = () => tilesFor(count());
  const peers = createMemo(() => {
    const list = call.peers();
    if (layout() !== "chips") return list;
    return [...list].sort((a, b) => (b.speaking ? 1 : 0) - (a.speaking ? 1 : 0) || (b.spoke ?? 0) - (a.spoke ?? 0));
  });
  const name = (id) => call.peers().find((peer) => peer.id === id)?.name;

  const Focused = () => html`<div class="lattice-wm-call-tiles" data-layout="focus">
    <button class="lattice-wm-call-focus" title="everyone again" onClick=${() => setFocus(null)}>
      <${Show} when=${focused} keyed>
        ${(id) => html`<${Face} id=${id} shape="tile" muted=${false} title=${false} />`}
      <//>
      <span class="lattice-wm-call-focus-name">${() => name(focused())}</span>
      <span class="lattice-wm-call-focus-me"><${Face} id="me" shape="tile" title=${false} /></span>
    </button>
  </div>`;

  return html`<${Show} when=${focused} fallback=${html`<div class="lattice-wm-call-tiles" data-layout=${layout}>
    <${For} each=${peers}>
      ${(peer) => html`<button
        class="lattice-wm-call-stage-button lattice-wm-call-tile"
        title="fill the box with them"
        onClick=${() => setFocus(peer.id)}
      >
        <${Show}
          when=${() => layout() !== "chips"}
          fallback=${html`<${Face} id=${peer.id} size=${28} title=${false} />`}
        >
          <${Face} id=${peer.id} shape="tile" title=${false} />
        <//>
        <span class="lattice-wm-call-tile-name">${() => peer.name}</span>
      </button>`}
    <//>
    <${Show} when=${() => call.get()}>
      <div class="lattice-wm-call-tile" data-mine="">
        <${Show}
          when=${() => layout() !== "chips"}
          fallback=${html`<${Face} id="me" size=${28} title=${false} />`}
        >
          <${Face} id="me" shape="tile" title=${false} />
        <//>
        <span class="lattice-wm-call-tile-name">you</span>
      </div>
    <//>
  </div>`}>
    ${Focused}
  <//>`;
}

/**
 * whoever's been clicked (call.stage()), filling `props.box` (a style: where
 * the panes are), with you in its corner. double clicked, it fills the
 * screen, you a little bigger; escape, or its ×, puts the panes back
 */
export function CallStage(props) {
  let stage;
  const id = () => call.stage();
  const person = () => call.peers().find((peer) => peer.id === id());

  // the whole screen, while it's wanted, and not once it's left (escape)
  createEffect(() => {
    // (read first: it's what this runs again for)
    const full = call.full();
    id();
    if (!stage?.isConnected) return;
    if (full && document.fullscreenElement !== stage) {
      stage.requestFullscreen?.().catch(() => setFull(false));
    } else if (!full && document.fullscreenElement === stage) {
      document.exitFullscreen().catch(() => {});
    }
  });
  const onFullscreen = () => {
    if (call.full() && document.fullscreenElement !== stage) setFull(false);
  };
  const onKey = (event) => {
    if (event.key === "Escape" && id() && !document.fullscreenElement) closeStage();
  };
  document.addEventListener("fullscreenchange", onFullscreen);
  document.addEventListener("keydown", onKey);
  onCleanup(() => {
    document.removeEventListener("fullscreenchange", onFullscreen);
    document.removeEventListener("keydown", onKey);
    if (stage && document.fullscreenElement === stage) document.exitFullscreen().catch(() => {});
  });

  return html`<${Show} when=${id}>
    <div
      class="lattice-wm-call-stage"
      ref=${(el) => (stage = el)}
      style=${() => props.box ?? {}}
      onDblClick=${() => setFull(!call.full())}
      title="double click: the whole screen"
    >
      <${Show} when=${id} keyed>
        ${(staged) => html`<${Face} id=${staged} shape="tile" muted=${false} title=${false} />`}
      <//>
      <span class="lattice-wm-call-stage-name">
        ${() => person()?.name}
        <${Show} when=${() => person() && !person().mic}>${icon("mic-off", 12)}<//>
      </span>
      <button
        class="lattice-wm-call-stage-close"
        aria-label="back to the panes"
        title="back to the panes (escape)"
        onClick=${closeStage}
        onDblClick=${(event) => event.stopPropagation()}
      >
        ${icon("close", 14)}
      </button>
      <span class="lattice-wm-call-stage-me">
        <${Face} id="me" shape="tile" title=${false} />
      </span>
    </div>
  <//>`;
}
