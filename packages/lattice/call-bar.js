// the call you're in, down the bottom of the projects, above you: where it
// is, everyone in it, and your mic, camera, screen (where there's one to
// share) and hanging up. its menu says how faces are shown (floating, or in
// the sidebar, and on cursors too or not) and which mic and camera. not in
// one, it says when there's one on in the project you're in, to join
import { createSignal, For, Show } from "solid-js";
import html from "solid-js/html";
import {
  FACES,
  ask,
  call,
  canShare,
  devices,
  hangUp,
  onCallIn,
  setCamera,
  setCursors,
  setDevice,
  setFaces,
  setMic,
  setNoise,
  startScreen,
  stopScreen,
} from "../wm/call/call.js";
import { download, DOWNLOAD_BYTES, NOISE } from "../wm/call/noise.js";
import { DragOut, Face, StageButton, names } from "../wm/call/ui.js";
import { scrollsAlong } from "../wm/ui/along.js";
import { arrivals } from "../wm/ui/arriving.js";
import { icon } from "../wm/ui/icons.js";

/** `props.inspector` is the inspector's sidebar state: shown for faces in it */
export function CallBar(props) {
  let menu;
  const [found, setFound] = createSignal({ audio: [], video: [] });
  const here = () => call.current();
  const others = () => (here() ? onCallIn(here().room.url) : []);

  async function openMenu(event) {
    if (menu.matches(":popover-open")) return menu.hidePopover();
    const box = event.currentTarget.getBoundingClientRect();
    menu.style.left = `${Math.max(8, box.left)}px`;
    menu.style.bottom = `${innerHeight - box.top + 4}px`;
    menu.style.top = "auto";
    // it grows up out of its button
    menu.style.transformOrigin = "0 100%";
    menu.showPopover();
    setFound(await devices());
  }

  // (choose takes the click, so it's a function, not a getter)
  function Choice(props) {
    return html`<button
      class="lattice-wm-menu-item lattice-call-choice"
      role="menuitemradio"
      aria-checked=${() => String(props.checked)}
      onClick=${(event) => {
        props.choose(event);
        menu.hidePopover();
      }}
    >
      ${() => props.label}
    </button>`;
  }

  function Devices(props) {
    const chosen = () => (props.kind === "audio" ? call.settings.mic : call.settings.camera);
    return html`<${Show} when=${() => found()[props.kind].length > 1}>
      <div class="lattice-wm-menu-heading">${props.kind === "audio" ? "mic" : "camera"}</div>
      <${For} each=${() => found()[props.kind]}>
        ${(device, at) =>
          html`<${Choice}
            label=${device.label}
            checked=${() => chosen() === device.id || (!chosen() && at() === 0)}
            choose=${(event) => setDevice(props.kind, device.id)}
          />`}
      <//>
    <//>`;
  }

  const In = () => {
    // someone joining while you're in it comes in (ui/arriving.js): not
    // whoever was there when you joined
    const arriving = arrivals();
    return html`<div class="lattice-call" role="group" aria-label="the call">
    <div class="lattice-call-head">
      <span class="lattice-call-phone">${icon("phone", 12)}</span>
      <span class="lattice-call-where">
        ${() => (call.get().joining ? "joining…" : call.get().name || "a call")}
      </span>
      <button
        class="lattice-call-button"
        title="faces, mic and camera"
        aria-label="faces, mic and camera"
        aria-haspopup="menu"
        onClick=${openMenu}
      >
        ${icon("chevron-down", 12)}
      </button>
    </div>
    <div class="lattice-call-row">
      <span class="lattice-call-faces" ref=${scrollsAlong}>
        <${DragOut} id="me"><${Face} id="me" size=${26} /><//>
        <${For} each=${call.peers}>
          ${(peer) => html`<${StageButton} id=${peer.id} class="lattice-call-face-button" arriving=${arriving(peer.id)}>
            <${Face} id=${peer.id} size=${26} />
          <//>`}
        <//>
      </span>
      <span class="lattice-call-buttons">
        <button
          class="lattice-call-button"
          data-off=${() => (call.get().mic ? undefined : "")}
          title=${() => (call.get().mic ? "mute" : "unmute")}
          aria-label=${() => (call.get().mic ? "mute" : "unmute")}
          onClick=${() => setMic(!call.get().mic)}
        >
          ${() => icon(call.get().mic ? "mic" : "mic-off", 14)}
        </button>
        <button
          class="lattice-call-button"
          data-off=${() => (call.get().camera ? undefined : "")}
          title=${() => (call.get().camera ? "camera off" : "camera on")}
          aria-label=${() => (call.get().camera ? "camera off" : "camera on")}
          onClick=${() => setCamera(!call.get().camera)}
        >
          ${() => icon(call.get().camera ? "video" : "video-off", 14)}
        </button>
        <${Show} when=${canShare}>
          <button
            class="lattice-call-button"
            data-on=${() => (call.get().screen ? "" : undefined)}
            aria-pressed=${() => String(!!call.get().screen)}
            title=${() => (call.get().screen ? "stop sharing your screen" : "share your screen")}
            aria-label=${() => (call.get().screen ? "stop sharing your screen" : "share your screen")}
            onClick=${() => (call.get().screen ? stopScreen() : startScreen())}
          >
            ${icon("screen", 14)}
          </button>
        <//>
        <button class="lattice-call-button lattice-call-hang-up" title="hang up" aria-label="hang up" onClick=${hangUp}>
          ${icon("hang-up", 14)}
        </button>
      </span>
    </div>
    <${Show} when=${() => call.get().problem}>
      <p class="lattice-call-problem">${() => call.get().problem}</p>
    <//>
    <${Show} when=${() => call.settings.noise === "deepfilternet" && download().state === "loading"}>
      <p class="lattice-call-note">
        getting DeepFilterNet ${() => Math.floor((download().got / download().total) * 100)}% · the browser's till then
      </p>
    <//>
    <${Show} when=${() => call.settings.noise === "deepfilternet" && download().state === "failed"}>
      <p class="lattice-call-problem">couldn't get DeepFilterNet (${() => download().problem}): the browser's for now</p>
    <//>
    <div class="lattice-wm-menu lattice-call-menu" popover="auto" role="menu" ref=${(el) => (menu = el)}>
      <div class="lattice-wm-menu-heading">faces</div>
      <${For} each=${FACES}>
        ${([id, label]) =>
          html`<${Choice}
            label=${label}
            checked=${() => call.mode() === id}
            choose=${(event) => {
              setFaces(id);
              if (id === "sidebar") props.inspector?.setOpen(true);
            }}
          />`}
      <//>
      <button
        class="lattice-wm-menu-item lattice-call-choice"
        role="menuitemcheckbox"
        aria-checked=${() => String(call.cursors())}
        onClick=${() => setCursors(!call.cursors())}
      >
        on cursors too
      </button>
      <${Devices} kind="audio" />
      <div class="lattice-wm-menu-heading">noise</div>
      <${For} each=${NOISE}>
        ${([id, label]) =>
          html`<${Choice}
            label=${() => (id === "deepfilternet" ? `${label} ${deepFilterNote()}` : label)}
            checked=${() => call.settings.noise === id}
            choose=${(event) => setNoise(id)}
          />`}
      <//>
      <${Devices} kind="video" />
    </div>
  </div>`;
  };

  // DeepFilterNet's download, in its line of the menu and under the call
  // while it's going: what it is till it's here, how far it's got, or why not
  const megabytes = (bytes) => `${Math.round(bytes / 1024 / 1024)}MB`;
  function deepFilterNote() {
    const { state, got, total } = download();
    if (state === "loading") return `· downloading ${Math.floor((got / total) * 100)}%`;
    if (state === "failed") return "· couldn't download it";
    if (state === "ready") return "";
    return `· AI, ${megabytes(DOWNLOAD_BYTES)} once`;
  }

  // a call on where you are, that you're not in
  const On = () => html`<div class="lattice-call" data-on="">
    <div class="lattice-call-head">
      <span class="lattice-call-phone">${icon("phone", 12)}</span>
      <span class="lattice-call-where">
        ${() => `${names([...new Set(others().map((person) => person.who.name))])} on a call`}
      </span>
      <button
        class="lattice-call-join"
        onClick=${(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          ask(here(), { at: { x: box.left, y: box.top - 150 }, focus: true });
        }}
      >
        join
      </button>
    </div>
  </div>`;

  return html`<${Show} when=${() => !!call.get()} fallback=${html`<${Show} when=${() => others().length}>${On}<//>`}>
    ${In}
  <//>`;
}
