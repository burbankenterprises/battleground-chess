import { beforeEach, describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { createPieceTracker } from '../game/pieceTracker'
import type { PieceTracker } from '../game/pieceTracker'
import {
  BASE_MOVE_MS,
  MAX_MOVE_MS,
  directMove,
  moveDurationMs,
} from './director'
import type { AnimCommand } from '../game/types'

/**
 * director v1 is driven exactly as the store will drive it: play the move on
 * chess.js, apply it to the tracker (so positions are post-move), then ask the
 * director to script it, resolving actor ids against the tracker.
 */

let chess: Chess
let tracker: PieceTracker

beforeEach(() => {
  chess = new Chess()
  tracker = createPieceTracker()
  tracker.syncFromBoard(chess.board())
})

/** Play a SAN move → apply to tracker → return the director's commands. */
function direct(san: string): AnimCommand[] {
  const move = chess.move(san)
  tracker.applyMove(move)
  return directMove(move, (sq: Square) => tracker.actorIdAt(sq))
}

describe('director — moveDurationMs', () => {
  it('is the base time for a single tile', () => {
    expect(moveDurationMs('e2', 'e3')).toBe(BASE_MOVE_MS)
  })

  it('scales linearly with tile distance (Chebyshev)', () => {
    expect(moveDurationMs('e2', 'e4')).toBe(BASE_MOVE_MS * 2) // 2 ranks
    expect(moveDurationMs('g1', 'f3')).toBe(BASE_MOVE_MS * 2) // knight L: max(1,2)=2
  })

  it('caps long slides at MAX_MOVE_MS', () => {
    // a1 → a8 is 7 tiles; uncapped that would be 7 * base > MAX.
    expect(BASE_MOVE_MS * 7).toBeGreaterThan(MAX_MOVE_MS)
    expect(moveDurationMs('a1', 'a8')).toBe(MAX_MOVE_MS)
    expect(moveDurationMs('a1', 'h8')).toBe(MAX_MOVE_MS)
  })

  it('never returns less than the base time', () => {
    // A zero-distance input (degenerate) still floors at one tile.
    expect(moveDurationMs('e4', 'e4')).toBe(BASE_MOVE_MS)
  })
})

describe('director — normal move (flag n/b)', () => {
  it('emits one slide command for a pawn', () => {
    const cmds = direct('e4')
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toMatchObject({
      type: 'move',
      from: 'e2',
      to: 'e4',
      arc: false,
      durationMs: moveDurationMs('e2', 'e4'),
    })
    expect(cmds[0].actorId).toBe(tracker.actorIdAt('e4'))
  })
})

describe('director — knight move', () => {
  it('emits a parabolic-arc command for a knight', () => {
    const cmds = direct('Nf3')
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toMatchObject({ from: 'g1', to: 'f3', arc: true })
  })
})

describe('director — capture (flag c)', () => {
  it('emits a single move command for the attacker (death is Phase 3)', () => {
    direct('e4')
    direct('d5')
    const cmds = direct('exd5')
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toMatchObject({ from: 'e4', to: 'd5', type: 'move' })
    expect(cmds[0].actorId).toBe(tracker.actorIdAt('d5'))
  })
})

describe('director — en passant (flag e)', () => {
  it('emits one move command for the capturing pawn to the empty square', () => {
    direct('e4')
    direct('a6')
    direct('e5')
    direct('d5')
    const cmds = direct('exd6')
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toMatchObject({ from: 'e5', to: 'd6', arc: false })
    expect(cmds[0].actorId).toBe(tracker.actorIdAt('d6'))
  })
})

describe('director — castling (flags k/q)', () => {
  it('kingside: two simultaneous move commands (king + rook)', () => {
    direct('e4')
    direct('e5')
    direct('Nf3')
    direct('Nc6')
    direct('Bc4')
    direct('Bc5')
    const cmds = direct('O-O')

    expect(cmds).toHaveLength(2)
    const king = cmds.find((c) => c.from === 'e1')
    const rook = cmds.find((c) => c.from === 'h1')
    expect(king).toMatchObject({ to: 'g1', type: 'move', arc: false })
    expect(rook).toMatchObject({ to: 'f1', type: 'move', arc: false })
    // Both start together (no delay field = simultaneous in v1).
    expect(king!.actorId).toBe(tracker.actorIdAt('g1'))
    expect(rook!.actorId).toBe(tracker.actorIdAt('f1'))
    expect(king!.actorId).not.toBe(rook!.actorId)
  })

  it('queenside: king e1→c1 and rook a1→d1', () => {
    direct('d4')
    direct('d5')
    direct('Nc3')
    direct('Nc6')
    direct('Bf4')
    direct('Bf5')
    direct('Qd2')
    direct('Qd7')
    const cmds = direct('O-O-O')

    expect(cmds).toHaveLength(2)
    expect(cmds.find((c) => c.from === 'e1')).toMatchObject({ to: 'c1' })
    expect(cmds.find((c) => c.from === 'a1')).toMatchObject({ to: 'd1' })
  })
})

describe('director — promotion (flag p)', () => {
  it('emits one move command for the promoting pawn (quiet)', () => {
    for (const san of ['g4', 'h5', 'gxh5', 'Nf6', 'h6', 'Rg8', 'hxg7', 'Rh8']) {
      direct(san)
    }
    const cmds = direct('g8=Q')
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toMatchObject({ from: 'g7', to: 'g8', type: 'move' })
    expect(cmds[0].actorId).toBe(tracker.actorIdAt('g8'))
  })

  it('promotion WITH capture emits one move command for the pawn', () => {
    for (const san of [
      'd4', 'e5', 'dxe5', 'f6', 'exf6', 'Nc6', 'fxg7', 'a6',
    ]) {
      direct(san)
    }
    const cmds = direct('gxh8=Q')
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toMatchObject({ from: 'g7', to: 'h8', type: 'move' })
  })
})

describe('director — defensive', () => {
  it('returns no commands when the actor cannot be resolved', () => {
    const move = chess.move('e4')
    // Resolver that knows nothing → director emits nothing rather than throwing.
    const cmds = directMove(move, () => undefined)
    expect(cmds).toEqual([])
  })
})
