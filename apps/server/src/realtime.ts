// Live updates. The server pushes small events (a card moved, a run finished)
// to every open browser so pages refresh without reloading.
import type { Server } from 'socket.io';

let io: Server | null = null;

export function attach(server: Server) {
  io = server;
}

// Events: card, card:deleted, run, run:event, risk, audit, usage
export function emit(event: string, payload: unknown) {
  io?.emit(event, payload);
}
