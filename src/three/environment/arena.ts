import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DodecahedronGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PointLight,
  Points,
  PointsMaterial,
  SphereGeometry,
} from 'three'
import { NO_RAYCAST, disposeTree, mergeOrThrow, paintVertices, setInstance } from '../meshUtils'
import { hashString, mulberry32 } from '../effects/shatter'
import {
  FLAME_INNER_HEIGHT,
  FLAME_INNER_RADIUS,
  FLAME_OUTER_HEIGHT,
  FLAME_OUTER_RADIUS,
  HILL_COLOR,
  MOTE_COLOR,
  MOTE_COUNT,
  MOTE_OPACITY,
  MOTE_SIZE,
  ROCK_COLOR,
  SAND_FAR,
  SAND_NEAR,
  SAND_RADIUS,
  SAND_SPECKLE,
  SAND_Y,
  SCENE_BACKGROUND,
  SKY_DUSK,
  SKY_EMBER,
  SKY_RADIUS,
  TORCHES,
  TORCH_BOWL_BOTTOM_R,
  TORCH_BOWL_HEIGHT,
  TORCH_BOWL_TOP_R,
  TORCH_LIGHT_COLOR,
  TORCH_LIGHT_DECAY,
  TORCH_LIGHT_DISTANCE,
  TORCH_LIGHT_INTENSITY,
  TORCH_LIGHT_LIFT,
  TORCH_POLE_HEIGHT,
  TORCH_POLE_RADIUS,
  TORCH_RIM_Y,
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
import type { Mote } from './arenaLayout'

/**
 * Arena (Phase 5): the torchlit desert battlefield around the board, built
 * from three primitives only (no assets). Draw-call budget — 7 in the color
 * pass for the whole environment:
 *
 *   sky dome      1 mesh   (night zenith → ember horizon band, unlit, unfogged)
 *   sand floor    1 mesh   (polar grid, vertex-colored, flat near the board, dunes further out)
 *   hills         1 mesh   (18 low-poly domes merged)
 *   rocks         1 mesh   (16 dodecahedra merged)
 *   torch stands  1 mesh   (4 × base + pole + brazier merged; the only env shadow caster)
 *   flames        1 draw   (InstancedMesh: outer + inner tongue per torch, flicker per frame)
 *   dust motes    1 draw   (Points, drifting per frame)
 *
 * plus four warm PointLights (no shadows — the key sun is the only shadow
 * light). Every mesh is raycast-disabled so the environment can never eat a
 * tile tap. `update(timeMs)` animates flames, torch lights and motes without
 * allocating.
 */

export type Arena = {
  root: Group
  /** Advance the flicker + mote drift to `timeMs` (performance.now() clock). Allocation-free. */
  update: (timeMs: number) => void
  /** Release every geometry, material and texture the arena owns. */
  dispose: () => void
}

/** Object names (tests + debugging). */
export const ARENA_NAMES = {
  sky: 'arena-sky',
  sand: 'arena-sand',
  hills: 'arena-hills',
  rocks: 'arena-rocks',
  torchStands: 'arena-torch-stands',
  flames: 'arena-flames',
  torchLight: 'arena-torch-light',
  motes: 'arena-motes',
} as const

/** Flame tongues per torch (outer + inner). */
export const FLAMES_PER_TORCH = 2

/**
 * Opaque draw order (fill-rate): three sorts opaques by renderOrder, then by
 * material id — NOT front to back — so without this the sky dome and the
 * sand would be shaded under the whole board and then overdrawn. The board
 * and pieces draw first (renderOrder 0), the environment after them (early
 * depth test rejects the sand hidden under the plate and pieces), and the sky
 * dome last, so it only shades the pixels nothing else covers (none at all
 * from the default camera). Transparent flames / motes still draw after every
 * opaque. No visual change.
 */
export const ENV_RENDER_ORDER = 1
export const SKY_RENDER_ORDER = 2

const FLAME_OUTER_COLOR = new Color('#ff6a1c')
const FLAME_INNER_COLOR = new Color('#ffd27a')
const TORCH_WOOD = '#3b2a1d'
const TORCH_BRONZE = '#8a5a2b'
const TORCH_BASE = '#5a4a3a'
/** The flames sink this far into the brazier so the tongue never floats above the rim. */
const FLAME_SINK = 0.04

// ---- sky ----

function buildSky(): Mesh {
  const geometry = new SphereGeometry(SKY_RADIUS, 32, 16)
  geometry.deleteAttribute('uv')
  const pos = geometry.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const ember = new Color(SKY_EMBER)
  const dusk = new Color(SKY_DUSK)
  const night = new Color(SCENE_BACKGROUND)
  const c = new Color()
  for (let i = 0; i < pos.count; i++) {
    const elevation = Math.asin(Math.max(-1, Math.min(1, pos.getY(i) / SKY_RADIUS)))
    const w = skyWeights(elevation)
    c.setRGB(
      ember.r * w.ember + dusk.r * w.dusk + night.r * w.night,
      ember.g * w.ember + dusk.g * w.dusk + night.g * w.night,
      ember.b * w.ember + dusk.b * w.dusk + night.b * w.night,
    )
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  const material = new MeshBasicMaterial({
    vertexColors: true,
    side: BackSide,
    fog: false,
    depthWrite: false,
  })
  const sky = new Mesh(geometry, material)
  sky.name = ARENA_NAMES.sky
  sky.raycast = NO_RAYCAST
  // Last opaque: depth-tested against the scene, so only uncovered pixels shade it.
  // (At radius SKY_RADIUS it is farther than everything else, so it never occludes.)
  sky.renderOrder = SKY_RENDER_ORDER
  return sky
}

// ---- sand ----

/** Ring radii of the sand's polar grid: dense where the camera looks, sparse in the fogged distance. */
export const SAND_RINGS: readonly number[] = [
  0, 2, 4, 5, 5.5, 6, 6.75, 7.5, 8.5, 9.5, 11, 12.5, 14.5, 17, 20, 24, 29, 35, 42, 50, SAND_RADIUS,
]
export const SAND_SEGMENTS = 64

function buildSand(): Mesh {
  const rings = SAND_RINGS.length
  const vertexCount = 1 + (rings - 1) * SAND_SEGMENTS
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const near = new Color(SAND_NEAR)
  const far = new Color(SAND_FAR)
  const c = new Color()
  const rand = mulberry32(hashString('arena-sand'))

  const write = (i: number, x: number, z: number, r: number) => {
    positions[i * 3] = x
    positions[i * 3 + 1] = sandHeightAt(x, z)
    positions[i * 3 + 2] = z
    const speckle = 1 + (rand() * 2 - 1) * SAND_SPECKLE
    c.copy(near).lerp(far, sandFade(r)).multiplyScalar(speckle)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  write(0, 0, 0, 0)
  for (let ring = 1; ring < rings; ring++) {
    const r = SAND_RINGS[ring]
    for (let s = 0; s < SAND_SEGMENTS; s++) {
      // Alternate rings are rotated half a segment so the grid never shows straight spokes.
      const a = ((s + (ring % 2) * 0.5) / SAND_SEGMENTS) * Math.PI * 2
      write(1 + (ring - 1) * SAND_SEGMENTS + s, Math.cos(a) * r, Math.sin(a) * r, r)
    }
  }

  const indices: number[] = []
  // Center fan.
  for (let s = 0; s < SAND_SEGMENTS; s++) {
    indices.push(0, 1 + ((s + 1) % SAND_SEGMENTS), 1 + s)
  }
  // Ring strips (wound so the faces point up: +y normal).
  for (let ring = 1; ring < rings - 1; ring++) {
    const inner = 1 + (ring - 1) * SAND_SEGMENTS
    const outer = 1 + ring * SAND_SEGMENTS
    for (let s = 0; s < SAND_SEGMENTS; s++) {
      const s1 = (s + 1) % SAND_SEGMENTS
      indices.push(inner + s, inner + s1, outer + s)
      indices.push(inner + s1, outer + s1, outer + s)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const material = new MeshLambertMaterial({ vertexColors: true })
  const sand = new Mesh(geometry, material)
  sand.name = ARENA_NAMES.sand
  sand.raycast = NO_RAYCAST
  sand.receiveShadow = true
  sand.renderOrder = ENV_RENDER_ORDER
  return sand
}

// ---- hills ----

/** Deterministic ±1 jitter keyed by a quantized position, so duplicated seam vertices move together. */
function positionJitter(x: number, y: number, z: number, salt: string): number {
  const key = `${salt}:${Math.round(x * 1000)}:${Math.round(y * 1000)}:${Math.round(z * 1000)}`
  return mulberry32(hashString(key))() * 2 - 1
}

function buildHills(): Mesh {
  const base = new Color(HILL_COLOR)
  const parts = generateHills().map((h, i) => {
    // Upper hemisphere: 7 × 3 segments — a faceted dome.
    const g = new SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2)
    g.deleteAttribute('uv')
    const pos = g.getAttribute('position')
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v)
      const y = pos.getY(v)
      const z = pos.getZ(v)
      const j = positionJitter(x, y, z, `hill${i}`)
      // Lumpy flanks; the rim stays on the ground (y = 0) so no hill floats.
      const k = y > 1e-6 ? 1 + 0.18 * j : 1
      pos.setXYZ(v, x * k, y * (1 + 0.12 * j), z * k)
    }
    g.scale(h.width, h.height, h.depth)
    g.rotateY(h.yaw)
    // Sunk a little so the dome's rim is buried in the sand.
    g.translate(h.x, SAND_Y - 0.25, h.z)
    return paintVertices(g, base.clone().multiplyScalar(h.shade))
  })
  const geometry = mergeOrThrow(parts, 'hills')
  for (const p of parts) p.dispose()
  geometry.computeBoundingSphere()
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true })
  const hills = new Mesh(geometry, material)
  hills.name = ARENA_NAMES.hills
  hills.raycast = NO_RAYCAST
  hills.renderOrder = ENV_RENDER_ORDER
  return hills
}

