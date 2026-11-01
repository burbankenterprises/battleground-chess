import {
  BufferAttribute,
  Color,
  Euler,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  Points,
  Quaternion,
  Vector3,
} from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Small shared three.js helpers for the Phase 5 scene structure (environment,
 * instanced board, merged piece models). Allocation-free where they run per
 * frame.
 */

/**
 * Raycast no-op for purely visual objects: they can never report an
 * intersection, so they can never eat a tile tap (full-tile tap targets).
 */
export const NO_RAYCAST = (): void => undefined

/** Give a geometry a constant per-vertex `color` attribute (linear RGB). Mutates + returns it. */
export function paintVertices(geometry: BufferGeometry, color: Color): BufferGeometry {
  const count = geometry.getAttribute('position').count
  const data = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r
    data[i * 3 + 1] = color.g
    data[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new BufferAttribute(data, 3))
  return geometry
}

/**
 * Merge geometries that share the same attribute layout into one. Throws
 * (instead of three's silent `null` + console error) so a layout mistake
 * fails loudly in tests.
 */
export function mergeOrThrow(geometries: BufferGeometry[], label: string): BufferGeometry {
  const merged = mergeGeometries(geometries, false)
  if (!merged) throw new Error(`battleground-chess: could not merge geometries for ${label}`)
  return merged
}

// Scratch objects for setInstance — never escape this module.
const _matrix = new Matrix4()
const _position = new Vector3()
const _quaternion = new Quaternion()
const _euler = new Euler()
const _scale = new Vector3()

/** Write instance `index`'s transform (position, Euler XYZ rotation, scale). Allocation-free. */
export function setInstance(
  mesh: InstancedMesh,
  index: number,
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  _position.set(px, py, pz)
  _quaternion.setFromEuler(_euler.set(rx, ry, rz))
  _scale.set(sx, sy, sz)
  mesh.setMatrixAt(index, _matrix.compose(_position, _quaternion, _scale))
}

/** Number of draw calls an object tree issues in the color pass (one per visible mesh / points). */
export function countDrawCalls(root: Object3D): number {
  let n = 0
  root.traverseVisible((o) => {
    if (o instanceof Mesh || o instanceof Points) {
      if (o instanceof InstancedMesh && o.count === 0) return
      n++
    }
  })
  return n
}

/** Dispose every geometry + material owned by the meshes / points under `root`. */
export function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh || o instanceof Points)) return
    o.geometry.dispose()
    const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) m.dispose()
    if (o instanceof InstancedMesh) o.dispose()
  })
}
