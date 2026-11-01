import { Color, DataTexture, LinearFilter, RedFormat, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three'
import { hashString, mulberry32 } from '../effects/shatter'

/**
 * Procedural material textures (Tier 2): normal + roughness maps generated in
 * code — no image assets, no network, deterministic (seeded), and cheap to
 * build (small canvases, tiled at render time via RepeatWrapping).
 *
 * One texture ATLAS per surface family (not per piece): all linen parts of
 * both armies share the linen weave, all bronze parts share the hammered
 * pattern, etc. Textures are keyed by family in a module cache and live for
 * the page; the merged-model pipeline stamps each part's UVs into its own
 * atlas cell so one material renders the whole merged piece.
 *
 * Families and what they fake:
 *   linen    woven cloth: alternating warp/weft strands + thread noise
 *   leather  hide: mottled cellular blotches, low-frequency
 *   bronze   hammered metal: overlapping radial dent lobes + pitting
 *   steel    ground blade: parallel grinding lines + fine speckle
 *   stone    chiseled plinth/tool stone: coarse grain + shallow gouges
 *   wood     grain: stretched striations with occasional knots
 *   skin     subtle pores + soft blotch variation (very low amplitude)
 *   hair     directional strands
 *   clothFlat smooth-fallback for accent banners (tiny amplitude weave)
 */

/** Atlas layout: N×N cells, one per family (uv stamping relies on this). */
export const TEX_ATLAS_CELLS = 4 // 4×4 = 16 cells ≥ family count

/** Texture resolution per atlas cell (power of two). */
export const TEX_CELL = 128

export type TextureFamily =
  | 'linen'
  | 'leather'
  | 'bronze'
  | 'steel'
  | 'stone'
  | 'wood'
  | 'skin'
  | 'hair'
  | 'clothFlat'

export const FAMILIES: readonly TextureFamily[] = [
  'linen',
  'leather',
  'bronze',
  'steel',
  'stone',
  'wood',
  'skin',
  'hair',
  'clothFlat',
]

/** Family → atlas cell index (stable order = FAMILIES order). */
export function cellOf(family: TextureFamily): number {
  const i = FAMILIES.indexOf(family)
  if (i < 0) throw new Error(`battleground-chess: unknown texture family ${family}`)
  return i
}

/** Cell-local U coordinate inside the atlas for a cell index. */
export function cellU(cell: number): number {
  return (cell % TEX_ATLAS_CELLS) / TEX_ATLAS_CELLS
}

/** Cell-local V coordinate inside the atlas for a cell index. */
export function cellV(cell: number): number {
  return Math.floor(cell / TEX_ATLAS_CELLS) / TEX_ATLAS_CELLS
}

/** Map a role to its surface family (palette.ts roles → texture families). */
export function familyOfRole(role: string): TextureFamily {
  switch (role) {
    case 'cloth':
    case 'mount': // horse coat: short woven-look hide, reads as cloth at scale
      return 'linen'
    case 'sash':
      return 'leather'
    case 'metal':
      return 'bronze'
    case 'blade':
      return 'steel'
    case 'plinth':
    case 'throne':
      return 'stone'
    case 'wood':
      return 'wood'
    case 'skin':
      return 'skin'
    case 'hair':
      return 'hair'
    case 'accent':
      return 'clothFlat'
    default:
      return 'linen'
  }
}

// ---- normal-map synthesis ----

/**
 * Height-field → tangent-space normal map (RGBA, xyz = normal, a = 1).
 * Central differences with wrap-around (the texture tiles).
 */
export function heightToNormal(height: Float32Array, size: number, strength: number): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel-ish central difference (tangent space: x right, y up).
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      // Normalize (-dx, -dy, 1).
      const len = Math.hypot(dx, dy, 1)
      const o = (y * size + x) * 4
      data[o] = Math.round(128 - (dx / len) * 127)
      data[o + 1] = Math.round(128 - (dy / len) * 127)
      data[o + 2] = Math.round(128 + (1 / len) * 127)
      data[o + 3] = 255
    }
  }
  return data
}

/** Wrap a value into [0,1). */
function fract(v: number): number {
  return v - Math.floor(v)
}

