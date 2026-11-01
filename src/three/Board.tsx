import { useEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { Square } from 'chess.js'
import { useGameStore } from '../game/store'
import { squareToXZ } from './coords'
import { ARENA_PLATE_COLOR } from './boardTheme'
import { buildTargetRings, buildTileMesh, setTargetRings, tappedSquare } from './boardMesh'
import { NO_RAYCAST, disposeTree } from './meshUtils'
import { Army } from './pieces/Army'
import { BattleEffects } from './effects/BattleEffects'

/**
 * The board: one InstancedMesh for all 64 tiles (one draw call), one for the
 * legal-move rings, plus the selection ring and the plate. Each full tile is
 * still the tap target: a tap selects the tile instance hit at pointer-down
 * AND pointer-up (the old per-mesh onClick semantics, see `tappedSquare`).
 */
export function Board() {
  const selectedSquare = useGameStore((s) => s.selectedSquare)
  const moveCount = useGameStore((s) => s.moveHistory.length)
  const legalMoves = useGameStore((s) => s.legalMoves)
  const handleTap = useGameStore((s) => s.handleTap)
  const inputLocked = useGameStore((s) => s.inputLocked)

  const tiles = useMemo(() => buildTileMesh(), [])
  const rings = useMemo(() => buildTargetRings(), [])
  useEffect(
    () => () => {
      disposeTree(tiles)
      disposeTree(rings)
    },
    [tiles, rings],
  )

  // Target squares reachable from the current selection. Recomputed when the
  // selection or the position changes: the position lives in the stable
  // chess.js instance behind `legalMoves`, so `moveCount` is the change signal.
  // Deduped because a promoting pawn yields one verbose move per promotion
  // piece, all with the same `.to`.
  const targets = useMemo<Square[]>(
    () => {
      void moveCount
      return selectedSquare ? [...new Set(legalMoves(selectedSquare).map((m) => m.to))] : []
    },
    [selectedSquare, moveCount, legalMoves],
  )

  // While pieces are walking, hide selection/target rings (input is locked too).
  const showHighlights = !inputLocked
  useEffect(() => {
    setTargetRings(rings, showHighlights ? targets : [])
  }, [rings, targets, showHighlights])

  /** Tile instance hit at the last pointer-down on the board. */
  const downInstance = useRef<number | undefined>(undefined)
  const onTileDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    downInstance.current = e.instanceId
  }
  // r3f only fires onClick when the pressed object is hit again at click time;
  // for one InstancedMesh the instance must match too (tappedSquare).
  const onTileClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const square = tappedSquare(downInstance.current, e.instanceId)
    downInstance.current = undefined
    if (square) handleTap(square)
  }

  return (
    <group>
      {/* Sand/stone arena base plate under the tiles. */}
      <mesh raycast={NO_RAYCAST} position={[0, -0.26, 0]} receiveShadow>
        <boxGeometry args={[8.5, 0.3, 8.5]} />
        <meshStandardMaterial color={ARENA_PLATE_COLOR} metalness={0} roughness={0.95} />
      </mesh>

      {/* 8x8 tiles — ONE instanced draw; each full tile is the tap target (>=44px effective). */}
      <primitive object={tiles} onPointerDown={onTileDown} onClick={onTileClick} />

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

      {/* Legal-move target rings (green) — one instanced draw, raycast-disabled. */}
      <primitive object={rings} />

      {/* Persistent piece actors — animate between squares, keyed by actor id. */}
      <Army />

      {/* Additive battle effects (shards + dust) — never part of actor identity. */}
      <BattleEffects />
    </group>
  )
}
