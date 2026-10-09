/**
 * Builds public/assets/models/*.glb from Quaternius' Toon Shooter Game Kit (CC0, quaternius.com):
 * the two soldiers with only our three guns and the animations we play, and the props in one file.
 *
 *   node scripts/models.ts <kit folder>   # the folder holding Characters/, Environment/ (glTF exports)
 */
import { mkdirSync } from "node:fs";
import { Document, NodeIO } from "@gltf-transform/core";
import { dedup, mergeDocuments, prune, resample, unpartition } from "@gltf-transform/functions";

const kit = process.argv[2];
const OUT = "public/assets/models";
mkdirSync(OUT, { recursive: true });
const io = new NodeIO();

const GUNS = ["AK", "Pistol", "Sniper"]; // our rifle, pistol and sniper, in WEAPONS order
const ANIMS = ["Idle", "Idle_Shoot", "Run_Gun", "Run_Shoot", "Walk", "Walk_Shoot", "Duck", "Death", "Jump_Idle", "HitReact"];
const CHARACTERS = { attacker: "Character_Enemy", defender: "Character_Soldier" };
const PROPS = ["Container_Long", "Container_Small", "Crate", "CardboardBoxes_1", "SackTrench", "SackTrench_Small",
  "ExplodingBarrel", "Pallet", "TrafficCone", "Debris_Tires", "Barrier_Single"];

async function slim(doc: Document): Promise<void> {
  await doc.transform(prune(), dedup(), resample(), unpartition());
}

for (const [role, file] of Object.entries(CHARACTERS)) {
  const doc = await io.read(`${kit}/Characters/glTF/${file}.gltf`);
  const root = doc.getRoot();
  // every gun of the kit hangs from the right hand; keep ours
  const gunNodes = root.listNodes().filter((n) => n.getMesh() && !n.getSkin() && n.listParents().some((p) => p.propertyType === "Node")
    && /^(AK|GrenadeLauncher|Knife_\d|Pistol|Revolver(_Small)?|RocketLauncher|ShortCannon|Shotgun|Shovel|SMG|Sniper(_2)?)$/.test(n.getName()));
  for (const n of gunNodes) if (!GUNS.includes(n.getName())) n.dispose();
  for (const a of root.listAnimations()) if (!ANIMS.includes(a.getName())) a.dispose();
  await slim(doc);
  await io.write(`${OUT}/${role}.glb`, doc);
  console.log(role, root.listNodes().length, "nodes,", root.listAnimations().map((a) => a.getName()).join(" "));
}

const props = new Document();
for (const name of PROPS) {
  const doc = await io.read(`${kit}/Environment/glTF/${name}.gltf`);
  for (const s of doc.getRoot().listScenes()) s.setName(name);
  mergeDocuments(props, doc);
}
await slim(props);
await io.write(`${OUT}/props.glb`, props);
console.log("props:", props.getRoot().listScenes().map((s) => s.getName()).join(" "));
