const held = new Set<string>();
// Keys pressed since the last tick. A tap shorter than one 16 ms tick would otherwise be missed.
const pressed = new Set<string>();
let mouseDX = 0, mouseDY = 0, wheel = 0;

addEventListener("keydown", (e) => {
  if (!e.repeat) pressed.add(e.code);
  held.add(e.code);
  if (e.code === "Space" || e.code === "Tab") e.preventDefault();
});
addEventListener("keyup", (e) => held.delete(e.code));
addEventListener("blur", () => held.clear());
addEventListener("mousedown", (e) => {
  if (!locked()) return;
  held.add(`Mouse${e.button}`);
  pressed.add(`Mouse${e.button}`);
});
addEventListener("mouseup", (e) => held.delete(`Mouse${e.button}`));
addEventListener("mousemove", (e) => {
  if (!locked()) return;
  mouseDX += e.movementX;
  mouseDY += e.movementY;
});
addEventListener("wheel", (e) => { if (locked()) wheel += Math.sign(e.deltaY); });
addEventListener("contextmenu", (e) => e.preventDefault());

export const locked = () => document.pointerLockElement !== null;
export const isDown = (code: string) => held.has(code);

/** Mouse movement since the last call, in pixels. */
export function takeMouse(): [number, number] {
  const d: [number, number] = [mouseDX, mouseDY];
  mouseDX = mouseDY = 0;
  return d;
}

/** Input for one tick; call once per tick (it consumes the pressed-since-last-tick set). */
export function axes() {
  const down = (code: string) => held.has(code) || pressed.has(code);
  const a = {
    forward: (down("KeyW") ? 1 : 0) - (down("KeyS") ? 1 : 0),
    right: (down("KeyD") ? 1 : 0) - (down("KeyA") ? 1 : 0),
    jump: down("Space"),
    // Not Ctrl: Ctrl+W (crouch + forward) closes the tab and a page can't block it outside fullscreen.
    crouch: down("KeyC"),
    walk: down("ShiftLeft"),
    fire: down("Mouse0"),
    reload: down("KeyR"),
  };
  // presses, not holds: weapon choice and the scope toggle
  const keys = {
    slot: ["Digit1", "Digit2", "Digit3"].findIndex((k) => pressed.has(k)),
    lastWeapon: pressed.has("KeyQ"),
    wheel,
    scope: pressed.has("Mouse2"),
  };
  wheel = 0;
  pressed.clear();
  return { ...a, ...keys };
}
