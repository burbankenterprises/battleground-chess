import type { Color as Army, PieceSymbol } from 'chess.js'
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three'
import type { BufferAttribute, BufferGeometry } from 'three'
import { ARMY_PALETTE, ARMY_THEME } from './palette'
import type { ArmyRole } from './palette'

/**
 * models — procedural low-poly ancient-warfare pieces (Phase 4): Israelites
 * (w) vs Philistines (b), built in code from primitives only (cylinders,
 * boxes, spheres, cones). No external assets, zero licensing risk.
 *
 *   pawn    w: slinger — loaded sling streaming behind a cocked throwing arm, stone bag
 *           b: shield-bearer — round bronze shield braced forward, spear, feathered crown
 *   rook    chariot — two wheels, cab with army trim, pole + yoke, javelin-armed charioteer
 *   knight  horseman — horse (legs, barrel, neck, head, mane, tail, army saddle cloth) + spear-armed rider
 *   bishop  w: prophet — robe with tekhelet hem + mantle, hood, beard, shepherd's staff
 *           b: Dagon priest — robe, bronze scale cape, fish-head crown with open jaws, offering bowl
 *   queen   w: mighty-man — raised sword + tekhelet banner, linen cape
 *           b: Goliath — the champion figure ×1.25 in bronze armor, crested helmet,
 *              weaver's-beam spear, javelin slung on his back
 *   king    crowned king seated on a throne atop a two-step dais, twin army banners
 *
 * Contract with PieceActor (see its applyTint + topple pivot):
 *   - Every call returns a FRESH Group with FRESH materials. applyTint mutates
 *     each material's emissive per actor (promotion flash, check alarm), so
 *     materials are never shared between calls. Geometries ARE shared via a
 *     module cache, so nothing may mutate or dispose them.
 *   - Every mesh is raycast-disabled so taps pass through to the full board
 *     tile underneath (full-tile tap targets).
 *   - Models are authored facing -z; the returned group's rotation.y turns each
 *     army toward the enemy (w → -z, b → +z), forming a battle line.
 *   - The base sits on y = 0 and every part stays inside the plinth's radius,
 *     so the plinth's bottom rim is the true topple edge: PIECE_DIMS.radius is
 *     the plinth radius and PIECE_DIMS.height covers the tallest part
 *     (models.test.ts holds the two in sync).
 *
 * Units are world units (1 = one board tile). Standard figures are authored in
 * figure units — world units at figure scale 1 — and scaled as a group.
 */

/**
 * Triangle budget. Phase 4 shipped ≤300/piece; Tier 2 detail work doubles the
 * allowance — enough for smooth-silhouette spheres/cylinders at board scale
 * while staying trivial for the GPU (32 pieces × ~600 = ~19k tris).
 */
export const MAX_MODEL_TRIS = 700

/** Yaw (rotation about +y) applied to a model authored facing -z. */
export const FACING_YAW: Record<Army, number> = { w: 0, b: Math.PI }

/** Name of the invisible marker placed one unit in front of every model (before facing yaw). */
export const FORWARD_MARKER = 'forward'
/** Name of each model's base mesh, whose bottom rim is the topple edge. */
export const PLINTH_NAME = 'plinth'
/** Name of one clearly front-facing part per model (horse head, shield, yoke, …). */
export const FRONT_FEATURE = 'front-feature'

/**
 * Raycast no-op: pieces are purely visual, so taps always pass through to the
 * full board tile beneath them (keeps tap targets = full tile).
 */
const NO_RAYCAST = () => null

// ---- Tessellation (keeps every model ≤ MAX_MODEL_TRIS; a 16×16 sphere alone is ~480 tris) ----

/** Radial segments for the large round masses that dominate a silhouette (plinths, robes, wheels, shield). */
const SEG_LARGE = 16
/** Radial segments for small round parts (torsos, skirts, belts, crowns, small cones). */
const SEG_SMALL = 12
/** Radial segments for tiny cones (spear heads, tail, finial) and the flat pyramid jaw plates. */
const SEG_TIP = 6
/** Head spheres: smooth enough to read as a head, not a ball of facets. */
const SPHERE_W_SEG = 11
const SPHERE_H_SEG = 7
/** Helmet / hair / hood domes (upper hemisphere only). */
const DOME_H_SEG = 4
/** Tiny spheres (the fish crown's eyes): an octahedron, 8 tris. */
const TINY_W_SEG = 4
const TINY_H_SEG = 2

/**
 * Base emissive strength — same as the Phase 3 placeholders and the shatter
 * shards, so the promotion flash and check alarm peak exactly as before.
 */
const BASE_EMISSIVE_INTENSITY = 0.25

// ---- Plinths: the base disc every model stands on; its bottom rim is the topple edge ----

/** Plinth height. */
const PLINTH_H = 0.04
/** Plinth top radius as a fraction of the bottom radius — a small bevel that catches the light. */
const PLINTH_BEVEL = 0.92
/** Plinth (bottom rim) radius per model type — mirrored in PIECE_DIMS.radius. */
const PAWN_PLINTH_R = 0.22
const ROOK_PLINTH_R = 0.28
const KNIGHT_PLINTH_R = 0.28
const BISHOP_PLINTH_R = 0.21
/** Both queens share one plinth, so the shared topple radius is exact for each. */
const QUEEN_PLINTH_R = 0.28
const KING_DAIS_R = 0.29

// ---- Standard soldier figure (figure units, feet at y = 0, facing -z, right hand on +x) ----
// Slightly chunky, big-headed proportions so figures read at board scale.

const LEG_W = 0.046
const LEG_H = 0.13
const LEG_D = 0.052
/** Leg center offset from the body's midline. */
const LEG_X = 0.034
/** Tunic hem / kilt: a frustum flaring toward its hem. */
const SKIRT_BOTTOM_Y = 0.1
const SKIRT_H = 0.09
const SKIRT_TOP_R = 0.068
const SKIRT_BOTTOM_R = 0.092
/** Torso: a frustum, broad at the shoulders. */
const TORSO_BOTTOM_Y = 0.18
const TORSO_H = 0.125
const TORSO_TOP_R = 0.086
const TORSO_BOTTOM_R = 0.064
/** Belt / sash band covering the skirt–torso seam. */
const BELT_R = 0.071
const BELT_H = 0.026
const HEAD_R = 0.062
const HEAD_Y = 0.356
const SHOULDER_X = 0.09
const SHOULDER_Y = 0.29
const ARM_W = 0.037
const ARM_LEN = 0.14
/** Helmet / hair dome radius (just over the head radius, so it reads as a cap). */
const DOME_R = 0.061
/** Helmet spike (dome headgear): the warrior point at board distance. */
const SPIKE_R = 0.016
const SPIKE_H = 0.05
/** Hair is tilted back so the forehead shows and the nape is covered. */
const HAIR_TILT = 0.3
/** Philistine feathered crown (the Peleset headdress): a band flaring upward. */
const FEATHER_CROWN_BOTTOM_R = 0.052
const FEATHER_CROWN_TOP_R = 0.088
const FEATHER_CROWN_H = 0.085
/** The crown band starts this far above the head center (just over the brow). */
const FEATHER_CROWN_BROW = 0.023
/** Upright spears / javelins: shaft width, head radius and head length. */
const SPEAR_SHAFT_W = 0.024
const SPEAR_HEAD_R = 0.02
const SPEAR_HEAD_LEN = 0.05
/** A beard hangs from the chin: this far below the head center and in front of it. */
const BEARD_DROP = 0.045
const BEARD_FORWARD = 0.034
const BEARD_R = 0.034
const BEARD_H = 0.07

