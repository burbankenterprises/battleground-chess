import { describe, expect, it } from 'vitest'
import { Box3, Color, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import type { Color as Army, PieceSymbol } from 'chess.js'
import {
  FACING_YAW,
  FORWARD_MARKER,
  FRONT_FEATURE,
  MAX_MODEL_TRIS,
  PLINTH_NAME,
  buildWarfarePiece,
  disposeWarfarePiece,
} from './models'
import { PIECE_DIMS } from './pieceDims'
import { ARMY_PALETTE, ARMY_THEME } from './palette'

/**
 * Phase 4 model contract: every (type × army) model builds, stays within the
 * low-poly budget, faces the enemy line, fits inside PIECE_DIMS (the topple /
 * shatter math relies on it), owns its materials (PieceActor tints per actor)
 * and never intercepts a tap.
 */

const ARMIES: readonly Army[] = ['w', 'b']
const TYPES: readonly PieceSymbol[] = ['p', 'n', 'b', 'r', 'q', 'k']
const ALL = ARMIES.flatMap((color) => TYPES.map((type) => ({ type, color, label: `${color}${type}` })))

/** Contract slack (world units): no model may be taller than its PIECE_DIMS height plus this. */
const HEIGHT_SLACK = 0.05
/** Rounding allowance for the hardcoded PIECE_DIMS numbers (they are measured, then rounded). */
const DIMS_EPSILON = 0.005
/** "Within reason": PIECE_DIMS height may not overstate the tallest model by more than this. */
const MAX_HEIGHT_OVERSTATEMENT = 0.05
/** Overall height ballpark per type (world units): keeps camera framing + battle choreography reading as before. */
const HEIGHT_BALLPARK: Record<PieceSymbol, readonly [number, number]> = {
  p: [0.4, 0.55],
  r: [0.55, 0.75],
  n: [0.7, 0.9],
  b: [0.7, 0.9],
  q: [0.85, 1.05], // the Israelite champion; Goliath is checked against it below
  k: [0.95, 1.1],
}
/** Goliath (b queen) vs the Israelite champion — spec: ~1.25×. */
const GOLIATH_RATIO_RANGE: readonly [number, number] = [1.15, 1.35]

function meshesOf(root: Object3D): Mesh[] {
  const out: Mesh[] = []
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o)
  })
  return out
}

function trisOf(geometry: BufferGeometry): number {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3
}

/** Model in its authored frame (facing yaw removed) with world matrices up to date. */
function authored(type: PieceSymbol, color: Army): Object3D {
  const model = buildWarfarePiece(type, color)
  model.rotation.y = 0
  model.updateMatrixWorld(true)
  return model
}

/** Largest horizontal distance of any vertex from the model's vertical axis. */
function maxHorizontalReach(model: Object3D): number {
  const v = new Vector3()
  let reach = 0
  for (const mesh of meshesOf(model)) {
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      reach = Math.max(reach, Math.hypot(v.x, v.z))
    }
  }
  return reach
}

/** CIE L* (perceptual lightness, 0..100) of a CSS color, from its relative luminance. */
function lStar(css: string): number {
  const c = new Color(css) // three stores linear-sRGB components
  const y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (y * 24389) / 27
}
/** Army tone thresholds (L*): Israelites clearly light, Philistines clearly dark. */
const LIGHT_ARMY_MIN_L = 80
const DARK_ARMY_MAX_L = 30

describe('models — all 12 build', () => {
  it.each(ALL)('$label builds a non-empty group without throwing', ({ type, color }) => {
    const model = buildWarfarePiece(type, color)
    expect(meshesOf(model).length).toBeGreaterThan(3)
  })

  it('returns a fresh group on every call', () => {
    expect(buildWarfarePiece('q', 'w')).not.toBe(buildWarfarePiece('q', 'w'))
  })

  it('distinct army variants where the spec asks for them (pawn, bishop, queen)', () => {
    for (const type of ['p', 'b', 'q'] as const) {
      const w = meshesOf(authored(type, 'w')).map((m) => m.geometry)
      const b = meshesOf(authored(type, 'b')).map((m) => m.geometry)
      // Different builders → the meshes do not line up geometry-for-geometry.
      const sameShape = w.length === b.length && w.every((g, i) => g === b[i])
      expect(sameShape, type).toBe(false)
    }
  })
})

