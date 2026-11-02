/**
 * Network-play client: room create/join, move exchange, reconnect resume.
 *
 * Pure logic + transport — no React, no three, fully unit-testable with a
 * fake socket. The store owns game state; this module owns the wire.
 *
 * Contract with the relay (relay/server.mjs):
 *   create -> {t:'room', code}   join -> {t:'paired', color}
 *   move frames relayed verbatim; presence: peer-left / peer-back / resume.
 */

export type NetColor = 'w' | 'b'

/** Everything the UI needs to render the netplay flow. */
export type NetState = {
  phase: 'idle' | 'creating' | 'waiting' | 'joining' | 'paired' | 'error' | 'reconnecting'
  /** Room code (4 chars) once known. */
  code: string | null
  /** Our army once paired. */
  color: NetColor | null
  /** Latest error reason ('no-such-room' | 'room-full' | 'not-in-room' | …). */
  error: string | null
  /** Peer connection health for the HUD dot. */
  peerOnline: boolean
}

export const NET_INITIAL: NetState = {
  phase: 'idle',
  code: null,
  color: null,
  error: null,
  peerOnline: false,
}

/** Events surfaced to the store (the store decides what they mean for play). */
export type NetEvent =
  | { t: 'paired'; color: NetColor }
  | { t: 'remote-move'; san: string }
  | { t: 'peer-left' }
  | { t: 'peer-back' }
  | { t: 'resumed'; color: NetColor; peerOnline: boolean }
  | { t: 'failed'; reason: string }

/** Minimal WebSocket-ish surface (real WebSocket satisfies it; tests fake it). */
export type NetSocket = {
  send(text: string): void
  close(): void
  readonly readyState: number
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: (() => void) | null
}

export const SOCKET_OPEN = 1

/** localStorage keys — room resume survives reloads. */
const LS_KEY = 'battleground-chess:net'

export type NetPersist = { code: string; token: string; color: NetColor }

export function loadNetPersist(): NetPersist | null {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NetPersist>
    if (
      typeof parsed.code === 'string' &&
      typeof parsed.token === 'string' &&
      (parsed.color === 'w' || parsed.color === 'b')
    ) {
      return { code: parsed.code, token: parsed.token, color: parsed.color }
    }
    return null
  } catch {
    return null
  }
}

export function saveNetPersist(p: NetPersist | null): void {
  try {
    if (!p) globalThis.localStorage?.removeItem(LS_KEY)
    else globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(p))
  } catch {
    /* private mode etc. — resume is best-effort */
  }
}

export function newToken(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  let tok = ''
  for (const b of bytes) tok += b.toString(16).padStart(2, '0')
  if (tok.length < 8) tok = `t${Date.now()}${Math.random().toString(16).slice(2)}`
  return tok
}

/**
 * Drives one netplay session. The caller supplies a socket factory (real
 * pages pass () => new WebSocket(url); tests pass a fake).
 */
