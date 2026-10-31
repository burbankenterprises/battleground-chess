import { beforeEach, describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type { Move, Square } from 'chess.js'
import { createPieceTracker } from './pieceTracker'
import type { PieceTracker } from './pieceTracker'

/**
 * These tests drive a REAL chess.js instance (the rules authority) and feed its
 * verbose Moves into the tracker, then verify the tracker's identity maps stay
 * consistent with the chess.js board square-by-square. Every flag branch is
 * covered (normal, capture, en passant, both castles, promotion) plus a 20-move
 * scripted game and an undo rebuild.
 */

let chess: Chess
let tracker: PieceTracker

beforeEach(() => {
  chess = new Chess()
  tracker = createPieceTracker()
  tracker.syncFromBoard(chess.board())
})

/** Play one SAN move on chess.js and mirror it into the tracker. */
function play(san: string): Move {
  const move = chess.move(san)
  tracker.applyMove(move)
  return move
}

/**
 * Assert the tracker's LIVING actors exactly mirror the chess.js board: one
 * actor per occupied square, right type + color, and no square double-booked.
 */
function assertConsistent() {
  const living = tracker.actors().filter((a) => a.alive)

  const occupied = new Map<string, { type: string; color: string }>()
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell) occupied.set(cell.square, { type: cell.type, color: cell.color })
    }
  }

  expect(living.length).toBe(occupied.size)

  const seenSquares = new Set<string>()
  for (const a of living) {
    const cell = occupied.get(a.square)
    expect(cell, `expected a piece on ${a.square}`).toBeDefined()
    expect(a.type).toBe(cell!.type)
    expect(a.color).toBe(cell!.color)
    expect(tracker.actorIdAt(a.square)).toBe(a.id)
    expect(seenSquares.has(a.square), `two actors on ${a.square}`).toBe(false)
    seenSquares.add(a.square)
  }
}

describe('pieceTracker — syncFromBoard', () => {
  it('creates one living actor for every piece in the start position', () => {
    const actors = tracker.actors()
    expect(actors).toHaveLength(32)
    expect(actors.every((a) => a.alive)).toBe(true)
    assertConsistent()
  })

  it('maps starting squares to the right type + color', () => {
    const e1 = tracker.actorIdAt('e1')
    const e8 = tracker.actorIdAt('e8')
    expect(e1).toBeDefined()
    expect(e8).toBeDefined()
    const byId = new Map(tracker.actors().map((a) => [a.id, a]))
    expect(byId.get(e1!)).toMatchObject({ type: 'k', color: 'w', square: 'e1' })
    expect(byId.get(e8!)).toMatchObject({ type: 'k', color: 'b', square: 'e8' })
  })

  it('returns undefined for an empty square', () => {
    expect(tracker.actorIdAt('e4')).toBeUndefined()
  })

  it('rebuilds with FRESH ids (no id reuse) on a second sync', () => {
    const firstIds = new Set(tracker.actors().map((a) => a.id))
    tracker.syncFromBoard(chess.board())
    const secondIds = tracker.actors().map((a) => a.id)
    expect(secondIds).toHaveLength(32)
    // No id from the first build appears in the second build.
    expect(secondIds.some((id) => firstIds.has(id))).toBe(false)
  })
})

describe('pieceTracker — normal move (flag n/b)', () => {
  it('keeps the actor id stable from → to', () => {
    const e2 = tracker.actorIdAt('e2')
    expect(e2).toBeDefined()

    const move = play('e4')
    expect(move.flags).toBe('b') // big pawn (double step)

    expect(tracker.actorIdAt('e2')).toBeUndefined()
    expect(tracker.actorIdAt('e4')).toBe(e2)
    const actor = tracker.actors().find((a) => a.id === e2)
    expect(actor).toMatchObject({ square: 'e4', type: 'p', color: 'w', alive: true })
    assertConsistent()
  })

  it('handles a quiet single-step and a knight move (flag n)', () => {
    const g1 = tracker.actorIdAt('g1')
    play('e3')
    play('e6') // black replies so it is white's turn again
    const nf3 = play('Nf3')
    expect(nf3.flags).toBe('n')
    expect(tracker.actorIdAt('f3')).toBe(g1)
    assertConsistent()
  })
})

describe('pieceTracker — capture (flag c)', () => {
  it('marks the captured actor dead and moves the attacker onto its square', () => {
    play('e4')
    play('d5')
    const whitePawn = tracker.actorIdAt('e4')
    const blackPawn = tracker.actorIdAt('d5')

    const move = play('exd5')
    expect(move.flags).toBe('c')

    // Attacker keeps its id and now sits on d5.
    expect(tracker.actorIdAt('d5')).toBe(whitePawn)
    // Victim is dead, excluded from the square map, still present as a record.
    const victim = tracker.actors().find((a) => a.id === blackPawn)
    expect(victim?.alive).toBe(false)
    expect(tracker.actorIdAt('e4')).toBeUndefined()
    assertConsistent()
  })
})

