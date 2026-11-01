/**
 * Move-list drawer (Phase 5): pure helpers behind the HUD's collapsible move
 * list. The drawer is closed by default so it never covers the board; the
 * toggle in the bottom bar always shows the real move count.
 */

export type MoveRow = {
  /** Full-move number (1-based). */
  n: number
  white: string
  /** Black's reply, or null while it is still to come (rendered as nothing). */
  black: string | null
}

/** Pair SAN half-moves into numbered full moves. */
export function pairMoves(history: readonly string[]): MoveRow[] {
  const rows: MoveRow[] = []
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, white: history[i], black: history[i + 1] ?? null })
  }
  return rows
}

export type DrawerAction = 'toggle' | 'close'

/** Drawer open/closed state transitions. */
export function drawerReducer(open: boolean, action: DrawerAction): boolean {
  return action === 'toggle' ? !open : false
}

/** The drawer renders only when open AND there is at least one move to list. */
export function drawerVisible(open: boolean, halfMoves: number): boolean {
  return open && halfMoves > 0
}

/** Toggle button caption: the real half-move count, never a placeholder. */
export function movesToggleLabel(halfMoves: number): string {
  return halfMoves === 1 ? '1 move' : `${halfMoves} moves`
}

/** Accessible name of the toggle. */
export function movesToggleAria(open: boolean, halfMoves: number): string {
  return `${open ? 'Hide' : 'Show'} move list (${movesToggleLabel(halfMoves)})`
}
