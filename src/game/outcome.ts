import type { Chess } from 'chess.js'
import type { MoveOutcome } from './types'

/**
 * Check facts for the side to move, read straight from chess.js (the rules
 * authority — nothing is derived here): `isCheck()` / `isCheckmate()`, that
 * side's king square, and the opposing pieces attacking it.
 */
export function moveOutcomeOf(game: Chess): MoveOutcome {
  const check = game.isCheck()
  const checkmate = game.isCheckmate()
  if (!check) return { check: false, checkmate: false }
  const side = game.turn()
  const kingSquare = game.findPiece({ type: 'k', color: side })[0]
  const checkers = kingSquare ? game.attackers(kingSquare, side === 'w' ? 'b' : 'w') : []
  return { check, checkmate, kingSquare, checkers }
}
