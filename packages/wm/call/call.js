// a call, in a project: everyone in it sees and hears everyone else, over
// webrtc. what's needed to connect (offers, answers, candidates) goes over
// the ephemeral channel of the project's files, the room presence.js is in.
// made from patchwork's call experiment (its call-session.js)
//
// there's one call at a time in a tab, and it carries on as you go from
// project to project, until you hang up. whoever's in one says so every few
// seconds, and straight away when anyone arrives (presence.js's hello), so
// everyone in the room knows there's a call on, in it or not
//
// each pair connects once: the one whose id sorts later offers, with a
// transceiver each for sound, for pictures and for a screen being shared
// (SLOTS), and the other answers. turning a camera on or off, changing mic,
// or sharing your screen swaps the track in those, so nothing's asked again.
// when a connection fails it's dropped, and made again
import { createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { HELLO } from "../presence.js";
import { faceFrom, watchFace } from "./face.js";
import { lasting } from "../lasting.js";
import { callToRejoin, forgetCall, keepCall, leavingCall } from "./rejoin.js";
import { listen } from "./speaking.js";
import { haveModel, isNoise, loadModel, suppressed } from "./noise.js";
import { videoFor } from "./sizes.js";

const KEY = "lattice-wm:call";
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // over tcp too: some networks (schools) let no udp out at all
  {
    urls: ["turn:sync3.automerge.org:3478", "turn:sync3.automerge.org:3478?transport=tcp"],
    username: "inkandswitch",
    credential: "insecure",
  },
];
// saying you're in it
const HERE_EVERY = 3000;
// and forgotten after this long without
const GONE_AFTER = 12000;
// a connection that's only interrupted gets this long to come back
const INTERRUPTED_FOR = 8000;
// arriving: a call heard this soon after is one to ask about
const ARRIVING = 10000;

// what each of a connection's transceivers carries, in the order they're made
const SLOTS = ["audio", "video", "screen"];
const slotOf = (pc, transceiver) => SLOTS[pc.getTransceivers().indexOf(transceiver)];
// a connection's screen's transceiver, or null (one made before there was one)
const screenOf = (pc) => {
  const transceiver = pc.getTransceivers()[SLOTS.indexOf("screen")];
  return transceiver && !transceiver.stopped ? transceiver : null;
};

const string = (value) => (value == null ? "" : String(value));
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

// ── what's remembered, in this browser ──────────────────────────────────

// where faces are: floating over everything, or down the sidebar. and on
// everyone's cursor too, or not, whichever (settings.cursors)
export const FACES = [
  ["floating", "floating"],
  ["sidebar", "in the sidebar"],
];
const SETTINGS_KEY = "lattice-wm:call";
function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return isObject(saved) ? saved : {};
  } catch {
    return {};
  }
}
function writeSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

// ── the state, for anything to show ─────────────────────────────────────
//
// it's the page's (../lasting.js), as the session is: a dev server's changes
// are swapped in by importing this again (lattice/dev-swap.js), and the new
// version shows, and hangs up, the call the old one's in. what an old
// version's set going (its listeners, its timers) carries on running its own
// code till the call ends: changes here are for the next one

const { state, setState, settings, setSettings, heard, setHeard, version, bump, asking, setAsking, current, setCurrent } =
  lasting("lattice-wm:call:state", () => createRoot(() => {
    const saved = readSettings();
    const [state, setState] = createStore({
      // the call you're in: {room, name, id, mic, camera, joining, problem}
      call: null,
      // everyone else in it, by their id: {id, peer, contact, name, colour,
      // avatar, mic, camera, connection}
      peers: {},
    });
    const [settings, setSettings] = createStore({
      faces: saved.faces === "sidebar" ? "sidebar" : "floating",
      // on cursors was a third place for faces, once: it's on, then
      cursors: typeof saved.cursors === "boolean" ? saved.cursors : saved.faces === "cursors",
      camera: string(saved.camera),
      mic: string(saved.mic),
      // what's done about the noise round your voice (noise.js)
      noise: isNoise(saved.noise) ? saved.noise : "browser",
      floating: isObject(saved.floating) ? saved.floating : {},
    });
    // who's heard to be on a call, in each room heard: {[room]: {[id]: {who, at}}}
    const [heard, setHeard] = createStore({});
    // streams change in place: this says they have
    const [version, setVersion] = createSignal(0);
    // a call to ask about: {room, repo, name, at: {x, y}}
    const [asking, setAsking] = createSignal(null);
    // the project you're in, while one's mounted: {room, repo, name}
    const [current, setCurrent] = createSignal(null);
    return {
      state,
      setState,
      settings,
      setSettings,
      heard,
      setHeard,
      version,
      bump: () => setVersion((n) => n + 1),
      asking,
      setAsking,
      current,
      setCurrent,
    };
  }));

