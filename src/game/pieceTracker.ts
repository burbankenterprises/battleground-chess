import type { Square } from 'chess.js'
import type {
  ActorEvent,
  ActorId,
  ActorSnapshot,
  BoardCell,
  TrackedMove,
} from './types'

/**
 * pieceTracker — maps consecutive chess.js board states onto stable actor IDs
 * so the 3D layer animates pieces between squares instead of remounting them
 * every move.
 *
 * It maintains two mirrors of the same truth:
 *   - records:  Map<actorId, record>   — every actor ever created this game
 *   - bySquare: Map<square, actorId>   — LIVING actors only, one per square
 *
 * chess.js is the rules authority; this module never validates legality. It
 * only replays the consequences of an already-legal verbose Move onto the
 * identity maps, keyed off the move's flags.
 */

type ActorRecord = ActorSnapshot

export interface PieceTracker {
  /** Rebuild all identities from a board state with FRESH ids (undo / new game). */
  syncFromBoard(board: BoardCell[][]): void
  /** Apply one verbose Move; returns the per-actor events it produced. */
  applyMove(move: TrackedMove): ActorEvent[]
  /** Current render-facing snapshot of every actor (dead ones included). */
  actors(): ActorSnapshot[]
  /** The living actor currently on `square`, or undefined. */
  actorIdAt(square: Square): ActorId | undefined
}

/** Build a square from a file char + rank char (both already validated upstream). */
function squareOf(file: string, rank: string): Square {
  return `${file}${rank}` as Square
}

export function createPieceTracker(): PieceTracker {
  // Monotonic across the tracker's whole life — never resets — so every rebuild
  // (undo / new game) hands out ids that cannot collide with earlier ones.
  let nextId = 0
  const records = new Map<ActorId, ActorRecord>()
  const bySquare = new Map<Square, ActorId>()

  function freshId(): ActorId {
    return `a${nextId++}`
  }

  function record(id: ActorId): ActorRecord {
    const rec = records.get(id)
    if (!rec) throw new Error(`pieceTracker: missing record for actor ${id}`)
    return rec
  }

  function syncFromBoard(board: BoardCell[][]): void {
    records.clear()
    bySquare.clear()
    for (const row of board) {
      for (const cell of row) {
        if (!cell) continue
        const id = freshId()
        records.set(id, {
          id,
          square: cell.square,
          type: cell.type,
          color: cell.color,
          alive: true,
        })
        bySquare.set(cell.square, id)
      }
    }
  }

  /** Mark the living actor on `square` dead and unlink it from the square map. */
  function killAt(square: Square): ActorEvent | null {
    const id = bySquare.get(square)
    if (id === undefined) return null
    const rec = record(id)
    rec.alive = false
    bySquare.delete(square)
    return { kind: 'death', id, square }
  }

  /** Relocate the living actor from `from` to `to`. */
  function relocate(from: Square, to: Square): ActorEvent | null {
    const id = bySquare.get(from)
    if (id === undefined) return null
    const rec = record(id)
    bySquare.delete(from)
    rec.square = to
    bySquare.set(to, id)
    return { kind: 'move', id, from, to }
  }

  function applyMove(move: TrackedMove): ActorEvent[] {
    const events: ActorEvent[] = []
    const { from, to, flags } = move

    // 1) Resolve the capture FIRST so the victim leaves its square before the
    //    mover lands on it. En passant is checked before plain capture because
    //    its flag string is 'e' (never 'c'), and the victim sits on a DIFFERENT
    //    square than `to`.
    if (flags.includes('e')) {
      // Captured pawn: same file as `to`, same rank as `from`.
      const ev = killAt(squareOf(to[0], from[1]))
      if (ev) events.push(ev)
    } else if (flags.includes('c')) {
      const ev = killAt(to)
      if (ev) events.push(ev)
    }

    // 2) Move the primary actor (for castles this is the king).
    const moved = relocate(from, to)
    if (moved) events.push(moved)

    // 3) Castling also relocates the rook, computed from the side.
    //    kingside ('k'): h-file -> f-file; queenside ('q'): a-file -> d-file;
    //    always on the king's own rank.
    if (flags.includes('k') || flags.includes('q')) {
      const rank = from[1]
      const kingside = flags.includes('k')
      const rookEv = relocate(
        squareOf(kingside ? 'h' : 'a', rank),
        squareOf(kingside ? 'f' : 'd', rank),
      )
      if (rookEv) events.push(rookEv)
    }

    // 4) Promotion keeps the same actor id; only its type changes.
    if (flags.includes('p') && move.promotion) {
      const id = bySquare.get(to)
      if (id !== undefined) {
        const rec = record(id)
        rec.type = move.promotion
        events.push({ kind: 'promote', id, square: to, type: move.promotion })
      }
    }

    return events
  }

  function actors(): ActorSnapshot[] {
    return [...records.values()].map((r) => ({ ...r }))
  }

  function actorIdAt(square: Square): ActorId | undefined {
    return bySquare.get(square)
  }

  return { syncFromBoard, applyMove, actors, actorIdAt }
}