// ---- Pawn (w): Israelite slinger ----

/** Throwing arm cocked up, out and back. */
const SLINGER_THROW_DIR: Vec3 = [0.4, 0.8, 0.3]
/** Aiming arm points at the enemy line. */
const SLINGER_AIM_DIR: Vec3 = [-0.2, -0.3, -0.93]
/** The loaded pouch streams behind the throwing hand, mid-swing. */
const SLING_REACH: Vec3 = [-0.04, 0, 0.1]
const SLING_CORD_W = 0.03
const SLING_POUCH = 0.048
/** Bag of sling stones at the left hip. */
const STONE_BAG_SIZE: Vec3 = [0.045, 0.055, 0.035]
const STONE_BAG_AT: Vec3 = [-0.088, 0.14, 0]

// ---- Pawn (b): Philistine shield-bearer ----

/** Shield arm braced forward across the body. */
const SHIELD_ARM_DIR: Vec3 = [0.25, -0.55, -0.8]
const SHIELD_R = 0.1
const SHIELD_T = 0.016
/** Shield center relative to the shield hand: a little up and in front of the fist. */
const SHIELD_FROM_HAND: Vec3 = [0, 0.012, -0.025]
const SHIELD_BOSS_R = 0.026
const SHIELD_BOSS_H = 0.03
const PAWN_SPEAR_ARM_DIR: Vec3 = [0.3, -0.85, -0.35]
/** Spear tip just above the feathered crown (figure units). */
const PAWN_SPEAR_TOP = 0.45

// ---- Rook: chariot ----

const WHEEL_R = 0.125
const WHEEL_T = 0.03
const WHEEL_X = 0.175
/** The axle sits under the rear of the cab, as on Canaanite / Egyptian chariots. */
const AXLE_Z = 0.035
const CAB_W = 0.29
const CAB_H = 0.16
const CAB_D = 0.2
const CAB_Z = -0.01
const CAB_BOTTOM_Y = 0.155
const CAB_TRIM_H = 0.035
/** Trim band center above the cab floor. */
const CAB_TRIM_Y = 0.045
const CAB_RAIL_H = 0.025
/** How far the trim / rail stand proud of the cab walls (each side). */
const CAB_TRIM_PROUD = 0.006
const CAB_RAIL_PROUD = 0.01
/** Castellated rail (rook marker): merlon width/height/spacing on the cab rail. */
const CRENEL_RUN_W = CAB_W + 2 * CAB_RAIL_PROUD
const CRENEL_H = 0.055
const CRENEL_T = 0.05
const POLE_W = 0.026
/** The pole leaves the cab front low and rises slightly toward the yoke. */
const POLE_ROOT_Y = 0.17
const YOKE_AT: Vec3 = [0, 0.215, -0.24]
const YOKE_SIZE: Vec3 = [0.16, 0.024, 0.024]
/** The charioteer's torso starts just inside the cab, hidden under the rail. */
const CHARIOTEER_SINK = 0.01
const REINS_ARM_DIR: Vec3 = [-0.12, -0.5, -0.85]
const CHARIOTEER_SPEAR_ARM_DIR: Vec3 = [0.3, -0.65, -0.45]
/** Javelin standing in the cab: butt and tip heights (world). */
const CHARIOT_JAVELIN_BOTTOM = 0.185
const CHARIOT_JAVELIN_TOP = 0.66

// ---- Knight: horseman ----

const HORSE_LEG_W = 0.036
const HORSE_LEG_D = 0.04
const HORSE_LEG_H = 0.18
const HORSE_LEG_X = 0.04
const HORSE_FRONT_LEG_Z = -0.08
const HORSE_REAR_LEG_Z = 0.14
const HORSE_BODY_W = 0.13
const HORSE_BODY_H = 0.12
const HORSE_BODY_L = 0.3
const HORSE_BODY_Z = 0.03
const HORSE_BODY_BOTTOM = PLINTH_H + HORSE_LEG_H
const HORSE_BODY_TOP = HORSE_BODY_BOTTOM + HORSE_BODY_H
const HORSE_NECK_W = 0.065
const HORSE_NECK_D = 0.075
const HORSE_NECK_BASE: Vec3 = [0, 0.32, -0.09]
const HORSE_NECK_TOP: Vec3 = [0, 0.46, -0.17]
const HORSE_HEAD_W = 0.058
const HORSE_HEAD_D = 0.068
const HORSE_MUZZLE: Vec3 = [0, 0.405, -0.26]
const MANE_W = 0.022
const MANE_D = 0.03
const MANE_FROM: Vec3 = [0, 0.345, -0.065]
const MANE_TO: Vec3 = [0, 0.475, -0.145]
const TAIL_R = 0.028
const TAIL_ROOT: Vec3 = [0, 0.325, 0.175]
const TAIL_TIP: Vec3 = [0, 0.2, 0.245]
/** Saddle cloth in the army color, draped a little down both flanks. */
const SADDLE_SIZE: Vec3 = [0.152, 0.075, 0.14]
const SADDLE_DRAPE = 0.025
const RIDER_Z = 0.04
/** Rider's legs astride the horse (one box, wider than the saddle cloth). */
const RIDER_LEGS_SIZE: Vec3 = [0.19, 0.09, 0.08]
const RIDER_LEGS_DROP = 0.03
/** The rider's torso sits this far above the horse's back (on the saddle). */
const RIDER_SEAT = 0.015
const RIDER_SPEAR_ARM_DIR: Vec3 = [0.35, -0.6, -0.4]
const HORSEMAN_SPEAR_BOTTOM = 0.25
const HORSEMAN_SPEAR_TOP = 0.80
const HORSEMAN_SPEAR_HEAD_LEN = 0.055

// ---- Bishops: robed figures (world units) ----

const ROBE_BOTTOM_R = 0.125
const ROBE_TOP_R = 0.065
const ROBE_H = 0.44
/** Hem band, slightly proud of the robe. */
const HEM_BOTTOM_R = 0.13
const HEM_TOP_R = 0.122
const HEM_H = 0.045
/** Mantle / cape over the shoulders. */
const MANTLE_BOTTOM_R = 0.105
const MANTLE_TOP_R = 0.06
const MANTLE_H = 0.13
const MANTLE_BOTTOM_Y = 0.43
const ROBED_HEAD_R = 0.058
const ROBED_HEAD_Y = 0.605
const ROBED_SHOULDER_X = 0.085
const ROBED_SHOULDER_Y = 0.545
const ROBED_ARM_LEN = 0.15
const ROBED_ARM_W = 0.042
const ROBED_BEARD_R = 0.036
const ROBED_BEARD_H = 0.085
const ROBED_BEARD_AT: Vec3 = [0, 0.548, -0.038]
/** Prophet: linen hood over the head, tilted back like the hair. */
const HOOD_R = 0.068
const HOOD_TILT = 0.35
const PROPHET_STAFF_ARM_DIR: Vec3 = [0.3, -0.6, -0.75]
const PROPHET_STAFF_W = 0.034
const PROPHET_STAFF_TOP = 0.8
/** Shepherd's crook: a short hooked segment at the staff top. */
const PROPHET_CROOK: Vec3 = [-0.04, 0.03, 0]
/** "Thus saith the Lord": the free arm raised forward. */
const PROPHET_GESTURE_DIR: Vec3 = [-0.35, 0.65, -0.65]
/**
 * Dagon priest's fish-head crown (the Mesopotamian fish-cloak, mouth upward):
 * an ovoid fish head (a scaled sphere) over the priest's head, two flat
 * pyramid jaws gaping open at the top (a "V" from the side, the classic mitre
 * peak from the front), gill fins on its flanks and two eyes.
 */