describe('pieceTracker — en passant (flag e)', () => {
  it('kills the pawn on (file of to, rank of from), not the destination', () => {
    play('e4')
    play('a6')
    play('e5')
    const victimPawn = tracker.actorIdAt('d5' as Square) // will exist after d5
    void victimPawn
    play('d5') // black double-steps beside the white e5 pawn
    const attacker = tracker.actorIdAt('e5')
    const enemyPawn = tracker.actorIdAt('d5')

    const move = play('exd6')
    expect(move.flags).toBe('e')

    // Attacker pawn moved to the empty d6 square.
    expect(tracker.actorIdAt('d6')).toBe(attacker)
    // The captured pawn sat on d5 (file of 'to' d, rank of 'from' 5), now dead.
    const captured = tracker.actors().find((a) => a.id === enemyPawn)
    expect(captured?.alive).toBe(false)
    expect(tracker.actorIdAt('d5')).toBeUndefined()
    assertConsistent()
  })
})

describe('pieceTracker — castling (flags k/q)', () => {
  it('kingside: king e1→g1 and rook h1→f1, both keeping their ids', () => {
    play('e4')
    play('e5')
    play('Nf3')
    play('Nc6')
    play('Bc4')
    play('Bc5')
    const king = tracker.actorIdAt('e1')
    const rook = tracker.actorIdAt('h1')

    const move = play('O-O')
    expect(move.flags).toBe('k')

    expect(tracker.actorIdAt('g1')).toBe(king)
    expect(tracker.actorIdAt('f1')).toBe(rook)
    expect(tracker.actorIdAt('e1')).toBeUndefined()
    expect(tracker.actorIdAt('h1')).toBeUndefined()
    const kActor = tracker.actors().find((a) => a.id === king)
    const rActor = tracker.actors().find((a) => a.id === rook)
    expect(kActor).toMatchObject({ type: 'k', square: 'g1' })
    expect(rActor).toMatchObject({ type: 'r', square: 'f1' })
    assertConsistent()
  })

  it('queenside: king e1→c1 and rook a1→d1, both keeping their ids', () => {
    play('d4')
    play('d5')
    play('Nc3')
    play('Nc6')
    play('Bf4')
    play('Bf5')
    play('Qd2')
    play('Qd7')
    const king = tracker.actorIdAt('e1')
    const rook = tracker.actorIdAt('a1')

    const move = play('O-O-O')
    expect(move.flags).toBe('q')

    expect(tracker.actorIdAt('c1')).toBe(king)
    expect(tracker.actorIdAt('d1')).toBe(rook)
    expect(tracker.actorIdAt('e1')).toBeUndefined()
    expect(tracker.actorIdAt('a1')).toBeUndefined()
    assertConsistent()
  })
})

describe('pieceTracker — promotion (flag p)', () => {
  it('quiet promotion keeps the actor id and changes its type', () => {
    // g4 h5 gxh5 Nf6 h6 Rg8 hxg7 Rh8 g8=Q  → quiet promotion onto g8.
    play('g4')
    play('h5')
    play('gxh5')
    play('Nf6')
    play('h6')
    play('Rg8')
    play('hxg7')
    play('Rh8')
    const pawn = tracker.actorIdAt('g7')

    const move = play('g8=Q')
    expect(move.flags).toBe('np') // normal + promotion, no capture
    expect(move.promotion).toBe('q')

    // Same actor id, type is now a queen.
    expect(tracker.actorIdAt('g8')).toBe(pawn)
    const promoted = tracker.actors().find((a) => a.id === pawn)
    expect(promoted).toMatchObject({ square: 'g8', type: 'q', color: 'w', alive: true })
    assertConsistent()
  })

  it('promotion WITH capture (flags cp): victim dies, pawn keeps id and becomes a queen', () => {
    // d4 e5 dxe5 f6 exf6 Nc6 fxg7 a6 gxh8=Q → capture the h8 rook while promoting.
    play('d4')
    play('e5')
    play('dxe5')
    play('f6')
    play('exf6')
    play('Nc6')
    play('fxg7')
    play('a6')
    const pawn = tracker.actorIdAt('g7')
    const rook = tracker.actorIdAt('h8')

    const move = play('gxh8=Q')
    expect(move.flags).toBe('cp')

    expect(tracker.actorIdAt('h8')).toBe(pawn)
    const promoted = tracker.actors().find((a) => a.id === pawn)
    expect(promoted).toMatchObject({ type: 'q', square: 'h8', alive: true })
    const deadRook = tracker.actors().find((a) => a.id === rook)
    expect(deadRook?.alive).toBe(false)
    assertConsistent()
  })
})

