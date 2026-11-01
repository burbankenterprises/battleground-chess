import { hashString, mulberry32 } from '../effects/shatter'

/**
 * Arena layout (Phase 5): pure, deterministic data + math for the torchlit
 * desert battlefield around the board — sand floor, horizon hills, scattered
 * rocks, the four corner torches (flicker) and the drifting dust motes. No
 * three.js objects here, so every number is unit-tested (arena.test.ts);
 * arena.ts turns the data into meshes.
 */

export type Vec3 = [number, number, number]

const TAU = Math.PI * 2

// ---- scene tones ----

/** The dark night background the whole scene keeps (canvas clear color + sky zenith). */
export const SCENE_BACKGROUND = '#0b0d12'
/**
 * Linear fog toward the background. three fogs by view depth; the farthest
 * board point (plate corner, 6.01 from the center) is at most
 * CAMERA_MAX_DISTANCE + 6.01 ≈ 22.0 deep at the widest zoom, so the board is
 * never fogged — only the distant sand and hills fade into the night.
 */
export const CAMERA_MAX_DISTANCE = 16
export const FOG_NEAR = 23
/** Past the hills (so they read as silhouettes) but short of the sky dome, which is never fogged. */
export const FOG_FAR = 75

/** Sky dome: the night zenith matches the background; a low ember band glows along the horizon. */
export const SKY_RADIUS = 70
export const SKY_EMBER = '#5a2c17'
export const SKY_DUSK = '#1d1820'
/** Elevation (rad) at which the ember band has faded into dusk, and dusk into the night zenith. */
export const SKY_EMBER_FADE = 0.1
export const SKY_DUSK_FADE = 0.55

/**
 * Sky color weights at an elevation angle (rad, 0 = horizon): how much of
 * [ember, dusk, night] to mix. Below the horizon (hidden by the sand) is night.
 */
export function skyWeights(elevation: number): { ember: number; dusk: number; night: number } {
  if (elevation <= 0) return { ember: 0, dusk: 0, night: 1 }
  if (elevation < SKY_EMBER_FADE) {
    const u = elevation / SKY_EMBER_FADE
    return { ember: 1 - u, dusk: u, night: 0 }
  }
  if (elevation < SKY_DUSK_FADE) {
    const u = (elevation - SKY_EMBER_FADE) / (SKY_DUSK_FADE - SKY_EMBER_FADE)
    return { ember: 0, dusk: 1 - u, night: u }
  }
  return { ember: 0, dusk: 0, night: 1 }
}

// ---- sand floor ----

/** Sand surface height: the board plate (y −0.41..−0.11) sits sunk into it. */
export const SAND_Y = -0.4
/** Sand disc radius: its rim is ~70% fogged and the sky below the horizon is the night tone, so the edge never shows. */
export const SAND_RADIUS = 60
/** Evening sand right around the board (the torches warm it)… */
export const SAND_NEAR = '#5e4b37'
/** …darkening to dusky sand out in the night. */
export const SAND_FAR = '#1f1913'
/** Radii (from the board center) over which the sand darkens from SAND_NEAR to SAND_FAR. */
export const SAND_FADE_START = 5.5
export const SAND_FADE_END = 17
/** Per-vertex speckle (± fraction of brightness) so the sand never reads as a flat CG plane. */
export const SAND_SPECKLE = 0.07

/** Hermite smoothstep of `v` from `edge0` (0) to `edge1` (1), clamped. */
export function smoothstep(edge0: number, edge1: number, v: number): number {
  const u = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)))
  return u * u * (3 - 2 * u)
}

/** 0 (near tone) → 1 (far tone) at radius `r`, smoothstepped. */
export function sandFade(r: number): number {
  return smoothstep(SAND_FADE_START, SAND_FADE_END, r)
}

/**
 * Dunes: the sand is dead flat around the board and the torches (so nothing
 * floats or sinks), then rolls gently further out.
 */
export const DUNE_START = 9
export const DUNE_FULL = 16
export const DUNE_AMPLITUDE = 0.45

