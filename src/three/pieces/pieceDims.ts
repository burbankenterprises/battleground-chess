import type { PieceSymbol } from 'chess.js'

/**
 * Physical dimensions of each piece model (world units), used by the battle
 * animations: `radius` is the base radius the piece topples over (edge pivot,
 * so a falling piece never sinks into the board) and `height` places shatter
 * shards along the body. Phase 4 updates these numbers, not the animation code.
 *
 * Measured from the procedural models (models.ts) with Box3.setFromObject in
 * the authored frame; models.test.ts fails if a model drifts from these:
 *   radius = the plinth's bottom-rim radius, shared by both armies' models of a
 *            type, and no part of either model reaches beyond it — so the
 *            pivot is the true topple edge for both armies.
 *   height = the tallest of the two armies' models of that type:
 *     p  Israelite slinger 0.470 · Philistine shield-bearer 0.492 (spear tip)
 *     r  chariot 0.660 (javelin tip), both armies
 *     n  horseman 0.810 (spear tip), both armies
 *     b  prophet 0.839 (staff crook) · Dagon priest 0.870 (fish-crown jaws)
 *     q  mighty-man 0.970 (banner finial) · Goliath ~1.01 (spear tip, champion ×1.05)
 *     k  enthroned king 1.100 (banner tips), both armies — the KING is tallest (Jon, Nov 2026)
 */
export const PIECE_DIMS: Record<PieceSymbol, { radius: number; height: number }> = {
  p: { radius: 0.22, height: 0.5 },
  r: { radius: 0.28, height: 0.66 },
  n: { radius: 0.28, height: 0.81 },
  b: { radius: 0.21, height: 0.87 },
  q: { radius: 0.28, height: 0.97 },
  k: { radius: 0.29, height: 1.1 },
}
