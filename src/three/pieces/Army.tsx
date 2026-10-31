import { useMemo } from 'react'
import { useGameStore } from '../../game/store'
import { PieceActor } from './PieceActor'
import type { AnimCommand } from '../../game/types'

/**
 * Army — renders every piece as a persistent PieceActor keyed by its stable
 * actor id (NOT by square), so moves animate instead of remounting. Dead actors
 * are dropped from the scene (Phase 3 will give them a death animation first).
 */
export function Army() {
  const actors = useGameStore((s) => s.actors)
  const animCommands = useGameStore((s) => s.animCommands)
  const settleActor = useGameStore((s) => s.settleActor)

  // actorId → its command for the current move (if any).
  const commandById = useMemo(() => {
    const map = new Map<string, AnimCommand>()
    for (const c of animCommands) map.set(c.actorId, c)
    return map
  }, [animCommands])

  return (
    <group>
      {actors
        .filter((a) => a.alive)
        .map((a) => (
          <PieceActor
            key={a.id}
            actor={a}
            command={commandById.get(a.id)}
            onSettled={settleActor}
          />
        ))}
    </group>
  )
}
