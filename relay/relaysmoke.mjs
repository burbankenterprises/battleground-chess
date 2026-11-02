// Relay protocol smoke test: create, join, move relay, reconnect.
import WebSocket from 'ws'
const log = []
const a = new WebSocket('ws://127.0.0.1:8791')
await new Promise((r) => a.on('open', r))
const b = new WebSocket('ws://127.0.0.1:8791')
await new Promise((r) => b.on('open', r))
a.on('message', (d) => log.push(['A', JSON.parse(d)]))
b.on('message', (d) => log.push(['B', JSON.parse(d)]))

a.send(JSON.stringify({ t: 'create', token: 'tokA' }))
await new Promise((r) => setTimeout(r, 200))
const room = log.find(([s, m]) => s === 'A' && m.t === 'room')
console.log('1. room code:', room[1].code)

b.send(JSON.stringify({ t: 'join', code: room[1].code, token: 'tokB' }))
await new Promise((r) => setTimeout(r, 200))

a.send(JSON.stringify({ t: 'move', san: 'e4' }))
await new Promise((r) => setTimeout(r, 200))

a.close()
await new Promise((r) => setTimeout(r, 200))
const a2 = new WebSocket('ws://127.0.0.1:8791')
await new Promise((r) => a2.on('open', r))
a2.on('message', (d) => log.push(['A2', JSON.parse(d)]))
a2.send(JSON.stringify({ t: 'hello', code: room[1].code, token: 'tokA' }))
await new Promise((r) => setTimeout(r, 200))
b.send(JSON.stringify({ t: 'move', san: 'e5' }))
await new Promise((r) => setTimeout(r, 300))

// a third party tries to join the full room
const c = new WebSocket('ws://127.0.0.1:8791')
await new Promise((r) => c.on('open', r))
c.on('message', (d) => log.push(['C', JSON.parse(d)]))
c.send(JSON.stringify({ t: 'join', code: room[1].code, token: 'tokC' }))
await new Promise((r) => setTimeout(r, 200))

const flat = log.map(([w, m]) => `${w}:${m.t}${m.color ? ':' + m.color : ''}${m.san ? ':' + m.san : ''}${m.reason ? ':' + m.reason : ''}`)
console.log('2. events:', JSON.stringify(flat))
const ok =
  flat.includes('A:room') &&
  flat.includes('A:paired:w') && flat.includes('B:paired:b') &&
  flat.includes('B:move:e4') &&
  flat.includes('B:peer-left') &&
  flat.includes('A2:resume:w') &&
  flat.includes('A2:move:e5') &&
  flat.includes('C:error:room-full')
console.log(ok ? 'RELAY SMOKE OK' : 'RELAY SMOKE FAIL')
process.exit(ok ? 0 : 1)
