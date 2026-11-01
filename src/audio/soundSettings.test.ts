import { describe, expect, it } from 'vitest'
import { SOUND_STORAGE_KEY, createSoundSettings, readSoundEnabled, writeSoundEnabled } from './soundSettings'
import type { StorageLike } from './soundSettings'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('sound setting persistence', () => {
  it('defaults to ON (no stored value, no storage at all, unreadable storage)', () => {
    expect(readSoundEnabled(memoryStorage())).toBe(true)
    expect(readSoundEnabled(null)).toBe(true)
    expect(readSoundEnabled(throwingStorage)).toBe(true)
  })

  it('only an explicit "off" disables sound', () => {
    expect(readSoundEnabled(memoryStorage({ [SOUND_STORAGE_KEY]: 'off' }))).toBe(false)
    expect(readSoundEnabled(memoryStorage({ [SOUND_STORAGE_KEY]: 'on' }))).toBe(true)
    expect(readSoundEnabled(memoryStorage({ [SOUND_STORAGE_KEY]: 'garbage' }))).toBe(true)
  })

  it('writes round-trip, and a failing write never throws', () => {
    const storage = memoryStorage()
    writeSoundEnabled(storage, false)
    expect(storage.data[SOUND_STORAGE_KEY]).toBe('off')
    expect(readSoundEnabled(storage)).toBe(false)
    writeSoundEnabled(storage, true)
    expect(readSoundEnabled(storage)).toBe(true)
    expect(() => writeSoundEnabled(throwingStorage, false)).not.toThrow()
    expect(() => writeSoundEnabled(null, false)).not.toThrow()
  })

  it('the settings store loads the persisted value and persists every toggle', () => {
    const storage = memoryStorage({ [SOUND_STORAGE_KEY]: 'off' })
    const store = createSoundSettings(() => storage)
    expect(store.getState().enabled).toBe(false)
    store.getState().toggle()
    expect(store.getState().enabled).toBe(true)
    expect(storage.data[SOUND_STORAGE_KEY]).toBe('on')
    store.getState().toggle()
    expect(store.getState().enabled).toBe(false)
    expect(storage.data[SOUND_STORAGE_KEY]).toBe('off')
    // A fresh store (next page load) restores it.
    expect(createSoundSettings(() => storage).getState().enabled).toBe(false)
  })
})
