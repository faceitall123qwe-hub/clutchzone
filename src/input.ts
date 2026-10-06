const held = new Set<string>();

addEventListener("keydown", (e) => held.add(e.code));
addEventListener("keyup", (e) => held.delete(e.code));
addEventListener("blur", () => held.clear());

export const isDown = (code: string) => held.has(code);

/** WASD / arrows as a vector on the ground plane: x = right, y = forward, length <= 1. */
export function moveAxis(): { x: number; y: number } {
  const x = (isDown("KeyD") || isDown("ArrowRight") ? 1 : 0) - (isDown("KeyA") || isDown("ArrowLeft") ? 1 : 0);
  const y = (isDown("KeyW") || isDown("ArrowUp") ? 1 : 0) - (isDown("KeyS") || isDown("ArrowDown") ? 1 : 0);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}