// ---- rocks ----

/** Vertex shade at the sand line (fake contact occlusion: rocks sit IN the sand, not on it). */
export const ROCK_CONTACT_SHADE = 0.45

/** Darkens vertex colors toward `groundY`, reaching full brightness `span` above it. */
export function darkenTowardGround(geometry: BufferGeometry, groundY: number, span: number): void {
  const pos = geometry.getAttribute('position')
  const col = geometry.getAttribute('color')
  for (let v = 0; v < pos.count; v++) {
    const t = Math.min(1, Math.max(0, (pos.getY(v) - groundY) / span))
    const k = ROCK_CONTACT_SHADE + (1 - ROCK_CONTACT_SHADE) * t
    col.setXYZ(v, col.getX(v) * k, col.getY(v) * k, col.getZ(v) * k)
  }
}

function buildRocks(): Mesh {
  const base = new Color(ROCK_COLOR)
  const parts = generateRocks().map((r) => {
    const g = new DodecahedronGeometry(1, 0)
    g.deleteAttribute('uv')
    g.scale(r.size * r.squash[0], r.size * r.squash[1], r.size * r.squash[2])
    g.rotateX(r.rot[0])
    g.rotateY(r.rot[1])
    g.rotateZ(r.rot[2])
    // Half-buried in the sand.
    const ground = sandHeightAt(r.x, r.z)
    const halfHeight = r.size * r.squash[1]
    g.translate(r.x, ground + halfHeight * 0.25, r.z)
    paintVertices(g, base.clone().multiplyScalar(r.shade))
    darkenTowardGround(g, ground, halfHeight * 1.25)
    return g
  })
  const geometry = mergeOrThrow(parts, 'rocks')
  for (const p of parts) p.dispose()
  geometry.computeBoundingSphere()
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true })
  const rocks = new Mesh(geometry, material)
  rocks.name = ARENA_NAMES.rocks
  rocks.raycast = NO_RAYCAST
  rocks.renderOrder = ENV_RENDER_ORDER
  return rocks
}

