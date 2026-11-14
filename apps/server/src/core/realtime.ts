// Live updates. The server pushes small events (a card moved, a run finished)
// to open browsers so pages refresh without reloading. Events about a
// members-only engagement go only to people who can see it.
import type { Server } from 'socket.io';
import type { Db } from './db.js';

let io: Server | null = null;
let db: Db | null = null;
// Engagement access, cached briefly so every event doesn't hit the database.
const cache = new Map<string, { at: number; members: Set<string> | null }>();

export function attach(server: Server, database: Db) {
  io = server;
  db = database;
}

async function engagementOf(payload: any): Promise<string | null> {
  if (!payload || typeof payload !== 'object' || !db) return null;
  if (payload.engagementId) return payload.engagementId;
  const cardId = payload.cardId ?? payload.card?.id;
  if (cardId) {
    const { rows } = await db
      .query(`SELECT engagement_id FROM cards WHERE id::text = $1`, [cardId])
      .catch(() => ({ rows: [] as any[] }));
    return rows[0]?.engagement_id ?? null;
  }
  return null;
}

// null means open to everyone signed in.
async function membersOf(engagementId: string): Promise<Set<string> | null> {
  const hit = cache.get(engagementId);
  if (hit && Date.now() - hit.at < 5000) return hit.members;
  const { rows } = await db!.query(`SELECT access FROM engagements WHERE id = $1`, [engagementId]);
  let members: Set<string> | null = null;
  if (rows[0]?.access === 'members') {
    const { rows: m } = await db!.query(`SELECT user_id FROM engagement_members WHERE engagement_id = $1`, [
      engagementId,
    ]);
    members = new Set(m.map((r: any) => r.user_id));
  }
  cache.set(engagementId, { at: Date.now(), members });
  return members;
}
export const forgetAccess = (engagementId: string) => cache.delete(engagementId);

// Events: card, card:deleted, run, run:event, risk, audit, usage, eval, alert, incident, golden, assistant
export function emit(event: string, payload: unknown) {
  if (!io) return;
  void (async () => {
    const eid = await engagementOf(payload).catch(() => null);
    const members = eid ? await membersOf(eid).catch(() => null) : null;
    if (!members) return io!.emit(event, payload);
    for (const s of io!.sockets.sockets.values()) {
      const u = s.data.user;
      if (u && (u.role === 'admin' || members.has(u.id))) s.emit(event, payload);
    }
  })();
}

/** An event for one person only (the assistant's live steps belong to whoever asked). */
export function emitToUser(userId: string, event: string, payload: unknown) {
  if (!io) return;
  for (const s of io.sockets.sockets.values()) if (s.data.user?.id === userId) s.emit(event, payload);
}
