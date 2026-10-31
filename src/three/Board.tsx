import { useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { Square } from 'chess.js'
import { useGameStore } from '../game/store'
import { BOARD_LAYOUT, squareToXZ } from './coords'
import { ARENA_PLATE_COLOR, TILE_COLORS, TILE_DARK, TILE_LIGHT } from './boardTheme'
import { Army } from './pieces/Army'
import { BattleEffects } from './effects/BattleEffects'

const NO_RAYCAST = () => null

export function Board() {
  const selectedSquare = useGameStore((s) => s.selectedSquare)
  const moveCount = useGameStore((s) => s.moveHistory.length)
  const legalMoves = useGameStore((s) => s.legalMoves)
  const handleTap = useGameStore((s) => s.handleTap)
  const inputLocked = useGameStore((s) => s.inputLocked)

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

  // While pieces are walking, hide selection/target rings (input is locked too).
  const showHighlights = !inputLocked

  return (
    <group>
      {/* Sand/stone arena base plate under the tiles. */}
      <mesh raycast={NO_RAYCAST} position={[0, -0.26, 0]}>
        <boxGeometry args={[8.5, 0.3, 8.5]} />
        <meshStandardMaterial color={ARENA_PLATE_COLOR} metalness={0} roughness={0.95} />
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
            color={TILE_COLORS.get(square) ?? (light ? TILE_LIGHT : TILE_DARK)}
            metalness={0}
            roughness={0.92}
          />
        </mesh>
      ))}

      {/* Selected-square highlight (amber ring). */}
      {showHighlights &&
        selectedSquare &&
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
      {showHighlights &&
        targets.map((sq) => {
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

      {/* Persistent piece actors — animate between squares, keyed by actor id. */}
      <Army />

      {/* Additive battle effects (shards + dust) — never part of actor identity. */}
      <BattleEffects />
    </group>
  )
}