// ---- torches ----

function buildTorchStands(): Mesh {
  const wood = new Color(TORCH_WOOD)
  const bronze = new Color(TORCH_BRONZE)
  const stone = new Color(TORCH_BASE)
  const parts: BufferGeometry[] = []
  for (const t of TORCHES) {
    const footing = new CylinderGeometry(0.17, 0.22, 0.12, 7)
    footing.translate(t.x, SAND_Y + 0.06, t.z)
    parts.push(paintVertices(footing, stone))
    const pole = new CylinderGeometry(TORCH_POLE_RADIUS * 0.8, TORCH_POLE_RADIUS, TORCH_POLE_HEIGHT, 6)
    pole.translate(t.x, SAND_Y + TORCH_POLE_HEIGHT / 2, t.z)
    parts.push(paintVertices(pole, wood))
    const bowl = new CylinderGeometry(TORCH_BOWL_TOP_R, TORCH_BOWL_BOTTOM_R, TORCH_BOWL_HEIGHT, 8)
    bowl.translate(t.x, SAND_Y + TORCH_POLE_HEIGHT + TORCH_BOWL_HEIGHT / 2, t.z)
    parts.push(paintVertices(bowl, bronze))
  }
  for (const p of parts) p.deleteAttribute('uv')
  const geometry = mergeOrThrow(parts, 'torch stands')
  for (const p of parts) p.dispose()
  geometry.computeBoundingSphere()
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true })
  const stands = new Mesh(geometry, material)
  stands.name = ARENA_NAMES.torchStands
  stands.raycast = NO_RAYCAST
  stands.renderOrder = ENV_RENDER_ORDER
  // The only environment shadow caster: long pole shadows across the sand.
  stands.castShadow = true
  return stands
}

