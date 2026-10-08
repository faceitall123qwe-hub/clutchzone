import { MAPS } from "../shared/maps.ts";
import { TEAM_NAMES, type RemotePlayer } from "../shared/protocol.ts";
import { WEAPONS } from "../shared/weapons.ts";

/** Side-view silhouettes for the killfeed and weapon slots, pointing right (at the victim). */
const ICONS = [
  `<svg viewBox="0 0 64 20"><path d="M2 7 14 6 16 8V12L4 14 2 13ZM16 5H36V11H16ZM20 11H24L22 17H18ZM28 11H33L35 18 31 19ZM36 6H48V10H36ZM48 7H61V8.6H48ZM56 4.5H57.4V7.5H56ZM34 3.6H36V5.2H34Z"/></svg>`,
  `<svg viewBox="0 0 32 20"><path d="M6 4H28V9H6ZM28 5.2H30V7.8H28ZM8 9H15L13 18H6ZM15 9H19V10.5L16 12.5H15Z"/></svg>`,
  `<svg viewBox="0 0 72 20"><path d="M1 8 18 7 20 9V12L6 15 1 14ZM20 7H42V12H20ZM42 8H68V9.6H42ZM68 7.2H71V10.4H68ZM23 2.4H41V5H23ZM21 1.6H25V5.8H21ZM39 1.8H43V5.6H39ZM29 5H31V7H29ZM34 5H36V7H34ZM23 12H27L25 18H21ZM32 12H37V16H32Z"/></svg>`,
];
const BOMB_ICON = `<svg viewBox="0 0 24 20"><path d="M2 6H22V18H2ZM5 3H8V6H5ZM16 3H19V6H16Z"/><path d="M5 9H12V12H5Z" fill="#7cff8a"/></svg>`;
const HEADSHOT = `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 0V6M10 14V20M0 10H6M14 10H20" stroke="currentColor" stroke-width="1.8"/></svg>`;

const html = `
<div id="hud">
  <div id="xhair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>
  <div id="scope"><i></i></div>
  <div id="hitmark"></div>
  <div id="target"></div>
  <div id="damage"></div>
  <div id="dirs"></div>
  <div id="banner"></div>
  <div id="xps"></div>
  <div id="levelup"><small>LEVEL UP</small><b></b><span></span></div>
  <div id="toast"></div>
  <div id="round"><div class="pips" id="pa"></div><b class="atk" id="sa">0</b><div class="mid"><span id="rtime"></span><small id="rphase"></small></div><b class="def" id="sd">0</b><div class="pips" id="pd"></div></div>
  <div id="result"><b></b><span></span></div>
  <div id="act"><span></span><div><i></i></div></div>
  <div id="hint"></div>
  <div id="spec"></div>
  <div id="carrier">${BOMB_ICON}<span>You have the bomb</span></div>
  <div id="health"><div class="row"><span>+</span><b id="hp">100</b></div><div class="bar"><i></i></div></div>
  <div id="slots">${WEAPONS.map((w, i) => `<div data-slot="${i}">${ICONS[i]}<span>${w.name}</span><kbd>${i + 1}</kbd></div>`).join("")}</div>
  <div id="ammo"><small id="wname">AR-7</small><div class="row"><b id="mag">30</b><span id="res">/ 90</span></div><div id="reload"><i></i></div></div>
  <div id="feed"></div>
  <div id="notices"></div>
  <div id="stats"></div>
  <div id="dead"><b id="deadby"></b><span id="respawn"></span></div>
  <div id="board"></div>
</div>
<div id="start">
  <div class="card">
    <h1>CLUTCHZONE</h1>
    <p class="sub" id="sub">Browser tactical shooter</p>
    <label class="name">Your name <input id="name" maxlength="16" autocomplete="off" spellcheck="false"></label>
    <button id="online">Quick play</button>
    <div id="rooms"></div>
    <div id="invite"><span>Invite friends:</span><input id="link" readonly><button id="copy">Copy</button></div>
    <div id="privrow"><button id="private" class="ghost">Create private room</button>
      <select id="mapsel" title="Map">${MAPS.map((m) => `<option value="${m.id}">${m.name}</option>`).join("")}</select></div>
    <button id="range" class="ghost">Shooting range (offline)</button>
    <p id="error"></p>
    <details id="settings"><summary>Settings</summary>
      <label>Mouse sensitivity <output id="sensv"></output><input id="sens" type="range" min="0.2" max="4" step="0.05"></label>
      <label>Field of view <output id="fovv"></output><input id="fov" type="range" min="70" max="100" step="1"></label>
      <label>Volume <output id="volv"></output><input id="vol" type="range" min="0" max="1" step="0.05"></label>
    </details>
    <details id="controls"><summary>Controls</summary><dl>
      <dt>Move</dt><dd>W A S D</dd><dt>Jump</dt><dd>Space</dd><dt>Crouch</dt><dd>C</dd>
      <dt>Walk</dt><dd>Shift</dd><dt>Shoot</dt><dd>Left mouse</dd><dt>Scope</dt><dd>Right mouse (sniper)</dd>
      <dt>Weapons</dt><dd>1 2 3 · Q · wheel</dd><dt>Reload</dt><dd>R</dd><dt>Plant / defuse</dt><dd>hold E</dd>
      <dt>Scores</dt><dd>Tab</dd>
    </dl></details>
  </div>
</div>`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type Settings = { sens: number; fov: number; volume: number };
const DEFAULTS: Settings = { sens: 1, fov: 80, volume: 0.8 };

