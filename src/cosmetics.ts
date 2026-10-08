/** Everything a player can unlock by levelling up. Other players see what you wear. */
export type Paint = { id: string; name: string; level: number; metal: number; dark: number; wood: number; accent: number };
export type Hat = { id: string; name: string; level: number };
export type Effect = { id: string; name: string; level: number; colors: number[] };

export const PAINTS: Paint[] = [
  { id: "classic", name: "Classic", level: 1, metal: 0x5a6a80, dark: 0x2e3442, wood: 0xd2762e, accent: 0x8cc63f },
  { id: "desert", name: "Desert", level: 2, metal: 0xc9a26b, dark: 0x7a5c38, wood: 0xeccb8e, accent: 0xd9b070 },
  { id: "forest", name: "Forest", level: 5, metal: 0x4f6b3a, dark: 0x2f3f24, wood: 0x8a6436, accent: 0x6b8f3a },
  { id: "ice", name: "Ice", level: 8, metal: 0xbfe6ff, dark: 0x5f9fd6, wood: 0xf4fbff, accent: 0x8fd0ff },
  { id: "neon", name: "Neon", level: 12, metal: 0xff4fb8, dark: 0x3a1d5c, wood: 0x4ff0ff, accent: 0xfff04f },
  { id: "gold", name: "Gold", level: 20, metal: 0xffcc33, dark: 0xb8860b, wood: 0xfff1a8, accent: 0xffd84d },
  { id: "galaxy", name: "Galaxy", level: 30, metal: 0x5b3bd6, dark: 0x1b1240, wood: 0xff7ad9, accent: 0x7af0ff },
];

export const HATS: Hat[] = [
  { id: "helmet", name: "Helmet", level: 1 },
  { id: "beanie", name: "Beanie", level: 3 },
  { id: "cap", name: "Cap", level: 6 },
  { id: "cowboy", name: "Cowboy hat", level: 10 },
  { id: "viking", name: "Viking", level: 15 },
  { id: "tophat", name: "Top hat", level: 18 },
  { id: "crown", name: "Crown", level: 25 },
];

export const EFFECTS: Effect[] = [
  { id: "none", name: "None", level: 1, colors: [] },
  { id: "confetti", name: "Confetti", level: 4, colors: [0xff4f5e, 0xffd23f, 0x4fd1ff, 0x7cff6b, 0xc77dff] },
  { id: "stars", name: "Stars", level: 9, colors: [0xffd23f, 0xfff6b0, 0xffb020] },
  { id: "hearts", name: "Hearts", level: 14, colors: [0xff5fa2, 0xff2f6d, 0xffb3d1] },
];

export type Look = { paint: string; hat: string; effect: string };
export const DEFAULT_LOOK: Look = { paint: "classic", hat: "helmet", effect: "none" };

export const paintOf = (id: string) => PAINTS.find((p) => p.id === id) ?? PAINTS[0];
export const effectOf = (id: string) => EFFECTS.find((e) => e.id === id) ?? EFFECTS[0];

/** Over the network a look travels as "paint.hat.effect". */
export const encodeLook = (l: Look) => `${l.paint}.${l.hat}.${l.effect}`;
export function decodeLook(s: string | undefined): Look {
  const [paint, hat, effect] = (s ?? "").split(".");
  return {
    paint: PAINTS.some((p) => p.id === paint) ? paint : DEFAULT_LOOK.paint,
    hat: HATS.some((h) => h.id === hat) ? hat : DEFAULT_LOOK.hat,
    effect: EFFECTS.some((e) => e.id === effect) ? effect : DEFAULT_LOOK.effect,
  };
}

/** Every unlock in level order, for "you unlocked …" and the locker. */
export const UNLOCKS = [
  ...PAINTS.map((i) => ({ kind: "paint" as const, item: i })),
  ...HATS.map((i) => ({ kind: "hat" as const, item: i })),
  ...EFFECTS.map((i) => ({ kind: "effect" as const, item: i })),
].filter((u) => u.item.level > 1).sort((a, b) => a.item.level - b.item.level);
