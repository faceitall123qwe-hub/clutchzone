import type { MapDef } from "./map.ts";
import { OUTPOST } from "./maps/outpost.ts";
import { PLAZA } from "./maps/plaza.ts";
import { REACTOR } from "./maps/reactor.ts";
import { SKYLINE } from "./maps/skyline.ts";

/** Every map played online, in the order a room plays them. */
export const MAPS: MapDef[] = [PLAZA, REACTOR, SKYLINE];

/** Outpost is the offline shooting range (and what the tests are written against), not in the rotation. */
export const mapById = (id: string | null | undefined): MapDef => [...MAPS, OUTPOST].find((m) => m.id === id) ?? MAPS[0];

/** The map after this one in the rotation. */
export const nextMap = (map: MapDef): MapDef => MAPS[(MAPS.indexOf(map) + 1) % MAPS.length];
