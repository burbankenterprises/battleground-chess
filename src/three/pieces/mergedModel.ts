import type { Color as Army, PieceSymbol } from 'chess.js'
import { BufferAttribute, Color, Group, Mesh, MeshStandardMaterial, Vector2 } from 'three'
import type { BufferGeometry, Material, WebGLProgramParametersWithUniforms } from 'three'
import { FACING_YAW, FORWARD_MARKER, buildWarfarePiece } from './models'
import { NO_RAYCAST, mergeOrThrow } from '../meshUtils'
import { cellU, cellV, familyOfRole, textureAtlas, TEX_ATLAS_CELLS } from './textures'

/**
 * Render models (Phase 5 perf pass): each procedural piece merged into ONE
 * mesh, so a piece costs one draw call (plus one in the shadow pass) instead
 * of one per part — the start position drops from 467 piece draw calls to 32.
 *
 * models.ts stays the authored source of truth (its multi-part structure,
 * names and palette are contract-tested in models.test.ts). This module bakes
 * an authored model into a single geometry:
 *   - every part's transform is applied to its vertices (authored frame),
 *   - its role color becomes a per-vertex `color`,
 *   - its role metalness/roughness become a per-vertex `pbr` attribute that a
 *     small shader patch feeds to MeshStandardMaterial's PBR inputs — so bronze
 *     stays metallic and linen stays matte inside one material.
 *
 * Contract with PieceActor (applyTint mutates emissive per actor):
 *   - every build returns a FRESH material (never shared between builds), so
 *     the promotion flash / check alarm can never leak between pieces;
 *   - the merged geometry is cached per model and shared — never mutate or
 *     dispose it (disposeWarfarePiece only releases materials).
 * The mesh is raycast-disabled (taps pass through to the full board tile) and
 * casts the piece's shadow from the key light.
 */

/** Name of the merged body mesh inside a render model. */
export const MERGED_BODY = 'merged-body'

const PBR_ATTRIBUTE = 'pbr'

/**
 * World-space texel density: UV repeat per world unit. Primitives carry 0..1
 * UVs over their whole surface, which would stretch one atlas cell across a
 * whole robe; scaling UVs by part size gives a consistent material scale.
 */
const UV_REPEAT = 3

/** Stamp a part's UVs into its role's atlas cell (and scale for density). */
function stampUvs(part: BufferGeometry, material: MeshStandardMaterial): void {
  let uv = part.getAttribute('uv') as BufferAttribute | undefined
  if (!uv) {
    // Geometry without UVs (should not happen with three primitives): flat map.
    const count = part.getAttribute('position').count
    part.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2))
    uv = part.getAttribute('uv') as BufferAttribute
  }
  const role = material.name.split('-')[1] ?? 'cloth'
  const family = familyOfRole(role)
  const cell = FAMILIES_INDEX(family)
  const cu = cellU(cell)
  const cv = cellV(cell)
  const span = 1 / TEX_ATLAS_CELLS
  const data = uv.array as Float32Array
  for (let i = 0; i < uv.count; i++) {
    data[i * 2] = cu + fract(data[i * 2] * UV_REPEAT) * span
    data[i * 2 + 1] = cv + fract(data[i * 2 + 1] * UV_REPEAT) * span
  }
  uv.needsUpdate = true
}

function fract(v: number): number {
  return v - Math.floor(v)
}

function FAMILIES_INDEX(family: ReturnType<typeof familyOfRole>): number {
  return FAMILIES_LIST.indexOf(family)
}

const FAMILIES_LIST = ['linen', 'leather', 'bronze', 'steel', 'stone', 'wood', 'skin', 'hair', 'clothFlat'] as const

/** One merged geometry per (army, type), built on first use. Never disposed. */
const mergedGeometryCache = new Map<string, BufferGeometry>()

/** Emissive look shared by every part of an authored model (same for all its materials). */
type BaseLook = { emissive: Color; emissiveIntensity: number }
const baseLookCache = new Map<string, BaseLook>()

function cacheKey(type: PieceSymbol, color: Army): string {
  return `${color}${type}`
}

/**
 * Bake an authored model into one indexed geometry with `position`, `normal`,
 * `color` (linear RGB of the part's role) and `pbr` (metalness, roughness).
 */
function bakeModel(type: PieceSymbol, color: Army): { geometry: BufferGeometry; look: BaseLook } {
  const authored = buildWarfarePiece(type, color)
  authored.rotation.y = 0 // bake in the authored frame; the render root carries the facing yaw
  authored.updateMatrixWorld(true)

  const parts: BufferGeometry[] = []
  let look: BaseLook | null = null
  authored.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    const material = obj.material as MeshStandardMaterial
    look ??= { emissive: material.emissive.clone(), emissiveIntensity: material.emissiveIntensity }
    const part = obj.geometry.clone()
    // Tier 2: keep UVs (normal/roughness maps need them). Box/cylinder/sphere
    // primitives all carry sensible 0..1 UVs; stamp them into the role's
    // atlas cell so one material can texture every role of the piece.
    part.applyMatrix4(obj.matrixWorld)
    stampUvs(part, material)
    // A mirroring transform would flip the triangle winding (back faces out).
    if (obj.matrixWorld.determinant() < 0 && part.index) {
      const idx = part.index
      for (let i = 0; i < idx.count; i += 3) {
        const b = idx.getX(i + 1)
        idx.setX(i + 1, idx.getX(i + 2))
        idx.setX(i + 2, b)
      }
    }
    const count = part.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    const pbr = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = material.color.r
      colors[i * 3 + 1] = material.color.g
      colors[i * 3 + 2] = material.color.b
      pbr[i * 2] = material.metalness
      pbr[i * 2 + 1] = material.roughness
    }
    part.setAttribute('color', new BufferAttribute(colors, 3))
    part.setAttribute(PBR_ATTRIBUTE, new BufferAttribute(pbr, 2))
    parts.push(part)
  })

  const geometry = mergeOrThrow(parts, `piece ${color}${type}`)
  for (const p of parts) p.dispose()
  // The authored model was only a template: release its fresh materials.
  const materials = new Set<Material>()
  authored.traverse((obj) => {
    if (obj instanceof Mesh) materials.add(obj.material as Material)
  })
  for (const m of materials) m.dispose()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  if (!look) throw new Error(`battleground-chess: authored model ${color}${type} has no meshes`)
  return { geometry, look }
}

