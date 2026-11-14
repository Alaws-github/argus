// Per-engagement access. An engagement is "open" (everyone signed in can see
// it, as before) or "members" (only its members and admins). One guard finds
// the engagement behind every request, reads included, and answers "not
// found" to anyone outside it, so no route can be missed. Lists, the audit
// log and live updates are filtered the same way.
import type { NextFunction, Request, Response } from 'express';
import type { Db, Queryable } from './db.js';
import { OWNERS } from './archive.js';
import { requestContext } from './context.js';

// Engagement ids this person may see, or null for "all" (admins).
export async function visibleIds(
  q: Queryable,
  user: { id: string; role: string } | undefined | null,
): Promise<string[] | null> {
  if (!user) return [];
  if (user.role === 'admin') return null;
  const { rows } = await q.query(
    `SELECT id FROM engagements WHERE access <> 'members' OR id IN (SELECT engagement_id FROM engagement_members WHERE user_id = $1)`,
    [user.id],
  );
  return rows.map((r: any) => r.id);
}

export async function canSee(
  q: Queryable,
  user: { id: string; role: string } | undefined | null,
  engagementId: string,
) {
  const ids = await visibleIds(q, user);
  return ids === null || ids.includes(engagementId);
}

export async function engagementOf(db: Db, req: Request): Promise<string | null> {
  if (req.path === '/evidence' && req.body?.engagementId) return String(req.body.engagementId);
  const own = /^\/engagements\/([0-9a-f-]{36})(?:\/|$)/.exec(req.path);
  if (own) return own[1];
  for (const [re, sql] of OWNERS) {
    const m = re.exec(req.path);
    if (!m) continue;
    const { rows } = await db.query(sql, [m[1]]).catch(() => ({ rows: [] as any[] }));
    return rows[0]?.id ?? null;
  }
  return null;
}

export function accessGuard(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next();
      const id = await engagementOf(db, req);
      const store = requestContext.getStore();
      if (store && id) store.engagementId = id;
      if (!id || req.user.role === 'admin') return next();
      if (!(await canSee(db, req.user, id))) return res.status(404).json({ error: 'Engagement not found' });
      next();
    } catch (e) {
      next(e);
    }
  };
}

// For audit entries written outside a request (the engine, schedules): find
// the engagement from the entity, for the common kinds.
export async function engagementOfEntity(q: Queryable, entity: string): Promise<string | null> {
  const m = /^(card|connector|incident|alert|plan):(.+)$/.exec(entity);
  if (!m) return null;
  const sql = {
    card: `SELECT engagement_id FROM cards WHERE key = $1`,
    connector: `SELECT engagement_id FROM connectors WHERE 'CN-' || number = $1`,
    incident: `SELECT engagement_id FROM incidents WHERE 'INC-' || number = $1`,
    plan: `SELECT engagement_id FROM plans WHERE 'P-' || number = $1`,
    alert: `SELECT engagement_id FROM monitor_alerts WHERE 'AL-' || number = $1`,
  }[m[1] as 'card'];
  const { rows } = await q.query(sql, [m[2]]).catch(() => ({ rows: [] as any[] }));
  return rows[0]?.engagement_id ?? null;
}