describe('models — low-poly budget', () => {
  it.each(ALL)(`$label is at most ${MAX_MODEL_TRIS} triangles`, ({ type, color }) => {
    const tris = meshesOf(buildWarfarePiece(type, color)).reduce((n, m) => n + trisOf(m.geometry), 0)
    expect(tris).toBeGreaterThan(0)
    expect(tris).toBeLessThanOrEqual(MAX_MODEL_TRIS)
  })
})

describe('models — facing (battle line)', () => {
  it('white faces -z (toward black), black faces +z (toward white)', () => {
    expect(FACING_YAW.w).toBe(0)
    expect(FACING_YAW.b).toBeCloseTo(Math.PI)
  })

  it.each(ALL)('$label carries its army facing and its forward marker points at the enemy', ({ type, color }) => {
    const model = buildWarfarePiece(type, color)
    expect(model.rotation.y).toBeCloseTo(FACING_YAW[color])
    model.updateMatrixWorld(true)
    const marker = model.getObjectByName(FORWARD_MARKER)
    expect(marker).toBeDefined()
    const forward = marker!.getWorldPosition(new Vector3())
    expect(Math.sign(forward.z)).toBe(color === 'w' ? -1 : 1)
    expect(Math.abs(forward.x)).toBeLessThan(1e-9)
  })

  it.each(ALL)('$label is authored facing -z: its front feature sits ahead of center', ({ type, color }) => {
    const model = authored(type, color)
    const feature = model.getObjectByName(FRONT_FEATURE)
    expect(feature).toBeDefined()
    const center = new Box3().setFromObject(feature!, true).getCenter(new Vector3())
    expect(center.z).toBeLessThan(0)
  })
})

describe('models — dimensions match PIECE_DIMS (topple pivot + shard placement)', () => {
  it.each(ALL)('$label stands on the board and fits under its PIECE_DIMS height', ({ type, color }) => {
    const box = new Box3().setFromObject(authored(type, color), true)
    expect(box.min.y).toBeCloseTo(0, 6) // the base sits exactly on the board
    expect(box.max.y).toBeLessThanOrEqual(PIECE_DIMS[type].height + HEIGHT_SLACK)
    expect(box.max.y).toBeLessThanOrEqual(PIECE_DIMS[type].height + DIMS_EPSILON)
  })

  it.each(TYPES)('PIECE_DIMS.%s height covers the tallest army model without overstating it', (type) => {
    const tallest = Math.max(
      ...ARMIES.map((color) => new Box3().setFromObject(authored(type, color), true).max.y),
    )
    expect(PIECE_DIMS[type].height).toBeGreaterThanOrEqual(tallest - DIMS_EPSILON)
    expect(PIECE_DIMS[type].height - tallest).toBeLessThanOrEqual(MAX_HEIGHT_OVERSTATEMENT)
  })

  it.each(ALL)('$label: the plinth rim IS the topple edge (PIECE_DIMS radius) and nothing reaches past it', ({ type, color }) => {
    const model = authored(type, color)
    const plinth = model.getObjectByName(PLINTH_NAME)
    expect(plinth).toBeDefined()
    const plinthR = maxHorizontalReach(plinth!)
    expect(plinthR).toBeCloseTo(PIECE_DIMS[type].radius, 6)
    expect(maxHorizontalReach(model)).toBeLessThanOrEqual(PIECE_DIMS[type].radius + 1e-6)
  })

  it.each(TYPES)('%s overall height stays in the placeholder-era ballpark', (type) => {
    const [lo, hi] = HEIGHT_BALLPARK[type]
    const heightOf = (color: Army) => new Box3().setFromObject(authored(type, color), true).max.y
    const armies = type === 'q' ? (['w'] as const) : ARMIES // Goliath is deliberately bigger
    for (const color of armies) {
      expect(heightOf(color), `${color}${type}`).toBeGreaterThanOrEqual(lo)
      expect(heightOf(color), `${color}${type}`).toBeLessThanOrEqual(hi)
    }
  })

  it('Goliath towers ~1.25× over the Israelite champion', () => {
    const champion = new Box3().setFromObject(authored('q', 'w'), true).max.y
    const goliath = new Box3().setFromObject(authored('q', 'b'), true).max.y
    const [lo, hi] = GOLIATH_RATIO_RANGE
    expect(goliath / champion).toBeGreaterThanOrEqual(lo)
    expect(goliath / champion).toBeLessThanOrEqual(hi)
  })
})

