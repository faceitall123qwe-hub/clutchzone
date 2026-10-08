import { DEFAULT_LOOK, UNLOCKS, type Look } from "./cosmetics.ts";

/**
 * The player's progress, kept in the browser (no accounts yet): experience and level, what they wear,
 * today's challenges, how many days in a row they've played, a double-XP boost from invites.
 */
export type Profile = {
  id: string; // random; goes into invite links
  xp: number; // total
  look: Look;
  day: string; // the last day played, YYYY-MM-DD
  streak: number; // days in a row
  daily: { day: string; progress: Record<string, number>; done: string[] };
  boostUntil: number; // ms since epoch: double XP until then
  stats: { kills: number; deaths: number; heads: number; matches: number; wins: number };
};

export type Challenge = { id: string; text: string; goal: number; reward: number };
const CHALLENGES: Challenge[] = [
  { id: "kills", text: "Get 10 kills", goal: 10, reward: 120 },
  { id: "heads", text: "Get 3 headshot kills", goal: 3, reward: 150 },
  { id: "sniper", text: "Get 2 kills with the Longbow", goal: 2, reward: 150 },
  { id: "pistol", text: "Get 3 kills with the P-9", goal: 3, reward: 150 },
  { id: "rounds", text: "Win 3 rounds", goal: 3, reward: 120 },
  { id: "plant", text: "Plant the bomb", goal: 1, reward: 120 },
  { id: "defuse", text: "Defuse the bomb", goal: 1, reward: 150 },
  { id: "match", text: "Finish a match", goal: 1, reward: 150 },
  { id: "life3", text: "Get 3 kills in one life", goal: 3, reward: 150 },
];

/** XP from level n to n + 1: the first levels come quickly. */
export const xpToNext = (level: number) => 100 + 40 * (level - 1);

export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  while (xp >= xpToNext(level)) { xp -= xpToNext(level); level++; }
  return { level, into: xp, need: xpToNext(level) };
}

const today = () => new Date().toLocaleDateString("sv"); // YYYY-MM-DD in local time
const KEY = "clutchzone-profile";

/** The same three challenges for everyone on a given day. */
export function challengesFor(day: string): Challenge[] {
  let seed = [...day].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pool = [...CHALLENGES];
  return Array.from({ length: 3 }, () => pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
}

export type Gain = { xp: number; reason: string };
type Listener = {
  xp?: (g: Gain) => void;
  level?: (level: number, unlocked: string[]) => void;
  challenge?: (c: Challenge) => void;
};

export class Progress {
  readonly p: Profile;
  private readonly listeners: Listener[] = [];
  /** XP earned since the current match started, for the summary. */
  matchXp = 0;
  private lifeKills = 0;

  constructor() {
    let saved: Partial<Profile> = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { /* storage blocked */ }
    this.p = {
      id: saved.id ?? Math.random().toString(36).slice(2, 10),
      xp: saved.xp ?? 0,
      look: { ...DEFAULT_LOOK, ...saved.look },
      day: saved.day ?? "",
      streak: saved.streak ?? 0,
      daily: saved.daily ?? { day: "", progress: {}, done: [] },
      boostUntil: saved.boostUntil ?? 0,
      stats: { kills: 0, deaths: 0, heads: 0, matches: 0, wins: 0, ...saved.stats },
    };
    if (this.p.daily.day !== today()) this.p.daily = { day: today(), progress: {}, done: [] };
    this.save();
  }

  get isNew(): boolean {
    return this.p.xp === 0 && this.p.stats.matches === 0 && this.p.stats.kills === 0;
  }

  on(l: Listener): void {
    this.listeners.push(l);
  }

  save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.p)); } catch { /* storage blocked */ }
  }

  get boosted(): boolean {
    return Date.now() < this.p.boostUntil;
  }

  boost(minutes: number): void {
    this.p.boostUntil = Math.max(Date.now(), this.p.boostUntil) + minutes * 60_000;
    this.save();
  }

  challenges(): (Challenge & { progress: number; done: boolean })[] {
    if (this.p.daily.day !== today()) this.p.daily = { day: today(), progress: {}, done: [] };
    return challengesFor(this.p.daily.day).map((c) => ({
      ...c, progress: Math.min(c.goal, this.p.daily.progress[c.id] ?? 0), done: this.p.daily.done.includes(c.id),
    }));
  }

  /** The first time we play on a day: extend or restart the streak; returns the bonus XP given. */
  playedToday(): number {
    const d = today();
    if (this.p.day === d) return 0;
    const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("sv");
    this.p.streak = this.p.day === yesterday ? this.p.streak + 1 : 1;
    this.p.day = d;
    const bonus = Math.min(this.p.streak, 7) * 20;
    this.gain(bonus, `Day ${this.p.streak} in a row`);
    return bonus;
  }

  gain(xp: number, reason: string): void {
    const amount = this.boosted ? xp * 2 : xp;
    const before = levelOf(this.p.xp).level;
    this.p.xp += amount;
    this.matchXp += amount;
    const after = levelOf(this.p.xp).level;
    this.save();
    for (const l of this.listeners) l.xp?.({ xp: amount, reason });
    if (after > before) {
      const unlocked = UNLOCKS.filter((u) => u.item.level > before && u.item.level <= after).map((u) => u.item.name);
      for (const l of this.listeners) l.level?.(after, unlocked);
    }
  }

  private count(id: string, n = 1): void {
    const c = challengesFor(this.p.daily.day).find((c) => c.id === id);
    if (!c || this.p.daily.done.includes(id)) return;
    this.p.daily.progress[id] = (this.p.daily.progress[id] ?? 0) + n;
    if (this.p.daily.progress[id] >= c.goal) {
      this.p.daily.done.push(id);
      for (const l of this.listeners) l.challenge?.(c);
      this.gain(c.reward, c.text);
    }
    this.save();
  }

  kill(head: boolean, weapon: number): void {
    this.p.stats.kills++;
    if (head) this.p.stats.heads++;
    this.lifeKills++;
    this.gain(head ? 15 : 10, head ? "Headshot" : "Kill");
    this.count("kills");
    if (head) this.count("heads");
    if (weapon === 2) this.count("sniper");
    if (weapon === 1) this.count("pistol");
    if (this.lifeKills === 3) this.count("life3");
  }

  died(): void {
    this.p.stats.deaths++;
    this.lifeKills = 0;
    this.save();
  }

  spawned(): void {
    this.lifeKills = 0;
  }

  roundWon(): void {
    this.gain(15, "Round won");
    this.count("rounds");
  }

  planted(): void {
    this.gain(20, "Bomb planted");
    this.count("plant");
  }

  defused(): void {
    this.gain(30, "Bomb defused");
    this.count("defuse");
  }

  matchEnded(won: boolean): void {
    this.p.stats.matches++;
    if (won) this.p.stats.wins++;
    this.gain(won ? 100 : 50, won ? "Match won" : "Match played");
    this.count("match");
  }

  wear(look: Partial<Look>): void {
    Object.assign(this.p.look, look);
    this.save();
  }
}
