import type { Color, PieceSymbol, Square } from 'chess.js'

/**
 * Shared types: persistent piece identities (Phase 2) and the animation
 * command schema the director emits and the 3D actors execute (Phase 3,
 * director v2).
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
 * layer and the battle director to script per-actor timelines.
 */
export type ActorEvent =
  | { kind: 'move'; id: ActorId; from: Square; to: Square }
  | { kind: 'death'; id: ActorId; square: Square }
  | { kind: 'promote'; id: ActorId; square: Square; type: PieceSymbol }

/**
 * Timing every command carries. The director owns the timeline as data: a
 * command occupies `[delayMs, delayMs + durationMs]` measured from the start
 * of its move's sequence. PieceActor only executes it.
 */
export type CommandTiming = {
  actorId: ActorId
  /** Offset from the start of the move's animation sequence (ms). */
  delayMs: number
  /** Play time once started (ms). For a looping command: one cycle. */
  durationMs: number
}

/** Walk / slide / hop from `from` toward `to`. */
export type MoveCommand = CommandTiming & {
  type: 'move'
  from: Square
  to: Square
  /** Parabolic hop (knights) vs. ground slide with walk-bob (everything else). */
  arc: boolean
  /** Stop this many tiles short of `to` (capture approach); 0 = arrive on `to`. */
  stopShortTiles: number
  /** Tail of `durationMs` spent on the landing settle/bob after arrival; 0 = none. */
  landMs: number
}

/** Attacker's strike: a fast dash toward the attacked square, ending at impact. */
export type LungeCommand = CommandTiming & {
  type: 'lunge'
  /** The move's origin square — fixes the strike direction. */
  from: Square
  /** The square being attacked (the EMPTY destination for en passant). */
  to: Square
  /** The strike starts this many tiles short of `to` (where the approach stopped). */
  fromShortTiles: number
  /** The strike ends (impact frame) this many tiles short of `to`. */
  stopShortTiles: number
}

/** Attacker settles from the impact point onto the captured square. */
export type SettleImpactCommand = CommandTiming & {
  type: 'settle-impact'
  from: Square
  to: Square
  /** Starts this many tiles short of `to` (the lunge's impact point); ends on `to`. */
  fromShortTiles: number
}

/** Defender death: fall over, shatter into shards, dust puff. */
export type DeathCommand = CommandTiming & {
  type: 'death'
  /** Where the victim stands (for en passant this is NOT the attacker's destination). */
  square: Square
  /** The attacker's origin square — the victim falls away from it. */
  attackerFrom: Square
}

/** Promotion: shrink + white flash, swap geometry, grow as the new type. */
export type PromotionTransformCommand = CommandTiming & {
  type: 'promotion-transform'
  square: Square
  fromType: PieceSymbol
  toType: PieceSymbol
  /** Offset inside the command where the geometry swaps (end of shrink + flash). */
  swapAtMs: number
}

/** Check alarm on the threatened king: wobble/pulse loop. */
export type AlarmCommand = CommandTiming & {
  type: 'alarm'
  square: Square
  /** Loops until the store clears it (check resolved); never holds the input lock. */
  loop: true
}

/** Checkmate: the mated king slowly topples over with a dust puff. */
export type CheckmateFallCommand = CommandTiming & {
  type: 'checkmate-fall'
  square: Square
  /** The king topples away from this square (the checking piece). */
  fallAwayFrom: Square
}

/** A single timed instruction for one actor (director v2). */
export type AnimCommand =
  | MoveCommand
  | LungeCommand
  | SettleImpactCommand
  | DeathCommand
  | PromotionTransformCommand
  | AlarmCommand
  | CheckmateFallCommand

export type AnimCommandType = AnimCommand['type']

/** Additive camera micro-shake cue (capture impacts), timed on the move's sequence clock. */
export type CameraShakeCue = {
  delayMs: number
  durationMs: number
  /** Peak offset in world units. */
  amplitude: number
}

/**
 * Post-move position facts read from chess.js (the rules authority) for the
 * side now to move. The director consumes them; it never derives them itself.
 */
export type MoveOutcome = {
  /** chess.js `isCheck()` for the side to move. */
  check: boolean
  /** chess.js `isCheckmate()`. */
  checkmate: boolean
  /** Square of the side-to-move's king. */
  kingSquare?: Square
  /** chess.js `attackers(kingSquare, opponent)` — the pieces giving check. */
  checkers?: Square[]
}
