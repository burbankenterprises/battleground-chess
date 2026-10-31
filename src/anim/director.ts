import type { Square } from 'chess.js'
import type {
  ActorEvent,
  ActorId,
  AlarmCommand,
  AnimCommand,
  CameraShakeCue,
  MoveCommand,
  MoveOutcome,
  TrackedMove,
} from '../game/types'

/**
 * director v2 — turns a single chess.js verbose Move into the per-actor
 * `AnimCommand[]` timeline the 3D layer plays.
 *
 * The director owns the timeline as DATA: every command carries `delayMs` (its
 * offset from the start of the move's sequence) and `durationMs`. PieceActor
 * only executes. chess.js stays the rules authority — the director schedules
 * the visual consequences of an already-legal move, using the tracker's actor
 * events (who died where) and the post-move check/checkmate facts that the
 * caller reads from chess.js.
 *
 * Sequences per move flags:
 * - quiet (n / b / promotion without capture): one `move` (walk + landing settle).
 * - capture (c): attacker `move` approach (constant walking pace, see
 *   approachDurationMs) → `lunge` (LUNGE_MS) → impact frame: defender `death`
 *   (DEATH_MS, starts AT impact) + attacker `settle-impact` (SETTLE_IMPACT_MS)
 *   onto the captured square. Camera micro-shake on impact.
 * - en passant (e): identical, but the lunge targets the EMPTY destination and
 *   the death goes to the pawn beside it (file of `to`, rank of `from`).
 * - castling (k / q): king + rook walk simultaneously (both delay 0).
 * - promotion (p): after the pawn arrives, `promotion-transform` — shrink +
 *   flash (PROMOTION_SHRINK_MS) → geometry swap → grow (PROMOTION_GROW_MS).
 * - check: looping `alarm` on the checked king, starting when the sequence ends.
 * - checkmate: `checkmate-fall` on the mated king once everything else is done.
 * - stalemate / draw: no special piece animation.
 */

// ---- Walk timing (Jon play-test: 350ms read as a teleport on a phone) ----

/** Walk time for a one-tile move. */
export const BASE_MOVE_MS = 600
/** Hard cap on a single walk, long slides included. */
export const MAX_MOVE_MS = 1100
/** Landing settle/bob appended after a piece arrives on its square. */
export const LAND_MS = 180

// ---- Battle timing ----

/** Attacker's strike from the approach point to the impact frame. */
export const LUNGE_MS = 180
/** Attacker settling from the impact point onto the captured square. */
export const SETTLE_IMPACT_MS = 150
/** Defender fall + shatter + dust; starts on the impact frame (overlaps the settle). */
export const DEATH_MS = 500
/** Promotion: pawn shrinks with a white flash. */
export const PROMOTION_SHRINK_MS = 200
/** Promotion: the new piece type scales up. */
export const PROMOTION_GROW_MS = 250
/** Checkmate: the losing king's slow fall + dust. */
export const CHECKMATE_FALL_MS = 800
/** One wobble cycle of the check alarm loop. */
export const ALARM_PERIOD_MS = 900
/** Camera micro-shake on capture impact. */
export const SHAKE_MS = 150
/** Peak camera micro-shake offset (world units) — deliberately small. */
export const SHAKE_AMPLITUDE = 0.07

// ---- Battle geometry (in tiles) ----

/** The approach walk stops this far short of the target, leaving room to lunge. */
export const LUNGE_REACH_TILES = 0.95
/** The lunge's impact point sits this far short of the target square (piece contact). */
export const CONTACT_GAP_TILES = 0.42
/** Shortest approach before the strike — a brief brace even for adjacent captures. */
export const MIN_APPROACH_MS = 200

/** Neutral outcome: no check, no mate. */
export const QUIET_OUTCOME: MoveOutcome = { check: false, checkmate: false }

/** 0-based [file, rank] for an algebraic square. */
function fileRank(square: Square): [number, number] {
  return [square.charCodeAt(0) - 97, Number(square[1]) - 1]
}

/** Straight-line distance between two square centers, in tiles. */
function tileDistance(from: Square, to: Square): number {
  const [ff, fr] = fileRank(from)
  const [tf, tr] = fileRank(to)
  return Math.hypot(tf - ff, tr - fr)
}

/**
 * Walk duration for a hop between two squares: linear in tile distance
 * (Chebyshev — a king-step counts 1), floored at one tile and capped at MAX.
 * Excludes the landing settle (LAND_MS) that quiet arrivals append.
 */
