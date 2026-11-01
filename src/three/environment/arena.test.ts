import { describe, expect, it } from 'vitest'
import { Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Points, PointLight, Raycaster, Vector3 } from 'three'
import type { Object3D } from 'three'
import {
  DUNE_START,
  FLAME_SWAY,
  FLICKER_DEPTH,
  FLICKER_MAX_RATE,
  FOG_NEAR,
  CAMERA_MAX_DISTANCE,
  HILL_COUNT,
  HILL_MIN_CLEARANCE,
  HILL_RING_MAX,
  HILL_RING_MIN,
  MOTE_AREA_RADIUS,
  MOTE_COUNT,
  MOTE_MAX_Y,
  MOTE_MIN_Y,
  ROCK_COUNT,
  ROCK_RING_MAX,
  ROCK_RING_MIN,
  ROCK_TORCH_CLEARANCE,
  SAND_RADIUS,
  SAND_Y,
  FOG_FAR,
  TORCHES,
  TORCH_OFFSET,
  flameSwayX,
  flameSwayZ,
  generateHills,
  generateMotes,
  generateRocks,
  sandFade,
  sandHeightAt,
  skyWeights,
  torchFlicker,
  writeMotePosition,
} from './arenaLayout'
import {
  ARENA_NAMES,
  ENV_RENDER_ORDER,
  FLAMES_PER_TORCH,
  ROCK_CONTACT_SHADE,
  SKY_RENDER_ORDER,
  buildArena,
  darkenTowardGround,
  moteSpriteData,
} from './arena'
import { BufferAttribute, BufferGeometry } from 'three'
import { countDrawCalls } from '../meshUtils'

/** Board plate half-extent (Board.tsx: 8.5-wide plate). */
const PLATE_HALF = 4.25

