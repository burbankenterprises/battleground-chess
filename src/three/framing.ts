/**
 * Default-camera framing (Phase 5): where the board lands on screen from the
 * starting camera, and the vertical lens shift that lifts it clear of the
 * bottom HUD bar.
 *
 * The shift is an off-axis projection (PerspectiveCamera.setViewOffset): the
 * camera's position, orientation and OrbitControls / auto-flip behaviour are
 * untouched — the rendered image is simply moved up by a few pixels. Taps
 * stay exact because the raycaster unprojects through the same matrix.
 */

/** Starting camera (Phase 1 framing, unchanged). */
export const DEFAULT_CAMERA_POSITION: readonly [number, number, number] = [0, 8, 8]
export const DEFAULT_CAMERA_FOV = 45

/** Near edge of the closest rank's tile tops (tiles span ±3.99; symmetric for either army's camera). */
export const BOARD_NEAR_EDGE_Z = 3.99

/** Never shift the image by more than this fraction of the viewport height. */
export const MAX_LENS_SHIFT_FRACTION = 0.1

/**
 * Vertical screen position (0 = top, 1 = bottom) of the world point
 * (0, y, z) seen from the default camera looking at the origin. The camera
 * sits in the x = 0 plane, so x does not affect the vertical position.
 */
export function defaultCameraYFraction(y: number, z: number): number {
  const [, cy, cz] = DEFAULT_CAMERA_POSITION
  const len = Math.hypot(cy, cz)
  // View direction f (toward the origin) and camera up u, both in the y-z plane.
  const fy = -cy / len
  const fz = -cz / len
  const uy = -fz
  const uz = fy
  const dy = y - cy
  const dz = z - cz
  const depth = dy * fy + dz * fz
  const up = dy * uy + dz * uz
  const ndc = up / (depth * Math.tan((DEFAULT_CAMERA_FOV * Math.PI) / 360))
  return (1 - ndc) / 2
}

/**
 * Pixels to lift the rendered image so the board's near edge (from the
 * default camera) clears a bottom HUD reserve of `bottomReservePx` by
 * `clearancePx`. 0 when it already clears; capped at MAX_LENS_SHIFT_FRACTION.
 */
export function lensShiftPx(viewportHeight: number, bottomReservePx: number, clearancePx: number): number {
  if (!(viewportHeight > 0)) return 0
  const nearEdgePx = defaultCameraYFraction(0, BOARD_NEAR_EDGE_Z) * viewportHeight
  const needed = nearEdgePx - (viewportHeight - bottomReservePx - clearancePx)
  return Math.round(Math.min(Math.max(0, needed), viewportHeight * MAX_LENS_SHIFT_FRACTION))
}
