// Minimal Socket.IO v4 server, mocked over msw's WebSocket interception, so the app runs the REAL socket.io-client
// (§6.5: path /api/socket.io, namespace /ws, access token on connect, room user:{id}).
//
// Wire protocol (engine.io v4 over a WebSocket; text frames only):
//   server → "0{sid,upgrades,pingInterval,pingTimeout,maxPayload}"   engine.io OPEN
//   client → "40/ws,{\"token\":…}"   socket.io CONNECT to /ws with auth
//   server → "40/ws,{\"sid\":…}" or "44/ws,{\"message\":…}"   CONNECT ok / CONNECT_ERROR
//   server → "2", client → "3"       engine.io PING / PONG (keeps the client from timing out)
//   server → "42/ws,[event,payload]" socket.io EVENT
// @mswjs/socket.io-binding was tried and dropped: it hardcodes the default namespace and never pings.
import { ws, type WebSocketHandlerConnection } from 'msw'
import { userIdForToken } from './session'
import { subscribe } from './store/events'

const NSP = '/ws'
const PING_INTERVAL = 25_000
const link = ws.link(/\/api\/socket\.io\//)

type Client = WebSocketHandlerConnection['client']
const rooms = new Map<string, Set<Client>>()

const leave = (userId: string | null, client: Client) => {
  if (userId) rooms.get(userId)?.delete(client)
}

export const socketHandler = link.addEventListener('connection', ({ client }) => {
  let userId: string | null = null
  client.send(`0${JSON.stringify({ sid: crypto.randomUUID(), upgrades: [], pingInterval: PING_INTERVAL, pingTimeout: 20_000, maxPayload: 1e6 })}`)
  const ping = setInterval(() => client.send('2'), PING_INTERVAL)

  client.addEventListener('message', (event) => {
    const data = typeof event.data === 'string' ? event.data : ''
    if (data.startsWith(`40${NSP}`)) {
      const json = data.slice(data.indexOf(',') + 1)
      let token: string | undefined
      try {
        token = (JSON.parse(json) as { token?: string }).token
      } catch {
        token = undefined
      }
      // Same rule as REST: no valid access token, no connection. The client refreshes and reconnects.
      const id = userIdForToken(token)
      if (!id) {
        client.send(`44${NSP},${JSON.stringify({ message: 'unauthenticated' })}`)
        return
      }
      leave(userId, client)
      userId = id
      if (!rooms.has(id)) rooms.set(id, new Set())
      rooms.get(id)!.add(client)
      client.send(`40${NSP},${JSON.stringify({ sid: crypto.randomUUID() })}`)
    } else if (data === `41${NSP}`) {
      leave(userId, client)
      userId = null
    }
  })

  client.addEventListener('close', () => {
    clearInterval(ping)
    leave(userId, client)
  })
})

/** Deliver a store event to room user:{id}. */
export function emitTo(userId: string, event: string, payload: unknown) {
  const frame = `42${NSP},${JSON.stringify([event, payload])}`
  for (const client of rooms.get(userId) ?? []) client.send(frame)
}

subscribe(emitTo)