describe('arena layout — deterministic, off the board', () => {
  it('hills: a fixed ring on the horizon, identical every build', () => {
    const hills = generateHills()
    expect(hills).toHaveLength(HILL_COUNT)
    expect(generateHills()).toEqual(hills)
    expect(generateHills('other-seed')).not.toEqual(hills)
    for (const h of hills) {
      const r = Math.hypot(h.x, h.z)
      expect(r).toBeGreaterThanOrEqual(HILL_RING_MIN - 1e-9)
      expect(r).toBeLessThanOrEqual(HILL_RING_MAX + 1e-9)
      // Footprint always beyond the camera's reach and the fog start; low, wide domes.
      expect(r - Math.max(h.width, h.depth)).toBeGreaterThanOrEqual(HILL_MIN_CLEARANCE)
      expect(HILL_MIN_CLEARANCE).toBeGreaterThan(CAMERA_MAX_DISTANCE)
      expect(h.height).toBeLessThan(h.width)
    }
    // Spread all the way around (every 90° quadrant has hills).
    const quadrants = new Set(hills.map((h) => Math.floor(((Math.atan2(h.z, h.x) + Math.PI) / (Math.PI / 2)) % 4)))
    expect(quadrants.size).toBe(4)
  })

  it('rocks: deterministic, clear of the plate and the torch bases', () => {
    const rocks = generateRocks()
    expect(rocks).toHaveLength(ROCK_COUNT)
    expect(generateRocks()).toEqual(rocks)
    for (const r of rocks) {
      const radius = Math.hypot(r.x, r.z)
      expect(radius).toBeGreaterThanOrEqual(ROCK_RING_MIN - 1e-9)
      expect(radius).toBeLessThanOrEqual(ROCK_RING_MAX + 1e-9)
      expect(Math.max(Math.abs(r.x), Math.abs(r.z))).toBeGreaterThan(PLATE_HALF + 1)
      for (const t of TORCHES) expect(Math.hypot(t.x - r.x, t.z - r.z)).toBeGreaterThanOrEqual(ROCK_TORCH_CLEARANCE)
    }
  })

  it('torches: one just outside each board corner, each with its own flicker seed', () => {
    expect(TORCHES).toHaveLength(4)
    const corners = new Set(TORCHES.map((t) => `${Math.sign(t.x)},${Math.sign(t.z)}`))
    expect(corners.size).toBe(4)
    for (const t of TORCHES) {
      expect(Math.abs(t.x)).toBe(TORCH_OFFSET)
      expect(Math.abs(t.z)).toBe(TORCH_OFFSET)
      expect(TORCH_OFFSET).toBeGreaterThan(PLATE_HALF)
    }
    expect(new Set(TORCHES.map((t) => t.seed)).size).toBe(4)
  })

  it('sand: flat under the board and torches, gentle dunes far out, dark toward the rim', () => {
    for (const [x, z] of [
      [0, 0],
      [PLATE_HALF, PLATE_HALF],
      [TORCH_OFFSET, -TORCH_OFFSET],
      [DUNE_START * 0.7, DUNE_START * 0.7],
    ]) {
      expect(sandHeightAt(x, z)).toBe(SAND_Y)
    }
    let maxDev = 0
    for (let a = 0; a < 64; a++) {
      const r = 20 + (a % 8) * 4
      maxDev = Math.max(maxDev, Math.abs(sandHeightAt(Math.cos(a) * r, Math.sin(a) * r) - SAND_Y))
    }
    expect(maxDev).toBeGreaterThan(0.05)
    expect(maxDev).toBeLessThanOrEqual(0.45 + 1e-9)
    expect(sandFade(0)).toBe(0)
    expect(sandFade(SAND_RADIUS)).toBe(1)
    expect(sandFade(10)).toBeGreaterThan(sandFade(7))
  })

  it('sky: ember band at the horizon fading to the night zenith; weights sum to 1', () => {
    expect(skyWeights(0.001).ember).toBeGreaterThan(0.9)
    expect(skyWeights(Math.PI / 2)).toEqual({ ember: 0, dusk: 0, night: 1 })
    expect(skyWeights(-0.3).night).toBe(1)
    for (let e = -0.2; e < 1.6; e += 0.05) {
      const w = skyWeights(e)
      expect(w.ember + w.dusk + w.night).toBeCloseTo(1)
    }
  })

  it('fog never reaches the board, even at the widest zoom', () => {
    const farthestBoardPoint = Math.hypot(PLATE_HALF, PLATE_HALF)
    expect(FOG_NEAR).toBeGreaterThan(CAMERA_MAX_DISTANCE + farthestBoardPoint)
    // The hills stay inside the fog range (silhouettes, not erased).
    for (const h of generateHills()) expect(Math.hypot(h.x, h.z)).toBeLessThan(FOG_FAR)
  })
})

describe('torch flicker math', () => {
  it('stays within 1 ± FLICKER_DEPTH and actually varies', () => {
    let min = Infinity
    let max = -Infinity
    for (const t of TORCHES) {
      for (let ms = 0; ms < 20000; ms += 7) {
        const k = torchFlicker(ms, t.seed)
        min = Math.min(min, k)
        max = Math.max(max, k)
      }
    }
    expect(min).toBeGreaterThanOrEqual(1 - FLICKER_DEPTH - 1e-9)
    expect(max).toBeLessThanOrEqual(1 + FLICKER_DEPTH + 1e-9)
    expect(max - min).toBeGreaterThan(FLICKER_DEPTH)
  })

  it('is smooth — never jumps faster than FLICKER_MAX_RATE (a flame, not a strobe)', () => {
    const seed = TORCHES[0].seed
    const stepMs = 16
    for (let ms = 0; ms < 10000; ms += stepMs) {
      const delta = Math.abs(torchFlicker(ms + stepMs, seed) - torchFlicker(ms, seed))
      expect(delta).toBeLessThanOrEqual(FLICKER_MAX_RATE * (stepMs / 1000) + 1e-9)
    }
    // A 60fps step never moves brightness by more than ~8%.
    expect(FLICKER_MAX_RATE * (stepMs / 1000)).toBeLessThan(0.08)
  })

  it('is deterministic per seed and the four torches are out of phase', () => {
    const a = TORCHES[0].seed
    expect(torchFlicker(1234, a)).toBe(torchFlicker(1234, a))
    const values = TORCHES.map((t) => torchFlicker(1000, t.seed).toFixed(4))
    expect(new Set(values).size).toBe(4)
  })

  it('flame sway stays gentle', () => {
    for (let ms = 0; ms < 8000; ms += 13) {
      expect(Math.abs(flameSwayX(ms, TORCHES[1].seed))).toBeLessThanOrEqual(FLAME_SWAY + 1e-9)
      expect(Math.abs(flameSwayZ(ms, TORCHES[2].seed))).toBeLessThanOrEqual(FLAME_SWAY + 1e-9)
    }
  })
})

