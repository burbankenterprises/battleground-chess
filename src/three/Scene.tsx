import { Canvas } from '@react-three/fiber'
import { Board } from './Board'
import { CameraRig } from './CameraRig'

/**
 * 3D scene: Canvas, lights and a dark environment (no network HDR — lighting is
 * done with hemisphere + directional lights so the app stays fully offline).
 */
export function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 8, 8], fov: 45, near: 0.1, far: 100 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#0b0d12']} />
      <hemisphereLight intensity={0.55} color="#aab4cc" groundColor="#15171d" />
      <ambientLight intensity={0.25} />
      <directionalLight position={[6, 12, 6]} intensity={1.15} />
      <directionalLight position={[-6, 8, -4]} intensity={0.45} color="#9fb4e0" />
      <Board />
      <CameraRig />
    </Canvas>
  )
}
