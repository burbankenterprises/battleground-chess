/**
 * Physics-lite battle effects math (no physics library): shards fly on
 * ballistic arcs (initial velocity + gravity), stop when they hit the board,
 * and fade out; dust puffs expand and fade. Pure functions — the three.js
 * layer (BattleEffects) only copies the numbers onto meshes.
 */

/**
 * Game gravity in world units / s² (a board tile is 1 unit). Stronger than
 * 9.8 so every shard lands inside the short shatter window and reads as heavy
 * debris (relative to piece scale, real gravity would be stronger still).
 */
export const GRAVITY = 20
/** Spec: a dying piece shatters into 5–8 low-poly shards. */
export const SHARD_COUNT_MIN = 5
export const SHARD_COUNT_MAX = 8
/** Shards hold full opacity for this fraction of their life, then fade linearly to 0. */
export const SHARD_FADE_START = 0.55
/** Dust puff peak opacity at spawn. */
export const DUST_PEAK_OPACITY = 0.55
/** Checkmate fall: dust starts at this fraction of the fall (the king meets the board). */
export const MATE_DUST_START = 0.8
/** Checkmate dust lifetime (ms). */
export const MATE_DUST_MS = 450

type Vec3 = [number, number, number]

export type ShardSeed = {
  shape: 'tetra' | 'box'
  /** Spawn position (world). */
  p0: Vec3
  /** Initial velocity (world units / s). */
  v0: Vec3
  /** Initial Euler rotation (rad). */
  r0: Vec3
  /** Angular velocity (rad / s) per Euler axis. */
  spin: Vec3
  /** Per-axis mesh scale (unit geometry). */
  scale: Vec3
  /** Height of the shard's center when resting on the board. */
  floor: number
}

/** Where a fallen piece lies when it shatters. */
export type ShatterSpec = {
  /** Deterministic seed (e.g. actor id + sequence) so a replayed frame is identical. */
  seedKey: string
  /** World position of the piece's base center. */
  baseX: number
  baseZ: number
  /** Unit ground direction it fell toward. */
  dirX: number
  dirZ: number
  /** Base radius and height of the piece. */
  radius: number
  height: number
}

/** FNV-1a 32-bit string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Small deterministic PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Spawn the shards of a piece lying on its side: spread along the fallen
 * body, bursting outward/upward and carrying some of the blow's momentum.
 */
export function spawnShards(spec: ShatterSpec): ShardSeed[] {
  const rand = mulberry32(hashString(spec.seedKey))
  const count =
    SHARD_COUNT_MIN + Math.floor(rand() * (SHARD_COUNT_MAX - SHARD_COUNT_MIN + 1))
  // Ground axis perpendicular to the fallen body.
  const px = -spec.dirZ
  const pz = spec.dirX
  const shards: ShardSeed[] = []
  for (let i = 0; i < count; i++) {
    // A fallen piece's body spans [radius, radius + height] from its base center.
    const along = spec.radius + (spec.height * (i + 0.5)) / count
    const side = (rand() - 0.5) * spec.radius * 1.2
    const y = spec.radius * (0.5 + rand() * 0.7)
    const lateral = (side >= 0 ? 1 : -1) * (0.8 + rand() * 1.2)
    const forward = 0.3 + rand() * 0.8
    const up = 1.0 + rand() * 1.0
    const size = 0.07 + rand() * 0.06
    const shape: ShardSeed['shape'] = i % 2 === 0 ? 'tetra' : 'box'
    const scale: Vec3 =
      shape === 'tetra'
        ? [size, size, size]
        : [size, size * (0.6 + rand() * 0.5), size * (0.8 + rand() * 0.6)]
    shards.push({
      shape,
      p0: [spec.baseX + spec.dirX * along + px * side, y, spec.baseZ + spec.dirZ * along + pz * side],
      v0: [px * lateral + spec.dirX * forward, up, pz * lateral + spec.dirZ * forward],
      r0: [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2],
      spin: [(rand() - 0.5) * 24, (rand() - 0.5) * 24, (rand() - 0.5) * 24],
      scale,
      // Tetrahedron (circumradius = size) rests with its centroid size/3 up;
      // a box rests on (roughly) half its smallest extent.
      floor: shape === 'tetra' ? size / 3 : Math.min(...scale) / 2,
    })
  }
  return shards
}

/** Seconds after spawn when a shard comes down onto the board. */
export function landingTime(shard: ShardSeed): number {
  const vy = shard.v0[1]
  const h = shard.p0[1] - shard.floor
  if (h <= 0 && vy <= 0) return 0
  return (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, h))) / GRAVITY
}

/** Ballistic position `s` seconds after spawn; frozen where it lands. */
export function shardPosition(shard: ShardSeed, s: number): Vec3 {
  const st = Math.min(Math.max(0, s), landingTime(shard))
  const [x0, y0, z0] = shard.p0
  const [vx, vy, vz] = shard.v0
  return [
    x0 + vx * st,
    Math.max(shard.floor, y0 + vy * st - 0.5 * GRAVITY * st * st),
    z0 + vz * st,
  ]
}

/** Tumbling rotation `s` seconds after spawn; stops spinning on landing. */
export function shardRotation(shard: ShardSeed, s: number): Vec3 {
  const st = Math.min(Math.max(0, s), landingTime(shard))
  return [
    shard.r0[0] + shard.spin[0] * st,
    shard.r0[1] + shard.spin[1] * st,
    shard.r0[2] + shard.spin[2] * st,
  ]
}

/** Shard opacity over its life `u` (0..1): solid, then a linear fade to 0. */
export function shardOpacity(u: number): number {
  if (u <= SHARD_FADE_START) return 1
  return Math.max(0, 1 - (u - SHARD_FADE_START) / (1 - SHARD_FADE_START))
}

/** Dust puff over its life `u` (0..1): expanding sphere + ground ring, fading out. */
export function dustState(u: number): { scale: number; ringScale: number; opacity: number } {
  const c = u < 0 ? 0 : u > 1 ? 1 : u
  const e = 1 - (1 - c) * (1 - c)
  return {
    scale: 0.18 + 0.6 * e,
    ringScale: 0.2 + 0.75 * e,
    opacity: DUST_PEAK_OPACITY * (1 - c),
  }
}
