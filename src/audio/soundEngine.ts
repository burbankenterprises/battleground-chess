import { RECIPES, recipeSeconds, renderRecipe } from './sfx'
import type { SoundName } from './sfx'
import type { SoundCue } from './soundCues'

/**
 * Sound engine (Phase 5): owns the single AudioContext and schedules the
 * synthesized cues on the audio clock.
 *
 * Mobile autoplay policy: the context is created lazily and resumed from
 * `unlock()`, which the app calls from user-gesture listeners (pointerup /
 * touchend / click / keydown). Until then every play request is a no-op —
 * nothing is queued, nothing throws. A suspended or interrupted context (iOS
 * backgrounding) is resumed by the next gesture the same way.
 *
 * Graph: per-cue bus → master gain (mute) → compressor → destination.
 */

export const MASTER_VOLUME = 0.7
/** Mute / unmute fade (s) — no clicks. */
export const MUTE_RAMP_S = 0.03
/** A cue already further in the past than this when it is scheduled is dropped (e.g. tab was hidden). */
export const LATE_CUE_TOLERANCE_MS = 120

export type SoundEngineState = 'idle' | 'unavailable' | AudioContextState

/**
 * Whether the page currently holds transient user activation. Where the
 * browser exposes it (navigator.userActivation), creating the context outside
 * activation is skipped — Chrome would log "AudioContext was not allowed to
 * start" (a touch pointerdown is not an activating event; the pointerup /
 * touchend that follows is). Where the API is missing, assume activation.
 */
export function hasUserActivation(): boolean {
  if (typeof navigator === 'undefined') return true
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
  return activation ? activation.isActive : true
}

export type SoundEngine = {
  /** Create / resume the AudioContext. Call from inside a user gesture. */
  unlock: () => void
  /** Sound on/off (the mute toggle). Off also cancels every cue not yet started. */
  setEnabled: (enabled: boolean) => void
  /**
   * Schedule a batch's cues. `startedAtMs` is the batch's sequence clock
   * origin and `nowMs` the current time, both on the performance.now() clock.
   * Cues of the previous batch that have not started yet are cancelled.
   */
  playCues: (cues: readonly SoundCue[], startedAtMs: number, nowMs: number) => void
  /** Play one sound right now. */
  play: (sound: SoundName) => void
  state: () => SoundEngineState
  /** Number of cue buses currently scheduled or ringing (tests / debugging). */
  activeCues: () => number
}

type ScheduledCue = { bus: GainNode; startAt: number; endAt: number }

export function createSoundEngine(
  createContext: () => AudioContext | null,
  initialEnabled = true,
  canStart: () => boolean = hasUserActivation,
): SoundEngine {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let unavailable = false
  let enabled = initialEnabled
  let scheduled: ScheduledCue[] = []

  function build(): boolean {
    if (ctx) return true
    if (unavailable || !canStart()) return false
    try {
      ctx = createContext()
    } catch {
      ctx = null
    }
    if (!ctx) {
      unavailable = true
      return false
    }
    master = ctx.createGain()
    master.gain.value = enabled ? MASTER_VOLUME : 0
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -14
    compressor.knee.value = 12
    compressor.ratio.value = 4
    compressor.attack.value = 0.003
    compressor.release.value = 0.2
    master.connect(compressor)
    compressor.connect(ctx.destination)
    return true
  }

  /** iOS Safari unlocks output only after a sound starts inside a gesture: a one-sample silent blip. */
  function primeOutput(audio: AudioContext): void {
    const blip = audio.createBufferSource()
    blip.buffer = audio.createBuffer(1, 1, audio.sampleRate)
    blip.connect(audio.destination)
    blip.onended = () => blip.disconnect()
    blip.start(0)
  }

  /** Disconnect buses whose sound has fully rung out. */
  function sweep(now: number): void {
    scheduled = scheduled.filter((s) => {
      if (s.endAt > now) return true
      s.bus.disconnect()
      return false
    })
  }

  /** Cancel every cue that has not started yet (ringing ones finish naturally). */
  function cancelPending(now: number): void {
    scheduled = scheduled.filter((s) => {
      if (s.startAt <= now) return true
      s.bus.disconnect()
      return false
    })
  }

  function ready(): AudioContext | null {
    // A suspended context still accepts schedules: they play the moment the
    // gesture-triggered resume lands (and the next batch cancels them if not).
    if (!enabled || !ctx || !master || ctx.state === 'closed') return null
    return ctx
  }

  function schedule(audio: AudioContext, sound: SoundName, startAt: number): void {
    const recipe = RECIPES[sound]
    const bus = audio.createGain()
    bus.connect(master as GainNode)
    renderRecipe(audio, bus, recipe, startAt)
    scheduled.push({ bus, startAt, endAt: startAt + recipeSeconds(recipe) })
  }

  return {
    unlock() {
      if (!build() || !ctx) return
      if (ctx.state !== 'running' && canStart()) {
        primeOutput(ctx)
        ctx.resume().catch(() => undefined)
      }
    },

    setEnabled(next) {
      enabled = next
      if (!ctx || !master) return
      const t = ctx.currentTime
      const gain = master.gain
      gain.cancelScheduledValues(t)
      gain.setValueAtTime(gain.value, t)
      gain.linearRampToValueAtTime(next ? MASTER_VOLUME : 0, t + MUTE_RAMP_S)
      if (!next) cancelPending(t)
    },

    playCues(cues, startedAtMs, nowMs) {
      const audio = ctx
      if (audio) {
        sweep(audio.currentTime)
        cancelPending(audio.currentTime)
      }
      const live = ready()
      if (!live) return
      const t = live.currentTime
      for (const cue of cues) {
        const offsetMs = startedAtMs + cue.delayMs - nowMs
        if (offsetMs < -LATE_CUE_TOLERANCE_MS) continue
        schedule(live, cue.sound, t + Math.max(0, offsetMs) / 1000)
      }
    },

    play(sound) {
      const live = ready()
      if (!live) return
      sweep(live.currentTime)
      schedule(live, sound, live.currentTime)
    },

    state() {
      if (unavailable) return 'unavailable'
      return ctx ? ctx.state : 'idle'
    },

    activeCues() {
      return scheduled.length
    },
  }
}

/** The browser's AudioContext constructor (webkit-prefixed on old iOS), or null. */
export function browserAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null
}
