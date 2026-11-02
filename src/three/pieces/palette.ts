import type { Color } from 'chess.js'

/**
 * Army color palettes.
 *
 * Army mapping (standing rule): w = Israelites, kept LIGHT-toned overall
 * (linen white with tekhelet-blue and gold accents); b = Philistines, kept
 * DARK-toned overall (deep crimson with bronze). The light-vs-dark split is
 * what keeps the two armies apart on the mid-tone stone board, so the
 * dominant tones below must stay clearly light (w) / clearly dark (b).
 */

/**
 * Each army's dominant body tone as a single material. Used by the battle
 * effects: shatter shards and dust are tinted like the piece that produced
 * them (see BattleEffects), so this tracks the models' dominant garment color.
 */
export const ARMY_PALETTE: Record<
  Color,
  { color: string; metalness: number; roughness: number; emissive: string }
> = {
  // Israelite linen — the dominant robe/tunic tone of the light army.
  w: { color: '#efe7d6', metalness: 0, roughness: 0.8, emissive: '#000000' },
  // Philistine deep crimson — the dominant garment tone of the dark army. Kept
  // this deep so it reads darker than even the darkest weathered stone tile
  // (perceptual check in boardTheme.test.ts).
  b: { color: '#6a1721', metalness: 0, roughness: 0.75, emissive: '#0b0d12' },
}

/** Sandy tone dust is blended toward so dark-army dust still reads on the board. */
export const DUST_TINT = '#cdbf9f'
/** How far (0..1) dust is blended from the army color toward DUST_TINT. */
export const DUST_TINT_MIX = 0.35

/**
 * Semantic material roles the procedural models paint with. One palette per
 * army: every model of an army uses only that army's colors for these roles.
 *
 * - cloth:  dominant garments (robes, tunics, kilts, the chariot cab)
 * - sash:   garment trim — belts, sashes, headbands, corselet bands
 * - accent: the army's signature color — base bands, saddle cloths, banners, the king's dais carpet
 * - metal:  helmets, crowns, shields, finials, trims
 * - blade:  sword blades and spear heads
 * - wood:   shafts, staffs, wheels, sling
 * - throne: the king's throne (ivory for Israel — 1 Kings 10:18 — dark cedar for Philistia)
 * - skin, hair
 * - plinth: the round base every figure stands on (its rim is the topple edge)
 * - mount:  horse coat
 */
export type ArmyRole =
  | 'cloth'
  | 'sash'
  | 'accent'
  | 'metal'
  | 'blade'
  | 'wood'
  | 'throne'
  | 'skin'
  | 'hair'
  | 'plinth'
  | 'mount'

export type MaterialSpec = { color: string; metalness: number; roughness: number }

/** Skin is shared by both armies — the army split is carried by clothing, armor and bases only. */
const SKIN: MaterialSpec = { color: '#c8956a', metalness: 0, roughness: 0.7 }

/**
 * Per-army model palettes. Metalness stays moderate on purpose: the scene has
 * no environment map (fully offline), and highly metallic surfaces with
 * nothing to reflect render nearly black — gold would read as brown.
 */
export const ARMY_THEME: Record<Color, Record<ArmyRole, MaterialSpec>> = {
  // Israelites: linen white, tekhelet blue, gold.
  w: {
    cloth: { color: ARMY_PALETTE.w.color, metalness: 0, roughness: 0.8 },
    sash: { color: '#2e64b8', metalness: 0, roughness: 0.7 },
    accent: { color: '#2e64b8', metalness: 0, roughness: 0.7 },
    metal: { color: '#dcb24c', metalness: 0.35, roughness: 0.4 },
    blade: { color: '#d6dbe0', metalness: 0.35, roughness: 0.3 },
    wood: { color: '#b48c5e', metalness: 0, roughness: 0.75 },
    throne: { color: '#e9dfc7', metalness: 0, roughness: 0.6 },
    skin: SKIN,
    hair: { color: '#4a3222', metalness: 0, roughness: 0.85 },
    plinth: { color: '#d9cfb8', metalness: 0, roughness: 0.85 },
    mount: { color: '#e2dccf', metalness: 0, roughness: 0.8 },
  },
  // Philistines: deep crimson, bronze, iron, dark basalt.
  b: {
    cloth: { color: ARMY_PALETTE.b.color, metalness: 0, roughness: 0.75 },
    sash: { color: '#b07c42', metalness: 0.55, roughness: 0.38 },
    accent: { color: '#a32230', metalness: 0, roughness: 0.7 },
    metal: { color: '#b07c42', metalness: 0.55, roughness: 0.38 },
    blade: { color: '#787c84', metalness: 0.5, roughness: 0.42 },
    wood: { color: '#6b4a35', metalness: 0, roughness: 0.75 },
    throne: { color: '#5a4636', metalness: 0, roughness: 0.65 },
    skin: SKIN,
    hair: { color: '#3a2e26', metalness: 0, roughness: 0.85 },
    plinth: { color: '#4a3d38', metalness: 0.05, roughness: 0.8 },
    mount: { color: '#5e4433', metalness: 0, roughness: 0.75 },
  },
}
