/**
 * Bots over real WebSockets: each sends 60 commands/s (moving, turning, shooting) and measures how
 * long the server takes to acknowledge them. Run against a server started with MAX_PER_IP raised:
 *
 *   MAX_PER_IP=1000 PORT=8081 node server/main.ts
 *   node scripts/loadtest.ts ws://localhost:8081 10 10 20     # rooms, players per room, seconds
 */
import WebSocket from "ws";
import type { ServerMsg } from "../shared/protocol.ts";

const [url = "ws://localhost:8081", roomsArg = "1", perRoomArg = "10", secondsArg = "15"] = process.argv.slice(2);
const rooms = Number(roomsArg), perRoom = Number(perRoomArg), seconds = Number(secondsArg);
const acks: number[] = [];
const sockets: WebSocket[] = [];

function bot(room: number, n: number): void {
  const ws = new WebSocket(`${url}/ws?room=load-${room}&name=bot${n}`);
  sockets.push(ws);
  const sent = new Map<number, number>();
  let seq = 0, yaw = Math.random() * 6;
  ws.on("message", (data) => {
    const m = JSON.parse(String(data)) as ServerMsg;
    if (m.type === "welcome") {
      setInterval(() => {
        seq++;
        yaw += (Math.random() - 0.5) * 0.2;
        sent.set(seq, performance.now());
        ws.send(JSON.stringify({ type: "input", viewTick: 0, cmd: {
          seq, forward: Math.random() < 0.8 ? 1 : 0, right: Math.random() < 0.5 ? 1 : -1, yaw, pitch: 0,
          jump: Math.random() < 0.02, crouch: false, walk: false, fire: Math.random() < 0.3, reload: false, slot: 0, aim: false, use: false } }));
      }, 1000 / 60);
    } else if (m.type === "snap") {
      const t = sent.get(m.you.lastSeq);
      if (t !== undefined) acks.push(performance.now() - t);
      for (const s of sent.keys()) if (s <= m.you.lastSeq) sent.delete(s);
    }
  });
}

for (let r = 0; r < rooms; r++) for (let p = 0; p < perRoom; p++) bot(r, p);
console.log(`${rooms * perRoom} bots in ${rooms} rooms for ${seconds} s...`);
await new Promise((r) => setTimeout(r, 3000));
await fetch(url.replace("ws", "http") + "/healthz"); // reset the tick stats after joining
acks.length = 0;
await new Promise((r) => setTimeout(r, seconds * 1000));
const health = await (await fetch(url.replace("ws", "http") + "/healthz")).json();
acks.sort((a, b) => a - b);
const q = (p: number) => acks[Math.floor(acks.length * p)]?.toFixed(1);
console.log(`ack latency ms: p50 ${q(0.5)}  p95 ${q(0.95)}  p99 ${q(0.99)}  max ${acks.at(-1)?.toFixed(1)}  (${acks.length} samples)`);
console.log(`server: ${health.players} players, tick avg ${health.tickAvgMs} ms, max ${health.tickMaxMs} ms (budget 16.7 ms), memory ${health.memoryMb} MB`);
for (const ws of sockets) ws.terminate();
setTimeout(() => process.exit(0), 200);
