import { useGameStore } from '../game/store'
import type { GameStatus } from '../game/store'
import type { Color } from 'chess.js'

function armyName(color: Color): string {
  return color === 'w' ? 'White' : 'Black'
}

/** Banner text + accent for terminal / check states. null = no banner. */
function banner(status: GameStatus, turn: Color): { text: string; cls: string } | null {
  switch (status) {
    case 'checkmate':
      // The side to move has been mated — the other side won.
      return {
        text: `Checkmate — ${armyName(turn === 'w' ? 'b' : 'w')} wins`,
        cls: 'bg-red-600/90',
      }
    case 'stalemate':
      return { text: 'Stalemate — draw', cls: 'bg-amber-600/90' }
    case 'draw':
      return { text: 'Draw', cls: 'bg-amber-600/90' }
    case 'check':
      return { text: `${armyName(turn)} is in check`, cls: 'bg-orange-600/90' }
    default:
      return null
  }
}

/** Pair SAN half-moves into numbered full moves for the move list. */
function pairMoves(history: string[]): { n: number; white: string; black: string }[] {
  const rows: { n: number; white: string; black: string }[] = []
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, white: history[i], black: history[i + 1] ?? '' })
  }
  return rows
}

/**
 * Heads-up display: turn indicator, status banner, SAN move list, and the
 * undo / new-game / auto-flip-toggle controls. All buttons are >=44px.
 */
export function HUD() {
  const turn = useGameStore((s) => s.turn)
  const status = useGameStore((s) => s.status)
  const inputLocked = useGameStore((s) => s.inputLocked)
  const moveHistory = useGameStore((s) => s.moveHistory)
  const autoFlip = useGameStore((s) => s.autoFlip)
  const undo = useGameStore((s) => s.undo)
  const newGame = useGameStore((s) => s.newGame)
  const toggleAutoFlip = useGameStore((s) => s.toggleAutoFlip)

  // The status banner (and the game-over pill) wait for the move's animation
  // sequence to finish, so the HUD never announces an outcome before the
  // pieces act it out: the checkmate banner appears after the mated king's
  // fall, the check banner when the king's alarm starts.
  const showOutcome = !inputLocked
  const b = showOutcome ? banner(status, turn) : null
  const rows = pairMoves(moveHistory)
  const gameOver =
    showOutcome && (status === 'checkmate' || status === 'stalemate' || status === 'draw')

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
      {/* Top: turn indicator + status banner. */}
      <div className="flex flex-col items-center gap-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/55 px-4 py-2 backdrop-blur">
          <span
            className="inline-block h-4 w-4 rounded-full border border-white/30"
            style={{ backgroundColor: turn === 'w' ? '#ece0c8' : '#363b45' }}
          />
          <span className="text-sm font-medium text-white">
            {gameOver ? 'Game over' : `${armyName(turn)} to move`}
          </span>
        </div>
        {b && (
          <div
            className={`pointer-events-auto rounded-lg px-4 py-2 text-center text-sm font-semibold text-white shadow-lg ${b.cls}`}
          >
            {b.text}
          </div>
        )}
      </div>

      {/* Bottom: move list + controls. */}
      <div className="flex flex-col gap-2">
        {rows.length > 0 && (
          <div className="pointer-events-auto max-h-28 overflow-y-auto rounded-xl border border-white/10 bg-black/55 px-3 py-2 text-xs text-gray-200 backdrop-blur">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {rows.map((r) => (
                <span key={r.n} className="tabular-nums">
                  <span className="text-gray-500">{r.n}.</span> {r.white}
                  {r.black ? ` ${r.black}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="pointer-events-auto grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={moveHistory.length === 0}
            className="min-h-[48px] rounded-xl border border-white/10 bg-[#222838] text-sm font-medium text-white transition-colors hover:bg-[#2c3449] active:bg-[#39425c] disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={toggleAutoFlip}
            aria-pressed={autoFlip}
            className={`min-h-[48px] rounded-xl border text-sm font-medium transition-colors ${
              autoFlip
                ? 'border-emerald-400/40 bg-emerald-600/25 text-emerald-100'
                : 'border-white/10 bg-[#222838] text-gray-300'
            }`}
          >
            Auto-flip: {autoFlip ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            onClick={newGame}
            className="min-h-[48px] rounded-xl border border-white/10 bg-[#222838] text-sm font-medium text-white transition-colors hover:bg-[#2c3449] active:bg-[#39425c]"
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  )
}
