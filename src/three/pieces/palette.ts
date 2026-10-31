import type { Color } from 'chess.js'

/**
 * Per-army placeholder material palette — clear light-vs-dark contrast on a
 * dark board. Shared by the placeholder pieces and the battle effects (shards
 * and dust are tinted like the piece that produced them).
 */
export const ARMY_PALETTE: Record<
  Color,
  { color: string; metalness: number; roughness: number; emissive: string }
> = {
  w: { color: '#ece0c8', metalness: 0.12, roughness: 0.55, emissive: '#000000' },
  b: { color: '#363b45', metalness: 0.3, roughness: 0.45, emissive: '#0b0d12' },
}

/** Sandy tone dust is blended toward so dark-army dust still reads on the board. */
export const DUST_TINT = '#cdbf9f'
/** How far (0..1) dust is blended from the army color toward DUST_TINT. */
export const DUST_TINT_MIX = 0.35
