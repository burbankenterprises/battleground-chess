import { beforeEach, describe, expect, it } from 'vitest'
import type { PieceSymbol, Square } from 'chess.js'
import { useGameStore } from './store'

/** Fresh store state before each test. */
beforeEach(() => {
  useGameStore.getState().newGame()
})

/**
 * Drive a list of [from, to] moves through the public tap path.
 *
 * A committed move sets `inputLocked` (pieces are "animating"); in the real app
 * the render loop calls `settleActor` when each walk finishes, which releases
 * the lock before the next tap. Tests have no render loop, so we settle
 * animations after each move to model that — otherwise the lock would swallow
 * every subsequent tap. `settleAnimations()` is a no-op when nothing is locked.
 */
function playTaps(moves: [Square, Square][]) {
  const store = useGameStore.getState
  for (const [from, to] of moves) {
    store().handleTap(from)
    store().handleTap(to)
    store().settleAnimations()
  }
}

describe('game store — selection + highlighting', () => {
  it('highlights the legal moves for a selected piece', () => {
    const { handleTap } = useGameStore.getState()
    handleTap('e2') // select the white e-pawn

    const s = useGameStore.getState()
    expect(s.selectedSquare).toBe('e2')

    const targets = s.legalTargets()
    expect(targets).toContain('e3')
    expect(targets).toContain('e4')
    expect(targets).toHaveLength(2)
  })

  it('selects only own pieces and deselects on a second tap', () => {
    const store = useGameStore.getState

    // Tapping an opponent piece on white's turn selects nothing.
    store().handleTap('e7')
    expect(useGameStore.getState().selectedSquare).toBeNull()

    // Select then tap again to deselect.
    store().handleTap('g1')
    expect(useGameStore.getState().selectedSquare).toBe('g1')
    store().handleTap('g1')
    expect(useGameStore.getState().selectedSquare).toBeNull()
  })

  it('re-selects when tapping another own piece', () => {
    const store = useGameStore.getState
    store().handleTap('b1')
    expect(useGameStore.getState().selectedSquare).toBe('b1')
    store().handleTap('g1') // another white knight
    expect(useGameStore.getState().selectedSquare).toBe('g1')
  })
})

describe('game store — move legality', () => {
  it('rejects an illegal move and leaves the position unchanged', () => {
    const before = useGameStore.getState().game.fen()
    const result = useGameStore.getState().tryMove('e2', 'e5') // pawn can't jump 3
    expect(result).toBeNull()
    expect(useGameStore.getState().turn).toBe('w')
    expect(useGameStore.getState().game.fen()).toBe(before)
  })

  it('executes a legal move through the tap path and flips the turn', () => {
    playTaps([['e2', 'e4']])
    const s = useGameStore.getState()
    expect(s.turn).toBe('b')
    expect(s.moveHistory).toEqual(['e4'])
    const e4 = s.boardSnapshot.find((p) => p.square === 'e4')
    expect(e4).toMatchObject({ type: 'p', color: 'w' })
    expect(s.boardSnapshot.find((p) => p.square === 'e2')).toBeUndefined()
  })

  it('ignores a tap on an illegal target square', () => {
    const store = useGameStore.getState
    store().handleTap('e2')
    store().handleTap('e5') // not reachable
    const s = useGameStore.getState()
    expect(s.selectedSquare).toBeNull()
    expect(s.moveHistory).toEqual([]) // no move happened
    expect(s.turn).toBe('w')
  })
})

describe('game store — terminal states', () => {
  it("reaches checkmate on Fool's mate", () => {
    // 1. f3 e5 2. g4 Qh4#
    playTaps([
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ])
    const s = useGameStore.getState()
    expect(s.status).toBe('checkmate')
    expect(s.game.isCheckmate()).toBe(true)
    expect(s.moveHistory[s.moveHistory.length - 1]).toBe('Qh4#')
  })

  it('reports check without checkmate', () => {
    // 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? -> Qxf7 is mate; instead just show check:
    // 1. e4 f5 2. Qh5+ gives check (not mate).
    playTaps([
      ['e2', 'e4'],
      ['f7', 'f5'],
      ['d1', 'h5'],
    ])
    const s = useGameStore.getState()
    expect(s.status).toBe('check')
    expect(s.game.isCheck()).toBe(true)
    expect(s.game.isCheckmate()).toBe(false)
  })
})

describe('game store — undo', () => {
  it('restores the previous turn and position', () => {
    playTaps([['e2', 'e4']])
    expect(useGameStore.getState().turn).toBe('b')

    const undone = useGameStore.getState().undo()
    const s = useGameStore.getState()
    expect(undone).not.toBeNull()
    expect(undone?.san).toBe('e4')
    expect(s.turn).toBe('w')
    expect(s.moveHistory).toEqual([])
    // Pawn is back on e2, e4 is empty.
    expect(s.boardSnapshot.find((p) => p.square === 'e2')).toMatchObject({
      type: 'p',
      color: 'w',
    })
    expect(s.boardSnapshot.find((p) => p.square === 'e4')).toBeUndefined()
  })

  it('undo on the initial position is a no-op returning null', () => {
    const undone = useGameStore.getState().undo()
    expect(undone).toBeNull()
    expect(useGameStore.getState().turn).toBe('w')
  })
})

