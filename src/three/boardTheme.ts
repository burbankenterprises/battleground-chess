import type { Square } from 'chess.js'
import { Color, SRGBColorSpace } from 'three'
import { BOARD_LAYOUT } from './coords'
import type { TileLayout } from './coords'
import { hashString, mulberry32 } from './effects/shatter'

/**
 * Board theme (Phase 4): weathered stone tiles set into a sand/sandstone
 * arena. Pure data + math (no React), so the army-contrast rule is unit-tested
 * in boardTheme.test.ts.
 *
 * Both stones stay mid-tone on purpose: the light army (Israelites) reads
 * lighter than the lightest light tile and the dark army (Philistines) darker
 * than the darkest dark tile, so army contrast holds on every square
 * (asserted in perceptual CIE L* units in boardTheme.test.ts).
 */

/** Warm limestone (light squares). */
export const TILE_LIGHT = '#a39a88'
/** Worn basalt (dark squares). */
export const TILE_DARK = '#67625a'
/**
 * Max per-tile lightness jitter (± sRGB HSL lightness, 0..1): breaks the flat
 * CG look into individually weathered slabs. The two stones are ~22 L* apart,
 * so even opposite weathering extremes stay more than 15 L* apart and a
 * square's color is never ambiguous.
 */
export const TILE_WEATHER_JITTER = 0.03
/** Sand/sandstone arena plate the stone tiles are set into. */
export const ARENA_PLATE_COLOR = '#76664d'

/**
 * Deterministic per-square tile color: the base stone with its lightness
 * jittered by a hash of the square. The jitter is applied in sRGB HSL so it is
 * perceptually even on light and dark stone alike.
 */
export function weatheredTileColor({ square, light }: TileLayout): string {
  // FNV-1a alone barely moves its high bits for the LAST character (the rank),
  // which would weather whole files alike (stripes); one PRNG step mixes it.
  const unit = mulberry32(hashString(`tile:${square}`))() * 2 - 1 // [-1, 1)
  const color = new Color(light ? TILE_LIGHT : TILE_DARK)
  const hsl = { h: 0, s: 0, l: 0 }
  color.getHSL(hsl, SRGBColorSpace)
  color.setHSL(hsl.h, hsl.s, hsl.l + unit * TILE_WEATHER_JITTER, SRGBColorSpace)
  return color.getStyle()
}

/** Static per-square tile colors, computed once (the layout never changes). */
export const TILE_COLORS: ReadonlyMap<Square, string> = new Map(
  BOARD_LAYOUT.map((tile) => [tile.square, weatheredTileColor(tile)]),
)