/** Sand surface height at (x, z). Exactly SAND_Y inside DUNE_START. */
export function sandHeightAt(x: number, z: number): number {
  const w = smoothstep(DUNE_START, DUNE_FULL, Math.hypot(x, z))
  if (w === 0) return SAND_Y
  // Two incommensurate swells; |n| ≤ 1.5, normalized to ±1.
  const n =
    (Math.sin(x * 0.31 + 1.7) * Math.cos(z * 0.27 - 0.4) + 0.5 * Math.sin((x + z) * 0.53 + 2.1)) /
    1.5
  return SAND_Y + w * DUNE_AMPLITUDE * n
}

// ---- hills on the horizon ----

export type HillSpec = {
  x: number
  z: number
  yaw: number
  /** Base half-widths along the hill's local x / z, and peak height. */
  width: number
  depth: number
  height: number
  /** Brightness multiplier for this hill's color (0.75..1.15). */
  shade: number
}

export const HILL_COUNT = 18
/** Hill centers sit on this ring… */
export const HILL_RING_MIN = 40
export const HILL_RING_MAX = 52
export const HILL_HEIGHT_MIN = 2.5
export const HILL_HEIGHT_MAX = 7
/** Footprint half-width / half-depth as multiples of the hill's height (low, wide domes). */
export const HILL_WIDTH_MIN = 1.5
export const HILL_WIDTH_MAX = 2.3
export const HILL_DEPTH_MIN = 1.2
export const HILL_DEPTH_MAX = 1.8
/**
 * …so no footprint comes closer to the board than this: always beyond the
 * camera's reach (CAMERA_MAX_DISTANCE) and the fog start — strictly horizon dressing.
 */
export const HILL_MIN_CLEARANCE = 23
export const HILL_COLOR = '#3a2a1e'

/** A deterministic ring of low hills around the arena (evenly spread, jittered). */
export function generateHills(seedKey = 'arena-hills'): HillSpec[] {
  const rand = mulberry32(hashString(seedKey))
  const hills: HillSpec[] = []
  for (let i = 0; i < HILL_COUNT; i++) {
    const angle = ((i + 0.15 + rand() * 0.7) / HILL_COUNT) * TAU
    const radius = HILL_RING_MIN + rand() * (HILL_RING_MAX - HILL_RING_MIN)
    const height = HILL_HEIGHT_MIN + rand() * (HILL_HEIGHT_MAX - HILL_HEIGHT_MIN)
    hills.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      yaw: rand() * TAU,
      width: height * (HILL_WIDTH_MIN + rand() * (HILL_WIDTH_MAX - HILL_WIDTH_MIN)),
      depth: height * (HILL_DEPTH_MIN + rand() * (HILL_DEPTH_MAX - HILL_DEPTH_MIN)),
      height,
      shade: 0.75 + rand() * 0.4,
    })
  }
  return hills
}

// ---- torches ----

/** Torches stand on the sand just outside each corner of the board plate (±4.25). */
export const TORCH_OFFSET = 4.85
/** Pole from the sand up to the brazier. */
export const TORCH_POLE_HEIGHT = 1.55
export const TORCH_POLE_RADIUS = 0.05
/** Bronze brazier bowl on top of the pole. */
export const TORCH_BOWL_HEIGHT = 0.16
export const TORCH_BOWL_TOP_R = 0.17
export const TORCH_BOWL_BOTTOM_R = 0.07
/** Flame tongues (outer, inner) rising from the bowl. */
export const FLAME_OUTER_RADIUS = 0.13
export const FLAME_OUTER_HEIGHT = 0.42
export const FLAME_INNER_RADIUS = 0.075
export const FLAME_INNER_HEIGHT = 0.26
/** Torch light: warm, no shadows (the key sun is the only shadow caster). */
export const TORCH_LIGHT_COLOR = '#ff8a3d'
export const TORCH_LIGHT_INTENSITY = 5
export const TORCH_LIGHT_DISTANCE = 9
export const TORCH_LIGHT_DECAY = 2
/** The light sits inside the flame, this far above the bowl rim. */
export const TORCH_LIGHT_LIFT = 0.18

