import { TICK } from "../shared/constants.ts";
import {
  decodePlayers, INTERP_TICKS, type ClientMsg, type RemotePlayer, type RosterEntry, type ServerMsg, type Snapshot,
} from "../shared/protocol.ts";

const TICK_MS = TICK * 1000;

export class Net {
  id = 0;
  rtt = 0;
  readonly room: string;
  private readonly ws: WebSocket;
  private readonly buffer: { tick: number; players: Map<number, RemotePlayer> }[] = [];
  private offset: number | null = null; // server tick ≈ now / TICK_MS + offset
  onSnap: (s: Snapshot) => void = () => {};
  private readonly roster = new Map<number, RosterEntry>();
  onClose: (reason: string) => void = () => {};
  /** Resolves with our player id once the server has accepted us. */
  readonly ready: Promise<number>;
  private resolveReady: (id: number) => void = () => {};
  private rejectReady: (e: Error) => void = () => {};

  constructor(room: string, name: string) {
    this.room = room;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const q = new URLSearchParams({ room, name });
    this.ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    this.ws.onmessage = (e) => this.receive(JSON.parse(e.data) as ServerMsg);
    this.ws.onclose = () => this.onClose("Disconnected from the server");
    setInterval(() => this.send({ type: "ping", t: performance.now(), rtt: this.rtt }), 2000);
  }

  send(m: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private receive(m: ServerMsg): void {
    if (m.type === "welcome") {
      this.id = m.id;
      this.resolveReady(m.id);
    } else if (m.type === "full") {
      this.rejectReady(new Error("This room is full (10 players)"));
    } else if (m.type === "pong") {
      this.rtt = performance.now() - m.t;
    } else if (m.type === "snap") {
      // Track server time smoothly: late packets shouldn't make other players jump back and forth.
      const sample = m.tick - performance.now() / TICK_MS;
      this.offset = this.offset === null || Math.abs(sample - this.offset) > 30
        ? sample
        : this.offset + (sample - this.offset) * 0.05;
      if (m.r) {
        this.roster.clear();
        for (const e of m.r) this.roster.set(e[0], e);
      }
      const players = decodePlayers(m.p, this.roster);
      this.buffer.push({ tick: m.tick, players: new Map(players.map((p) => [p.id, p])) });
      while (this.buffer.length > 40) this.buffer.shift();
      this.onSnap({ tick: m.tick, you: m.you, players, events: m.events });
    }
  }

  /** The (fractional) server tick other players are drawn at; also what our shots are judged against. */
  viewTick(): number {
    return this.offset === null ? 0 : performance.now() / TICK_MS + this.offset - INTERP_TICKS;
  }

  /** Other players interpolated between the two snapshots around viewTick. */
  others(): RemotePlayer[] {
    const t = this.viewTick();
    const b = this.buffer;
    if (!b.length) return [];
    let i = b.length - 1;
    while (i > 0 && b[i - 1].tick > t) i--;
    const next = b[i], prev = b[Math.max(0, i - 1)];
    const k = next.tick === prev.tick ? 1 : Math.max(0, Math.min(1, (t - prev.tick) / (next.tick - prev.tick)));
    const out: RemotePlayer[] = [];
    for (const n of next.players.values()) {
      if (n.id === this.id) continue;
      const p = prev.players.get(n.id);
      if (!p || !p.alive || !n.alive) { out.push(n); continue; }
      let dy = n.yaw - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // shortest way round
      out.push({ ...n, x: p.x + (n.x - p.x) * k, y: p.y + (n.y - p.y) * k, z: p.z + (n.z - p.z) * k,
        yaw: p.yaw + dy * k, pitch: p.pitch + (n.pitch - p.pitch) * k, crouched: k < 0.5 ? p.crouched : n.crouched });
    }
    return out;
  }

  /** Latest known state of everyone, including us (scoreboard). */
  latest(): RemotePlayer[] {
    return [...(this.buffer.at(-1)?.players.values() ?? [])];
  }
}
