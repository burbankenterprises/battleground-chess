import { create } from 'zustand'
import { Chess } from 'chess.js'
import type { Color, Move, PieceSymbol, Square } from 'chess.js'
import { createPieceTracker } from './pieceTracker'
import { directMove } from '../anim/director'
import type { ActorId, ActorSnapshot, AnimCommand } from './types'

/** A single occupied square, flattened from chess.js board(). */
export type BoardSquare = { square: Square; type: PieceSymbol; color: Color }

/** Derived, high-level game status for the HUD. */
export type GameStatus =
  | 'playing'
  | 'check'
  | 'checkmate'
  | 'stalemate'
  | 'draw'

/** A promotion a human started via the UI but has not yet chosen a piece for. */
export type PendingPromotion = { from: Square; to: Square; color: Color }

export type GameState = {
  /** Stable chess.js instance — the single rules authority (ref-like holder). */
  game: Chess

  // ---- reactive, derived snapshots (components subscribe to these) ----
  /** Flat list of occupied squares, refreshed after every mutation. */
  boardSnapshot: BoardSquare[]
  /** Persistent 3D actor identities, refreshed after every mutation. */
  actors: ActorSnapshot[]
  /** Animation commands for the most recent move (empty when settled). */
  animCommands: AnimCommand[]
  /** True while any actor is still animating the current move. */
  inputLocked: boolean
  /** Side to move. */
  turn: Color
  /** High-level status derived from chess.js predicates. */
  status: GameStatus
  /** Move list in SAN. */
  moveHistory: string[]
  /** Currently selected square (tap-to-select), or null. */
  selectedSquare: Square | null
  /** Pawn move awaiting a promotion-piece choice, or null. */
  pendingPromotion: PendingPromotion | null
  /** Whether the camera auto-flips to the active player on each turn. */
  autoFlip: boolean

  // ---- read helpers (spec: board(), legalMoves()) ----
  /** Current occupied squares, read live from the chess.js instance. */
  board: () => BoardSquare[]
  /** Verbose legal moves for a square (empty if none / opponent piece). */
  legalMoves: (square: Square) => Move[]
  /** Target squares a current-selection move can legally reach. */
  legalTargets: () => Square[]

  // ---- mutations ----
  /** Attempt a move; returns the Move on success or null if illegal. */
  tryMove: (from: Square, to: Square, promo?: PieceSymbol) => Move | null
  /** Core tap handler: select / deselect / re-select / move / open promotion. */
  handleTap: (square: Square) => void
  /** Clear the current selection. */
  clearSelection: () => void
  /** Finish a pending promotion with the chosen piece. */
  completePromotion: (promo: PieceSymbol) => Move | null
  /** Abandon a pending promotion. */
  cancelPromotion: () => void
  /** Undo the last half-move; returns the undone Move or null. */
  undo: () => Move | null
  /** Reset to the starting position. */
  newGame: () => void
  /** Toggle pass-and-play camera auto-flip. */
  toggleAutoFlip: () => void

  // ---- animation lifecycle ----
  /** One actor finished its walk; releases the lock once all have settled. */
  settleActor: (id: ActorId) => void
  /** Force every outstanding animation to settle immediately (unlock input). */
  settleAnimations: () => void
}

/** Flatten chess.js board() (8x8 of null | piece) into occupied squares only. */
function flattenBoard(game: Chess): BoardSquare[] {
  const rows = game.board()
  const out: BoardSquare[] = []
  for (const row of rows) {
    for (const cell of row) {
      if (cell) out.push({ square: cell.square, type: cell.type, color: cell.color })
    }
  }
  return out
}

/**
 * Derive high-level status. Order matters: checkmate implies check, and
 * chess.js isDraw() is true for stalemate too — so test the most specific
 * terminal states first.
 */
function deriveStatus(game: Chess): GameStatus {
  if (game.isCheckmate()) return 'checkmate'
  if (game.isStalemate()) return 'stalemate'
  if (game.isDraw()) return 'draw'
  if (game.isCheck()) return 'check'
  return 'playing'
}

/** Reactive fields recomputed from the instance after every mutation. */
function derived(game: Chess) {
  return {
    boardSnapshot: flattenBoard(game),
    turn: game.turn(),
    status: deriveStatus(game),
    moveHistory: game.history(),
  }
}

