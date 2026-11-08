// lattice's settings: you (your account: your name, your picture, your
// colour), and the theme (which, for light and for dark, and changing it).
// changing one of the site's themes makes it yours (themes.js), but it's
// still the same theme, by the same name: you're only changing it
import { createSignal, createEffect, createMemo, on, onCleanup, For, Show } from "solid-js";
import html from "solid-js/html";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { createDoc } from "./knitoutjs/core/patchwork-docs.js";

const string = (value) => (value == null ? "" : String(value));
const isUrl = (value) => isValidAutomergeUrl(string(value));

// patchwork's presence colours (the account package's palette)
const COLOURS = [
  ["sky", "hsl(200, 70%, 50%)"],
  ["coral", "hsl(10, 75%, 58%)"],
  ["emerald", "hsl(145, 70%, 45%)"],
  ["violet", "hsl(270, 70%, 55%)"],
  ["amber", "hsl(38, 85%, 50%)"],
  ["rose", "hsl(350, 70%, 55%)"],
  ["teal", "hsl(178, 70%, 45%)"],
  ["indigo", "hsl(235, 70%, 58%)"],
  ["lime", "hsl(85, 70%, 45%)"],
  ["fuchsia", "hsl(310, 70%, 55%)"],
  ["orange", "hsl(25, 80%, 52%)"],
  ["cyan", "hsl(188, 75%, 48%)"],
];
const colourFor = (url) =>
  COLOURS[[...url].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COLOURS.length][1];

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

