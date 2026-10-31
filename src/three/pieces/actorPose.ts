import type { PieceSymbol, Square } from 'chess.js'
import type {
  AnimCommand,
  CheckmateFallCommand,
  DeathCommand,
  LungeCommand,
  MoveCommand,
  PromotionTransformCommand,
  SettleImpactCommand,
} from '../../game/types'
import { pointShortOf, squareDir, squareToXZ } from '../coords'

/**
 * actorPose — the pure math PieceActor executes. Given an actor's resting
 * state, its director commands and the time `t` (ms) on the move's sequence
 * clock, it returns the full visual pose: position, tilt (toppling / leaning /
 * wobbling about the base rim), squash-scale, flash/glow, visibility and which
 * piece geometry to show. No three.js objects — fully unit-testable.
 */

/** Knight hop apex height — kept pronounced (Jon play-test directive). */
export const ARC_HEIGHT = 0.65
/** Subtle walk-bob amplitude for non-knights (≈ one bob per tile). */
export const BOB_HEIGHT = 0.08
/** Landing settle: peak vertical squash (fraction of height) right after touchdown. */
export const LAND_SQUASH = 0.14
/** Landing settle: tiny rebound hop (world units) during the stretch lobe. */
export const LAND_REBOUND = 0.05
/** The post-capture settle uses a lighter squash than a quiet landing. */
export const SETTLE_SQUASH_SCALE = 0.6
/** Forward lean (rad) at the lunge's impact frame. */
export const LUNGE_LEAN = 0.32
/** easeInBack overshoot for the lunge — a small anticipation pull-back before the strike. */
export const LUNGE_WINDUP = 1.2
/** Fraction of a death spent toppling before the piece shatters into shards. */
export const DEATH_FALL_FRACTION = 0.36
/** How far (world units) the blow knocks the victim back while it topples. */
export const DEATH_KNOCKBACK = 0.18
/** Checkmate fall: tail fraction spent on the small rebound after hitting the board. */
export const MATE_BOUNCE_FRACTION = 0.12
/** Checkmate fall: rebound angle (rad). */
export const MATE_BOUNCE_ANGLE = 0.08
/** Promotion: how small the pawn shrinks before the swap (and the new piece starts). */
export const PROMOTION_MIN_SCALE = 0.12
/** Check alarm: wobble tilt (rad), scale pulse, red glow strength, fade in/out time. */
export const ALARM_TILT = 0.13
export const ALARM_PULSE = 0.06
export const ALARM_GLOW = 0.75
export const ALARM_RAMP_MS = 160

/** Where an actor rests when no command is moving it. */
export type RestState = { square: Square; type: PieceSymbol }

export type ActorPose = {
  /** World position of the piece's base center. */
  x: number
  y: number
  z: number
  /** Unit ground direction the piece tilts toward (pivot = its base rim on that side). */
  tiltX: number
  tiltZ: number
  /** Tilt angle in radians (0 = upright, PI/2 = lying on its side). */
  tiltAngle: number
  /** Scale about the base center: horizontal (x/z) and vertical (y). */
  scaleXZ: number
  scaleY: number
  /** White promotion flash, 0..1. */
  flash: number
  /** Red check-alarm glow, 0..1. */
  alarmGlow: number
  /** False once the piece has shattered. */
  visible: boolean
  /** Geometry to show (a promoting pawn stays a pawn until the swap). */
  type: PieceSymbol
}

type Positional = MoveCommand | LungeCommand | SettleImpactCommand

// ---- easing ----

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
/** Cubic ease-in-out (matches the camera rig's easing). */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
export function easeInQuad(t: number): number {
  return t * t
}
export function easeInCubic(t: number): number {
  return t * t * t
}
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
/** Overshoots past 1 then settles — the promoted piece "pops" in. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
/** Dips slightly below 0 first (anticipation) then accelerates to 1. */
export function easeInBack(t: number, overshoot = LUNGE_WINDUP): number {
  return (overshoot + 1) * t * t * t - overshoot * t * t
}

/**
 * Landing settle curve: 0 at touchdown, a squash lobe, a smaller stretch
 * (rebound) lobe, a tiny third lobe, back to exactly 0 at the end.
 */
export function landingOffset(v: number): number {
  const c = clamp01(v)
  return Math.sin(c * Math.PI * 3) * (1 - c) * (1 - c)
}

/** Chebyshev tile distance (a king-step counts 1), floored at 1. */
function chebyshevTiles(from: Square, to: Square): number {
  const df = Math.abs(from.charCodeAt(0) - to.charCodeAt(0))
  const dr = Math.abs(Number(from[1]) - Number(to[1]))
  return Math.max(df, dr, 1)
}

