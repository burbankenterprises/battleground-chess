import { KEY_LIGHT_POSITION } from './shadows'

/**
 * Scene lighting (Phase 5): a torchlit evening battlefield, not daylight.
 *
 *   hemisphere  dusky violet sky over dark sand — the soft fill
 *   ambient     a little lift so the dark army never sinks into the night
 *   key         warm low evening sun — the ONLY shadow caster (shadows.ts)
 *   rim         cool moonlit back light so silhouettes separate from the sand
 *
 * plus the four corner torches (environment/arena.ts: warm, flickering point
 * lights that never cast shadows). Pure data, so the one-shadow-light
 * contract is unit-tested (lighting.test.ts).
 */

export type Vec3 = readonly [number, number, number]

export type SceneLightSpec =
  | { name: 'hemisphere'; kind: 'hemisphere'; color: string; groundColor: string; intensity: number; castShadow: false }
  | { name: 'ambient'; kind: 'ambient'; color: string; intensity: number; castShadow: false }
  | { name: 'key'; kind: 'directional'; color: string; intensity: number; position: Vec3; castShadow: true }
  | { name: 'rim'; kind: 'directional'; color: string; intensity: number; position: Vec3; castShadow: false }

export const HEMISPHERE_LIGHT = {
  name: 'hemisphere',
  kind: 'hemisphere',
  color: '#a89fb4',
  groundColor: '#1b130c',
  intensity: 0.5,
  castShadow: false,
} as const satisfies SceneLightSpec

export const AMBIENT_LIGHT = {
  name: 'ambient',
  kind: 'ambient',
  color: '#ffffff',
  intensity: 0.18,
  castShadow: false,
} as const satisfies SceneLightSpec

export const KEY_LIGHT = {
  name: 'key',
  kind: 'directional',
  color: '#ffd2a1',
  intensity: 1.35,
  position: KEY_LIGHT_POSITION,
  castShadow: true,
} as const satisfies SceneLightSpec

export const RIM_LIGHT = {
  name: 'rim',
  kind: 'directional',
  color: '#8fa8e8',
  intensity: 0.55,
  position: [-6, 7, -6],
  castShadow: false,
} as const satisfies SceneLightSpec

/** Every scene-level light (the arena adds the four non-shadow torch lights). */
export const SCENE_LIGHTS: readonly SceneLightSpec[] = [HEMISPHERE_LIGHT, AMBIENT_LIGHT, KEY_LIGHT, RIM_LIGHT]