function buildFlames(): InstancedMesh {
  // Unit cone, apex up, base on y = 0 (instances scale it to each tongue).
  const geometry = new ConeGeometry(1, 1, 6, 1, true)
  geometry.translate(0, 0.5, 0)
  geometry.deleteAttribute('uv')
  const material = new MeshBasicMaterial({
    color: 0xffffff, // per-instance colors carry the flame tint + flicker brightness
    transparent: true,
    opacity: 0.92,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  const flames = new InstancedMesh(geometry, material, TORCHES.length * FLAMES_PER_TORCH)
  flames.name = ARENA_NAMES.flames
  flames.raycast = NO_RAYCAST
  flames.instanceColor = new InstancedBufferAttribute(new Float32Array(flames.count * 3), 3)
  // Tiny, always near the board: skip culling (instances move every frame).
  flames.frustumCulled = false
  return flames
}

function buildTorchLights(): PointLight[] {
  return TORCHES.map((t, i) => {
    const light = new PointLight(TORCH_LIGHT_COLOR, TORCH_LIGHT_INTENSITY, TORCH_LIGHT_DISTANCE, TORCH_LIGHT_DECAY)
    light.name = `${ARENA_NAMES.torchLight}-${i}`
    light.position.set(t.x, TORCH_RIM_Y + TORCH_LIGHT_LIFT, t.z)
    light.castShadow = false
    return light
  })
}

// ---- dust motes ----

/** Soft round sprite (white, radial alpha falloff) for the dust motes — generated, not loaded. */
export function moteSpriteData(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2)
      const a = Math.max(0, 1 - d)
      const o = (y * size + x) * 4
      data[o] = 255
      data[o + 1] = 255
      data[o + 2] = 255
      data[o + 3] = Math.round(255 * a * a)
    }
  }
  return data
}

export const MOTE_SPRITE_SIZE = 32