const FISH_HEAD_R = 0.062
const FISH_HEAD_SCALE: Vec3 = [1, 1.5, 1.2]
const FISH_HEAD_Y = 0.715
/** Jaw plates: a 4-sided cone flattened front-to-back into a pointed plate. */
const JAW_R = 0.054
const JAW_H = 0.1
const JAW_FLATTEN = 0.3
/** Jaw roots sit inside the top of the fish head, each this far fore / aft of center. */
const JAW_ROOT_Y = 0.775
const JAW_ROOT_Z = 0.022
/** How far each jaw gapes open from vertical (rad). */
const JAW_GAPE = 0.32
const FIN_SIZE: Vec3 = [0.012, 0.075, 0.05]
const FIN_AT: Vec3 = [0.066, 0.7, 0.012]
/** Fins flare outward at the top (rad). */
const FIN_FLARE = 0.5
const FISH_EYE_R = 0.012
const FISH_EYE_AT: Vec3 = [0.05, 0.75, -0.04]
/** Offering bowl held in both hands in front of the chest (an upturned cone). */
const BOWL_R = 0.05
const BOWL_H = 0.04
const BOWL_AT: Vec3 = [0, 0.44, -0.13]
/** Each hand grips the bowl this fraction of its radius out from the center. */
const BOWL_GRIP = 0.6

// ---- Queens: champions ----

/** The mighty-man is the standard figure at this scale. */
const CHAMPION_SCALE = 1.3
/** Goliath is the champion figure scaled again by this (Phase 4 spec: ~1.25×). */
const GOLIATH_SCALE = 1.25
/** Banner finial tip (mighty-man) / spear tip (Goliath, before his extra scale), world units. */
const QUEEN_STAFF_TOP = 0.97
/** The same tip in figure units, for both champions. */
const QUEEN_STAFF_TOP_FIG = (QUEEN_STAFF_TOP - PLINTH_H) / CHAMPION_SCALE
const SWORD_ARM_DIR: Vec3 = [0.45, 0.8, -0.3]
const SWORD_DIR: Vec3 = [0.05, 1, -0.2]
const SWORD_BLADE_LEN = 0.28
const SWORD_BLADE_W = 0.034
const SWORD_BLADE_T = 0.014
const SWORD_GUARD_W = 0.075
const SWORD_GUARD_T = 0.02
const BANNER_ARM_DIR: Vec3 = [-0.35, -0.5, -0.5]
const BANNER_POLE_W = 0.024
const BANNER_FINIAL_R = 0.028
const BANNER_FINIAL_H = 0.06
/** The flag flies from the pole top toward the figure's midline, above the head. */
const BANNER_FLAG_SIZE: Vec3 = [0.17, 0.12, 0.008]
const BANNER_FLAG_GAP = 0.005
/** Cape hanging down the back, its hem swinging out a little (rad). */
const CAPE_SIZE: Vec3 = [0.17, 0.25, 0.018]
const CAPE_AT: Vec3 = [0, 0.2, 0.08]
const CAPE_SWING = -0.12
/** Goliath: crest along the helmet top, bronze javelin slung between the shoulders (1 Sam 17:6). */
const CREST_SIZE: Vec3 = [0.02, 0.035, 0.12]
const JAVELIN_W = 0.014
const JAVELIN_FROM: Vec3 = [-0.11, 0.2, 0.09]
const JAVELIN_TO: Vec3 = [0.12, 0.42, 0.095]
const GOLIATH_SPEAR_ARM_DIR: Vec3 = [0.2, -0.88, -0.44]
/** "The shaft of his spear was like a weaver's beam" (1 Sam 17:7): thicker than any other spear. */
const GOLIATH_SPEAR_W = 0.038
const GOLIATH_SPEAR_HEAD_R = 0.036
const GOLIATH_SPEAR_HEAD_LEN = 0.07
/** His free fist raised in defiance of the Israelite line (1 Sam 17:10). */
const GOLIATH_FIST_DIR: Vec3 = [-0.3, 0.9, -0.15]

// ---- King: seated on a throne atop a two-step dais ----

const DAIS_STEP_H = 0.05
/** Upper dais step: a carpet in the army's banner color. */
const KING_CARPET_R = 0.245
const DAIS_TOP = 2 * DAIS_STEP_H
const THRONE_SEAT_SIZE: Vec3 = [0.25, 0.12, 0.2]
const THRONE_SEAT_Z = 0.04
const THRONE_SEAT_TOP = DAIS_TOP + THRONE_SEAT_SIZE[1]
/** Throne back: low enough that the crowned head shows above it from behind. */
const THRONE_BACK_SIZE: Vec3 = [0.27, 0.34, 0.04]
const THRONE_BACK_Z = 0.12
/** Twin banner poles rising from (and rooted inside) the throne back's corners. */
const KING_BANNER_X = 0.1
const KING_BANNER_TOP = 1.03
const KING_BANNER_ROOT_Y = 0.5
const KING_BANNER_POLE_W = 0.024
/** Flags fly outward from each pole, just under its tip. */
const KING_FLAG_SIZE: Vec3 = [0.14, 0.1, 0.008]
const KING_FLAG_GAP = 0.005
const KING_LAP_SIZE: Vec3 = [0.19, 0.065, 0.17]
const KING_LAP_AT: Vec3 = [0, 0.2525, -0.015]
const KING_ROBE_FRONT_SIZE: Vec3 = [0.18, 0.15, 0.06]
const KING_ROBE_FRONT_AT: Vec3 = [0, 0.175, -0.095]
const KING_TORSO_TOP_R = 0.095
const KING_TORSO_BOTTOM_R = 0.085
const KING_TORSO_H = 0.2
const KING_TORSO_BOTTOM_Y = 0.28
/** Seated: the upper body leans back against the throne. */
const KING_TORSO_Z = 0.035
const KING_HEAD_R = 0.068
const KING_HEAD_AT: Vec3 = [0, 0.535, 0.03]
const KING_BEARD_R = 0.04
const KING_BEARD_H = 0.08
const KING_BEARD_AT: Vec3 = [0, 0.488, -0.022]
/** Crown: a flared gold / bronze band seated on the head. */
const KING_CROWN_TOP_R = 0.058
const KING_CROWN_BOTTOM_R = 0.064
const KING_CROWN_H = 0.11
const KING_CROWN_BOTTOM_Y = 0.565
/** Crown points (king marker): 5 accent cones around the crown rim. */
const CROWN_POINT_R = 0.014
const CROWN_POINT_H = 0.05
const KING_SHOULDER: Vec3 = [0.1, 0.46, 0.035]
/** Arms rest forward on the knees. */
const KING_ARM_DIR: Vec3 = [0.12, -0.8, -0.55]
const KING_ARM_LEN = 0.2
const KING_ARM_W = 0.045

// ---- building blocks ----

type Vec3 = readonly [number, number, number]

/** Fresh per-model material source: one material per role, shared only within that model. */
type Paint = (role: ArmyRole) => MeshStandardMaterial

type Builder = (root: Group, paint: Paint, army: Army) => void

type Headgear = 'hair' | 'dome' | 'feathers'

type FigureSpec = {
  /** Leg material, or null when the legs are hidden (charioteer, rider). */
  legs: ArmyRole | null
  skirt: ArmyRole | null
  torso: ArmyRole
  belt: ArmyRole | null
  headgear: Headgear
  /**
   * Turned robe silhouette (Tier 2): one smooth lathe hem→waist→shoulders.
   * Default true; false falls back to the Phase 4 stacked cylinders (used by
   * figures whose legs must stay visible, e.g. charioteers, riders).
   */
  robe?: boolean
}

