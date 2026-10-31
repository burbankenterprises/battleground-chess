import type { PieceSymbol } from 'chess.js'

/**
 * Rough physical dimensions of each placeholder piece (world units), used by
 * the battle animations: `radius` is the base radius the piece topples over
 * (edge pivot, so a falling piece never sinks into the board) and `height`
 * places shatter shards along the body. Keep in sync with PlaceholderPiece
 * (Phase 4 models should update these numbers, not the animation code).
 */
export const PIECE_DIMS: Record<PieceSymbol, { radius: number; height: number }> = {
  p: { radius: 0.24, height: 0.44 },
  r: { radius: 0.21, height: 0.62 },
  n: { radius: 0.21, height: 0.78 },
  b: { radius: 0.24, height: 0.76 },
  q: { radius: 0.28, height: 0.9 },
  k: { radius: 0.29, height: 1.03 },
}
