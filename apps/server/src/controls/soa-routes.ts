// The Statement of Applicability: which library controls apply to the engagement and why.
import { type Router } from 'express';
import { z } from 'zod';
import { toLibrary } from './control-records.js';
import { logAudit } from '../audit/audit.js';
import { toIso } from '../core/format.js';
import { type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';

/**
 * Registers these 2 routes on the API router (each path is under /api):
 * - GET /engagements/:id/soa
 * - PUT /engagements/:id/soa/:libraryId
 */
export function soaRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ------------------------------------------------- Statement of Applicability
  r.get(
    '/engagements/:id/soa',
    wrap(async (req, res) => {
      const { rows } = await db.query(
        `SELECT l.*, s.applicable, s.justification, s.decided_by, s.decided_at,
         (SELECT count(*)::int FROM controls c WHERE c.library_id = l.id AND c.engagement_id = $1) AS in_use
       FROM control_library l LEFT JOIN soa s ON s.library_id = l.id AND s.engagement_id = $1 ORDER BY l.code`,
        [req.params.id],
      );
      res.json(
        rows.map((x: any) => ({
          ...toLibrary(x),
          applicable: x.applicable,
          justification: x.justification ?? '',
          decidedBy: x.decided_by,
          decidedAt: toIso(x.decided_at),
          inUse: x.in_use,
        })),
      );
    }),
  );

  r.put(
    '/engagements/:id/soa/:libraryId',
    wrap(async (req, res) => {
      const b = z
        .object({
          applicable: z.boolean(),
          justification: z.string().trim().min(5, 'Give a reason of at least a few words').max(1000),
        })
        .parse(req.body);
      await db.tx(async (q) => {
        await q.query(
          `INSERT INTO soa (engagement_id, library_id, applicable, justification, decided_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (engagement_id, library_id) DO UPDATE SET applicable = EXCLUDED.applicable, justification = EXCLUDED.justification, decided_by = EXCLUDED.decided_by, decided_at = now()`,
          [req.params.id, req.params.libraryId, b.applicable, b.justification, actorOf(req)],
        );
        const { rows } = await q.query(`SELECT code FROM control_library WHERE id = $1`, [req.params.libraryId]);
        await logAudit(q, actorOf(req), 'soa.decided', `library:${rows[0]?.code}`, b);
      });
      res.json({ ok: true });
    }),
  );
}