describe('dust motes — deterministic distribution', () => {
  it('same seed → identical field; different seed → different field', () => {
    expect(generateMotes()).toEqual(generateMotes())
    expect(generateMotes(MOTE_COUNT, 'x')).not.toEqual(generateMotes())
    expect(generateMotes()).toHaveLength(MOTE_COUNT)
  })

  it('every drifted position stays inside the mote volume at all times', () => {
    const motes = generateMotes()
    const out = new Float32Array(motes.length * 3)
    for (let s = 0; s < 120; s += 0.37) {
      motes.forEach((m, i) => writeMotePosition(m, s, out, i))
      for (let i = 0; i < motes.length; i++) {
        const x = out[i * 3]
        const y = out[i * 3 + 1]
        const z = out[i * 3 + 2]
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(MOTE_AREA_RADIUS + 1e-4)
        expect(y).toBeGreaterThanOrEqual(MOTE_MIN_Y - 1e-4)
        expect(y).toBeLessThanOrEqual(MOTE_MAX_Y + 1e-4)
      }
    }
  })

  it('spreads over the whole disc (uniform by area, not bunched at the center)', () => {
    const motes = generateMotes(2000, 'distribution')
    const inner = motes.filter((m) => Math.hypot(m.x, m.z) < (MOTE_AREA_RADIUS - 0.45) / Math.SQRT2).length
    // Half the disc's area lies inside r/√2 → about half the motes (±8%).
    expect(inner / motes.length).toBeGreaterThan(0.42)
    expect(inner / motes.length).toBeLessThan(0.58)
  })

  it('the sprite is a soft round dot (opaque center, transparent corners)', () => {
    const size = 16
    const data = moteSpriteData(size)
    const alphaAt = (x: number, y: number) => data[(y * size + x) * 4 + 3]
    expect(alphaAt(8, 8)).toBeGreaterThan(200)
    expect(alphaAt(0, 0)).toBe(0)
    expect(alphaAt(15, 15)).toBe(0)
  })
})

function meshesOf(root: Object3D): (Mesh | Points)[] {
  const out: (Mesh | Points)[] = []
  root.traverse((o) => {
    if (o instanceof Mesh || o instanceof Points) out.push(o)
  })
  return out
}