const RIGHT = 1
const LEFT = -1
type Side = typeof RIGHT | typeof LEFT
/** Both sides, for mirrored parts (legs, wheels, fins, arms, banners). */
const SIDES: readonly Side[] = [LEFT, RIGHT]

const UP = new Vector3(0, 1, 0)

/** Shared geometries, one per primitive shape + size. Never mutated or disposed. */
const geometryCache = new Map<string, BufferGeometry>()

function cachedGeometry(key: string, make: () => BufferGeometry): BufferGeometry {
  let geometry = geometryCache.get(key)
  if (!geometry) {
    geometry = make()
    geometryCache.set(key, geometry)
  }
  return geometry
}

/** Cache-key fragment: 4 decimals is far below visible size and absorbs float noise. */
function keyOf(n: number): string {
  return n.toFixed(4)
}

function boxGeo(w: number, h: number, d: number): BufferGeometry {
  return cachedGeometry(`box:${keyOf(w)}:${keyOf(h)}:${keyOf(d)}`, () => new BoxGeometry(w, h, d))
}

function cylinderGeo(rTop: number, rBottom: number, h: number, segments: number): BufferGeometry {
  return cachedGeometry(
    `cyl:${keyOf(rTop)}:${keyOf(rBottom)}:${keyOf(h)}:${segments}`,
    () => new CylinderGeometry(rTop, rBottom, h, segments),
  )
}

/**
 * A turned garment profile (Tier 2 silhouette work): one LatheGeometry whose
 * radius curve flows hem → ankle pinch → waist → chest → shoulders, with a
 * soft flare at the hem. Reads as a draped robe at board scale instead of
 * stacked cylinders — silhouette carries the detail, not texture.
 *
 * Pass 3 (A + B): silhouette opened up — hem flares wider than the old
 * cylinders ever were, shoulders broaden, waist pinches harder — and 5 long
 * drape folds are displaced into the mesh itself (strongest at the hem, gone
 * by the chest) so cloth reads AT BOARD DISTANCE, where thread-scale texture
 * cannot. Stays inside the plinth radius (models.test enforces).
 */
const ROBE_FOLDS = 5
/** Fold depth as a fraction of local radius — tuned to read at 40 px, invisible as noise zoomed out. */
const ROBE_FOLD_DEPTH = 0.14
/** Garment height fraction (0 = hem, 1 = neck) above which folds fade to nothing. */
const ROBE_FOLD_FADE_TOP = 0.62
/** Where the fold ridges sit around the figure, so both armies drape alike. */
const ROBE_FOLD_PHASE = (2 * Math.PI) / ROBE_FOLDS

function robeGeo(segments: number): BufferGeometry {
  return cachedGeometry(`robe3:${segments}:${ROBE_FOLDS}:${ROBE_FOLD_DEPTH}`, () => {
    // Silhouette curve (y from 0 = feet to neck): hem edge, flare, calf, hip,
    // waist, chest, shoulder, neck cap.
    const pts: Vector2[] = [
      [0.108, 0.0], // hem edge (sits just above the plinth)
      [0.118, 0.014], // hem flare — the widest point of the figure
      [0.096, 0.1], // calf drape
      [0.079, 0.185], // hip → waist pinch
      [0.099, 0.27], // chest rise
      [0.112, 0.315], // shoulder swell
      [0.042, 0.335], // neck close-in (caps the top)
    ].map(([r, y]) => new Vector2(r, y))
    const lathe = new LatheGeometry(pts, segments)
    // B: displace the fold ridges radially. Angle-locked to the lathe seam so
    // the folds are continuous around the full 360° (no seam mismatch).
    const pos = lathe.attributes.position as BufferAttribute
    const maxY = 0.335
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      const r = Math.hypot(x, z)
      if (r < 1e-5) continue
      // Garment height fraction 0..1 (hem → neck); folds fade out by FADE_TOP.
      const t = Math.min(y / maxY, 1)
      const fade = t >= ROBE_FOLD_FADE_TOP ? 0 : Math.cos((t / ROBE_FOLD_FADE_TOP) * Math.PI * 0.5)
      const angle = Math.atan2(z, x)
      const ridge = Math.cos(angle * ROBE_FOLDS + ROBE_FOLD_PHASE)
      const depth = ROBE_FOLD_DEPTH * fade * (r * 0.5)
      pos.setXYZ(i, x + (x / r) * depth * ridge, y, z + (z / r) * depth * ridge)
    }
    lathe.computeVertexNormals()
    return lathe
  })
}

/** Cone with its apex on local +y. */
function coneGeo(r: number, h: number, segments: number): BufferGeometry {
  return cachedGeometry(`cone:${keyOf(r)}:${keyOf(h)}:${segments}`, () => new ConeGeometry(r, h, segments))
}

function sphereGeo(r: number, widthSegments = SPHERE_W_SEG, heightSegments = SPHERE_H_SEG): BufferGeometry {
  return cachedGeometry(
    `sphere:${keyOf(r)}:${widthSegments}:${heightSegments}`,
    () => new SphereGeometry(r, widthSegments, heightSegments),
  )
}

/** Upper hemisphere (open at its equator, which sits at the mesh origin). */
function domeGeo(r: number): BufferGeometry {
  return cachedGeometry(
    `dome:${keyOf(r)}`,
    () => new SphereGeometry(r, SPHERE_W_SEG, DOME_H_SEG, 0, Math.PI * 2, 0, Math.PI / 2),
  )
}

/** Roles whose surfaces are organic (cloth, skin, hair, hide) — shade smooth. */
const SMOOTH_ROLES = new Set<ArmyRole>(['cloth', 'skin', 'hair', 'mount', 'sash'])

function paintFor(army: Army): Paint {
  const theme = ARMY_THEME[army]
  const made = new Map<ArmyRole, MeshStandardMaterial>()
  return (role) => {
    let material = made.get(role)
    if (!material) {
      const spec = theme[role]
      material = new MeshStandardMaterial({
        color: spec.color,
        metalness: spec.metalness,
        roughness: spec.roughness,
        emissive: ARMY_PALETTE[army].emissive,
        emissiveIntensity: BASE_EMISSIVE_INTENSITY,
        // Organic surfaces shade smooth (Tier 2); armor/blade/plinth keep their
        // faceted read. The merged model inherits this per part.
        flatShading: SMOOTH_ROLES.has(role) ? false : true,
      })
      material.name = `${army}-${role}`
      made.set(role, material)
    }
    return material
  }
}

/** Add one raycast-disabled mesh. */
function part(
  parent: Object3D,
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  at: Vec3,
  rot?: Vec3,
  scale?: Vec3,
): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.raycast = NO_RAYCAST
  mesh.position.set(at[0], at[1], at[2])
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2])
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2])
  parent.add(mesh)
  return mesh
}

/**
 * A mesh whose local +y axis runs from `from` to `to` (limbs, shafts, cones
 * pointing somewhere). `geometryOfLength` receives the span length.
 */
function between(
  parent: Object3D,
  geometryOfLength: (length: number) => BufferGeometry,
  material: MeshStandardMaterial,
  from: Vec3,
  to: Vec3,
): Mesh {
  const a = new Vector3(from[0], from[1], from[2])
  const dir = new Vector3(to[0], to[1], to[2]).sub(a)
  const length = dir.length()
  const mesh = part(parent, geometryOfLength(length), material, [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  ])
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize())
  return mesh
}

/** Point `length` along the (unnormalized) direction `dir` from `from`. */
function along(from: Vec3, dir: Vec3, length: number): Vec3 {
  const d = new Vector3(dir[0], dir[1], dir[2]).normalize()
  return [from[0] + d.x * length, from[1] + d.y * length, from[2] + d.z * length]
}