export const useGameStore = create<GameState>((set, get) => {
  const game = new Chess()
  const tracker = createPieceTracker()
  tracker.syncFromBoard(game.board())

  // Actors still mid-walk for the current move. Non-reactive: the reactive
  // mirror is `inputLocked`. Reassigned (not mutated) on each new move batch.
  let pendingSettle = new Set<ActorId>()

  /** Clear tracker to a fresh identity set from the live board (undo / reset). */
  function rebuildFromBoard() {
    tracker.syncFromBoard(game.board())
    pendingSettle = new Set()
  }

  return {
    game,
    ...derived(game),
    actors: tracker.actors(),
    animCommands: [],
    inputLocked: false,
    selectedSquare: null,
    pendingPromotion: null,
    autoFlip: true,

    board: () => flattenBoard(get().game),

    legalMoves: (square) => get().game.moves({ square, verbose: true }),

    legalTargets: () => {
      const { selectedSquare, game: g } = get()
      if (!selectedSquare) return []
      return g.moves({ square: selectedSquare, verbose: true }).map((m) => m.to)
    },

    tryMove: (from, to, promo) => {
      const g = get().game
      try {
        const move = g.move({ from, to, promotion: promo })
        // Advance piece identities, then script the walk for the pieces that moved.
        tracker.applyMove(move)
        const commands = directMove(move, (sq) => tracker.actorIdAt(sq))
        pendingSettle = new Set(commands.map((c) => c.actorId))
        set({
          ...derived(g),
          actors: tracker.actors(),
          animCommands: commands,
          inputLocked: pendingSettle.size > 0,
          selectedSquare: null,
          pendingPromotion: null,
        })
        return move
      } catch {
        // chess.js throws on an illegal move — report it as rejected.
        return null
      }
    },

    handleTap: (square) => {
      const { game: g, selectedSquare, inputLocked } = get()
      // Taps are ignored while pieces are still animating a move.
      if (inputLocked) return
      const turn = g.turn()
      const piece = g.get(square)

      // Nothing selected yet: select only an own piece.
      if (!selectedSquare) {
        if (piece && piece.color === turn) set({ selectedSquare: square })
        return
      }

      // Tapping the selected square again deselects.
      if (selectedSquare === square) {
        set({ selectedSquare: null })
        return
      }

      // Tapping another own piece re-selects it.
      if (piece && piece.color === turn) {
        set({ selectedSquare: square })
        return
      }

      // Otherwise treat the tap as a move target.
      const candidates = g
        .moves({ square: selectedSquare, verbose: true })
        .filter((m) => m.to === square)

      if (candidates.length === 0) {
        // Not a legal target — drop the selection.
        set({ selectedSquare: null })
        return
      }

      // A pawn reaching the last rank needs a piece choice first.
      if (candidates.some((m) => m.promotion)) {
        set({
          pendingPromotion: { from: selectedSquare, to: square, color: turn },
          selectedSquare: null,
        })
        return
      }

      get().tryMove(selectedSquare, square)
    },

    clearSelection: () => set({ selectedSquare: null }),

    completePromotion: (promo) => {
      const pending = get().pendingPromotion
      if (!pending) return null
      return get().tryMove(pending.from, pending.to, promo)
    },

    cancelPromotion: () => set({ pendingPromotion: null, selectedSquare: null }),

    undo: () => {
      const g = get().game
      const undone = g.undo()
      // Undo rebuilds identities from scratch (no replay animation), per plan.
      rebuildFromBoard()
      set({
        ...derived(g),
        actors: tracker.actors(),
        animCommands: [],
        inputLocked: false,
        selectedSquare: null,
        pendingPromotion: null,
      })
      return undone
    },

    newGame: () => {
      const g = get().game
      g.reset()
      rebuildFromBoard()
      set({
        ...derived(g),
        actors: tracker.actors(),
        animCommands: [],
        inputLocked: false,
        selectedSquare: null,
        pendingPromotion: null,
      })
    },

    toggleAutoFlip: () => set((s) => ({ autoFlip: !s.autoFlip })),

    settleActor: (id) => {
      if (!pendingSettle.has(id)) return
      pendingSettle.delete(id)
      if (pendingSettle.size === 0) set({ inputLocked: false, animCommands: [] })
    },

    settleAnimations: () => {
      pendingSettle = new Set()
      set({ inputLocked: false, animCommands: [] })
    },
  }
})
