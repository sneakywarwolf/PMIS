import { io, Socket } from 'socket.io-client';

export type LiveState = { connected: boolean; mode: 'AUTO' | 'MANUAL' };
export const OFFLINE: LiveState = { connected: false, mode: 'AUTO' };

// ponytail: polling through the same-origin /api proxy so the httpOnly cookie rides along;
// allow the websocket upgrade once a real reverse proxy fronts both apps.
export function connectEasterEgg(): Socket {
  return io('/easter-egg', {
    path: '/api/ee-socket',
    addTrailingSlash: false,
    transports: ['polling'],
    withCredentials: true,
    // Own Manager per call: a cached one may still be closing from a previous effect cleanup.
    forceNew: true,
  });
}