function offset(p: Vec3, by: Vec3): Vec3 {
  return [p[0] + by[0], p[1] + by[1], p[2] + by[2]]
}

/** A box-section limb from a joint along `dir`; returns the far end (the hand). */
function limb(
  parent: Object3D,
  material: MeshStandardMaterial,
  joint: Vec3,
  dir: Vec3,
  length: number,
  width: number,
): { hand: Vec3; mesh: Mesh } {
  const hand = along(joint, dir, length)
  const mesh = between(parent, (len) => boxGeo(width, len, width), material, joint, hand)
  return { hand, mesh }
}

/** A standard-figure arm from the given shoulder. */
function arm(fig: Object3D, paint: Paint, side: Side, dir: Vec3, role: ArmyRole = 'skin') {
  return limb(fig, paint(role), [side * SHOULDER_X, SHOULDER_Y, 0], dir, ARM_LEN, ARM_W)
}

/** Base disc; its bottom rim is the topple edge. */
function plinth(parent: Object3D, paint: Paint, radius: number, height = PLINTH_H): Mesh {
  const mesh = part(
    parent,
    cylinderGeo(radius * PLINTH_BEVEL, radius, height, SEG_LARGE),
    paint('plinth'),
    [0, height / 2, 0],
  )
  mesh.name = PLINTH_NAME
  return mesh
}

/** A group in figure units: feet at (0, baseY, z) in the parent, uniformly scaled. */
function figureGroup(parent: Object3D, scale: number, baseY: number, z = 0): Group {
  const fig = new Group()
  fig.position.set(0, baseY, z)
  fig.scale.setScalar(scale)
  parent.add(fig)
  return fig
}

function headgear(fig: Object3D, paint: Paint, kind: Headgear): void {
  switch (kind) {
    case 'hair':
      part(fig, domeGeo(DOME_R), paint('hair'), [0, HEAD_Y, 0], [HAIR_TILT, 0, 0])
      return
    case 'dome':
      part(fig, domeGeo(DOME_R), paint('metal'), [0, HEAD_Y, 0])
      // Helmet spike: the warrior read at distance (champion / Goliath).
      part(fig, coneGeo(SPIKE_R, SPIKE_H, SEG_TIP), paint('metal'), [0, HEAD_Y + DOME_R + SPIKE_H / 2, 0])
      return
    case 'feathers':
      part(
        fig,
        cylinderGeo(FEATHER_CROWN_TOP_R, FEATHER_CROWN_BOTTOM_R, FEATHER_CROWN_H, SEG_SMALL),
        paint('metal'),
        [0, HEAD_Y + FEATHER_CROWN_BROW + FEATHER_CROWN_H / 2, 0],
      )
      return
  }
}

/** Legs, skirt, torso, belt, head and headgear of the standard figure (arms are per pose). */
function figureBody(fig: Object3D, paint: Paint, spec: FigureSpec): void {
  if (spec.legs) {
    for (const side of SIDES) {
      part(fig, boxGeo(LEG_W, LEG_H, LEG_D), paint(spec.legs), [side * LEG_X, LEG_H / 2, 0])
    }
  }
  if (spec.robe !== false) {
    // Turned robe: hem → waist → shoulders in one smooth lathe (Tier 2).
    part(fig, robeGeo(SEG_SMALL), paint(spec.torso), [0, 0, 0])
    if (spec.belt) {
      // Belt reads as a raised band crossing the robe's waist pinch.
      part(
        fig,
        cylinderGeo(BELT_R * 1.12, BELT_R * 1.12, BELT_H, SEG_LARGE),
        paint(spec.belt),
        [0, TORSO_BOTTOM_Y, 0],
      )
    }
  } else {
    if (spec.skirt) {
      part(
        fig,
        cylinderGeo(SKIRT_TOP_R, SKIRT_BOTTOM_R, SKIRT_H, SEG_SMALL),
        paint(spec.skirt),
        [0, SKIRT_BOTTOM_Y + SKIRT_H / 2, 0],
      )
    }
    part(
      fig,
      cylinderGeo(TORSO_TOP_R, TORSO_BOTTOM_R, TORSO_H, SEG_SMALL),
      paint(spec.torso),
      [0, TORSO_BOTTOM_Y + TORSO_H / 2, 0],
    )
    if (spec.belt) {
      part(fig, cylinderGeo(BELT_R, BELT_R, BELT_H, SEG_SMALL), paint(spec.belt), [0, TORSO_BOTTOM_Y, 0])
    }
  }
  part(fig, sphereGeo(HEAD_R), paint('skin'), [0, HEAD_Y, 0])
  headgear(fig, paint, spec.headgear)
}

/** A beard centered at `at`, hanging from the chin (apex pointing down). */
function beard(parent: Object3D, paint: Paint, at: Vec3, r: number, h: number): Mesh {
  return part(parent, coneGeo(r, h, SEG_SMALL), paint('hair'), at, [Math.PI, 0, 0])
}

/** An upright spear through (x, z): wooden shaft from `bottomY`, metal head ending at `topY`. */
function uprightSpear(
  parent: Object3D,
  paint: Paint,
  x: number,
  z: number,
  bottomY: number,
  topY: number,
  shaftW = SPEAR_SHAFT_W,
  headR = SPEAR_HEAD_R,
  headLen = SPEAR_HEAD_LEN,
  headSegments = SEG_TIP,
): Mesh {
  const shaftTop = topY - headLen
  const shaft = part(parent, boxGeo(shaftW, shaftTop - bottomY, shaftW), paint('wood'), [
    x,
    (bottomY + shaftTop) / 2,
    z,
  ])
  part(parent, coneGeo(headR, headLen, headSegments), paint('blade'), [x, shaftTop + headLen / 2, z])
  return shaft
}

// ---- the twelve models ----

/** Pawn (w): Israelite slinger. */
const buildSlinger: Builder = (root, paint) => {
  plinth(root, paint, PAWN_PLINTH_R)
  const fig = figureGroup(root, 1, PLINTH_H)
  figureBody(fig, paint, { legs: 'skin', skirt: 'cloth', torso: 'cloth', belt: 'sash', headgear: 'hair' })
  // Throwing arm cocked back, the loaded sling streaming behind it mid-swing.
  const { hand } = arm(fig, paint, RIGHT, SLINGER_THROW_DIR)
  const pouchAt = offset(hand, SLING_REACH)
  between(fig, (len) => boxGeo(SLING_CORD_W, len, SLING_CORD_W), paint('wood'), hand, pouchAt)
  part(fig, boxGeo(SLING_POUCH, SLING_POUCH, SLING_POUCH), paint('wood'), pouchAt)
  // Aiming arm points at the enemy line.
  arm(fig, paint, LEFT, SLINGER_AIM_DIR).mesh.name = FRONT_FEATURE
  part(fig, boxGeo(STONE_BAG_SIZE[0], STONE_BAG_SIZE[1], STONE_BAG_SIZE[2]), paint('wood'), STONE_BAG_AT)
}