export function moveDurationMs(from: Square, to: Square): number {
  const [ff, fr] = fileRank(from)
  const [tf, tr] = fileRank(to)
  const tiles = Math.max(Math.abs(tf - ff), Math.abs(tr - fr))
  const raw = BASE_MOVE_MS * Math.max(tiles, 1)
  return Math.min(raw, MAX_MOVE_MS)
}

/**
 * Capture approach: the attacker walks at the one-tile pace (BASE_MOVE_MS per
 * tile of straight-line distance) up to striking distance, floored at
 * MIN_APPROACH_MS and capped so the impact frame never lands later than the
 * longest walk (approach + LUNGE_MS ≤ MAX_MOVE_MS).
 */
export function approachDurationMs(from: Square, to: Square): number {
  const tiles = Math.max(0, tileDistance(from, to) - LUNGE_REACH_TILES)
  const raw = Math.round(tiles * BASE_MOVE_MS)
  return Math.min(Math.max(raw, MIN_APPROACH_MS), MAX_MOVE_MS - LUNGE_MS)
}

/** Resolves the actor id now occupying a square (post-applyMove positions). */
export type ActorIdResolver = (square: Square) => ActorId | undefined

/** Looping commands (the check alarm) never hold the input lock. */
export function isLoopingCommand(command: AnimCommand): command is AlarmCommand {
  return command.type === 'alarm'
}

/** Wall-clock span of a command list: the latest end among one-shot commands. */
export function sequenceDurationMs(commands: readonly AnimCommand[]): number {
  let end = 0
  for (const c of commands) {
    if (isLoopingCommand(c)) continue
    end = Math.max(end, c.delayMs + c.durationMs)
  }
  return end
}

/** One camera micro-shake cue per capture impact (= each death's start). */
export function directCameraShakes(commands: readonly AnimCommand[]): CameraShakeCue[] {
  const impacts = new Set<number>()
  for (const c of commands) if (c.type === 'death') impacts.add(c.delayMs)
  return [...impacts]
    .sort((a, b) => a - b)
    .map((delayMs) => ({ delayMs, durationMs: SHAKE_MS, amplitude: SHAKE_AMPLITUDE }))
}

/** Rook's [from, to] for a castle, derived from the king's rank + side. */
function castleRookSquares(move: TrackedMove): { from: Square; to: Square } {
  const rank = move.from[1]
  const kingside = move.flags.includes('k')
  return {
    from: `${kingside ? 'h' : 'a'}${rank}` as Square,
    to: `${kingside ? 'f' : 'd'}${rank}` as Square,
  }
}

function isCastle(move: TrackedMove): boolean {
  return move.flags.includes('k') || move.flags.includes('q')
}

function isCapture(move: TrackedMove): boolean {
  return move.flags.includes('c') || move.flags.includes('e')
}

/** A quiet walk that ends with the landing settle/bob. */
function walkCommand(actorId: ActorId, from: Square, to: Square, arc: boolean): MoveCommand {
  return {
    type: 'move',
    actorId,
    delayMs: 0,
    durationMs: moveDurationMs(from, to) + LAND_MS,
    from,
    to,
    arc,
    stopShortTiles: 0,
    landMs: LAND_MS,
  }
}

function alarmCommand(actorId: ActorId, square: Square, delayMs: number): AlarmCommand {
  return { type: 'alarm', actorId, delayMs, durationMs: ALARM_PERIOD_MS, square, loop: true }
}

/** Castling: king + rook walk together (both start at 0). */
function scriptCastle(move: TrackedMove, resolve: ActorIdResolver, out: AnimCommand[]): void {
  const kingId = resolve(move.to)
  if (kingId !== undefined) out.push(walkCommand(kingId, move.from, move.to, false))
  const rook = castleRookSquares(move)
  const rookId = resolve(rook.to)
  if (rookId !== undefined) out.push(walkCommand(rookId, rook.from, rook.to, false))
}

