import { Room } from "../server/room.ts";
import { TICK } from "../shared/constants.ts";
import { renderTape, startTape } from "./audio";

/**
 * Dev: film the game frame by frame for promo videos. The game server runs inside the page and the page's
 * clock only moves when step() is called, so however slowly frames are grabbed the video plays back at an
 * even 60 fps. Sound is taped against the same clock and rendered at the end.
 */
export function startFilm() {
  let now = performance.now();
  const start = now;
  performance.now = () => now;
  let frames: FrameRequestCallback[] = [];
  window.requestAnimationFrame = (cb) => frames.push(cb);

  let room: Room | null = null;
  const inbox: { ws: FakeSocket; data: string }[] = [];

  /** What Net uses of a WebSocket, connected to the room in this page instead of a server. */
  class FakeSocket {
    static readonly OPEN = 1;
    readyState = 1;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    private readonly player;

    constructor(url: string) {
      const q = new URL(url).searchParams;
      room ??= new Room(q.get("room") ?? "film", { dev: true, bots: true, map: q.get("map") ?? undefined });
      this.player = room.join(q.get("name") ?? "", (m) => inbox.push({ ws: this, data: typeof m === "string" ? m : JSON.stringify(m) }),
        undefined, undefined, { look: q.get("look") ?? "", pid: q.get("pid") ?? "" });
    }

    send(data: string): void {
      room?.onMessage(this.player, JSON.parse(data));
    }

    close(): void {
      this.readyState = 3;
    }
  }
  Object.assign(window, { WebSocket: FakeSocket });
  startTape(() => (now - start) / 1000);

  const canvas = () => [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];

  return {
    /** Seconds filmed so far. */
    time: () => (now - start) / 1000,
    /** Advance the server and the game by whole ticks (1/60 s each). */
    step(ticks = 1): void {
      for (let i = 0; i < ticks; i++) {
        room?.step();
        for (const m of inbox.splice(0)) m.ws.onmessage?.({ data: m.data });
        now += TICK * 1000 + 1e-4; // a hair over one tick, so rounding never skips an update
        const run = frames;
        frames = [];
        for (const cb of run) cb(now);
      }
    },
    /** The frame just drawn, as base64 JPEG. Call in the same task as step(): the canvas isn't preserved. */
    frame: (quality = 0.93) => canvas().toDataURL("image/jpeg", quality).slice("data:image/jpeg;base64,".length),
    /** Everything heard so far, as base64 WAV. */
    async sound(): Promise<string> {
      return wav(await renderTape((now - start) / 1000 + 1));
    },
  };
}

function wav(b: AudioBuffer): string {
  const ch = b.numberOfChannels, n = b.length, bytes = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); bytes.setUint32(4, 36 + n * ch * 2, true); str(8, "WAVEfmt ");
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, ch, true);
  bytes.setUint32(24, b.sampleRate, true); bytes.setUint32(28, b.sampleRate * ch * 2, true);
  bytes.setUint16(32, ch * 2, true); bytes.setUint16(34, 16, true); str(36, "data"); bytes.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch).keys()].map((c) => b.getChannelData(c));
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) bytes.setInt16(44 + (i * ch + c) * 2, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
  let bin = "";
  const u8 = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
