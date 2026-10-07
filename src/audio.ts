/** Synthesised sounds, so there are no audio files to license or load. */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export function unlockAudio(): void {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
}

function env(g: GainNode, peak: number, decay: number): void {
  const t = ctx!.currentTime;
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

export function gunshot(): void {
  if (!ctx || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.1;
  const band = ctx.createBiquadFilter();
  band.type = "lowpass";
  band.frequency.value = 2600;
  const g = ctx.createGain();
  env(g, 0.5, 0.16);
  src.connect(band).connect(g).connect(ctx.destination);
  src.start();
  src.stop(ctx.currentTime + 0.2);

  const thump = ctx.createOscillator();
  thump.frequency.setValueAtTime(140, ctx.currentTime);
  thump.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.1);
  const tg = ctx.createGain();
  env(tg, 0.5, 0.12);
  thump.connect(tg).connect(ctx.destination);
  thump.start();
  thump.stop(ctx.currentTime + 0.13);
}

export function hitSound(head: boolean): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = head ? "triangle" : "square";
  o.frequency.value = head ? 1750 : 900;
  const g = ctx.createGain();
  env(g, head ? 0.25 : 0.08, head ? 0.25 : 0.05);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.3);
}

export function click(): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.frequency.value = 320;
  const g = ctx.createGain();
  env(g, 0.08, 0.04);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.05);
}