/** Bilinear sample of a normalized height field with wrap. */
function sampleHeight(h: Float32Array, size: number, u: number, v: number): number {
  const x = fract(u) * size
  const y = fract(v) * size
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const x1 = (x0 + 1) % size
  const y1 = (y0 + 1) % size
  const a = h[y0 * size + x0]
  const b = h[y0 * size + x1]
  const c = h[y1 * size + x0]
  const d = h[y1 * size + x1]
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
}

// ---- family height fields ----

/** Deterministic value noise on a grid (bilinear, wrapping) at a given frequency. */
function valueNoise(size: number, cells: number, seed: string): Float32Array {
  const grid = new Float32Array(cells * cells)
  const rand = mulberry32(hashString(seed))
  for (let i = 0; i < grid.length; i++) grid[i] = rand()
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Grid coordinates wrap (sampleHeight does fract), so the noise tiles.
      out[y * size + x] = sampleHeight(grid, cells, (x / size) * cells, (y / size) * cells)
    }
  }
  return out
}

/** Multi-octave wrapping value noise. */
function fbm(
  size: number,
  octaves: number,
  baseCells: number,
  seed: string,
  gain = 0.5,
): Float32Array {
  const out = new Float32Array(size * size)
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise(size, Math.max(2, baseCells * 2 ** o), `${seed}:${o}`)
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp
    total += amp
    amp *= gain
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

/**
 * Height field for one family. Deterministic per family; amplitude is
 * relative (0..1) — normal-map strength is applied at conversion.
 */
export function familyHeight(family: TextureFamily, size = TEX_CELL): Float32Array {
  const h = new Float32Array(size * size)
  const rand = mulberry32(hashString(`tex-${family}`))
  switch (family) {
    case 'linen': {
      // Warp/weft: strands run along X on even bands, along Y on odd bands.
      const strands = 16
      const band = size / strands
      const fiber = layerOf(size, 'linen-fiber', 24, 2, 0.35)
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x
          const s = Math.floor(y / band) % 2 === 0 ? x / size : y / size
          const strand = Math.abs(fract(s * strands) - 0.5) * 2 // 0 at center, 1 at edges
          const wobble = Math.sin((x / size) * Math.PI * 2 * 3 + y * 0.2) * 0.15
          const thread = 0.5 + 0.5 * Math.sin(s * Math.PI * 2 * strands * 1.0 + wobble * 6)
          h[i] = (0.55 * (1 - strand * 0.6) + 0.45 * thread) * 0.75 + fiber[i] * 0.25
        }
      }
      break
    }
    case 'leather': {
      const cells = fbm(size, 4, 5, 'leather-cell')
      const pore = fbm(size, 3, 22, 'leather-pore')
      for (let i = 0; i < h.length; i++) {
        const crease = 1 - Math.abs(cells[i] - 0.5) * 2 // valleys between cells
        h[i] = crease * 0.6 + pore[i] * 0.4
      }
      break
    }
    case 'bronze': {
      // Overlapping hammer dents: sum of soft radial lobes on a jittered grid.
      const lobes = 26
      const n = fbm(size, 3, 8, 'bronze-base')
      for (let i = 0; i < h.length; i++) h[i] = 0.5 + (n[i] - 0.5) * 0.3
      for (let l = 0; l < lobes; l++) {
        const cx = rand()
        const cy = rand()
        const r = 0.06 + rand() * 0.10
        const depth = 0.5 + rand() * 0.5
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const dx = fract(x / size - cx + 0.5) - 0.5
            const dy = fract(y / size - cy + 0.5) - 0.5
            const d = Math.hypot(dx, dy)
            if (d < r) {
              const t = d / r
              // Dent profile: smooth bowl.
              const bowl = 1 - t * t * (3 - 2 * t)
              h[y * size + x] = Math.min(1, h[y * size + x] + bowl * depth * 0.22)
            }
          }
        }
      }
      // Pitting specks.
      const pit = fbm(size, 2, 40, 'bronze-pit')
      for (let i = 0; i < h.length; i++) if (pit[i] > 0.72) h[i] -= (pit[i] - 0.72) * 1.6
      break
    }
    case 'steel': {
      // Grinding lines along X + speckle.
      const lines = fbm(size, 2, 48, 'steel-lines')
      const speck = fbm(size, 2, 30, 'steel-speck')
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x
          const along = Math.sin(y * 0.9 + lines[i] * 4) * 0.5 + 0.5
          h[i] = along * 0.65 + speck[i] * 0.35
        }
      }
      break
    }
    case 'stone': {
      // Coarse grain + shallow gouges crossing the field.
      const grain = fbm(size, 4, 6, 'stone-grain')
      const fine = fbm(size, 3, 26, 'stone-fine')
      for (let i = 0; i < h.length; i++) h[i] = grain[i] * 0.7 + fine[i] * 0.3
      for (let g = 0; g < 6; g++) {
        const y0 = rand() * size
        const a = (rand() - 0.5) * 0.2
        const w = 1 + rand() * 2
        for (let x = 0; x < size; x++) {
          const y = Math.round(y0 + Math.sin(x * 0.05 + g) * a * size) % size
          for (let dy2 = -w; dy2 <= w; dy2++) {
            const yy = ((Math.round(y + dy2) % size) + size) % size
            h[yy * size + x] -= 0.3 * (1 - Math.abs(dy2) / (w + 1))
          }
        }
      }
      break
    }
    case 'wood': {
      // Stretched striations (X) with two knots.
      const rings = fbm(size, 3, 4, 'wood-rings')
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x
          const stretch = Math.sin((y / size) * Math.PI * 2 * 7 + rings[i] * 5) * 0.5 + 0.5
          h[i] = stretch * 0.7 + rings[i] * 0.3
        }
      }
      for (let k = 0; k < 2; k++) {
        const cx = rand()
        const cy = rand()
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const d = Math.hypot(fract(x / size - cx + 0.5) - 0.5, (fract(y / size - cy + 0.5) - 0.5) * 2.4)
            if (d < 0.12) h[y * size + x] = Math.max(h[y * size + x], 0.9 - d * 2)
          }
        }
      }
      break
    }
    case 'skin': {
      // Very low amplitude: pores + soft tonal blotches.
      const pores = fbm(size, 3, 34, 'skin-pore')
      const tone = fbm(size, 2, 5, 'skin-tone')
      for (let i = 0; i < h.length; i++) h[i] = 0.5 + (pores[i] - 0.5) * 0.5 + (tone[i] - 0.5) * 0.25
      break
    }
    case 'hair': {
      // Directional strands along X.
      const strands = 30
      const wav = fbm(size, 2, 6, 'hair-wav')
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x
          const s = Math.abs(fract((y / size) * strands + wav[i] * 0.15) - 0.5) * 2
          h[i] = 1 - s * 0.7
        }
      }
      break
    }
    case 'clothFlat': {
      const weave = fbm(size, 2, 18, 'flat-weave')
      for (let i = 0; i < h.length; i++) h[i] = 0.5 + (weave[i] - 0.5) * 0.6
      break
    }
  }
  // Normalize each field to 0..1 so relative amplitudes stay consistent.
  let min = Infinity
  let max = -Infinity
  for (const v of h) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min || 1
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - min) / span
  return h
}