describe('game store — castling through the tap path', () => {
  it('castles kingside (white) and places king g1 / rook f1', () => {
    playTaps([
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['g1', 'f3'],
      ['b8', 'c6'],
      ['f1', 'c4'],
      ['f8', 'c5'],
    ])
    // White O-O via tapping king to its castle target.
    playTaps([['e1', 'g1']])
    const s = useGameStore.getState()
    expect(s.boardSnapshot.find((p) => p.square === 'g1')).toMatchObject({
      type: 'k',
      color: 'w',
    })
    expect(s.boardSnapshot.find((p) => p.square === 'f1')).toMatchObject({
      type: 'r',
      color: 'w',
    })
    expect(s.moveHistory).toContain('O-O')
  })

  it('castles queenside (white) and places king c1 / rook d1', () => {
    playTaps([
      ['d2', 'd4'],
      ['d7', 'd5'],
      ['b1', 'c3'],
      ['b8', 'c6'],
      ['c1', 'f4'],
      ['c8', 'f5'],
      ['d1', 'd2'],
      ['d8', 'd7'],
    ])
    playTaps([['e1', 'c1']])
    const s = useGameStore.getState()
    expect(s.boardSnapshot.find((p) => p.square === 'c1')).toMatchObject({
      type: 'k',
      color: 'w',
    })
    expect(s.boardSnapshot.find((p) => p.square === 'd1')).toMatchObject({
      type: 'r',
      color: 'w',
    })
    expect(s.moveHistory).toContain('O-O-O')
  })
})

describe('game store — en passant through the tap path', () => {
  it('captures en passant: d5 pawn removed, white pawn lands on d6', () => {
    // 1. e4 Nf6 2. e5 d5 3. exd6 e.p.
    playTaps([
      ['e2', 'e4'],
      ['g8', 'f6'],
      ['e4', 'e5'],
      ['d7', 'd5'],
    ])
    playTaps([['e5', 'd6']]) // en passant
    const s = useGameStore.getState()
    expect(s.boardSnapshot.find((p) => p.square === 'd6')).toMatchObject({
      type: 'p',
      color: 'w',
    })
    // The captured black pawn that was on d5 is gone.
    expect(s.boardSnapshot.find((p) => p.square === 'd5')).toBeUndefined()
    expect(s.moveHistory[s.moveHistory.length - 1]).toBe('exd6')
  })
})

describe('game store — promotion', () => {
  // Line that marches a white pawn to g7 with black rook on h8:
  // 1. d4 e5 2. dxe5 f6 3. exf6 Nc6 4. fxg7 a6 -> white pawn on g7, gxh8=? next.
  const toG7: [Square, Square][] = [
    ['d2', 'd4'],
    ['e7', 'e5'],
    ['d4', 'e5'],
    ['f7', 'f6'],
    ['e5', 'f6'],
    ['b8', 'c6'],
    ['f6', 'g7'],
    ['a7', 'a6'],
  ]

  it('opens a pending promotion instead of moving immediately', () => {
    playTaps(toG7)
    const store = useGameStore.getState
    store().handleTap('g7') // select the pawn about to promote
    store().handleTap('h8') // capture the rook, reaching the last rank

    const s = useGameStore.getState()
    expect(s.pendingPromotion).toMatchObject({ from: 'g7', to: 'h8', color: 'w' })
    expect(s.selectedSquare).toBeNull()
    // No move has been committed yet — still white's turn.
    expect(s.turn).toBe('w')
    expect(s.moveHistory.some((m) => m.startsWith('gxh8'))).toBe(false)
  })

  it('completes each of the four promotion choices', () => {
    const choices: PieceSymbol[] = ['q', 'r', 'b', 'n']
    for (const promo of choices) {
      useGameStore.getState().newGame()
      playTaps(toG7)
      const store = useGameStore.getState
      store().handleTap('g7')
      store().handleTap('h8')

      const move = store().completePromotion(promo)
      const s = useGameStore.getState()
      expect(move).not.toBeNull()
      expect(s.pendingPromotion).toBeNull()
      expect(s.boardSnapshot.find((p) => p.square === 'h8')).toMatchObject({
        type: promo,
        color: 'w',
      })
      expect(s.turn).toBe('b') // move committed, turn flipped
    }
  })

  it('cancelPromotion abandons the move', () => {
    playTaps(toG7)
    const store = useGameStore.getState
    store().handleTap('g7')
    store().handleTap('h8')
    expect(useGameStore.getState().pendingPromotion).not.toBeNull()

    store().cancelPromotion()
    const s = useGameStore.getState()
    expect(s.pendingPromotion).toBeNull()
    expect(s.turn).toBe('w') // nothing committed
  })
})

