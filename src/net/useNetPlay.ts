import { useCallback, useEffect, useRef, useState } from 'react'
import { useGameStore } from '../game/store'
import { NetClient, NET_INITIAL } from './netClient'
import type { NetState } from './netClient'

/**
 * React binding for network play: one NetClient per page, driving the store.
 *
 * - create()/join() are called from the menu flow.
 * - Our moves are shipped to the peer whenever the store's history grows.
 * - Remote moves arrive as SAN and are applied with the SAME battle pipeline
 *   (tryMove) — the receiving device animates the full fight like a local one.
 * - Page reload reconnects via the persisted room (resume).
 */

/** Production socket factory; tests inject fakes through NetClient directly. */
export function relayUrl(): string {
  // Same-origin wss when served over https; local dev falls back to the local relay.
  if (typeof location === 'undefined') return 'ws://127.0.0.1:8791'
  if (location.protocol === 'https:') {
    return `wss://${location.host}/bgc-relay`
  }
  return `ws://${location.hostname || '127.0.0.1'}:8791`
}

export function useNetPlay(): {
  net: NetState
  hostRoom: () => void
  joinRoom: (code: string) => void
  leaveRoom: () => void
} {
  const [net, setNet] = useState<NetState>(NET_INITIAL)
  const clientRef = useRef<NetClient | null>(null)
  const lastMoveCount = useRef(0)

  if (!clientRef.current && typeof window !== 'undefined') {
    const client = new NetClient(
      () => new WebSocket(relayUrl()) as unknown as never,
      (s) => setNet({ ...s }),
      (e) => {
        const store = useGameStore.getState()
        switch (e.t) {
          case 'paired':
            store.startNetGame(e.color)
            break
          case 'resumed':
            store.startNetGame(e.color)
            break
          case 'remote-move':
            store.applyRemoteSan(e.san)
            break
          case 'peer-left':
          case 'peer-back':
            break // NetState carries the dot; store needs nothing
          case 'failed':
            break
        }
      },
    )
    clientRef.current = client
  }

  const client = clientRef.current

  // Ship our moves: watch history length, send the newest SAN when it grows
  // and it was OUR move (in net mode the mover is whoever's turn it just was).
  useEffect(() => {
    if (!client) return
    return useGameStore.subscribe((state) => {
      const n = state.moveHistory.length
      if (n > lastMoveCount.current) {
        const san = state.moveHistory[n - 1]
        lastMoveCount.current = n
        if (state.netMode === 'net') client.sendMove(san)
      } else if (n < lastMoveCount.current) {
        lastMoveCount.current = n // undo/newGame — no net action (v1)
      }
    })
  }, [client])

  const hostRoom = useCallback(() => client?.create(), [client])
  const joinRoom = useCallback((code: string) => client?.join(code), [client])
  const leaveRoom = useCallback(() => client?.leave(), [client])

  return { net, hostRoom, joinRoom, leaveRoom }
}
