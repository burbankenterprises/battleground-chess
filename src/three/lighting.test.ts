import { describe, expect, it } from 'vitest'
import { DirectionalLight, Vector3 } from 'three'
import {
  KEY_LIGHT_POSITION,
  SHADOW_FAR,
  SHADOW_HALF_EXTENT,
  SHADOW_MAP_SIZE,
  SHADOW_NEAR,
  SHADOW_RADIUS,
  SHADOW_SETTLE_MS,
  configureKeyShadow,
  sceneAnimating,
  shadowFrameNeeded,
} from './shadows'
import { KEY_LIGHT, SCENE_LIGHTS } from './lighting'
import { TORCHES, TORCH_POLE_HEIGHT, TORCH_RIM_Y } from './environment/arenaLayout'
import type { AnimCommand } from '../game/types'

describe('one shadow light', () => {
  it('exactly one scene light casts shadows — the warm key sun (torches never do)', () => {
    const casters = SCENE_LIGHTS.filter((l) => l.castShadow)
    expect(casters).toHaveLength(1)
    expect(casters[0]).toBe(KEY_LIGHT)
    expect(KEY_LIGHT.kind).toBe('directional')
    expect(KEY_LIGHT.position).toEqual(KEY_LIGHT_POSITION)
  })

  it('configureKeyShadow: 1024² soft PCF map with a tight orthographic camera', () => {
    const light = new DirectionalLight()
    configureKeyShadow(light)
    expect(light.castShadow).toBe(true)
    expect(light.shadow.mapSize.x).toBe(SHADOW_MAP_SIZE)
    expect(light.shadow.mapSize.y).toBe(SHADOW_MAP_SIZE)
    expect(SHADOW_MAP_SIZE).toBe(1024)
    expect(light.shadow.radius).toBe(SHADOW_RADIUS)
    expect(SHADOW_RADIUS).toBeGreaterThan(1) // soft edge
    const cam = light.shadow.camera
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([
      -SHADOW_HALF_EXTENT,
      SHADOW_HALF_EXTENT,
      SHADOW_HALF_EXTENT,
      -SHADOW_HALF_EXTENT,
    ])
    expect([cam.near, cam.far]).toEqual([SHADOW_NEAR, SHADOW_FAR])
    expect(light.shadow.bias).toBeLessThan(0)
    expect(light.shadow.normalBias).toBeGreaterThan(0)
  })

  it('the shadow camera covers the whole board and the torch stands — nothing much more', () => {
    const light = new DirectionalLight()
    light.position.set(...KEY_LIGHT_POSITION)
    light.target.position.set(0, 0, 0)
    configureKeyShadow(light)
    light.updateMatrixWorld(true)
    light.target.updateMatrixWorld(true)
    light.shadow.updateMatrices(light)
    const cam = light.shadow.camera
    const inside = (p: Vector3) => {
      const v = p.clone().applyMatrix4(cam.matrixWorldInverse)
      const depth = -v.z
      return (
        Math.abs(v.x) <= SHADOW_HALF_EXTENT &&
        Math.abs(v.y) <= SHADOW_HALF_EXTENT &&
        depth >= SHADOW_NEAR &&
        depth <= SHADOW_FAR
      )
    }
    // Plate corners (top and bottom) and a tall piece's head on every corner square.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        expect(inside(new Vector3(sx * 4.25, -0.41, sz * 4.25))).toBe(true)
        expect(inside(new Vector3(sx * 3.5, 1.3, sz * 3.5))).toBe(true)
      }
    }
    // Torch stands (base to brazier rim).
    for (const t of TORCHES) {
      expect(inside(new Vector3(t.x, TORCH_RIM_Y - TORCH_POLE_HEIGHT, t.z))).toBe(true)
      expect(inside(new Vector3(t.x, TORCH_RIM_Y, t.z))).toBe(true)
    }
    // Texel density: a 1024 map over ≤ 16 units → < 1.6 cm per texel.
    expect((2 * SHADOW_HALF_EXTENT) / SHADOW_MAP_SIZE).toBeLessThan(0.016)
  })
})

describe('on-demand shadow map', () => {
  const alarm: AnimCommand = { type: 'alarm', actorId: 'w-k', delayMs: 0, durationMs: 900, square: 'e1', loop: true }
  const fall: AnimCommand = {
    type: 'checkmate-fall',
    actorId: 'w-k',
    delayMs: 1000,
    durationMs: 800,
    square: 'e1',
    fallAwayFrom: 'h4',
  }

  it('animating while a move plays, while an alarm loops, and while a retained fall runs', () => {
    expect(sceneAnimating(true, [], 0, 99999)).toBe(true)
    expect(sceneAnimating(false, [alarm], 0, 99999)).toBe(true)
    expect(sceneAnimating(false, [fall], 0, 1500)).toBe(true)
    expect(sceneAnimating(false, [fall], 0, 1800)).toBe(false)
    expect(sceneAnimating(false, [], 0, 0)).toBe(false)
  })

  it('re-renders the shadow map only while animating and briefly after', () => {
    expect(shadowFrameNeeded(true, 0)).toBe(true)
    expect(shadowFrameNeeded(false, 0)).toBe(true)
    expect(shadowFrameNeeded(false, SHADOW_SETTLE_MS - 1)).toBe(true)
    expect(shadowFrameNeeded(false, SHADOW_SETTLE_MS)).toBe(false)
    expect(shadowFrameNeeded(false, 60000)).toBe(false)
  })
})