function saveSettings() {
  writeSettings({
    faces: call.mode(),
    cursors: call.cursors(),
    camera: settings.camera,
    mic: settings.mic,
    noise: settings.noise,
    floating: settings.floating,
  });
}

// the session: what isn't for showing. {session} so every version of this
// has the same one
const live = lasting("lattice-wm:call:session", () => ({ session: null }));

// whose face fills the panes (their id, or null), and whether it fills the
// screen. a lasting of its own, not more of the state's above: a page that
// swaps in a new version keeps the state it made, with nothing added since
const view = lasting("lattice-wm:call:view", () =>
  createRoot(() => {
    const [stage, setStage] = createSignal(null);
    const [full, setFull] = createSignal(false);
    return { stage, setStage, full, setFull };
  }),
);

// ── who you are ─────────────────────────────────────────────────────────

const myContact = () => {
  const url = string(globalThis.accountDocHandle?.doc()?.contactUrl);
  return isValidAutomergeUrl(url) ? url : "";
};

async function whoAmI(repo) {
  const contactUrl = myContact();
  const who = { contact: contactUrl, name: "anonymous", colour: "", avatar: "" };
  if (!contactUrl) return who;
  try {
    const doc = (await repo.find(contactUrl)).doc();
    const registered = doc?.type === "registered";
    who.name = (registered && string(doc.name)) || "anonymous";
    who.colour = string(doc?.color);
    who.avatar = (registered && string(doc.avatarUrl)) || "";
  } catch {}
  return who;
}

// what someone said of themselves
function whoFrom(value) {
  if (!isObject(value)) return null;
  return {
    contact: isValidAutomergeUrl(string(value.contact)) ? string(value.contact) : "",
    name: string(value.name).slice(0, 200) || "anonymous",
    colour: string(value.colour).slice(0, 100),
    avatar: isValidAutomergeUrl(string(value.avatar)) ? string(value.avatar) : "",
  };
}

// ── hearing who's on a call in a room, in it or not ─────────────────────

const listening = new Map(); // room url → {count, off}
let pruning = null;

function prune() {
  const now = Date.now();
  for (const [room, people] of Object.entries(heard)) {
    for (const [id, person] of Object.entries(people ?? {})) {
      if (now - person.at > GONE_AFTER) setHeard(room, id, undefined);
    }
  }
}

/**
 * hear the calls in `room` (a handle), while it's mounted. returns a way to
 * stop. `onArrive` hears about a call that's on as you arrive (once)
 */
export function hearCalls(room, onArrive) {
  const url = room.url;
  const since = Date.now();
  let told = false;
  function onMessage(event) {
    const message = event.message;
    if (!isObject(message) || !(KEY in message)) return;
    const from = string(message.from);
    if (!from || from === live.session?.id) return;
    if (message[KEY] === "bye") {
      setHeard(url, from, undefined);
      return;
    }
    if (message[KEY] !== "here") return;
    const who = whoFrom(message.who);
    if (!who) return;
    if (!heard[url]) setHeard(url, {});
    setHeard(url, from, { who, peer: string(event.senderId), mic: !!message.mic, camera: !!message.camera, at: Date.now() });
    if (!told && onArrive && Date.now() - since < ARRIVING) {
      told = true;
      onArrive();
    }
  }
  room.on("ephemeral-message", onMessage);
  pruning ??= setInterval(prune, 2000);
  const entry = listening.get(url) ?? { count: 0 };
  entry.count++;
  listening.set(url, entry);
  return () => {
    room.off("ephemeral-message", onMessage);
    entry.count--;
    if (entry.count === 0) listening.delete(url);
    if (!listening.size) {
      clearInterval(pruning);
      pruning = null;
    }
  };
}

/** who's on a call in the room at `url`, apart from you: [{id, who, peer, mic, camera}] */
export function onCallIn(url) {
  return Object.entries(heard[url] ?? {})
    .filter(([id, person]) => person && id !== state.call?.id)
    .map(([id, { who, peer, mic, camera }]) => ({ id, who, peer, mic, camera }));
}

// ── the project you're in, and asking ───────────────────────────────────

