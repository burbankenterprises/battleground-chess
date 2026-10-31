import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Group, Object3D } from 'three'
import type {
  ActorId,
  ActorSnapshot,
  AlarmCommand,
  AnimCommand,
  PromotionTransformCommand,
} from '../../game/types'
import { ALARM_PERIOD_MS, isLoopingCommand, sequenceDurationMs } from '../../anim/director'
import { squareToXZ } from '../coords'
import { ALARM_RAMP_MS, actorPoseAt, withAlarm } from './actorPose'
import type { ActorPose } from './actorPose'
import { PIECE_DIMS } from './pieceDims'
import { PlaceholderPiece } from './PlaceholderPiece'

/**
 * PieceActor — one persistent 3D piece. It never decides WHAT happens: the
 * director's timeline (commands with delayMs/durationMs on the move's sequence
 * clock) is evaluated every frame by the pure `actorPoseAt`, and this
 * component only copies that pose onto its scene graph:
 *
 *   root (position, visibility)
 *    └ pivot (base-rim point on the tilt side)
 *       └ tilt (axis-angle rotation about that rim point: lean / topple / wobble)
 *          └ unpivot
 *             └ scaler (squash / promotion scale about the base center; tint)
 *                ├ pre-swap  PlaceholderPiece(fromType)   — only during a promotion
 *                └ current   PlaceholderPiece(actor.type)
 *
 * When every one-shot command of the current batch has finished it reports
 * `onSettled(id, seq)` once, so the store can release the input lock.
 * Visuals stay PlaceholderPiece — real models arrive in Phase 4.
 */

type Props = {
  actor: ActorSnapshot
  /** This actor's commands in the current animation batch (undefined = idle). */
  commands?: readonly AnimCommand[]
  /** Current animation batch id. */
  seq: number
  /** performance.now() at which the batch's sequence clock started. */
  startedAt: number
  onSettled: (id: ActorId, seq: number) => void
}

const NO_COMMANDS: readonly AnimCommand[] = []
const FLASH_COLOR = new Color('#ffffff')
const ALARM_COLOR = new Color('#ff2a1a')
/** Emissive intensity at full promotion flash / full alarm glow. */
const FLASH_INTENSITY = 1.8
const ALARM_INTENSITY = 1.1

type BaseEmissive = { color: Color; intensity: number }

/**
 * Blend every standard material under `root` from its own emissive toward
 * `tint` by `k` (0 restores the original exactly). Originals are remembered on
 * first touch, so freshly mounted geometry (a promotion swap) is handled too.
 */
function applyTint(root: Object3D, tint: Color, k: number, peakIntensity: number): void {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!(m instanceof MeshStandardMaterial)) continue
      let base = m.userData.baseEmissive as BaseEmissive | undefined
      if (!base) {
        base = { color: m.emissive.clone(), intensity: m.emissiveIntensity }
        m.userData.baseEmissive = base
      }
      m.emissive.copy(base.color).lerp(tint, k)
      m.emissiveIntensity = base.intensity + (peakIntensity - base.intensity) * k
    }
  })
}

