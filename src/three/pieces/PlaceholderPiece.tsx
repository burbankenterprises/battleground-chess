import type { Color, PieceSymbol } from 'chess.js'
import { ARMY_PALETTE } from './palette'

/**
 * Raycast no-op: pieces and highlights are purely visual so taps always pass
 * through to the full board tile beneath them (keeps tap targets = full tile).
 */
const NO_RAYCAST = () => null

/** Per-army placeholder materials — clear light-vs-dark contrast on a dark board. */
const ARMY = ARMY_PALETTE

type PieceProps = { type: PieceSymbol; color: Color }

/**
 * Procedural placeholder piece built from primitives, one clear silhouette per
 * type (spec): pawn=cylinder, rook=box, knight=cone+box, bishop=cone,
 * queen=cylinder+sphere, king=cylinder+cross. Replaced by real models in Phase 4.
 */
export function PlaceholderPiece({ type, color }: PieceProps) {
  const mat = ARMY[color]

  const material = (
    <meshStandardMaterial
      color={mat.color}
      metalness={mat.metalness}
      roughness={mat.roughness}
      emissive={mat.emissive}
      emissiveIntensity={0.25}
    />
  )

  switch (type) {
    case 'p': // pawn — cylinder
      return (
        <mesh raycast={NO_RAYCAST} position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.2, 0.24, 0.44, 16]} />
          {material}
        </mesh>
      )

    case 'r': // rook — box
      return (
        <mesh raycast={NO_RAYCAST} position={[0, 0.31, 0]}>
          <boxGeometry args={[0.42, 0.62, 0.42]} />
          {material}
        </mesh>
      )

    case 'n': // knight — cone + box
      return (
        <group>
          <mesh raycast={NO_RAYCAST} position={[0, 0.18, 0]}>
            <boxGeometry args={[0.42, 0.36, 0.42]} />
            {material}
          </mesh>
          <mesh raycast={NO_RAYCAST} position={[0, 0.54, 0.05]} rotation={[0.38, 0, 0]}>
            <coneGeometry args={[0.22, 0.48, 16]} />
            {material}
          </mesh>
        </group>
      )

    case 'b': // bishop — cone
      return (
        <mesh raycast={NO_RAYCAST} position={[0, 0.38, 0]}>
          <coneGeometry args={[0.24, 0.76, 16]} />
          {material}
        </mesh>
      )

    case 'q': // queen — cylinder + sphere
      return (
        <group>
          <mesh raycast={NO_RAYCAST} position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.24, 0.28, 0.6, 16]} />
            {material}
          </mesh>
          <mesh raycast={NO_RAYCAST} position={[0, 0.72, 0]}>
            <sphereGeometry args={[0.18, 16, 16]} />
            {material}
          </mesh>
        </group>
      )

    case 'k': // king — cylinder + cross
      return (
        <group>
          <mesh raycast={NO_RAYCAST} position={[0, 0.32, 0]}>
            <cylinderGeometry args={[0.25, 0.29, 0.64, 16]} />
            {material}
          </mesh>
          <mesh raycast={NO_RAYCAST} position={[0, 0.88, 0]}>
            <boxGeometry args={[0.08, 0.3, 0.08]} />
            {material}
          </mesh>
          <mesh raycast={NO_RAYCAST} position={[0, 0.85, 0]}>
            <boxGeometry args={[0.24, 0.08, 0.08]} />
            {material}
          </mesh>
        </group>
      )
  }
}