/** the project that's mounted: {room, repo, name}, while it is */
export function inProject(project) {
  setCurrent(project);
  // the page was reloaded in a call here: back in it, as you were
  const back = !live.session && project?.room ? callToRejoin(project.room.url) : null;
  if (back) {
    forgetCall();
    join(project, { video: back.camera }).then(() => {
      if (!back.mic) setMic(false);
    });
  }
  return () => {
    if (current() === project) setCurrent(null);
  };
}

/**
 * ask whether to call (or join one) in `project` ({room, repo, name}), or
 * the one you're in: `at` is where the question goes ({x, y}, its top
 * left), and `focus` whether it's to be answered now (it was asked for)
 */
export function ask(project = current(), { at = null, focus = false } = {}) {
  if (project) setAsking({ ...project, at, focus });
}

// ── media ───────────────────────────────────────────────────────────────

// the mic's processing, said outright rather than left to the browser:
// echo cancelling and levelling always, its noise suppression only when
// it's what's chosen (DeepFilterNet wants the mic as it is)
const constraint = (kind, device, noiseSuppression) => {
  const picked = device ? { deviceId: { exact: device } } : {};
  if (kind !== "audio") return device ? picked : true;
  return { ...picked, echoCancellation: true, autoGainControl: true, noiseSuppression };
};

async function getTrack(kind, { noiseSuppression = true } = {}) {
  const device = kind === "audio" ? settings.mic : settings.camera;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ [kind]: constraint(kind, device, noiseSuppression) });
    return stream.getTracks()[0] ?? null;
  } catch (error) {
    // the one picked isn't there any more: any will do
    if (device && error?.name === "OverconstrainedError") {
      try {
        const any = constraint(kind, "", noiseSuppression);
        return (await navigator.mediaDevices.getUserMedia({ [kind]: any })).getTracks()[0] ?? null;
      } catch {}
    }
    console.warn(`[wm] no ${kind}`, error);
    return null;
  }
}

// your mic, the noise round it dealt with as settings.noise says. with
// DeepFilterNet not downloaded yet, it's the browser's suppression till it
// is: it's downloaded meanwhile, and then the mic's taken again (refreshMic)
async function getAudio() {
  const mode = settings.noise;
  if (mode !== "deepfilternet") return getTrack("audio", { noiseSuppression: mode === "browser" });
  if (!(await haveModel())) {
    loadModel().then(
      () => settings.noise === "deepfilternet" && refreshMic(),
      (error) => console.warn("[wm] couldn't get DeepFilterNet", error),
    );
    return getTrack("audio", { noiseSuppression: true });
  }
  const raw = await getTrack("audio", { noiseSuppression: false });
  if (!raw) return null;
  try {
    return await suppressed(raw, {
      // this computer can't keep up: the browser's, then
      onOverload: () => {
        if (!live.session) return;
        setState("call", "problem", "DeepFilterNet's too much for this computer: using the browser's");
        setNoise("browser");
      },
    });
  } catch (error) {
    console.warn("[wm] couldn't start DeepFilterNet", error);
    raw.stop();
    if (live.session) setState("call", "problem", "couldn't start DeepFilterNet: using the browser's");
    return getTrack("audio", { noiseSuppression: true });
  }
}

// your mic taken again (a different one, or dealt with differently), in
// place of the one you had, muted or not as that was
async function refreshMic() {
  const now = live.session;
  if (!now || state.call?.joining) return;
  // the old one goes first: chrome gives a second track on a mic the first
  // one's processing, whatever it asks for, so the new one would come with
  // the browser's noise suppression still on (or still off). there's a
  // moment's quiet, as it's swapped
  trackOf("audio")?.stop();
  const track = await getAudio();
  if (live.session !== now || !track) return track?.stop();
  track.enabled = state.call.mic;
  useTrack("audio", track);
}

/** what's done about the noise round your voice: "browser", "deepfilternet" or "none" (noise.js) */
export function setNoise(mode) {
  if (!isNoise(mode) || settings.noise === mode) return;
  setSettings("noise", mode);
  saveSettings();
  // downloaded now, chosen out of a call, so it's ready for the next
  if (mode === "deepfilternet" && !live.session) loadModel().catch(() => {});
  refreshMic();
}

const trackOf = (kind) => live.session?.local.getTracks().find((track) => track.kind === kind) ?? null;