export function PieceActor({ actor, commands, seq, startedAt, onSettled }: Props) {
  const rootRef = useRef<Group>(null)
  const pivotRef = useRef<Group>(null)
  const tiltRef = useRef<Group>(null)
  const unpivotRef = useRef<Group>(null)
  const scalerRef = useRef<Group>(null)
  const preSwapRef = useRef<Group>(null)
  const currentRef = useRef<Group>(null)

  /** Batch id we already reported settled for. */
  const reportedSeq = useRef<number | null>(null)
  /** Check-alarm loop state: phase (ms) + fade weight, so it eases in AND out. */
  const alarm = useRef({ phase: 0, weight: 0 })
  const lastFrameAt = useRef<number | null>(null)
  const lastTint = useRef(0)
  /** Rest key already applied while idle (skip redundant per-frame work). */
  const idleKey = useRef<string | null>(null)
  const axis = useRef(new Vector3())

  // Mount at the actor's square (later motion is driven by commands).
  const [initialPosition] = useState<[number, number, number]>(() => {
    const [x, z] = squareToXZ(actor.square)
    return [x, 0, z]
  })

  const cmds = commands ?? NO_COMMANDS
  const promotion = useMemo(
    () => cmds.find((c): c is PromotionTransformCommand => c.type === 'promotion-transform'),
    [cmds],
  )
  const alarmCmd = useMemo(
    () => cmds.find((c): c is AlarmCommand => c.type === 'alarm'),
    [cmds],
  )
  /** When this actor's last one-shot command ends (null = nothing to settle). */
  const oneShotEnd = useMemo(
    () => (cmds.some((c) => !isLoopingCommand(c)) ? sequenceDurationMs(cmds) : null),
    [cmds],
  )

  function applyPose(pose: ActorPose) {
    const root = rootRef.current
    const pivot = pivotRef.current
    const tilt = tiltRef.current
    const unpivot = unpivotRef.current
    const scaler = scalerRef.current
    if (!root || !pivot || !tilt || !unpivot || !scaler) return

    root.position.set(pose.x, pose.y, pose.z)
    root.visible = pose.visible

    // Tilt about the base rim on the tilt side, so a toppling piece rolls over
    // its edge and never sinks into the board.
    const r = PIECE_DIMS[pose.type].radius
    pivot.position.set(pose.tiltX * r, 0, pose.tiltZ * r)
    axis.current.set(pose.tiltZ, 0, -pose.tiltX) // up × tiltDir
    tilt.quaternion.setFromAxisAngle(axis.current, pose.tiltAngle)
    unpivot.position.set(-pose.tiltX * r, 0, -pose.tiltZ * r)
    scaler.scale.set(pose.scaleXZ, pose.scaleY, pose.scaleXZ)

    // Promotion: swap geometry on the exact frame the timeline says (no remount).
    const showPre = pose.type !== actor.type
    if (preSwapRef.current) preSwapRef.current.visible = showPre
    if (currentRef.current) currentRef.current.visible = !showPre

    // Promotion flash (white) takes precedence over the check-alarm glow (red).
    let k = 0
    let tint = FLASH_COLOR
    let peak = FLASH_INTENSITY
    if (pose.flash > 0) {
      k = pose.flash
    } else if (pose.alarmGlow > 0) {
      k = pose.alarmGlow
      tint = ALARM_COLOR
      peak = ALARM_INTENSITY
    }
    if (k > 0 || lastTint.current > 0) {
      applyTint(scaler, tint, k, peak)
      lastTint.current = k
    }
  }

  useFrame(() => {
    const now = performance.now()
    const dt = lastFrameAt.current === null ? 0 : now - lastFrameAt.current
    lastFrameAt.current = now
    const t = now - startedAt

    // Check alarm: follows its command while present; fades out once check is resolved.
    const a = alarm.current
    if (alarmCmd && t >= alarmCmd.delayMs) {
      a.phase = t - alarmCmd.delayMs
      a.weight = Math.min(1, a.phase / ALARM_RAMP_MS)
    } else if (a.weight > 0) {
      a.phase += dt
      a.weight = Math.max(0, a.weight - dt / ALARM_RAMP_MS)
    }

    // Idle fast path: nothing scheduled and no alarm fading → apply rest once.
    if (cmds.length === 0 && a.weight === 0) {
      const key = `${actor.square}:${actor.type}`
      if (idleKey.current === key) return
      idleKey.current = key
    } else {
      idleKey.current = null
    }

    let pose = actorPoseAt(actor, cmds, t)
    if (a.weight > 0) {
      pose = withAlarm(pose, a.phase, a.weight, alarmCmd?.durationMs ?? ALARM_PERIOD_MS)
    }
    applyPose(pose)

    if (oneShotEnd !== null && t >= oneShotEnd && reportedSeq.current !== seq) {
      reportedSeq.current = seq
      onSettled(actor.id, seq)
    }
  })

  return (
    <group ref={rootRef} position={initialPosition}>
      <group ref={pivotRef}>
        <group ref={tiltRef}>
          <group ref={unpivotRef}>
            <group ref={scalerRef}>
              {promotion && (
                <group key="pre-swap" ref={preSwapRef}>
                  <PlaceholderPiece type={promotion.fromType} color={actor.color} />
                </group>
              )}
              <group key="current" ref={currentRef} visible={!promotion}>
                <PlaceholderPiece type={actor.type} color={actor.color} />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}
