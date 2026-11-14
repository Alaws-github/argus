// The board report: build it from the records and sign it off.
import { ASSESSMENT_AREAS, riskRating } from '@gh/shared';
import { type Router } from 'express';
import { logAudit } from '../audit/audit.js';
import { isMe } from '../auth/auth.js';
import { CONTROL_SELECT, toControl } from '../controls/control-records.js';
import { type Db } from '../core/db.js';
import { toIso } from '../core/format.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { SUITE_SELECT, toSuite } from '../evals/eval-records.js';
import { ISSUE_SELECT, toIssue } from '../issues/issue-records.js';
import { getEngagement } from '../settings/settings-store.js';
import { suggestScores } from './assessment-scores.js';

/**
 * Registers these 2 routes on the API router (each path is under /api):
 * - GET /engagements/:id/report
 * - POST /engagements/:id/report/sign
 */
export function reportRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  r.get(
    '/engagements/:id/report',
    wrap(async (req, res) => {
      const id = req.params.id;
      const e = await getEngagement(db, id);
      if (!e) throw httpError(404, 'Engagement not found');
      const { rows: er } = await db.query(`SELECT report_signed_by, report_signed_at FROM engagements WHERE id = $1`, [
        id,
      ]);
      const { rows: cards } = await db.query(
        `SELECT key, title, tier, stage, drafts FROM cards WHERE engagement_id = $1 AND NOT (stage = 'closed' AND tier IS NULL) ORDER BY number`,
        [id],
      );
      const { rows: risks } = await db.query(
        `SELECT r.number, r.title, r.likelihood, r.impact, r.residual_likelihood, r.residual_impact, r.status, r.treatment, r.owner, c.key AS card_key
       FROM risks r JOIN cards c ON c.id = r.card_id WHERE r.engagement_id = $1 ORDER BY r.likelihood * r.impact DESC LIMIT 10`,
        [id],
      );
      const { rows: ctl } = await db.query(`${CONTROL_SELECT} WHERE c.engagement_id = $1 ORDER BY c.number`, [id]);
      const { rows: iss } = await db.query(
        `${ISSUE_SELECT} WHERE i.engagement_id = $1 AND i.status IN ('open','in_remediation','ready_for_retest')
      ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.due_date NULLS LAST`,
        [id],
      );
      const { rows: evals } = await db.query(`${SUITE_SELECT} WHERE s.engagement_id = $1 ORDER BY s.number`, [id]);
      const suggested = await suggestScores(db, id);
      const { rows: scored } = await db.query(`SELECT * FROM assessments WHERE engagement_id = $1`, [id]);
      const controls = ctl.map(toControl);
      res.json({
        engagement: e,
        generatedAt: new Date().toISOString(),
        signedBy: er[0]?.report_signed_by ?? null,
        signedAt: toIso(er[0]?.report_signed_at),
        useCases: cards.map((c: any) => ({
          key: c.key,
          title: c.title,
          tier: c.tier,
          stage: c.stage,
          // Only a summary a person approved goes in the report.
          summary: c.drafts?.report?.approvedBy
            ? {
                headline: c.drafts.report.headline,
                text: c.drafts.report.summary,
                approvedBy: c.drafts.report.approvedBy,
              }
            : null,
        })),
        topRisks: risks.map((r: any) => ({
          key: `R-${r.number}`,
          title: r.title,
          cardKey: r.card_key,
          inherent: r.likelihood * r.impact,
          residual: r.residual_likelihood && r.residual_impact ? r.residual_likelihood * r.residual_impact : null,
          rating: riskRating(r.likelihood * r.impact),
          treatment: r.treatment,
          status: r.status,
          owner: r.owner,
        })),
        controls: {
          total: controls.length,
          operating: controls.filter((c) => c.status === 'operating').length,
          failed: controls.filter((c) => c.status === 'failed').length,
          untested: controls.filter((c) => !c.tests.passed && !c.tests.failed).length,
        },
        openIssues: iss.map(toIssue),
        evals: evals.map(toSuite),
        areas: ASSESSMENT_AREAS.map((a) => {
          const s = scored.find((x: any) => x.area === a.id);
          return {
            id: a.id,
            name: a.name,
            basis: a.basis,
            score: s?.score ?? null,
            suggested: suggested[a.id].score,
            rationale: s?.rationale ?? '',
            reasons: suggested[a.id].reasons,
          };
        }),
      });
    }),
  );

  r.post(
    '/engagements/:id/report/sign',
    wrap(async (req, res) => {
      const { rows: scored } = await db.query(`SELECT assessed_by FROM assessments WHERE engagement_id = $1`, [
        req.params.id,
      ]);
      if (scored.length < ASSESSMENT_AREAS.length)
        throw httpError(409, `Score all ${ASSESSMENT_AREAS.length} assessment areas before signing off`);
      if (scored.every((s: any) => isMe(req, s.assessed_by))) {
        throw httpError(403, 'You scored every area yourself, so someone else has to sign the report off');
      }
      await db.tx(async (q) => {
        await q.query(`UPDATE engagements SET report_signed_by = $2, report_signed_at = now() WHERE id = $1`, [
          req.params.id,
          actorOf(req),
        ]);
        await logAudit(q, actorOf(req), 'report.signed_off', `engagement:${req.params.id}`, {});
      });
      res.json({ ok: true });
    }),
  );
}
