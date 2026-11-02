import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { buildWarfarePiece } from './models'

/** Jon's rule (Nov 2026): the king is the tallest piece on the board. */
describe('height ladder — king is tallest', () => {
  it('every king model is taller than every other piece model', () => {
    const kingH = Math.max(
      ...(['w', 'b'] as const).map(
        (c) => new Box3().setFromObject(buildWarfarePiece('k', c), true).max.y,
      ),
    )
    for (const t of ['p', 'r', 'n', 'b', 'q'] as const) {
      for (const c of ['w', 'b'] as const) {
        const h = new Box3().setFromObject(buildWarfarePiece(t, c), true).max.y
        expect(h, `${c}${t} must be shorter than the king`).toBeLessThan(kingH)
      }
    }
  })
})