// put `track` (or none) in as yours of its kind, everywhere it goes
function useTrack(kind, track) {
  const old = trackOf(kind);
  if (old === track) return;
  if (old) {
    live.session.local.removeTrack(old);
    old.stop();
  }
  if (track) live.session.local.addTrack(track);
  if (kind === "video") watchMine(track);
  if (kind === "audio") listenMine(track);
  for (const peer of live.session.peers.values()) {
    for (const transceiver of peer.pc.getTransceivers()) {
      if (slotOf(peer.pc, transceiver) === kind && !transceiver.stopped) {
        transceiver.sender.replaceTrack(track).catch((error) => console.warn("[wm] couldn't swap a track", error));
      }
    }
  }
  bump();
}

// whether you're speaking, from your mic (speaking.js)
function listenMine(track) {
  const now = live.session;
  now.stopLevel?.();
  now.stopLevel = null;
  setState("call", "speaking", false);
  if (!track) return;
  now.stopLevel = listen(new MediaStream([track]), (speaking) => {
    if (live.session === now) setState("call", "speaking", speaking);
  }, "me");
}

// your face, in your camera's pictures (face.js), while it's on: said to
// everyone as it moves
function watchMine(track) {
  live.session.stopFace?.();
  live.session.stopFace = null;
  setState("call", "face", null);
  if (!track) return;
  live.session.stopFace = watchFace(new MediaStream([track]), (face) => {
    if (!live.session) return;
    setState("call", "face", face);
    send({ [KEY]: "face", face });
  });
}

// ── joining, and hanging up ─────────────────────────────────────────────

/**
 * join the call in `room` (a handle, from `repo`), or start one: `video`
 * says whether with your camera. `name` is the project's, for showing
 */
export async function join({ room, repo, name = "" }, { video = false } = {}) {
  if (live.session?.room.url === room.url) return;
  hangUp();
  const id = crypto.randomUUID();
  const now = {
    id,
    room,
    repo,
    local: new MediaStream(),
    peers: new Map(),
    pendingIce: new Map(),
    who: { contact: myContact(), name: "anonymous", colour: "", avatar: "" },
    timers: [],
    dead: false,
  };
  live.session = now;
  setState({ call: { room: room.url, name, id, mic: true, camera: !!video, joining: true, problem: null }, peers: {} });

  // your name and face, when your contact's found: it's said again then,
  // if it wasn't in time to say at first
  const who = whoAmI(repo).then((who) => {
    if (now.dead) return;
    now.who = who;
    bump();
    sayHere();
  });
  const [audio, camera] = await Promise.all([
    getAudio(),
    video ? getTrack("video") : null,
    Promise.race([who, new Promise((resolve) => setTimeout(resolve, 800))]),
  ]);
  if (now.dead) {
    audio?.stop();
    camera?.stop();
    return;
  }
  if (audio) now.local.addTrack(audio);
  if (camera) now.local.addTrack(camera);
  if (camera) watchMine(camera);
  if (audio) listenMine(audio);
  const problem = !audio ? (video && !camera ? "no mic or camera" : "no mic") : video && !camera ? "no camera" : null;
  setState("call", { joining: false, camera: !!camera, mic: !!audio, problem });
  bump();

  // what's set going is kept with the session, so any version of this can
  // stop it (see the state, above)
  now.onMessage = onMessage;
  room.on("ephemeral-message", now.onMessage);
  sayHere();
  // whoever's been heard on it already: no waiting till they say so again
  for (const person of onCallIn(room.url)) onHere(person.id, person.peer, person);
  now.timers.push(setInterval(sayHere, HERE_EVERY));
  now.timers.push(setInterval(forgetGone, GONE_AFTER / 3));
  // the page going (a reload, say): you're back in it if it's back soon
  now.onPageHide = () => hangUp({ rejoin: true });
  addEventListener("pagehide", now.onPageHide);
  rememberCall();
}

/**
 * leave the call you're in. `rejoin`: it's the page going, so it's to be
 * joined again if the page comes back soon (rejoin.js)
 */
export function hangUp({ rejoin = false } = {}) {
  const now = live.session;
  if (!now) return;
  now.dead = true;
  live.session = null;
  if (rejoin === true) leavingCall();
  else forgetCall();
  removeEventListener("pagehide", now.onPageHide);
  now.timers.forEach(clearInterval);
  now.room.off("ephemeral-message", now.onMessage);
  try {
    now.room.broadcast({ [KEY]: "bye", from: now.id });
  } catch {}
  for (const id of [...now.peers.keys()]) drop(id, now);
  now.stopFace?.();
  now.stopLevel?.();
  for (const track of now.local.getTracks()) track.stop();
  now.screen?.stop();
  view.setStage(null);
  view.setFull(false);
  setState({ call: null, peers: {} });
  bump();
}