/** Upright, full-size pose standing on `rest.square`. */
export function restPose(rest: RestState): ActorPose {
  const [x, z] = squareToXZ(rest.square)
  return {
    x,
    y: 0,
    z,
    tiltX: 0,
    tiltZ: -1,
    tiltAngle: 0,
    scaleXZ: 1,
    scaleY: 1,
    flash: 0,
    alarmGlow: 0,
    visible: true,
    type: rest.type,
  }
}

function isPositional(c: AnimCommand): c is Positional {
  return c.type === 'move' || c.type === 'lunge' || c.type === 'settle-impact'
}

function setTilt(pose: ActorPose, dir: [number, number], angle: number): void {
  pose.tiltX = dir[0]
  pose.tiltZ = dir[1]
  pose.tiltAngle = angle
}

/** Walk / hop toward the target, then (quiet arrivals) the landing settle. */
function applyMove(c: MoveCommand, local: number, pose: ActorPose): void {
  const walkMs = Math.max(0, c.durationMs - c.landMs)
  const u = walkMs > 0 ? clamp01(local / walkMs) : 1
  const [fx, fz] = squareToXZ(c.from)
  const [tx, tz] = pointShortOf(c.from, c.to, c.stopShortTiles)
  const e = easeInOut(u)
  pose.x = fx + (tx - fx) * e
  pose.z = fz + (tz - fz) * e
  pose.y = c.arc
    ? ARC_HEIGHT * 4 * u * (1 - u) // parabola, apex at u = 0.5
    : BOB_HEIGHT * Math.abs(Math.sin(u * Math.PI * chebyshevTiles(c.from, c.to)))

  if (c.landMs > 0 && local > walkMs) {
    const off = landingOffset((local - walkMs) / c.landMs)
    pose.scaleY *= 1 - LAND_SQUASH * off
    pose.scaleXZ *= 1 + LAND_SQUASH * 0.5 * off
    pose.y = Math.max(0, -off) * LAND_REBOUND
  }
}

/** The strike: short wind-up, accelerating dash to the impact point, leaning in. */
function applyLunge(c: LungeCommand, local: number, pose: ActorPose): void {
  const u = c.durationMs > 0 ? clamp01(local / c.durationMs) : 1
  const [sx, sz] = pointShortOf(c.from, c.to, c.fromShortTiles)
  const [ex, ez] = pointShortOf(c.from, c.to, c.stopShortTiles)
  const e = easeInBack(u)
  pose.x = sx + (ex - sx) * e
  pose.z = sz + (ez - sz) * e
  pose.y = 0
  setTilt(pose, squareDir(c.from, c.to), LUNGE_LEAN * easeInQuad(u))
}

/** After impact: ease onto the captured square while the lean recovers, landing with a thud. */
function applySettleImpact(c: SettleImpactCommand, local: number, pose: ActorPose): void {
  const u = c.durationMs > 0 ? clamp01(local / c.durationMs) : 1
  const [sx, sz] = pointShortOf(c.from, c.to, c.fromShortTiles)
  const [ex, ez] = squareToXZ(c.to)
  const e = easeOutCubic(u)
  pose.x = sx + (ex - sx) * e
  pose.z = sz + (ez - sz) * e
  pose.y = 0
  setTilt(pose, squareDir(c.from, c.to), LUNGE_LEAN * (1 - e))
  // Arrival settle: a short squash/rebound as the attacker plants on the square.
  const off = landingOffset(u)
  pose.scaleY *= 1 - LAND_SQUASH * SETTLE_SQUASH_SCALE * off
  pose.scaleXZ *= 1 + LAND_SQUASH * SETTLE_SQUASH_SCALE * 0.5 * off
}

function applyPositional(c: Positional, local: number, pose: ActorPose): void {
  switch (c.type) {
    case 'move':
      return applyMove(c, local, pose)
    case 'lunge':
      return applyLunge(c, local, pose)
    case 'settle-impact':
      return applySettleImpact(c, local, pose)
  }
}

/** Defender: knocked back while toppling away from the attacker, then shatters (hidden). */
function applyDeath(c: DeathCommand, t: number, pose: ActorPose): void {
  if (t < c.delayMs) return
  const u = c.durationMs > 0 ? clamp01((t - c.delayMs) / c.durationMs) : 1
  const fall = clamp01(u / DEATH_FALL_FRACTION)
  const dir = squareDir(c.attackerFrom, c.square)
  const [sx, sz] = squareToXZ(c.square)
  const push = DEATH_KNOCKBACK * easeOutQuad(fall)
  pose.x = sx + dir[0] * push
  pose.z = sz + dir[1] * push
  setTilt(pose, dir, (Math.PI / 2) * easeInQuad(fall))
  pose.visible = u < DEATH_FALL_FRACTION
}

