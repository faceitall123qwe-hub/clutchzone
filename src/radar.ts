import { MAP, SITES, type Kind } from "../shared/map.ts";

const SIZE = 168; // pixels
const HALF = 25; // metres from the middle of the map to its edge
const k = SIZE / (2 * HALF);
const px = (x: number) => (x + HALF) * k;
const COLORS: Partial<Record<Kind, string>> = { wall: "#8c7c5f", block: "#7d6f56", crate: "#6b4a2b", metal: "#4d6b70", step: "#5d5444" };
const TEAM = ["#f0b84a", "#6fb0ff"];

type Dot = { x: number; z: number };

/** Top-down map in the corner, north up: you, your team, enemies you can see, the bomb if your team knows. */
export class Radar {
  private readonly canvas = document.createElement("canvas");
  private readonly g: CanvasRenderingContext2D;
  private readonly base = document.createElement("canvas");

  constructor(parent: HTMLElement) {
    this.canvas.width = this.canvas.height = this.base.width = this.base.height = SIZE;
    this.canvas.id = "radar";
    parent.append(this.canvas);
    this.g = this.canvas.getContext("2d")!;
    const b = this.base.getContext("2d")!;
    b.fillStyle = "#0b0e13b0";
    b.fillRect(0, 0, SIZE, SIZE);
    b.fillStyle = "#3a352b";
    b.fillRect(px(-24), px(-24), 48 * k, 48 * k);
    for (const box of MAP) {
      const c = COLORS[box.kind];
      if (!c) continue;
      b.fillStyle = box.max[1] < 2 && box.kind !== "crate" ? "#6a5f4a" : c; // low platforms lighter than walls
      b.fillRect(px(box.min[0]), px(box.min[2]), (box.max[0] - box.min[0]) * k, (box.max[2] - box.min[2]) * k);
    }
    b.font = "bold 18px system-ui";
    b.textAlign = "center";
    b.textBaseline = "middle";
    for (const [name, s] of Object.entries(SITES)) {
      b.fillStyle = "#c8302822";
      b.fillRect(px(s.min[0]), px(s.min[1]), (s.max[0] - s.min[0]) * k, (s.max[1] - s.min[1]) * k);
      b.fillStyle = "#ff5a4acc";
      b.fillText(name, px((s.min[0] + s.max[0]) / 2), px((s.min[1] + s.max[1]) / 2));
    }
  }

  draw(show: boolean, me: Dot & { yaw: number; alive: boolean }, team: number, mates: Dot[], enemies: Dot[],
       bomb: (Dot & { planted: boolean }) | null): void {
    this.canvas.style.display = show ? "block" : "none";
    if (!show) return;
    const g = this.g;
    g.clearRect(0, 0, SIZE, SIZE);
    g.drawImage(this.base, 0, 0);
    const dot = (p: Dot, color: string, r: number) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(px(p.x), px(p.z), r, 0, Math.PI * 2);
      g.fill();
    };
    for (const m of mates) dot(m, TEAM[team], 3.5);
    for (const e of enemies) dot(e, "#ff4030", 3.5);
    if (bomb) {
      g.fillStyle = bomb.planted && Date.now() % 1000 < 500 ? "#ff2010" : "#ffd27a";
      g.fillRect(px(bomb.x) - 4, px(bomb.z) - 3, 8, 6);
    }
    if (me.alive) {
      g.save();
      g.translate(px(me.x), px(me.z));
      g.rotate(-me.yaw); // yaw 0 looks north (-z), which is up on the radar
      g.fillStyle = "#fff";
      g.beginPath();
      g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
}
