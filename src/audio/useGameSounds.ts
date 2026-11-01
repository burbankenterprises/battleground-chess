import { useEffect } from 'react'
import { useGameStore } from '../game/store'
import { soundCuesForBatch } from './soundCues'
import { browserAudioContext, createSoundEngine } from './soundEngine'
import { useSoundSettings } from './soundSettings'

/** The app's single sound engine (its AudioContext is created on the first user gesture). */
export const soundEngine = createSoundEngine(browserAudioContext, useSoundSettings.getState().enabled)

/** User-activation events that may unlock audio (Chrome: pointerup/touchend/click/keydown; iOS: touchend). */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const

/**
 * Wire the battle sounds to the game: unlock audio on any user gesture,
 * follow the mute setting, and schedule each new animation batch's cues on
 * its sequence clock. Mounted once at the app root (the menu's first tap can
 * already unlock audio).
 */
export function useGameSounds(): void {
  useEffect(() => {
    const unlock = () => soundEngine.unlock()
    for (const g of GESTURES) window.addEventListener(g, unlock, { capture: true, passive: true })

    soundEngine.setEnabled(useSoundSettings.getState().enabled)
    const offSettings = useSoundSettings.subscribe((s, prev) => {
      if (s.enabled !== prev.enabled) soundEngine.setEnabled(s.enabled)
    })
    const offGame = useGameStore.subscribe((s, prev) => {
      if (s.animSeq === prev.animSeq) return
      soundEngine.playCues(soundCuesForBatch(s.animCommands), s.animStartedAt, performance.now())
    })

    return () => {
      for (const g of GESTURES) window.removeEventListener(g, unlock, { capture: true })
      offSettings()
      offGame()
    }
  }, [])
}
