import type { Color, PieceSymbol } from 'chess.js'
import { useGameStore } from '../game/store'

/** The four legal promotion pieces, with labels + Unicode glyphs. */
const CHOICES: { piece: PieceSymbol; label: string; glyph: Record<Color, string> }[] = [
  { piece: 'q', label: 'Queen', glyph: { w: '\u2655', b: '\u265B' } },
  { piece: 'r', label: 'Rook', glyph: { w: '\u2656', b: '\u265C' } },
  { piece: 'b', label: 'Bishop', glyph: { w: '\u2657', b: '\u265D' } },
  { piece: 'n', label: 'Knight', glyph: { w: '\u2658', b: '\u265E' } },
]

/**
 * Promotion modal. Shown only while a pawn move is pending a piece choice.
 * Buttons are >=44px touch targets (spec).
 */
export function PromotionPicker() {
  const pending = useGameStore((s) => s.pendingPromotion)
  const completePromotion = useGameStore((s) => s.completePromotion)
  const cancelPromotion = useGameStore((s) => s.cancelPromotion)

  if (!pending) return null
  const color = pending.color

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#161a22] p-5 shadow-2xl">
        <h2 className="mb-1 text-center text-lg font-semibold text-white">
          Promote pawn
        </h2>
        <p className="mb-4 text-center text-sm text-gray-400">
          {color === 'w' ? 'White' : 'Black'} reaches the last rank — choose a piece.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {CHOICES.map(({ piece, label, glyph }) => (
            <button
              key={piece}
              type="button"
              onClick={() => completePromotion(piece)}
              className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-[#222838] text-white transition-colors hover:bg-[#2c3449] active:bg-[#39425c]"
            >
              <span className="text-3xl leading-none">{glyph[color]}</span>
              <span className="text-sm">{label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={cancelPromotion}
          className="mt-4 min-h-[44px] w-full rounded-xl border border-white/10 bg-transparent text-sm text-gray-300 hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