/** Pawn (b): Philistine shield-bearer. */
const buildShieldBearer: Builder = (root, paint) => {
  plinth(root, paint, PAWN_PLINTH_R)
  const fig = figureGroup(root, 1, PLINTH_H)
  figureBody(fig, paint, { legs: 'skin', skirt: 'cloth', torso: 'cloth', belt: 'sash', headgear: 'feathers' })
  // Round bronze shield braced forward across the body, boss facing the enemy.
  const shieldHand = arm(fig, paint, LEFT, SHIELD_ARM_DIR).hand
  const shieldAt = offset(shieldHand, SHIELD_FROM_HAND)
  const shield = part(
    fig,
    cylinderGeo(SHIELD_R, SHIELD_R, SHIELD_T, SEG_LARGE),
    paint('metal'),
    shieldAt,
    [Math.PI / 2, 0, 0], // disc axis along z: the face looks forward
  )
  shield.name = FRONT_FEATURE
  part(
    fig,
    coneGeo(SHIELD_BOSS_R, SHIELD_BOSS_H, SEG_SMALL),
    paint('accent'),
    [shieldAt[0], shieldAt[1], shieldAt[2] - SHIELD_T / 2 - SHIELD_BOSS_H / 2],
    [-Math.PI / 2, 0, 0], // apex toward -z
  )
  // Spear grounded beside the right foot.
  const spearHand = arm(fig, paint, RIGHT, PAWN_SPEAR_ARM_DIR).hand
  uprightSpear(fig, paint, spearHand[0], spearHand[2], 0, PAWN_SPEAR_TOP)
}

/** Rook: chariot with army trim and a javelin-armed charioteer. */
const buildChariot: Builder = (root, paint, army) => {
  plinth(root, paint, ROOK_PLINTH_R)
  for (const side of SIDES) {
    part(
      root,
      cylinderGeo(WHEEL_R, WHEEL_R, WHEEL_T, 14),
      paint('wood'),
      [side * WHEEL_X, PLINTH_H + WHEEL_R, AXLE_Z],
      [0, 0, Math.PI / 2], // wheel axis along x
    )
  }
  part(root, boxGeo(CAB_W, CAB_H, CAB_D), paint('cloth'), [0, CAB_BOTTOM_Y + CAB_H / 2, CAB_Z])
  // Army trim: tekhelet on Israelite linen, bronze on Philistine crimson.
  part(
    root,
    boxGeo(CAB_W + 2 * CAB_TRIM_PROUD, CAB_TRIM_H, CAB_D + 2 * CAB_TRIM_PROUD),
    paint('sash'),
    [0, CAB_BOTTOM_Y + CAB_TRIM_Y, CAB_Z],
  )
  part(
    root,
    boxGeo(CAB_W + 2 * CAB_RAIL_PROUD, CAB_RAIL_H, CAB_D + 2 * CAB_RAIL_PROUD),
    paint('metal'),
    [0, CAB_BOTTOM_Y + CAB_H, CAB_Z],
  )
  // Castellations: merlons on front + back rails — the ROOK read (castle wall).
  part(
    root,
    boxGeo(CRENEL_RUN_W, CRENEL_H, CRENEL_T),
    paint('metal'),
    [0, CAB_BOTTOM_Y + CAB_H + CAB_RAIL_H + CRENEL_H / 2, CAB_Z - (CAB_D / 2 + CAB_RAIL_PROUD) + CRENEL_T / 2],
  )
  part(
    root,
    boxGeo(CRENEL_RUN_W, CRENEL_H, CRENEL_T),
    paint('metal'),
    [0, CAB_BOTTOM_Y + CAB_H + CAB_RAIL_H + CRENEL_H / 2, CAB_Z + (CAB_D / 2 + CAB_RAIL_PROUD) - CRENEL_T / 2],
  )
  // Draught pole and yoke reach toward the enemy.
  between(
    root,
    (len) => boxGeo(POLE_W, len, POLE_W),
    paint('wood'),
    [0, POLE_ROOT_Y, CAB_Z - CAB_D / 2],
    YOKE_AT,
  )
  part(root, boxGeo(YOKE_SIZE[0], YOKE_SIZE[1], YOKE_SIZE[2]), paint('wood'), YOKE_AT).name = FRONT_FEATURE
  // Charioteer: the cab hides everything below the torso.
  const cabTop = CAB_BOTTOM_Y + CAB_H
  const fig = figureGroup(root, 1, cabTop - CHARIOTEER_SINK - TORSO_BOTTOM_Y)
  figureBody(fig, paint, {
    legs: null,
    skirt: null,
    torso: 'cloth',
    belt: null,
    headgear: army === 'w' ? 'dome' : 'feathers',
  })
  arm(fig, paint, LEFT, REINS_ARM_DIR)
  const spearHand = arm(fig, paint, RIGHT, CHARIOTEER_SPEAR_ARM_DIR).hand
  uprightSpear(
    fig,
    paint,
    spearHand[0],
    spearHand[2],
    CHARIOT_JAVELIN_BOTTOM - fig.position.y,
    CHARIOT_JAVELIN_TOP - fig.position.y,
  )
}

/** Knight: horseman — horse with army saddle cloth and a spear-armed rider. */
const buildHorseman: Builder = (root, paint, army) => {
  plinth(root, paint, KNIGHT_PLINTH_R)
  const mount = paint('mount')
  for (const z of [HORSE_FRONT_LEG_Z, HORSE_REAR_LEG_Z]) {
    for (const side of SIDES) {
      part(root, boxGeo(HORSE_LEG_W, HORSE_LEG_H, HORSE_LEG_D), mount, [
        side * HORSE_LEG_X,
        PLINTH_H + HORSE_LEG_H / 2,
        z,
      ])
    }
  }
  part(root, boxGeo(HORSE_BODY_W, HORSE_BODY_H, HORSE_BODY_L), mount, [
    0,
    HORSE_BODY_BOTTOM + HORSE_BODY_H / 2,
    HORSE_BODY_Z,
  ])
  between(root, (len) => boxGeo(HORSE_NECK_W, len, HORSE_NECK_D), mount, HORSE_NECK_BASE, HORSE_NECK_TOP)
  between(
    root,
    (len) => boxGeo(HORSE_HEAD_W, len, HORSE_HEAD_D),
    mount,
    HORSE_NECK_TOP,
    HORSE_MUZZLE,
  ).name = FRONT_FEATURE
  between(root, (len) => boxGeo(MANE_W, len, MANE_D), paint('hair'), MANE_FROM, MANE_TO)
  between(root, (len) => coneGeo(TAIL_R, len, SEG_TIP), paint('hair'), TAIL_ROOT, TAIL_TIP)
  part(root, boxGeo(SADDLE_SIZE[0], SADDLE_SIZE[1], SADDLE_SIZE[2]), paint('accent'), [
    0,
    HORSE_BODY_TOP - SADDLE_DRAPE,
    RIDER_Z,
  ])
  // Rider: legs astride, then the standard upper body on the saddle.
  part(root, boxGeo(RIDER_LEGS_SIZE[0], RIDER_LEGS_SIZE[1], RIDER_LEGS_SIZE[2]), paint('cloth'), [
    0,
    HORSE_BODY_TOP - RIDER_LEGS_DROP,
    RIDER_Z,
  ])
  const fig = figureGroup(root, 1, HORSE_BODY_TOP + RIDER_SEAT - TORSO_BOTTOM_Y, RIDER_Z)
  figureBody(fig, paint, {
    legs: null,
    skirt: null,
    torso: 'cloth',
    belt: null,
    headgear: army === 'w' ? 'dome' : 'feathers',
  })
  arm(fig, paint, LEFT, REINS_ARM_DIR)
  const spearHand = arm(fig, paint, RIGHT, RIDER_SPEAR_ARM_DIR).hand
  uprightSpear(
    fig,
    paint,
    spearHand[0],
    spearHand[2],
    HORSEMAN_SPEAR_BOTTOM - fig.position.y,
    HORSEMAN_SPEAR_TOP - fig.position.y,
    SPEAR_SHAFT_W,
    SPEAR_HEAD_R,
    HORSEMAN_SPEAR_HEAD_LEN,
  )
}

