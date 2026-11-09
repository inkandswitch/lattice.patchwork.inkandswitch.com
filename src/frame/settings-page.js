// lattice's settings: you (your name, your picture, your colour), and the
// theme (which, and changing it). there's one page whether you've an account
// or not: changing any of you makes it, the first time. changing one of the
// site's themes makes it yours (themes.js), but it's still the same theme, by
// the same name: you're only changing it
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import html from "solid-js/html";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { useDocument } from "./vendor/solid-automerge.js";
import { createDoc } from "../../packages/wm/patchwork/docs.js";
import { icon } from "../../packages/wm/ui/icons.js";
import { themeValue } from "./themes.js";
import { ThemePreview } from "./theme-preview.js";
import { fonts, firstFamily } from "./fonts.js";
import { COLOURS, colourFor, MOUSE, POINTER_PATH } from "./pointer.js";

const string = (value) => (value == null ? "" : String(value));
const isUrl = (value) => isValidAutomergeUrl(string(value));

// a picture, made square (the middle of it) and small
const PICTURE = 256;
async function squared(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(PICTURE, side);
  const canvas = new OffscreenCanvas(size, size);
  canvas
    .getContext("2d")
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  return new Uint8Array(await blob.arrayBuffer());
}

// what can be changed of a theme. a font's one of the ones here; the ones
// without a variable of their own fall back to another of the theme's
const FONTS = [
  { key: "--studio-family-ui", label: "ui font" },
  { key: "--lattice-heading-family", label: "heading font", from: "--studio-family-code" },
  { key: "--editor-family-code", label: "editor font" },
];
const EDITOR_SIZE = "--text-editor-font-size";
// the fonts, in the picker: lattice's own, then the ones on this computer
const FONT_GROUPS = [
  ["lattice", true],
  ["on this computer", false],
];
// its colours are its palette's: a lattice theme's own (everything else in
// it comes from those), or the studio's
const LATTICE_COLOURS = [
  { key: "--lattice-window", label: "window" },
  { key: "--lattice-chrome", label: "chrome" },
  { key: "--lattice-ink", label: "ink" },
  { key: "--lattice-accent", label: "accent" },
];
const STUDIO_COLOURS = [
  { key: "--studio-fill", label: "window" },
  { key: "--studio-chrome-fill", label: "chrome" },
  { key: "--studio-line", label: "ink" },
  { key: "--studio-primary", label: "accent" },
];

// a css colour as #rrggbb, for a colour input
let probe = null;
function hexOf(colour) {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!colour) return "#000000";
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = colour;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

// whether alt's held: the colours are mice then
const [alt, setAlt] = createSignal(false);
let altWatchers = 0;
const readAlt = (event) => setAlt(!!event.altKey);
const dropAlt = () => setAlt(false);
function watchAlt() {
  if (!altWatchers++) {
    addEventListener("keydown", readAlt, true);
    addEventListener("keyup", readAlt, true);
    addEventListener("pointermove", readAlt, { capture: true, passive: true });
    addEventListener("blur", dropAlt);
  }
  onCleanup(() => {
    if (--altWatchers) return;
    removeEventListener("keydown", readAlt, true);
    removeEventListener("keyup", readAlt, true);
    removeEventListener("pointermove", readAlt, true);
    removeEventListener("blur", dropAlt);
    setAlt(false);
  });
}

// a pointer, in a colour. or, with alt held, a mouse
function Pointer() {
  return html`<svg class="lattice-pointer" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
    <path d=${POINTER_PATH} />
  </svg>`;
}
function Mouse() {
  const { tail, body, ear, inner, eye, nose } = MOUSE;
  return html`<svg class="lattice-mouse" viewBox="0 0 20 16" width="22" height="18" aria-hidden="true">
    <path class="lattice-mouse-tail" d=${tail} />
    <path d=${body} />
    <circle cx=${ear[0]} cy=${ear[1]} r=${ear[2]} />
    <circle class="lattice-mouse-ear" cx=${inner[0]} cy=${inner[1]} r=${inner[2]} />
    <circle class="lattice-mouse-eye" cx=${eye[0]} cy=${eye[1]} r=${eye[2]} />
    <circle class="lattice-mouse-nose" cx=${nose[0]} cy=${nose[1]} r=${nose[2]} />
  </svg>`;
}

/**
 * the settings, in `props`: account (the account doc's handle), accountDoc
 * (its live view), repo, hive, themes (themes.js's useThemes), pointer
 * ({kind(), set(kind)}: whether your mouse is an arrow or a mouse)
 */