/** Height of the brazier rim (where the flames start). */
export const TORCH_RIM_Y = SAND_Y + TORCH_POLE_HEIGHT + TORCH_BOWL_HEIGHT

export type TorchSpec = {
  x: number
  z: number
  /** Flicker seed: each torch flickers on its own phase. */
  seed: number
}

export const TORCHES: readonly TorchSpec[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
].map(([sx, sz], i) => ({
  x: sx * TORCH_OFFSET,
  z: sz * TORCH_OFFSET,
  seed: hashString(`torch:${i}`),
}))

// ---- scattered rocks ----

export type RockSpec = {
  x: number
  z: number
  /** Uniform-ish size (world units) and per-axis squash. */
  size: number
  squash: Vec3
  rot: Vec3
  shade: number
}

export const ROCK_COUNT = 16
/** Rocks stay off the board plate and out of the torches' corners. */
export const ROCK_RING_MIN = 7
export const ROCK_RING_MAX = 17
export const ROCK_SIZE_MIN = 0.12
export const ROCK_SIZE_MAX = 0.55
export const ROCK_COLOR = '#6b5843'
/** No rock center closer than this to a torch (keeps the torch bases clear). */
export const ROCK_TORCH_CLEARANCE = 1.2

/** True when (x, z) keeps clear of every torch base. */
function clearOfTorches(x: number, z: number): boolean {
  return TORCHES.every((t) => Math.hypot(t.x - x, t.z - z) >= ROCK_TORCH_CLEARANCE)
}

export function generateRocks(seedKey = 'arena-rocks'): RockSpec[] {
  const rand = mulberry32(hashString(seedKey))
  const rocks: RockSpec[] = []
  // sqrt → uniform over the annulus area, not bunched at the inner edge.
  const r2min = ROCK_RING_MIN * ROCK_RING_MIN
  const r2max = ROCK_RING_MAX * ROCK_RING_MAX
  while (rocks.length < ROCK_COUNT) {
    const angle = rand() * TAU
    const radius = Math.sqrt(r2min + rand() * (r2max - r2min))
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const size = ROCK_SIZE_MIN + rand() * rand() * (ROCK_SIZE_MAX - ROCK_SIZE_MIN) // mostly small
    const squash: Vec3 = [0.8 + rand() * 0.5, 0.45 + rand() * 0.35, 0.8 + rand() * 0.5]
    const rot: Vec3 = [rand() * TAU, rand() * TAU, rand() * TAU]
    const shade = 0.7 + rand() * 0.45
    // Rejection keeps the stream deterministic: same seed → same rocks.
    if (!clearOfTorches(x, z)) continue
    rocks.push({ x, z, size, squash, rot, shade })
  }
  return rocks
}

// ---- torch flicker ----

/** Flicker depth: the multiplier stays within 1 ± FLICKER_DEPTH. */
export const FLICKER_DEPTH = 0.2
/** Three incommensurate sine components (rad/s, weight) — smooth, never visibly periodic. */
const FLICKER_PARTIALS: readonly (readonly [number, number])[] = [
  [7.3, 0.5],
  [13.1, 0.3],
  [23.7, 0.2],
]
/** Largest possible rate of change of the flicker multiplier (per second). */
export const FLICKER_MAX_RATE =
  FLICKER_DEPTH * FLICKER_PARTIALS.reduce((sum, [w, a]) => sum + w * a, 0)

/**
 * Torch flicker multiplier at `timeMs` for a torch's `seed`: a smooth sum of
 * three incommensurate sines (weights sum to 1), so it is bounded to
 * 1 ± FLICKER_DEPTH and changes at most FLICKER_MAX_RATE per second — a
 * living flame, never a strobe. Allocation-free (called every frame).
 */