/** Shared robe, hem, mantle and head of both bishops (world units). */
function robedFigure(root: Group, paint: Paint, hem: ArmyRole, mantle: ArmyRole): void {
  plinth(root, paint, BISHOP_PLINTH_R)
  part(root, cylinderGeo(ROBE_TOP_R, ROBE_BOTTOM_R, ROBE_H, SEG_LARGE), paint('cloth'), [
    0,
    PLINTH_H + ROBE_H / 2,
    0,
  ])
  part(root, cylinderGeo(HEM_TOP_R, HEM_BOTTOM_R, HEM_H, SEG_LARGE), paint(hem), [0, PLINTH_H + HEM_H / 2, 0])
  part(root, cylinderGeo(MANTLE_TOP_R, MANTLE_BOTTOM_R, MANTLE_H, SEG_SMALL), paint(mantle), [
    0,
    MANTLE_BOTTOM_Y + MANTLE_H / 2,
    0,
  ])
  part(root, sphereGeo(ROBED_HEAD_R), paint('skin'), [0, ROBED_HEAD_Y, 0])
}

function robedShoulder(side: Side): Vec3 {
  return [side * ROBED_SHOULDER_X, ROBED_SHOULDER_Y, 0]
}

/** Bishop (w): Israelite prophet with a shepherd's staff. */
const buildProphet: Builder = (root, paint) => {
  robedFigure(root, paint, 'accent', 'accent')
  part(root, domeGeo(HOOD_R), paint('cloth'), [0, ROBED_HEAD_Y, 0], [HOOD_TILT, 0, 0])
  beard(root, paint, ROBED_BEARD_AT, ROBED_BEARD_R, ROBED_BEARD_H)
  // Staff planted ahead of him, taller than he is, with a crook.
  const sleeve = paint('cloth')
  const { hand } = limb(root, sleeve, robedShoulder(RIGHT), PROPHET_STAFF_ARM_DIR, ROBED_ARM_LEN, ROBED_ARM_W)
  const staffTop: Vec3 = [hand[0], PROPHET_STAFF_TOP, hand[2]]
  part(root, boxGeo(PROPHET_STAFF_W, PROPHET_STAFF_TOP - PLINTH_H, PROPHET_STAFF_W), paint('wood'), [
    hand[0],
    (PLINTH_H + PROPHET_STAFF_TOP) / 2,
    hand[2],
  ]).name = FRONT_FEATURE
  between(
    root,
    (len) => boxGeo(PROPHET_STAFF_W, len, PROPHET_STAFF_W),
    paint('wood'),
    staffTop,
    offset(staffTop, PROPHET_CROOK),
  )
  limb(root, sleeve, robedShoulder(LEFT), PROPHET_GESTURE_DIR, ROBED_ARM_LEN, ROBED_ARM_W)
}

/** Bishop (b): priest of Dagon in a fish-head crown. */
const buildDagonPriest: Builder = (root, paint) => {
  robedFigure(root, paint, 'metal', 'metal') // bronze hem + bronze "fish-scale" cape
  const bronze = paint('metal')
  part(root, sphereGeo(FISH_HEAD_R), bronze, [0, FISH_HEAD_Y, 0], undefined, FISH_HEAD_SCALE)
  // Open jaws: each flat pyramid is rooted inside the head top and gapes
  // outward (front jaw toward -z, back jaw toward +z).
  for (const gape of [-JAW_GAPE, JAW_GAPE]) {
    const rootZ = Math.sign(gape) * JAW_ROOT_Z
    part(
      root,
      coneGeo(JAW_R, JAW_H, SEG_TIP),
      bronze,
      [0, JAW_ROOT_Y + (JAW_H / 2) * Math.cos(gape), rootZ + (JAW_H / 2) * Math.sin(gape)],
      [gape, 0, 0],
      [1, 1, JAW_FLATTEN],
    )
  }
  for (const side of SIDES) {
    part(
      root,
      boxGeo(FIN_SIZE[0], FIN_SIZE[1], FIN_SIZE[2]),
      paint('accent'),
      [side * FIN_AT[0], FIN_AT[1], FIN_AT[2]],
      [0, 0, -side * FIN_FLARE],
    )
    part(root, sphereGeo(FISH_EYE_R, TINY_W_SEG, TINY_H_SEG), paint('hair'), [
      side * FISH_EYE_AT[0],
      FISH_EYE_AT[1],
      FISH_EYE_AT[2],
    ])
  }
  // Offering bowl held forward in both hands.
  const sleeve = paint('cloth')
  for (const side of SIDES) {
    const shoulder = robedShoulder(side)
    const toBowl: Vec3 = [
      BOWL_AT[0] + side * BOWL_R * BOWL_GRIP - shoulder[0],
      BOWL_AT[1] - shoulder[1],
      BOWL_AT[2] - shoulder[2],
    ]
    limb(root, sleeve, shoulder, toBowl, ROBED_ARM_LEN, ROBED_ARM_W)
  }
  part(root, coneGeo(BOWL_R, BOWL_H, SEG_SMALL), bronze, BOWL_AT, [Math.PI, 0, 0]).name = FRONT_FEATURE
}

/** Queen (w): Israelite mighty-man with a raised sword and the tekhelet banner. */
const buildMightyMan: Builder = (root, paint) => {
  plinth(root, paint, QUEEN_PLINTH_R)
  const fig = figureGroup(root, CHAMPION_SCALE, PLINTH_H)
  figureBody(fig, paint, { legs: 'skin', skirt: 'cloth', torso: 'cloth', belt: 'sash', headgear: 'dome' })
  // Linen cape: keeps the champion light-toned from his own side's camera (behind him).
  part(fig, boxGeo(CAPE_SIZE[0], CAPE_SIZE[1], CAPE_SIZE[2]), paint('cloth'), CAPE_AT, [CAPE_SWING, 0, 0])
  // Sword raised in the right hand: guard at the fist, blade beyond.
  const swordHand = arm(fig, paint, RIGHT, SWORD_ARM_DIR).hand
  between(
    fig,
    (len) => boxGeo(SWORD_BLADE_W, len, SWORD_BLADE_T),
    paint('blade'),
    swordHand,
    along(swordHand, SWORD_DIR, SWORD_BLADE_LEN),
  )
  between(
    fig,
    (len) => boxGeo(SWORD_GUARD_T, len, SWORD_GUARD_T),
    paint('metal'),
    offset(swordHand, [-SWORD_GUARD_W / 2, 0, 0]),
    offset(swordHand, [SWORD_GUARD_W / 2, 0, 0]),
  )
  // Banner: pole in the left hand, tekhelet flag flying over the head, gold finial on top.
  const poleHand = arm(fig, paint, LEFT, BANNER_ARM_DIR).hand
  const poleTop = QUEEN_STAFF_TOP_FIG - BANNER_FINIAL_H
  const pole = part(fig, boxGeo(BANNER_POLE_W, poleTop, BANNER_POLE_W), paint('wood'), [
    poleHand[0],
    poleTop / 2,
    poleHand[2],
  ])
  pole.name = FRONT_FEATURE
  part(fig, coneGeo(BANNER_FINIAL_R, BANNER_FINIAL_H, SEG_TIP), paint('metal'), [
    poleHand[0],
    poleTop + BANNER_FINIAL_H / 2,
    poleHand[2],
  ])
  part(fig, boxGeo(BANNER_FLAG_SIZE[0], BANNER_FLAG_SIZE[1], BANNER_FLAG_SIZE[2]), paint('accent'), [
    poleHand[0] + BANNER_POLE_W / 2 + BANNER_FLAG_SIZE[0] / 2,
    poleTop - BANNER_FLAG_GAP - BANNER_FLAG_SIZE[1] / 2,
    poleHand[2],
  ])
}

