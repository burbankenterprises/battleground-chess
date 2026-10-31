import { beforeEach, describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { createPieceTracker } from '../game/pieceTracker'
import type { PieceTracker } from '../game/pieceTracker'
import { moveOutcomeOf } from '../game/outcome'
import {
  ALARM_PERIOD_MS,
  BASE_MOVE_MS,
  CHECKMATE_FALL_MS,
  CONTACT_GAP_TILES,
  DEATH_MS,
  LAND_MS,
  LUNGE_MS,
  LUNGE_REACH_TILES,
  MAX_MOVE_MS,
  PROMOTION_GROW_MS,
  PROMOTION_SHRINK_MS,
  SETTLE_IMPACT_MS,
  SHAKE_AMPLITUDE,
  SHAKE_MS,
  directCameraShakes,
  directMove,
  directPositionAlarm,
  isLoopingCommand,
  moveDurationMs,
  approachDurationMs,
  MIN_APPROACH_MS,
  sequenceDurationMs,
} from './director'
import type {
  AnimCommand,
  AnimCommandType,
  CheckmateFallCommand,
  DeathCommand,
  LungeCommand,
  MoveCommand,
  PromotionTransformCommand,
  SettleImpactCommand,
} from '../game/types'

/**
 * director v2 is driven exactly as the store drives it: play the move on
 * chess.js, apply it to the tracker (positions are post-move, events name the
 * victim), read the post-move check facts from chess.js, then script it.
 */

let chess: Chess
let tracker: PieceTracker

function setup(fen?: string) {
  chess = fen ? new Chess(fen) : new Chess()
  tracker = createPieceTracker()
  tracker.syncFromBoard(chess.board())
}

beforeEach(() => setup())

/** Play a SAN move → apply to tracker → return the director's timeline. */
function direct(san: string): AnimCommand[] {
  const move = chess.move(san)
  const events = tracker.applyMove(move)
  return directMove(move, (sq: Square) => tracker.actorIdAt(sq), events, moveOutcomeOf(chess))
}

function playAll(sans: string[]) {
  for (const san of sans) direct(san)
}

const types = (cmds: AnimCommand[]): AnimCommandType[] => cmds.map((c) => c.type)

function only<T extends AnimCommand['type']>(
  cmds: AnimCommand[],
  type: T,
): Extract<AnimCommand, { type: T }> {
  const found = cmds.filter((c) => c.type === type)
  expect(found, `exactly one ${type} command`).toHaveLength(1)
  return found[0] as Extract<AnimCommand, { type: T }>
}

/** Every timeline is emitted in chronological order. */
function expectChronological(cmds: AnimCommand[]) {
  for (let i = 1; i < cmds.length; i++) {
    expect(cmds[i].delayMs).toBeGreaterThanOrEqual(cmds[i - 1].delayMs)
  }
}

/**
 * Shared assertions for a capture timeline (plain capture or en passant):
 * approach → lunge → (impact) death + settle-impact, with exact offsets.
 */
function expectCaptureTimeline(
  cmds: AnimCommand[],
  from: Square,
  to: Square,
  attackerId: string,
  victimId: string,
  victimSquare: Square,
) {
  const approachMs = approachDurationMs(from, to)
  const impactMs = approachMs + LUNGE_MS
  const approach = cmds[0] as MoveCommand
  const lunge = cmds[1] as LungeCommand
  const death = cmds[2] as DeathCommand
  const settle = cmds[3] as SettleImpactCommand
  expect(types(cmds).slice(0, 4)).toEqual(['move', 'lunge', 'death', 'settle-impact'])

  // Attacker walks up to striking distance (no landing settle — it keeps going).
  expect(approach).toMatchObject({
    actorId: attackerId,
    from,
    to,
    delayMs: 0,
    durationMs: approachMs,
    stopShortTiles: LUNGE_REACH_TILES,
    landMs: 0,
  })
  // Lunge: ~180ms, ends exactly at the impact frame.
  expect(lunge).toMatchObject({
    actorId: attackerId,
    from,
    to,
    delayMs: approachMs,
    durationMs: LUNGE_MS,
    fromShortTiles: LUNGE_REACH_TILES,
    stopShortTiles: CONTACT_GAP_TILES,
  })
  expect(lunge.delayMs + lunge.durationMs).toBe(impactMs)
  // Defender death starts ON the impact frame (overlaps the attacker's settle).
  expect(death).toMatchObject({
    actorId: victimId,
    square: victimSquare,
    attackerFrom: from,
    delayMs: impactMs,
    durationMs: DEATH_MS,
  })
  // Attacker settles from the impact point onto the captured square (~150ms).
  expect(settle).toMatchObject({
    actorId: attackerId,
    from,
    to,
    delayMs: impactMs,
    durationMs: SETTLE_IMPACT_MS,
    fromShortTiles: CONTACT_GAP_TILES,
  })
  // The attacker's path is continuous across its three segments.
  expect(lunge.fromShortTiles).toBe(approach.stopShortTiles)
  expect(settle.fromShortTiles).toBe(lunge.stopShortTiles)
  // Attacker and defender are different actors.
  expect(victimId).not.toBe(attackerId)
}

describe('director — timing constants (Jon play-test: walks must be clearly visible)', () => {
  it('uses a ~600ms one-tile walk capped at ~1100ms, plus a landing settle', () => {
    expect(BASE_MOVE_MS).toBe(600)
    expect(MAX_MOVE_MS).toBe(1100)
    expect(LAND_MS).toBeGreaterThan(0)
  })

  it('uses the Phase 3 battle durations', () => {
    expect(LUNGE_MS).toBe(180)
    expect(DEATH_MS).toBe(500)
    expect(SETTLE_IMPACT_MS).toBe(150)
    expect(PROMOTION_SHRINK_MS).toBe(200)
    expect(PROMOTION_GROW_MS).toBe(250)
    expect(CHECKMATE_FALL_MS).toBe(800)
    expect(SHAKE_MS).toBe(150)
  })
})

describe('director — moveDurationMs', () => {
  it('is the base time for a single tile', () => {
    expect(moveDurationMs('e2', 'e3')).toBe(BASE_MOVE_MS)
    expect(moveDurationMs('e2', 'e3')).toBe(600)
  })

  it('scales linearly with tile distance (Chebyshev) up to the cap', () => {
    // 2 tiles → 2 × 600 = 1200, which the 1100ms cap clamps.
    expect(moveDurationMs('e2', 'e4')).toBe(Math.min(BASE_MOVE_MS * 2, MAX_MOVE_MS))
    expect(moveDurationMs('e2', 'e4')).toBe(1100)
    expect(moveDurationMs('g1', 'f3')).toBe(1100) // knight L: max(1,2) = 2 tiles
    expect(moveDurationMs('e1', 'f2')).toBe(600) // king diagonal step = 1 tile
  })

  it('caps long slides at MAX_MOVE_MS', () => {
    expect(BASE_MOVE_MS * 7).toBeGreaterThan(MAX_MOVE_MS)
    expect(moveDurationMs('a1', 'a8')).toBe(MAX_MOVE_MS)
    expect(moveDurationMs('a1', 'h8')).toBe(MAX_MOVE_MS)
  })

  it('never returns less than the base time', () => {
    expect(moveDurationMs('e4', 'e4')).toBe(BASE_MOVE_MS)
  })
})

describe('director — approachDurationMs (capture approach at walking pace)', () => {
  it('walks at BASE_MOVE_MS per tile of straight-line distance up to striking reach', () => {
    // d1→d3: 2 tiles orthogonal → (2 − 0.95) × 600 = 630ms.
    expect(approachDurationMs('d1', 'd3')).toBe(Math.round((2 - LUNGE_REACH_TILES) * BASE_MOVE_MS))
    expect(approachDurationMs('d1', 'd3')).toBe(630)
  })

  it('floors at MIN_APPROACH_MS so an adjacent capture still has a beat before the strike', () => {
    // Orthogonally adjacent: only 0.05 tiles to walk → floored.
    expect(approachDurationMs('e4', 'e5')).toBe(MIN_APPROACH_MS)
  })

  it('caps so the impact never lands later than the longest walk', () => {
    expect(approachDurationMs('a1', 'h8')).toBe(MAX_MOVE_MS - LUNGE_MS)
    expect(approachDurationMs('a1', 'h8') + LUNGE_MS).toBe(MAX_MOVE_MS)
  })
})

describe('director — normal move (flag n/b)', () => {
  it('emits one walk command ending in the landing settle', () => {
    const cmds = direct('e4')
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toEqual({
      type: 'move',
      actorId: tracker.actorIdAt('e4'),
      delayMs: 0,
      durationMs: moveDurationMs('e2', 'e4') + LAND_MS,
      from: 'e2',
      to: 'e4',
      arc: false,
      stopShortTiles: 0,
      landMs: LAND_MS,
    })
    expect(directCameraShakes(cmds)).toEqual([])
  })
})

describe('director — knight move', () => {
  it('emits a parabolic-arc walk for a knight', () => {
    const cmds = direct('Nf3')
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toMatchObject({ type: 'move', from: 'g1', to: 'f3', arc: true, landMs: LAND_MS })
  })
})

describe('director — capture (flag c)', () => {
  it('scripts approach → lunge → death (at impact) + settle, in order, with exact timings', () => {
    playAll(['e4', 'd5'])
    const attackerId = tracker.actorIdAt('e4')!
    const victimId = tracker.actorIdAt('d5')!

    const cmds = direct('exd5')
    expect(cmds).toHaveLength(4)
    expectCaptureTimeline(cmds, 'e4', 'd5', attackerId, victimId, 'd5')
    expectChronological(cmds)

    // Diagonal one-tile capture: approach (√2 − 0.95) tiles at 600ms/tile ≈ 279ms,
    // impact after the 180ms lunge at 459ms, death runs to 959ms.
    const death = only(cmds, 'death')
    expect(approachDurationMs('e4', 'd5')).toBe(279)
    expect(death.delayMs).toBe(279 + LUNGE_MS)
    expect(sequenceDurationMs(cmds)).toBe(279 + LUNGE_MS + DEATH_MS)
    // The attacker is the actor now standing on d5.
    expect(tracker.actorIdAt('d5')).toBe(attackerId)
  })

  it('emits one camera micro-shake cue on the impact frame', () => {
    playAll(['e4', 'd5'])
    const cmds = direct('exd5')
    const impact = only(cmds, 'death').delayMs
    expect(directCameraShakes(cmds)).toEqual([
      { delayMs: impact, durationMs: SHAKE_MS, amplitude: SHAKE_AMPLITUDE },
    ])
  })

  it('a knight capture approaches with its hop', () => {
    playAll(['e4', 'd5', 'Nc3', 'dxe4'])
    const attackerId = tracker.actorIdAt('c3')!
    const victimId = tracker.actorIdAt('e4')!
    const cmds = direct('Nxe4')
    expectCaptureTimeline(cmds, 'c3', 'e4', attackerId, victimId, 'e4')
    expect((cmds[0] as MoveCommand).arc).toBe(true)
  })

  it('a long-range capture keeps the walk cap: impact at MAX_MOVE_MS', () => {
    // 1. e4 d5 2. exd5 Qxd5 — the queen captures from d8 (3 tiles).
    playAll(['e4', 'd5', 'exd5'])
    const cmds = direct('Qxd5')
    expect(only(cmds, 'lunge').delayMs).toBe(MAX_MOVE_MS - LUNGE_MS)
    expect(only(cmds, 'death').delayMs).toBe(MAX_MOVE_MS)
  })
})

describe('director — en passant (flag e)', () => {
  it('lunges to the EMPTY square while the adjacent pawn dies on impact', () => {
    playAll(['e4', 'a6', 'e5', 'd5'])
    const attackerId = tracker.actorIdAt('e5')!
    const victimId = tracker.actorIdAt('d5')! // file of `to`, rank of `from`

    const cmds = direct('exd6')
    expect(cmds).toHaveLength(4)
    expectCaptureTimeline(cmds, 'e5', 'd6', attackerId, victimId, 'd5')
    expectChronological(cmds)

    // The lunge targets the empty destination; the death is NOT on that square.
    expect(only(cmds, 'lunge').to).toBe('d6')
    expect(only(cmds, 'death').square).toBe('d5')
    expect(directCameraShakes(cmds)).toHaveLength(1)
  })
})

describe('director — castling (flags k/q)', () => {
  it('kingside: king + rook walk simultaneously (both start at 0)', () => {
    playAll(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])
    const cmds = direct('O-O')

    expect(cmds).toHaveLength(2)
    expect(types(cmds)).toEqual(['move', 'move'])
    const king = cmds.find((c): c is MoveCommand => c.type === 'move' && c.from === 'e1')
    const rook = cmds.find((c): c is MoveCommand => c.type === 'move' && c.from === 'h1')
    expect(king).toMatchObject({ to: 'g1', arc: false, delayMs: 0, landMs: LAND_MS })
    expect(rook).toMatchObject({ to: 'f1', arc: false, delayMs: 0, landMs: LAND_MS })
    expect(king!.durationMs).toBe(moveDurationMs('e1', 'g1') + LAND_MS)
    expect(rook!.durationMs).toBe(moveDurationMs('h1', 'f1') + LAND_MS)
    expect(king!.actorId).toBe(tracker.actorIdAt('g1'))
    expect(rook!.actorId).toBe(tracker.actorIdAt('f1'))
    expect(king!.actorId).not.toBe(rook!.actorId)
    expect(directCameraShakes(cmds)).toEqual([])
  })

  it('queenside: king e1→c1 and rook a1→d1, simultaneous', () => {
    playAll(['d4', 'd5', 'Nc3', 'Nc6', 'Bf4', 'Bf5', 'Qd2', 'Qd7'])
    const cmds = direct('O-O-O')

    expect(cmds).toHaveLength(2)
    const moves = cmds as MoveCommand[]
    expect(moves.find((c) => c.from === 'e1')).toMatchObject({ to: 'c1', delayMs: 0 })
    expect(moves.find((c) => c.from === 'a1')).toMatchObject({ to: 'd1', delayMs: 0 })
  })
})