// the call you're in, as it is now, kept in the tab for after a reload
function rememberCall() {
  const call = state.call;
  if (!live.session || !call || call.joining) return;
  keepCall({ room: call.room, camera: call.camera, mic: call.mic });
}

/** your mic, on or off */
export function setMic(on) {
  if (!live.session || state.call?.joining) return;
  const track = trackOf("audio");
  if (on && !track) {
    getAudio().then((track) => {
      if (!live.session || !track) return setState("call", "problem", "no mic");
      useTrack("audio", track);
      setState("call", { mic: true, problem: null });
      sayHere();
      rememberCall();
    });
    return;
  }
  if (track) track.enabled = on;
  setState("call", "mic", on && !!track);
  sayHere();
  rememberCall();
}

/** your camera, on or off: off, it's let go of (its light goes out) */
export async function setCamera(on) {
  if (!live.session || state.call?.joining) return;
  if (!on) {
    useTrack("video", null);
    setState("call", "camera", false);
    sayHere();
    rememberCall();
    return;
  }
  const now = live.session;
  const track = await getTrack("video");
  if (live.session !== now) return track?.stop();
  if (!track) return setState("call", "problem", "no camera");
  useTrack("video", track);
  setState("call", { camera: true, problem: null });
  sayHere();
  rememberCall();
}

/** which mic or camera ("audio" or "video") to use: a device id, or "" for any */
export async function setDevice(kind, device) {
  setSettings(kind === "audio" ? "mic" : "camera", string(device));
  saveSettings();
  if (!live.session) return;
  if (kind === "video" && !state.call?.camera) return;
  if (kind === "audio") return refreshMic();
  const now = live.session;
  const track = await getTrack(kind);
  if (live.session !== now || !track) return track?.stop();
  useTrack(kind, track);
}

/** the mics and cameras there are: {audio: [{id, label}], video: [...]} */
export async function devices() {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const of = (kind) =>
    all
      .filter((device) => device.kind === kind && device.deviceId)
      .map((device, at) => ({ id: device.deviceId, label: device.label || `${kind === "audioinput" ? "mic" : "camera"} ${at + 1}` }));
  return { audio: of("audioinput"), video: of("videoinput") };
}

/** how faces are shown: "cursors", "floating" or "sidebar" */
export function setFaces(faces) {
  setSettings("faces", faces);
  saveSettings();
}

/** faces on everyone's cursors too, or not */
export function setCursors(on) {
  setSettings("cursors", !!on);
  saveSettings();
}

/** where someone's floating face is (`key`: call.floatKey's): fractions of the window */
export function setFloating(key, at) {
  setSettings("floating", key, at);
  saveSettings();
}

/** someone's floating face (`key`) put away, or (`at`: where) back */
export function hideFloating(key) {
  setFloating(key, { ...call.settings.floating[key], hidden: true });
}
export function showFloating(key, at) {
  setFloating(key, { ...call.settings.floating[key], ...at, hidden: false });
}

// ── reading it ──────────────────────────────────────────────────────────

export const call = {
  /** the call you're in, or null: {room, name, id, mic, camera, face, joining, problem} */
  get: () => state.call,
  /** everyone else in it: [{id, peer, contact, name, colour, avatar, mic, camera, face, connection}] */
  peers: () => Object.values(state.peers).filter(Boolean),
  /** someone's pictures and sound (read in an effect: it says when they change) */
  stream(id) {
    version();
    return live.session?.peers.get(id)?.stream ?? null;
  },
  /** someone's screen, while they're sharing it (`id`, or "me"), or null */
  screen(id) {
    version();
    const now = live.session;
    if (!now) return null;
    if (id === "me") {
      if (!now.screen) return null;
      if (now.screenView?.getTracks()[0] !== now.screen) now.screenView = new MediaStream([now.screen]);
      return now.screenView;
    }
    return state.peers[id]?.screen ? (now.peers.get(id)?.screen ?? null) : null;
  },
  /** yours */
  local() {
    version();
    return live.session && state.call?.camera ? live.session.local : null;
  },
  /** who you are in it */
  me: () => (live.session ? { ...live.session.who } : null),
  settings,
  /** where faces are: "floating" or "sidebar" */
  mode: () => (settings.faces === "sidebar" ? "sidebar" : "floating"),
  /** whether faces are on cursors too (a page from before has it as a mode) */
  cursors: () => settings.cursors ?? settings.faces === "cursors",
  /** what someone's floating face is kept by: who they are, so it's theirs next call too */
  floatKey: (id) => (id === "me" ? "me" : state.peers[id]?.contact || id),
  asking,
  current,
  stopAsking: () => setAsking(null),
  /** whose face fills the panes (one still in the call), or null */
  stage: () => {
    const id = view.stage();
    return id && state.peers[id] ? id : null;
  },
  /** whether it fills the screen */
  full: () => view.full() && !!call.stage(),
  /**
   * the one in your call who's `person` from presence ({peer, contact}): by
   * the tab they're in, or else by who they are
   */
  find(person) {
    const peers = call.peers();
    return (
      peers.find((peer) => person.peer && peer.peer === person.peer) ??
      peers.find((peer) => person.contact && peer.contact === person.contact) ??
      null
    );
  },
};