/** Queen (b): Goliath of Gath — the champion figure ×1.25 in bronze, with his great spear. */
const buildGoliath: Builder = (root, paint) => {
  plinth(root, paint, QUEEN_PLINTH_R)
  const fig = figureGroup(root, CHAMPION_SCALE * GOLIATH_SCALE, PLINTH_H)
  // Bronze greaves, crimson kilt, bronze coat of scale armor, bronze helmet (1 Sam 17:5–6).
  figureBody(fig, paint, { legs: 'metal', skirt: 'cloth', torso: 'metal', belt: 'accent', headgear: 'dome' })
  part(fig, boxGeo(CREST_SIZE[0], CREST_SIZE[1], CREST_SIZE[2]), paint('accent'), [0, HEAD_Y + DOME_R, 0])
  beard(fig, paint, [0, HEAD_Y - BEARD_DROP, -BEARD_FORWARD], BEARD_R, BEARD_H)
  between(fig, (len) => boxGeo(JAVELIN_W, len, JAVELIN_W), paint('metal'), JAVELIN_FROM, JAVELIN_TO)
  const spearHand = arm(fig, paint, RIGHT, GOLIATH_SPEAR_ARM_DIR).hand
  uprightSpear(
    fig,
    paint,
    spearHand[0],
    spearHand[2],
    0,
    QUEEN_STAFF_TOP_FIG,
    GOLIATH_SPEAR_W,
    GOLIATH_SPEAR_HEAD_R,
    GOLIATH_SPEAR_HEAD_LEN,
    SEG_SMALL,
  ).name = FRONT_FEATURE
  arm(fig, paint, LEFT, GOLIATH_FIST_DIR)
}

/** King: crowned, seated on a throne atop a two-step dais, twin army banners behind. */
const buildKing: Builder = (root, paint) => {
  plinth(root, paint, KING_DAIS_R, DAIS_STEP_H)
  part(root, cylinderGeo(KING_CARPET_R * PLINTH_BEVEL, KING_CARPET_R, DAIS_STEP_H, SEG_LARGE), paint('accent'), [
    0,
    DAIS_STEP_H + DAIS_STEP_H / 2, // second step, on top of the first
    0,
  ])
  const throne = paint('throne')
  part(root, boxGeo(THRONE_SEAT_SIZE[0], THRONE_SEAT_SIZE[1], THRONE_SEAT_SIZE[2]), throne, [
    0,
    DAIS_TOP + THRONE_SEAT_SIZE[1] / 2,
    THRONE_SEAT_Z,
  ])
  part(root, boxGeo(THRONE_BACK_SIZE[0], THRONE_BACK_SIZE[1], THRONE_BACK_SIZE[2]), throne, [
    0,
    THRONE_SEAT_TOP + THRONE_BACK_SIZE[1] / 2,
    THRONE_BACK_Z,
  ])
  // Twin banners in the army color rising from the throne back.
  const poleH = KING_BANNER_TOP - KING_BANNER_ROOT_Y
  for (const side of SIDES) {
    const x = side * KING_BANNER_X
    part(root, boxGeo(KING_BANNER_POLE_W, poleH, KING_BANNER_POLE_W), paint('wood'), [
      x,
      KING_BANNER_ROOT_Y + poleH / 2,
      THRONE_BACK_Z,
    ])
    part(root, boxGeo(KING_FLAG_SIZE[0], KING_FLAG_SIZE[1], KING_FLAG_SIZE[2]), paint('accent'), [
      x + side * (KING_BANNER_POLE_W / 2 + KING_FLAG_SIZE[0] / 2),
      KING_BANNER_TOP - KING_FLAG_GAP - KING_FLAG_SIZE[1] / 2,
      THRONE_BACK_Z,
    ])
  }
  // The seated king.
  const robe = paint('cloth')
  part(root, boxGeo(KING_LAP_SIZE[0], KING_LAP_SIZE[1], KING_LAP_SIZE[2]), robe, KING_LAP_AT)
  part(
    root,
    boxGeo(KING_ROBE_FRONT_SIZE[0], KING_ROBE_FRONT_SIZE[1], KING_ROBE_FRONT_SIZE[2]),
    robe,
    KING_ROBE_FRONT_AT,
  ).name = FRONT_FEATURE
  part(root, cylinderGeo(KING_TORSO_TOP_R, KING_TORSO_BOTTOM_R, KING_TORSO_H, SEG_SMALL), robe, [
    0,
    KING_TORSO_BOTTOM_Y + KING_TORSO_H / 2,
    KING_TORSO_Z,
  ])
  part(root, sphereGeo(KING_HEAD_R), paint('skin'), KING_HEAD_AT)
  beard(root, paint, KING_BEARD_AT, KING_BEARD_R, KING_BEARD_H)
  part(root, cylinderGeo(KING_CROWN_TOP_R, KING_CROWN_BOTTOM_R, KING_CROWN_H, SEG_SMALL), paint('metal'), [
    KING_HEAD_AT[0],
    KING_CROWN_BOTTOM_Y + KING_CROWN_H / 2,
    KING_HEAD_AT[2],
  ])
  // Crown points: 5 bright cones around the crown rim — THE king marker.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    part(
      root,
      coneGeo(CROWN_POINT_R, CROWN_POINT_H, SEG_TIP),
      paint('accent'),
      [
        KING_HEAD_AT[0] + Math.cos(a) * KING_CROWN_TOP_R,
        KING_CROWN_BOTTOM_Y + KING_CROWN_H + CROWN_POINT_H / 2,
        KING_HEAD_AT[2] + Math.sin(a) * KING_CROWN_TOP_R,
      ],
    )
  }
  for (const side of SIDES) {
    const shoulder: Vec3 = [side * KING_SHOULDER[0], KING_SHOULDER[1], KING_SHOULDER[2]]
    const dir: Vec3 = [side * KING_ARM_DIR[0], KING_ARM_DIR[1], KING_ARM_DIR[2]]
    limb(root, robe, shoulder, dir, KING_ARM_LEN, KING_ARM_W)
  }
}

const BUILDERS: Record<Army, Record<PieceSymbol, Builder>> = {
  w: {
    p: buildSlinger,
    r: buildChariot,
    n: buildHorseman,
    b: buildProphet,
    q: buildMightyMan,
    k: buildKing,
  },
  b: {
    p: buildShieldBearer,
    r: buildChariot,
    n: buildHorseman,
    b: buildDagonPriest,
    q: buildGoliath,
    k: buildKing,
  },
}

/**
 * Build one ancient-warfare piece: a fresh Group (base on y = 0, facing the
 * enemy line) with fresh materials. Safe to call per actor / per mount.
 */
export function buildWarfarePiece(type: PieceSymbol, color: Army): Group {
  const root = new Group()
  root.name = `warfare-${color}${type}`
  BUILDERS[color][type](root, paintFor(color), color)
  const forward = new Object3D()
  forward.name = FORWARD_MARKER
  forward.position.set(0, 0, -1)
  root.add(forward)
  root.rotation.y = FACING_YAW[color]
  return root
}

/**
 * Release a model's per-instance materials. Geometries are shared through the
 * module cache and are deliberately left alone.
 */
export function disposeWarfarePiece(model: Object3D): void {
  const materials = new Set<MeshStandardMaterial>()
  model.traverse((obj) => {
    if (obj instanceof Mesh && obj.material instanceof MeshStandardMaterial) materials.add(obj.material)
  })
  for (const m of materials) m.dispose()
}
