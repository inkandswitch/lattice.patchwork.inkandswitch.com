// lattice's `get(url, as)`: what's at a url, as a pattern reads it (from
// knitfold's given.ts and fetcher.ts). a pattern can't wait, so, as with
// `doc()`, a get the run wasn't given suspends it: the page fetches it
// (buildRounds, graph.js), adds it to the graph's `gets`, and runs the
// pattern again with it. a literal `get("…")` is fetched before the first run
// (buildGraph), so it needn't wait for one.
//
// the worker and the page both load this: the worker for what a pattern's
// handed (a Picture, a Sound), the page for the fetching. nothing's touched
// until it's called, so node can load it too

export const GET_AS = ["bytes", "text", "json", "clever"];

// a get's key in the graph's `gets`: how it's asked for, and the url as written
export const getKey = (url, as) => `${as} ${url}`;

// what `get(url, as)` was asked, checked: {url, as}, or a TypeError
export function getArgs(url, as = "clever") {
  if (typeof url !== "string") throw new TypeError("get(url): the url's a string");
  if (!GET_AS.includes(as)) throw new TypeError(`get(url, as): as is ${GET_AS.map((a) => `"${a}"`).join(", ")}`);
  return { url, as };
}

// an image's pixels (an image, got clever-ly), as a pattern wants them: what
// colour's at x, y, and how light. x and y are the picture's own (0, 0 at
// its top left), and past its edges it's its edges
export class Picture {
  constructor(image) {
    this.width = image.width;
    this.height = image.height;
    this.data = image.data;
  }
  #index(x, y) {
    const px = Math.min(this.width - 1, Math.max(0, Math.floor(x)));
    const py = Math.min(this.height - 1, Math.max(0, Math.floor(y)));
    return (px + py * this.width) * 4;
  }
  /** [red, green, blue, alpha], each 0 to 255 */
  at(x, y) {
    const i = this.#index(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  /** how light it is, 0 (black) to 1 (white): see-through is white */
  light(x, y) {
    const [r, g, b, a] = this.at(x, y);
    // (in whole numbers: so white's 1, not nearly)
    const lum = (2126 * r + 7152 * g + 722 * b) / 2_550_000;
    return lum * (a / 255) + (1 - a / 255);
  }
}

// a sound (got clever-ly): its samples, one channel, and how many a second.
// what's at a moment, and how loud a pitch is there (a spectrogram's a
// power for each moment and pitch)
export class Sound {
  constructor(sound) {
    this.sampleRate = sound.sampleRate;
    this.samples = sound.samples;
  }
  /** how long it is, in seconds */
  get duration() {
    return this.samples.length / this.sampleRate;
  }
  /** the sample at a moment (in seconds): -1 to 1 */
  at(seconds) {
    return this.samples[Math.floor(seconds * this.sampleRate)] ?? 0;
  }
  /** how loud hz is around a moment (in seconds), 0 to 1: a sine that fills
   * the sound's 1. listened for over `window` samples (more hears pitches
   * apart better, fewer moments) */
  power(seconds, hz, window = 1024) {
    // (goertzel's: one pitch's, not all of them, as an fft would)
    const start = Math.floor(seconds * this.sampleRate - window / 2);
    const k = (2 * Math.PI * hz) / this.sampleRate;
    const coefficient = 2 * Math.cos(k);
    let s1 = 0;
    let s2 = 0;
    let weights = 0;
    for (let n = 0; n < window; n++) {
      // (hann's window: so the edges don't ring)
      const weight = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (window - 1));
      weights += weight;
      const s0 = (this.samples[start + n] ?? 0) * weight + coefficient * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const real = s1 - s2 * Math.cos(k);
    const imaginary = s2 * Math.sin(k);
    return (2 * Math.hypot(real, imaginary)) / weights;
  }
}

const isSoundData = (value) =>
  !!value && typeof value === "object" && value.samples instanceof Float32Array && typeof value.sampleRate === "number";

