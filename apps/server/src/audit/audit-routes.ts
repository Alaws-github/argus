// The audit log: browse it and verify the hash chain.
import { type Router } from 'express';
import { z } from 'zod';
import { visibleIds } from '../auth/access.js';
import { verifyAudit } from './audit.js';
import { type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { toAudit } from '../settings/settings-store.js';

export function auditRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // Audit log with filters: free text, who, what, address and a date range.
  r.get(
    '/audit',
    wrap(async (req, res) => {
      const f = z
        .object({
          q: z.string().max(200).optional(),
          actor: z.string().max(120).optional(),
          action: z.string().max(120).optional(),
          ip: z.string().max(60).optional(),
          from: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          to: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce
            .number()
            .int()
            .refine((n) => [25, 50, 100, 200].includes(n))
            .default(50),
          limit: z.coerce.number().int().optional(),
        })
        .parse(req.query);
      const where: string[] = [];
      const vals: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        vals.push(v);
        where.push(sql.replace('?', `$${vals.length}`));
      };
      if (f.q?.trim())
        add(
          `(actor ILIKE ? OR action ILIKE $X OR entity ILIKE $X OR detail::text ILIKE $X)`.replace(
            /\$X/g,
            `$${vals.length + 1}`,
          ),
          `%${f.q.trim()}%`,
        );
      if (f.actor) add(`actor = ?`, f.actor);
      if (f.action) add(`action = ?`, f.action);
      if (f.ip?.trim()) add(`ip ILIKE ?`, `${f.ip.trim()}%`);
      if (f.from) add(`at >= ?::date`, f.from);
      if (f.to) add(`at < (?::date + 1)`, f.to);
      // Members-only engagements stay private in the audit log too.
      const ids = await visibleIds(db, req.user);
      if (ids) add(`(engagement_id IS NULL OR engagement_id = ANY(?))`, ids);
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const size = f.limit ? Math.min(f.limit, 1000) : f.pageSize;
      const { rows: total } = await db.query(`SELECT count(*)::int AS n FROM audit_log ${w}`, vals);
      const { rows } = await db.query(
        `SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ${size} OFFSET ${(f.page - 1) * size}`,
        vals,
      );
      const { rows: actors } = await db.query(`SELECT DISTINCT actor FROM audit_log ORDER BY actor`);
      const { rows: actions } = await db.query(`SELECT DISTINCT action FROM audit_log ORDER BY action`);
      res.json({
        rows: rows.map((r: any) => ({ ...toAudit(r), ip: r.ip ?? null })),
        total: total[0].n,
        page: f.page,
        pageSize: size,
        actors: actors.map((a: any) => a.actor),
        actions: actions.map((a: any) => a.action),
      });
    }),
  );

  r.get(
    '/audit/verify',
    wrap(async (_req, res) => res.json(await verifyAudit(db))),
  );
}