/** Precomputed fbm layers used inline by family fields (built once, sampled per pixel). */
const layerCache = new Map<string, Float32Array>()
function layerOf(size: number, seed: string, cells: number, octaves = 2, gain = 0.5): Float32Array {
  const key = `${seed}:${size}:${cells}:${octaves}`
  let layer = layerCache.get(key)
  if (!layer) {
    layer = fbm(size, octaves, cells, seed, gain)
    layerCache.set(key, layer)
  }
  return layer
}

// ---- atlas assembly ----

export type TextureAtlas = {
  /** Tangent-space normal atlas (RGBA). */
  normal: DataTexture
  /** Roughness atlas (single channel). */
  roughness: DataTexture
  /** Cell → family mapping in cell order. */
  cells: readonly TextureFamily[]
}

/** Normal-strength per family (relative height → slope multiplier). */
const NORMAL_STRENGTH: Record<TextureFamily, number> = {
  linen: 2.4,
  leather: 1.6,
  bronze: 1.8,
  steel: 1.4,
  stone: 2.2,
  wood: 1.6,
  skin: 0.8,
  hair: 1.8,
  clothFlat: 1.2,
}

/** Roughness variation depth per family (0 = flat roughness). */
const ROUGHNESS_DEPTH: Record<TextureFamily, number> = {
  linen: 0.28,
  leather: 0.22,
  bronze: 0.30,
  steel: 0.18,
  stone: 0.25,
  wood: 0.22,
  skin: 0.12,
  hair: 0.20,
  clothFlat: 0.15,
}

