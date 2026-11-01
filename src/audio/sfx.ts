import { hashString, mulberry32 } from '../three/effects/shatter'

/**
 * Sound effects (Phase 5), synthesized with the Web Audio API alone: no
 * files, no CDN, no dependencies. Each sound is a declarative recipe (pure
 * data, unit-tested) made of short voices; `renderRecipe` turns a recipe into
 * Web Audio nodes scheduled on the context clock.
 *
 *   move       wooden thud: a pitch-dropping low sine + a muffled noise tap
 *   capture    bronze clash: a bright noise burst + inharmonic metal partials + a body thud
 *   check      alarm tick: two short bell ticks
 *   promotion  chime: a rising major arpeggio
 *   checkmate  sting: a dark minor brass chord over a low boom
 */

export type SoundName = 'move' | 'capture' | 'check' | 'promotion' | 'checkmate'

export const SOUND_NAMES: readonly SoundName[] = ['move', 'capture', 'check', 'promotion', 'checkmate']

/** Oscillator waveforms a recipe may use ('custom' needs a PeriodicWave — not used). */
export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle'

/**
 * Gain envelope (seconds): exponential attack from silence to `peak`, hold,
 * then exponential release back to silence.
 */
export type Envelope = { attack: number; peak: number; hold: number; release: number }

export type FilterSpec = { type: 'lowpass' | 'highpass' | 'bandpass'; frequency: number; q: number }

export type Voice = {
  /** An oscillator waveform, or the shared white-noise buffer. */
  source: Waveform | 'noise'
  /** Start offset inside the sound (s). */
  at: number
  /** Oscillator pitch (Hz); glides exponentially to `endFreq` over the voice when given. */
  freq?: number
  endFreq?: number
  envelope: Envelope
  filter?: FilterSpec
}

export type SoundRecipe = { name: SoundName; voices: readonly Voice[] }

/** Silence floor for exponential ramps (they cannot reach 0). */
export const SILENCE = 0.0001
/** Sources stop this long after their envelope ends (the ramp has fully decayed). */
export const STOP_PAD = 0.02
/** Upper bound on any recipe's summed voice peaks (headroom before the master chain). */
export const MAX_SUMMED_PEAK = 1.3
/** Longest any sound may ring (s) — the mate sting is the longest. */
export const MAX_SOUND_SECONDS = 1.8

const env = (attack: number, peak: number, hold: number, release: number): Envelope => ({
  attack,
  peak,
  hold,
  release,
})

/** Equal-tempered pitch of a MIDI note number (A4 = 69 = 440 Hz). */
export function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

export const RECIPES: Readonly<Record<SoundName, SoundRecipe>> = {
  move: {
    name: 'move',
    voices: [
      // Body of the thud: a low sine dropping an octave.
      { source: 'sine', at: 0, freq: 150, endFreq: 70, envelope: env(0.004, 0.55, 0, 0.16) },
      // Contact tap: muffled noise.
      { source: 'noise', at: 0, envelope: env(0.002, 0.3, 0, 0.06), filter: { type: 'lowpass', frequency: 1100, q: 0.7 } },
    ],
  },
  capture: {
    name: 'capture',
    voices: [
      // Strike: bright band of noise.
      { source: 'noise', at: 0, envelope: env(0.002, 0.42, 0.01, 0.2), filter: { type: 'bandpass', frequency: 2600, q: 1.1 } },
      // Ringing bronze: inharmonic partials with fast decays.
      { source: 'triangle', at: 0, freq: 523, endFreq: 508, envelope: env(0.003, 0.22, 0, 0.42), filter: { type: 'highpass', frequency: 300, q: 0.7 } },
      { source: 'square', at: 0.004, freq: 1187, endFreq: 1160, envelope: env(0.003, 0.08, 0, 0.3), filter: { type: 'bandpass', frequency: 1200, q: 3 } },
      { source: 'triangle', at: 0.006, freq: 1734, endFreq: 1702, envelope: env(0.002, 0.1, 0, 0.24) },
      // Shield/body thud underneath.
      { source: 'sine', at: 0, freq: 120, endFreq: 55, envelope: env(0.003, 0.42, 0, 0.2) },
    ],
  },
  check: {
    name: 'check',
    voices: [
      { source: 'square', at: 0, freq: 1320, envelope: env(0.002, 0.16, 0.02, 0.07), filter: { type: 'bandpass', frequency: 1320, q: 5 } },
      { source: 'sine', at: 0, freq: 2640, envelope: env(0.002, 0.08, 0.01, 0.06) },
      { source: 'square', at: 0.15, freq: 1320, envelope: env(0.002, 0.16, 0.02, 0.07), filter: { type: 'bandpass', frequency: 1320, q: 5 } },
      { source: 'sine', at: 0.15, freq: 2640, envelope: env(0.002, 0.08, 0.01, 0.06) },
    ],
  },
  promotion: {
    name: 'promotion',
    voices: [
      // C6 E6 G6 C7, each ringing out under the next.
      ...[84, 88, 91, 96].map(
        (note, i): Voice => ({
          source: 'sine',
          at: i * 0.075,
          freq: midiToHz(note),
          envelope: env(0.005, 0.2, 0.02, 0.55 - i * 0.05),
        }),
      ),
      // Soft shimmer an octave below the top note.
      { source: 'triangle', at: 0.225, freq: midiToHz(84), envelope: env(0.02, 0.12, 0.05, 0.6) },
    ],
  },
  checkmate: {
    name: 'checkmate',
    voices: [
      // Low boom.
      { source: 'sine', at: 0, freq: 90, endFreq: 38, envelope: env(0.006, 0.42, 0.05, 0.9) },
      // A minor brass chord (A2 E3 A3 C4), darkened by a lowpass.
      ...[45, 52, 57, 60].map(
        (note): Voice => ({
          source: 'sawtooth',
          at: 0.02,
          freq: midiToHz(note),
          envelope: env(0.03, 0.11, 0.35, 1.1),
          filter: { type: 'lowpass', frequency: 1300, q: 0.9 },
        }),
      ),
      // Dust swell under the chord.
      { source: 'noise', at: 0, envelope: env(0.08, 0.16, 0.1, 0.7), filter: { type: 'lowpass', frequency: 600, q: 0.7 } },
    ],
  },
}

