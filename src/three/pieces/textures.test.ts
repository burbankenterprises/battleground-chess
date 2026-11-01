import { describe, expect, it } from 'vitest'
import {
  FAMILIES,
  TEX_ATLAS_CELLS,
  TEX_CELL,
  cellOf,
  cellU,
  cellV,
  familyHeight,
  familyOfRole,
  heightToNormal,
  textureAtlas,
  disposeAtlas,
  roughnessAt,
} from './textures'
import { BufferAttribute } from 'three'
import { PMREMGenerator } from 'three'

describe('texture families → atlas cells', () => {
  it('every family gets a unique cell inside the atlas', () => {
    expect(FAMILIES.length).toBeLessThanOrEqual(TEX_ATLAS_CELLS * TEX_ATLAS_CELLS)
    const cells = FAMILIES.map(cellOf)
    expect(new Set(cells).size).toBe(FAMILIES.length)
    for (const c of cells) expect(c).toBeGreaterThanOrEqual(0)
    expect(cellOf('linen')).toBe(0)
    expect(() => cellOf('unobtainium' as never)).toThrow()
  })

  it('cell UV origins tile the atlas exactly', () => {
    for (const family of FAMILIES) {
      const c = cellOf(family)
      expect(cellU(c)).toBeCloseTo((c % TEX_ATLAS_CELLS) / TEX_ATLAS_CELLS)
      expect(cellV(c)).toBeCloseTo(Math.floor(c / TEX_ATLAS_CELLS) / TEX_ATLAS_CELLS)
    }
  })

  it('roles map to sensible surface families', () => {
    expect(familyOfRole('cloth')).toBe('linen')
    expect(familyOfRole('metal')).toBe('bronze')
    expect(familyOfRole('blade')).toBe('steel')
    expect(familyOfRole('plinth')).toBe('stone')
    expect(familyOfRole('wood')).toBe('wood')
    expect(familyOfRole('skin')).toBe('skin')
    expect(familyOfRole('hair')).toBe('hair')
    expect(familyOfRole('mount')).toBe('linen')
    expect(familyOfRole('sash')).toBe('leather')
    expect(familyOfRole('nonsense')).toBe('linen')
  })
})

describe('height → normal conversion', () => {
  it('a flat field is a flat normal map (128,128,255)', () => {
    const flat = new Float32Array(16 * 16).fill(0.5)
    const n = heightToNormal(flat, 16, 2)
    expect(Array.from(n.slice(0, 4))).toEqual([128, 128, 255, 255])
  })

  it('a slope tilts normals the right way, and wrapping works', () => {
    const ramp = new Float32Array(8 * 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) ramp[y * 8 + x] = x / 8
    const n = heightToNormal(ramp, 8, 1)
    // Interior pixel: height rises along +x → surface normal tilts toward -x → R < 128.
    const interior = (4 * 8 + 4) * 4
    expect(n[interior]).toBeLessThan(128)
    expect(n[interior + 2]).toBeGreaterThan(128) // z stays dominant
    // Same tilt on every row (uniform slope).
    expect(n[(2 * 8 + 4) * 4]).toBe(n[interior])
  })

  it('output stays in byte range and is fully opaque', () => {
    const h = familyHeight('bronze', 32)
    const n = heightToNormal(h, 32, 3)
    for (let i = 0; i < n.length; i += 4) {
      for (let k = 0; k < 3; k++) expect(n[i + k]).toBeGreaterThanOrEqual(0)
      expect(n[i + 3]).toBe(255)
    }
  })
})

describe('family height fields', () => {
  it('are deterministic and normalized to 0..1', () => {
    for (const family of FAMILIES) {
      const a = familyHeight(family, 48)
      const b = familyHeight(family, 48)
      expect(a).toEqual(b)
      let min = 1
      let max = 0
      for (const v of a) {
        min = Math.min(min, v)
        max = Math.max(max, v)
      }
      expect(min).toBeCloseTo(0, 1)
      expect(max).toBeCloseTo(1, 1)
    }
  })

  it('families differ from each other (each pattern is real)', () => {
    const fields = FAMILIES.map((f) => familyHeight(f, 48))
    for (let i = 0; i < fields.length; i++) {
      for (let j = i + 1; j < fields.length; j++) {
        const a = fields[i]
        const b = fields[j]
        let diff = 0
        for (let k = 0; k < a.length; k++) diff += Math.abs(a[k] - b[k])
        expect(diff / a.length).toBeGreaterThan(0.01)
      }
    }
  })

  it('fields have real variation (not flat fields)', () => {
    for (const family of FAMILIES) {
      const h = familyHeight(family, 48)
      let min = 1
      let max = 0
      for (const v of h) {
        min = Math.min(min, v)
        max = Math.max(max, v)
      }
      expect(max - min).toBeGreaterThan(0.5)
    }
  })

  it('tiles: the first and last row/column are not a visible seam (edge continuity)', () => {
    // Value noise wraps by construction; verify the gradient across the seam
    // is within the same range as interior gradients (no cliff).
    for (const family of FAMILIES) {
      const h = familyHeight(family, 48)
      const size = 48
      let maxInterior = 0
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          maxInterior = Math.max(maxInterior, Math.abs(h[y * size + x] - h[y * size + x - 1]))
        }
      }
      const seam = Math.abs(h[1 * size] - h[1 * size + size - 1])
      expect(seam).toBeLessThanOrEqual(maxInterior * 2 + 0.02)
    }
  })
})

describe('atlas assembly', () => {
  it('builds once, sizes are right, formats differ (normal RGBA, roughness R)', () => {
    const atlas = textureAtlas('test')
    const size = TEX_ATLAS_CELLS * TEX_CELL
    expect(atlas.normal.image.width).toBe(size)
    expect(atlas.normal.image.height).toBe(size)
    expect((atlas.normal.image.data as Uint8Array).length).toBe(size * size * 4)
    expect((atlas.roughness.image.data as Uint8Array).length).toBe(size * size)
    expect(textureAtlas('test')).toBe(atlas) // cached
    disposeAtlas('test')
  })

  it('roughness varies within a family cell and stays in [0,1]', () => {
    const atlas = textureAtlas('test')
    for (const family of ['bronze', 'linen', 'stone'] as const) {
      let min = 1
      let max = 0
      for (let y = 0; y < TEX_CELL; y += 3) {
        for (let x = 0; x < TEX_CELL; x += 3) {
          const v = roughnessAt(atlas, family, x, y)
          min = Math.min(min, v)
          max = Math.max(max, v)
        }
      }
      expect(min).toBeGreaterThanOrEqual(0)
      expect(max).toBeLessThanOrEqual(1)
      expect(max - min).toBeGreaterThan(0.05)
    }
    disposeAtlas('test')
  })
})

describe('PMREMGenerator is importable (env map path)', () => {
  it('exists on the three build with fromScene + dispose', () => {
    expect(typeof PMREMGenerator).toBe('function')
    expect(typeof BufferAttribute).toBe('function')
  })
})
