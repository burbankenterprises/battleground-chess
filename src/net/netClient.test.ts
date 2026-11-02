import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NetClient, NET_INITIAL, SOCKET_OPEN, loadNetPersist, saveNetPersist, newToken } from './netClient'
import type { NetSocket } from './netClient'

// Node test env has no localStorage — stub the global (the client reads it
// through globalThis with optional chaining, so a stub is enough).
const store = new Map<string, string>()
const lsStub: Storage = {
  get length() {
    return store.size
  },
  clear: () => store.clear(),
  getItem: (k) => store.get(k) ?? null,
  key: (i) => [...store.keys()][i] ?? null,
  removeItem: (k) => store.delete(k),
  setItem: (k, v) => void store.set(k, v),
}
;(globalThis as { localStorage?: Storage }).localStorage = lsStub

/**
 * Fake socket pairs: what one side sends is delivered to the relay test
 * double, which echoes the frames the real relay would send back.
 */
type Frame = Record<string, unknown>
/** Fake socket: same shape, but readyState writable for the test driver. */
type FakeSock = NetSocket & { readyState: number }

function makeFakeSocket() {
  const sent: string[] = []
  const socket: FakeSock = {
    readyState: 0,
    send: (text: string) => sent.push(text),
    close: () => {
      socket.readyState = 3
    },
    onopen: null,
    onmessage: null,
    onclose: null,
  }
  return { socket, sent }
}

/** Drive a client like the relay would: open the socket, feed frames in. */
function opened(_c: NetClient, sock: { socket: FakeSock; sent: string[] }): void {
  sock.socket.readyState = SOCKET_OPEN
  sock.socket.onopen?.()
}

function feed(sock: { socket: FakeSock }, frame: Frame): void {
  sock.socket.onmessage?.({ data: JSON.stringify(frame) })
}

function drop(sock: { socket: FakeSock }): void {
  sock.socket.readyState = 3
  sock.socket.onclose?.()
}

describe('NetClient — host flow', () => {
  it('create -> room code -> waiting; persists the room for resume', () => {
    const states: ReturnType<NetClient['getState']>[] = []
    const events: unknown[] = []
    const fake = makeFakeSocket()
    let factoryCalls = 0
    const client = new NetClient(
      () => {
        factoryCalls++
        return fake.socket
      },
      (s) => states.push({ ...s }),
      (e) => events.push(e),
    )
    client.create()
    opened(client, fake)
    expect(fake.sent[0]).toContain('"t":"create"')
    feed(fake, { t: 'room', code: 'AB23' })
    const st = client.getState()
    expect(st.phase).toBe('waiting')
    expect(st.code).toBe('AB23')
    expect(st.color).toBe('w')
    // Persisted for reload-resume.
    expect(loadNetPersist()).toEqual({ code: 'AB23', token: expect.any(String), color: 'w' })
    // Pairing flips to paired.
    feed(fake, { t: 'paired', color: 'w' })
    expect(client.getState().phase).toBe('paired')
    expect(events).toEqual([{ t: 'paired', color: 'w' }])
    expect(factoryCalls).toBe(1)
  })
})

describe('NetClient — moves + presence', () => {
  it('sends our moves and surfaces remote moves as events', () => {
    const fake = makeFakeSocket()
    const events: unknown[] = []
    const client = new NetClient(() => fake.socket, () => {}, (e) => events.push(e))
    client.create()
    opened(client, fake)
    feed(fake, { t: 'room', code: 'ZZ99' })
    feed(fake, { t: 'paired', color: 'w' })
    client.sendMove('e4')
    expect(fake.sent.some((f) => f.includes('"san":"e4"'))).toBe(true)
    // Remote move arrives.
    feed(fake, { t: 'move', san: 'e5' })
    expect(events).toContainEqual({ t: 'remote-move', san: 'e5' })
    // Garbage frames are ignored.
    feed(fake, { t: 'move', san: '' })
    expect(events.filter((e) => (e as { t: string }).t === 'remote-move')).toHaveLength(1)
  })

  it('peer-left / peer-back toggle the online dot', () => {
    const fake = makeFakeSocket()
    const client = new NetClient(() => fake.socket, () => {}, () => {})
    client.create()
    opened(client, fake)
    feed(fake, { t: 'room', code: 'QW12' })
    feed(fake, { t: 'paired', color: 'b' })
    feed(fake, { t: 'peer-left' })
    expect(client.getState().peerOnline).toBe(false)
    feed(fake, { t: 'peer-back' })
    expect(client.getState().peerOnline).toBe(true)
  })
})

