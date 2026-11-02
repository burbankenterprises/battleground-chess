import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Color } from 'chess.js'
import { useGameStore } from '../game/store'
import type { GameStatus } from '../game/store'
import { capturedFromMoves, materialLead, PIECE_GLYPH, trayGroups, trayLabel } from '../game/captured'
import type { CapturedTrays } from '../game/captured'
import { useSoundSettings } from '../audio/soundSettings'
import { DRAWER_GAP_PX, DRAWER_STRIP_HEIGHT_PX, HUD_BAR_HEIGHT_PX, HUD_EDGE_PAD_PX } from './layout'
import { drawerReducer, drawerVisible, movesToggleAria, movesToggleLabel, pairMoves } from './moveDrawer'

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

/** Swatch colors of the two armies (Israelite linen / Philistine crimson-dark). */
const ARMY_SWATCH: Record<Color, string> = { w: '#ece0c8', b: '#363b45' }
/** Glyph tint of the pieces an army has captured (the VICTIMS' army color). */
const VICTIM_TINT: Record<Color, string> = { w: '#efe7d6', b: '#e0707e' }

const BAR_BUTTON =
  'flex items-center justify-center rounded-xl border px-1 text-center text-[13px] font-medium leading-tight transition-colors disabled:opacity-40 sm:text-sm'
const BAR_NEUTRAL = 'border-white/10 bg-[#222838]/90 text-white hover:bg-[#2c3449] active:bg-[#39425c]'

/** Speaker icon (inline SVG — no assets). */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
      {muted ? (
        <>
          <line x1="16" y1="9" x2="22" y2="15" />
          <line x1="22" y1="9" x2="16" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      )}
    </svg>
  )
}

/**
 * One army's captured tray, shown beside the turn pill: the enemy pieces this
 * army has taken (grouped, most valuable first) plus its material lead.
 * Renders nothing until the army has captured something — no placeholders.
 */
function CapturedTray({ army, trays }: { army: Color; trays: CapturedTrays }) {
  const pieces = trays[army]
  if (pieces.length === 0) return null
  const lead = materialLead(trays)[army]
  const victim: Color = army === 'w' ? 'b' : 'w'
  return (
    <div
      role="img"
      aria-label={trayLabel(armyName(army), pieces)}
      data-testid={`captured-${army}`}
      className="flex max-w-[44vw] items-center gap-1 overflow-hidden rounded-full border border-white/10 bg-black/55 px-2.5 py-1 backdrop-blur"
    >
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white/30"
        style={{ backgroundColor: ARMY_SWATCH[army] }}
      />
      {trayGroups(pieces).map(({ type, count }) => (
        <span key={type} className="flex shrink-0 items-baseline text-base leading-none" style={{ color: VICTIM_TINT[victim] }}>
          {PIECE_GLYPH[type]}
          {count > 1 && <span className="ml-px text-[11px] font-semibold text-gray-300">{count}</span>}
        </span>
      ))}
      {lead > 0 && <span className="ml-0.5 shrink-0 text-xs font-semibold text-emerald-300">+{lead}</span>}
    </div>
  )
}

/**
 * Heads-up display (Phase 5): turn pill + captured trays + status banner at
 * the top; ONE row of controls at the bottom (moves drawer toggle, undo,
 * auto-flip, sound, new game — all ≥ 44px). The move list is a collapsible
 * drawer, closed by default, that opens upward from the bar — the board's
 * near back rank is never covered while it is closed (the scene's lens shift
 * keeps the board above the bar).
 */
