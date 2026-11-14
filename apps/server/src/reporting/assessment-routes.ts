// The readiness assessment: scores per area, with suggestions from the records.
import { ASSESSMENT_AREAS } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { suggestScores } from './assessment-scores.js';
import { logAudit } from '../audit/audit.js';
import { toIso } from '../core/format.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';

export function assessmentRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // -------------------------------------------------- assessment and report
  r.get(
    '/engagements/:id/assessment',
    wrap(async (req, res) => {
      const suggested = await suggestScores(db, req.params.id);
      const { rows } = await db.query(`SELECT * FROM assessments WHERE engagement_id = $1`, [req.params.id]);
      res.json(
        ASSESSMENT_AREAS.map((a) => {
          const saved = rows.find((x: any) => x.area === a.id);
          return {
            ...a,
            suggested: suggested[a.id].score,
            reasons: suggested[a.id].reasons,
            score: saved?.score ?? null,
            rationale: saved?.rationale ?? '',
            assessedBy: saved?.assessed_by ?? null,
            assessedAt: toIso(saved?.assessed_at),
          };
        }),
      );
    }),
  );

  r.put(
    '/engagements/:id/assessment/:area',
    wrap(async (req, res) => {
      const area = ASSESSMENT_AREAS.find((a) => a.id === req.params.area);
      if (!area) throw httpError(404, 'Unknown area');
      const b = z
        .object({
          score: z.number().int().min(1).max(5),
          rationale: z.string().trim().min(10, 'Explain the score in a sentence or two').max(2000),
        })
        .parse(req.body);
      await db.tx(async (q) => {
        await q.query(
          `INSERT INTO assessments (engagement_id, area, score, rationale, assessed_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (engagement_id, area) DO UPDATE SET score = EXCLUDED.score, rationale = EXCLUDED.rationale, assessed_by = EXCLUDED.assessed_by, assessed_at = now()`,
          [req.params.id, area.id, b.score, b.rationale, actorOf(req)],
        );
        await q.query(`UPDATE engagements SET report_signed_by = NULL, report_signed_at = NULL WHERE id = $1`, [
          req.params.id,
        ]);
        await logAudit(q, actorOf(req), 'assessment.scored', `area:${area.id}`, b);
      });
      res.json({ ok: true });
    }),
  );
}
