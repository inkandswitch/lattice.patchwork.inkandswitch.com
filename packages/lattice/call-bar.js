// the call you're in, down the bottom of the projects, above you: where it
// is, everyone in it, and your mic, camera and hanging up. its menu says how
// faces are shown (floating, or in the sidebar, and on cursors too or not)
// and which mic
// and camera. not in one, it says when there's one on in the project you're
// in, to join
import { createMemo, createSignal, For, Show } from "solid-js";
import html from "solid-js/html";
import { FACES, ask, call, devices, hangUp, onCallIn, setCamera, setCursors, setDevice, setFaces, setMic } from "../wm/call/call.js";
import { DragOut, Face, StageButton, names } from "../wm/call/ui.js";
import { shownInBar } from "../wm/call/sizes.js";
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
      ${props.label}
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

  // the others the bar has room for, you being one of its six. when they
  // don't all fit, whoever's speaking, or spoke last, gets the room (while
  // they do, nobody moves)
  const bar = createMemo(() => {
    let others = call.peers();
    if (others.length > 5) {
      others = [...others].sort((a, b) => (b.speaking ? 1 : 0) - (a.speaking ? 1 : 0) || (b.spoke ?? 0) - (a.spoke ?? 0));
    }
    return shownInBar(others, 5);
  });

  const In = () => html`<div class="lattice-call" role="group" aria-label="the call">
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
      <span class="lattice-call-faces">
        <${DragOut} id="me"><${Face} id="me" size=${26} /><//>
        <${For} each=${() => bar().shown}>
          ${(peer) => html`<${StageButton} id=${peer.id} class="lattice-call-face-button"><${Face} id=${peer.id} size=${26} /><//>`}
        <//>
        <${Show} when=${() => bar().more}>
          <span class="lattice-call-more" title=${() => names(call.peers().slice(bar().shown.length).map((peer) => peer.name))}
            >+${() => bar().more}</span
          >
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
        <button class="lattice-call-button lattice-call-hang-up" title="hang up" aria-label="hang up" onClick=${hangUp}>
          ${icon("hang-up", 14)}
        </button>
      </span>
    </div>
    <${Show} when=${() => call.get().problem}>
      <p class="lattice-call-problem">${() => call.get().problem}</p>
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
      <${Devices} kind="video" />
    </div>
  </div>`;

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