function mergedFor(type: PieceSymbol, color: Army): { geometry: BufferGeometry; look: BaseLook } {
  const key = cacheKey(type, color)
  let geometry = mergedGeometryCache.get(key)
  let look = baseLookCache.get(key)
  if (!geometry || !look) {
    const baked = bakeModel(type, color)
    geometry = baked.geometry
    look = baked.look
    mergedGeometryCache.set(key, geometry)
    baseLookCache.set(key, look)
  }
  return { geometry, look }
}

/** Shader include tokens the PBR patch replaces (three r187 MeshStandardMaterial). */
const PATCHES: readonly { shader: 'vertex' | 'fragment'; token: string; replacement: string }[] = [
  {
    shader: 'vertex',
    token: '#include <color_pars_vertex>',
    replacement: `#include <color_pars_vertex>\nattribute vec2 ${PBR_ATTRIBUTE};\nvarying vec2 vPbr;`,
  },
  {
    shader: 'vertex',
    token: '#include <color_vertex>',
    replacement: `#include <color_vertex>\n\tvPbr = ${PBR_ATTRIBUTE};`,
  },
  {
    shader: 'fragment',
    token: '#include <color_pars_fragment>',
    replacement: '#include <color_pars_fragment>\nvarying vec2 vPbr;',
  },
  {
    shader: 'fragment',
    token: '#include <roughnessmap_fragment>',
    replacement: 'float roughnessFactor = vPbr.y;',
  },
  {
    shader: 'fragment',
    token: '#include <metalnessmap_fragment>',
    replacement: 'float metalnessFactor = vPbr.x;',
  },
]

/**
 * Feed the per-vertex `pbr` attribute into MeshStandardMaterial's metalness /
 * roughness. Throws if three's shader chunks ever change shape, so a three
 * upgrade fails loudly in tests instead of silently rendering every part with
 * the same finish.
 */
export function patchPbrShader(vertexShader: string, fragmentShader: string): { vertexShader: string; fragmentShader: string } {
  let vs = vertexShader
  let fs = fragmentShader
  for (const p of PATCHES) {
    const source = p.shader === 'vertex' ? vs : fs
    if (!source.includes(p.token)) {
      throw new Error(`battleground-chess: shader token not found (${p.shader}): ${p.token}`)
    }
    const patched = source.replace(p.token, p.replacement)
    if (p.shader === 'vertex') vs = patched
    else fs = patched
  }
  return { vertexShader: vs, fragmentShader: fs }
}

/**
 * Module-level (shared) so every piece material compiles to the SAME program:
 * three keys programs by `customProgramCacheKey()`, which defaults to this
 * function's source.
 */
function onBeforeCompilePbr(shader: WebGLProgramParametersWithUniforms): void {
  const patched = patchPbrShader(shader.vertexShader, shader.fragmentShader)
  shader.vertexShader = patched.vertexShader
  shader.fragmentShader = patched.fragmentShader
}

/** A fresh material for one render model (per build — applyTint mutates it). */
function pieceMaterial(look: BaseLook, name: string): MeshStandardMaterial {
  const atlas = textureAtlas()
  const material = new MeshStandardMaterial({
    color: 0xffffff, // the per-vertex role colors carry the paint
    vertexColors: true,
    // Metalness / roughness come per vertex from the `pbr` attribute (shader patch);
    // the roughness MAP adds intra-surface variation on top.
    metalness: 0,
    roughness: 1,
    roughnessMap: atlas.roughness,
    normalMap: atlas.normal,
    normalScale: new Vector2(0.8, 0.8),
    emissive: look.emissive,
    emissiveIntensity: look.emissiveIntensity,
    // Organic parts were authored smooth; the merge averages normals anyway.
    flatShading: false,
  })
  material.name = name
  material.onBeforeCompile = onBeforeCompilePbr
  return material
}

/**
 * Build the render model of a piece: a fresh Group (base on y = 0, facing the
 * enemy line) holding ONE merged mesh with a fresh material, plus the same
 * forward marker as the authored model. Safe to call per actor / per mount.
 */
export function buildMergedWarfarePiece(type: PieceSymbol, color: Army): Group {
  const { geometry, look } = mergedFor(type, color)
  const root = new Group()
  root.name = `warfare-${color}${type}`
  const body = new Mesh(geometry, pieceMaterial(look, `${color}${type}-merged`))
  body.name = MERGED_BODY
  body.raycast = NO_RAYCAST
  body.castShadow = true
  root.add(body)
  const forward = new Group()
  forward.name = FORWARD_MARKER
  forward.position.set(0, 0, -1)
  root.add(forward)
  root.rotation.y = FACING_YAW[color]
  return root
}
