import { Canvas } from '@react-three/fiber'
import { PCFShadowMap } from 'three'
import { Board } from './Board'
import { CameraRig } from './CameraRig'
import { Lighting } from './Lighting'
import { LensShift } from './LensShift'
import { Arena } from './environment/Arena'
import { FOG_FAR, FOG_NEAR, SCENE_BACKGROUND } from './environment/arenaLayout'
import { DEFAULT_CAMERA_FOV, DEFAULT_CAMERA_POSITION } from './framing'

/**
 * 3D scene (Phase 5): a torchlit evening battlefield. The board sits sunk
 * into a desert arena (sand, distant hills, rocks, four corner torches, dust
 * motes — environment/arena.ts) under a warm low key light — the single
 * shadow caster — a cool rim light and a dusky hemisphere fill (lighting.ts).
 * Everything is procedural: no HDRs, textures or other assets. The dark
 * background stays; distance fog melts the far sand and hills into it.
 *
 * Shadows: PCF (three r187 removed PCFSoftShadowMap; PCF with a radius gives
 * the soft edge), rendered on demand by <Lighting>.
 */
export function Scene() {
  return (
    <Canvas
      camera={{ position: [...DEFAULT_CAMERA_POSITION], fov: DEFAULT_CAMERA_FOV, near: 0.1, far: 150 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      shadows={{ type: PCFShadowMap }}
    >
      <color attach="background" args={[SCENE_BACKGROUND]} />
      <fog attach="fog" args={[SCENE_BACKGROUND, FOG_NEAR, FOG_FAR]} />
      <Lighting />
      <Arena />
      <Board />
      <CameraRig />
      <LensShift />
    </Canvas>
  )
}