// ── sharing your screen ─────────────────────────────────────────────────

/** whether there's a screen to share, here */
export const canShare = () => !!navigator.mediaDevices?.getDisplayMedia;

/** share a screen (the browser asks which), to everyone in the call */
export async function startScreen() {
  const now = live.session;
  if (!now || now.screen || state.call?.joining) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
  } catch {
    // not picked
    return;
  }
  const track = stream.getVideoTracks()[0];
  if (live.session !== now || !track) return stream.getTracks().forEach((track) => track.stop());
  // it's to be read: kept sharp rather than smooth
  track.contentHint = "detail";
  // the browser's own "stop sharing"
  track.addEventListener("ended", () => now.screen === track && stopScreen());
  now.screen = track;
  for (const [id, peer] of now.peers) {
    const transceiver = screenOf(peer.pc);
    if (transceiver) transceiver.sender.replaceTrack(track).catch((error) => console.warn("[wm] couldn't share", error));
    // a connection from before there was room for a screen: made again
    else lost(id);
  }
  setState("call", "screen", true);
  bump();
  sayHere();
}

/** stop sharing your screen */
export function stopScreen() {
  const now = live.session;
  const track = now?.screen;
  if (!track) return;
  now.screen = null;
  for (const peer of now.peers.values()) screenOf(peer.pc)?.sender.replaceTrack(null).catch(() => {});
  track.stop();
  setState("call", "screen", false);
  bump();
  sayHere();
}

// ── who's big ───────────────────────────────────────────────────────────

/** fill the panes with `id`'s face, or, theirs already, put the panes back */
export function toggleStage(id) {
  const now = view.stage() === id ? null : id;
  view.setStage(now);
  if (!now) view.setFull(false);
}

/** `id`'s face filling the panes, and the screen too if `full` */
export function showStage(id, { full = false } = {}) {
  view.setStage(id);
  view.setFull(!!full);
}

/** the face that's big, filling the screen or not */
export function setFull(full) {
  view.setFull(!!full && !!view.stage());
}

/** nobody big */
export function closeStage() {
  view.setStage(null);
  view.setFull(false);
}

// how much of your camera's sent, for how many are in the call (sizes.js):
// past a handful, smaller and slower, so it goes to all of them
function tuneVideo() {
  const now = live.session;
  if (!now) return;
  const wanted = videoFor(now.peers.size + 1);
  for (const peer of now.peers.values()) {
    for (const transceiver of peer.pc.getTransceivers()) {
      // (a screen's sent as it is: it's to be read)
      if (slotOf(peer.pc, transceiver) !== "video" || transceiver.stopped) continue;
      const sender = transceiver.sender;
      const parameters = sender.getParameters();
      // none till it's been negotiated: it's tuned when it's connected
      const encoding = parameters.encodings?.[0];
      if (!encoding) continue;
      for (const key of ["maxBitrate", "scaleResolutionDownBy", "maxFramerate"]) {
        if (wanted) encoding[key] = wanted[key];
        else delete encoding[key];
      }
      sender.setParameters(parameters).catch((error) => console.warn("[wm] couldn't tune video", error));
    }
  }
}

// ── talking ─────────────────────────────────────────────────────────────

function send(message) {
  if (!live.session || live.session.dead) return;
  try {
    live.session.room.broadcast({ ...message, from: live.session.id });
  } catch (error) {
    console.warn("[wm] couldn't say", message[KEY], error);
  }
}

