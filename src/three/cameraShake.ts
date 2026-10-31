import type { CameraShakeCue } from '../game/types'

/**
 * Screen-space camera micro-shake offset [right, up] (world units) at
 * `elapsedMs` on the move's sequence clock: the sum of every active cue.
 * Each cue is a short jolt — a decaying oscillation that is exactly 0 outside
 * its window, so the camera always returns to where OrbitControls put it.
 */
export function cameraShakeOffset(
  cues: readonly CameraShakeCue[],
  elapsedMs: number,
): [number, number] {
  let x = 0
  let y = 0
  for (const c of cues) {
    const local = elapsedMs - c.delayMs
    if (local < 0 || local >= c.durationMs || c.durationMs <= 0) continue
    const u = local / c.durationMs
    const envelope = (1 - u) * (1 - u)
    x += c.amplitude * envelope * Math.sin(2 * Math.PI * 3 * u + 0.6)
    y += c.amplitude * 0.6 * envelope * Math.sin(2 * Math.PI * 2.5 * u + 1.9)
  }
  return [x, y]
}
