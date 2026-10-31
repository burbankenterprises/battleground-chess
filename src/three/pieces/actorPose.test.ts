import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { createPieceTracker } from '../../game/pieceTracker'
import { moveOutcomeOf } from '../../game/outcome'
import { LAND_MS, directMove } from '../../anim/director'
import type { AnimCommand } from '../../game/types'
import { pointShortOf, squareToXZ } from '../coords'
import {
  ALARM_TILT,
  ARC_HEIGHT,
  DEATH_FALL_FRACTION,
  LUNGE_LEAN,
  PROMOTION_MIN_SCALE,
  actorPoseAt,
  landingOffset,
  restPose,
  withAlarm,
} from './actorPose'

/**
 * actorPose is what PieceActor executes each frame. These tests sample the
 * director's real timelines at key instants and check the resulting pose.
 */

type Scripted = {
  commands: AnimCommand[]
  /** Rest state of an actor after the move (tracker snapshot). */
  rest: (id: string) => { square: Square; type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k' }
  byType: <T extends AnimCommand['type']>(type: T) => Extract<AnimCommand, { type: T }>
}

function script(sans: string[], fen?: string): Scripted {
  const chess = fen ? new Chess(fen) : new Chess()
  const tracker = createPieceTracker()
  tracker.syncFromBoard(chess.board())
  let commands: AnimCommand[] = []
  for (const san of sans) {
    const move = chess.move(san)
    const events = tracker.applyMove(move)
    commands = directMove(move, (sq) => tracker.actorIdAt(sq), events, moveOutcomeOf(chess))
  }
  const actors = tracker.actors()
  return {
    commands,
    rest: (id) => {
      const a = actors.find((x) => x.id === id)!
      return { square: a.square, type: a.type }
    },
    byType: (type) => commands.find((c) => c.type === type) as never,
  }
}

const forActor = (cmds: AnimCommand[], id: string) => cmds.filter((c) => c.actorId === id)

describe('actorPose — quiet walk + landing settle', () => {
  const s = script(['e4'])
  const walk = s.byType('move')
  const rest = s.rest(walk.actorId)
  const cmds = forActor(s.commands, walk.actorId)
  const walkMs = walk.durationMs - walk.landMs

  it('starts on the origin square and ends exactly on the destination', () => {
    const [fx, fz] = squareToXZ('e2')
    const [tx, tz] = squareToXZ('e4')
    const p0 = actorPoseAt(rest, cmds, 0)
    expect(p0.x).toBeCloseTo(fx)
    expect(p0.z).toBeCloseTo(fz)
    const pEnd = actorPoseAt(rest, cmds, walk.durationMs)
    expect(pEnd.x).toBeCloseTo(tx)
    expect(pEnd.z).toBeCloseTo(tz)
    expect(pEnd.y).toBeCloseTo(0)
    expect(pEnd.scaleY).toBeCloseTo(1)
    expect(pEnd.scaleXZ).toBeCloseTo(1)
  })

  it('is at the destination when the walk ends, then squashes during the settle', () => {
    const [, tz] = squareToXZ('e4')
    expect(actorPoseAt(rest, cmds, walkMs).z).toBeCloseTo(tz)
    // Early in the settle the piece squashes (shorter, wider)…
    const squash = actorPoseAt(rest, cmds, walkMs + LAND_MS * 0.15)
    expect(squash.scaleY).toBeLessThan(1)
    expect(squash.scaleXZ).toBeGreaterThan(1)
    // …and later rebounds (a tiny stretch lobe) above 1.
    const rebound = actorPoseAt(rest, cmds, walkMs + LAND_MS * 0.5)
    expect(rebound.scaleY).toBeGreaterThan(1)
  })

  it('the landing curve starts and ends at rest', () => {
    expect(landingOffset(0)).toBeCloseTo(0)
    expect(landingOffset(1)).toBeCloseTo(0)
    expect(landingOffset(0.15)).toBeGreaterThan(0)
  })
})

describe('actorPose — knight hop', () => {
  it('peaks at the pronounced ARC_HEIGHT halfway through the walk', () => {
    const s = script(['Nf3'])
    const walk = s.byType('move')
    const walkMs = walk.durationMs - walk.landMs
    const mid = actorPoseAt(s.rest(walk.actorId), [walk], walkMs / 2)
    expect(mid.y).toBeCloseTo(ARC_HEIGHT)
    expect(ARC_HEIGHT).toBeGreaterThanOrEqual(0.6)
  })
})

describe('actorPose — capture battle', () => {
  const s = script(['e4', 'd5', 'exd5'])
  const lunge = s.byType('lunge')
  const death = s.byType('death')
  const settle = s.byType('settle-impact')
  const attacker = forActor(s.commands, lunge.actorId)
  const victim = forActor(s.commands, death.actorId)
  const attackerRest = s.rest(lunge.actorId)
  const victimRest = s.rest(death.actorId)

  it('attacker reaches the impact point leaning in at the impact frame', () => {
    const impact = death.delayMs
    const p = actorPoseAt(attackerRest, attacker, impact - 0.001)
    const [ix, iz] = pointShortOf('e4', 'd5', lunge.stopShortTiles)
    expect(p.x).toBeCloseTo(ix, 2)
    expect(p.z).toBeCloseTo(iz, 2)
    expect(p.tiltAngle).toBeCloseTo(LUNGE_LEAN, 2)
  })

  it('attacker ends upright on the captured square after the settle', () => {
    const p = actorPoseAt(attackerRest, attacker, settle.delayMs + settle.durationMs)
    const [tx, tz] = squareToXZ('d5')
    expect(p.x).toBeCloseTo(tx)
    expect(p.z).toBeCloseTo(tz)
    expect(p.tiltAngle).toBeCloseTo(0)
  })

  it('defender stands until impact, topples, then shatters (hidden)', () => {
    const before = actorPoseAt(victimRest, victim, death.delayMs - 1)
    expect(before.tiltAngle).toBe(0)
    expect(before.visible).toBe(true)
    const toppled = actorPoseAt(
      victimRest,
      victim,
      death.delayMs + death.durationMs * DEATH_FALL_FRACTION * 0.99,
    )
    expect(toppled.tiltAngle).toBeGreaterThan(1.4) // ≈ lying down
    expect(toppled.visible).toBe(true)
    const shattered = actorPoseAt(victimRest, victim, death.delayMs + death.durationMs)
    expect(shattered.visible).toBe(false)
  })

  it('defender falls AWAY from the attacker', () => {
    const p = actorPoseAt(victimRest, victim, death.delayMs + 100)
    // Attacker came from e4 (down-right of d5 in world space): fall dir is up-left.
    const [ax, az] = squareToXZ('e4')
    const [vx, vz] = squareToXZ('d5')
    expect(Math.sign(p.tiltX)).toBe(Math.sign(vx - ax))
    expect(Math.sign(p.tiltZ)).toBe(Math.sign(vz - az))
  })
})

describe('actorPose — promotion transform', () => {
  const s = script(['g4', 'h5', 'gxh5', 'Nf6', 'h6', 'Rg8', 'hxg7', 'Rh8', 'g8=Q'])
  const promo = s.byType('promotion-transform')
  const rest = s.rest(promo.actorId) // tracker already says 'q'
  const cmds = forActor(s.commands, promo.actorId)

  it('shows the pawn geometry until the swap moment, then the new type', () => {
    expect(rest.type).toBe('q')
    expect(actorPoseAt(rest, cmds, 0).type).toBe('p') // walking as a pawn
    expect(actorPoseAt(rest, cmds, promo.delayMs + promo.swapAtMs - 1).type).toBe('p')
    expect(actorPoseAt(rest, cmds, promo.delayMs + promo.swapAtMs + 1).type).toBe('q')
  })

  it('shrinks with a rising white flash, then grows back to full size', () => {
    const preSwap = actorPoseAt(rest, cmds, promo.delayMs + promo.swapAtMs - 1)
    expect(preSwap.scaleY).toBeLessThan(PROMOTION_MIN_SCALE + 0.05)
    expect(preSwap.flash).toBeGreaterThan(0.95)
    const end = actorPoseAt(rest, cmds, promo.delayMs + promo.durationMs)
    expect(end.scaleY).toBeCloseTo(1)
    expect(end.flash).toBeCloseTo(0)
    expect(end.type).toBe('q')
  })
})

describe('actorPose — checkmate fall', () => {
  it('the mated king ends lying down and stays down', () => {
    const s = script(['f3', 'e5', 'g4', 'Qh4#'])
    const fall = s.byType('checkmate-fall')
    const rest = s.rest(fall.actorId)
    const cmds = forActor(s.commands, fall.actorId)
    expect(actorPoseAt(rest, cmds, fall.delayMs - 1).tiltAngle).toBe(0)
    const end = actorPoseAt(rest, cmds, fall.delayMs + fall.durationMs)
    expect(end.tiltAngle).toBeCloseTo(Math.PI / 2)
    expect(actorPoseAt(rest, cmds, fall.delayMs + 10_000).tiltAngle).toBeCloseTo(Math.PI / 2)
    expect(end.visible).toBe(true) // the king does not shatter
  })
})

describe('actorPose — check alarm composite', () => {
  it('wobbles, pulses and glows red while weighted in; is a no-op at weight 0', () => {
    const base = restPose({ square: 'e8', type: 'k' })
    expect(withAlarm(base, 123, 0, 900)).toEqual(base)
    const on = withAlarm(base, 225, 1, 900)
    expect(on.tiltAngle).toBeGreaterThan(0)
    expect(on.tiltAngle).toBeLessThanOrEqual(ALARM_TILT)
    expect(on.alarmGlow).toBeGreaterThan(0)
    // The wobble precesses: the tilt direction changes over the cycle.
    const later = withAlarm(base, 450, 1, 900)
    expect(later.tiltX).not.toBeCloseTo(on.tiltX)
  })
})

describe('actorPose — idle', () => {
  it('no commands → upright at rest on its square', () => {
    const pose = actorPoseAt({ square: 'a1', type: 'r' }, [], 5000)
    expect(pose).toEqual(restPose({ square: 'a1', type: 'r' }))
    expect(LAND_MS).toBeGreaterThan(0)
  })
})
