import type { DirectionalLight } from 'three'
import { isLoopingCommand } from '../anim/director'
import type { AnimCommand } from '../game/types'

/**
 * Shadow setup (Phase 5 perf pass): ONE shadow-casting light — the warm key
 * "sun" — with a tight orthographic shadow camera around the board.
 *
 * Casters: the merged piece bodies (one draw call per piece, see
 * pieces/mergedModel.ts) and the merged torch stands. Receivers: the board
 * tiles, the board plate and the sand. Nothing else casts or receives.
 *
 * The shadow map is re-rendered only while something that casts is moving
 * (`shadowFrameNeeded`): an idle board — most of a chess game — costs no
 * shadow pass at all.
 */

/**
 * Shadow map resolution: 1024² over the shadow camera's 15 × 15-unit window is
 * ~0.015 units per texel — crisp at board scale, cheap on mid-range phones.
 */
export const SHADOW_MAP_SIZE = 1024

/**
 * Half-extent (world units) of the key light's orthographic shadow camera.
 * The board plate spans ±4.25 and the corner torches stand at ±4.85; the
 * margin keeps their shadows (and the edge pieces' shadows) inside the map.
 */
export const SHADOW_HALF_EXTENT = 7.5

/** Near/far planes of the shadow camera along the light ray (the light sits ~13 units out). */
export const SHADOW_NEAR = 2
export const SHADOW_FAR = 30

/** PCF filter radius in texels: soft, slightly blurred edges (three's Vogel-disk PCF). */
export const SHADOW_RADIUS = 4

/** Depth / normal bias: no acne on the flat tiles, no peter-panning at piece bases. */
export const SHADOW_BIAS = -0.0005
export const SHADOW_NORMAL_BIAS = 0.02

/** Shadow strength (0..1): the evening sun's shadows read clearly but never go black. */
export const SHADOW_INTENSITY = 0.8

/** Key light ("evening sun") placement: warm, from the white-right side, ~50° up. */
export const KEY_LIGHT_POSITION: [number, number, number] = [5.5, 10, 6.5]

/**
 * Configure a directional light as the scene's single shadow caster. Pure
 * mutation of the light (no React), so the contract is unit-tested.
 */
export function configureKeyShadow(light: DirectionalLight): void {
  light.castShadow = true
  const shadow = light.shadow
  shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  shadow.radius = SHADOW_RADIUS
  shadow.bias = SHADOW_BIAS
  shadow.normalBias = SHADOW_NORMAL_BIAS
  shadow.intensity = SHADOW_INTENSITY
  const cam = shadow.camera
  cam.left = -SHADOW_HALF_EXTENT
  cam.right = SHADOW_HALF_EXTENT
  cam.top = SHADOW_HALF_EXTENT
  cam.bottom = -SHADOW_HALF_EXTENT
  cam.near = SHADOW_NEAR
  cam.far = SHADOW_FAR
  cam.updateProjectionMatrix()
  // Re-allocate the map if one was already created with other settings.
  shadow.map?.dispose()
  shadow.map = null
  shadow.needsUpdate = true
}

/**
 * After the scene goes idle, keep re-rendering the shadow map this long (ms):
 * captures the final resting pose, mounts/unmounts, and the check alarm's
 * fade-out (ALARM_RAMP_MS = 160) after its command is cleared.
 */
export const SHADOW_SETTLE_MS = 300

/**
 * Whether anything that casts a shadow may be moving at `now`: while input is
 * locked (a move sequence is playing), while a looping alarm is active, or
 * while any retained one-shot command (the mated king's fall) is still inside
 * its window on the batch clock. Index loop: runs every frame, allocates nothing.
 */
export function sceneAnimating(
  inputLocked: boolean,
  commands: readonly AnimCommand[],
  startedAt: number,
  now: number,
): boolean {
  if (inputLocked) return true
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i]
    if (isLoopingCommand(c)) return true
    if (now < startedAt + c.delayMs + c.durationMs) return true
  }
  return false
}

/**
 * Whether the shadow map must be re-rendered this frame: while the scene is
 * animating, and for SHADOW_SETTLE_MS after it went idle (`idleMs`).
 */
export function shadowFrameNeeded(animating: boolean, idleMs: number): boolean {
  return animating || idleMs < SHADOW_SETTLE_MS
}