// who you are, and your mic and camera: in what you say
const about = () => ({
  who: live.session.who,
  mic: !!state.call?.mic,
  camera: !!state.call?.camera,
  screen: !!live.session?.screen,
  face: state.call?.camera ? (state.call.face ?? null) : null,
});

function sayHere() {
  if (!live.session || state.call?.joining) return;
  send({ [KEY]: "here", ...about() });
}

function forgetGone() {
  const now = Date.now();
  for (const [id, peer] of live.session?.peers ?? []) {
    if (now - peer.heard > GONE_AFTER) drop(id);
  }
}

function onMessage(event) {
  const message = event.message;
  if (!live.session || !isObject(message)) return;
  // someone's arriving: say you're here, so they know there's a call on
  if (message[HELLO]) {
    setTimeout(sayHere, Math.random() * 200);
    return;
  }
  if (!(KEY in message)) return;
  // the tab they're in, as presence knows it
  const peer = string(event.senderId);
  const from = string(message.from);
  if (!from || from === live.session.id) return;
  if (message.to && message.to !== live.session.id) return;
  switch (message[KEY]) {
    case "here":
      return onHere(from, peer, message);
    case "bye":
      return drop(from);
    case "face":
      return showPeer(from, { face: faceFrom(message.face) });
    case "again":
      // they lost us: start again
      drop(from);
      return onHere(from, peer, message);
    case "offer":
      onOffer(from, message);
      // what they said of themselves with it
      return onHere(from, peer, message);
    case "answer":
      return onAnswer(from, message);
    case "ice":
      return onIce(from, message);
  }
}

// ── connections ─────────────────────────────────────────────────────────

const offers = (theirs) => live.session.id > theirs;

function showPeer(id, fields) {
  if (!live.session?.peers.has(id)) return;
  setState("peers", id, (had) => ({ ...(had ?? { id }), ...fields }));
}

function onHere(from, tab, message) {
  const who = whoFrom(message.who);
  if (!who) return;
  let peer = live.session.peers.get(from);
  if (!peer && offers(from)) peer = connect(from, crypto.randomUUID());
  const fields = { ...who, peer: tab, mic: !!message.mic, camera: !!message.camera, face: faceFrom(message.face), screen: !!message.screen };
  if (peer) {
    peer.heard = Date.now();
    const was = !!state.peers[from]?.screen;
    showPeer(from, fields);
    if (fields.screen !== was) onSharing(from, fields.screen);
  } else {
    // they'll offer: until they do, they're on the call, connecting
    live.session.waiting ??= new Map();
    live.session.waiting.set(from, fields);
  }
}

// someone's started sharing their screen: it fills the panes, unless
// someone's there already. stopped, it's put back, if that's what put it there
function onSharing(id, sharing) {
  const now = live.session;
  if (sharing && !view.stage()) {
    view.setStage(id);
    now.shown = id;
  } else if (!sharing && now.shown === id) {
    now.shown = null;
    if (view.stage() === id) closeStage();
  }
  bump();
}

