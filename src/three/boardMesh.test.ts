import { describe, expect, it } from 'vitest'
import { Color, InstancedMesh, Matrix4, Mesh, Raycaster, Vector2, Vector3, PerspectiveCamera } from 'three'
import type { Square } from 'chess.js'
import { BOARD_LAYOUT, squareToXZ } from './coords'
import { TILE_COLORS } from './boardTheme'
import {
  MAX_TARGET_RINGS,
  TILE_HEIGHT,
  TILE_SIZE,
  buildTargetRings,
  buildTileMesh,
  setTargetRings,
  squareOfInstance,
  tappedSquare,
  tileColorOf,
} from './boardMesh'
import { countDrawCalls } from './meshUtils'
import { DEFAULT_CAMERA_FOV, DEFAULT_CAMERA_POSITION } from './framing'

describe('instanced board tiles', () => {
  it('all 64 tiles are ONE InstancedMesh — one draw call', () => {
    const tiles = buildTileMesh()
    expect(tiles).toBeInstanceOf(InstancedMesh)
    expect(tiles.count).toBe(64)
    expect(BOARD_LAYOUT).toHaveLength(64)
    expect(countDrawCalls(tiles)).toBe(1)
    expect(tiles.receiveShadow).toBe(true)
    expect(tiles.castShadow).toBe(false)
  })

  it('instance i sits on BOARD_LAYOUT[i] with that square’s weathered stone color', () => {
    const tiles = buildTileMesh()
    const m = new Matrix4()
    const p = new Vector3()
    const c = new Color()
    BOARD_LAYOUT.forEach((tile, i) => {
      tiles.getMatrixAt(i, m)
      p.setFromMatrixPosition(m)
      expect(p.x).toBeCloseTo(tile.x)
      expect(p.z).toBeCloseTo(tile.z)
      expect(p.y + TILE_HEIGHT / 2).toBeCloseTo(0) // tile tops at y = 0, as before
      tiles.getColorAt(i, c)
      expect(c.getHex()).toBe(new Color(TILE_COLORS.get(tile.square)).getHex())
      expect(tileColorOf(i)).toBe(TILE_COLORS.get(tile.square))
    })
  })

  it('instance ids map back to squares; anything else is not a tile', () => {
    BOARD_LAYOUT.forEach((tile, i) => expect(squareOfInstance(i)).toBe(tile.square))
    expect(squareOfInstance(undefined)).toBeNull()
    expect(squareOfInstance(-1)).toBeNull()
    expect(squareOfInstance(64)).toBeNull()
    expect(squareOfInstance(1.5)).toBeNull()
  })

  it('a tap needs the same tile instance at press and click (the old per-tile onClick)', () => {
    expect(tappedSquare(12, 12)).toBe(BOARD_LAYOUT[12].square)
    expect(tappedSquare(12, 13)).toBeNull()
    expect(tappedSquare(undefined, 12)).toBeNull()
    expect(tappedSquare(undefined, undefined)).toBeNull()
  })

  it('raycasting hits the FULL tile: center, near the edges and corners all resolve to that square', () => {
    const tiles = buildTileMesh()
    tiles.updateMatrixWorld(true)
    const raycaster = new Raycaster()
    const down = new Vector3(0, -1, 0)
    const reach = (TILE_SIZE / 2) * 0.95
    for (const tile of BOARD_LAYOUT) {
      for (const [dx, dz] of [
        [0, 0],
        [reach, 0],
        [-reach, 0],
        [0, reach],
        [reach, -reach],
        [-reach, reach],
      ]) {
        raycaster.set(new Vector3(tile.x + dx, 5, tile.z + dz), down)
        const hit = raycaster.intersectObject(tiles)[0]
        expect(squareOfInstance(hit?.instanceId)).toBe(tile.square)
      }
    }
  })

  it('a tap through the default camera lands on the intended square (center of every tile)', () => {
    const tiles = buildTileMesh()
    tiles.updateMatrixWorld(true)
    const camera = new PerspectiveCamera(DEFAULT_CAMERA_FOV, 390 / 844, 0.1, 150)
    camera.position.set(...DEFAULT_CAMERA_POSITION)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    // Lens shift as applied on a phone (LensShift.tsx): taps must still be exact.
    camera.setViewOffset(390, 844, 0, 19, 390, 844)
    const raycaster = new Raycaster()
    for (const tile of BOARD_LAYOUT) {
      const ndc = new Vector3(tile.x, 0, tile.z).project(camera)
      raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera)
      const hit = raycaster.intersectObject(tiles)[0]
      expect(squareOfInstance(hit?.instanceId)).toBe(tile.square)
    }
  })
})

describe('legal-move target rings', () => {
  it('one InstancedMesh, raycast-inert, hidden (no draw call) while empty', () => {
    const rings = buildTargetRings()
    expect(rings).toBeInstanceOf(InstancedMesh)
    expect(rings.count).toBe(0)
    expect(countDrawCalls(rings)).toBe(0)
    rings.updateMatrixWorld(true)
    const raycaster = new Raycaster(new Vector3(0.5, 5, 0.5), new Vector3(0, -1, 0))
    setTargetRings(rings, ['e4', 'd4'])
    rings.updateMatrixWorld(true)
    expect(raycaster.intersectObject(rings)).toEqual([])
  })

  it('places one ring per unique target, on that square', () => {
    const rings = buildTargetRings()
    const squares: Square[] = ['e3', 'e4', 'e4']
    setTargetRings(rings, squares)
    expect(rings.count).toBe(2)
    expect(rings.visible).toBe(true)
    expect(countDrawCalls(rings)).toBe(1)
    const m = new Matrix4()
    const p = new Vector3()
    ;(['e3', 'e4'] as Square[]).forEach((sq, i) => {
      rings.getMatrixAt(i, m)
      p.setFromMatrixPosition(m)
      const [x, z] = squareToXZ(sq)
      expect(p.x).toBeCloseTo(x)
      expect(p.z).toBeCloseTo(z)
      expect(p.y).toBeGreaterThan(0)
    })
    setTargetRings(rings, [])
    expect(rings.count).toBe(0)
    expect(rings.visible).toBe(false)
  })

  it('capacity covers more than any piece can reach', () => {
    const rings = buildTargetRings()
    expect(MAX_TARGET_RINGS).toBeGreaterThanOrEqual(27)
    setTargetRings(rings, BOARD_LAYOUT.map((t) => t.square))
    expect(rings.count).toBe(MAX_TARGET_RINGS)
  })

  it('the old per-tile meshes are gone: Board builds exactly one tile object', () => {
    const tiles = buildTileMesh()
    let meshes = 0
    tiles.traverse((o) => {
      if (o instanceof Mesh) meshes++
    })
    expect(meshes).toBe(1)
  })
})
