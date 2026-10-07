/** HTML overlay: crosshair, ammo, health, hit markers, kill feed, start screen. */
const html = `
<div id="hud">
  <div id="xhair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>
  <div id="hitmark"></div>
  <div id="health"><span>+</span><b id="hp">100</b></div>
  <div id="ammo"><b id="mag">30</b><span id="res">/ 90</span><div id="reload"><i></i></div></div>
  <div id="feed"></div>
  <div id="stats"></div>
</div>
<div id="start">
  <div class="card">
    <h1>OUTPOST</h1>
    <p class="sub">Shooting range · offline</p>
    <button id="play">Click to play</button>
    <dl>
      <dt>Move</dt><dd>W A S D</dd><dt>Jump</dt><dd>Space</dd><dt>Crouch</dt><dd>C</dd>
      <dt>Walk</dt><dd>Shift</dd><dt>Shoot</dt><dd>Left mouse</dd><dt>Reload</dt><dd>R</dd>
    </dl>
    <p class="hint">Tap or burst: the spray climbs, then sways. Headshots kill in one bullet.</p>
  </div>
</div>`;

export class Hud {
  private readonly el = (id: string) => document.getElementById(id)!;
  private hitTimer = 0;
  private kills = 0;
  private heads = 0;
  private shots = 0;
  private hits = 0;

  constructor() {
    document.body.insertAdjacentHTML("beforeend", html);
  }

  showStart(show: boolean): void {
    this.el("start").style.display = show ? "grid" : "none";
  }

  onPlay(fn: () => void): void {
    this.el("play").addEventListener("click", fn);
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

  shot(): void {
    this.shots++;
  }

  hit(head: boolean, kill: boolean): void {
    this.hits++;
    this.hitTimer = 0.18;
    const m = this.el("hitmark");
    m.className = kill ? "kill" : head ? "head" : "on";
    if (kill) {
      this.kills++;
      if (head) this.heads++;
      const row = document.createElement("div");
      row.textContent = `You ${head ? "⌖ headshot" : "→"} Target`;
      const feed = this.el("feed");
      feed.prepend(row);
      setTimeout(() => row.remove(), 4000);
    }
    this.el("stats").textContent =
      `Kills ${this.kills} · HS ${this.kills ? Math.round((this.heads / this.kills) * 100) : 0}% · ` +
      `Accuracy ${Math.round((this.hits / this.shots) * 100)}%`;
  }

  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.el("hitmark").className = "";
    }
  }
}
