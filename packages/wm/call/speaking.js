// who's speaking: how loud each stream's sound is, a few times a second,
// and whether that's speaking (sizes.js says when it is). one AudioContext
// for the page; a stream from a peer is heard here while its <audio> plays
// it too (chrome only lets it through to one then)
import { levelOf, speakingStep } from "./sizes.js";

const EVERY = 100;
let context = null;

/** hear `stream`'s sound: `onChange(speaking)` as it starts and stops. returns a way to stop */
export function listen(stream, onChange) {
  if (!stream?.getAudioTracks().length) return () => {};
  let source;
  let analyser;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") context.resume().catch(() => {});
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
  } catch (error) {
    console.warn("[wm] can't hear who's speaking", error);
    return () => {};
  }
  const samples = new Uint8Array(analyser.fftSize);
  let state = { speaking: false, loudSince: null, quietSince: null };
  const timer = setInterval(() => {
    // a page that's not been touched yet has its sound held back
    if (context.state === "suspended") return void context.resume().catch(() => {});
    analyser.getByteTimeDomainData(samples);
    const was = state.speaking;
    state = speakingStep(state, levelOf(samples), Date.now());
    if (state.speaking !== was) onChange(state.speaking);
  }, EVERY);
  return () => {
    clearInterval(timer);
    try {
      source.disconnect();
    } catch {}
  };
}
