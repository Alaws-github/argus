// Engagement access API: open or members-only, and who the members are.
// Leads and admins manage it. Switching to members-only adds the person who
// switched, so nobody locks themselves out.
import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { can } from '@gh/shared';
import { forgetAccess, emit } from './realtime.js';

type Wrap = (
  fn: (req: Request, res: Response) => Promise<unknown>,
) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

export function accessRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  r.get(
    '/engagements/:id/members',
    wrap(async (req, res) => {
      const { rows: e } = await db.query(`SELECT access FROM engagements WHERE id = $1`, [req.params.id]);
      if (!e[0]) throw httpError(404, 'Engagement not found');
      const { rows } = await db.query(
        `SELECT u.id, u.name, u.email, u.role, m.added_by, m.added_at FROM engagement_members m JOIN users u ON u.id = m.user_id WHERE m.engagement_id = $1 ORDER BY u.name`,
        [req.params.id],
      );
      // People who could be added: only shown to those who manage access.
      const { rows: people } = can(req.user!.role, 'manage_engagement')
        ? await db.query(`SELECT id, name, email, role FROM users WHERE NOT disabled ORDER BY name`)
        : { rows: [] as any[] };
      res.json({
        access: e[0].access,
        members: rows.map((m: any) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          role: m.role,
          addedBy: m.added_by,
          addedAt: m.added_at instanceof Date ? m.added_at.toISOString() : m.added_at,
        })),
        people: people.map((p: any) => ({ id: p.id, name: p.name, email: p.email, role: p.role })),
      });
    }),
  );

  r.put(
    '/engagements/:id/access',
    wrap(async (req, res) => {
      const b = z.object({ access: z.enum(['open', 'members']) }).parse(req.body);
      await db.tx(async (q) => {
        const { rows } = await q.query(`SELECT name, access FROM engagements WHERE id = $1`, [req.params.id]);
        if (!rows[0]) throw httpError(404, 'Engagement not found');
        if (b.access === 'members') {
          await q.query(
            `INSERT INTO engagement_members (engagement_id, user_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [req.params.id, req.user!.id, actorOf(req)],
          );
        }
        await q.query(`UPDATE engagements SET access = $2 WHERE id = $1`, [req.params.id, b.access]);
        await logAudit(q, actorOf(req), 'engagement.access_changed', `engagement:${rows[0].name}`, {
          from: rows[0].access,
          to: b.access,
        });
      });
      forgetAccess(req.params.id);
      emit('engagement', { changed: true });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/engagements/:id/members',
    wrap(async (req, res) => {
      const b = z.object({ userId: z.string().uuid() }).parse(req.body);
      await db.tx(async (q) => {
        const { rows: u } = await q.query(`SELECT name FROM users WHERE id = $1`, [b.userId]);
        if (!u[0]) throw httpError(404, 'Person not found');
        await q.query(
          `INSERT INTO engagement_members (engagement_id, user_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [req.params.id, b.userId, actorOf(req)],
        );
        await logAudit(q, actorOf(req), 'engagement.member_added', `engagement:${req.params.id}`, {
          person: u[0].name,
        });
      });
      forgetAccess(req.params.id);
      res.status(201).json({ ok: true });
    }),
  );

  r.delete(
    '/engagements/:id/members/:userId',
    wrap(async (req, res) => {
      await db.tx(async (q) => {
        const { rows: u } = await q.query(`SELECT name FROM users WHERE id = $1`, [req.params.userId]);
        const { rows: e } = await q.query(`SELECT access FROM engagements WHERE id = $1`, [req.params.id]);
        const { rows: left } = await q.query(
          `SELECT count(*)::int AS n FROM engagement_members WHERE engagement_id = $1 AND user_id <> $2`,
          [req.params.id, req.params.userId],
        );
        if (e[0]?.access === 'members' && !left[0].n)
          throw httpError(409, 'A members-only engagement needs at least one member');
        await q.query(`DELETE FROM engagement_members WHERE engagement_id = $1 AND user_id = $2`, [
          req.params.id,
          req.params.userId,
        ]);
        await logAudit(q, actorOf(req), 'engagement.member_removed', `engagement:${req.params.id}`, {
          person: u[0]?.name ?? req.params.userId,
        });
      });
      forgetAccess(req.params.id);
      res.json({ ok: true });
    }),
  );
}
