import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { useGameStore } from './store'
import {
  PIECE_GLYPH,
  PIECE_VALUE,
  capturedFromMoves,
  materialLead,
  trayGroups,
  trayLabel,
  trayValue,
} from './captured'

/** Verbose history of a SAN line, straight from chess.js (the rules authority). */
function historyOf(sans: string[]) {
  const game = new Chess()
  for (const san of sans) game.move(san)
  return game.history({ verbose: true })
}

describe('captured trays — derived from the move history capture flags', () => {
  it('start position: both trays empty, no lead', () => {
    const trays = capturedFromMoves([])
    expect(trays).toEqual({ w: [], b: [] })
    expect(materialLead(trays)).toEqual({ w: 0, b: 0 })
  })

  it('credits each capture to the army that made it', () => {
    // 1. e4 d5 2. exd5 Qxd5 3. Nc3 Qxa2 4. Rxa2
    const trays = capturedFromMoves(historyOf(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qxa2', 'Rxa2']))
    expect(trays.w).toEqual(['q', 'p'])
    expect(trays.b).toEqual(['p', 'p'])
    expect(materialLead(trays)).toEqual({ w: 8, b: 0 })
  })

  it('en passant counts as a pawn capture (victim not on the destination square)', () => {
    const trays = capturedFromMoves(historyOf(['e4', 'Nf6', 'e5', 'd5', 'exd6']))
    expect(trays).toEqual({ w: ['p'], b: [] })
  })

  it('a capturing promotion counts the captured piece (not the promoted one)', () => {
    // dxe5, exf6, fxg7 take pawns; gxh8=Q takes the rook.
    const trays = capturedFromMoves(
      historyOf(['d4', 'e5', 'dxe5', 'f6', 'exf6', 'Nc6', 'fxg7', 'a6', 'gxh8=Q']),
    )
    expect(trays.w).toEqual(['r', 'p', 'p', 'p'])
    expect(trays.b).toEqual([])
    expect(trayValue(trays.w)).toBe(8)
  })

  it('castling and quiet moves capture nothing', () => {
    const trays = capturedFromMoves(historyOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']))
    expect(trays).toEqual({ w: [], b: [] })
  })

  it('trays sort most valuable first and group repeats', () => {
    const trays = capturedFromMoves([
      { color: 'w', captured: 'p' },
      { color: 'w', captured: 'n' },
      { color: 'w', captured: 'p' },
      { color: 'w', captured: 'q' },
      { color: 'b' },
    ])
    expect(trays.w).toEqual(['q', 'n', 'p', 'p'])
    expect(trayGroups(trays.w)).toEqual([
      { type: 'q', count: 1 },
      { type: 'n', count: 1 },
      { type: 'p', count: 2 },
    ])
  })

  it('material lead goes to the side that captured more value, never both', () => {
    const lead = materialLead({ w: ['n'], b: ['r'] })
    expect(lead).toEqual({ w: 0, b: 2 })
    expect(materialLead({ w: ['b'], b: ['n'] })).toEqual({ w: 0, b: 0 })
    expect(PIECE_VALUE.q).toBe(9)
  })

  it('accessible labels list the real captures', () => {
    expect(trayLabel('White', [])).toBe('White has captured nothing')
    expect(trayLabel('White', ['q'])).toBe('White has captured a queen')
    expect(trayLabel('Black', ['r', 'p', 'p'])).toBe('Black has captured a rook and 2 pawns')
    expect(trayLabel('Black', ['q', 'n', 'p'])).toBe('Black has captured a queen, a knight and a pawn')
  })

  it('glyphs are forced to text presentation (no color emoji pawn on phones)', () => {
    for (const glyph of Object.values(PIECE_GLYPH)) expect(glyph.endsWith('\uFE0E')).toBe(true)
  })

  it('follows the store through moves, undo and new game (no extra state)', () => {
    const store = useGameStore
    store.getState().newGame()
    const trays = () => capturedFromMoves(store.getState().game.history({ verbose: true }))
    for (const [from, to] of [
      ['e2', 'e4'],
      ['d7', 'd5'],
      ['e4', 'd5'],
    ] as const) {
      expect(store.getState().tryMove(from, to)).not.toBeNull()
      store.getState().settleAnimations()
    }
    expect(trays()).toEqual({ w: ['p'], b: [] })
    store.getState().undo()
    expect(trays()).toEqual({ w: [], b: [] })
    store.getState().newGame()
    expect(trays()).toEqual({ w: [], b: [] })
  })
})