/** Every non-castle move: the mover's walk or battle, then promotion if any. */
function scriptMover(
  move: TrackedMove,
  resolve: ActorIdResolver,
  events: readonly ActorEvent[],
  out: AnimCommand[],
): void {
  const moverId = resolve(move.to)
  if (moverId === undefined) return
  const arc = move.piece === 'n' // knights hop; everything else slides

  let arrivedAtMs: number
  if (isCapture(move)) {
    // Walk up to striking distance, strike, and impact on the lunge's last frame.
    const approachMs = approachDurationMs(move.from, move.to)
    const impactMs = approachMs + LUNGE_MS
    out.push({
      type: 'move',
      actorId: moverId,
      delayMs: 0,
      durationMs: approachMs,
      from: move.from,
      to: move.to,
      arc,
      stopShortTiles: LUNGE_REACH_TILES,
      landMs: 0,
    })
    out.push({
      type: 'lunge',
      actorId: moverId,
      delayMs: approachMs,
      durationMs: LUNGE_MS,
      from: move.from,
      to: move.to,
      fromShortTiles: LUNGE_REACH_TILES,
      stopShortTiles: CONTACT_GAP_TILES,
    })
    // The tracker reports the victim's id + square (en passant: beside `to`).
    const victim = events.find(
      (e): e is Extract<ActorEvent, { kind: 'death' }> => e.kind === 'death',
    )
    if (victim) {
      out.push({
        type: 'death',
        actorId: victim.id,
        delayMs: impactMs,
        durationMs: DEATH_MS,
        square: victim.square,
        attackerFrom: move.from,
      })
    }
    out.push({
      type: 'settle-impact',
      actorId: moverId,
      delayMs: impactMs,
      durationMs: SETTLE_IMPACT_MS,
      from: move.from,
      to: move.to,
      fromShortTiles: CONTACT_GAP_TILES,
    })
    arrivedAtMs = impactMs + SETTLE_IMPACT_MS
  } else {
    const walk = walkCommand(moverId, move.from, move.to, arc)
    out.push(walk)
    arrivedAtMs = walk.durationMs
  }

  // Promotion (same actor id — the tracker already changed its type): once the
  // pawn has arrived it shrinks + flashes, swaps geometry, and grows back.
  if (move.flags.includes('p') && move.promotion) {
    out.push({
      type: 'promotion-transform',
      actorId: moverId,
      delayMs: arrivedAtMs,
      durationMs: PROMOTION_SHRINK_MS + PROMOTION_GROW_MS,
      square: move.to,
      fromType: move.piece,
      toType: move.promotion,
      swapAtMs: PROMOTION_SHRINK_MS,
    })
  }
}

/** Check → looping alarm; checkmate → slow fall. Both start when the move's own sequence ends. */
function scriptKingState(
  move: TrackedMove,
  resolve: ActorIdResolver,
  outcome: MoveOutcome,
  out: AnimCommand[],
): void {
  if (!outcome.kingSquare || (!outcome.check && !outcome.checkmate)) return
  const kingId = resolve(outcome.kingSquare)
  if (kingId === undefined) return
  const startMs = sequenceDurationMs(out)
  if (outcome.checkmate) {
    out.push({
      type: 'checkmate-fall',
      actorId: kingId,
      delayMs: startMs,
      durationMs: CHECKMATE_FALL_MS,
      square: outcome.kingSquare,
      // Topple away from the (first) checking piece; when the caller supplied
      // no checkers, the mating move's destination is the best stand-in.
      fallAwayFrom: outcome.checkers?.[0] ?? move.to,
    })
  } else {
    out.push(alarmCommand(kingId, outcome.kingSquare, startMs))
  }
}

/**
 * Convert one verbose Move into its animation timeline (chronological order:
 * `delayMs` never decreases along the returned array).
 *
 * `resolveActorId` is queried against the post-move board (the mover already
 * sits on its destination). `events` are the tracker's `applyMove` events for
 * this move (they identify the captured actor). `outcome` carries chess.js's
 * post-move check/checkmate facts for the side now to move.
 */
export function directMove(
  move: TrackedMove,
  resolveActorId: ActorIdResolver,
  events: readonly ActorEvent[] = [],
  outcome: MoveOutcome = QUIET_OUTCOME,
): AnimCommand[] {
  const commands: AnimCommand[] = []
  if (isCastle(move)) scriptCastle(move, resolveActorId, commands)
  else scriptMover(move, resolveActorId, events, commands)
  scriptKingState(move, resolveActorId, outcome, commands)
  return commands
}

/**
 * Alarm for a position reached WITHOUT a move animation (undo / new game):
 * if the side to move is in check (and not mated), its king alarms from t=0.
 */
export function directPositionAlarm(
  outcome: MoveOutcome,
  resolveActorId: ActorIdResolver,
): AlarmCommand | null {
  if (!outcome.check || outcome.checkmate || !outcome.kingSquare) return null
  const kingId = resolveActorId(outcome.kingSquare)
  if (kingId === undefined) return null
  return alarmCommand(kingId, outcome.kingSquare, 0)
}
