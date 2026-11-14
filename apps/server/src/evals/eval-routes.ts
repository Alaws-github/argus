// Evaluation suites: schedules, suites, cases, runs and issues from failed cases.
import { EvalCaseInput, EvalSuiteInput, MONITOR_SCHEDULES, type EvalResult } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { logAudit } from '../audit/audit.js';
import { QUALITY_CASES, RED_TEAM_CASES } from '../controls/library.js';
import { type Db } from '../core/db.js';
import { toIso } from '../core/format.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { emit } from '../core/realtime.js';
import { SUITE_SELECT, toCase, toSuite } from './eval-records.js';
import { startSuiteRun } from './eval-runner.js';

/**
 * Registers these 9 routes on the API router (each path is under /api):
 * - PATCH /evals/:id/schedule
 * - GET /engagements/:id/evals
 * - POST /engagements/:id/evals
 * - GET /evals/:id
 * - POST /evals/:id/cases
 * - DELETE /eval-cases/:id
 * - POST /evals/:id/run
 * - GET /eval-runs/:id
 * - POST /eval-runs/:id/issues
 */
export function evalRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ------------------------------------------------------------- evaluations
  // ------------------------------------------------------------- monitoring
  r.patch(
    '/evals/:id/schedule',
    wrap(async (req, res) => {
      const b = z
        .object({ schedule: z.enum(MONITOR_SCHEDULES), driftDropPct: z.number().int().min(1).max(100).optional() })
        .parse(req.body);
      const { rows } = await db.query(`SELECT * FROM eval_suites WHERE id = $1`, [req.params.id]);
      if (!rows[0]) throw httpError(404, 'Suite not found');
      await db.tx(async (q) => {
        // The first scheduled run starts straight away, then on the chosen period.
        await q.query(
          `UPDATE eval_suites SET schedule = $2, next_run_at = $3, drift_drop_pct = COALESCE($4, drift_drop_pct) WHERE id = $1`,
          [rows[0].id, b.schedule, b.schedule === 'off' ? null : new Date().toISOString(), b.driftDropPct ?? null],
        );
        await logAudit(q, actorOf(req), 'monitor.scheduled', `eval:${rows[0].name}`, {
          from: rows[0].schedule,
          to: b.schedule,
          driftDropPct: b.driftDropPct ?? rows[0].drift_drop_pct,
        });
      });
      const { rows: out } = await db.query(`${SUITE_SELECT} WHERE s.id = $1`, [rows[0].id]);
      res.json(toSuite(out[0]));
    }),
  );
  r.get(
    '/engagements/:id/evals',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${SUITE_SELECT} WHERE s.engagement_id = $1 ORDER BY s.number`, [req.params.id]);
      res.json(rows.map(toSuite));
    }),
  );

  r.post(
    '/engagements/:id/evals',
    wrap(async (req, res) => {
      const b = EvalSuiteInput.extend({ template: z.enum(['none', 'red_team', 'quality']).default('none') }).parse(
        req.body,
      );
      const id = await db.tx(async (q) => {
        const { rows } = await q.query(
          `INSERT INTO eval_suites (engagement_id, name, kind, inventory_id, provider_id, model, system_prompt, threshold_pct, judge_provider_id, judge_model) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, number`,
          [
            req.params.id,
            b.name,
            b.kind,
            b.inventoryId,
            b.providerId,
            b.model,
            b.systemPrompt,
            b.thresholdPct,
            b.judgeProviderId,
            b.judgeModel,
          ],
        );
        const cases = b.template === 'red_team' ? RED_TEAM_CASES : b.template === 'quality' ? QUALITY_CASES : [];
        let n = 0;
        for (const c of cases)
          await q.query(
            `INSERT INTO eval_cases (suite_id, name, category, ref, input, "check", expected, severity, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [rows[0].id, c.name, c.category, c.ref, c.input, c.check, c.expected, c.severity, n++],
          );
        await logAudit(q, actorOf(req), 'eval.suite_added', `eval:${b.name}`, {
          kind: b.kind,
          model: b.model,
          cases: cases.length,
        });
        return rows[0].id;
      });
      const { rows } = await db.query(`${SUITE_SELECT} WHERE s.id = $1`, [id]);
      res.status(201).json(toSuite(rows[0]));
    }),
  );

  r.get(
    '/evals/:id',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${SUITE_SELECT} WHERE s.id = $1`, [req.params.id]);
      if (!rows[0]) throw httpError(404, 'Suite not found');
      const { rows: cases } = await db.query(`SELECT * FROM eval_cases WHERE suite_id = $1 ORDER BY position, name`, [
        req.params.id,
      ]);
      const { rows: runs } = await db.query(
        `SELECT id, status, model, provider, passed, total, cost_usd, run_by, started_at, ended_at, error FROM eval_runs WHERE suite_id = $1 ORDER BY started_at DESC LIMIT 20`,
        [req.params.id],
      );
      res.json({
        suite: toSuite(rows[0]),
        cases: cases.map(toCase),
        runs: runs.map((x: any) => ({
          id: x.id,
          status: x.status,
          model: x.model,
          provider: x.provider,
          passed: x.passed,
          total: x.total,
          costUsd: Number(x.cost_usd),
          runBy: x.run_by,
          startedAt: toIso(x.started_at),
          endedAt: toIso(x.ended_at),
          error: x.error,
        })),
      });
    }),
  );

  r.post(
    '/evals/:id/cases',
    wrap(async (req, res) => {
      const b = EvalCaseInput.parse(req.body);
      const { rows } = await db.tx(async (q) => {
        const out = await q.query(
          `INSERT INTO eval_cases (suite_id, name, category, ref, input, "check", expected, severity, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(max(position),0)+1 FROM eval_cases WHERE suite_id = $1)) RETURNING *`,
          [req.params.id, b.name, b.category, b.ref, b.input, b.check, b.expected, b.severity],
        );
        await logAudit(q, actorOf(req), 'eval.case_added', `eval-case:${b.name}`, { check: b.check });
        return out;
      });
      res.status(201).json(toCase(rows[0]));
    }),
  );

  r.delete(
    '/eval-cases/:id',
    wrap(async (req, res) => {
      await db.tx(async (q) => {
        const { rows } = await q.query(`DELETE FROM eval_cases WHERE id = $1 RETURNING name`, [req.params.id]);
        await logAudit(q, actorOf(req), 'eval.case_removed', `eval-case:${rows[0]?.name}`, {});
      });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/evals/:id/run',
    wrap(async (req, res) => {
      res.status(202).json({ runId: await startSuiteRun(db, req.params.id, actorOf(req)) });
    }),
  );

  r.get(
    '/eval-runs/:id',
    wrap(async (req, res) => {
      const { rows } = await db.query(
        `SELECT r.*, s.threshold_pct, s.name AS suite_name, s.engagement_id FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE r.id = $1`,
        [req.params.id],
      );
      const x = rows[0];
      if (!x) throw httpError(404, 'Run not found');
      const pct = x.total ? Math.round((x.passed / x.total) * 100) : 0;
      res.json({
        id: x.id,
        suiteId: x.suite_id,
        suiteName: x.suite_name,
        status: x.status,
        model: x.model,
        provider: x.provider,
        passed: x.passed,
        total: x.total,
        passPct: pct,
        thresholdPct: x.threshold_pct,
        meetsThreshold: x.status === 'completed' && pct >= x.threshold_pct,
        costUsd: Number(x.cost_usd),
        results: x.results,
        runBy: x.run_by,
        startedAt: toIso(x.started_at),
        endedAt: toIso(x.ended_at),
        error: x.error,
      });
    }),
  );

  // Raise one issue per failed case, linked to the run and the inventory's use case.
  r.post(
    '/eval-runs/:id/issues',
    wrap(async (req, res) => {
      const { rows } = await db.query(
        `SELECT r.*, s.engagement_id, s.name AS suite_name, s.inventory_id FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE r.id = $1`,
        [req.params.id],
      );
      const x = rows[0];
      if (!x || x.status !== 'completed') throw httpError(409, 'Run the suite to completion first');
      const failed = (x.results as EvalResult[]).filter((c) => !c.passed);
      const { rows: existing } = await db.query(`SELECT title FROM issues WHERE eval_run_id = $1`, [x.id]);
      const { rows: inv } = x.inventory_id
        ? await db.query(`SELECT card_ids FROM inventory WHERE id = $1`, [x.inventory_id])
        : { rows: [] as any[] };
      const cardId = inv[0]?.card_ids?.[0] ?? null;
      const due = (sev: string) =>
        new Date(Date.now() + ({ critical: 14, high: 30, medium: 60, low: 90 } as any)[sev] * 864e5)
          .toISOString()
          .slice(0, 10);
      let created = 0;
      await db.tx(async (q) => {
        for (const f of failed) {
          const title = `${x.suite_name}: ${f.caseName} failed`;
          if (existing.some((e: any) => e.title === title)) continue;
          const { rows: ins } = await q.query(
            `INSERT INTO issues (engagement_id, title, description, severity, due_date, eval_run_id, card_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING number`,
            [
              x.engagement_id,
              title,
              `Input: ${f.input}\n\nAnswer: ${f.output}\n\nCheck: ${f.reason}${f.ref ? `\n\nReference: ${f.ref}` : ''}`,
              f.severity,
              due(f.severity),
              x.id,
              cardId,
              actorOf(req),
            ],
          );
          await logAudit(q, actorOf(req), 'issue.raised', `issue:I-${ins[0].number}`, {
            from: 'evaluation',
            case: f.caseName,
            severity: f.severity,
          });
          created++;
        }
      });
      emit('issue', { changed: true });
      res.json({ created });
    }),
  );
}
