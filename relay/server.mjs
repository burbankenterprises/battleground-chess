#!/usr/bin/env node
/**
 * Battleground Chess — room relay for two-device network play.
 *
 * Plain Node (dep: ws). A WebSocket relay that pairs two browsers into a room
 * and forwards moves + presence between them. Zero game logic lives here —
 * both clients run chess.js as the rules authority and merely exchange SAN
 * move strings, so the relay stays tiny, stateless per message, and boring.
 *
 * Protocol (JSON text frames, client -> server, then relayed verbatim):
 *   {t:'create'}                      -> {t:'room', code:'ABCD'} (you are host/white)
 *   {t:'join', code}                  -> both sides get {t:'paired', color}
 *   {t:'move', san}                   -> forwarded to the peer
 *   {t:'hello', code, token}          -> resume after reconnect: {t:'resume', color, peerOnline}
 *   {t:'bye'}                         -> peer told {t:'peer-left'}
 *   anything else from a paired room  -> forwarded to the peer
 *
 * Room lifecycle: created on 'create', dies when both sockets close. Codes
 * are 4 chars from an unambiguous alphabet (no 0/O, 1/I). Idle rooms expire
 * after ROOM_TTL_MS. A reconnecting peer token replaces its old socket.
 */

import { createServer } from 'node:http'
import { randomInt } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'

const PORT = Number(process.env.PORT ?? 8791)
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS ?? 2 * 60 * 60 * 1000) // 2h
const MAX_FRAME = 4 * 1024

/** Unambiguous uppercase alphabet: no 0/O, 1/I, or lookalikes. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** @type {Map<string, any>} code -> { code, host: Peer|null, guest: Peer|null, createdAt } */
const rooms = new Map()

function newCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) code += ALPHABET[randomInt(ALPHABET.length)]
    if (!rooms.has(code)) return code
  }
  return 'ZZZZ' // vanishingly unlikely
}

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function otherPeer(room, peer) {
  if (room.host === peer) return room.guest
  if (room.guest === peer) return room.host
  return null
}

/** Replace a room slot when the same peer token reconnects with a new socket. */
function upsertPeer(room, slot, token, ws) {
  const old = room[slot]
  if (old && old.token !== token && old.ws.readyState === WebSocket.OPEN) {
    send(old.ws, { t: 'replaced' })
    old.ws.close(1000)
  }
  room[slot] = { ws, token }
}

function reapRoom(code) {
  const room = rooms.get(code)
  if (!room) return
  for (const peer of [room.host, room.guest]) {
    if (peer) {
      send(peer.ws, { t: 'room-closed' })
      peer.ws.close(1000)
    }
  }
  rooms.delete(code)
}

setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) reapRoom(code)
  }
}, 60_000).unref()

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('battleground-chess relay\n')
})

const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME })

wss.on('connection', (ws) => {
  let room = null
  let slot = null // 'host' | 'guest'

  ws.on('message', (data, isBinary) => {
    if (isBinary) return
    let msg
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }

    if (msg.t === 'create') {
      if (room) return
      const token = String(msg.token ?? '')
      if (!token) return
      room = { code: newCode(), host: null, guest: null, createdAt: Date.now() }
      rooms.set(room.code, room)
      slot = 'host'
      upsertPeer(room, 'host', token, ws)
      send(ws, { t: 'room', code: room.code })
      return
    }

    if (msg.t === 'join') {
      if (room) return
      const code = String(msg.code ?? '').toUpperCase().trim()
      const token = String(msg.token ?? '')
      if (!code || !token) return
      const target = rooms.get(code)
      if (!target) {
        send(ws, { t: 'error', reason: 'no-such-room' })
        return
      }
      if (
        target.guest &&
        target.guest.token !== token &&
        target.guest.ws.readyState === WebSocket.OPEN
      ) {
        send(ws, { t: 'error', reason: 'room-full' })
        return
      }
      room = target
      slot = 'guest'
      upsertPeer(room, 'guest', token, ws)
      send(ws, { t: 'paired', color: 'b' })
      send(room.host?.ws, { t: 'paired', color: 'w' })
      return
    }

    if (msg.t === 'hello') {
      // Resume path: reconnecting client announces itself with its token.
      const code = String(msg.code ?? '').toUpperCase().trim()
      const token = String(msg.token ?? '')
      const target = rooms.get(code)
      if (!target) {
        send(ws, { t: 'error', reason: 'no-such-room' })
        return
      }
      const color =
        target.host && target.host.token === token
          ? 'w'
          : target.guest && target.guest.token === token
            ? 'b'
            : null
      if (!color) {
        send(ws, { t: 'error', reason: 'not-in-room' })
        return
      }
      if (color === 'w') upsertPeer(target, 'host', token, ws)
      else upsertPeer(target, 'guest', token, ws)
      room = target
      slot = color === 'w' ? 'host' : 'guest'
      const me = color === 'w' ? target.host : target.guest
      const peer = otherPeer(target, me)
      send(ws, {
        t: 'resume',
        color,
        peerOnline: !!(peer && peer.ws.readyState === WebSocket.OPEN),
      })
      if (peer && peer.ws.readyState === WebSocket.OPEN) {
        send(peer.ws, { t: 'peer-back' })
      }
      return
    }

    // Everything else is forwarded to the room peer verbatim (moves, byes…).
    if (room && slot) {
      const peer = slot === 'host' ? room.guest : room.host
      if (peer && peer.ws.readyState === WebSocket.OPEN && peer.ws !== ws) {
        peer.ws.send(String(data))
      } else if (msg.t) {
        send(ws, { t: 'peer-offline' })
      }
    }
  })

  ws.on('close', () => {
    if (!room || !slot) return
    const me = slot === 'host' ? room.host : room.guest
    const peer = otherPeer(room, me)
    if (peer) send(peer.ws, { t: 'peer-left' })
    // Keep the room for the reconnect window; TTL reaps it later.
    if (!room.host && !room.guest) rooms.delete(room.code)
  })

  ws.on('error', () => {
    /* close handler does the bookkeeping */
  })
})

server.listen(PORT, () => {
  console.log(`battleground-chess relay listening on :${PORT}`)
})
