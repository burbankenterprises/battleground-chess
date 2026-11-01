import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { buildArena } from './arena'

/**
 * The torchlit desert arena around the board (see arena.ts): built once,
 * animated every frame (torch flicker + dust drift) without allocating, and
 * released on unmount. Every mesh in it is raycast-disabled, so it can never
 * eat a tile tap.
 */
export function Arena() {
  const arena = useMemo(() => buildArena(), [])
  useEffect(() => () => arena.dispose(), [arena])
  useFrame(() => arena.update(performance.now()))
  return <primitive object={arena.root} />
}
