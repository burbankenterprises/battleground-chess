import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { createPieceTracker } from '../game/pieceTracker'
import { moveOutcomeOf } from '../game/outcome'
import { directMove, directPositionAlarm } from '../anim/director'
import type { AnimCommand } from '../game/types'
import { CUE_MERGE_MS, soundCuesForBatch } from './soundCues'
import type { SoundCue } from './soundCues'

/**
 * Plays SAN moves on a real chess.js game + tracker and returns the
 * director's commands for the LAST move — the exact batch the store
 * publishes, so the cue mapping is tested against real timelines.
 */
function lastBatch(sans: string[]): AnimCommand[] {
  const game = new Chess()
  const tracker = createPieceTracker()
  tracker.syncFromBoard(game.board())
  let commands: AnimCommand[] = []
  for (const san of sans) {
    const move = game.move(san)
    const events = tracker.applyMove(move)
    commands = directMove(move, (sq: Square) => tracker.actorIdAt(sq), events, moveOutcomeOf(game))
  }
  return commands
}

const names = (cues: SoundCue[]) => cues.map((c) => c.sound)

describe('soundCuesForBatch — sounds land on the director timeline', () => {
  it('quiet move: one thud the instant the piece lands', () => {
    const commands = lastBatch(['e4'])
    const walk = commands.find((c) => c.type === 'move')
    if (walk?.type !== 'move') throw new Error('expected a move command')
    expect(soundCuesForBatch(commands)).toEqual([
      { sound: 'move', delayMs: walk.durationMs - walk.landMs },
    ])
  })

  it('capture: a single clash at impact (no thud for the stop-short approach)', () => {
    const commands = lastBatch(['e4', 'd5', 'exd5'])
    const death = commands.find((c) => c.type === 'death')
    expect(death).toBeDefined()
    expect(soundCuesForBatch(commands)).toEqual([{ sound: 'capture', delayMs: death?.delayMs }])
  })

  it('en passant clashes too', () => {
    const cues = soundCuesForBatch(lastBatch(['e4', 'Nf6', 'e5', 'd5', 'exd6']))
    expect(names(cues)).toEqual(['capture'])
  })

  it('castling: king and rook land together → one merged thud', () => {
    const cues = soundCuesForBatch(lastBatch(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']))
    expect(names(cues)).toEqual(['move'])
  })

  it('check: thud on landing, then the alarm tick when the king starts to alarm', () => {
    const commands = lastBatch(['e4', 'f5', 'Qh5+'])
    const alarm = commands.find((c) => c.type === 'alarm')
    const cues = soundCuesForBatch(commands)
    expect(names(cues)).toEqual(['move', 'check'])
    expect(cues[1].delayMs).toBe(alarm?.delayMs)
  })

  it("checkmate (fool's mate): thud, then the sting as the king starts to fall — no check tick", () => {
    const commands = lastBatch(['f3', 'e5', 'g4', 'Qh4#'])
    const fall = commands.find((c) => c.type === 'checkmate-fall')
    const cues = soundCuesForBatch(commands)
    expect(names(cues)).toEqual(['move', 'checkmate'])
    expect(cues[1].delayMs).toBe(fall?.delayMs)
  })

  it('promotion by capture: clash at impact, then the chime at the geometry swap', () => {
    const commands = lastBatch(['d4', 'e5', 'dxe5', 'f6', 'exf6', 'Nc6', 'fxg7', 'a6', 'gxh8=Q'])
    const promo = commands.find((c) => c.type === 'promotion-transform')
    if (promo?.type !== 'promotion-transform') throw new Error('expected a promotion')
    const cues = soundCuesForBatch(commands)
    expect(names(cues)).toEqual(['capture', 'promotion'])
    expect(cues[1].delayMs).toBe(promo.delayMs + promo.swapAtMs)
  })

  it('cues come out in time order', () => {
    for (const sans of [['e4', 'f5', 'Qh5+'], ['f3', 'e5', 'g4', 'Qh4#'], ['e4', 'd5', 'exd5']]) {
      const cues = soundCuesForBatch(lastBatch(sans))
      for (let i = 1; i < cues.length; i++) expect(cues[i].delayMs).toBeGreaterThanOrEqual(cues[i - 1].delayMs)
    }
  })

  it('position resets are silent — even a restored check alarm (undo / new game)', () => {
    const game = new Chess()
    for (const san of ['e4', 'f5', 'Qh5+']) game.move(san)
    const tracker = createPieceTracker()
    tracker.syncFromBoard(game.board())
    const alarm = directPositionAlarm(moveOutcomeOf(game), (sq) => tracker.actorIdAt(sq))
    expect(alarm).not.toBeNull()
    expect(soundCuesForBatch(alarm ? [alarm] : [])).toEqual([])
    expect(soundCuesForBatch([])).toEqual([])
  })

  it('same-sound cues closer than CUE_MERGE_MS collapse; distinct sounds never do', () => {
    const at = (actorId: string, delayMs: number): AnimCommand => ({
      type: 'move',
      actorId,
      delayMs,
      durationMs: 600,
      from: 'a2',
      to: 'a3',
      arc: false,
      stopShortTiles: 0,
      landMs: 100,
    })
    expect(soundCuesForBatch([at('x', 0), at('y', CUE_MERGE_MS - 1)])).toHaveLength(1)
    expect(soundCuesForBatch([at('x', 0), at('y', CUE_MERGE_MS)])).toHaveLength(2)
  })
})