/** Promotion: shrink + flash → swap geometry → grow (with a slight pop). */
function applyPromotion(c: PromotionTransformCommand, t: number, pose: ActorPose): void {
  if (t < c.delayMs) {
    pose.type = c.fromType // still walking as a pawn
    return
  }
  const local = t - c.delayMs
  if (local < c.swapAtMs) {
    const k = c.swapAtMs > 0 ? local / c.swapAtMs : 1
    const s = 1 - (1 - PROMOTION_MIN_SCALE) * easeInQuad(k)
    pose.scaleXZ *= s
    pose.scaleY *= s
    pose.flash = Math.max(pose.flash, easeInQuad(k))
    pose.type = c.fromType
    return
  }
  const growMs = c.durationMs - c.swapAtMs
  const k = growMs > 0 ? clamp01((local - c.swapAtMs) / growMs) : 1
  const s = PROMOTION_MIN_SCALE + (1 - PROMOTION_MIN_SCALE) * easeOutBack(k)
  pose.scaleXZ *= s
  pose.scaleY *= s
  pose.flash = Math.max(pose.flash, 1 - easeOutQuad(k))
  pose.type = c.toType
}

/** Mated king: slow accelerating topple, small rebound on the board, stays down. */
function applyCheckmateFall(c: CheckmateFallCommand, t: number, pose: ActorPose): void {
  if (t < c.delayMs) return
  const u = c.durationMs > 0 ? clamp01((t - c.delayMs) / c.durationMs) : 1
  const fallEnd = 1 - MATE_BOUNCE_FRACTION
  let angle: number
  if (u < fallEnd) {
    angle = (Math.PI / 2) * easeInCubic(u / fallEnd)
  } else {
    const b = (u - fallEnd) / MATE_BOUNCE_FRACTION
    angle = Math.PI / 2 - MATE_BOUNCE_ANGLE * Math.sin(Math.PI * b)
  }
  setTilt(pose, squareDir(c.fallAwayFrom, c.square), angle)
}

/**
 * The actor's pose at time `t` (ms since its sequence started). Looping
 * commands (the check alarm) are not applied here — see `withAlarm`, which
 * PieceActor composites with its own fade in/out weight.
 */
export function actorPoseAt(
  rest: RestState,
  commands: readonly AnimCommand[],
  t: number,
): ActorPose {
  const pose = restPose(rest)

  // Position: the latest positional command that has started (or the first
  // one, held at its origin, if none has started yet).
  let current: Positional | null = null
  for (const c of commands) {
    if (!isPositional(c)) continue
    if (current === null || c.delayMs <= t) current = c
  }
  if (current) applyPositional(current, Math.max(0, t - current.delayMs), pose)

  for (const c of commands) {
    switch (c.type) {
      case 'death':
        applyDeath(c, t, pose)
        break
      case 'promotion-transform':
        applyPromotion(c, t, pose)
        break
      case 'checkmate-fall':
        applyCheckmateFall(c, t, pose)
        break
      default:
        break
    }
  }
  return pose
}

/**
 * Composite the check-alarm loop onto a pose: a precessing wobble on the base
 * rim, a scale pulse and a red glow. `phaseMs` = time since the alarm began,
 * `weight` (0..1) fades it in when check starts and out when it is resolved.
 */
export function withAlarm(
  pose: ActorPose,
  phaseMs: number,
  weight: number,
  periodMs: number,
): ActorPose {
  const w = clamp01(weight)
  if (w === 0 || periodMs <= 0) return pose
  const cycle = (2 * Math.PI * phaseMs) / periodMs
  const pulse = 0.5 - 0.5 * Math.cos(2 * cycle) // 0..1, two pulses per wobble cycle
  const out: ActorPose = { ...pose }
  if (pose.tiltAngle === 0) {
    out.tiltX = Math.cos(cycle)
    out.tiltZ = Math.sin(cycle)
    out.tiltAngle = ALARM_TILT * w * (0.7 + 0.3 * pulse)
  }
  const s = 1 + ALARM_PULSE * w * pulse
  out.scaleXZ *= s
  out.scaleY *= s
  out.alarmGlow = Math.max(pose.alarmGlow, w * ALARM_GLOW * (0.4 + 0.6 * pulse))
  return out
}
