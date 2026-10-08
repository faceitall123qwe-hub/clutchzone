import type { MapDef } from "./map.ts";
import { DOCKYARD } from "./maps/dockyard.ts";
import { FROSTBITE } from "./maps/frostbite.ts";
import { OUTPOST } from "./maps/outpost.ts";

/** Every map, in the order a room plays them. */
export const MAPS: MapDef[] = [OUTPOST, DOCKYARD, FROSTBITE];

export const mapById = (id: string | null | undefined): MapDef => MAPS.find((m) => m.id === id) ?? OUTPOST;

/** The map after this one in the rotation. */
export const nextMap = (map: MapDef): MapDef => MAPS[(MAPS.indexOf(map) + 1) % MAPS.length];
