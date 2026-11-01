import { create } from 'zustand'

/**
 * Sound on/off setting (Phase 5): default ON, persisted to localStorage.
 * Storage access is fully guarded — private modes and sandboxed frames that
 * throw on localStorage simply fall back to the default.
 */

export const SOUND_STORAGE_KEY = 'battleground-chess:sound'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Persisted setting: only an explicit 'off' disables sound. */
export function readSoundEnabled(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(SOUND_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeSoundEnabled(storage: StorageLike | null, enabled: boolean): void {
  try {
    storage?.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Storage full / blocked: the setting still applies for this session.
  }
}

/** window.localStorage when it exists and is reachable, else null. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export type SoundSettings = {
  enabled: boolean
  toggle: () => void
}

/** Settings store factory (tests pass their own storage). */
export function createSoundSettings(storage: () => StorageLike | null) {
  return create<SoundSettings>((set, get) => ({
    enabled: readSoundEnabled(storage()),
    toggle: () => {
      const enabled = !get().enabled
      writeSoundEnabled(storage(), enabled)
      set({ enabled })
    },
  }))
}

export const useSoundSettings = createSoundSettings(browserStorage)