export class Hud {
  private readonly el = (id: string) => document.getElementById(id)!;
  private hitTimer = 0;
  private damageTimer = 0;
  private kills = 0;
  private heads = 0;
  private shots = 0;
  private hits = 0;
  private streak = 0;
  private bannerTimer = 0;
  private slot = -1;
  readonly settings: Settings = { ...DEFAULTS };
  onSettings: (s: Settings) => void = () => {};

  constructor() {
    document.body.insertAdjacentHTML("beforeend", html);
    const name = this.el("name") as HTMLInputElement;
    try {
      name.value = localStorage.getItem("name") ?? "";
      Object.assign(this.settings, JSON.parse(localStorage.getItem("settings") ?? "{}"));
    } catch { /* storage blocked */ }
    name.addEventListener("input", () => { try { localStorage.setItem("name", name.value); } catch { /* ignore */ } });
    this.el("copy").addEventListener("click", () => {
      void navigator.clipboard.writeText((this.el("link") as HTMLInputElement).value);
      this.el("copy").textContent = "Copied";
    });
    const sliders: [keyof Settings, string, (v: number) => string][] = [
      ["sens", "sens", (v) => v.toFixed(2)], ["fov", "fov", (v) => `${v}°`], ["volume", "vol", (v) => `${Math.round(v * 100)}%`],
    ];
    for (const [key, id, fmt] of sliders) {
      const input = this.el(id) as HTMLInputElement;
      input.value = String(this.settings[key]);
      this.el(`${id}v`).textContent = fmt(this.settings[key]);
      input.addEventListener("input", () => {
        this.settings[key] = Number(input.value);
        this.el(`${id}v`).textContent = fmt(this.settings[key]);
        try { localStorage.setItem("settings", JSON.stringify(this.settings)); } catch { /* ignore */ }
        this.onSettings(this.settings);
      });
    }
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
    this.el("privrow").style.display = opts.playing ? "none" : "flex";
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
  get chosenMap(): string {
    return (this.el("mapsel") as HTMLSelectElement).value;
  }

  rooms(list: { id: string; players: number; max: number; map?: string }[], join: (id: string) => void): void {
    const box = this.el("rooms");
    box.replaceChildren(...list.filter((r) => r.players > 0).slice(0, 6).map((r) => {
      const b = document.createElement("button");
      b.className = "room";
      b.innerHTML = `<span>${esc(r.id.replace(/^pub-/, "Room "))}${r.map ? ` <i>${esc(r.map)}</i>` : ""}</span><b>${r.players}/${r.max}</b>`;
      b.addEventListener("click", () => join(r.id));
      return b;
    }));
  }

  crosshair(gapPx: number, show: boolean): void {
    const x = this.el("xhair");
    x.style.setProperty("--gap", `${Math.round(gapPx)}px`);
    x.style.display = show ? "block" : "none";
  }

  scope(on: boolean): void {
    this.el("scope").style.display = on ? "block" : "none";
  }

  weapon(slot: number, mag: number, reserve: number, reloadProgress: number): void {
    if (slot !== this.slot) {
      this.slot = slot;
      this.el("wname").textContent = WEAPONS[slot].name;
      for (const d of this.el("slots").children) d.classList.toggle("on", (d as HTMLElement).dataset.slot === String(slot));
    }
    this.el("mag").textContent = String(mag);
    this.el("res").textContent = `/ ${reserve}`;
    const bar = this.el("reload");
    bar.style.display = reloadProgress > 0 ? "block" : "none";
    (bar.firstElementChild as HTMLElement).style.width = `${reloadProgress * 100}%`;
    this.el("mag").classList.toggle("low", mag <= Math.ceil(WEAPONS[slot].magazine / 6));
  }

  health(hp: number): void {
    hp = Math.max(0, hp);
    this.el("hp").textContent = String(hp);
    this.el("health").classList.toggle("low", hp <= 25);
    (this.el("health").querySelector(".bar i") as HTMLElement).style.width = `${hp}%`;
  }

  /** Name under the crosshair: red for an enemy, green for a teammate. */
  target(name: string, enemy = true): void {
    this.el("target").textContent = name;
    this.el("target").style.color = enemy ? "#ffb4aa" : "#9dffa8";
  }

  /** The death screen; null hides it. */
  dead(title: string | null, sub = ""): void {
    this.el("dead").style.display = title === null ? "none" : "grid";
    if (title !== null) {
      this.el("deadby").textContent = title;
      this.el("respawn").textContent = sub;
      this.streak = 0;
    }
  }

  shot(): void {
    this.shots++;
  }

  /** Hit marker for our own hits; a kill also shows the kill banner. */
  hit(head: boolean, kill: boolean): void {
    this.hits++;
    this.hitTimer = 0.18;
    this.el("hitmark").className = kill ? "kill" : head ? "head" : "on";
    if (kill) {
      this.kills++;
      if (head) this.heads++;
      this.streak++;
      const b = this.el("banner");
      b.innerHTML = `<div class="skulls">${"<i></i>".repeat(Math.min(this.streak, 5))}</div>` +
        `<b>${head ? "HEADSHOT" : "ELIMINATED"}</b>${this.streak > 1 ? `<span>${this.streak} in a row</span>` : ""}`;
      b.classList.remove("pop");
      void b.offsetWidth; // restart the animation
      b.classList.add("pop");
      this.bannerTimer = 1.6;
    }
    this.el("stats").textContent =
      `Kills ${this.kills} · HS ${this.kills ? Math.round((this.heads / this.kills) * 100) : 0}% · ` +
      `Accuracy ${this.shots ? Math.round((this.hits / this.shots) * 100) : 0}%`;
  }

  /** We took damage; angle: where it came from relative to where we look (0 = ahead, + = left). */
  hurt(angle: number | null): void {
    this.damageTimer = 0.35;
    if (angle === null) return;
    const d = document.createElement("i");
    d.style.transform = `rotate(${(-angle * 180) / Math.PI}deg)`;
    this.el("dirs").append(d);
    setTimeout(() => d.remove(), 1200);
  }

  /** Teams colour the names; weapon -1 is the bomb, which has no killer. */
  /** "+15 XP Headshot", floating up under the crosshair. */
  xpPop(xp: number, reason: string): void {
    const d = document.createElement("div");
    d.innerHTML = `<b>+${xp} XP</b> ${esc(reason)}`;
    const box = this.el("xps");
    box.append(d);
    while (box.children.length > 4) box.firstElementChild!.remove();
    setTimeout(() => d.remove(), 1800);
  }

  levelUp(level: number, unlocked: string[]): void {
    const l = this.el("levelup");
    l.querySelector("b")!.textContent = String(level);
    l.querySelector("span")!.textContent = unlocked.length ? `Unlocked: ${unlocked.join(", ")} (see the Locker)` : "";
    l.classList.remove("show");
    void l.offsetWidth; // restart the animation
    l.classList.add("show");
    clearTimeout(this.levelTimer);
    this.levelTimer = window.setTimeout(() => l.classList.remove("show"), 4000);
  }
  private levelTimer = 0;

  toast(text: string): void {
    const t = document.createElement("div");
    t.textContent = text;
    this.el("toast").append(t);
    setTimeout(() => t.remove(), 4000);
  }

  feed(killer: string, victim: string, weapon: number, head: boolean, mine: boolean, teams: [number, number] = [0, 1]): void {
    const row = document.createElement("div");
    row.className = mine ? "kill mine" : "kill";
    row.innerHTML = (weapon >= 0 ? `<b class="t${teams[0]}">${esc(killer)}</b>${ICONS[weapon] ?? ""}` : BOMB_ICON) +
      `${head ? `<span class="hs">${HEADSHOT}</span>` : ""}<b class="t${teams[1]}">${esc(victim)}</b>`;
    this.push("feed", row, 6000, 5);
  }

  /** Top bar: score, time left (null while the bomb ticks), who is still alive on each side. */
  roundBar(show: boolean, score: [number, number], timeLeft: number | null, phase: string,
           alive: [number, number], total: [number, number]): void {
    this.el("round").style.display = show ? "flex" : "none";
    if (!show) return;
    this.el("sa").textContent = String(score[0]);
    this.el("sd").textContent = String(score[1]);
    const t = this.el("rtime");
    t.classList.toggle("bomb", timeLeft === null);
    t.innerHTML = timeLeft === null ? BOMB_ICON : timeLeft < 0 ? "–"
      : `${Math.floor(Math.max(0, timeLeft) / 60)}:${String(Math.floor(Math.max(0, timeLeft) % 60)).padStart(2, "0")}`;
    this.el("rphase").textContent = phase;
    for (const [id, i] of [["pa", 0], ["pd", 1]] as const)
      this.el(id).innerHTML = Array.from({ length: total[i] }, (_, k) => `<i class="${k < alive[i] ? "on" : ""}"></i>`).join("");
  }

  /** The big line in the middle when a round or the match is decided. */
  result(text: string | null, sub = "", team = 0): void {
    const r = this.el("result");
    r.style.display = text ? "grid" : "none";
    r.className = `t${team}`;
    if (text) { r.querySelector("b")!.textContent = text; r.querySelector("span")!.textContent = sub; }
  }

  /** Planting or defusing progress, 0..1. */
  progress(label: string | null, frac: number): void {
    const a = this.el("act");
    a.style.display = label ? "grid" : "none";
    if (!label) return;
    a.querySelector("span")!.textContent = label;
    (a.querySelector("i") as HTMLElement).style.width = `${Math.min(1, frac) * 100}%`;
  }

  hint(text: string | null): void {
    this.el("hint").textContent = text ?? "";
  }

  /** Watching a teammate after dying: their name, or the waiting text. */
  spectating(text: string | null): void {
    this.el("spec").textContent = text ?? "";
    this.el("spec").style.display = text ? "block" : "none";
  }

  carrier(on: boolean): void {
    this.el("carrier").style.display = on ? "flex" : "none";
  }

  /** Our own panels (health, ammo, weapons): hidden while watching someone else. */
  own(show: boolean): void {
    for (const id of ["health", "ammo", "slots"]) this.el(id).style.visibility = show ? "visible" : "hidden";
  }

  notice(text: string): void {
    const row = document.createElement("div");
    row.textContent = text;
    this.push("notices", row, 5000, 4);
  }

  private push(id: string, row: HTMLElement, ms: number, max: number): void {
    const box = this.el(id);
    box.append(row);
    while (box.children.length > max) box.firstElementChild!.remove();
    setTimeout(() => row.classList.add("out"), ms - 400);
    setTimeout(() => row.remove(), ms);
  }

  /** One table per team; score: rounds won, null outside a match (shooting range, warmup). */
  scoreboard(show: boolean, players: RemotePlayer[], me: number, score: [number, number] | null, carrier: number | null): void {
    this.el("board").style.display = show ? "grid" : "none";
    if (!show) return;
    this.el("board").innerHTML = [0, 1].map((team) => {
      const rows = players.filter((p) => p.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
        .map((p) => `<tr class="${p.id === me ? "me" : ""} ${p.alive ? "" : "dead"}"><td>${esc(p.name)}${p.id === carrier ? ` ${BOMB_ICON}` : ""}</td>` +
          `<td>${p.kills}</td><td>${p.deaths}</td><td>${p.ping}</td></tr>`).join("");
      return `<div class="team t${team}"><div class="cap"><b>${TEAM_NAMES[team]}</b>${score ? `<span>${score[team]}</span>` : ""}</div>` +
        `<table><thead><tr><th>Player</th><th>K</th><th>D</th><th>Ping</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join("");
  }

  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.el("hitmark").className = "";
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el("banner").classList.remove("pop");
    }
    this.damageTimer = Math.max(0, this.damageTimer - dt);
    this.el("damage").style.opacity = String(this.damageTimer / 0.35);
  }
}