describe('director — promotion (flag p)', () => {
  it('quiet promotion: walk, then shrink + flash → swap → grow on the SAME actor', () => {
    playAll(['g4', 'h5', 'gxh5', 'Nf6', 'h6', 'Rg8', 'hxg7', 'Rh8'])
    const pawnId = tracker.actorIdAt('g7')!
    const cmds = direct('g8=Q')

    expect(types(cmds)).toEqual(['move', 'promotion-transform'])
    const walk = cmds[0] as MoveCommand
    const promo = cmds[1] as PromotionTransformCommand
    expect(walk).toMatchObject({ actorId: pawnId, from: 'g7', to: 'g8', landMs: LAND_MS })
    expect(promo).toEqual({
      type: 'promotion-transform',
      actorId: pawnId,
      delayMs: walk.durationMs, // starts once the pawn has landed
      durationMs: PROMOTION_SHRINK_MS + PROMOTION_GROW_MS,
      square: 'g8',
      fromType: 'p',
      toType: 'q',
      swapAtMs: PROMOTION_SHRINK_MS,
    })
    expect(tracker.actorIdAt('g8')).toBe(pawnId)
    expect(sequenceDurationMs(cmds)).toBe(walk.durationMs + 450)
  })

  it('promotion WITH capture (cp): full battle, then the transform after the settle', () => {
    playAll(['d4', 'e5', 'dxe5', 'f6', 'exf6', 'Nc6', 'fxg7', 'a6'])
    const pawnId = tracker.actorIdAt('g7')!
    const rookId = tracker.actorIdAt('h8')!
    const cmds = direct('gxh8=N')

    expect(types(cmds)).toEqual(['move', 'lunge', 'death', 'settle-impact', 'promotion-transform'])
    expectCaptureTimeline(cmds, 'g7', 'h8', pawnId, rookId, 'h8')
    const settle = only(cmds, 'settle-impact')
    const promo = only(cmds, 'promotion-transform')
    expect(promo).toMatchObject({
      actorId: pawnId,
      delayMs: settle.delayMs + settle.durationMs,
      fromType: 'p',
      toType: 'n',
      swapAtMs: PROMOTION_SHRINK_MS,
    })
    expectChronological(cmds)
  })
})