describe('arena scene graph', () => {
  it('the whole environment costs 7 draw calls (merged statics + instanced flames + points)', () => {
    const arena = buildArena()
    expect(countDrawCalls(arena.root)).toBe(7)
    for (const name of Object.values(ARENA_NAMES)) {
      if (name === ARENA_NAMES.torchLight) continue
      expect(arena.root.getObjectByName(name)).toBeDefined()
    }
    const flames = arena.root.getObjectByName(ARENA_NAMES.flames)
    expect(flames).toBeInstanceOf(InstancedMesh)
    expect((flames as InstancedMesh).count).toBe(TORCHES.length * FLAMES_PER_TORCH)
    arena.dispose()
  })

  it('rocks sit in the sand: vertex shade darkens toward the ground line', () => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, -0.4, 0, 0, -0.2, 0, 0, 0.1, 0]), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3))
    darkenTowardGround(g, -0.4, 0.4)
    const col = g.getAttribute('color')
    expect(col.getX(0)).toBeCloseTo(ROCK_CONTACT_SHADE)
    expect(col.getX(1)).toBeCloseTo(ROCK_CONTACT_SHADE + (1 - ROCK_CONTACT_SHADE) * 0.5)
    expect(col.getX(2)).toBe(1)
  })

  it('render order (fill-rate): board first, environment after it, sky dome last', () => {
    const arena = buildArena()
    expect(ENV_RENDER_ORDER).toBeGreaterThan(0) // board + pieces stay at the default 0
    expect(SKY_RENDER_ORDER).toBeGreaterThan(ENV_RENDER_ORDER)
    const sky = arena.root.getObjectByName(ARENA_NAMES.sky) as Mesh
    expect(sky.renderOrder).toBe(SKY_RENDER_ORDER)
    for (const name of [ARENA_NAMES.sand, ARENA_NAMES.hills, ARENA_NAMES.rocks, ARENA_NAMES.torchStands]) {
      const mesh = arena.root.getObjectByName(name) as Mesh
      expect(mesh.renderOrder).toBe(ENV_RENDER_ORDER)
      expect((mesh.material as MeshBasicMaterial).transparent).toBe(false)
    }
    // Flames and motes are transparent: three draws them after every opaque anyway.
    for (const name of [ARENA_NAMES.flames, ARENA_NAMES.motes]) {
      const obj = arena.root.getObjectByName(name) as Mesh
      expect((obj.material as MeshBasicMaterial).transparent).toBe(true)
    }
    arena.dispose()
  })

  it('every environment object is raycast-inert — it can never eat a tile tap', () => {
    const arena = buildArena()
    arena.root.updateMatrixWorld(true)
    const raycaster = new Raycaster()
    // Straight down through the board and the sand, and across the torches.
    const rays: [Vector3, Vector3][] = [
      [new Vector3(0, 10, 0), new Vector3(0, -1, 0)],
      [new Vector3(TORCH_OFFSET, 10, TORCH_OFFSET), new Vector3(0, -1, 0)],
      [new Vector3(0, 8, 8), new Vector3(0, -8, -8).normalize()],
      [new Vector3(-20, 0.8, -TORCH_OFFSET), new Vector3(1, 0, 0)],
    ]
    for (const [origin, dir] of rays) {
      raycaster.set(origin, dir)
      expect(raycaster.intersectObject(arena.root, true)).toEqual([])
    }
    arena.dispose()
  })

  it('shadows: only the torch stands cast; only the sand receives; torch lights never cast', () => {
    const arena = buildArena()
    const casters = meshesOf(arena.root).filter((m) => m.castShadow).map((m) => m.name)
    expect(casters).toEqual([ARENA_NAMES.torchStands])
    const receivers = meshesOf(arena.root).filter((m) => m.receiveShadow).map((m) => m.name)
    expect(receivers).toEqual([ARENA_NAMES.sand])
    const lights: PointLight[] = []
    arena.root.traverse((o) => {
      if (o instanceof PointLight) lights.push(o)
    })
    expect(lights).toHaveLength(TORCHES.length)
    for (const l of lights) expect(l.castShadow).toBe(false)
    arena.dispose()
  })

  it('update() flickers the torch lights + flames and drifts the motes', () => {
    const arena = buildArena()
    const lights: PointLight[] = []
    arena.root.traverse((o) => {
      if (o instanceof PointLight) lights.push(o)
    })
    const flames = arena.root.getObjectByName(ARENA_NAMES.flames) as InstancedMesh
    const motes = arena.root.getObjectByName(ARENA_NAMES.motes) as Points
    arena.update(1000)
    const intensities = lights.map((l) => l.intensity)
    const flameMatrix = new Matrix4()
    flames.getMatrixAt(0, flameMatrix)
    const before = flameMatrix.clone()
    const moteX = (motes.geometry.getAttribute('position').array as Float32Array)[0]
    arena.update(1250)
    expect(lights.map((l) => l.intensity)).not.toEqual(intensities)
    flames.getMatrixAt(0, flameMatrix)
    expect(flameMatrix.equals(before)).toBe(false)
    expect((motes.geometry.getAttribute('position').array as Float32Array)[0]).not.toBe(moteX)
    // Flames are additive and per-instance tinted.
    expect((flames.material as MeshBasicMaterial).depthWrite).toBe(false)
    const c = new Color()
    flames.getColorAt(0, c)
    expect(c.r).toBeGreaterThan(c.b)
    arena.dispose()
  })
})
