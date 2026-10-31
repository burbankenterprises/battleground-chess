import { create } from 'zustand'
import { Chess } from 'chess.js'
import type { Color, Move, PieceSymbol, Square } from 'chess.js'
import { createPieceTracker } from './pieceTracker'
import { moveOutcomeOf } from './outcome'
import {
  directCameraShakes,
  directMove,
  directPositionAlarm,
  isLoopingCommand,
  sequenceDurationMs,
} from '../anim/director'
import type {
  ActorId,
  ActorSnapshot,
  AnimCommand,
  CameraShakeCue,
} from './types'

/**
 * Safety net for the input lock: if the render loop never reports a batch
 * settled (e.g. WebGL context lost, tab frozen mid-move), the store unlocks
 * this long after the sequence should have ended. Normal play never reaches it
 * — actors report settled on the first frame after their last command ends.
 */
export const LOCK_WATCHDOG_GRACE_MS = 1500

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
  /** Every actor identity this game (dead ones included), refreshed after every mutation. */
  actors: ActorSnapshot[]
  /**
   * Actors that belong in the 3D scene right now: every living actor plus any
   * dead actor still playing its death in the current sequence. A captured
   * actor leaves this list when the battle sequence settles.
   */
  sceneActors: ActorSnapshot[]
  /**
   * The current animation batch (director v2 timeline). One-shot commands are
   * dropped when the sequence settles; the looping check `alarm` and the final
   * `checkmate-fall` pose are retained until the next batch.
   */
  animCommands: AnimCommand[]
  /** Monotonic id of the current animation batch. */
  animSeq: number
  /** performance.now() when the current batch started — every command's delayMs is relative to it. */
  animStartedAt: number
  /** Camera micro-shake cues for the current batch (capture impacts). */
  cameraShakes: CameraShakeCue[]
  /** True while any one-shot command of the current sequence is still playing. */
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
  /**
   * One actor finished every one-shot command of the current batch. When the
   * last one reports, the sequence settles: input unlocks and dying actors
   * leave the scene. A `seq` from an older batch is ignored.
   */
  settleActor: (id: ActorId, seq?: number) => void
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

/**
 * Living actors plus the dead actors that still have a death to play in
 * `commands` — i.e. who belongs in the 3D scene right now.
 */
export function sceneActorsFor(
  actors: readonly ActorSnapshot[],
  commands: readonly AnimCommand[],
): ActorSnapshot[] {
  const dying = new Set<ActorId>()
  for (const c of commands) if (c.type === 'death') dying.add(c.actorId)
  return actors.filter((a) => a.alive || dying.has(a.id))
}

/** Commands that outlive their sequence: the check alarm loop and the mated king's final pose. */
function retainedAfterSettle(command: AnimCommand): boolean {
  return command.type === 'alarm' || command.type === 'checkmate-fall'
}

export const useGameStore = create<GameState>((set, get) => {
  const game = new Chess()
  const tracker = createPieceTracker()
  tracker.syncFromBoard(game.board())

  // Actors with one-shot commands still playing in the current batch.
  // Non-reactive: the reactive mirror is `inputLocked`. Reassigned per batch.
  let pendingSettle = new Set<ActorId>()
  // Pending lock watchdog for the current batch (see LOCK_WATCHDOG_GRACE_MS).
  let watchdog: ReturnType<typeof setTimeout> | null = null

  const resolveActorId = (square: Square) => tracker.actorIdAt(square)

  function clearWatchdog() {
    if (watchdog !== null) clearTimeout(watchdog)
    watchdog = null
  }

  /** Publish a fresh animation batch (plus any extra state) in one store update. */
  function startBatch(commands: AnimCommand[], extra: Partial<GameState>) {
    clearWatchdog()
    pendingSettle = new Set(
      commands.filter((c) => !isLoopingCommand(c)).map((c) => c.actorId),
    )
    const actors = tracker.actors()
    const seq = get().animSeq + 1
    set({
      ...derived(game),
      actors,
      sceneActors: sceneActorsFor(actors, commands),
      animCommands: commands,
      animSeq: seq,
      animStartedAt: performance.now(),
      cameraShakes: directCameraShakes(commands),
      inputLocked: pendingSettle.size > 0,
      ...extra,
    })
    if (pendingSettle.size > 0) {
      watchdog = setTimeout(() => {
        watchdog = null
        if (get().animSeq === seq && get().inputLocked) finishBatch()
      }, sequenceDurationMs(commands) + LOCK_WATCHDOG_GRACE_MS)
    }
  }

  /** The sequence is over: unlock input, drop one-shot commands and dying actors. */
  function finishBatch() {
    clearWatchdog()
    pendingSettle = new Set()
    const { animCommands, actors } = get()
    const retained = animCommands.filter(retainedAfterSettle)
    set({
      inputLocked: false,
      animCommands: retained,
      sceneActors: sceneActorsFor(actors, retained),
      cameraShakes: [],
    })
  }

  /**
   * Rebuild identities from the live board (undo / new game) with no move
   * animation. If the side to move is in check, its king alarms immediately.
   */
  function resetToBoard() {
    tracker.syncFromBoard(game.board())
    const alarm = directPositionAlarm(moveOutcomeOf(game), resolveActorId)
    startBatch(alarm ? [alarm] : [], { selectedSquare: null, pendingPromotion: null })
  }

  const initialActors = tracker.actors()

  return {
    game,
    ...derived(game),
    actors: initialActors,
    sceneActors: sceneActorsFor(initialActors, []),
    animCommands: [],
    animSeq: 0,
    animStartedAt: 0,
    cameraShakes: [],
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
      let move: Move
      try {
        move = game.move({ from, to, promotion: promo })
      } catch {
        // chess.js throws on an illegal move — report it as rejected.
        return null
      }
      // Advance piece identities, then script the full battle timeline for the
      // move, including the post-move check / checkmate state from chess.js.
      let commands: AnimCommand[]
      try {
        const events = tracker.applyMove(move)
        commands = directMove(move, resolveActorId, events, moveOutcomeOf(game))
      } catch (err) {
        // Identity bookkeeping failed (should be impossible for a legal move).
        // chess.js already applied the move, so resync the pieces from its
        // board — the scene must never disagree with the rules authority.
        console.error('battleground-chess: move scripting failed, resyncing pieces', err)
        tracker.syncFromBoard(game.board())
        commands = []
      }
      startBatch(commands, { selectedSquare: null, pendingPromotion: null })
      return move
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
      const undone = game.undo()
      // Undo rebuilds identities from scratch (no replay animation), per plan.
      resetToBoard()
      return undone
    },

    newGame: () => {
      game.reset()
      resetToBoard()
    },

    toggleAutoFlip: () => set((s) => ({ autoFlip: !s.autoFlip })),

    settleActor: (id, seq) => {
      if (seq !== undefined && seq !== get().animSeq) return
      if (!pendingSettle.has(id)) return
      pendingSettle.delete(id)
      if (pendingSettle.size === 0) finishBatch()
    },

    settleAnimations: () => {
      finishBatch()
    },
  }
})