export function SettingsPage(props) {
  const { account, accountDoc, repo, hive, themes, pointer } = props;

  // ── you ────────────────────────────────────────────────────────────────

  const contactUrl = () => (isUrl(accountDoc.contactUrl) ? string(accountDoc.contactUrl) : undefined);
  const [me, contact] = useDocument(contactUrl, { repo });

  // your contact, made if you've none yet
  let making = null;
  async function myContact() {
    const url = contactUrl();
    if (url) return contact() ?? repo.find(url);
    making ??= createDoc(repo, { "@patchwork": { type: "contact" }, type: "anonymous" }, hive).then((handle) => {
      handle.change((doc) => {
        doc.color = colourFor(handle.url);
      });
      account.change((doc) => {
        doc.contactUrl = handle.url;
      });
      return handle;
    });
    return making;
  }
  const changeMe = async (change) => (await myContact()).change(change);

  // a name makes you someone (and not anonymous)
  function rename(name, done) {
    if (done) name = name.trim();
    changeMe((doc) => {
      if (string(doc.name) !== name) doc.name = name;
      if (name.trim() && doc.type !== "registered") doc.type = "registered";
    });
  }

  let pictureInput;
  const [picturing, setPicturing] = createSignal(null);
  async function takePicture(file) {
    if (!file) return;
    setPicturing("uploading…");
    try {
      const image = await createDoc(
        repo,
        { content: await squared(file), mimeType: "image/webp", name: file.name, extension: "webp" },
        hive,
      );
      await changeMe((doc) => {
        doc.avatarUrl = image.url;
      });
      setPicturing(null);
    } catch (error) {
      console.error("[lattice] couldn't use that picture", error);
      setPicturing("couldn't use that picture");
    }
  }

  const myColour = () => string(me()?.color) || (contactUrl() ? colourFor(contactUrl()) : null);
  watchAlt();

  // the picture's how you change it; the × on its corner takes it away
  function You() {
    return html`<section class="lattice-settings-section">
      <h2>you</h2>
      <div class="lattice-you">
        <div class="lattice-you-face" aria-busy=${() => String(picturing() === "uploading…")}>
          <button
            class="lattice-you-picture"
            title=${() => (me()?.avatarUrl ? "upload another picture" : "upload a picture")}
            disabled=${() => picturing() === "uploading…"}
            onClick=${() => pictureInput.click()}
          >
            <${Show} when=${contactUrl} fallback=${html`<span class="lattice-you-nobody">${icon("plus", 16)}</span>`}>
              <patchwork-view doc-url=${contactUrl} tool-id="contact-avatar"></patchwork-view>
            <//>
          </button>
          <${Show} when=${() => me()?.avatarUrl}>
            <button
              class="lattice-you-unpicture"
              title="remove your picture"
              aria-label="remove your picture"
              onClick=${() =>
                changeMe((doc) => {
                  delete doc.avatarUrl;
                })}
            >
              ${icon("close", 9)}
            </button>
          <//>
          <input
            type="file"
            accept="image/*"
            hidden
            ref=${(el) => (pictureInput = el)}
            onChange=${(event) => {
              const [file] = event.currentTarget.files;
              event.currentTarget.value = "";
              takePicture(file);
            }}
          />
        </div>
        <div class="lattice-you-says">
          <input
            class="lattice-you-name"
            value=${() => string(me()?.name)}
            placeholder="your name"
            aria-label="your name"
            autocomplete="name"
            spellcheck="false"
            onInput=${(event) => rename(event.currentTarget.value, false)}
            onChange=${(event) => rename(event.currentTarget.value, true)}
            onKeyDown=${(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
          <${Show} when=${picturing}><p class="lattice-settings-hint">${picturing}</p><//>
        </div>
      </div>
      <div class="lattice-setting">
        <span class="lattice-settings-label">colour</span>
        <span class="lattice-mice" role="radiogroup" aria-label="your colour" data-mice=${() => (alt() ? "" : undefined)}>
          <${For} each=${COLOURS}>
            ${([name, value]) => html`<button
              class="lattice-mouse-button"
              role="radio"
              style=${{ "--mouse": value }}
              aria-checked=${() => String(myColour() === value)}
              aria-label=${name}
              title=${() => `${name}${alt() ? " · a mouse" : ""}`}
              onClick=${(event) => {
                // with alt held, your mouse is a mouse
                pointer.set(event.altKey ? "mouse" : "arrow");
                changeMe((doc) => {
                  doc.color = value;
                });
              }}
            >
              ${() => (alt() || (pointer.kind() === "mouse" && myColour() === value) ? Mouse() : Pointer())}
            </button>`}
          <//>
        </span>
      </div>
    </section>`;
  }

  // ── the theme ──────────────────────────────────────────────────────────

  function Cards() {
    return html`<div class="lattice-theme-cards" role="radiogroup" aria-label="theme">
      <${For} each=${themes.themes}>
        ${(theme) => html`<button
          class="lattice-theme-card"
          role="radio"
          aria-checked=${() => String(themes.chosenId() === theme.id)}
          disabled=${() => !themes.ready()}
          onClick=${() => themes.choose(theme.id)}
        >
          <${ThemePreview} id=${theme.id} />
          <span class="lattice-theme-name">
            ${() => theme.name}
            <${Show} when=${() => theme.own && theme.changed()}><small>edited</small><//>
          </span>
        </button>`}
      <//>
    </div>`;
  }

  // a font of yours, from the ones here, or the theme's own
  function FontField(field) {
    const { own, key, label, from } = field;
    const value = () => string(own.variables()[key]);
    const theirs = createMemo(() => {
      const base = own.base();
      return firstFamily(themeValue(base, key) || (from ? themeValue(base, from) : "")) || "default";
    });
    // one that's set but isn't here goes on the end, so it's still what's shown
    const listed = () => fonts().some((font) => font.stack === value());
    return html`<label class="lattice-setting">
      <span class="lattice-settings-label">${label}</span>
      <select
        class="lattice-font-select"
        style=${() => ({ "font-family": value() || "inherit" })}
        onChange=${(event) => own.set(key, event.currentTarget.value, { now: true })}
      >
        <option value="" selected=${() => !value()}>${() => `the theme's · ${theirs()}`}</option>
        <${For} each=${FONT_GROUPS}>
          ${([label, brought]) => html`<optgroup label=${label}>
            <${For} each=${() => fonts().filter((font) => font.brought === brought)}>
              ${(font) => html`<option
                value=${font.stack}
                style=${{ "font-family": font.stack }}
                selected=${() => value() === font.stack}
              >
                ${font.name}
              </option>`}
            <//>
          </optgroup>`}
        <//>
        <${Show} when=${() => value() && !listed()}>
          <option value=${value} selected>${() => firstFamily(value())}</option>
        <//>
      </select>
    </label>`;
  }

  function Edit(own) {
    const colours = createMemo(() => (themeValue(own.base(), "--lattice-window") ? LATTICE_COLOURS : STUDIO_COLOURS));
    // what the theme had, under anything of yours
    const theirs = (key) => themeValue(own.base(), key);
    const size = () => parseFloat(string(own.variables()[EDITOR_SIZE])) || "";

    return html`<div class="lattice-theme-edit">
      <${For} each=${FONTS}>${(field) => FontField({ own, ...field })}<//>
      <label class="lattice-setting">
        <span class="lattice-settings-label">editor size</span>
        <span class="lattice-size">
          <input
            type="number"
            min="8"
            max="32"
            step="1"
            value=${size}
            placeholder=${() => parseFloat(theirs("--editor-font-size")) || 14}
            onChange=${(event) => {
              const n = parseFloat(event.currentTarget.value);
              own.set(EDITOR_SIZE, n > 0 ? `${n}px` : "", { now: true });
            }}
          />
          px
        </span>
      </label>
      <div class="lattice-setting">
        <span class="lattice-settings-label">colours</span>
        <span class="lattice-colours">
          <${For} each=${colours}>
            ${(field) => html`<label
              class="lattice-colour"
              title=${() => `${field.label}${own.variables()[field.key] ? " (changed)" : ""}`}
            >
              <input
                type="color"
                value=${() => hexOf(string(own.variables()[field.key]) || theirs(field.key))}
                onInput=${(event) => own.set(field.key, event.currentTarget.value)}
              />
              <span>${field.label}</span>
            </label>`}
          <//>
        </span>
      </div>
      <${Reset} own=${own} />
    </div>`;
  }

  // putting the theme back how it came: off on its own, away from what
  // you'd be pressing, and it asks first (keep's where the focus goes)
  function Reset(props) {
    const own = props.own;
    const [asking, setAsking] = createSignal(false);
    let button;
    const done = (reset) => {
      if (reset) own.reset();
      setAsking(false);
      if (!reset) queueMicrotask(() => button?.focus());
    };
    return html`<div
      class="lattice-theme-reset"
      onKeyDown=${(event) => event.key === "Escape" && asking() && done(false)}
    >
      <${Show}
        when=${asking}
        fallback=${html`<button
          class="lattice-reset"
          ref=${(el) => (button = el)}
          disabled=${() => !own.changed()}
          title=${() => (own.changed() ? `undo all your changes to ${own.name}` : "nothing's changed")}
          onClick=${() => setAsking(true)}
        >
          reset
        </button>`}
      >
        <span class="lattice-reset-ask" role="status">${() => `reset ${own.name}? your changes to it go`}</span>
        <button class="lattice-button" ref=${(el) => queueMicrotask(() => el.focus())} onClick=${() => done(false)}>keep</button>
        <button class="lattice-button lattice-button-danger" onClick=${() => done(true)}>reset</button>
      <//>
    </div>`;
  }

  const [editing, setEditing] = createSignal(false);
  function Theme() {
    const own = () => themes.chosen()?.own && themes.chosen();
    return html`<section class="lattice-settings-section">
      <h2>theme</h2>
      <${Cards} />
      <${Show}
        when=${own}
        keyed=${true}
        fallback=${html`<button
          class="lattice-button lattice-theme-edit-button"
          disabled=${() => !themes.ready() || editing()}
          onClick=${async () => {
            setEditing(true);
            try {
              await themes.edit();
            } finally {
              setEditing(false);
            }
          }}
        >
          ${icon("pencil", 12)} edit
        </button>`}
      >
        ${(theme) => Edit(theme)}
      <//>
    </section>`;
  }

  return html`<div class="lattice-settings">
    <h1>settings</h1>
    <${You} />
    <${Theme} />
  </div>`;
}
