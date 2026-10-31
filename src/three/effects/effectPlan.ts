import type { Color as ChessColor } from 'chess.js'
import type { ActorSnapshot, AnimCommand } from '../../game/types'
import { squareDir, squareToXZ } from '../coords'
import { DEATH_FALL_FRACTION, DEATH_KNOCKBACK, MATE_BOUNCE_FRACTION } from '../pieces/actorPose'
import { PIECE_DIMS } from '../pieces/pieceDims'
import { MATE_DUST_MS } from './shatter'
import type { ShatterSpec } from './shatter'

/**
 * effectPlan — derives the additive battle effects (shards + dust) for one
 * animation batch from its director commands. Pure data, so the timing is
 * unit-testable; BattleEffects renders it on the batch's sequence clock.
 */

export type ShatterEffect = {
  kind: 'shatter'
  key: string
  /** Start offset on the batch's sequence clock (ms). */
  startMs: number
  lifeMs: number
  spec: ShatterSpec
  /** Shards are colored like the dying piece. */
  color: ChessColor
}

export type DustEffect = {
  kind: 'dust'
  key: string
  startMs: number
  lifeMs: number
  x: number
  z: number
  /** Overall size multiplier (a mated king raises a bigger cloud). */
  size: number
  color: ChessColor
}

export type BattleEffect = ShatterEffect | DustEffect

/** Mated-king dust cloud size relative to a capture's. */
export const MATE_DUST_SIZE = 1.5

/** World point `along` piece-heights out along a toppled piece's body. */
function bodyPoint(
  x: number,
  z: number,
  dir: [number, number],
  radius: number,
  height: number,
  along: number,
): [number, number] {
  const d = radius + height * along
  return [x + dir[0] * d, z + dir[1] * d]
}

export function effectsForBatch(
  commands: readonly AnimCommand[],
  actors: readonly ActorSnapshot[],
  seq: number,
): BattleEffect[] {
  const byId = new Map(actors.map((a) => [a.id, a]))
  const out: BattleEffect[] = []
  for (const c of commands) {
    if (c.type !== 'death' && c.type !== 'checkmate-fall') continue
    const actor = byId.get(c.actorId)
    if (!actor) continue
    const dims = PIECE_DIMS[actor.type]
    const [sx, sz] = squareToXZ(c.square)

    if (c.type === 'death') {
      const dir = squareDir(c.attackerFrom, c.square)
      // The victim was knocked back while toppling; it shatters where it lies.
      const x = sx + dir[0] * DEATH_KNOCKBACK
      const z = sz + dir[1] * DEATH_KNOCKBACK
      const startMs = c.delayMs + c.durationMs * DEATH_FALL_FRACTION
      const lifeMs = c.durationMs * (1 - DEATH_FALL_FRACTION)
      out.push({
        kind: 'shatter',
        key: `shatter-${seq}-${c.actorId}`,
        startMs,
        lifeMs,
        color: actor.color,
        spec: {
          seedKey: `${seq}:${c.actorId}`,
          baseX: x,
          baseZ: z,
          dirX: dir[0],
          dirZ: dir[1],
          radius: dims.radius,
          height: dims.height,
        },
      })
      const [dx, dz] = bodyPoint(x, z, dir, dims.radius, dims.height, 0.5)
      out.push({
        kind: 'dust',
        key: `dust-${seq}-${c.actorId}`,
        startMs,
        lifeMs,
        x: dx,
        z: dz,
        size: 1,
        color: actor.color,
      })
    } else {
      const dir = squareDir(c.fallAwayFrom, c.square)
      const [dx, dz] = bodyPoint(sx, sz, dir, dims.radius, dims.height, 0.6)
      out.push({
        kind: 'dust',
        key: `mate-dust-${seq}-${c.actorId}`,
        // The king meets the board when its fall (before the rebound) completes.
        startMs: c.delayMs + c.durationMs * (1 - MATE_BOUNCE_FRACTION),
        lifeMs: MATE_DUST_MS,
        x: dx,
        z: dz,
        size: MATE_DUST_SIZE,
        color: actor.color,
      })
    }
  }
  return out
}
