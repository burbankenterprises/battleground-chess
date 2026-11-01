import { describe, expect, it } from 'vitest'
import { LATE_CUE_TOLERANCE_MS, MASTER_VOLUME, MUTE_RAMP_S, createSoundEngine } from './soundEngine'
import { RECIPES, recipeSeconds } from './sfx'
import { asAudioContext, FakeAudioContext, FakeGain } from './fakeAudioContext'

function setup(opts: { enabled?: boolean; activation?: () => boolean } = {}) {
  const contexts: FakeAudioContext[] = []
  const engine = createSoundEngine(
    () => {
      const ctx = new FakeAudioContext()
      contexts.push(ctx)
      return asAudioContext(ctx)
    },
    opts.enabled ?? true,
    opts.activation ?? (() => true),
  )
  return { engine, contexts }
}

/** The master (mute) gain: the first gain node the engine creates. */
const masterOf = (ctx: FakeAudioContext) => ctx.nodes.find((n): n is FakeGain => n instanceof FakeGain) as FakeGain

describe('sound engine — mobile autoplay policy', () => {
  it('creates no AudioContext until the first user gesture', () => {
    const { engine, contexts } = setup()
    engine.play('move')
    engine.playCues([{ sound: 'move', delayMs: 0 }], 0, 0)
    expect(contexts).toHaveLength(0)
    expect(engine.state()).toBe('idle')
  })

  it('unlock() creates ONE context and resumes it; later gestures reuse it', () => {
    const { engine, contexts } = setup()
    engine.unlock()
    engine.unlock()
    expect(contexts).toHaveLength(1)
    expect(contexts[0].resumeCalls).toBe(1) // already running after the first resume
    expect(engine.state()).toBe('running')
  })

  it('primes the output with a silent one-sample blip inside the gesture (iOS unlock)', () => {
    const { engine, contexts } = setup()
    engine.unlock()
    const blip = contexts[0].sources()[0]
    expect(blip).toBeDefined()
    expect(blip.startedAt).toBe(0)
    expect(contexts[0].buffers[0].length).toBe(1)
  })

  it('outside transient user activation, unlock() does nothing (no blocked-autoplay warning)', () => {
    let active = false
    const { engine, contexts } = setup({ activation: () => active })
    engine.unlock()
    expect(contexts).toHaveLength(0)
    active = true
    engine.unlock()
    expect(contexts).toHaveLength(1)
  })

  it('a missing Web Audio implementation degrades to silent no-ops', () => {
    const engine = createSoundEngine(() => null, true, () => true)
    engine.unlock()
    engine.play('capture')
    engine.playCues([{ sound: 'move', delayMs: 0 }], 0, 0)
    expect(engine.state()).toBe('unavailable')
    const throwing = createSoundEngine(() => {
      throw new Error('blocked')
    }, true, () => true)
    expect(() => throwing.unlock()).not.toThrow()
    expect(throwing.state()).toBe('unavailable')
  })

  it('a suspended context (iOS interruption) is resumed by the next gesture', () => {
    const { engine, contexts } = setup()
    engine.unlock()
    contexts[0].state = 'suspended'
    engine.unlock()
    expect(contexts[0].resumeCalls).toBe(2)
  })
})

describe('sound engine — scheduling', () => {
  it('schedules each cue on the audio clock at its offset from the batch start', () => {
    const { engine, contexts } = setup()
    engine.unlock()
    const ctx = contexts[0]
    ctx.currentTime = 10
    const before = ctx.sources().length
    // Batch started 100ms ago; cues at 0ms (100ms late → plays now) and 700ms (600ms from now).
    engine.playCues(
      [
        { sound: 'move', delayMs: 0 },
        { sound: 'capture', delayMs: 700 },
      ],
      1000,
      1100,
    )
    const fresh = ctx.sources().slice(before)
    expect(fresh).toHaveLength(RECIPES.move.voices.length + RECIPES.capture.voices.length)
    const moveStarts = fresh.slice(0, RECIPES.move.voices.length).map((s) => s.startedAt as number)
    expect(Math.min(...moveStarts)).toBeCloseTo(10)
    const captureStarts = fresh.slice(RECIPES.move.voices.length).map((s) => s.startedAt as number)
    expect(Math.min(...captureStarts)).toBeCloseTo(10.6)
    expect(engine.activeCues()).toBe(2)
  })

  it('drops cues that are already well past (e.g. the tab was hidden)', () => {
    const { engine, contexts } = setup()
    engine.unlock()
    const before = contexts[0].sources().length
    engine.playCues([{ sound: 'move', delayMs: 0 }], 0, LATE_CUE_TOLERANCE_MS + 1)
    expect(contexts[0].sources().length).toBe(before)
  })

  it('a new batch cancels the previous batch’s cues that have not started yet', () => {
    const { engine, contexts } = setup()
    engine.unlock()
    const ctx = contexts[0]
    engine.playCues([{ sound: 'checkmate', delayMs: 1500 }], 0, 0)
    expect(engine.activeCues()).toBe(1)
    ctx.currentTime = 0.2 // undo pressed 200ms later, before the sting started
    engine.playCues([], 200, 200)
    expect(engine.activeCues()).toBe(0)
  })

  it('finished cue buses are released on the next schedule', () => {
    const { engine, contexts } = setup()
    engine.unlock()
    const ctx = contexts[0]
    engine.play('move')
    expect(engine.activeCues()).toBe(1)
    ctx.currentTime = recipeSeconds(RECIPES.move) + 0.01
    engine.play('check')
    expect(engine.activeCues()).toBe(1)
  })
})

describe('sound engine — mute', () => {
  it('starts muted when the persisted setting is off, and schedules nothing', () => {
    const { engine, contexts } = setup({ enabled: false })
    engine.unlock()
    const ctx = contexts[0]
    expect(masterOf(ctx).gain.value).toBe(0)
    const before = ctx.sources().length
    engine.play('capture')
    engine.playCues([{ sound: 'move', delayMs: 0 }], 0, 0)
    expect(ctx.sources().length).toBe(before)
  })

  it('muting ramps the master to 0 (no click) and cancels pending cues; unmuting ramps back', () => {
    const { engine, contexts } = setup()
    engine.unlock()
    const ctx = contexts[0]
    const master = masterOf(ctx)
    expect(master.gain.value).toBe(MASTER_VOLUME)
    engine.playCues([{ sound: 'promotion', delayMs: 800 }], 0, 0)
    expect(engine.activeCues()).toBe(1)

    ctx.currentTime = 0.1
    engine.setEnabled(false)
    const ramp = master.gain.events[master.gain.events.length - 1]
    expect(ramp).toMatchObject({ kind: 'linear', value: 0 })
    expect(ramp.time).toBeCloseTo(0.1 + MUTE_RAMP_S)
    expect(engine.activeCues()).toBe(0)

    engine.setEnabled(true)
    expect(master.gain.events[master.gain.events.length - 1]).toMatchObject({ kind: 'linear', value: MASTER_VOLUME })
  })

  it('the setting applies even before the context exists', () => {
    const { engine, contexts } = setup()
    engine.setEnabled(false)
    engine.unlock()
    expect(masterOf(contexts[0]).gain.value).toBe(0)
  })
})