export function HUD() {
  const turn = useGameStore((s) => s.turn)
  const status = useGameStore((s) => s.status)
  const inputLocked = useGameStore((s) => s.inputLocked)
  const moveHistory = useGameStore((s) => s.moveHistory)
  const game = useGameStore((s) => s.game)
  const autoFlip = useGameStore((s) => s.autoFlip)
  const undo = useGameStore((s) => s.undo)
  const newGame = useGameStore((s) => s.newGame)
  const toggleAutoFlip = useGameStore((s) => s.toggleAutoFlip)
  const soundOn = useSoundSettings((s) => s.enabled)
  const toggleSound = useSoundSettings((s) => s.toggle)
  const [drawerOpen, dispatchDrawer] = useReducer(drawerReducer, false)

  // The status banner (and the game-over pill) wait for the move's animation
  // sequence to finish, so the HUD never announces an outcome before the
  // pieces act it out: the checkmate banner appears after the mated king's
  // fall, the check banner when the king's alarm starts.
  const showOutcome = !inputLocked
  const b = showOutcome ? banner(status, turn) : null
  const gameOver =
    showOutcome && (status === 'checkmate' || status === 'stalemate' || status === 'draw')

  // Captured trays: chess.js's verbose history (capture flags) — no extra state.
  // `moveHistory` (a fresh array after every mutation) is the change signal
  // for the stable chess.js instance.
  const trays = useMemo(
    () => capturedFromMoves(moveHistory.length > 0 ? game.history({ verbose: true }) : []),
    [game, moveHistory],
  )
  const halfMoves = moveHistory.length
  const rows = useMemo(() => pairMoves(moveHistory), [moveHistory])
  const showDrawer = drawerVisible(drawerOpen, halfMoves)

  // Keep the newest move in view whenever the strip opens or grows.
  const drawerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = drawerRef.current
    if (showDrawer && el) el.scrollLeft = el.scrollWidth
  }, [showDrawer, rows])
  /** The latest half-move is black's when the count is even. */
  const lastIsBlack = halfMoves > 0 && halfMoves % 2 === 0

  /** Confirm-new-game dialog open? (Jon: the button is too easy to hit by accident.) */
  const [confirmingNew, setConfirmingNew] = useState(false)
  const halfMovesAtOpen = useRef(0)

  const askNewGame = () => {
    halfMovesAtOpen.current = halfMoves
    setConfirmingNew(true)
  }
  const onNewGame = () => {
    setConfirmingNew(false)
    dispatchDrawer('close')
    newGame()
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col justify-between"
      style={{
        paddingTop: `max(${HUD_EDGE_PAD_PX}px, env(safe-area-inset-top))`,
        paddingBottom: `max(${HUD_EDGE_PAD_PX}px, env(safe-area-inset-bottom))`,
        paddingLeft: `max(${HUD_EDGE_PAD_PX}px, env(safe-area-inset-left))`,
        paddingRight: `max(${HUD_EDGE_PAD_PX}px, env(safe-area-inset-right))`,
      }}
    >
      {/* Top: turn pill flanked by the captured trays, then the status banner. */}
      <div className="flex flex-col items-center gap-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/55 px-4 py-2 backdrop-blur">
          <span
            className="inline-block h-4 w-4 rounded-full border border-white/30"
            style={{ backgroundColor: ARMY_SWATCH[turn] }}
          />
          <span className="text-sm font-medium text-white">
            {gameOver ? 'Game over' : `${armyName(turn)} to move`}
          </span>
        </div>
        {(trays.w.length > 0 || trays.b.length > 0) && (
          <div className="flex w-full items-start justify-between gap-2">
            <CapturedTray army="w" trays={trays} />
            <span className="flex-1" />
            <CapturedTray army="b" trays={trays} />
          </div>
        )}
        {b && (
          <div
            className={`pointer-events-auto rounded-lg px-4 py-2 text-center text-sm font-semibold text-white shadow-lg ${b.cls}`}
          >
            {b.text}
          </div>
        )}
      </div>

      {/* New Game confirmation — a whole game must never reset on one tap (Jon, Nov 2026). */}
      {confirmingNew && (
        <div
          className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="new-game-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#161a22] p-5 shadow-2xl">
            <h2 id="new-game-title" className="mb-1 text-center text-lg font-semibold text-white">
              Start a new game?
            </h2>
            <p className="mb-5 text-center text-sm text-gray-400">
              {halfMovesAtOpen.current === 0
                ? 'The board is still fresh.'
                : `The current game (${Math.ceil(halfMovesAtOpen.current / 2)} move${
                    halfMovesAtOpen.current > 2 ? 's' : ''
                  }) will be lost.`}
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={onNewGame}
                className="min-h-[52px] rounded-xl bg-red-600 font-semibold text-white transition-colors hover:bg-red-500 active:bg-red-700"
              >
                Yes, new game
              </button>
              <button
                type="button"
                onClick={() => setConfirmingNew(false)}
                className="min-h-[52px] rounded-xl border border-white/10 bg-[#222838] font-semibold text-gray-200 transition-colors hover:bg-[#2c3449]"
              >
                Keep playing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom: the move-list drawer (one scrollable line, opens upward) over one row of controls. */}
      <div className="relative">
        {showDrawer && (
          <div
            ref={drawerRef}
            id="move-list-drawer"
            role="region"
            aria-label="Move list"
            className="drawer-in pointer-events-auto absolute inset-x-0 bottom-full flex items-center overflow-x-auto overscroll-x-contain whitespace-nowrap rounded-lg border border-white/10 bg-black/70 px-3 text-[13px] text-gray-200 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ height: DRAWER_STRIP_HEIGHT_PX, marginBottom: DRAWER_GAP_PX }}
          >
            <ol className="flex items-center gap-3 tabular-nums">
              {rows.map((r, i) => {
                const latest = i === rows.length - 1
                return (
                  <li key={r.n} className="flex items-baseline gap-1.5">
                    <span className="text-gray-500">{r.n}.</span>
                    <span className={latest && !lastIsBlack ? 'font-semibold text-amber-200' : undefined}>{r.white}</span>
                    {r.black !== null && (
                      <span className={latest && lastIsBlack ? 'font-semibold text-amber-200' : undefined}>{r.black}</span>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
        )}

        <div
          className="pointer-events-auto grid grid-cols-[1fr_1fr_1fr_auto_1fr] gap-2"
          style={{ height: HUD_BAR_HEIGHT_PX }}
        >
          <button
            type="button"
            onClick={() => dispatchDrawer('toggle')}
            disabled={halfMoves === 0}
            aria-expanded={showDrawer}
            aria-controls="move-list-drawer"
            aria-label={movesToggleAria(showDrawer, halfMoves)}
            className={`${BAR_BUTTON} gap-1 ${
              showDrawer ? 'border-amber-300/40 bg-amber-500/20 text-amber-100' : BAR_NEUTRAL
            }`}
          >
            <span className="tabular-nums">{movesToggleLabel(halfMoves)}</span>
            <span aria-hidden="true" className="text-xs">{showDrawer ? '▾' : '▴'}</span>
          </button>
          <button type="button" onClick={undo} disabled={halfMoves === 0} className={`${BAR_BUTTON} ${BAR_NEUTRAL}`}>
            Undo
          </button>
          <button
            type="button"
            onClick={toggleAutoFlip}
            aria-pressed={autoFlip}
            className={`${BAR_BUTTON} ${
              autoFlip
                ? 'border-emerald-400/40 bg-emerald-600/25 text-emerald-100'
                : 'border-white/10 bg-[#222838]/90 text-gray-300'
            }`}
          >
            Auto-flip: {autoFlip ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? 'Sound on — tap to mute' : 'Sound off — tap to unmute'}
            title={soundOn ? 'Mute' : 'Unmute'}
            className={`${BAR_BUTTON} w-[52px] ${soundOn ? BAR_NEUTRAL : 'border-white/10 bg-[#222838]/90 text-gray-400'}`}
          >
            <SpeakerIcon muted={!soundOn} />
          </button>
          <button type="button" onClick={askNewGame} className={`${BAR_BUTTON} ${BAR_NEUTRAL}`}>
            New Game
          </button>
        </div>
      </div>
    </div>
  )
}
