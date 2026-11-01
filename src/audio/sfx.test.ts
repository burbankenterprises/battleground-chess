import { describe, expect, it } from 'vitest'
import {
  MAX_SOUND_SECONDS,
  MAX_SUMMED_PEAK,
  NOISE_SECONDS,
  RECIPES,
  SILENCE,
  SOUND_NAMES,
  STOP_PAD,
  midiToHz,
  noiseBufferFor,
  noiseSamples,
  recipeSeconds,
  renderRecipe,
  summedPeak,
  voiceSeconds,
} from './sfx'
import type { SoundName } from './sfx'
import { FakeAudioContext, FakeBufferSource, FakeFilter, FakeGain, FakeOscillator } from './fakeAudioContext'

const ctxOf = (fake: FakeAudioContext) => fake as unknown as BaseAudioContext
const nodeOf = (fake: FakeAudioContext) => fake.destination as unknown as AudioNode

describe('sfx recipes (pure data)', () => {
  it('defines exactly the five Phase 5 sounds', () => {
    expect([...SOUND_NAMES].sort()).toEqual(['capture', 'check', 'checkmate', 'move', 'promotion'])
    for (const name of SOUND_NAMES) expect(RECIPES[name].name).toBe(name)
  })

  it.each(SOUND_NAMES)('%s: every voice is well-formed and audible', (name) => {
    const recipe = RECIPES[name]
    expect(recipe.voices.length).toBeGreaterThan(0)
    for (const v of recipe.voices) {
      expect(v.at).toBeGreaterThanOrEqual(0)
      expect(v.envelope.attack).toBeGreaterThan(0)
      expect(v.envelope.release).toBeGreaterThan(0)
      expect(v.envelope.hold).toBeGreaterThanOrEqual(0)
      // Exponential ramps need targets strictly above zero, and above the silence floor.
      expect(v.envelope.peak).toBeGreaterThan(SILENCE)
      expect(v.envelope.peak).toBeLessThanOrEqual(1)
      if (v.source === 'noise') {
        expect(v.freq).toBeUndefined()
      } else {
        expect(v.freq).toBeGreaterThan(20)
        expect(v.freq).toBeLessThan(20000)
        if (v.endFreq !== undefined) expect(v.endFreq).toBeGreaterThan(0)
      }
      if (v.filter) {
        expect(v.filter.frequency).toBeGreaterThan(20)
        expect(v.filter.q).toBeGreaterThan(0)
      }
    }
  })

  it.each(SOUND_NAMES)('%s: stays short and leaves headroom', (name) => {
    expect(recipeSeconds(RECIPES[name])).toBeLessThanOrEqual(MAX_SOUND_SECONDS)
    expect(summedPeak(RECIPES[name])).toBeLessThanOrEqual(MAX_SUMMED_PEAK)
  })

  it('a move thud is short and low; the mate sting is the longest sound', () => {
    expect(recipeSeconds(RECIPES.move)).toBeLessThan(0.3)
    const longest = SOUND_NAMES.reduce<SoundName>(
      (best, n) => (recipeSeconds(RECIPES[n]) > recipeSeconds(RECIPES[best]) ? n : best),
      'move',
    )
    expect(longest).toBe('checkmate')
    for (const v of RECIPES.move.voices) if (v.freq !== undefined) expect(v.freq).toBeLessThan(300)
  })

  it('the promotion chime is a rising arpeggio and the check tick sounds twice', () => {
    const pitched = RECIPES.promotion.voices.filter((v) => v.source === 'sine')
    for (let i = 1; i < pitched.length; i++) {
      expect(pitched[i].at).toBeGreaterThan(pitched[i - 1].at)
      expect(pitched[i].freq as number).toBeGreaterThan(pitched[i - 1].freq as number)
    }
    const tickStarts = new Set(RECIPES.check.voices.map((v) => v.at))
    expect(tickStarts.size).toBe(2)
  })

  it('timing helpers add up', () => {
    const v = RECIPES.move.voices[0]
    expect(voiceSeconds(v)).toBeCloseTo(v.envelope.attack + v.envelope.hold + v.envelope.release + STOP_PAD)
    expect(midiToHz(69)).toBeCloseTo(440)
    expect(midiToHz(81)).toBeCloseTo(880)
  })
})

