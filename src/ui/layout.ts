/**
 * HUD layout constants shared by the DOM HUD and the 3D framing (Phase 5).
 * The bottom control bar is a single row, so the board's near back rank is
 * never covered on a phone (the scene lifts the board above this reserve —
 * see three/framing.ts).
 */

/** Height of the bottom control bar's buttons (≥ 44px touch targets). */
export const HUD_BAR_HEIGHT_PX = 52
/** Padding between the HUD and the screen edges. */
export const HUD_EDGE_PAD_PX = 12
/** Worst-case bottom safe-area inset (iPhone home indicator) the bar may sit above. */
export const SAFE_AREA_BOTTOM_MAX_PX = 34
/** Screen height the bottom bar can occupy, worst case. */
export const HUD_BOTTOM_RESERVE_PX = HUD_BAR_HEIGHT_PX + Math.max(HUD_EDGE_PAD_PX, SAFE_AREA_BOTTOM_MAX_PX)
/**
 * The move-list drawer opens as ONE compact horizontally-scrolling line just
 * above the bar — it fits inside the clearance band, so even open it does not
 * cover the near back rank (hud.test.ts checks this per viewport).
 */
export const DRAWER_STRIP_HEIGHT_PX = 30
/** Gap between the drawer strip and the bar. */
export const DRAWER_GAP_PX = 4
/**
 * Minimum clear band between the board's near edge and the top of the bottom
 * bar: room for the open drawer strip plus a small margin, so neither the bar
 * nor the open move list ever covers the near back rank.
 */
export const BOARD_CLEARANCE_PX = DRAWER_STRIP_HEIGHT_PX + DRAWER_GAP_PX + 8