export class NetClient {
  private socket: NetSocket | null = null
  private state: NetState = { ...NET_INITIAL }
  private token = newToken()
  private persist: NetPersist | null = null
  private closedByUs = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private readonly socketFactory: () => NetSocket
  private readonly onChange: (s: NetState) => void
  private readonly onEvent: (e: NetEvent) => void
  private readonly clock: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }

  constructor(
    socketFactory: () => NetSocket,
    onChange: (s: NetState) => void,
    onEvent: (e: NetEvent) => void,
    clock: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = {
      setTimeout,
      clearTimeout,
    },
  ) {
    this.socketFactory = socketFactory
    this.onChange = onChange
    this.onEvent = onEvent
    this.clock = clock
  }

  getState(): NetState {
    return this.state
  }

  private set(patch: Partial<NetState>): void {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }

  private connect(): NetSocket {
    this.socket?.close()
    const socket = this.socketFactory()
    this.socket = socket
    socket.onopen = () => {
      // On (re)open: if we have a persisted room, resume it; the first
      // caller action (create/join) happens through the public methods.
      if (this.persist) {
        socket.send(JSON.stringify({ t: 'hello', code: this.persist.code, token: this.token }))
      }
    }
    socket.onmessage = (ev) => this.handle(String((ev as { data: unknown }).data))
    socket.onclose = () => this.onClosed()
    return socket
  }

  /** Host a new room. */
  create(): void {
    this.closedByUs = false
    this.retryCount = 0
    const socket = this.connect()
    this.set({ phase: 'creating', error: null })
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: 'create', token: this.token }))
    }
  }

  /** Join an existing room by code. */
  join(code: string): void {
    this.closedByUs = false
    this.retryCount = 0
    const socket = this.connect()
    this.set({ phase: 'joining', error: null })
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: 'join', code: code.toUpperCase().trim(), token: this.token }))
    }
  }

  /** Reconnect to a persisted room (page reload / dropped WiFi). */
  resume(): void {
    const p = this.persist ?? loadNetPersist()
    if (!p) {
      this.set({ phase: 'error', error: 'no-such-room' })
      return
    }
    this.persist = p
    this.token = p.token
    this.closedByUs = false
    this.retryCount = 0
    this.set({ phase: 'reconnecting' })
    this.connect()
  }

  /** Send our move to the peer. Silently drops when not connected. */
  sendMove(san: string): void {
    if (!san) return
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return
    this.socket.send(JSON.stringify({ t: 'move', san }))
  }

  /** Leave cleanly. */
  leave(): void {
    this.closedByUs = true
    if (this.retryTimer) this.clock.clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.persist = null
    saveNetPersist(null)
    this.socket?.close()
    this.socket = null
    this.set({ ...NET_INITIAL })
  }

  private handle(text: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(text) as Record<string, unknown>
    } catch {
      return
    }
    switch (msg.t) {
      case 'room':
        this.persist = { code: String(msg.code), token: this.token, color: 'w' }
        saveNetPersist(this.persist)
        this.set({ phase: 'waiting', code: this.persist.code, color: 'w' })
        return
      case 'paired': {
        const color = msg.color === 'b' ? 'b' : 'w'
        this.persist = { code: this.state.code ?? this.persist?.code ?? '', token: this.token, color }
        saveNetPersist(this.persist)
        this.set({ phase: 'paired', color, peerOnline: true })
        this.onEvent({ t: 'paired', color })
        return
      }
      case 'resume': {
        const color = msg.color === 'b' ? 'b' : 'w'
        const peerOnline = msg.peerOnline === true
        this.set({ phase: 'paired', color, peerOnline, code: this.persist?.code ?? this.state.code })
        this.onEvent({ t: 'resumed', color, peerOnline })
        return
      }
      case 'move':
        if (typeof msg.san === 'string' && msg.san) this.onEvent({ t: 'remote-move', san: msg.san })
        return
      case 'peer-left':
        this.set({ peerOnline: false })
        this.onEvent({ t: 'peer-left' })
        return
      case 'peer-back':
        this.set({ peerOnline: true })
        this.onEvent({ t: 'peer-back' })
        return
      case 'error':
        this.set({ phase: 'error', error: String(msg.reason ?? 'error') })
        this.onEvent({ t: 'failed', reason: String(msg.reason ?? 'error') })
        return
      default:
        // Unknown frames are ignored (forward protocol extensions).
        return
    }
  }

  private onClosed(): void {
    if (this.closedByUs) return
    // Session dropped — auto-retry with backoff while a room is persisted.
    if (this.persist && this.retryCount < 6) {
      const delay = Math.min(500 * 2 ** this.retryCount, 8000)
      this.retryCount += 1
      this.set({ phase: 'reconnecting' })
      this.retryTimer = this.clock.setTimeout(() => {
        this.retryTimer = null
        this.connect()
      }, delay)
    } else if (!this.persist) {
      this.set({ phase: 'idle' })
    }
  }
}
