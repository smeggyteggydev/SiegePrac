/**
 * Central tuning table for SIEGEprac.
 *
 * Every number that affects game feel lives here so balancing never requires
 * hunting through systems. Units: metres, seconds, metres/second.
 * The simulation runs at a fixed SIM_HZ tick; all rates are expressed per second.
 */

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

// ─── Body ─────────────────────────────────────────────────────────────────────
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_HEIGHT_CROUCH = 1.5;
export const EYE_HEIGHT = 1.62;
export const EYE_HEIGHT_CROUCH = 1.32;
export const STEP_HEIGHT = 0.55;

// ─── Movement ─────────────────────────────────────────────────────────────────
export const PLAYER_SPEED = 4.3; // walk
export const SPRINT_SPEED = 5.6;
export const CROUCH_SPEED = 1.35;
export const BLOCK_SPEED = 1.6; // while holding block
export const EAT_SPEED = 1.4; // while consuming
export const STRAFE_SPEED_FACTOR = 0.98; // diagonal/strafe multiplier (keeps strafing viable)
export const BACKPEDAL_FACTOR = 0.92;

/** Exponential approach rate toward target velocity on ground (1/s). Higher = snappier. */
export const GROUND_ACCEL = 13.5;
/** Friction toward zero when no input on ground (1/s). */
export const GROUND_FRICTION = 16.0;
/** Horizontal air drag (1/s): 0.91 per 20 Hz tick ≈ 1.89/s. */
export const AIR_DRAG = 1.89;
/** Linear air acceleration from input (m/s²): terminal ≈ accel / drag. */
export const AIR_ACCEL = 8.0;
export const AIR_ACCEL_SPRINT = 10.4;

export const GRAVITY = 30.0;
export const TERMINAL_VELOCITY = 55;
export const JUMP_FORCE = 8.3; // ≈1.15 m apex — clears one block
/** Forward impulse added when jumping while sprinting (sprint-jump). */
export const SPRINT_JUMP_BOOST = 1.6;
export const MAX_SPRINT_JUMP_SPEED = 7.2;
/** Coyote time — allows a jump shortly after leaving a ledge. */
export const COYOTE_TIME = 0.08;
/** Jump buffer — a jump pressed slightly before landing still fires. */
export const JUMP_BUFFER = 0.1;
export const JUMP_COOLDOWN = 0.12;

/** Hitting while sprinting drops sprint and multiplies attacker horizontal speed. */
export const SPRINT_HIT_SLOWDOWN = 0.6;

// ─── Combat ───────────────────────────────────────────────────────────────────
export const MAX_HEALTH = 20;
export const ATTACK_RANGE = 3.0; // eye → hitbox surface
export const HITBOX_INFLATE = 0.15; // added to each side of the body box for hit tests
/** Minimum time between swings. Low: clicking fast matters, like classic PvP. */
export const ATTACK_COOLDOWN = 0.05;
/** After taking a hit, a fighter can't take another for this long (the "hit window"). */
export const HURT_INVULN = 0.45;
/** Visual hurt flash / hitstun duration. */
export const HITSTUN_TIME = 0.32;
/** While in hitstun the victim's input steering is weakened by this factor. */
export const HITSTUN_CONTROL = 0.35;

export const BASE_DAMAGE = 3.0;
export const CRIT_MULTIPLIER = 1.5;
/** Blocking reduces incoming damage by this factor. */
export const BLOCK_DAMAGE_FACTOR = 0.5;
export const BLOCK_KNOCKBACK_FACTOR = 0.8;

/** Base horizontal knockback velocity applied to victim (m/s). */
export const KNOCKBACK_HORIZONTAL = 6.4;
/** Vertical knockback velocity (m/s). */
export const KNOCKBACK_VERTICAL = 7.2;
/** Extra horizontal knockback for a fresh sprint hit (m/s). */
export const KNOCKBACK_SPRINT_BONUS = 2.8;
export const KNOCKBACK_SPRINT_VERTICAL_BONUS = 0.6;
/** Portion of victim's existing velocity preserved when knocked (0 = full reset). */
export const KNOCKBACK_VELOCITY_KEEP = 0.5;
/** Cap on vertical knockback so airborne victims aren't launched. */
export const KNOCKBACK_VERTICAL_MAX = 7.8;
/** Knockback applied to airborne victims is scaled by this (tighter air combos). */
export const KNOCKBACK_AIR_FACTOR = 0.9;
/** Small random knockback variance (fraction) so fights don't feel robotic. */
export const KNOCKBACK_VARIANCE = 0.06;

export const COMBO_TIMEOUT = 1.35; // seconds without a hit before the combo drops
export const COMBO_BREAK_DISTANCE = 7.5;

// ─── Consumables ──────────────────────────────────────────────────────────────
export const EAT_TIME = 1.6;
export const GAPPLE_HEAL = 4;
export const GAPPLE_REGEN = 4; // extra healed over REGEN_TIME
export const GAPPLE_REGEN_TIME = 5;
export const GAPPLE_ABSORB = 4;

// ─── NoDebuff ─────────────────────────────────────────────────────────────────
export const POT_HEAL = 8; // Instant Health II at full splash effectiveness
export const POT_RADIUS = 4;
export const POT_SPEED = 10; // m/s (0.5 b/t)
export const POT_GRAVITY = 20;
export const POT_PITCH_OFFSET = 0.35; // thrown ~20° above aim
export const PEARL_SPEED = 30;
export const PEARL_GRAVITY = 12;
export const PEARL_COOLDOWN = 10;
export const PEARL_DAMAGE = 2.5;
export const THROW_COOLDOWN = 0.2; // right-click repeat delay
export const SPEED_EFFECT_TIME = 90;
export const SPEED_EFFECT_MULT = 1.4; // Speed II

// ─── Bot ──────────────────────────────────────────────────────────────────────
export const BOT_REACTION_TIME = 0.16; // Normal

// ─── World ────────────────────────────────────────────────────────────────────
/** Falling below this (into the lake) eliminates the fighter. */
export const VOID_Y = -3.0;
export const RESPAWN_DELAY = 1.6;
export const ROUND_COUNTDOWN = 3.0;
