import { describe, expect, it } from 'vitest'
import { Color, SRGBColorSpace } from 'three'
import { BOARD_LAYOUT } from './coords'
import type { TileLayout } from './coords'
import {
  TILE_COLORS,
  TILE_DARK,
  TILE_LIGHT,
  TILE_WEATHER_JITTER,
  weatheredTileColor,
} from './boardTheme'
import { ARMY_PALETTE } from './pieces/palette'

/**
 * Board theme (Phase 4): weathered stone must keep the light/dark squares
 * unambiguous AND keep both armies readable on every square (Jon's standing
 * rule — w light, b dark, clear contrast on the board).
 *
 * Contrast is measured in CIE L* (perceptual lightness, 0..100): HSL
 * lightness badly overstates how light a saturated color looks (deep crimson
 * has the HSL lightness of a mid-gray), so it is the wrong yardstick here.
 */

/** sRGB HSL lightness (0..1) of a CSS color — the space the weathering jitter is defined in. */
function hslLightness(css: string): number {
  const hsl = { h: 0, s: 0, l: 0 }
  new Color(css).getHSL(hsl, SRGBColorSpace)
  return hsl.l
}

/** CIE L* (0..100) of a CSS color, from its relative luminance. */
function lStar(css: string): number {
  const c = new Color(css) // three stores linear-sRGB components
  const y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (y * 24389) / 27
}

/** Rounding allowance: tile colors are quantized to 8-bit sRGB by getStyle(). */
const QUANTIZATION = 0.005
/** Design threshold: the darkest light tile vs the lightest dark tile (L* units). */
const MIN_SQUARE_DELTA_L = 12
/** Design threshold: each army's dominant tone vs every tile it can stand on (L* units). */
const MIN_ARMY_TILE_DELTA_L = 15

const isLight = (t: TileLayout) => t.light
const tileL = (t: TileLayout) => lStar(TILE_COLORS.get(t.square)!)

describe('board theme — weathered stone', () => {
  it('colors all 64 squares deterministically, never drifting past the documented jitter', () => {
    expect(TILE_COLORS.size).toBe(64)
    for (const tile of BOARD_LAYOUT) {
      const color = TILE_COLORS.get(tile.square)!
      expect(weatheredTileColor(tile)).toBe(color)
      const base = hslLightness(tile.light ? TILE_LIGHT : TILE_DARK)
      expect(Math.abs(hslLightness(color) - base)).toBeLessThanOrEqual(TILE_WEATHER_JITTER + QUANTIZATION)
    }
  })

  it('weathering is visible and per slab — never uniform along a file or a rank (no stripes)', () => {
    for (const light of [true, false]) {
      const stone = BOARD_LAYOUT.filter((t) => t.light === light)
      const ls = stone.map((t) => hslLightness(TILE_COLORS.get(t.square)!))
      // The jitter is actually used: at least half of its full ± range shows up.
      expect(Math.max(...ls) - Math.min(...ls)).toBeGreaterThanOrEqual(TILE_WEATHER_JITTER)
      for (let i = 0; i < 8; i++) {
        const file = 'abcdefgh'[i]
        const rank = String(i + 1)
        const inFile = new Set(stone.filter((t) => t.square[0] === file).map((t) => TILE_COLORS.get(t.square)))
        const inRank = new Set(stone.filter((t) => t.square[1] === rank).map((t) => TILE_COLORS.get(t.square)))
        expect(inFile.size, `file ${file} (${light ? 'light' : 'dark'})`).toBeGreaterThan(1)
        expect(inRank.size, `rank ${rank} (${light ? 'light' : 'dark'})`).toBeGreaterThan(1)
      }
    }
  })

  it('light and dark squares stay unambiguous despite the weathering', () => {
    const darkestLight = Math.min(...BOARD_LAYOUT.filter(isLight).map(tileL))
    const lightestDark = Math.max(...BOARD_LAYOUT.filter((t) => !isLight(t)).map(tileL))
    expect(darkestLight - lightestDark).toBeGreaterThanOrEqual(MIN_SQUARE_DELTA_L)
  })

  it('the light army reads lighter than every tile, the dark army darker than every tile', () => {
    const tiles = BOARD_LAYOUT.map(tileL)
    expect(lStar(ARMY_PALETTE.w.color) - Math.max(...tiles)).toBeGreaterThanOrEqual(MIN_ARMY_TILE_DELTA_L)
    expect(Math.min(...tiles) - lStar(ARMY_PALETTE.b.color)).toBeGreaterThanOrEqual(MIN_ARMY_TILE_DELTA_L)
  })
})