// a connection to `id`, made fresh: `conn` is which one (the offerer's
// pick), so what's said about an old one is left alone
function connect(id, conn) {
  drop(id);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const stream = new MediaStream();
  const audio = new Audio();
  audio.autoplay = true;
  audio.srcObject = stream;
  const peer = { id, conn, pc, stream, audio, heard: Date.now(), interrupted: null };
  live.session.peers.set(id, peer);
  setState("peers", id, { id, connection: "connecting", ...(live.session.waiting?.get(id) ?? {}) });
  live.session.waiting?.delete(id);

  pc.ontrack = (event) => {
    // their screen's, when they share it: a stream of its own
    if (slotOf(pc, event.transceiver) === "screen") {
      peer.screen ??= new MediaStream();
      if (!peer.screen.getTrackById(event.track.id)) peer.screen.addTrack(event.track);
      event.track.onunmute = bump;
      bump();
      return;
    }
    if (!stream.getTrackById(event.track.id)) stream.addTrack(event.track);
    // who's speaking: theirs, once there's sound to hear
    if (event.track.kind === "audio" && !peer.stopLevel) {
      peer.stopLevel = listen(stream, (speaking) =>
        showPeer(id, speaking ? { speaking, spoke: Date.now() } : { speaking }),
        id,
      );
    }
    event.track.onunmute = bump;
    audio.play().catch(() => {});
    bump();
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) send({ [KEY]: "ice", to: id, conn, candidate: event.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    const now = pc.connectionState;
    clearTimeout(peer.interrupted);
    if (now === "connected") {
      showPeer(id, { connection: "connected" });
      tuneVideo();
    }
    else if (now === "disconnected") {
      showPeer(id, { connection: "interrupted" });
      peer.interrupted = setTimeout(() => pc.connectionState === "disconnected" && lost(id), INTERRUPTED_FOR);
    } else if (now === "failed") lost(id);
  };

  if (offers(id)) {
    for (const slot of SLOTS) {
      const transceiver = pc.addTransceiver(slot === "audio" ? "audio" : "video", { direction: "sendrecv" });
      const track = slot === "screen" ? live.session.screen : trackOf(slot);
      if (track) transceiver.sender.replaceTrack(track);
    }
    pc.onnegotiationneeded = async () => {
      try {
        if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription();
        send({ [KEY]: "offer", to: id, conn, sdp: pc.localDescription.toJSON(), ...about() });
      } catch (error) {
        console.warn("[wm] couldn't offer", error);
      }
    };
  }
  return peer;
}

// a connection that's failed: let it go, and start again (the one who
// offers does that on hearing them next; the other asks them to)
function lost(id) {
  const peer = live.session?.peers.get(id);
  if (!peer) return;
  const offering = offers(id);
  drop(id);
  if (!offering) send({ [KEY]: "again", to: id, ...about() });
}

function drop(id, from = live.session) {
  const peer = from?.peers.get(id);
  from?.pendingIce.delete(id);
  if (!peer) {
    if (from === live.session) setState("peers", id, undefined);
    return;
  }
  from.peers.delete(id);
  clearTimeout(peer.interrupted);
  try {
    peer.pc.close();
  } catch {}
  peer.audio.srcObject = null;
  peer.stopLevel?.();
  if (from === live.session) {
    setState("peers", id, undefined);
    if (view.stage() === id) {
      view.setStage(null);
      view.setFull(false);
    }
    bump();
    tuneVideo();
  }
}

async function onOffer(from, { conn, sdp }) {
  if (offers(from) || !isObject(sdp) || sdp.type !== "offer" || typeof sdp.sdp !== "string") return;
  let peer = live.session.peers.get(from);
  if (!peer || peer.conn !== conn) peer = connect(from, string(conn));
  const { pc } = peer;
  try {
    await pc.setRemoteDescription(sdp);
    for (const transceiver of pc.getTransceivers()) {
      const kind = transceiver.receiver.track?.kind;
      if (!kind) continue;
      transceiver.direction = "sendrecv";
      const slot = slotOf(pc, transceiver) ?? kind;
      await transceiver.sender.replaceTrack(slot === "screen" ? (live.session.screen ?? null) : trackOf(kind));
    }
    await pc.setLocalDescription();
    send({ [KEY]: "answer", to: from, conn, sdp: pc.localDescription.toJSON() });
    await addPendingIce(peer);
  } catch (error) {
    console.warn("[wm] couldn't answer", error);
  }
}

async function onAnswer(from, { conn, sdp }) {
  const peer = live.session.peers.get(from);
  if (!peer || peer.conn !== conn || !isObject(sdp) || sdp.type !== "answer") return;
  if (peer.pc.signalingState !== "have-local-offer") return;
  try {
    await peer.pc.setRemoteDescription(sdp);
    await addPendingIce(peer);
  } catch (error) {
    console.warn("[wm] couldn't take their answer", error);
  }
}

// candidates can come before what they're for: kept till it's in
async function onIce(from, { conn, candidate }) {
  if (!isObject(candidate)) return;
  const peer = live.session.peers.get(from);
  if (!peer || peer.conn !== conn || !peer.pc.remoteDescription) {
    const pending = live.session.pendingIce.get(from) ?? [];
    pending.push({ conn, candidate });
    live.session.pendingIce.set(from, pending.slice(-50));
    return;
  }
  try {
    await peer.pc.addIceCandidate(candidate);
  } catch (error) {
    console.warn("[wm] couldn't take a candidate", error);
  }
}

async function addPendingIce(peer) {
  const pending = live.session?.pendingIce.get(peer.id) ?? [];
  live.session?.pendingIce.set(
    peer.id,
    pending.filter((ice) => ice.conn !== peer.conn),
  );
  for (const { candidate } of pending.filter((ice) => ice.conn === peer.conn)) {
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch {}
  }
}
