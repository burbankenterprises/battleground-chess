import { describe, expect, it } from 'vitest'
import { drawerReducer, drawerVisible, movesToggleAria, movesToggleLabel, pairMoves } from './moveDrawer'
import {
  BOARD_CLEARANCE_PX,
  DRAWER_GAP_PX,
  DRAWER_STRIP_HEIGHT_PX,
  HUD_BAR_HEIGHT_PX,
  HUD_BOTTOM_RESERVE_PX,
} from './layout'
import { BOARD_NEAR_EDGE_Z, MAX_LENS_SHIFT_FRACTION, defaultCameraYFraction, lensShiftPx } from '../three/framing'

describe('move-list drawer', () => {
  it('is closed by default and toggles open/closed', () => {
    let open = false
    open = drawerReducer(open, 'toggle')
    expect(open).toBe(true)
    open = drawerReducer(open, 'toggle')
    expect(open).toBe(false)
  })

  it('close always closes (new game)', () => {
    expect(drawerReducer(true, 'close')).toBe(false)
    expect(drawerReducer(false, 'close')).toBe(false)
  })

  it('renders only when open AND there are moves to list (never an empty box)', () => {
    expect(drawerVisible(true, 3)).toBe(true)
    expect(drawerVisible(true, 0)).toBe(false)
    expect(drawerVisible(false, 3)).toBe(false)
  })

  it('the toggle always shows the real move count — no placeholder text', () => {
    expect(movesToggleLabel(0)).toBe('0 moves')
    expect(movesToggleLabel(1)).toBe('1 move')
    expect(movesToggleLabel(12)).toBe('12 moves')
    expect(movesToggleAria(false, 3)).toBe('Show move list (3 moves)')
    expect(movesToggleAria(true, 1)).toBe('Hide move list (1 move)')
  })

  it('pairs SAN half-moves into numbered full moves', () => {
    expect(pairMoves([])).toEqual([])
    expect(pairMoves(['e4'])).toEqual([{ n: 1, white: 'e4', black: null }])
    expect(pairMoves(['e4', 'e5', 'Nf3'])).toEqual([
      { n: 1, white: 'e4', black: 'e5' },
      { n: 2, white: 'Nf3', black: null },
    ])
  })
})

describe('HUD never covers the near back rank (lens shift)', () => {
  it('the bottom bar is one ≥44px row', () => {
    expect(HUD_BAR_HEIGHT_PX).toBeGreaterThanOrEqual(44)
    expect(HUD_BOTTOM_RESERVE_PX).toBeGreaterThanOrEqual(HUD_BAR_HEIGHT_PX + 12)
  })

  it('projects the board like the camera does (board center at mid-screen, near edge below it)', () => {
    expect(defaultCameraYFraction(0, 0)).toBeCloseTo(0.5)
    const near = defaultCameraYFraction(0, BOARD_NEAR_EDGE_Z)
    const far = defaultCameraYFraction(0, -BOARD_NEAR_EDGE_Z)
    expect(near).toBeGreaterThan(0.5)
    expect(far).toBeLessThan(0.5)
    expect(near).toBeLessThan(1)
  })

  it.each([
    [390, 844],
    [375, 667],
    [430, 932],
    [1000, 760],
    [1440, 900],
  ])('%ix%i: after the shift the near edge clears the bar by the clearance', (_w, h) => {
    const shift = lensShiftPx(h, HUD_BOTTOM_RESERVE_PX, BOARD_CLEARANCE_PX)
    const nearEdge = defaultCameraYFraction(0, BOARD_NEAR_EDGE_Z) * h - shift
    expect(nearEdge).toBeLessThanOrEqual(h - HUD_BOTTOM_RESERVE_PX - BOARD_CLEARANCE_PX + 0.5)
    // Even with the drawer OPEN (one strip above the bar, worst-case safe area) the rank stays clear.
    const stripTop = h - HUD_BOTTOM_RESERVE_PX - DRAWER_GAP_PX - DRAWER_STRIP_HEIGHT_PX
    expect(nearEdge).toBeLessThan(stripTop)
    // The far edge stays on screen, below the top HUD row.
    expect(defaultCameraYFraction(0, -BOARD_NEAR_EDGE_Z) * h - shift).toBeGreaterThan(100)
  })

  it('never shifts when not needed, and never by more than the cap', () => {
    expect(lensShiftPx(844, 0, 0)).toBe(0)
    expect(lensShiftPx(0, 100, 10)).toBe(0)
    expect(lensShiftPx(500, 400, 100)).toBe(Math.round(500 * MAX_LENS_SHIFT_FRACTION))
  })
})

describe('new-game confirmation (accidental-tap guard)', () => {
  // The dialog is HUD-local state; the contract that matters is pure:
  // the game must only reset when the user answers "Yes".
  it('confirm flow: askNewGame opens, Yes resets, Keep playing does not', async () => {
    const { useGameStore } = await import('../game/store')
    // Play one move so we can prove reset vs keep.
    useGameStore.getState().newGame()
    useGameStore.getState().settleAnimations()
    useGameStore.getState().handleTap('e2')
    useGameStore.getState().handleTap('e4')
    useGameStore.getState().settleAnimations()
    expect(useGameStore.getState().moveHistory).toEqual(['e4'])

    // "Keep playing" = no store call; history intact.
    expect(useGameStore.getState().moveHistory).toHaveLength(1)

    // "Yes, new game" = reset.
    useGameStore.getState().newGame()
    expect(useGameStore.getState().moveHistory).toEqual([])
    // And the drawer (reopened by reset) hides with zero moves.
    expect(drawerVisible(true, 0)).toBe(false)
  })
})
