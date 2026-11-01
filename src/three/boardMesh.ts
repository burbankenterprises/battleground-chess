import type { Square } from 'chess.js'
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
} from 'three'
import { BOARD_LAYOUT, squareToXZ } from './coords'
import { TILE_COLORS, TILE_DARK, TILE_LIGHT } from './boardTheme'
import { NO_RAYCAST, setInstance } from './meshUtils'

/**
 * Instanced board (Phase 5 perf pass): all 64 stone tiles are ONE
 * InstancedMesh — one draw call instead of 64 — with each slab's weathered
 * color as a per-instance color.
 *
 * Tap targeting is unchanged: InstancedMesh raycasts every instance with the
 * same box as the old per-tile meshes and reports the hit's `instanceId`;
 * instance i IS BOARD_LAYOUT[i], so `squareOfInstance` maps a hit straight
 * back to its square. Full tiles stay the tap targets.
 *
 * The legal-move target rings are one InstancedMesh too (count = number of
 * targets), raycast-disabled so they never eat a tile tap.
 */

/** Tile slab footprint / thickness (world units) — identical to the Phase 1–4 tiles. */
export const TILE_SIZE = 0.98
export const TILE_HEIGHT = 0.2
/** Tile center height: the top face sits exactly on y = 0. */
export const TILE_Y = -TILE_HEIGHT / 2
export const TILE_MESH_NAME = 'board-tiles'
export const TARGET_RINGS_NAME = 'board-target-rings'

/** Stone finish (unchanged from Phase 4). */
const TILE_ROUGHNESS = 0.92

/** Target ring shape + color (unchanged from Phase 1–4). */
export const TARGET_RING_INNER = 0.33
export const TARGET_RING_OUTER = 0.44
export const TARGET_RING_COLOR = '#39d98a'
export const TARGET_RING_OPACITY = 0.85
/** Rings float just above the tile tops. */
export const RING_Y = 0.02

/** The color a tile renders with (weathered stone; base stone as a fallback). */
export function tileColorOf(index: number): string {
  const tile = BOARD_LAYOUT[index]
  return TILE_COLORS.get(tile.square) ?? (tile.light ? TILE_LIGHT : TILE_DARK)
}

/** All 64 tiles as one InstancedMesh (instance i ↔ BOARD_LAYOUT[i]). */
export function buildTileMesh(): InstancedMesh {
  const geometry = new BoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE)
  const material = new MeshStandardMaterial({
    color: 0xffffff, // per-instance colors carry the stone
    metalness: 0,
    roughness: TILE_ROUGHNESS,
  })
  const mesh = new InstancedMesh(geometry, material, BOARD_LAYOUT.length)
  mesh.name = TILE_MESH_NAME
  const matrix = new Matrix4()
  const color = new Color()
  BOARD_LAYOUT.forEach((tile, i) => {
    mesh.setMatrixAt(i, matrix.makeTranslation(tile.x, TILE_Y, tile.z))
    mesh.setColorAt(i, color.set(tileColorOf(i)))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingBox()
  mesh.computeBoundingSphere()
  mesh.receiveShadow = true
  return mesh
}

/** Board square of a tile-mesh raycast hit, or null for anything that is not a tile instance. */
export function squareOfInstance(instanceId: number | undefined): Square | null {
  if (instanceId === undefined || !Number.isInteger(instanceId)) return null
  if (instanceId < 0 || instanceId >= BOARD_LAYOUT.length) return null
  return BOARD_LAYOUT[instanceId].square
}

/**
 * The square a tap selects: the tile instance hit at pointer-down must be the
 * one hit at click time — exactly the per-mesh click semantics of the Phase
 * 1–4 tiles (r3f fires an object's onClick only if that object was hit at
 * pointer-down; with one InstancedMesh for all tiles the instance must match
 * too), so a press on one tile released over another is not a tap.
 */
export function tappedSquare(downInstance: number | undefined, clickInstance: number | undefined): Square | null {
  if (downInstance === undefined || downInstance !== clickInstance) return null
  return squareOfInstance(clickInstance)
}

/** Capacity of the target-ring mesh: more than any piece can ever reach (a queen: 27). */
export const MAX_TARGET_RINGS = 64

/** Legal-move target rings: one InstancedMesh, empty until `setTargetRings`. */
export function buildTargetRings(): InstancedMesh {
  const geometry = new RingGeometry(TARGET_RING_INNER, TARGET_RING_OUTER, 32)
  const material = new MeshBasicMaterial({
    color: TARGET_RING_COLOR,
    transparent: true,
    opacity: TARGET_RING_OPACITY,
  })
  const mesh = new InstancedMesh(geometry, material, MAX_TARGET_RINGS)
  mesh.name = TARGET_RINGS_NAME
  mesh.raycast = NO_RAYCAST
  mesh.count = 0
  mesh.visible = false
  // Instances change with every selection and always lie on the board.
  mesh.frustumCulled = false
  return mesh
}

/** Show one ring on each target square (duplicates collapse; at most MAX_TARGET_RINGS). */
export function setTargetRings(mesh: InstancedMesh, squares: readonly Square[]): void {
  const unique = [...new Set(squares)].slice(0, MAX_TARGET_RINGS)
  unique.forEach((square, i) => {
    const [x, z] = squareToXZ(square)
    setInstance(mesh, i, x, RING_Y, z, -Math.PI / 2, 0, 0, 1, 1, 1)
  })
  mesh.count = unique.length
  // No targets → no draw call at all.
  mesh.visible = unique.length > 0
  mesh.instanceMatrix.needsUpdate = true
}