const isImageData = (value) =>
  !!value && typeof value === "object" && value.data instanceof Uint8ClampedArray && typeof value.width === "number";

// what a pattern's handed for a value got: pixels a Picture, samples a
// Sound (they come over from the page as plain data), anything else itself
export const madeOf = (value) =>
  isImageData(value) ? new Picture(value) : isSoundData(value) ? new Sound(value) : value;

// ── the page's side: fetching

// what's been fetched (or is being), by key, so a build after this one, or
// the next probe, needn't fetch it again. a failed one's tried again next
// time. the latest few are kept
const KEPT = 32;
const fetched = new Map();

// what `get(url, as)` gets: {value, url, fetchedAt} (the url it was fetched
// from, and when, for the build's sources) or {error: message}. a relative
// url is from the page's address
export function fetchGet(url, as) {
  const key = getKey(url, as);
  const known = fetched.get(key);
  if (known) {
    fetched.delete(key);
    fetched.set(key, known);
    return known;
  }
  const what = `get(${JSON.stringify(url)}${as === "clever" ? "" : `, ${JSON.stringify(as)}`})`;
  const got = (async () => {
    let address;
    try {
      address = new URL(url, globalThis.location?.href);
    } catch {
      return { error: `${what}: that's not a url` };
    }
    try {
      const response = await fetch(address);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
      const fetchedAt = Date.now();
      return { value: await decode(response, as), url: address.href, fetchedAt };
    } catch (error) {
      return { error: `${what}: ${error instanceof Error ? error.message : String(error)}` };
    }
  })();
  fetched.set(key, got);
  got.then((result) => "error" in result && fetched.get(key) === got && fetched.delete(key));
  while (fetched.size > KEPT) fetched.delete(fetched.keys().next().value);
  return got;
}

// ── a response, as it's asked to be

async function decode(response, as) {
  if (as === "bytes") return new Uint8Array(await response.arrayBuffer());
  if (as === "text") return response.text();
  if (as === "json") return response.json();
  // clever: what its type says it is
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/json" || type.endsWith("+json")) return response.json();
  if (type.startsWith("image/")) return pixelsOf(await response.blob());
  if (type.startsWith("audio/") || type === "application/ogg") return soundOf(await response.arrayBuffer());
  if (type === "text/csv") return rowsOf(await response.text(), ",");
  if (type === "text/tab-separated-values") return rowsOf(await response.text(), "\t");
  if (type.startsWith("text/") || type.endsWith("+xml") || type === "application/xml" || type.includes("javascript")) {
    return response.text();
  }
  // (or, if it doesn't say: what it looks like. text that's json is json,
  // other text is text; anything else, its bytes)
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (type && type !== "application/octet-stream") return bytes;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes;
  }
  if (/^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      // (it's text, then)
    }
  }
  return text;
}

// an image's pixels (an ImageData: it goes to the worker as it is, and the
// worker makes a Picture of it)
async function pixelsOf(blob) {
  let image;
  try {
    image = await createImageBitmap(blob);
  } catch {
    // (an svg: createImageBitmap won't, an <img> will)
    const element = new Image();
    element.src = URL.createObjectURL(blob);
    await element.decode();
    URL.revokeObjectURL(element.src);
    image = element;
  }
  const width = image.width || 1;
  const height = image.height || 1;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

// a sound's samples, one channel (its channels, together), at SAMPLE_RATE:
// up to 11kHz, all a bird sings. (plain things, so it goes to the worker as
// it is, and the worker makes a Sound of it)
const SAMPLE_RATE = 22_050;
async function soundOf(bytes) {
  const decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
  const samples = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const channel = decoded.getChannelData(c);
    for (let i = 0; i < channel.length; i++) samples[i] += channel[i] / decoded.numberOfChannels;
  }
  return { sampleRate: decoded.sampleRate, samples };
}

// a csv's rows, each its cells (quoted cells as they are, "" for a ")
export function rowsOf(text, separator) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === separator) row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}
