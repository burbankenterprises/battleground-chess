import { useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { Square } from 'chess.js'
import { useGameStore } from '../game/store'
import { BOARD_LAYOUT, squareToXZ } from './coords'
import { PlaceholderPiece } from './pieces/PlaceholderPiece'

const NO_RAYCAST = () => null

/** Tile surface colors (dark theme, readable contrast with both armies). */
const TILE_LIGHT = '#9aa0ab'
const TILE_DARK = '#5b616c'

export function Board() {
  const boardSnapshot = useGameStore((s) => s.boardSnapshot)
  const selectedSquare = useGameStore((s) => s.selectedSquare)
  const moveCount = useGameStore((s) => s.moveHistory.length)
  const legalMoves = useGameStore((s) => s.legalMoves)
  const handleTap = useGameStore((s) => s.handleTap)

  // Target squares reachable from the current selection. Recomputed when the
  // selection or the position (move count) changes. Deduped because a promoting
  // pawn yields one verbose move per promotion piece, all with the same `.to`.
  const targets = useMemo<Square[]>(
    () =>
      selectedSquare
        ? [...new Set(legalMoves(selectedSquare).map((m) => m.to))]
        : [],
    [selectedSquare, moveCount, legalMoves],
  )

  const onTileClick = (square: Square) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    handleTap(square)
  }

  return (
    <group>
      {/* Base plate under the tiles. */}
      <mesh raycast={NO_RAYCAST} position={[0, -0.26, 0]}>
        <boxGeometry args={[8.5, 0.3, 8.5]} />
        <meshStandardMaterial color="#23262c" metalness={0.2} roughness={0.8} />
      </mesh>

      {/* 8x8 tiles — each full tile is the tap target (>=44px effective). */}
      {BOARD_LAYOUT.map(({ square, x, z, light }) => (
        <mesh
          key={square}
          position={[x, -0.1, z]}
          onClick={onTileClick(square)}
        >
          <boxGeometry args={[0.98, 0.2, 0.98]} />
          <meshStandardMaterial
            color={light ? TILE_LIGHT : TILE_DARK}
            metalness={0.05}
            roughness={0.9}
          />
        </mesh>
      ))}

      {/* Selected-square highlight (amber ring). */}
      {selectedSquare &&
        (() => {
          const [x, z] = squareToXZ(selectedSquare)
          return (
            <mesh raycast={NO_RAYCAST} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.3, 0.47, 32]} />
              <meshBasicMaterial color="#f5b301" transparent opacity={0.9} />
            </mesh>
          )
        })()}

      {/* Legal-move target rings (green). */}
      {targets.map((sq) => {
        const [x, z] = squareToXZ(sq)
        return (
          <mesh
            key={`t-${sq}`}
            raycast={NO_RAYCAST}
            position={[x, 0.02, z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.33, 0.44, 32]} />
            <meshBasicMaterial color="#39d98a" transparent opacity={0.85} />
          </mesh>
        )
      })}

      {/* Pieces. */}
      {boardSnapshot.map((p) => {
        const [x, z] = squareToXZ(p.square)
        return (
          <group key={p.square} position={[x, 0, z]}>
            <PlaceholderPiece type={p.type} color={p.color} />
          </group>
        )
      })}
    </group>
  )
}
