import { BufferAttribute, BackSide, Color, Mesh, MeshBasicMaterial, PMREMGenerator, Scene, SphereGeometry } from 'three'
import type { Texture, WebGLRenderer } from 'three'

/**
 * Procedural environment lighting (Tier 2): the scene's PBR materials get an
 * environment map WITHOUT shipping an HDR — a tiny torchlit-desert sky built
 * from three.js primitives, baked once with PMREMGenerator, assigned as
 * scene.environment. Metal then reflects the warm sky instead of rendering
 * dead; every surface gains soft ambient directionality.
 *
 * The bake scene mirrors the arena's mood (night zenith → ember horizon band,
 * four hot torch spots) so reflections belong to the world the pieces stand
 * in. Fully offline, deterministic, one bake per renderer.
 */

/** Sky dome radius for the bake scene (arbitrary; PMREM only sees directions). */
export const ENV_SKY_R = 10
/** How many torch spots paint onto the dome. */
export const ENV_TORCHES = 4
/** Bake blur radius — soft so reflections never alias. */
export const ENV_SIGMA = 0.04

/** Horizon band weights (mirrors arenaLayout.skyWeights, simplified). */
export function emberBand(elevation: number): { ember: number; dusk: number } {
  const ember = Math.max(0, 1 - elevation / 0.18)
  const dusk = Math.max(0, 1 - Math.abs(elevation - 0.22) / 0.3)
  return { ember, dusk }
}

/** Night zenith / dusk / ember tones of the bake sky (matches the arena). */
export const ENV_NIGHT = '#0a0c14'
export const ENV_DUSK = '#241a24'
export const ENV_EMBER = '#ff9a4a'
export const ENV_TORCH = '#ffb066'
/** Torch spot brightness (emissive multiplier — drives reflection energy). */
export const ENV_TORCH_GAIN = 6

/** Vertex-colored dome: ember band at the horizon fading to the night zenith. */
export function envSkyMesh(): Mesh {
  const geometry = new SphereGeometry(ENV_SKY_R, 24, 12)
  const pos = geometry.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const ember = new Color(ENV_EMBER)
  const dusk = new Color(ENV_DUSK)
  const night = new Color(ENV_NIGHT)
  const c = new Color()
  for (let i = 0; i < pos.count; i++) {
    const y = Math.max(-1, Math.min(1, pos.getY(i) / ENV_SKY_R))
    const elevation = Math.acos(y) / (Math.PI / 2) // 0 at horizon… 1 at zenith
    const w = emberBand(elevation)
    c.copy(night).lerp(dusk, w.dusk).lerp(ember, w.ember)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  const material = new MeshBasicMaterial({ vertexColors: true, side: BackSide })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'env-sky'
  return mesh
}

/** One hot spot on the dome (a torch), placed at horizon height at `angle`. */
export function torchSpot(angle: number): Mesh {
  const g = new SphereGeometry(0.55, 8, 6)
  const m = new MeshBasicMaterial({ color: new Color(ENV_TORCH).multiplyScalar(ENV_TORCH_GAIN) })
  const mesh = new Mesh(g, m)
  mesh.position.set(Math.cos(angle) * ENV_SKY_R * 0.98, 0.6, Math.sin(angle) * ENV_SKY_R * 0.98)
  return mesh
}

/** The one-off bake scene (exported for tests). */
export function envScene(): Scene {
  const scene = new Scene()
  scene.add(envSkyMesh())
  for (let i = 0; i < ENV_TORCHES; i++) scene.add(torchSpot((i / ENV_TORCHES) * Math.PI * 2 + Math.PI / 4))
  return scene
}

const baked = new WeakMap<WebGLRenderer, Texture>()

/**
 * The baked environment for `renderer` (cached per renderer, baked once).
 * The returned texture must not be disposed while it is scene.environment.
 */
export function environmentFor(renderer: WebGLRenderer, force?: () => Texture): Texture {
  let tex = baked.get(renderer)
  if (tex) return tex
  const pmrem = new PMREMGenerator(renderer)
  tex = force ? force() : pmrem.fromScene(envScene(), ENV_SIGMA).texture
  pmrem.dispose()
  baked.set(renderer, tex)
  return tex
}