describe('game store — new game + auto-flip', () => {
  it('newGame resets board, history and selection', () => {
    playTaps([['e2', 'e4'], ['e7', 'e5']])
    useGameStore.getState().handleTap('g1')
    expect(useGameStore.getState().selectedSquare).toBe('g1')

    useGameStore.getState().newGame()
    const s = useGameStore.getState()
    expect(s.moveHistory).toEqual([])
    expect(s.turn).toBe('w')
    expect(s.selectedSquare).toBeNull()
    expect(s.boardSnapshot).toHaveLength(32)
    expect(s.status).toBe('playing')
  })

  it('toggleAutoFlip flips the flag', () => {
    expect(useGameStore.getState().autoFlip).toBe(true)
    useGameStore.getState().toggleAutoFlip()
    expect(useGameStore.getState().autoFlip).toBe(false)
    useGameStore.getState().toggleAutoFlip()
    expect(useGameStore.getState().autoFlip).toBe(true)
  })
})

describe('game store — input lock + actors (Phase 2)', () => {
  it('starts unlocked with 32 living actors and no pending commands', () => {
    const s = useGameStore.getState()
    expect(s.inputLocked).toBe(false)
    expect(s.animCommands).toEqual([])
    expect(s.actors).toHaveLength(32)
    expect(s.actors.every((a) => a.alive)).toBe(true)
  })

  it('tryMove locks input and emits an anim command for the mover', () => {
    const move = useGameStore.getState().tryMove('e2', 'e4')
    const s = useGameStore.getState()
    expect(move).not.toBeNull()
    expect(s.inputLocked).toBe(true)
    expect(s.animCommands).toHaveLength(1)
    expect(s.animCommands[0]).toMatchObject({ from: 'e2', to: 'e4', type: 'move' })
  })

  it('ignores taps while input is locked', () => {
    useGameStore.getState().tryMove('e2', 'e4') // white moves → locked
    expect(useGameStore.getState().inputLocked).toBe(true)

    // Black tries to select/move while the animation is "playing" — ignored.
    useGameStore.getState().handleTap('e7')
    expect(useGameStore.getState().selectedSquare).toBeNull()
    useGameStore.getState().handleTap('e5')
    expect(useGameStore.getState().moveHistory).toEqual(['e4']) // no 2nd move
  })

  it('settleActor releases the lock only after every mover has settled', () => {
    // Castling emits two simultaneous commands (king + rook).
    playTaps([
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['g1', 'f3'],
      ['b8', 'c6'],
      ['f1', 'c4'],
      ['f8', 'c5'],
    ])
    useGameStore.getState().tryMove('e1', 'g1') // O-O, no settle yet
    const s = useGameStore.getState()
    expect(s.inputLocked).toBe(true)
    expect(s.animCommands).toHaveLength(2)

    const [c1, c2] = s.animCommands
    useGameStore.getState().settleActor(c1.actorId)
    expect(useGameStore.getState().inputLocked).toBe(true) // one still walking
    useGameStore.getState().settleActor(c2.actorId)
    expect(useGameStore.getState().inputLocked).toBe(false) // all settled
    expect(useGameStore.getState().animCommands).toEqual([])
  })

  it('settleAnimations clears the lock and commands immediately', () => {
    useGameStore.getState().tryMove('d2', 'd4')
    expect(useGameStore.getState().inputLocked).toBe(true)
    useGameStore.getState().settleAnimations()
    const s = useGameStore.getState()
    expect(s.inputLocked).toBe(false)
    expect(s.animCommands).toEqual([])
  })

  it('actors mirror the board: a capture drops a living actor', () => {
    playTaps([
      ['e2', 'e4'],
      ['d7', 'd5'],
    ])
    expect(useGameStore.getState().actors.filter((a) => a.alive)).toHaveLength(32)
    playTaps([['e4', 'd5']]) // exd5 capture
    const living = useGameStore.getState().actors.filter((a) => a.alive)
    expect(living).toHaveLength(31)
  })

  it('newGame and undo reset the lock', () => {
    useGameStore.getState().tryMove('e2', 'e4')
    expect(useGameStore.getState().inputLocked).toBe(true)
    useGameStore.getState().newGame()
    expect(useGameStore.getState().inputLocked).toBe(false)
    expect(useGameStore.getState().actors).toHaveLength(32)

    useGameStore.getState().tryMove('e2', 'e4')
    expect(useGameStore.getState().inputLocked).toBe(true)
    useGameStore.getState().undo()
    expect(useGameStore.getState().inputLocked).toBe(false)
  })
})
