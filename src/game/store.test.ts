import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PieceSymbol, Square } from 'chess.js'
import { LOCK_WATCHDOG_GRACE_MS, useGameStore } from './store'
import { sequenceDurationMs } from '../anim/director'
import type { AnimCommand } from './types'

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

// ---------------------------------------------------------------------------
// Phase 3 — battle sequences through the store
// ---------------------------------------------------------------------------

/**
 * Model the render loop for the CURRENT batch: each actor reports settled
 * once all of its one-shot commands have finished. Settles actors in order of
 * when their last one-shot command ends, so the lock is observable mid-way.
 * Returns the order in which actors were settled.
 */
function settleBatchInTimelineOrder(): string[] {
  const s = useGameStore.getState()
  const seq = s.animSeq
  const endById = new Map<string, number>()
  for (const c of s.animCommands) {
    if (c.type === 'alarm') continue
    endById.set(c.actorId, Math.max(endById.get(c.actorId) ?? 0, c.delayMs + c.durationMs))
  }
  const order = [...endById.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
  for (const id of order) useGameStore.getState().settleActor(id, seq)
  return order
}

function commandsOfType<T extends AnimCommand['type']>(type: T) {
  return useGameStore
    .getState()
    .animCommands.filter((c): c is Extract<AnimCommand, { type: T }> => c.type === type)
}

describe('game store — Phase 3 capture battle', () => {
  it('inputLocked spans the full battle sequence; the defender is removed at the end', () => {
    playTaps([
      ['e2', 'e4'],
      ['d7', 'd5'],
    ])
    const before = useGameStore.getState()
    const attackerId = before.actors.find((a) => a.square === 'e4' && a.alive)!.id
    const victimId = before.actors.find((a) => a.square === 'd5' && a.alive)!.id

    useGameStore.getState().tryMove('e4', 'd5')
    let s = useGameStore.getState()
    expect(s.inputLocked).toBe(true)
    expect(s.animCommands.map((c) => c.type)).toEqual(['move', 'lunge', 'death', 'settle-impact'])

    // The defender is dead in the tracker but still in the scene playing its death.
    expect(s.actors.find((a) => a.id === victimId)?.alive).toBe(false)
    expect(s.sceneActors.map((a) => a.id)).toContain(victimId)
    expect(s.sceneActors).toHaveLength(32)
    // One camera micro-shake cue on the impact frame.
    const death = commandsOfType('death')[0]
    expect(s.cameraShakes).toHaveLength(1)
    expect(s.cameraShakes[0].delayMs).toBe(death.delayMs)

    // The attacker's settle finishes BEFORE the defender's death: still locked.
    const attackerEnd = Math.max(
      ...s.animCommands
        .filter((c) => c.actorId === attackerId)
        .map((c) => c.delayMs + c.durationMs),
    )
    expect(attackerEnd).toBeLessThan(death.delayMs + death.durationMs)
    useGameStore.getState().settleActor(attackerId, s.animSeq)
    s = useGameStore.getState()
    expect(s.inputLocked).toBe(true)
    expect(s.sceneActors.map((a) => a.id)).toContain(victimId)

    // Taps are ignored while the battle plays out.
    useGameStore.getState().handleTap('e7')
    expect(useGameStore.getState().selectedSquare).toBeNull()

    // The death finishes → sequence settles: unlocked, defender removed from the scene.
    useGameStore.getState().settleActor(victimId, s.animSeq)
    s = useGameStore.getState()
    expect(s.inputLocked).toBe(false)
    expect(s.animCommands).toEqual([])
    expect(s.cameraShakes).toEqual([])
    expect(s.sceneActors.map((a) => a.id)).not.toContain(victimId)
    expect(s.sceneActors).toHaveLength(31)
    expect(s.sceneActors.every((a) => a.alive)).toBe(true)
  })

  it('ignores a settle from a stale batch', () => {
    useGameStore.getState().tryMove('e2', 'e4')
    const oldSeq = useGameStore.getState().animSeq
    const moverId = useGameStore.getState().animCommands[0].actorId
    useGameStore.getState().settleAnimations()
    useGameStore.getState().tryMove('e7', 'e5')
    expect(useGameStore.getState().inputLocked).toBe(true)
    // A late report from the previous batch must not unlock the new one.
    useGameStore.getState().settleActor(moverId, oldSeq)
    expect(useGameStore.getState().inputLocked).toBe(true)
  })
})

describe('game store — Phase 3 en passant', () => {
  it('kills the right pawn (beside the destination) on the impact frame', () => {
    playTaps([
      ['e2', 'e4'],
      ['g8', 'f6'],
      ['e4', 'e5'],
      ['d7', 'd5'],
    ])
    const before = useGameStore.getState()
    const attackerId = before.actors.find((a) => a.square === 'e5' && a.alive)!.id
    const d5PawnId = before.actors.find((a) => a.square === 'd5' && a.alive)!.id

    useGameStore.getState().tryMove('e5', 'd6')
    const s = useGameStore.getState()
    const lunge = commandsOfType('lunge')[0]
    const death = commandsOfType('death')[0]
    expect(lunge).toMatchObject({ actorId: attackerId, to: 'd6' }) // lunge to the EMPTY square
    expect(death).toMatchObject({ actorId: d5PawnId, square: 'd5' }) // the adjacent pawn dies
    expect(death.delayMs).toBe(lunge.delayMs + lunge.durationMs) // on impact
    expect(s.actors.find((a) => a.id === d5PawnId)).toMatchObject({ alive: false, square: 'd5' })
    expect(s.actors.find((a) => a.id === attackerId)).toMatchObject({ alive: true, square: 'd6' })
    // No other actor died.
    expect(s.actors.filter((a) => !a.alive).map((a) => a.id)).toEqual([d5PawnId])

    expect(s.inputLocked).toBe(true)
    settleBatchInTimelineOrder()
    const after = useGameStore.getState()
    expect(after.inputLocked).toBe(false)
    expect(after.sceneActors.map((a) => a.id)).not.toContain(d5PawnId)
    expect(after.sceneActors.find((a) => a.id === attackerId)?.square).toBe('d6')
  })
})

describe('game store — Phase 3 promotion', () => {
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

  it('swaps type on the SAME actor id and scripts the transform', () => {
    playTaps(toG7)
    const pawnId = useGameStore.getState().actors.find((a) => a.square === 'g7' && a.alive)!.id
    const rookId = useGameStore.getState().actors.find((a) => a.square === 'h8' && a.alive)!.id

    useGameStore.getState().handleTap('g7')
    useGameStore.getState().handleTap('h8')
    useGameStore.getState().completePromotion('q')

    const s = useGameStore.getState()
    const promoted = s.actors.find((a) => a.id === pawnId)
    expect(promoted).toMatchObject({ type: 'q', square: 'h8', alive: true, color: 'w' })
    // Same id → the 3D actor is not remounted; it swaps geometry mid-transform.
    expect(s.sceneActors.filter((a) => a.square === 'h8' && a.alive).map((a) => a.id)).toEqual([
      pawnId,
    ])
    const transform = commandsOfType('promotion-transform')
    expect(transform).toHaveLength(1)
    expect(transform[0]).toMatchObject({ actorId: pawnId, fromType: 'p', toType: 'q' })
    // Promotion with capture: the rook dies in the battle first.
    expect(commandsOfType('death')[0].actorId).toBe(rookId)

    // Lock spans battle + transform; releases only when both actors finish.
    expect(s.inputLocked).toBe(true)
    useGameStore.getState().settleActor(rookId, s.animSeq)
    expect(useGameStore.getState().inputLocked).toBe(true) // promoting pawn still transforming
    useGameStore.getState().settleActor(pawnId, s.animSeq)
    expect(useGameStore.getState().inputLocked).toBe(false)
  })

  it('a quiet promotion (no capture) keeps the id and only transforms', () => {
    // g4 h5 gxh5 Nf6 h6 Rg8 hxg7 Rh8 g8=R
    playTaps([
      ['g2', 'g4'],
      ['h7', 'h5'],
      ['g4', 'h5'],
      ['g8', 'f6'],
      ['h5', 'h6'],
      ['h8', 'g8'],
      ['h6', 'g7'],
      ['g8', 'h8'],
    ])
    const pawnId = useGameStore.getState().actors.find((a) => a.square === 'g7' && a.alive)!.id
    useGameStore.getState().tryMove('g7', 'g8', 'r')
    const s = useGameStore.getState()
    expect(s.actors.find((a) => a.id === pawnId)).toMatchObject({ type: 'r', square: 'g8' })
    expect(s.animCommands.map((c) => c.type)).toEqual(['move', 'promotion-transform'])
    expect(s.animCommands.every((c) => c.actorId === pawnId)).toBe(true)
  })
})

describe('game store — Phase 3 check alarm', () => {
  it('alarms the checked king; the alarm never holds the lock and persists until resolved', () => {
    playTaps([
      ['e2', 'e4'],
      ['f7', 'f5'],
    ])
    const blackKingId = useGameStore.getState().actors.find((a) => a.square === 'e8')!.id

    useGameStore.getState().tryMove('d1', 'h5') // Qh5+
    let s = useGameStore.getState()
    expect(s.status).toBe('check')
    const alarm = commandsOfType('alarm')
    expect(alarm).toHaveLength(1)
    expect(alarm[0].actorId).toBe(blackKingId)
    // Only the queen's walk holds the lock (the alarm loops forever).
    expect(s.inputLocked).toBe(true)
    expect(settleBatchInTimelineOrder()).not.toContain(blackKingId)
    s = useGameStore.getState()
    expect(s.inputLocked).toBe(false)
    // The looping alarm survives the settle — check is not yet resolved.
    expect(s.animCommands.map((c) => c.type)).toEqual(['alarm'])

    // Black resolves the check with g6 → the alarm stops (new batch has none).
    playTaps([['g7', 'g6']])
    s = useGameStore.getState()
    expect(s.status).toBe('playing')
    expect(s.animCommands.some((c) => c.type === 'alarm')).toBe(false)
  })

  it('undo into a checked position re-arms the alarm without locking input', () => {
    playTaps([
      ['e2', 'e4'],
      ['f7', 'f5'],
      ['d1', 'h5'],
      ['g7', 'g6'],
    ])
    useGameStore.getState().undo() // back to: black in check
    const s = useGameStore.getState()
    expect(s.status).toBe('check')
    expect(s.inputLocked).toBe(false)
    expect(s.animCommands).toHaveLength(1)
    expect(s.animCommands[0]).toMatchObject({ type: 'alarm', delayMs: 0 })
    const king = s.actors.find((a) => a.id === s.animCommands[0].actorId)
    expect(king).toMatchObject({ type: 'k', color: 'b', square: 'e8' })
  })
})

describe('game store — Phase 3 checkmate', () => {
  it("Fool's mate: the lock spans the mated king's fall, and the fall pose is retained", () => {
    playTaps([
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
    ])
    const whiteKingId = useGameStore.getState().actors.find((a) => a.square === 'e1')!.id
    useGameStore.getState().tryMove('d8', 'h4') // Qh4#
    let s = useGameStore.getState()
    expect(s.status).toBe('checkmate')
    const fall = commandsOfType('checkmate-fall')
    expect(fall).toHaveLength(1)
    expect(fall[0].actorId).toBe(whiteKingId)
    expect(s.inputLocked).toBe(true)

    // Queen lands first; the lock holds until the king's fall has finished.
    const queenId = s.animCommands.find((c) => c.type === 'move')!.actorId
    useGameStore.getState().settleActor(queenId, s.animSeq)
    expect(useGameStore.getState().inputLocked).toBe(true)
    useGameStore.getState().settleActor(whiteKingId, s.animSeq)
    s = useGameStore.getState()
    expect(s.inputLocked).toBe(false)
    // The king stays fallen (retained final pose) — no alarm on a mated king.
    expect(s.animCommands.map((c) => c.type)).toEqual(['checkmate-fall'])
    expect(sequenceDurationMs(s.animCommands)).toBeGreaterThan(0)
  })
})

describe('game store — Phase 3 reset paths', () => {
  it('newGame mid-battle clears the battle, the lock and the dying actors', () => {
    playTaps([
      ['e2', 'e4'],
      ['d7', 'd5'],
    ])
    useGameStore.getState().tryMove('e4', 'd5')
    expect(useGameStore.getState().inputLocked).toBe(true)
    useGameStore.getState().newGame()
    const s = useGameStore.getState()
    expect(s.inputLocked).toBe(false)
    expect(s.animCommands).toEqual([])
    expect(s.cameraShakes).toEqual([])
    expect(s.sceneActors).toHaveLength(32)
    expect(s.sceneActors.every((a) => a.alive)).toBe(true)
  })

  it('undo mid-battle rebuilds a consistent scene with no pending battle', () => {
    playTaps([
      ['e2', 'e4'],
      ['d7', 'd5'],
    ])
    useGameStore.getState().tryMove('e4', 'd5')
    useGameStore.getState().undo()
    const s = useGameStore.getState()
    expect(s.inputLocked).toBe(false)
    expect(s.animCommands).toEqual([])
    expect(s.sceneActors).toHaveLength(32)
    expect(s.sceneActors.find((a) => a.square === 'd5')).toMatchObject({ color: 'b', type: 'p' })
  })
})

describe('game store — Phase 3 lock watchdog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('unlocks a battle the render loop never settles, only after sequence end + grace', () => {
    vi.useFakeTimers()
    playTaps([
      ['e2', 'e4'],
      ['d7', 'd5'],
    ])
    useGameStore.getState().tryMove('e4', 'd5')
    const s = useGameStore.getState()
    const end = sequenceDurationMs(s.animCommands)
    const victimId = commandsOfType('death')[0].actorId

    vi.advanceTimersByTime(end + LOCK_WATCHDOG_GRACE_MS - 1)
    expect(useGameStore.getState().inputLocked).toBe(true)
    vi.advanceTimersByTime(2)
    const after = useGameStore.getState()
    expect(after.inputLocked).toBe(false)
    expect(after.sceneActors.map((a) => a.id)).not.toContain(victimId)
  })

  it('a normally settled batch is not disturbed by its old watchdog', () => {
    vi.useFakeTimers()
    useGameStore.getState().tryMove('e2', 'e4')
    settleBatchInTimelineOrder()
    useGameStore.getState().tryMove('e7', 'e5') // new batch, locked
    const seq = useGameStore.getState().animSeq
    // Advance just past the FIRST batch's watchdog deadline but well before the second's.
    vi.advanceTimersByTime(10)
    expect(useGameStore.getState().inputLocked).toBe(true)
    expect(useGameStore.getState().animSeq).toBe(seq)
  })
})
