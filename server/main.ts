/**
 * Game server: serves the built client from dist/ and runs rooms over WebSocket at /ws.
 *
 *   node server/main.ts            PORT=8080 by default
 *   node server/main.ts --dev      also accepts dev commands (teleport) for automated tests
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { TICK } from "../shared/constants.ts";
import type { ClientMsg, ServerMsg } from "../shared/protocol.ts";
import { Room } from "./room.ts";

const PORT = Number(process.env.PORT ?? 8080);
const DEV = process.argv.includes("--dev");
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".glb": "model/gltf-binary", ".json": "application/json", ".ogg": "audio/ogg",
};

const http = createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^([/\\])+/, "");
  let file = join(DIST, path || "index.html");
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; } // no ../ escapes
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) { res.writeHead(404).end("Build the client first: npm run build"); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});

const MAX_ROOMS = 100;
const MAX_PER_IP = 4;
const MAX_MSGS_PER_SEC = 240; // 60 commands + catch-up bursts + pings; a flood beyond that disconnects

const rooms = new Map<string, Room>();
const perIp = new Map<string, number>();
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 4096 });

wss.on("connection", (ws, req) => {
  // Behind a Cloudflare tunnel every socket comes from localhost; the visitor's address is in a header.
  const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "?");
  if ((perIp.get(ip) ?? 0) >= MAX_PER_IP) { ws.close(1008, "too many connections"); return; }
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  ws.on("close", () => {
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
  });

  const url = new URL(req.url ?? "", "http://x");
  const roomId = (url.searchParams.get("room") ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 24) || "lobby";
  const name = (url.searchParams.get("name") ?? "").replace(/[<>]/g, "").trim();
  let room = rooms.get(roomId);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) { ws.close(1013, "server full"); return; }
    rooms.set(roomId, (room = new Room(roomId, DEV)));
  }
  const send = (m: ServerMsg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
  if (room.full) { send({ type: "full" }); ws.close(); return; }

  const player = room.join(name, send);
  console.log(`[${roomId}] +${player.name} (${room.players.size} players)`);
  let windowStart = Date.now(), count = 0;
  ws.on("message", (data) => {
    if (Date.now() - windowStart > 1000) { windowStart = Date.now(); count = 0; }
    if (++count > MAX_MSGS_PER_SEC) { ws.close(1008, "flood"); return; }
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    room.onMessage(player, msg);
  });
  ws.on("close", () => {
    room.leave(player.id);
    console.log(`[${roomId}] -${player.name} (${room.players.size} players)`);
    if (room.players.size === 0) rooms.delete(roomId);
  });
});

// Fixed 60 Hz simulation. Timers on Windows are coarse, so step by elapsed time, not by callback count.
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc = Math.min(acc + (now - last) / 1000, 0.25);
  last = now;
  while (acc >= TICK) {
    for (const room of rooms.values()) room.step();
    acc -= TICK;
  }
}, 4);

http.listen(PORT, () => console.log(`game server on http://localhost:${PORT}${DEV ? " (dev commands on)" : ""}`));
