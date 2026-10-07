// Movement tuned after Counter-Strike's defaults, converted at 1 Hammer unit ≈ 2.54 cm.
export const TICK = 1 / 60;

export const PLAYER_RADIUS = 0.3; // half of the 0.6 m wide bounding box
export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.2;
export const STAND_EYE = 1.62;
export const CROUCH_EYE = 1.08;
export const STEP_HEIGHT = 0.45; // stairs and small ledges are walked up without jumping

export const MAX_SPEED = 6.35; // 250 u/s
export const WALK_FACTOR = 0.52; // shift-walk
export const CROUCH_FACTOR = 0.34;
export const GROUND_ACCEL = 5.5; // sv_accelerate
export const AIR_ACCEL = 12; // sv_airaccelerate
export const AIR_WISH_CAP = 0.762; // 30 u/s: the cap that makes air strafing work
export const FRICTION = 5.2;
export const STOP_SPEED = 2.54; // 100 u/s
export const GRAVITY = 20.3; // 800 u/s²
export const JUMP_SPEED = 6.8; // ≈ 1.15 m jump: clears a 1 m crate
export const BHOP_CAP = 1.2; // horizontal speed is clamped to this × MAX_SPEED at take-off, as in CS 1.6
