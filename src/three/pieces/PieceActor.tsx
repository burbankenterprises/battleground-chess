import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { ActorId, ActorSnapshot, AnimCommand } from '../../game/types'
import { squareToXZ } from '../coords'
import { PlaceholderPiece } from './PlaceholderPiece'

/**
 * PieceActor — one persistent 3D piece. It owns its world position and lerps
 * toward a target square over a fixed duration when the director hands it a
 * move command, instead of being remounted on every board change. Knights hop
 * in a parabola; everyone else slides with a subtle walking bob. When the walk
 * finishes it calls `onSettled` so the store can release the input lock.
 *
 * Visuals stay PlaceholderPiece — real models arrive in Phase 4.
 */

type Props = {
  actor: ActorSnapshot
  /** The current move's command for this actor, if it is moving this turn. */
  command?: AnimCommand
  onSettled: (id: ActorId) => void
}

type Anim = {
  active: boolean
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  start: number
  duration: number
  arc: boolean
  /** Number of walking bobs across the slide (≈ one per tile). */
  steps: number
}

/** Knight hop apex height. */
const ARC_HEIGHT = 0.65
/** Subtle walk-bob amplitude for non-knights. */
const BOB_HEIGHT = 0.08

/** Cubic ease-in-out (matches the camera rig's easing). */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Chebyshev tile distance between two squares (a king-step counts 1). */
function tileSteps(from: string, to: string): number {
  const df = Math.abs(from.charCodeAt(0) - to.charCodeAt(0))
  const dr = Math.abs(Number(from[1]) - Number(to[1]))
  return Math.max(df, dr, 1)
}

export function PieceActor({ actor, command, onSettled }: Props) {
  const ref = useRef<Group>(null)
  const anim = useRef<Anim | null>(null)
  // Identity of the command we've already begun playing, so re-renders that
  // re-pass the same command don't restart the walk.
  const playedCommand = useRef<AnimCommand | null>(null)

  // Place the actor at its square on first mount (no animation on appear).
  useEffect(() => {
    const g = ref.current
    if (!g) return
    const [x, z] = squareToXZ(actor.square)
    g.position.set(x, 0, z)
    // Run once on mount only: later position changes are driven by commands.
  }, [])

  // Begin a walk whenever a fresh command targets this actor.
  useEffect(() => {
    if (!command || command === playedCommand.current) return
    playedCommand.current = command
    const g = ref.current
    const [toX, toZ] = squareToXZ(command.to)
    const [cmdFromX, cmdFromZ] = squareToXZ(command.from)
    // Animate from the live position when available (handles chained moves),
    // else from the command's declared origin.
    anim.current = {
      active: true,
      fromX: g ? g.position.x : cmdFromX,
      fromZ: g ? g.position.z : cmdFromZ,
      toX,
      toZ,
      start: performance.now(),
      duration: command.durationMs,
      arc: command.arc === true,
      steps: tileSteps(command.from, command.to),
    }
  }, [command])

  useFrame(() => {
    const g = ref.current
    const a = anim.current
    if (!g || !a || !a.active) return

    const t = Math.min((performance.now() - a.start) / a.duration, 1)
    const e = easeInOut(t)
    g.position.x = a.fromX + (a.toX - a.fromX) * e
    g.position.z = a.fromZ + (a.toZ - a.fromZ) * e

    // Vertical motion: knights arc; everyone else bobs ≈ once per tile.
    if (a.arc) {
      g.position.y = ARC_HEIGHT * 4 * t * (1 - t) // parabola, apex at t=0.5
    } else {
      g.position.y = BOB_HEIGHT * Math.abs(Math.sin(t * Math.PI * a.steps))
    }

    if (t >= 1) {
      g.position.set(a.toX, 0, a.toZ)
      a.active = false
      onSettled(actor.id)
    }
  })

  return (
    <group ref={ref}>
      <PlaceholderPiece type={actor.type} color={actor.color} />
    </group>
  )
}
