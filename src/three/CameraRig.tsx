import { useEffect, useRef } from 'react'
import type { ComponentRef } from 'react'
import { addAfterEffect, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Vector3 } from 'three'
import type { Camera } from 'three'
import { useGameStore } from '../game/store'
import { cameraShakeOffset } from './cameraShake'

/** Azimuth the camera settles at for each side (180deg apart). */
const WHITE_AZIMUTH = 0
const BLACK_AZIMUTH = Math.PI
/** Flip duration (spec: ~800ms). */
const FLIP_MS = 800
/**
 * After a move's sequence settles (input unlocks), hold this long before
 * flipping — the death animation + shards read fully before the camera turns.
 */
export const FLIP_HOLD_AFTER_SETTLE_MS = 450

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
 *
 * Capture impacts add a camera micro-shake (cues from the director, on the
 * move's sequence clock). The shake is purely ADDITIVE: it offsets the camera
 * along its own right/up axes after OrbitControls and the flip have placed it
 * for the frame, and the exact offset is removed again right after that frame
 * renders (R3F after-effect). OrbitControls re-derives its orbit from
 * camera.position on every update and inside its pointer handlers, so it only
 * ever sees the clean position — the shake can't drift, fight user orbiting,
 * or disturb the auto-flip.
 */
export function CameraRig() {
  const controlsRef = useRef<Controls>(null)
  const turn = useGameStore((s) => s.turn)
  const autoFlip = useGameStore((s) => s.autoFlip)
  const cameraShakes = useGameStore((s) => s.cameraShakes)
  const animStartedAt = useGameStore((s) => s.animStartedAt)
  const inputLocked = useGameStore((s) => s.inputLocked)
  const animSeq = useGameStore((s) => s.animSeq)

  const anim = useRef({ from: 0, to: 0, start: 0, active: false })

  // Shake offset currently applied to `shakeCamera` (removed after render).
  const shakeApplied = useRef(new Vector3())
  const shakeCamera = useRef<Camera | null>(null)
  const right = useRef(new Vector3())
  const up = useRef(new Vector3())

  useEffect(() => {
    const removeShake = () => {
      const cam = shakeCamera.current
      if (!cam) return
      cam.position.sub(shakeApplied.current)
      cam.updateMatrixWorld()
      shakeApplied.current.set(0, 0, 0)
      shakeCamera.current = null
    }
    const unsubscribe = addAfterEffect(removeShake)
    return () => {
      unsubscribe()
      removeShake()
    }
  }, [])

  // The flip waits for the battle sequence to finish (input unlocks) plus a
  // short hold, so captures play out fully in front of the player who made
  // the move — the camera never rotates away mid-fight (Jon, Nov 2026).
  useEffect(() => {
    if (!autoFlip || inputLocked) return
    const controls = controlsRef.current
    if (!controls) return
    const desired = turn === 'w' ? WHITE_AZIMUTH : BLACK_AZIMUTH
    const timer = setTimeout(() => {
      const c = controlsRef.current
      if (!c) return
      const from = c.getAzimuthalAngle()
      const to = nearestAngle(from, desired)
      if (Math.abs(to - from) < 1e-3) return
      anim.current = { from, to, start: performance.now(), active: true }
    }, FLIP_HOLD_AFTER_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [turn, autoFlip, inputLocked, animSeq])

  // Auto-flip switched off mid-sequence: cancel any pending flip.
  useEffect(() => {
    if (autoFlip) return
    anim.current.active = false
  }, [autoFlip])

  useFrame((state) => {
    // 1) Auto-flip (unchanged from Phase 1).
    const controls = controlsRef.current
    const a = anim.current
    if (controls && a.active) {
      const t = Math.min((performance.now() - a.start) / FLIP_MS, 1)
      const az = a.from + (a.to - a.from) * easeInOut(t)
      controls.setAzimuthalAngle(az)
      controls.update()
      if (t >= 1) a.active = false
    }

    // 2) Additive micro-shake on top of wherever the camera now is.
    if (cameraShakes.length === 0) return
    const [sx, sy] = cameraShakeOffset(cameraShakes, performance.now() - animStartedAt)
    if (sx === 0 && sy === 0) return
    const cam = state.camera
    right.current.set(1, 0, 0).applyQuaternion(cam.quaternion)
    up.current.set(0, 1, 0).applyQuaternion(cam.quaternion)
    const offset = shakeApplied.current
    offset.copy(right.current).multiplyScalar(sx).addScaledVector(up.current, sy)
    cam.position.add(offset)
    shakeCamera.current = cam
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