/** Seconds from a voice's start until its source stops. */
export function voiceSeconds(voice: Voice): number {
  const e = voice.envelope
  return e.attack + e.hold + e.release + STOP_PAD
}

/** Seconds from a sound's start until its last voice stops. */
export function recipeSeconds(recipe: SoundRecipe): number {
  let end = 0
  for (const v of recipe.voices) end = Math.max(end, v.at + voiceSeconds(v))
  return end
}

/** Sum of every voice's peak gain (worst case, all voices at once). */
export function summedPeak(recipe: SoundRecipe): number {
  return recipe.voices.reduce((sum, v) => sum + v.envelope.peak, 0)
}

/** Length of the shared white-noise buffer (the source loops it). */
export const NOISE_SECONDS = 1

/**
 * Deterministic white noise in [-1, 1) — the same samples every run, so the
 * sounds are reproducible and unit-testable.
 */
export function noiseSamples(length: number, seedKey = 'bgc-noise'): Float32Array {
  const rand = mulberry32(hashString(seedKey))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = rand() * 2 - 1
  return out
}

/** Shared noise buffer per context (built once, on first use). */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

export function noiseBufferFor(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx)
  if (!buffer) {
    const length = Math.max(1, Math.round(ctx.sampleRate * NOISE_SECONDS))
    buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    buffer.getChannelData(0).set(noiseSamples(length))
    noiseBuffers.set(ctx, buffer)
  }
  return buffer
}

/**
 * Schedule one voice on `ctx`, starting at context time `when`, into
 * `destination`: source → (filter) → envelope gain → destination. The nodes
 * disconnect themselves when the source ends.
 */
function renderVoice(ctx: BaseAudioContext, destination: AudioNode, voice: Voice, when: number): void {
  const t0 = when + voice.at
  const e = voice.envelope
  const tPeak = t0 + e.attack
  const tHold = tPeak + e.hold
  const tEnd = tHold + e.release
  const tStop = tEnd + STOP_PAD

  let source: AudioScheduledSourceNode
  if (voice.source === 'noise') {
    const noise = ctx.createBufferSource()
    noise.buffer = noiseBufferFor(ctx)
    noise.loop = true
    source = noise
  } else {
    const osc = ctx.createOscillator()
    osc.type = voice.source
    const f0 = voice.freq ?? 440
    osc.frequency.setValueAtTime(f0, t0)
    if (voice.endFreq !== undefined && voice.endFreq !== f0) {
      osc.frequency.exponentialRampToValueAtTime(voice.endFreq, tEnd)
    }
    source = osc
  }

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(SILENCE, t0)
  gain.gain.exponentialRampToValueAtTime(e.peak, tPeak)
  gain.gain.setValueAtTime(e.peak, tHold)
  gain.gain.exponentialRampToValueAtTime(SILENCE, tEnd)

  let filter: BiquadFilterNode | null = null
  if (voice.filter) {
    filter = ctx.createBiquadFilter()
    filter.type = voice.filter.type
    filter.frequency.setValueAtTime(voice.filter.frequency, t0)
    filter.Q.setValueAtTime(voice.filter.q, t0)
    source.connect(filter)
    filter.connect(gain)
  } else {
    source.connect(gain)
  }
  gain.connect(destination)

  source.onended = () => {
    source.disconnect()
    filter?.disconnect()
    gain.disconnect()
  }
  source.start(t0)
  source.stop(tStop)
}

/** Schedule every voice of `recipe` at context time `when` (seconds). */
export function renderRecipe(ctx: BaseAudioContext, destination: AudioNode, recipe: SoundRecipe, when: number): void {
  for (const voice of recipe.voices) renderVoice(ctx, destination, voice, when)
}