// what can be changed of a theme. its colours are its palette's: a lattice
// theme's own (everything else in it comes from those), or the studio's
const TYPE = [
  { key: "--studio-family-ui", label: "ui font" },
  { key: "--text-editor-family", label: "editor font" },
  { key: "--studio-font-size", label: "text size" },
];
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
const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
function hexOf(colour) {
  if (!colour) return "#000000";
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = colour;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

const computed = (key) =>
  getComputedStyle(document.documentElement).getPropertyValue(key).replace(/\s+/g, " ").trim();

/**
 * the settings, in `props`: account (the account doc's handle), repo, hive,
 * themes (themes.js's)
 */
export function SettingsPage(props) {
  const { account, repo, hive, themes } = props;

  // ── you ────────────────────────────────────────────────────────────────

  const [accountDoc, setAccountDoc] = createSignal(account.doc());
  const readAccount = () => setAccountDoc(account.doc());
  account.on("change", readAccount);
  onCleanup(() => account.off("change", readAccount));
  const contactUrl = () => (isUrl(accountDoc()?.contactUrl) ? string(accountDoc().contactUrl) : null);

  const [contact, setContact] = createSignal(null);
  const [me, setMe] = createSignal(null);
  createEffect(
    on(contactUrl, (url) => {
      setContact(null);
      setMe(null);
      if (!url) return;
      let live = true;
      let handle = null;
      const read = () => live && setMe(handle.doc() ?? null);
      repo.find(url).then((found) => {
        if (!live) return;
        handle = found;
        setContact(found);
        read();
        found.on("change", read);
      });
      onCleanup(() => {
        live = false;
        handle?.off("change", read);
      });
    }),
  );
  const registered = () => me()?.type === "registered";

  const [newName, setNewName] = createSignal("");
  async function makeAccount(event) {
    event.preventDefault();
    const name = newName().trim();
    if (!name) return;
    let handle = contact();
    if (!handle) {
      handle = await createDoc(repo, { "@patchwork": { type: "contact" }, type: "anonymous" }, hive);
      account.change((doc) => {
        doc.contactUrl = handle.url;
      });
    }
    handle.change((doc) => {
      doc.type = "registered";
      doc.name = name;
      if (!doc.color) doc.color = colourFor(handle.url);
    });
  }

  function rename(name) {
    name = name.trim();
    if (!name || name === me()?.name) return;
    contact()?.change((doc) => {
      doc.name = name;
    });
  }

  let pictureInput;
  const [picturing, setPicturing] = createSignal(null);
  async function takePicture(file) {
    if (!file) return;
    setPicturing("making it…");
    try {
      const image = await createDoc(
        repo,
        { content: await squared(file), mimeType: "image/webp", name: file.name, extension: "webp" },
        hive,
      );
      contact()?.change((doc) => {
        doc.avatarUrl = image.url;
      });
      setPicturing(null);
    } catch (error) {
      console.error("[lattice] couldn't use that picture", error);
      setPicturing("couldn't use that picture");
    }
  }

  function You() {
    return html`<section class="lattice-settings-section">
      <h2>you</h2>
      <${Show}
        when=${registered}
        fallback=${html`<form class="lattice-setting" onSubmit=${makeAccount}>
            <label class="lattice-settings-label" for="lattice-new-name">name</label>
            <input
              id="lattice-new-name"
              value=${newName}
              placeholder="what people see you as"
              autocomplete="name"
              onInput=${(event) => setNewName(event.currentTarget.value)}
            />
            <button class="lattice-button" disabled=${() => !newName().trim()}>make my account</button>
          </form>
          <p class="lattice-settings-hint">so people see who's here, and who changed what</p>`}
      >
        <div class="lattice-setting lattice-setting-picture">
          <span class="lattice-settings-label">picture</span>
          <${Show} when=${contactUrl}>
            <patchwork-view class="lattice-settings-avatar" doc-url=${contactUrl} tool-id="contact-avatar"></patchwork-view>
          <//>
          <button class="lattice-button" disabled=${() => picturing() === "making it…"} onClick=${() => pictureInput.click()}>
            ${() => (me()?.avatarUrl ? "another" : "pick one")}
          </button>
          <${Show} when=${() => me()?.avatarUrl}>
            <button
              class="lattice-button"
              onClick=${() =>
                contact()?.change((doc) => {
                  delete doc.avatarUrl;
                })}
            >
              none
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
          <${Show} when=${picturing}><span class="lattice-settings-hint">${picturing}</span><//>
        </div>
        <label class="lattice-setting">
          <span class="lattice-settings-label">name</span>
          <input
            value=${() => me()?.name ?? ""}
            autocomplete="name"
            onChange=${(event) => rename(event.currentTarget.value)}
            onKeyDown=${(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        </label>
        <div class="lattice-setting">
          <span class="lattice-settings-label">colour</span>
          <span class="lattice-swatches" role="radiogroup" aria-label="your colour">
            <${For} each=${COLOURS}>
              ${([name, value]) => html`<button
                class="lattice-swatch"
                role="radio"
                style=${{ "--swatch": value }}
                aria-checked=${() => String(me()?.color === value)}
                aria-label=${name}
                title=${name}
                onClick=${() =>
                  contact()?.change((doc) => {
                    doc.color = value;
                  })}
              ></button>`}
            <//>
          </span>
        </div>
      <//>
    </section>`;
  }

  // ── the theme ──────────────────────────────────────────────────────────

  function Choice(choiceProps) {
    const which = choiceProps.which;
    // its own kind first, then the rest
    const options = createMemo(() => {
      const all = themes.themes();
      const fits = (theme) => !theme.colorScheme || theme.colorScheme === which;
      return [...all.filter(fits), ...all.filter((theme) => !fits(theme))];
    });
    const label = (theme) => `${theme.name}${theme.own?.changed ? " (edited)" : ""}`;
    return html`<label class="lattice-setting">
      <span class="lattice-settings-label">${which}</span>
      <select
        disabled=${() => !themes.ready()}
        onChange=${(event) => themes.choose(which, event.currentTarget.value)}
      >
        <${For} each=${options}>
          ${(theme) => html`<option value=${theme.id} selected=${() => themes.chosen()[which] === theme.id}>
            ${() => label(theme)}
          </option>`}
        <//>
      </select>
      <${Show} when=${() => themes.mode() === which}>
        <span class="lattice-settings-hint">now</span>
      <//>
    </label>`;
  }

  // the theme showing now, and what you've changed of it
  const showing = () => themes.themes().find((theme) => theme.id === themes.chosen()[themes.mode()]);

  function Changes() {
    const url = () => showing()?.own?.url ?? null;
    const [doc, setDoc] = createSignal(null);
    // what the page has now, once the theme's been put on it again
    const [tick, setTick] = createSignal(0);
    createEffect(
      on(url, (url) => {
        setDoc(null);
        if (!url) return;
        let live = true;
        let handle = null;
        let timer = null;
        const read = () => {
          if (!live) return;
          setDoc({ handle, value: handle.doc() });
          clearTimeout(timer);
          timer = setTimeout(() => setTick((n) => n + 1), 80);
        };
        repo.find(url).then((found) => {
          if (!live) return;
          handle = found;
          read();
          found.on("change", read);
        });
        onCleanup(() => {
          live = false;
          clearTimeout(timer);
          handle?.off("change", read);
        });
      }),
    );
    const now = (key) => (tick(), themes.chosen(), computed(key));
    const changed = (key) => string(doc()?.value?.variables?.[key]);
    const colours = () => (now("--lattice-window") ? LATTICE_COLOURS : STUDIO_COLOURS);

    function set(key, value) {
      doc()?.handle.change((theme) => {
        theme.variables ??= {};
        if (string(value).trim()) theme.variables[key] = value;
        else delete theme.variables[key];
      });
    }
    // a colour as it's dragged: written now and then, and when it's let go
    let colourTimer = null;
    function colour(key, value, done) {
      clearTimeout(colourTimer);
      if (done) return set(key, value);
      colourTimer = setTimeout(() => set(key, value), 120);
    }
    onCleanup(() => clearTimeout(colourTimer));

    return html`<${Show}
      when=${() => doc()?.handle}
      fallback=${html`<div class="lattice-setting">
        <span class="lattice-settings-label"></span>
        <button class="lattice-button" disabled=${() => !themes.ready()} onClick=${() => themes.edit(themes.mode())}>
          edit
        </button>
      </div>`}
    >
      <${For} each=${TYPE}>
        ${(field) => html`<label class="lattice-setting">
          <span class="lattice-settings-label">${field.label}</span>
          <input
            value=${() => changed(field.key)}
            placeholder=${() => now(field.key)}
            spellcheck="false"
            onChange=${(event) => set(field.key, event.currentTarget.value)}
            onKeyDown=${(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        </label>`}
      <//>
      <div class="lattice-setting">
        <span class="lattice-settings-label">colours</span>
        <span class="lattice-colours">
          <${For} each=${colours}>
            ${(field) => html`<label class="lattice-colour" title=${() => `${field.label}${changed(field.key) ? " (edited)" : ""}`}>
              <input
                type="color"
                value=${() => hexOf(now(field.key))}
                onInput=${(event) => colour(field.key, event.currentTarget.value, false)}
                onChange=${(event) => colour(field.key, event.currentTarget.value, true)}
              />
              <span>${field.label}</span>
            </label>`}
          <//>
        </span>
      </div>
      <div class="lattice-setting">
        <span class="lattice-settings-label"></span>
        <button
          class="lattice-button"
          disabled=${() => !showing()?.own?.changed}
          onClick=${() =>
            doc()?.handle.change((theme) => {
              theme.variables = {};
            })}
        >
          as it was
        </button>
      </div>
    <//>`;
  }

  function Theme() {
    return html`<section class="lattice-settings-section">
      <h2>theme</h2>
      <${Choice} which="light" />
      <${Choice} which="dark" />
      <${Changes} />
    </section>`;
  }

  return html`<div class="lattice-settings">
    <h1>settings</h1>
    <${You} />
    <${Theme} />
  </div>`;
}
