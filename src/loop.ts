/**
 * Fixed-timestep game loop: game logic always advances in STEP-second ticks, so movement and
 * physics behave the same at 30 or 144 FPS; rendering happens once per animation frame.
 */
export const STEP = 1 / 60;
const MAX_FRAME = 0.25; // after a long stall (tab in background) don't try to catch up for minutes

export function startLoop(update: (dt: number) => void, render: (alpha: number) => void): void {
  let last = performance.now() / 1000;
  let acc = 0;
  const frame = (nowMs: number) => {
    const now = nowMs / 1000;
    acc += Math.min(now - last, MAX_FRAME);
    last = now;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
    render(acc / STEP);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