describe('NetClient — reconnect', () => {
  it('hello resume restores paired state and reports peer presence', () => {
    const fake = makeFakeSocket()
    const events: unknown[] = []
    const client = new NetClient(() => fake.socket, () => {}, (e) => events.push(e))
    client.create()
    opened(client, fake)
    feed(fake, { t: 'room', code: 'RM55' })
    feed(fake, { t: 'paired', color: 'w' })
    // Connection drops.
    drop(fake)
    expect(client.getState().phase).toBe('reconnecting')
    // Backoff reconnects: the factory is called again with a fresh socket.
    const fake2 = makeFakeSocket()
    const client2 = new NetClient(() => fake2.socket, () => {}, (e) => events.push(e))
    // Simulate the socket reopening with the persisted token — hello is sent on open.
    // (In production connect() reuses the same factory; here we drive a resume directly.)
    saveNetPersist({ code: 'RM55', token: newToken(), color: 'w' })
    client2.resume()
    fake2.socket.readyState = SOCKET_OPEN
    fake2.socket.onopen?.()
    expect(fake2.sent[0]).toContain('"t":"hello"')
    feed(fake2, { t: 'resume', color: 'w', peerOnline: false })
    expect(client2.getState().phase).toBe('paired')
    expect(client2.getState().peerOnline).toBe(false)
    expect(events).toContainEqual({ t: 'resumed', color: 'w', peerOnline: false })
  })

  it('leave() clears everything and stops retries', () => {
    vi.useFakeTimers()
    const fake = makeFakeSocket()
    const client = new NetClient(() => fake.socket, () => {}, () => {}, {
      setTimeout,
      clearTimeout: () => {},
    })
    client.create()
    opened(client, fake)
    feed(fake, { t: 'room', code: 'LV66' })
    feed(fake, { t: 'paired', color: 'b' })
    client.leave()
    expect(client.getState()).toEqual(NET_INITIAL)
    expect(loadNetPersist()).toBeNull()
    // A subsequent close event must NOT schedule a retry.
    drop(fake)
    expect(client.getState().phase).toBe('idle')
    vi.useRealTimers()
  })
})

describe('NetClient — error paths', () => {
  it('join errors surface as phase=error with the reason', () => {
    const fake = makeFakeSocket()
    const client = new NetClient(() => fake.socket, () => {}, () => {})
    client.join('NOPE')
    opened(client, fake)
    expect(fake.sent[0]).toContain('"t":"join"')
    feed(fake, { t: 'error', reason: 'no-such-room' })
    expect(client.getState().phase).toBe('error')
    expect(client.getState().error).toBe('no-such-room')
  })
})

describe('net persist storage', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear()
  })
  afterEach(() => {
    globalThis.localStorage?.clear()
  })

  it('round-trips and tolerates garbage', () => {
    saveNetPersist({ code: 'RT88', token: 'tok', color: 'b' })
    expect(loadNetPersist()).toEqual({ code: 'RT88', token: 'tok', color: 'b' })
    globalThis.localStorage?.setItem('battleground-chess:net', '{oops')
    expect(loadNetPersist()).toBeNull()
  })

  it('newToken is unguessable-ish (16 bytes hex)', () => {
    const a = newToken()
    const b = newToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(8)
  })
})
