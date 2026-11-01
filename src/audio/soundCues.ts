import type { AnimCommand } from '../game/types'
import type { SoundName } from './sfx'

/**
 * Battle sound cues (Phase 5): which sound plays when, read straight off the
 * director's timeline for a batch — the same clock the pieces animate on, so
 * every sound lands on its visual beat. Pure: no audio here.
 *
 *   quiet move    → `move` thud the instant the piece lands
 *   capture       → `capture` clash at impact (the victim's death start)
 *   promotion     → `promotion` chime at the geometry swap (end of shrink + flash)
 *   check         → `check` tick when the king's alarm starts
 *   checkmate     → `checkmate` sting when the mated king starts to fall
 *
 * Position resets (undo / new game) carry no move command and stay silent,
 * even when they restore a check.
 */

export type SoundCue = { sound: SoundName; delayMs: number }

/** Cues of the same sound closer together than this collapse into one (simultaneous landings). */
export const CUE_MERGE_MS = 40

export function soundCuesForBatch(commands: readonly AnimCommand[]): SoundCue[] {
  if (!commands.some((c) => c.type === 'move')) return []
  const cues: SoundCue[] = []
  for (const c of commands) {
    switch (c.type) {
      case 'move':
        // A capture approach stops short of its square: silent — the clash covers it.
        if (c.stopShortTiles === 0) cues.push({ sound: 'move', delayMs: c.delayMs + c.durationMs - c.landMs })
        break
      case 'death':
        cues.push({ sound: 'capture', delayMs: c.delayMs })
        break
      case 'promotion-transform':
        cues.push({ sound: 'promotion', delayMs: c.delayMs + c.swapAtMs })
        break
      case 'alarm':
        cues.push({ sound: 'check', delayMs: c.delayMs })
        break
      case 'checkmate-fall':
        cues.push({ sound: 'checkmate', delayMs: c.delayMs })
        break
      default:
        // lunge / settle-impact are part of the capture beat.
        break
    }
  }
  cues.sort((a, b) => a.delayMs - b.delayMs)
  const merged: SoundCue[] = []
  for (const cue of cues) {
    const duplicate = merged.some(
      (m) => m.sound === cue.sound && Math.abs(m.delayMs - cue.delayMs) < CUE_MERGE_MS,
    )
    if (!duplicate) merged.push(cue)
  }
  return merged
}
