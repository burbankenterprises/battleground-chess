import { useEffect, useRef } from 'react'
import type { ComponentRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useGameStore } from '../game/store'

/** Azimuth the camera settles at for each side (180deg apart). */
const WHITE_AZIMUTH = 0
const BLACK_AZIMUTH = Math.PI
/** Flip duration (spec: ~800ms). */
const FLIP_MS = 800

type Controls = ComponentRef<typeof OrbitControls>

/** Cubic ease-in-out. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Normalize `to` to the equivalent angle within +/-PI of `from` (shortest path). */
function nearestAngle(from: number, to: number): number {
  let target = to
  while (target - from > Math.PI) target -= 2 * Math.PI
  while (target - from < -Math.PI) target += 2 * Math.PI
  return target
}

/**
 * Pass-and-play camera: on each turn change (when auto-flip is on) the camera
 * azimuth animates 180deg over ~800ms so the board faces the active player.
 * OrbitControls: no pan, zoom clamped, touch-friendly.
 */
export function CameraRig() {
  const controlsRef = useRef<Controls>(null)
  const turn = useGameStore((s) => s.turn)
  const autoFlip = useGameStore((s) => s.autoFlip)

  const anim = useRef({ from: 0, to: 0, start: 0, active: false })

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls || !autoFlip) return
    const desired = turn === 'w' ? WHITE_AZIMUTH : BLACK_AZIMUTH
    const from = controls.getAzimuthalAngle()
    const to = nearestAngle(from, desired)
    // Already essentially there — no animation needed.
    if (Math.abs(to - from) < 1e-3) return
    anim.current = { from, to, start: performance.now(), active: true }
  }, [turn, autoFlip])

  useFrame(() => {
    const controls = controlsRef.current
    const a = anim.current
    if (!controls || !a.active) return
    const t = Math.min((performance.now() - a.start) / FLIP_MS, 1)
    const az = a.from + (a.to - a.from) * easeInOut(t)
    controls.setAzimuthalAngle(az)
    controls.update()
    if (t >= 1) a.active = false
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      minDistance={6}
      maxDistance={16}
      minPolarAngle={0.2}
      maxPolarAngle={Math.PI / 2 - 0.05}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
    />
  )
}
