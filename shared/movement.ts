import { blocked, moveAxis, type Box, type Vec3 } from "./collision.ts";
import * as C from "./constants.ts";

export type PlayerState = {
  pos: Vec3; // feet, centre of the bounding box's bottom face
  vel: Vec3;
  onGround: boolean;
  crouched: boolean;
  jumpHeld: boolean; // no auto-bunnyhop: jump fires on press, not while held
};

export type MoveInput = {
  forward: number; // -1..1
  right: number; // -1..1
  yaw: number; // radians, 0 looks down -Z
  jump: boolean;
  crouch: boolean;
  walk: boolean;
};

export const newPlayer = (x = 0, y = 0, z = 0): PlayerState => ({
  pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, onGround: false, crouched: false, jumpHeld: false,
});

export const height = (s: PlayerState) => (s.crouched ? C.CROUCH_HEIGHT : C.STAND_HEIGHT);
export const eyeHeight = (s: PlayerState) => (s.crouched ? C.CROUCH_EYE : C.STAND_EYE);

const R = C.PLAYER_RADIUS;
const CROUCH_DELTA = C.STAND_HEIGHT - C.CROUCH_HEIGHT;

function setCrouch(s: PlayerState, want: boolean, boxes: readonly Box[]): void {
  if (want === s.crouched) return;
  if (want) {
    // In the air the legs come up instead of the head going down: the crouch-jump.
    if (!s.onGround) s.pos.y += CROUCH_DELTA;
    s.crouched = true;
    return;
  }
  const feetY = s.onGround ? s.pos.y : s.pos.y - CROUCH_DELTA;
  const probe = { x: s.pos.x, y: feetY, z: s.pos.z };
  if (!blocked(probe, R, C.STAND_HEIGHT, boxes)) {
    s.pos.y = feetY;
    s.crouched = false;
  }
}

function friction(v: Vec3, dt: number): void {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 0.05) { v.x = 0; v.z = 0; return; }
  const drop = Math.max(speed, C.STOP_SPEED) * C.FRICTION * dt;
  const scale = Math.max(speed - drop, 0) / speed;
  v.x *= scale;
  v.z *= scale;
}

function accelerate(v: Vec3, dx: number, dz: number, wishSpeed: number, accel: number, maxSpeed: number,
                    dt: number): void {
  const current = v.x * dx + v.z * dz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const gain = Math.min(accel * maxSpeed * dt, add);
  v.x += gain * dx;
  v.z += gain * dz;
}

/** Horizontal slide; returns which axes were blocked. */
function slide(p: Vec3, dx: number, dz: number, h: number, boxes: readonly Box[]) {
  return { x: moveAxis(p, 0, dx, R, h, boxes), z: moveAxis(p, 2, dz, R, h, boxes) };
}

export function stepPlayer(s: PlayerState, cmd: MoveInput, dt: number, boxes: readonly Box[]): void {
  setCrouch(s, cmd.crouch, boxes);

  // wish direction from view yaw: forward = (-sin, -cos), right = (cos, -sin)
  const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
  let wx = -sin * cmd.forward + cos * cmd.right;
  let wz = -cos * cmd.forward - sin * cmd.right;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  const factor = s.crouched ? C.CROUCH_FACTOR : cmd.walk ? C.WALK_FACTOR : 1;
  const wishSpeed = len > 0 ? C.MAX_SPEED * factor : 0;

  const jumpPressed = cmd.jump && !s.jumpHeld;
  s.jumpHeld = cmd.jump;
  if (s.onGround && jumpPressed) {
    s.vel.y = C.JUMP_SPEED;
    s.onGround = false;
  }

  if (s.onGround) {
    friction(s.vel, dt);
    accelerate(s.vel, wx, wz, wishSpeed, C.GROUND_ACCEL, C.MAX_SPEED * factor, dt);
  } else {
    accelerate(s.vel, wx, wz, Math.min(wishSpeed, C.AIR_WISH_CAP), C.AIR_ACCEL, C.MAX_SPEED, dt);
  }

  const h = height(s);
  const dx = s.vel.x * dt, dz = s.vel.z * dt;
  const start = { ...s.pos };
  const hit = slide(s.pos, dx, dz, h, boxes);

  // Step up: if a grounded move was blocked, retry it one step higher and settle back down.
  if (s.onGround && (hit.x || hit.z)) {
    const up = { ...start, y: start.y + C.STEP_HEIGHT };
    if (!blocked(up, R, h, boxes)) {
      const upHit = slide(up, dx, dz, h, boxes);
      moveAxis(up, 1, -C.STEP_HEIGHT - 0.01, R, h, boxes);
      const plain = Math.hypot(s.pos.x - start.x, s.pos.z - start.z);
      const stepped = Math.hypot(up.x - start.x, up.z - start.z);
      if (stepped > plain + 1e-4 && up.y >= start.y) {
        Object.assign(s.pos, up);
        hit.x = upHit.x;
        hit.z = upHit.z;
      }
    }
  }
  if (hit.x) s.vel.x = 0;
  if (hit.z) s.vel.z = 0;

  s.vel.y -= C.GRAVITY * dt;
  const falling = s.vel.y < 0;
  if (moveAxis(s.pos, 1, s.vel.y * dt, R, h, boxes)) {
    s.onGround = falling;
    s.vel.y = 0;
  } else {
    s.onGround = false;
  }
}