describe('models — taps pass through (full-tile tap targets)', () => {
  it.each(ALL)('$label: every mesh has a no-op raycast', ({ type, color }) => {
    const proto = Mesh.prototype.raycast
    for (const mesh of meshesOf(buildWarfarePiece(type, color))) {
      expect(mesh.raycast).not.toBe(proto)
      const hits: unknown[] = []
      // A no-op raycast must never report an intersection, whatever it is asked.
      ;(mesh.raycast as (r: unknown, i: unknown[]) => void)({}, hits)
      expect(hits).toEqual([])
    }
  })
})

describe('models — materials (applyTint mutates emissive per actor)', () => {
  it.each(ALL)('$label never shares a material with another build of the same model', ({ type, color }) => {
    const a = new Set(meshesOf(buildWarfarePiece(type, color)).map((m) => m.material))
    for (const m of meshesOf(buildWarfarePiece(type, color))) {
      expect(a.has(m.material)).toBe(false)
    }
  })

  it('every mesh uses a single MeshStandardMaterial from its own army palette', () => {
    for (const { type, color } of ALL) {
      const allowed = new Set(Object.values(ARMY_THEME[color]).map((s) => new Color(s.color).getHex()))
      for (const mesh of meshesOf(buildWarfarePiece(type, color))) {
        expect(mesh.material).toBeInstanceOf(MeshStandardMaterial)
        const m = mesh.material as MeshStandardMaterial
        expect(allowed.has(m.color.getHex()), `${color}${type} ${m.name}`).toBe(true)
        expect(m.emissive.getHex()).toBe(new Color(ARMY_PALETTE[color].emissive).getHex())
      }
    }
  })

  it('disposeWarfarePiece releases the materials but keeps the shared geometries', () => {
    const model = buildWarfarePiece('k', 'b')
    const materials = new Set(meshesOf(model).map((m) => m.material as MeshStandardMaterial))
    const geometries = new Set(meshesOf(model).map((m) => m.geometry))
    let disposedMaterials = 0
    let disposedGeometries = 0
    for (const m of materials) m.addEventListener('dispose', () => disposedMaterials++)
    for (const g of geometries) g.addEventListener('dispose', () => disposedGeometries++)
    disposeWarfarePiece(model)
    expect(disposedMaterials).toBe(materials.size)
    expect(disposedGeometries).toBe(0)
  })
})

describe('palette — army contrast (w light, b dark)', () => {
  it('the Israelite dominant tone is light and the Philistine dominant tone is dark', () => {
    expect(lStar(ARMY_PALETTE.w.color)).toBeGreaterThan(LIGHT_ARMY_MIN_L)
    expect(lStar(ARMY_PALETTE.b.color)).toBeLessThan(DARK_ARMY_MAX_L)
  })

  it('each army’s dominant garment color is its ARMY_PALETTE color (shards/dust match the models)', () => {
    for (const color of ARMIES) {
      expect(ARMY_THEME[color].cloth.color).toBe(ARMY_PALETTE[color].color)
    }
  })
})
