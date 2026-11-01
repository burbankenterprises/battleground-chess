import type { Color, PieceSymbol } from 'chess.js'

/**
 * Captured trays (Phase 5): derived from the move history's capture flags —
 * no new game state. Input is chess.js's own verbose history (the rules
 * authority): every Move carries the mover's `color` and, for any capture
 * (en passant and capturing promotions included), the `captured` piece type.
 */

/** The subset of a chess.js verbose Move the trays need. */
export type CaptureRecord = { color: Color; captured?: PieceSymbol }

export type CapturedTrays = {
  /** Enemy pieces each army has captured, most valuable first (q, r, b, n, p). */
  w: PieceSymbol[]
  b: PieceSymbol[]
}

/** Standard material values (pawn = 1) for the material-lead badge. */
export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/** Display order inside a tray: most valuable first. */
const TRAY_ORDER: Record<PieceSymbol, number> = { q: 0, r: 1, b: 2, n: 3, p: 4, k: 5 }

/** Captured pieces per capturing army, from the move list's capture flags. */
export function capturedFromMoves(moves: readonly CaptureRecord[]): CapturedTrays {
  const trays: CapturedTrays = { w: [], b: [] }
  for (const m of moves) {
    if (m.captured) trays[m.color].push(m.captured)
  }
  trays.w.sort((a, b) => TRAY_ORDER[a] - TRAY_ORDER[b])
  trays.b.sort((a, b) => TRAY_ORDER[a] - TRAY_ORDER[b])
  return trays
}

/** Material an army has captured (sum of PIECE_VALUE). */
export function trayValue(pieces: readonly PieceSymbol[]): number {
  return pieces.reduce((sum, p) => sum + PIECE_VALUE[p], 0)
}

/**
 * Material lead shown beside a tray: `+N` for the side that captured more
 * value, 0 for the other side and when level.
 */
export function materialLead(trays: CapturedTrays): { w: number; b: number } {
  const diff = trayValue(trays.w) - trayValue(trays.b)
  return { w: Math.max(0, diff), b: Math.max(0, -diff) }
}

/** Group a (sorted) tray into runs for compact display: pawn ×3. */
export function trayGroups(pieces: readonly PieceSymbol[]): { type: PieceSymbol; count: number }[] {
  const groups: { type: PieceSymbol; count: number }[] = []
  for (const p of pieces) {
    const last = groups[groups.length - 1]
    if (last && last.type === p) last.count++
    else groups.push({ type: p, count: 1 })
  }
  return groups
}

/**
 * Solid chess glyphs (the shape reads on a dark HUD; army is shown by color),
 * each forced to TEXT presentation with VS15 — U+265F (♟) is also an emoji,
 * and iOS / Android would otherwise draw it as a color emoji.
 */
export const PIECE_GLYPH: Record<PieceSymbol, string> = {
  k: '\u265A\uFE0E',
  q: '\u265B\uFE0E',
  r: '\u265C\uFE0E',
  b: '\u265D\uFE0E',
  n: '\u265E\uFE0E',
  p: '\u265F\uFE0E',
}

/** Piece names for accessible labels. */
export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

/** Accessible summary of one tray, e.g. "White has captured 2 pawns and a knight". */
export function trayLabel(armyName: string, pieces: readonly PieceSymbol[]): string {
  if (pieces.length === 0) return `${armyName} has captured nothing`
  const parts = trayGroups(pieces).map(({ type, count }) =>
    count === 1 ? `a ${PIECE_NAME[type]}` : `${count} ${PIECE_NAME[type]}s`,
  )
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${armyName} has captured ${list}`
}