describe('director — check alarm', () => {
  it('adds a looping alarm on the checked king once the move has played', () => {
    playAll(['e4', 'f5'])
    const blackKing = tracker.actorIdAt('e8')!
    const cmds = direct('Qh5+')

    expect(types(cmds)).toEqual(['move', 'alarm'])
    const walk = cmds[0] as MoveCommand
    const alarm = only(cmds, 'alarm')
    expect(alarm).toEqual({
      type: 'alarm',
      actorId: blackKing,
      delayMs: walk.durationMs,
      durationMs: ALARM_PERIOD_MS,
      square: 'e8',
      loop: true,
    })
    // The loop never extends the sequence (it must not hold the input lock).
    expect(isLoopingCommand(alarm)).toBe(true)
    expect(sequenceDurationMs(cmds)).toBe(walk.durationMs)
  })

  it('a capture that gives check alarms after the death has finished', () => {
    // 1. e4 d5 2. exd5 Qxd5 3. Nc3 Qxd2+
    playAll(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3'])
    const whiteKing = tracker.actorIdAt('e1')!
    const cmds = direct('Qxd2+')

    expect(types(cmds)).toEqual(['move', 'lunge', 'death', 'settle-impact', 'alarm'])
    const death = only(cmds, 'death')
    const alarm = only(cmds, 'alarm')
    expect(alarm.actorId).toBe(whiteKing)
    expect(alarm.delayMs).toBe(death.delayMs + death.durationMs)
  })

  it('no alarm when the move does not give check', () => {
    expect(types(direct('e4'))).toEqual(['move'])
  })
})

describe('director — checkmate', () => {
  it("Fool's mate: the mated king slowly falls after the mating move", () => {
    playAll(['f3', 'e5', 'g4'])
    const whiteKing = tracker.actorIdAt('e1')!
    const cmds = direct('Qh4#')

    expect(types(cmds)).toEqual(['move', 'checkmate-fall'])
    const walk = cmds[0] as MoveCommand
    const fall = cmds[1] as CheckmateFallCommand
    expect(fall).toEqual({
      type: 'checkmate-fall',
      actorId: whiteKing,
      delayMs: walk.durationMs,
      durationMs: CHECKMATE_FALL_MS,
      square: 'e1',
      fallAwayFrom: 'h4', // the checking queen
    })
    // The fall is part of the sequence: input stays locked through it.
    expect(sequenceDurationMs(cmds)).toBe(walk.durationMs + CHECKMATE_FALL_MS)
    expect(cmds.some((c) => c.type === 'alarm')).toBe(false)
  })

  it("Scholar's mate (capture + mate): the fall starts once the victim's death ends", () => {
    playAll(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'])
    const blackKing = tracker.actorIdAt('e8')!
    const cmds = direct('Qxf7#')

    expect(types(cmds)).toEqual(['move', 'lunge', 'death', 'settle-impact', 'checkmate-fall'])
    const death = only(cmds, 'death')
    const fall = only(cmds, 'checkmate-fall')
    expect(fall.actorId).toBe(blackKing)
    expect(fall.delayMs).toBe(death.delayMs + death.durationMs)
    expect(fall.fallAwayFrom).toBe('f7')
    expectChronological(cmds)
  })
})

describe('director — stalemate / draw: no special piece animation', () => {
  it('stalemate: only the walk', () => {
    setup('7k/5K2/8/6Q1/8/8/8/8 w - - 0 1')
    const cmds = direct('Qg6')
    expect(chess.isStalemate()).toBe(true)
    expect(types(cmds)).toEqual(['move'])
  })

  it('draw by insufficient material: only the capture battle', () => {
    setup('8/8/8/8/4r3/4K3/8/k7 w - - 0 1')
    const cmds = direct('Kxe4')
    expect(chess.isDraw()).toBe(true)
    expect(types(cmds)).toEqual(['move', 'lunge', 'death', 'settle-impact'])
  })
})

describe('director — position alarm (undo / new game, no move animation)', () => {
  it('alarms the checked king from t=0', () => {
    playAll(['e4', 'f5', 'Qh5+'])
    const alarm = directPositionAlarm(moveOutcomeOf(chess), (sq) => tracker.actorIdAt(sq))
    expect(alarm).toMatchObject({
      type: 'alarm',
      actorId: tracker.actorIdAt('e8'),
      delayMs: 0,
      loop: true,
    })
  })

  it('nothing when not in check or when mated', () => {
    const resolve = (sq: Square) => tracker.actorIdAt(sq)
    expect(directPositionAlarm(moveOutcomeOf(chess), resolve)).toBeNull()
    playAll(['f3', 'e5', 'g4', 'Qh4#'])
    expect(directPositionAlarm(moveOutcomeOf(chess), resolve)).toBeNull()
  })
})

describe('director — defensive', () => {
  it('returns no commands when the actor cannot be resolved', () => {
    const move = chess.move('e4')
    expect(directMove(move, () => undefined)).toEqual([])
  })

  it('defaults to a quiet outcome when no events/outcome are supplied', () => {
    const move = chess.move('e4')
    const cmds = directMove(move, () => 'a0')
    expect(types(cmds)).toEqual(['move'])
  })
})
