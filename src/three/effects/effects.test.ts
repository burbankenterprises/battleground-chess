import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { createPieceTracker } from '../../game/pieceTracker'
import { moveOutcomeOf } from '../../game/outcome'
import { directMove } from '../../anim/director'
import type { AnimCommand } from '../../game/types'
import { cameraShakeOffset } from '../cameraShake'
import { DEATH_FALL_FRACTION } from '../pieces/actorPose'
import { MATE_DUST_SIZE, effectsForBatch } from './effectPlan'
import {
  GRAVITY,
  SHARD_COUNT_MAX,
  SHARD_COUNT_MIN,
  dustState,
  landingTime,
  shardOpacity,
  shardPosition,
  spawnShards,
} from './shatter'
import type { ShatterSpec } from './shatter'

const SPEC: ShatterSpec = {
  seedKey: 'test',
  baseX: 0,
  baseZ: 0,
  dirX: 1,
  dirZ: 0,
  radius: 0.24,
  height: 0.44,
}

describe('shatter — shard spawning', () => {
  it('always spawns 5–8 shards, deterministically per seed', () => {
    const counts = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const shards = spawnShards({ ...SPEC, seedKey: `k${i}` })
      expect(shards.length).toBeGreaterThanOrEqual(SHARD_COUNT_MIN)
      expect(shards.length).toBeLessThanOrEqual(SHARD_COUNT_MAX)
      counts.add(shards.length)
    }
    // The whole 5..8 range actually occurs.
    expect([...counts].sort()).toEqual([5, 6, 7, 8])
    expect(spawnShards(SPEC)).toEqual(spawnShards(SPEC))
  })

  it('mixes low-poly tetrahedra and boxes', () => {
    const shapes = new Set(spawnShards(SPEC).map((s) => s.shape))
    expect(shapes).toEqual(new Set(['tetra', 'box']))
  })
})

describe('shatter — ballistic arcs (velocity + gravity, no physics lib)', () => {
  const shard = spawnShards(SPEC)[0]

  it('follows p0 + v0·t − ½·g·t² before landing', () => {
    const t = 0.05
    const [x, y, z] = shardPosition(shard, t)
    expect(x).toBeCloseTo(shard.p0[0] + shard.v0[0] * t)
    expect(y).toBeCloseTo(shard.p0[1] + shard.v0[1] * t - 0.5 * GRAVITY * t * t)
    expect(z).toBeCloseTo(shard.p0[2] + shard.v0[2] * t)
  })

  it('rises first (upward burst), then lands on the board and stays put', () => {
    expect(shard.v0[1]).toBeGreaterThan(0)
    expect(shardPosition(shard, 0.05)[1]).toBeGreaterThan(shard.p0[1])
    const tl = landingTime(shard)
    expect(tl).toBeGreaterThan(0)
    const landed = shardPosition(shard, tl)
    expect(landed[1]).toBeCloseTo(shard.floor)
    expect(shardPosition(shard, tl + 5)).toEqual(landed)
  })

  it('every shard comes down within the shatter window of a 500ms death', () => {
    const windowS = (500 * (1 - DEATH_FALL_FRACTION)) / 1000
    for (let i = 0; i < 50; i++) {
      for (const s of spawnShards({ ...SPEC, seedKey: `w${i}`, height: 1.03, radius: 0.29 })) {
        expect(landingTime(s)).toBeLessThan(windowS)
      }
    }
  })
})

describe('shatter — fading', () => {
  it('shards hold opacity then fade to 0; dust expands while fading', () => {
    expect(shardOpacity(0)).toBe(1)
    expect(shardOpacity(1)).toBe(0)
    expect(shardOpacity(0.8)).toBeLessThan(1)
    const d0 = dustState(0)
    const d1 = dustState(1)
    expect(d1.scale).toBeGreaterThan(d0.scale)
    expect(d1.ringScale).toBeGreaterThan(d0.ringScale)
    expect(d0.opacity).toBeGreaterThan(0)
    expect(d1.opacity).toBe(0)
  })
})

/** Run SAN moves and return the last move's timeline + the tracker's actors. */
function batch(sans: string[]): { commands: AnimCommand[]; actors: ReturnType<ReturnType<typeof createPieceTracker>['actors']> } {
  const chess = new Chess()
  const tracker = createPieceTracker()
  tracker.syncFromBoard(chess.board())
  let commands: AnimCommand[] = []
  for (const san of sans) {
    const move = chess.move(san)
    const events = tracker.applyMove(move)
    commands = directMove(move, (sq) => tracker.actorIdAt(sq), events, moveOutcomeOf(chess))
  }
  return { commands, actors: tracker.actors() }
}

describe('effectPlan — effects derived from the director timeline', () => {
  it('a capture yields shards + dust in the dying piece’s color, after the topple', () => {
    const { commands, actors } = batch(['e4', 'd5', 'exd5'])
    const death = commands.find((c) => c.type === 'death')!
    const effects = effectsForBatch(commands, actors, 7)
    expect(effects.map((e) => e.kind)).toEqual(['shatter', 'dust'])
    for (const e of effects) {
      expect(e.color).toBe('b') // the black d5 pawn died
      expect(e.startMs).toBeCloseTo(death.delayMs + death.durationMs * DEATH_FALL_FRACTION)
      // Effects end exactly when the death command does (the sequence end).
      expect(e.startMs + e.lifeMs).toBeCloseTo(death.delayMs + death.durationMs)
    }
  })

  it('checkmate yields a bigger dust cloud as the king lands; quiet moves yield nothing', () => {
    const mate = batch(['f3', 'e5', 'g4', 'Qh4#'])
    const effects = effectsForBatch(mate.commands, mate.actors, 1)
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({ kind: 'dust', size: MATE_DUST_SIZE, color: 'w' })
    const fall = mate.commands.find((c) => c.type === 'checkmate-fall')!
    expect(effects[0].startMs).toBeGreaterThan(fall.delayMs)
    expect(effects[0].startMs).toBeLessThan(fall.delayMs + fall.durationMs)

    const quiet = batch(['e4'])
    expect(effectsForBatch(quiet.commands, quiet.actors, 2)).toEqual([])
  })
})

describe('cameraShake — additive micro-shake', () => {
  const cue = { delayMs: 600, durationMs: 150, amplitude: 0.07 }

  it('is exactly zero outside the cue window (camera returns to the controls’ pose)', () => {
    expect(cameraShakeOffset([cue], 0)).toEqual([0, 0])
    expect(cameraShakeOffset([cue], 599.9)).toEqual([0, 0])
    expect(cameraShakeOffset([cue], 750)).toEqual([0, 0])
    expect(cameraShakeOffset([], 650)).toEqual([0, 0])
  })

  it('stays within the small amplitude during the window', () => {
    let peak = 0
    for (let t = 600; t < 750; t += 2) {
      const [x, y] = cameraShakeOffset([cue], t)
      expect(Math.abs(x)).toBeLessThanOrEqual(cue.amplitude)
      expect(Math.abs(y)).toBeLessThanOrEqual(cue.amplitude)
      peak = Math.max(peak, Math.abs(x), Math.abs(y))
    }
    expect(peak).toBeGreaterThan(0.02)
  })
})
