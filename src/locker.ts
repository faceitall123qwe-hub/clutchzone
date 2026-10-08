import { EFFECTS, HATS, PAINTS, type Look } from "./cosmetics";
import { levelOf, type Progress } from "./profile";
import { download, inviteUrl, share, type MatchSummary } from "./share";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

const html = `
<div id="profile">
  <div class="lvl"><small>LVL</small><b id="plevel">1</b></div>
  <div class="xp"><div class="bar"><i id="pxp"></i></div><span id="pxptext"></span></div>
  <div id="pstreak"></div>
</div>
<div id="pboost"></div>
<div id="daily"><h3>Today's challenges</h3><div id="dlist"></div></div>
<div id="lastmatch"></div>
<div class="row2"><button id="lockerb" class="ghost">Locker</button><button id="shareb" class="ghost">Share &amp; invite</button></div>
<p id="sharemsg"></p>`;

const lockerHtml = `
<div id="locker"><div class="panel">
  <div class="head"><h2>Locker</h2><button id="lockerx">Close</button></div>
  <div class="tabs"><button data-tab="paint" class="on">Weapon paint</button><button data-tab="hat">Hat</button><button data-tab="effect">Kill effect</button></div>
  <div id="items"></div>
</div></div>`;

type Tab = "paint" | "hat" | "effect";

/** The progress part of the menu: level, today's challenges, the locker and sharing. */
export class Meta {
  private readonly progress: Progress;
  private tab: Tab = "paint";
  private last: MatchSummary | null = null;
  onWear: (look: Look) => void = () => {};
  name = "";

  constructor(progress: Progress) {
    this.progress = progress;
    document.querySelector("#start .card")!.insertAdjacentHTML("beforeend", `<div id="meta">${html}</div>`);
    document.body.insertAdjacentHTML("beforeend", lockerHtml);
    const el = (id: string) => document.getElementById(id)!;
    el("lockerb").addEventListener("click", () => { el("locker").style.display = "grid"; this.renderLocker(); });
    el("lockerx").addEventListener("click", () => { el("locker").style.display = "none"; });
    for (const b of document.querySelectorAll<HTMLButtonElement>("#locker .tabs button"))
      b.addEventListener("click", () => { this.tab = b.dataset.tab as Tab; this.renderLocker(); });
    el("shareb").addEventListener("click", () => void this.share());
    this.render();
  }

  /** Remember the match just played; the menu offers to share it. */
  setLastMatch(m: MatchSummary): void {
    this.last = m;
    this.render();
  }

  private summary(): MatchSummary {
    const s = this.progress.p.stats;
    return this.last ?? { map: "Clutchzone", kills: s.kills, deaths: s.deaths, heads: s.heads, won: null, score: null,
      level: levelOf(this.progress.p.xp).level, name: this.name || "Me" };
  }

  private async share(): Promise<void> {
    const msg = document.getElementById("sharemsg")!;
    const how = await share(this.summary(), inviteUrl(this.progress.p.id));
    msg.innerHTML = (how === "copied" ? "Link copied. " : "") +
      `Friends who join through your link get double XP for an hour, and so do you when they join your room. <a href="#" id="savecard">Save the picture</a>`;
    document.getElementById("savecard")!.addEventListener("click", (e) => { e.preventDefault(); void download(this.summary()); });
  }

  render(): void {
    const p = this.progress.p, { level, into, need } = levelOf(p.xp);
    const el = (id: string) => document.getElementById(id)!;
    el("plevel").textContent = String(level);
    (el("pxp") as HTMLElement).style.width = `${(into / need) * 100}%`;
    el("pxptext").textContent = `${into} / ${need} XP`;
    el("pstreak").innerHTML = p.streak > 1 ? `<b>${p.streak}</b> days in a row` : "";
    const left = p.boostUntil - Date.now();
    el("pboost").textContent = left > 0 ? `Double XP for ${Math.ceil(left / 60000)} more minutes` : "";
    el("dlist").innerHTML = this.progress.challenges().map((c) =>
      `<div class="ch ${c.done ? "done" : ""}"><span>${esc(c.text)}</span><b>${c.done ? "Done" : `${c.progress}/${c.goal}`}</b>` +
      `<i style="width:${(c.progress / c.goal) * 100}%"></i><em>+${c.reward} XP</em></div>`).join("");
    const m = this.last;
    el("lastmatch").innerHTML = m ? `<b>Last match on ${esc(m.map)}</b>: ${m.kills} kills, ${m.deaths} deaths, ` +
      `${m.heads} headshots${m.won === null ? "" : m.won ? " — victory" : " — defeat"}` : "";
  }

  private renderLocker(): void {
    const level = levelOf(this.progress.p.xp).level, look = this.progress.p.look;
    for (const b of document.querySelectorAll<HTMLButtonElement>("#locker .tabs button"))
      b.classList.toggle("on", b.dataset.tab === this.tab);
    const items: { id: string; name: string; level: number; swatch: string }[] =
      this.tab === "paint" ? PAINTS.map((p) => ({ ...p, swatch: `linear-gradient(135deg, ${hex(p.metal)} 50%, ${hex(p.wood)} 50% 75%, ${hex(p.accent)} 75%)` }))
      : this.tab === "hat" ? HATS.map((h) => ({ ...h, swatch: "" }))
      : EFFECTS.map((e) => ({ ...e, swatch: e.colors.length ? `linear-gradient(90deg, ${e.colors.map(hex).join(", ")})` : "" }));
    const box = document.getElementById("items")!;
    box.innerHTML = items.map((i) => {
      const locked = i.level > level, on = look[this.tab] === i.id;
      return `<button class="item ${on ? "on" : ""} ${locked ? "locked" : ""}" data-id="${i.id}" ${locked ? "disabled" : ""}>` +
        `<span class="sw ${this.tab}-${i.id}" style="${i.swatch ? `background:${i.swatch}` : ""}"></span>` +
        `<b>${esc(i.name)}</b><small>${locked ? `Level ${i.level}` : on ? "Equipped" : "Equip"}</small></button>`;
    }).join("");
    for (const b of box.querySelectorAll<HTMLButtonElement>("button.item:not(.locked)"))
      b.addEventListener("click", () => {
        this.progress.wear({ [this.tab]: b.dataset.id });
        this.onWear(this.progress.p.look);
        this.renderLocker();
      });
  }
}
