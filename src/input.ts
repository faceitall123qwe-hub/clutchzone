const held = new Set<string>();
let mouseDX = 0, mouseDY = 0;

addEventListener("keydown", (e) => {
  held.add(e.code);
  if (e.code === "Space" || e.code === "Tab") e.preventDefault();
});
addEventListener("keyup", (e) => held.delete(e.code));
addEventListener("blur", () => held.clear());
addEventListener("mousedown", (e) => { if (locked()) held.add(`Mouse${e.button}`); });
addEventListener("mouseup", (e) => held.delete(`Mouse${e.button}`));
addEventListener("mousemove", (e) => {
  if (!locked()) return;
  mouseDX += e.movementX;
  mouseDY += e.movementY;
});
addEventListener("contextmenu", (e) => e.preventDefault());

export const locked = () => document.pointerLockElement !== null;
export const isDown = (code: string) => held.has(code);

/** Mouse movement since the last call, in pixels. */
export function takeMouse(): [number, number] {
  const d: [number, number] = [mouseDX, mouseDY];
  mouseDX = mouseDY = 0;
  return d;
}

export function axes() {
  return {
    forward: (isDown("KeyW") ? 1 : 0) - (isDown("KeyS") ? 1 : 0),
    right: (isDown("KeyD") ? 1 : 0) - (isDown("KeyA") ? 1 : 0),
    jump: isDown("Space"),
    // Not Ctrl: Ctrl+W (crouch + forward) closes the tab and a page can't block it outside fullscreen.
    crouch: isDown("KeyC"),
    walk: isDown("ShiftLeft"),
    fire: isDown("Mouse0"),
    reload: isDown("KeyR"),
  };
}