describe('pieceTracker — 20-move scripted game (verified square-by-square)', () => {
  // A fully legal 20-half-move opening (Giuoco Piano → tactics). Every half-move
  // is checked for full board/identity consistency.
  const game: string[] = [
    'e4', 'e5',
    'Nf3', 'Nc6',
    'Bc4', 'Bc5',
    'c3', 'Nf6',
    'd4', 'exd4',
    'cxd4', 'Bb4+',
    'Nc3', 'Nxe4',
    'O-O', 'Bxc3',
    'd5', 'Bf6',
    'Re1', 'Ne7',
  ]

  it('stays consistent after every one of the 20 half-moves', () => {
    expect(game).toHaveLength(20)
    for (const san of game) {
      play(san)
      assertConsistent()
    }
    // Final position sanity: chess.js FEN we validated out-of-band.
    expect(chess.fen()).toBe(
      'r1bqk2r/ppppnppp/5b2/3P4/2B1n3/5N2/PP3PPP/R1BQR1K1 w kq - 3 11',
    )
  })

  it('tracks one specific pawn identity across several of its own moves', () => {
    // Follow the white e-pawn: e2 → e4, captured on move 10 (exd4 by black)…
    const ePawn = tracker.actorIdAt('e2')
    play('e4')
    expect(tracker.actorIdAt('e4')).toBe(ePawn)
    play('e5')
    play('Nf3')
    play('Nc6')
    play('Bc4')
    play('Bc5')
    play('c3')
    play('Nf6')
    play('d4')
    // …black plays exd4: the black e5 pawn captures the white d4 pawn, NOT the
    // e-pawn, so the e-pawn (now on e4) is still alive on e4.
    play('exd4')
    expect(tracker.actors().find((a) => a.id === ePawn)).toMatchObject({
      square: 'e4',
      alive: true,
    })
  })
})

describe('pieceTracker — undo rebuild', () => {
  it('rebuilds fresh identities from the post-undo board state', () => {
    play('e4')
    play('e5')
    play('Nf3')

    // Simulate the store's undo path: chess.js undoes, tracker re-syncs.
    chess.undo()
    const idsBefore = new Set(tracker.actors().map((a) => a.id))
    tracker.syncFromBoard(chess.board())

    // Position matches the post-undo board, with brand-new ids.
    assertConsistent()
    const knightSquare = chess.get('g1') ? 'g1' : 'f3'
    expect(knightSquare).toBe('g1') // knight is back home after undo
    const newIds = tracker.actors().map((a) => a.id)
    expect(newIds.some((id) => idsBefore.has(id))).toBe(false)
    expect(newIds).toHaveLength(32)
  })

  it('full undo back to start leaves 32 consistent actors', () => {
    play('e4')
    play('c5')
    play('Nf3')
    play('d6')
    while (chess.history().length > 0) chess.undo()
    tracker.syncFromBoard(chess.board())
    assertConsistent()
    expect(tracker.actors()).toHaveLength(32)
  })
})

describe('pieceTracker — applyMove events', () => {
  it('emits a move event for a quiet move', () => {
    const events = tracker.applyMove(chess.move('e4'))
    expect(events).toEqual([
      expect.objectContaining({ kind: 'move', from: 'e2', to: 'e4' }),
    ])
  })

  it('emits death + move events for a capture (death first)', () => {
    chess.move('e4')
    tracker.applyMove(chess.history({ verbose: true }).at(-1)!)
    chess.move('d5')
    tracker.applyMove(chess.history({ verbose: true }).at(-1)!)

    const events = tracker.applyMove(chess.move('exd5'))
    expect(events[0].kind).toBe('death')
    expect(events[1]).toMatchObject({ kind: 'move', from: 'e4', to: 'd5' })
  })

  it('emits two move events for castling', () => {
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) {
      tracker.applyMove(chess.move(san))
    }
    const events = tracker.applyMove(chess.move('O-O'))
    const moves = events.filter((e) => e.kind === 'move')
    expect(moves).toHaveLength(2)
    expect(moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'e1', to: 'g1' }),
        expect.objectContaining({ from: 'h1', to: 'f1' }),
      ]),
    )
  })

  it('emits a promote event carrying the new type', () => {
    for (const san of [
      'd4', 'e5', 'dxe5', 'f6', 'exf6', 'Nc6', 'fxg7', 'a6',
    ]) {
      tracker.applyMove(chess.move(san))
    }
    const events = tracker.applyMove(chess.move('gxh8=Q'))
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'promote', square: 'h8', type: 'q' }),
      ]),
    )
  })
})
