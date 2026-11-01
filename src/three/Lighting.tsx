import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { DirectionalLight } from 'three'
import { useGameStore } from '../game/store'
import { AMBIENT_LIGHT, HEMISPHERE_LIGHT, KEY_LIGHT, RIM_LIGHT } from './lighting'
import { configureKeyShadow, sceneAnimating, shadowFrameNeeded } from './shadows'

/**
 * Scene lights + the shadow-map scheduler. The key "evening sun" is the only
 * shadow-casting light; the shadow map is re-rendered only while pieces can
 * be moving (a move sequence, the check alarm, the mate fall) and briefly
 * after every batch starts — an idle board costs no shadow pass at all.
 */
export function Lighting() {
  const keyRef = useRef<DirectionalLight>(null)
  const getState = useThree((s) => s.get)
  /** Batch id the scheduler last saw (a new batch always refreshes the shadows). */
  const lastSeq = useRef(-1)
  /** performance.now() when the scene last went idle (null while animating). */
  const idleSince = useRef<number | null>(null)

  useLayoutEffect(() => {
    const key = keyRef.current
    if (key) configureKeyShadow(key)
    const shadowMap = getState().gl.shadowMap
    shadowMap.autoUpdate = false
    shadowMap.needsUpdate = true
    return () => {
      shadowMap.autoUpdate = true
    }
  }, [getState])

  useFrame((state) => {
    const s = useGameStore.getState()
    const now = performance.now()
    let animating = sceneAnimating(s.inputLocked, s.animCommands, s.animStartedAt, now)
    if (s.animSeq !== lastSeq.current) {
      // Mounts / unmounts / repositioning (undo, new game) arrive with a new batch.
      lastSeq.current = s.animSeq
      animating = true
    }
    if (animating) idleSince.current = null
    else if (idleSince.current === null) idleSince.current = now
    const idleMs = idleSince.current === null ? 0 : now - idleSince.current
    if (shadowFrameNeeded(animating, idleMs)) state.gl.shadowMap.needsUpdate = true
  })

  return (
    <>
      <hemisphereLight
        args={[HEMISPHERE_LIGHT.color, HEMISPHERE_LIGHT.groundColor, HEMISPHERE_LIGHT.intensity]}
      />
      <ambientLight args={[AMBIENT_LIGHT.color, AMBIENT_LIGHT.intensity]} />
      <directionalLight
        ref={keyRef}
        args={[KEY_LIGHT.color, KEY_LIGHT.intensity]}
        position={[...KEY_LIGHT.position]}
      />
      <directionalLight args={[RIM_LIGHT.color, RIM_LIGHT.intensity]} position={[...RIM_LIGHT.position]} />
    </>
  )
}
