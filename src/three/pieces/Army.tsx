import { useMemo } from 'react'
import { useGameStore } from '../../game/store'
import { PieceActor } from './PieceActor'
import type { ActorId, AnimCommand } from '../../game/types'

/**
 * Army — renders every scene actor as a persistent PieceActor keyed by its
 * stable actor id (NOT by square), so moves animate instead of remounting.
 * `sceneActors` keeps a captured piece mounted while it plays its death; the
 * store drops it when the battle sequence settles.
 */
export function Army() {
  const sceneActors = useGameStore((s) => s.sceneActors)
  const animCommands = useGameStore((s) => s.animCommands)
  const animSeq = useGameStore((s) => s.animSeq)
  const animStartedAt = useGameStore((s) => s.animStartedAt)
  const settleActor = useGameStore((s) => s.settleActor)

  // actorId → its commands in the current batch (director timeline order).
  const commandsById = useMemo(() => {
    const map = new Map<ActorId, AnimCommand[]>()
    for (const c of animCommands) {
      const list = map.get(c.actorId)
      if (list) list.push(c)
      else map.set(c.actorId, [c])
    }
    return map
  }, [animCommands])

  return (
    <group>
      {sceneActors.map((a) => (
        <PieceActor
          key={a.id}
          actor={a}
          commands={commandsById.get(a.id)}
          seq={animSeq}
          startedAt={animStartedAt}
          onSettled={settleActor}
        />
      ))}
    </group>
  )
}
