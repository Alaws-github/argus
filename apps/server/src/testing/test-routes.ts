// Control tests: list, add, prepare and review (segregation of duties applies).
import { TestInput, TestStatus } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { TEST_SELECT, toTest } from './test-records.js';
import { logAudit } from '../audit/audit.js';
import { requireDifferentPerson } from '../auth/auth.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';

/**
 * Registers these 4 routes on the API router (each path is under /api):
 * - GET /engagements/:id/tests
 * - POST /engagements/:id/tests
 * - PATCH /tests/:id
 * - POST /tests/:id/review
 */
export function testRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ------------------------------------------------------------------- tests
  r.get(
    '/engagements/:id/tests',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${TEST_SELECT} WHERE t.engagement_id = $1 ORDER BY t.number`, [req.params.id]);
      res.json(rows.map(toTest));
    }),
  );

  r.post(
    '/engagements/:id/tests',
    wrap(async (req, res) => {
      const b = TestInput.parse(req.body);
      const id = await db.tx(async (q) => {
        const { rows } = await q.query(
          `INSERT INTO tests (engagement_id, control_id, kind, title, procedure, population, sample_size, expected) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, number`,
          [req.params.id, b.controlId, b.kind, b.title, b.procedure, b.population, b.sampleSize, b.expected],
        );
        await logAudit(q, actorOf(req), 'test.added', `test:T-${rows[0].number}`, { title: b.title });
        return rows[0].id;
      });
      const { rows } = await db.query(`${TEST_SELECT} WHERE t.id = $1`, [id]);
      res.status(201).json(toTest(rows[0]));
    }),
  );

  r.patch(
    '/tests/:id',
    wrap(async (req, res) => {
      const b = TestInput.partial()
        .omit({ controlId: true })
        .extend({
          status: TestStatus.optional(),
          actual: z.string().max(4000).optional(),
          exceptions: z.number().int().min(0).max(100000).optional(),
          // The person concluding says whether they started from the agent's draft.
          fromDraft: z.boolean().optional(),
        })
        .parse(req.body);
      const { rows: before } = await db.query(`SELECT * FROM tests WHERE id = $1`, [req.params.id]);
      if (!before[0]) throw httpError(404, 'Test not found');
      if (before[0].reviewed_by && (b.status || b.actual !== undefined || b.exceptions !== undefined)) {
        throw httpError(
          409,
          'This test has been reviewed. Add a new test to retest instead of changing a reviewed result.',
        );
      }
      if ((b.status === 'passed' || b.status === 'failed') && !(b.actual ?? before[0].actual).trim())
        throw httpError(400, 'Record the actual result before concluding the test');
      if (b.status === 'passed' && (b.exceptions ?? before[0].exceptions) > 0)
        throw httpError(400, "A test with exceptions can't pass. Mark it failed, or set exceptions to 0.");
      const map: Record<string, string> = {
        kind: 'kind',
        title: 'title',
        procedure: 'procedure',
        population: 'population',
        sampleSize: 'sample_size',
        expected: 'expected',
        actual: 'actual',
        exceptions: 'exceptions',
        status: 'status',
      };
      const keys = Object.keys(b).filter((k) => map[k]);
      const concluding = b.status === 'passed' || b.status === 'failed';
      await db.tx(async (q) => {
        await q.query(
          `UPDATE tests SET ${[...keys.map((k, i) => `${map[k]} = $${i + 2}`), ...(concluding ? [`prepared_by = $${keys.length + 2}`, 'prepared_at = now()'] : [])].join(', ')} WHERE id = $1`,
          [before[0].id, ...keys.map((k) => (b as any)[k]), ...(concluding ? [actorOf(req)] : [])],
        );
        const usedDraft = concluding && b.fromDraft && before[0].draft;
        if (usedDraft)
          await q.query(`UPDATE tests SET draft = draft || '{"used": true}'::jsonb WHERE id = $1`, [before[0].id]);
        await logAudit(q, actorOf(req), concluding ? 'test.concluded' : 'test.changed', `test:T-${before[0].number}`, {
          ...Object.fromEntries(keys.map((k) => [k, { from: before[0][map[k]], to: (b as any)[k] }])),
          ...(usedDraft
            ? {
                startedFromAgentDraft: {
                  run: before[0].draft.runId,
                  proposed: before[0].draft.proposed,
                  model: before[0].draft.model,
                },
              }
            : {}),
        });
      });
      const { rows } = await db.query(`${TEST_SELECT} WHERE t.id = $1`, [before[0].id]);
      res.json(toTest(rows[0]));
    }),
  );

  // A reviewer signs off a concluded test. The control's status follows its tests.
  r.post(
    '/tests/:id/review',
    wrap(async (req, res) => {
      const b = z.object({ note: z.string().max(1000).optional() }).parse(req.body ?? {});
      const { rows: t } = await db.query(`SELECT * FROM tests WHERE id = $1`, [req.params.id]);
      if (!t[0]) throw httpError(404, 'Test not found');
      if (!['passed', 'failed'].includes(t[0].status))
        throw httpError(409, 'Only a passed or failed test can be reviewed');
      if (t[0].reviewed_by) throw httpError(409, 'This test is already reviewed');
      requireDifferentPerson(req, t[0].prepared_by, 'test');
      await db.tx(async (q) => {
        await q.query(`UPDATE tests SET reviewed_by = $2, reviewed_at = now() WHERE id = $1`, [t[0].id, actorOf(req)]);
        // The latest reviewed result decides: a passed retest clears an earlier failure.
        const { rows: all } = await q.query(
          `SELECT status, reviewed_by FROM tests WHERE control_id = $1 ORDER BY created_at, number`,
          [t[0].control_id],
        );
        const reviewed = all.filter((x: any) => x.reviewed_by);
        const latest = reviewed[reviewed.length - 1];
        const status =
          latest?.status === 'failed'
            ? 'failed'
            : latest?.status === 'passed' &&
                reviewed.every(
                  (x: any, n: number) =>
                    x.status === 'passed' || reviewed.slice(n + 1).some((y: any) => y.status === 'passed'),
                )
              ? 'operating'
              : null;
        if (status) await q.query(`UPDATE controls SET status = $2 WHERE id = $1`, [t[0].control_id, status]);
        await logAudit(q, actorOf(req), 'test.reviewed', `test:T-${t[0].number}`, {
          result: t[0].status,
          preparedBy: t[0].prepared_by,
          ...(b.note ? { note: b.note } : {}),
        });
      });
      const { rows } = await db.query(`${TEST_SELECT} WHERE t.id = $1`, [t[0].id]);
      res.json(toTest(rows[0]));
    }),
  );
}