function buildMotes(motes: readonly Mote[]): Points {
  const positions = new Float32Array(motes.length * 3)
  const colors = new Float32Array(motes.length * 3)
  const tint = new Color(MOTE_COLOR)
  motes.forEach((m, i) => {
    writeMotePosition(m, 0, positions, i)
    // Additive blending: a darker vertex color is a fainter mote.
    colors[i * 3] = tint.r * m.alpha
    colors[i * 3 + 1] = tint.g * m.alpha
    colors[i * 3 + 2] = tint.b * m.alpha
  })
  const geometry = new BufferGeometry()
  const position = new BufferAttribute(positions, 3)
  position.setUsage(DynamicDrawUsage) // rewritten every frame
  geometry.setAttribute('position', position)
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  const sprite = new DataTexture(moteSpriteData(MOTE_SPRITE_SIZE), MOTE_SPRITE_SIZE, MOTE_SPRITE_SIZE)
  // DataTexture defaults to nearest filtering — the soft falloff needs linear.
  sprite.magFilter = LinearFilter
  sprite.minFilter = LinearFilter
  sprite.needsUpdate = true
  const material = new PointsMaterial({
    size: MOTE_SIZE,
    sizeAttenuation: true,
    map: sprite,
    vertexColors: true,
    transparent: true,
    opacity: MOTE_OPACITY,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const points = new Points(geometry, material)
  points.name = ARENA_NAMES.motes
  points.raycast = NO_RAYCAST
  // Motes drift every frame around the board — never cull them.
  points.frustumCulled = false
  return points
}

// ---- assembly ----

export function buildArena(): Arena {
  const root = new Group()
  root.name = 'arena'

  root.add(buildSky(), buildSand(), buildHills(), buildRocks(), buildTorchStands())

  const flames = buildFlames()
  root.add(flames)
  const lights = buildTorchLights()
  root.add(...lights)

  const moteSpecs = generateMotes(MOTE_COUNT)
  const motes = buildMotes(moteSpecs)
  root.add(motes)
  const motePositions = motes.geometry.getAttribute('position') as BufferAttribute
  const moteArray = motePositions.array as Float32Array
  const flameColors = flames.instanceColor as InstancedBufferAttribute
  const flameColorArray = flameColors.array as Float32Array

  const update = (timeMs: number) => {
    for (let i = 0; i < TORCHES.length; i++) {
      const t = TORCHES[i]
      const k = torchFlicker(timeMs, t.seed)
      lights[i].intensity = TORCH_LIGHT_INTENSITY * k
      const sx = flameSwayX(timeMs, t.seed)
      const sz = flameSwayZ(timeMs, t.seed)
      const baseY = TORCH_RIM_Y - FLAME_SINK
      // Outer tongue: height breathes with the flicker, width a little less.
      setInstance(
        flames,
        i * FLAMES_PER_TORCH,
        t.x,
        baseY,
        t.z,
        sx,
        0,
        sz,
        FLAME_OUTER_RADIUS * (0.92 + 0.08 * k),
        FLAME_OUTER_HEIGHT * k,
        FLAME_OUTER_RADIUS * (0.92 + 0.08 * k),
      )
      // Inner core: brighter, shorter, sways less.
      setInstance(
        flames,
        i * FLAMES_PER_TORCH + 1,
        t.x,
        baseY,
        t.z,
        sx * 0.6,
        0,
        sz * 0.6,
        FLAME_INNER_RADIUS,
        FLAME_INNER_HEIGHT * (0.9 + 0.1 * k),
        FLAME_INNER_RADIUS,
      )
      const o = i * FLAMES_PER_TORCH * 3
      flameColorArray[o] = FLAME_OUTER_COLOR.r * k
      flameColorArray[o + 1] = FLAME_OUTER_COLOR.g * k
      flameColorArray[o + 2] = FLAME_OUTER_COLOR.b * k
      flameColorArray[o + 3] = FLAME_INNER_COLOR.r
      flameColorArray[o + 4] = FLAME_INNER_COLOR.g
      flameColorArray[o + 5] = FLAME_INNER_COLOR.b
    }
    flames.instanceMatrix.needsUpdate = true
    flameColors.needsUpdate = true

    const s = timeMs / 1000
    for (let i = 0; i < moteSpecs.length; i++) writeMotePosition(moteSpecs[i], s, moteArray, i)
    motePositions.needsUpdate = true
  }

  update(0)

  const dispose = () => {
    disposeTree(root)
    const sprite = (motes.material as PointsMaterial).map
    sprite?.dispose()
    for (const l of lights) l.dispose()
  }

  return { root, update, dispose }
}
