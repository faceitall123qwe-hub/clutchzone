/**
 * Play with friends from this computer: runs the game server and a free Cloudflare quick tunnel
 * (no account), then prints a link anyone can open. Stop with Ctrl+C.
 *
 *   npm run share        (builds the client first)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = process.env.PORT ?? "8080";
const local = join(homedir(), "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
const cloudflared = existsSync(local) ? local : "cloudflared";

const children: ChildProcess[] = [];
const stop = () => { for (const c of children) c.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const server = spawn(process.execPath, ["server/main.ts"], { env: { ...process.env, PORT }, stdio: ["ignore", "inherit", "inherit"] });
children.push(server);

const tunnel = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
children.push(tunnel);
tunnel.on("error", () => {
  console.error("cloudflared not found. Download it to ~/bin from\n" +
    "https://github.com/cloudflare/cloudflared/releases/latest (cloudflared-windows-amd64.exe → cloudflared.exe)");
  stop();
});

let announced = false;
const scan = (chunk: Buffer) => {
  const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m || announced) return;
  announced = true;
  const room = Math.random().toString(36).slice(2, 7);
  console.log(`\n  Send this link to your friends:\n\n    ${m[0]}/?room=${room}\n\n  (the link lives as long as this window; Ctrl+C to stop)\n`);
};
tunnel.stdout!.on("data", scan);
tunnel.stderr!.on("data", scan);
server.on("exit", stop);
tunnel.on("exit", () => { if (!announced) console.error("The tunnel stopped before it got a link."); stop(); });
