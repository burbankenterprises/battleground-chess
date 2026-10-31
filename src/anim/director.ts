import type { Square } from 'chess.js'
import type { ActorId, AnimCommand, TrackedMove } from '../game/types'

/**
 * director v1 — turns a single chess.js verbose Move into the per-actor
 * `AnimCommand[]` the 3D layer plays. v1 only emits `move` commands (walk /
 * slide / hop); capture-death, promotion-flash and check wobble arrive in
 * Phase 3 (director v2). chess.js stays the rules authority — the director only
 * schedules the visual consequences of an already-legal move.
 */

/** Walk time for a one-tile move (spec: ~350ms for 1 tile). */
export const BASE_MOVE_MS = 350
/** Hard cap on a single walk, long slides included (spec: ~700ms). */
export const MAX_MOVE_MS = 700

/** 0-based [file, rank] for an algebraic square. */
function fileRank(square: Square): [number, number] {
  return [square.charCodeAt(0) - 97, Number(square[1]) - 1]
}

/**
 * Walk duration for a hop between two squares: linear in tile distance
 * (Chebyshev — a king-step counts 1), floored at one tile and capped at MAX.
 */
export function moveDurationMs(from: Square, to: Square): number {
  const [ff, fr] = fileRank(from)
  const [tf, tr] = fileRank(to)
  const tiles = Math.max(Math.abs(tf - ff), Math.abs(tr - fr))
  const raw = BASE_MOVE_MS * Math.max(tiles, 1)
  return Math.min(raw, MAX_MOVE_MS)
}

/** Resolves the actor id now occupying a square (post-applyMove positions). */
export type ActorIdResolver = (square: Square) => ActorId | undefined

/** Rook's [from, to] for a castle, derived from the king's rank + side. */
function castleRookSquares(move: TrackedMove): { from: Square; to: Square } {
  const rank = move.from[1]
  const kingside = move.flags.includes('k')
  return {
    from: `${kingside ? 'h' : 'a'}${rank}` as Square,
    to: `${kingside ? 'f' : 'd'}${rank}` as Square,
  }
}

/**
 * Convert one verbose Move into animation commands.
 *
 * - normal / big-pawn / capture / en-passant / promotion → ONE move command for
 *   the piece that moved (knights travel a parabolic arc: `arc:true`).
 * - castling (`k`/`q`) → TWO simultaneous move commands (king + rook).
 *
 * `resolveActorId` is queried against the post-move board (the mover already
 * sits on its destination), so it maps each destination square to the stable
 * actor that now holds it.
 */
export function directMove(
  move: TrackedMove,
  resolveActorId: ActorIdResolver,
): AnimCommand[] {
  const commands: AnimCommand[] = []

  // Castling: king + rook move together, each a plain ground slide.
  if (move.flags.includes('k') || move.flags.includes('q')) {
    const kingId = resolveActorId(move.to)
    if (kingId !== undefined) {
      commands.push({
        actorId: kingId,
        type: 'move',
        from: move.from,
        to: move.to,
        durationMs: moveDurationMs(move.from, move.to),
        arc: false,
      })
    }
    const rook = castleRookSquares(move)
    const rookId = resolveActorId(rook.to)
    if (rookId !== undefined) {
      commands.push({
        actorId: rookId,
        type: 'move',
        from: rook.from,
        to: rook.to,
        durationMs: moveDurationMs(rook.from, rook.to),
        arc: false,
      })
    }
    return commands
  }

  // Every other move: a single actor travels from → to.
  const moverId = resolveActorId(move.to)
  if (moverId !== undefined) {
    commands.push({
      actorId: moverId,
      type: 'move',
      from: move.from,
      to: move.to,
      durationMs: moveDurationMs(move.from, move.to),
      // Knights hop; everything else slides.
      arc: move.piece === 'n',
    })
  }

  return commands
}