export function torchFlicker(timeMs: number, seed: number): number {
  const t = timeMs / 1000
  const phase = ((seed % 10007) / 10007) * TAU
  let n = 0
  for (let i = 0; i < FLICKER_PARTIALS.length; i++) {
    const partial = FLICKER_PARTIALS[i]
    n += partial[1] * Math.sin(t * partial[0] + phase * (i + 1))
  }
  return 1 + FLICKER_DEPTH * n
}

/**
 * Flame sway (rad) about x and z — a slower, gentler wobble than the
 * brightness flicker; |sway| ≤ FLAME_SWAY. Two scalar functions (not a tuple)
 * so the per-frame update allocates nothing.
 */
export const FLAME_SWAY = 0.12

function swayPhase(seed: number): number {
  return ((seed % 7919) / 7919) * TAU
}

export function flameSwayX(timeMs: number, seed: number): number {
  const t = timeMs / 1000
  return FLAME_SWAY * Math.sin(t * 2.1 + swayPhase(seed)) * Math.cos(t * 0.7)
}

export function flameSwayZ(timeMs: number, seed: number): number {
  const t = timeMs / 1000
  return FLAME_SWAY * Math.sin(t * 1.7 + swayPhase(seed) * 2) * Math.cos(t * 0.9 + 1)
}

// ---- dust motes ----

export type Mote = {
  /** Rest position the mote drifts around. */
  x: number
  y: number
  z: number
  /** Horizontal drift circle radius and angular speed (rad/s). */
  drift: number
  speed: number
  /** Vertical bob amplitude and angular speed (rad/s). */
  bob: number
  bobSpeed: number
  phase: number
  /** Per-mote brightness (0..1). */
  alpha: number
}

export const MOTE_COUNT = 90
/** Motes hang over the board and its torchlit surroundings… */
export const MOTE_AREA_RADIUS = 6.5
/** …between just above the tiles and well above the tallest piece. */
export const MOTE_MIN_Y = 0.15
export const MOTE_MAX_Y = 2.8
export const MOTE_DRIFT_MAX = 0.45
export const MOTE_BOB_MAX = 0.18
/** World-space size of a mote sprite. */
export const MOTE_SIZE = 0.05
export const MOTE_COLOR = '#ffd9a6'
export const MOTE_OPACITY = 0.55

/**
 * Deterministic dust-mote field: uniform over a disc of MOTE_AREA_RADIUS
 * (drift included) and a height band whose drifted positions always stay
 * within [MOTE_MIN_Y, MOTE_MAX_Y].
 */
export function generateMotes(count = MOTE_COUNT, seedKey = 'arena-motes'): Mote[] {
  const rand = mulberry32(hashString(seedKey))
  const motes: Mote[] = []
  for (let i = 0; i < count; i++) {
    const drift = 0.1 + rand() * (MOTE_DRIFT_MAX - 0.1)
    const bob = 0.04 + rand() * (MOTE_BOB_MAX - 0.04)
    const angle = rand() * TAU
    const radius = Math.sqrt(rand()) * (MOTE_AREA_RADIUS - drift)
    motes.push({
      x: Math.cos(angle) * radius,
      y: MOTE_MIN_Y + bob + rand() * (MOTE_MAX_Y - MOTE_MIN_Y - 2 * bob),
      z: Math.sin(angle) * radius,
      drift,
      speed: (0.08 + rand() * 0.22) * (rand() < 0.5 ? -1 : 1),
      bob,
      bobSpeed: 0.4 + rand() * 0.6,
      phase: rand() * TAU,
      alpha: 0.35 + rand() * 0.65,
    })
  }
  return motes
}

/**
 * Write mote `index`'s drifted position at `timeSec` into `out` (xyz at
 * index*3). Allocation-free: the render loop updates a preallocated buffer.
 */
export function writeMotePosition(m: Mote, timeSec: number, out: Float32Array, index: number): void {
  const a = m.phase + timeSec * m.speed
  const o = index * 3
  out[o] = m.x + Math.cos(a) * m.drift
  out[o + 1] = m.y + Math.sin(m.phase * 1.3 + timeSec * m.bobSpeed) * m.bob
  out[o + 2] = m.z + Math.sin(a) * m.drift
}
