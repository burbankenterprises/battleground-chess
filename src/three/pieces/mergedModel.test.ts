import { describe, expect, it } from 'vitest'
import { Box3, Color, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { Color as Army, PieceSymbol } from 'chess.js'
import { FACING_YAW, FORWARD_MARKER, MAX_MODEL_TRIS, buildWarfarePiece, disposeWarfarePiece } from './models'
import { MERGED_BODY, buildMergedWarfarePiece, patchPbrShader } from './mergedModel'
import { countDrawCalls } from '../meshUtils'
import { ShaderLib } from 'three'

const TYPES: PieceSymbol[] = ['p', 'n', 'b', 'r', 'q', 'k']
const ARMIES: Army[] = ['w', 'b']
const ALL = ARMIES.flatMap((color) => TYPES.map((type) => [type, color] as const))

function meshesOf(root: Object3D): Mesh[] {
  const out: Mesh[] = []
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o)
  })
  return out
}

function trisOf(mesh: Mesh): number {
  const g = mesh.geometry
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3
}

describe('merged render models (one draw call per piece)', () => {
  it.each(ALL)('%s/%s: exactly one mesh — one draw call', (type, color) => {
    const model = buildMergedWarfarePiece(type, color)
    const meshes = meshesOf(model)
    expect(meshes).toHaveLength(1)
    expect(meshes[0].name).toBe(MERGED_BODY)
    expect(countDrawCalls(model)).toBe(1)
  })

  it.each(ALL)('%s/%s: keeps every authored triangle (≤ the 300-tri budget)', (type, color) => {
    const authored = meshesOf(buildWarfarePiece(type, color)).reduce((n, m) => n + trisOf(m), 0)
    const merged = trisOf(meshesOf(buildMergedWarfarePiece(type, color))[0])
    expect(merged).toBe(authored)
    expect(merged).toBeLessThanOrEqual(MAX_MODEL_TRIS)
  })

  it.each(ALL)('%s/%s: same footprint, height and facing as the authored model', (type, color) => {
    const authored = buildWarfarePiece(type, color)
    const merged = buildMergedWarfarePiece(type, color)
    authored.updateMatrixWorld(true)
    merged.updateMatrixWorld(true)
    // precise: per-vertex bounds (the default transforms each part's AABB, which
    // over-estimates rotated parts of the authored model).
    const a = new Box3().setFromObject(authored, true)
    const b = new Box3().setFromObject(merged, true)
    for (const k of ['x', 'y', 'z'] as const) {
      expect(b.min[k]).toBeCloseTo(a.min[k], 5)
      expect(b.max[k]).toBeCloseTo(a.max[k], 5)
    }
    expect(merged.rotation.y).toBeCloseTo(FACING_YAW[color])
    const marker = merged.getObjectByName(FORWARD_MARKER)
    expect(marker?.position.toArray()).toEqual([0, 0, -1])
  })

  it.each(ALL)('%s/%s: carries every authored role color and finish per vertex', (type, color) => {
    const authored = meshesOf(buildWarfarePiece(type, color))
    const want = new Set(
      authored.map((m) => {
        const mat = m.material as MeshStandardMaterial
        return `${mat.color.getHexString()}|${mat.metalness.toFixed(3)}|${mat.roughness.toFixed(3)}`
      }),
    )
    const body = meshesOf(buildMergedWarfarePiece(type, color))[0]
    const col = body.geometry.getAttribute('color')
    const pbr = body.geometry.getAttribute('pbr')
    expect(col.count).toBe(body.geometry.getAttribute('position').count)
    expect(pbr.count).toBe(col.count)
    const got = new Set<string>()
    const c = new Color()
    for (let i = 0; i < col.count; i++) {
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i))
      got.add(`${c.getHexString()}|${pbr.getX(i).toFixed(3)}|${pbr.getY(i).toFixed(3)}`)
    }
    expect(got).toEqual(want)
  })

  it('every build gets a FRESH material (applyTint can never leak between actors)', () => {
    const a = meshesOf(buildMergedWarfarePiece('q', 'w'))[0]
    const b = meshesOf(buildMergedWarfarePiece('q', 'w'))[0]
    expect(a.material).not.toBe(b.material)
    // Geometry is shared (built once per model) — memory stays flat.
    expect(a.geometry).toBe(b.geometry)
    // Tinting one never touches the other.
    const ma = a.material as MeshStandardMaterial
    const mb = b.material as MeshStandardMaterial
    const before = mb.emissive.getHex()
    ma.emissive.set('#ff2a1a')
    ma.emissiveIntensity = 1.1
    expect(mb.emissive.getHex()).toBe(before)
  })

  it('materials keep the authored emissive base (the flash / alarm lerps from it)', () => {
    for (const [type, color] of ALL) {
      const authored = meshesOf(buildWarfarePiece(type, color))[0].material as MeshStandardMaterial
      const merged = meshesOf(buildMergedWarfarePiece(type, color))[0].material as MeshStandardMaterial
      expect(merged.emissive.getHex()).toBe(authored.emissive.getHex())
      expect(merged.emissiveIntensity).toBe(authored.emissiveIntensity)
      expect(merged.vertexColors).toBe(true)
      expect(merged.flatShading).toBe(true)
    }
  })

  it('pieces cast the key-light shadow and never eat a tile tap', () => {
    const model = buildMergedWarfarePiece('k', 'b')
    model.updateMatrixWorld(true)
    const body = meshesOf(model)[0]
    expect(body.castShadow).toBe(true)
    expect(body.receiveShadow).toBe(false)
    const raycaster = new Raycaster(new Vector3(0, 5, 0), new Vector3(0, -1, 0))
    expect(raycaster.intersectObject(model, true)).toEqual([])
  })

  it('disposeWarfarePiece releases the material but keeps the shared merged geometry', () => {
    const model = buildMergedWarfarePiece('n', 'w')
    const body = meshesOf(model)[0]
    let materialDisposed = false
    let geometryDisposed = false
    ;(body.material as MeshStandardMaterial).addEventListener('dispose', () => {
      materialDisposed = true
    })
    body.geometry.addEventListener('dispose', () => {
      geometryDisposed = true
    })
    disposeWarfarePiece(model)
    expect(materialDisposed).toBe(true)
    expect(geometryDisposed).toBe(false)
  })

  it('the PBR shader patch applies cleanly to three’s MeshStandardMaterial shaders', () => {
    const { vertexShader, fragmentShader } = patchPbrShader(
      ShaderLib.standard.vertexShader,
      ShaderLib.standard.fragmentShader,
    )
    expect(vertexShader).toContain('attribute vec2 pbr;')
    expect(vertexShader).toContain('vPbr = pbr;')
    expect(fragmentShader).toContain('float roughnessFactor = vPbr.y;')
    expect(fragmentShader).toContain('float metalnessFactor = vPbr.x;')
    expect(fragmentShader).not.toContain('#include <roughnessmap_fragment>')
    expect(fragmentShader).not.toContain('#include <metalnessmap_fragment>')
    expect(() => patchPbrShader('void main() {}', 'void main() {}')).toThrow(/shader token not found/)
  })

  it('the 32-piece start position costs 32 piece draw calls (was one per part)', () => {
    const backRank: PieceSymbol[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']
    let merged = 0
    let authored = 0
    for (const color of ARMIES) {
      for (const type of [...backRank, ...Array<PieceSymbol>(8).fill('p')]) {
        merged += countDrawCalls(buildMergedWarfarePiece(type, color))
        authored += countDrawCalls(buildWarfarePiece(type, color))
      }
    }
    expect(merged).toBe(32)
    expect(authored).toBeGreaterThan(merged * 10)
  })
})
