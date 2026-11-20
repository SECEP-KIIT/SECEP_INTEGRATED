// End to end: the REAL socket.io-client against the Socket.IO protocol mock, through msw/node's WebSocket
// interception. Proves the handshake, /ws namespace auth, room delivery and the refusal of a bad token.
import { setupServer } from 'msw/node'
import type { Socket } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { control } from './control'
import { handlers } from './handlers'
import { deliver } from './pipeline'
import { issueToken, signIn } from './session'
import { db, initStore } from './store/db'

vi.stubGlobal('location', new URL('http://localhost/'))
const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterAll(() => server.close())
beforeEach(() => {
  initStore({ persistEnabled: false })
  control.latency = [0, 0]
  control.speed = 1000
})

let socket: Socket | undefined
afterEach(() => socket?.disconnect())

// Same options as src/api/realtime.ts; the browser WebSocket transport, because Node's default uses the `ws`
// package, which msw doesn't intercept.
// Imported after server.listen(): engine.io-client captures globalThis.WebSocket when first evaluated (see realtime.ts).
const connect = async (token: string | null) => {
  const [{ io }, { WebSocket: BrowserWebSocketTransport }] = await Promise.all([import('socket.io-client'), import('engine.io-client')])
  return io('http://localhost/ws', { path: '/api/socket.io', transports: [BrowserWebSocketTransport], auth: { token }, reconnection: false })
}

const once = <T,>(s: Socket, event: string) => new Promise<T>((resolve) => s.once(event, resolve))

describe('Socket.IO mock with the real client', () => {
  it('connects to /ws with a valid token and receives events for its own room only', async () => {
    signIn(db.users[0].id)
    socket = await connect(issueToken()!.access_token)
    await once(socket, 'connect')
    expect(socket.connected).toBe(true)

    const triaged = once<{ email_id: string; email: { subject: string } }>(socket, 'email.triaged')
    await deliver(db.users[0].id, 0)
    const event = await triaged
    expect(db.emails.has(event.email_id)).toBe(true)

    // Another user's mail is not delivered to this socket.
    const leaked = vi.fn()
    socket.on('email.triaged', leaked)
    await deliver(db.users[1].id, 0)
    await new Promise((r) => setTimeout(r, 30))
    expect(leaked).not.toHaveBeenCalled()
  })

  it('refuses a missing or unknown token with connect_error "unauthenticated"', async () => {
    socket = await connect('mock.not-a-real-token')
    const err = await once<Error>(socket, 'connect_error')
    expect(err.message).toBe('unauthenticated')
    expect(socket.connected).toBe(false)
  })
})
