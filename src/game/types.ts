import type { Color, PieceSymbol, Square } from 'chess.js'

/**
 * Shared Phase 2 types: persistent piece identities and the animation command
 * schema that the director emits and the 3D actors consume.
 */

/** Stable identity for one physical piece across its whole life on the board. */
export type ActorId = string

/** Reactive, render-facing snapshot of a single actor. */
export type ActorSnapshot = {
  id: ActorId
  /** Square it occupies (or, if dead, the square where it died). */
  square: Square
  type: PieceSymbol
  color: Color
  alive: boolean
}

/**
 * The minimal subset of a chess.js verbose `Move` the tracker + director read.
 * Kept structural so a real chess.js `Move` satisfies it directly.
 */
export type TrackedMove = {
  from: Square
  to: Square
  /** chess.js flag string: n,b,c,e,k,q,p (may combine, e.g. 'cp'). */
  flags: string
  piece: PieceSymbol
  color: Color
  captured?: PieceSymbol
  promotion?: PieceSymbol
}

/** One cell of chess.js `board()` — null when empty. */
export type BoardCell = { square: Square; type: PieceSymbol; color: Color } | null

/**
 * What happened to a specific actor during `applyMove` — enough for the 3D
 * layer and (Phase 3) the battle director to script per-actor timelines.
 */
export type ActorEvent =
  | { kind: 'move'; id: ActorId; from: Square; to: Square }
  | { kind: 'death'; id: ActorId; square: Square }
  | { kind: 'promote'; id: ActorId; square: Square; type: PieceSymbol }

/**
 * A single timed instruction for one actor. v1 only produces `move` commands;
 * battle/death commands arrive in Phase 3 (director v2).
 */
export type AnimCommand = {
  actorId: ActorId
  type: 'move'
  from: Square
  to: Square
  durationMs: number
  /** Parabolic hop (knights) vs. ground slide/bob (everything else). */
  arc?: boolean
}
