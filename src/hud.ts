import type { RemotePlayer } from "../shared/protocol.ts";

const html = `
<div id="hud">
  <div id="xhair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>
  <div id="hitmark"></div>
  <div id="target"></div>
  <div id="damage"></div>
  <div id="health"><span>+</span><b id="hp">100</b></div>
  <div id="ammo"><b id="mag">30</b><span id="res">/ 90</span><div id="reload"><i></i></div></div>
  <div id="feed"></div>
  <div id="stats"></div>
  <div id="dead"><b id="deadby"></b><span id="respawn"></span></div>
  <div id="board"><table><thead><tr><th>Player</th><th>K</th><th>D</th><th>Ping</th></tr></thead><tbody></tbody></table></div>
</div>
<div id="start">
  <div class="card">
    <h1>CLUTCHZONE</h1>
    <p class="sub" id="sub">Browser tactical shooter</p>
    <label class="name">Your name <input id="name" maxlength="16" autocomplete="off" spellcheck="false"></label>
    <button id="online">Quick play</button>
    <div id="rooms"></div>
    <div id="invite"><span>Invite friends:</span><input id="link" readonly><button id="copy">Copy</button></div>
    <button id="private" class="ghost">Create private room</button>
    <button id="range" class="ghost">Shooting range (offline)</button>
    <p id="error"></p>
    <dl>
      <dt>Move</dt><dd>W A S D</dd><dt>Jump</dt><dd>Space</dd><dt>Crouch</dt><dd>C</dd>
      <dt>Walk</dt><dd>Shift</dd><dt>Shoot</dt><dd>Left mouse</dd><dt>Reload</dt><dd>R</dd><dt>Scores</dt><dd>Tab</dd>
    </dl>
  </div>
</div>`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class Hud {
  private readonly el = (id: string) => document.getElementById(id)!;
  private hitTimer = 0;
  private damageTimer = 0;
  private kills = 0;
  private heads = 0;
  private shots = 0;
  private hits = 0;

  constructor() {
    document.body.insertAdjacentHTML("beforeend", html);
    const name = this.el("name") as HTMLInputElement;
    try { name.value = localStorage.getItem("name") ?? ""; } catch { /* storage blocked */ }
    name.addEventListener("input", () => { try { localStorage.setItem("name", name.value); } catch { /* ignore */ } });
    this.el("copy").addEventListener("click", () => {
      void navigator.clipboard.writeText((this.el("link") as HTMLInputElement).value);
      this.el("copy").textContent = "Copied";
    });
  }

  get name(): string {
    return (this.el("name") as HTMLInputElement).value.trim() || `Player${Math.floor(Math.random() * 900 + 100)}`;
  }

  /** Menu in its pre-game or paused state. room: the room we're in or about to join. */
  menu(show: boolean, opts: { room?: string; playing?: "online" | "range" } = {}): void {
    this.el("start").style.display = show ? "grid" : "none";
    const link = opts.room ? `${location.origin}${location.pathname}?room=${opts.room}` : "";
    (this.el("link") as HTMLInputElement).value = link;
    this.el("invite").style.display = opts.room ? "flex" : "none";
    this.el("online").textContent = opts.playing ? "Resume" : opts.room ? `Join room ${opts.room}` : "Quick play";
    this.el("range").style.display = opts.playing ? "none" : "block";
    this.el("private").style.display = opts.playing ? "none" : "block";
    this.el("rooms").style.display = opts.playing ? "none" : "grid";
    this.el("sub").textContent = opts.playing === "range" ? "Shooting range · offline"
      : opts.room ? `Room ${opts.room} · map Outpost` : "Browser tactical shooter";
  }

  error(text: string): void {
    this.el("error").textContent = text;
  }

  on(id: "online" | "private" | "range", fn: () => void): void {
    this.el(id).addEventListener("click", fn);
  }

  /** Open public rooms; clicking one calls join(id). */
  rooms(list: { id: string; players: number; max: number }[], join: (id: string) => void): void {
    const box = this.el("rooms");
    box.replaceChildren(...list.filter((r) => r.players > 0).slice(0, 6).map((r) => {
      const b = document.createElement("button");
      b.className = "room";
      b.innerHTML = `<span>${esc(r.id.replace(/^pub-/, "Room "))}</span><b>${r.players}/${r.max}</b>`;
      b.addEventListener("click", () => join(r.id));
      return b;
    }));
  }

  crosshair(gapPx: number): void {
    this.el("xhair").style.setProperty("--gap", `${Math.round(gapPx)}px`);
  }

  ammo(mag: number, reserve: number, reloadProgress: number): void {
    this.el("mag").textContent = String(mag);
    this.el("res").textContent = `/ ${reserve}`;
    const bar = this.el("reload");
    bar.style.display = reloadProgress > 0 ? "block" : "none";
    (bar.firstElementChild as HTMLElement).style.width = `${reloadProgress * 100}%`;
    this.el("mag").classList.toggle("low", mag <= 5);
  }

  health(hp: number): void {
    this.el("hp").textContent = String(Math.max(0, hp));
    this.el("hp").classList.toggle("low", hp <= 25);
  }

  target(name: string): void {
    this.el("target").textContent = name;
  }

  dead(by: string | null, respawnIn: number): void {
    this.el("dead").style.display = by === null ? "none" : "grid";
    if (by !== null) {
      this.el("deadby").textContent = `Killed by ${by}`;
      this.el("respawn").textContent = `Respawn in ${Math.max(0, respawnIn).toFixed(1)} s`;
    }
  }

  shot(): void {
    this.shots++;
  }

  /** Hit marker for our own hits. */
  hit(head: boolean, kill: boolean): void {
    this.hits++;
    this.hitTimer = 0.18;
    this.el("hitmark").className = kill ? "kill" : head ? "head" : "on";
    if (kill) { this.kills++; if (head) this.heads++; }
    this.el("stats").textContent =
      `Kills ${this.kills} · HS ${this.kills ? Math.round((this.heads / this.kills) * 100) : 0}% · ` +
      `Accuracy ${this.shots ? Math.round((this.hits / this.shots) * 100) : 0}%`;
  }

  hurt(): void {
    this.damageTimer = 0.35;
  }

  feed(text: string, mine = false): void {
    const row = document.createElement("div");
    row.textContent = text;
    if (mine) row.className = "mine";
    this.el("feed").prepend(row);
    setTimeout(() => row.remove(), 5000);
  }

  scoreboard(show: boolean, players: RemotePlayer[], me: number): void {
    this.el("board").style.display = show ? "grid" : "none";
    if (!show) return;
    const rows = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((p) => `<tr class="${p.id === me ? "me" : ""}"><td>${esc(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.ping}</td></tr>`);
    this.el("board").querySelector("tbody")!.innerHTML = rows.join("");
  }

  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.el("hitmark").className = "";
    }
    this.damageTimer = Math.max(0, this.damageTimer - dt);
    this.el("damage").style.opacity = String(this.damageTimer / 0.35);
  }
}
