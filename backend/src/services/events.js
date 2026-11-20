// Live updates (§6.5): Socket.io at path /api/socket.io, namespace /ws, access token in the handshake `auth`.
// Each socket joins user:{id}; payloads are the §6.4.1 event shapes. M2–M5 events arrive through Redis Streams
// once those services run; until then the API publishes the events it causes itself.
import { Server } from 'socket.io';
import { verifyAccess } from './tokens.js';

let ns = null;

export function attachSocket(httpServer) {
  const io = new Server(httpServer, { path: '/api/socket.io', serveClient: false, transports: ['websocket'] });
  ns = io.of('/ws');
  ns.use((socket, next) => {
    const claims = verifyAccess(socket.handshake.auth?.token ?? '');
    // The client refreshes and reconnects on exactly this message (frontend/src/api/realtime.ts).
    if (!claims) return next(new Error('unauthenticated'));
    socket.data.userId = claims.sub;
    next();
  });
  ns.on('connection', (socket) => socket.join(`user:${socket.data.userId}`));
  return io;
}

export function publish(userId, event, payload) {
  ns?.to(`user:${userId}`).emit(event, payload);
}