/** Base roughness bias per family (added on top of the material's roughness). */
const ROUGHNESS_BIAS: Record<TextureFamily, number> = {
  linen: 0.04,
  leather: 0.02,
  bronze: -0.05,
  steel: -0.06,
  stone: 0.05,
  wood: 0.02,
  skin: 0.02,
  hair: 0.03,
  clothFlat: 0.03,
}

const atlasCache = new Map<string, TextureAtlas>()

/**
 * Build (and cache) the normal + roughness atlas. `variant` keys separate
 * caches (e.g. per army if armies ever diverge).
 */
export function textureAtlas(variant = 'default'): TextureAtlas {
  const cached = atlasCache.get(variant)
  if (cached) return cached

  const size = TEX_ATLAS_CELLS * TEX_CELL
  const normalData = new Uint8Array(size * size * 4)
  const roughData = new Uint8Array(size * size)
  const cells: TextureFamily[] = []

  FAMILIES.forEach((family, cell) => {
    cells.push(family)
    const h = familyHeight(family, TEX_CELL)
    const n = heightToNormal(h, TEX_CELL, NORMAL_STRENGTH[family])
    const rand = mulberry32(hashString(`rough-${family}`))
    // Independent roughness field (a surface can be smooth where it is flat).
    const r = fbm(TEX_CELL, 3, 7, `rough-${family}`)
    const x0 = (cell % TEX_ATLAS_CELLS) * TEX_CELL
    const y0 = Math.floor(cell / TEX_ATLAS_CELLS) * TEX_CELL
    for (let y = 0; y < TEX_CELL; y++) {
      for (let x = 0; x < TEX_CELL; x++) {
        const src = y * TEX_CELL + x
        const dst = (y0 + y) * size + x0 + x
        normalData[dst * 4] = n[src * 4]
        normalData[dst * 4 + 1] = n[src * 4 + 1]
        normalData[dst * 4 + 2] = n[src * 4 + 2]
        normalData[dst * 4 + 3] = 255
        const jitter = (rand() - 0.5) * 0.06
        roughData[dst] = clamp255(
          (0.5 + (r[src] - 0.5) * ROUGHNESS_DEPTH[family] * 2 + ROUGHNESS_BIAS[family] + jitter) * 255,
        )
      }
    }
  })

  const normal = new DataTexture(normalData, size, size, RGBAFormat)
  normal.colorSpace = SRGBColorSpace
  normal.wrapS = RepeatWrapping
  normal.wrapT = RepeatWrapping
  normal.magFilter = LinearFilter
  normal.minFilter = LinearFilter
  normal.generateMipmaps = true
  normal.needsUpdate = true

  const roughness = new DataTexture(roughData, size, size, RedFormat)
  roughness.wrapS = RepeatWrapping
  roughness.wrapT = RepeatWrapping
  roughness.magFilter = LinearFilter
  roughness.minFilter = LinearFilter
  roughness.generateMipmaps = true
  roughness.needsUpdate = true

  const atlas: TextureAtlas = { normal, roughness, cells }
  atlasCache.set(variant, atlas)
  return atlas
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** Dispose the cached atlas (tests). */
export function disposeAtlas(variant = 'default'): void {
  const atlas = atlasCache.get(variant)
  if (!atlas) return
  atlas.normal.dispose()
  atlas.roughness.dispose()
  atlasCache.delete(variant)
}

/** Roughness-sampler for tests: value at a pixel of the roughness atlas. */
export function roughnessAt(atlas: TextureAtlas, family: TextureFamily, x: number, y: number): number {
  const cell = cellOf(family)
  const x0 = (cell % TEX_ATLAS_CELLS) * TEX_CELL
  const y0 = Math.floor(cell / TEX_ATLAS_CELLS) * TEX_CELL
  const data = atlas.roughness.image.data as Uint8Array | null
  if (!data) throw new Error('battleground-chess: roughness atlas has no data')
  return data[(y0 + y) * TEX_ATLAS_CELLS * TEX_CELL + x0 + x] / 255
}

/** Tint helper used by battle dust when a family tint is wanted. */
export function familyTint(family: TextureFamily): Color {
  return new Color(family === 'bronze' || family === 'steel' ? '#c9a86a' : '#cdbf9f')
}
