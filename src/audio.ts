/** Synthesised sounds, so there are no audio files to license or load. */
let live: AudioContext | null = null;
let ctx: BaseAudioContext | null = null; // live, or an offline context while a tape is rendered
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
let master = 0.8;

export function unlockAudio(): void {
  if (tape) return;
  if (!live) {
    ctx = live = new AudioContext();
    out = ctx.createGain();
    out.gain.value = master;
    out.connect(ctx.destination);
  }
  if (live.state === "suspended") void live.resume();
  if (!noise) noise = whiteNoise(live);
}

function whiteNoise(c: BaseAudioContext): AudioBuffer {
  const b = c.createBuffer(1, c.sampleRate * 1.2, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// Dev, filming frame by frame: the page's clock only moves when a frame is shot, so live sound can't keep
// up. Sounds are written to a tape with their time instead, and renderTape() plays it into a buffer.
let tape: { t: number; name: string; args: unknown[] }[] | null = null;
let tapeClock = () => 0;
let at = 0; // while rendering a tape: when the sound being scheduled starts
const taped = (name: string, args: unknown[]) => (tape ? (tape.push({ t: tapeClock(), name, args }), true) : false);

export function startTape(clock: () => number): void {
  tape = [];
  tapeClock = clock;
}

export async function renderTape(seconds: number, rate = 48000): Promise<AudioBuffer> {
  const entries = tape ?? [];
  tape = null;
  const off = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const saved = { ctx, out, noise };
  ctx = off;
  out = off.createGain();
  out.gain.value = master;
  out.connect(off.destination);
  noise = whiteNoise(off);
  const sounds: Record<string, (...a: never[]) => void> = {
    gunshot, hitSound, click, footstep, beep, explosion, roundEnd, levelUpSound, actClick,
  };
  for (const e of entries) {
    at = e.t;
    sounds[e.name](...(e.args as never[]));
  }
  at = 0;
  const buffer = await off.startRendering();
  ({ ctx, out, noise } = saved);
  return buffer;
}

/** Dev: the game's sound as a stream, for recording footage with audio. */
export function audioTrack(): MediaStreamTrack | null {
  if (!live || !out) return null;
  const dest = live.createMediaStreamDestination();
  out.connect(dest);
  return dest.stream.getAudioTracks()[0];
}

export function setVolume(v: number): void {
  master = v;
  if (out) out.gain.value = v;
}

function env(g: GainNode, peak: number, decay: number, delay = 0): void {
  const t = ctx!.currentTime + at + delay;
  g.gain.setValueAtTime(0.0001, ctx!.currentTime + at);
  g.gain.setValueAtTime(Math.max(peak, 0.0002), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

function burst(volume: number, cutoff: number, decay: number, rate = 0.85, type: BiquadFilterType = "lowpass", delay = 0): void {
  const src = ctx!.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = rate + Math.random() * 0.08;
  const f = ctx!.createBiquadFilter();
  f.type = type;
  f.frequency.value = cutoff;
  const g = ctx!.createGain();
  env(g, volume, decay, delay);
  src.connect(f).connect(g).connect(out!);
  src.start(ctx!.currentTime + at + delay);
  src.stop(ctx!.currentTime + at + delay + decay + 0.05);
}

function tone(volume: number, from: number, to: number, decay: number, type: OscillatorType = "sine", delay = 0): void {
  const o = ctx!.createOscillator();
  o.type = type;
  const t = ctx!.currentTime + at + delay;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + decay);
  const g = ctx!.createGain();
  env(g, volume, decay, delay);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + decay + 0.02);
}

/** weapon: id in WEAPONS; volume: 1 for our own gun, lower for other players' shots by distance. */
export function gunshot(weapon: number, volume = 1): void {
  if (taped("gunshot", [weapon, volume])) return;
  if (!ctx || !noise) return;
  if (weapon === 1) { // pistol: short and sharp
    burst(0.45 * volume, 4200, 0.09, 1.1);
    tone(0.35 * volume, 220, 60, 0.07);
  } else if (weapon === 2) { // sniper: a heavy crack with a long tail, then the bolt
    burst(0.7 * volume, 3200, 0.12, 0.9);
    burst(0.35 * volume, 900, 0.9, 0.5);
    tone(0.7 * volume, 110, 30, 0.3);
    if (volume === 1) bolt();
  } else if (weapon === 3) { // SMG: light and quick
    burst(0.38 * volume, 3400, 0.09, 1.0);
    tone(0.3 * volume, 180, 70, 0.06);
  } else if (weapon === 4) { // shotgun: a deep boom, then the pump
    burst(0.8 * volume, 1800, 0.3, 0.6);
    tone(0.8 * volume, 90, 35, 0.25);
    if (volume === 1) {
      burst(0.15, 1500, 0.06, 1.2, "bandpass", 0.45);
      burst(0.15, 2200, 0.06, 1.4, "bandpass", 0.6);
    }
  } else if (weapon === 5) { // knife: a swish through the air
    burst(0.3 * volume, 1800, 0.16, 1.2, "bandpass");
    burst(0.18 * volume, 3600, 0.1, 1.5, "bandpass", 0.04);
  } else {
    burst(0.5 * volume, 2600, 0.16, 0.8);
    tone(0.5 * volume, 140, 40, 0.12);
  }
}

function bolt(): void {
  burst(0.12, 2500, 0.04, 1.4, "bandpass", 0.45);
  burst(0.14, 3000, 0.05, 1.6, "bandpass", 0.75);
}

export function hitSound(head: boolean): void {
  if (taped("hitSound", [head])) return;
  if (!ctx) return;
  tone(head ? 0.25 : 0.08, head ? 1750 : 900, head ? 1700 : 880, head ? 0.25 : 0.05, head ? "triangle" : "square");
}

export function click(): void {
  if (taped("click", [])) return;
  if (!ctx) return;
  tone(0.08, 320, 300, 0.04);
}

/** One footstep: a soft scuff and thud, quieter with distance. */
export function footstep(volume: number): void {
  if (taped("footstep", [volume])) return;
  if (!ctx || !noise || volume < 0.02) return;
  burst(0.22 * volume, 700 + Math.random() * 300, 0.07, 0.6);
  tone(0.18 * volume, 90, 50, 0.06);
}

/** The planted bomb's beep. */
export function beep(volume: number): void {
  if (taped("beep", [volume])) return;
  if (!ctx || volume < 0.02) return;
  tone(0.25 * volume, 1900, 1850, 0.07, "square");
}

/** volume by distance; a deep boom with a long rumble. */
export function explosion(volume: number): void {
  if (taped("explosion", [volume])) return;
  if (!ctx || !noise) return;
  burst(1.2 * volume, 1800, 0.25, 0.7);
  burst(0.9 * volume, 400, 1.6, 0.35);
  tone(1.1 * volume, 90, 25, 0.9);
}

/** Round over: a rising pair of notes for a win, a falling pair for a loss. */
export function roundEnd(won: boolean): void {
  if (taped("roundEnd", [won])) return;
  if (!ctx) return;
  const [a, b] = won ? [520, 780] : [440, 330];
  tone(0.15, a, a, 0.22, "triangle");
  tone(0.15, b, b, 0.4, "triangle", 0.18);
}

/** Level up: a quick rising arpeggio. */
export function levelUpSound(): void {
  if (taped("levelUpSound", [])) return;
  if (!ctx) return;
  [523, 659, 784, 1047].forEach((f, i) => tone(0.13, f, f, 0.25, "triangle", i * 0.09));
}

/** A soft click every half second while planting or defusing. */
export function actClick(): void {
  if (taped("actClick", [])) return;
  if (!ctx) return;
  tone(0.06, 2600, 2400, 0.03, "square");
}
