// Monitoring alerts from evaluation runs: list, acknowledge, raise an issue.
import { type Router } from 'express';
import { z } from 'zod';
import { logAudit } from '../audit/audit.js';
import { toIso } from '../core/format.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { emit } from '../core/realtime.js';

/**
 * Registers these 3 routes on the API router (each path is under /api):
 * - GET /engagements/:id/alerts
 * - POST /alerts/:id/acknowledge
 * - POST /alerts/:id/issue
 */
export function alertRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  const toAlert = (a: any) => ({
    id: a.id,
    key: `AL-${a.number}`,
    suiteId: a.suite_id,
    suiteName: a.suite_name,
    runId: a.run_id,
    kind: a.kind,
    message: a.message,
    passPct: a.pass_pct,
    baselinePct: a.baseline_pct,
    status: a.status,
    acknowledgedBy: a.acknowledged_by,
    acknowledgedAt: toIso(a.acknowledged_at),
    note: a.note,
    issueKey: a.issue_number ? `I-${a.issue_number}` : null,
    createdAt: toIso(a.created_at),
  });
  const ALERT_SELECT = `SELECT a.*, s.name AS suite_name, i.number AS issue_number FROM monitor_alerts a JOIN eval_suites s ON s.id = a.suite_id LEFT JOIN issues i ON i.id = a.issue_id`;
  r.get(
    '/engagements/:id/alerts',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${ALERT_SELECT} WHERE a.engagement_id = $1 ORDER BY a.number DESC LIMIT 100`, [
        req.params.id,
      ]);
      res.json(rows.map(toAlert));
    }),
  );
  r.post(
    '/alerts/:id/acknowledge',
    wrap(async (req, res) => {
      const b = z
        .object({ note: z.string().trim().min(3, 'Say what was done or why it is acceptable').max(1000) })
        .parse(req.body);
      await db.tx(async (q) => {
        const { rows } = await q.query(`SELECT * FROM monitor_alerts WHERE id = $1`, [req.params.id]);
        if (!rows[0]) throw httpError(404, 'Alert not found');
        if (rows[0].status !== 'open') throw httpError(409, 'Already acknowledged');
        await q.query(
          `UPDATE monitor_alerts SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now(), note = $3 WHERE id = $1`,
          [rows[0].id, actorOf(req), b.note],
        );
        await logAudit(q, actorOf(req), 'monitor.acknowledged', `alert:AL-${rows[0].number}`, { note: b.note });
      });
      emit('alert', {});
      res.json({ ok: true });
    }),
  );
  r.post(
    '/alerts/:id/issue',
    wrap(async (req, res) => {
      const { rows } = await db.query(
        `SELECT a.*, s.name AS suite_name, s.inventory_id FROM monitor_alerts a JOIN eval_suites s ON s.id = a.suite_id WHERE a.id = $1`,
        [req.params.id],
      );
      const a = rows[0];
      if (!a) throw httpError(404, 'Alert not found');
      if (a.issue_id) throw httpError(409, 'An issue already tracks this alert');
      const { rows: inv } = a.inventory_id
        ? await db.query(`SELECT card_ids FROM inventory WHERE id = $1`, [a.inventory_id])
        : { rows: [] as any[] };
      const num = await db.tx(async (q) => {
        const { rows: ins } = await q.query(
          `INSERT INTO issues (engagement_id, title, description, severity, due_date, eval_run_id, card_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, number`,
          [
            a.engagement_id,
            `Monitoring: ${a.message}`.slice(0, 200),
            `Raised from monitoring alert AL-${a.number}. Investigate why the result changed and fix or accept it.`,
            a.kind === 'below_threshold' ? 'high' : 'medium',
            new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
            a.run_id,
            inv[0]?.card_ids?.[0] ?? null,
            actorOf(req),
          ],
        );
        await q.query(`UPDATE monitor_alerts SET issue_id = $2 WHERE id = $1`, [a.id, ins[0].id]);
        await logAudit(q, actorOf(req), 'issue.raised', `issue:I-${ins[0].number}`, {
          fromAlert: `AL-${a.number}`,
          title: a.message,
        });
        return ins[0].number;
      });
      emit('issue', { changed: true });
      res.status(201).json({ issueKey: `I-${num}` });
    }),
  );
}