describe('noise', () => {
  it('is deterministic white noise in [-1, 1)', () => {
    const a = noiseSamples(4096)
    const b = noiseSamples(4096)
    expect(a).toEqual(b)
    let sum = 0
    for (const s of a) {
      expect(s).toBeGreaterThanOrEqual(-1)
      expect(s).toBeLessThan(1)
      sum += s
    }
    // Zero-mean (no DC thump), with real spread.
    expect(Math.abs(sum / a.length)).toBeLessThan(0.05)
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(1.8)
    expect(noiseSamples(64, 'other')).not.toEqual(noiseSamples(64))
  })

  it('builds the shared noise buffer once per context', () => {
    const fake = new FakeAudioContext()
    const first = noiseBufferFor(ctxOf(fake))
    const second = noiseBufferFor(ctxOf(fake))
    expect(second).toBe(first)
    expect(fake.buffers).toHaveLength(1)
    expect(first.length).toBe(fake.sampleRate * NOISE_SECONDS)
  })
})

describe('renderRecipe (Web Audio graph on a stub context)', () => {
  it.each(SOUND_NAMES)('%s: one source per voice, scheduled and wired to the destination', (name) => {
    const fake = new FakeAudioContext()
    const when = 2.5
    renderRecipe(ctxOf(fake), nodeOf(fake), RECIPES[name], when)
    const recipe = RECIPES[name]
    const sources = fake.sources()
    expect(sources).toHaveLength(recipe.voices.length)

    recipe.voices.forEach((voice, i) => {
      const src = sources[i]
      expect(src).toBeInstanceOf(voice.source === 'noise' ? FakeBufferSource : FakeOscillator)
      expect(src.startedAt).toBeCloseTo(when + voice.at)
      expect(src.stoppedAt).toBeCloseTo(when + voice.at + voiceSeconds(voice))
      if (src instanceof FakeOscillator) {
        expect(src.type).toBe(voice.source)
        expect(src.frequency.events[0]).toMatchObject({ kind: 'set', value: voice.freq })
      } else {
        expect((src as FakeBufferSource).loop).toBe(true)
      }
      // source → (filter) → gain → destination
      let node = src.outputs[0]
      if (voice.filter) {
        expect(node).toBeInstanceOf(FakeFilter)
        expect((node as FakeFilter).type).toBe(voice.filter.type)
        node = node.outputs[0]
      }
      expect(node).toBeInstanceOf(FakeGain)
      expect(node.outputs[0]).toBe(fake.destination)

      // Envelope: silence → peak → hold → silence, in time order.
      const events = (node as FakeGain).gain.events
      expect(events.map((e) => e.kind)).toEqual(['set', 'exp', 'set', 'exp'])
      expect(events[0].value).toBe(SILENCE)
      expect(events[1].value).toBe(voice.envelope.peak)
      expect(events[3].value).toBe(SILENCE)
      for (let k = 1; k < events.length; k++) expect(events[k].time).toBeGreaterThanOrEqual(events[k - 1].time)
      expect(src.stoppedAt as number).toBeGreaterThan(events[3].time)
    })
  })

  it('pitch glides end exactly when the envelope does', () => {
    const fake = new FakeAudioContext()
    renderRecipe(ctxOf(fake), nodeOf(fake), RECIPES.move, 0)
    const voice = RECIPES.move.voices[0]
    const osc = fake.sources()[0] as FakeOscillator
    const glide = osc.frequency.events[1]
    expect(glide).toMatchObject({ kind: 'exp', value: voice.endFreq })
    const e = voice.envelope
    expect(glide.time).toBeCloseTo(e.attack + e.hold + e.release)
  })

  it('every node of a voice disconnects when its source ends (no graph leak)', () => {
    const fake = new FakeAudioContext()
    renderRecipe(ctxOf(fake), nodeOf(fake), RECIPES.capture, 0)
    for (const src of fake.sources()) src.end()
    const leaked = fake.nodes.filter((n) => n !== fake.destination && !n.disconnected)
    expect(leaked).toEqual([])
  })
})
