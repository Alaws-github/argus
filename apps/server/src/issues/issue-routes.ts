// Issues: list, raise and move through the defect-style lifecycle.
import { IssueInput, IssueStatus, Severity } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { ISSUE_SELECT, toIssue } from './issue-records.js';
import { logAudit } from '../audit/audit.js';
import { requirePerm } from '../auth/auth.js';
import { toDay } from '../core/format.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { emit } from '../core/realtime.js';

export function issueRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ------------------------------------------------------------------ issues
  r.get(
    '/engagements/:id/issues',
    wrap(async (req, res) => {
      const { rows } = await db.query(
        `${ISSUE_SELECT} WHERE i.engagement_id = $1 ORDER BY CASE i.status WHEN 'closed' THEN 2 WHEN 'risk_accepted' THEN 1 ELSE 0 END,
       CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.number`,
        [req.params.id],
      );
      res.json(rows.map(toIssue));
    }),
  );

  r.post(
    '/engagements/:id/issues',
    wrap(async (req, res) => {
      const b = IssueInput.parse(req.body);
      let cardId = b.cardId;
      if (!cardId && b.controlId)
        cardId = (await db.query(`SELECT card_id FROM controls WHERE id = $1`, [b.controlId])).rows[0]?.card_id ?? null;
      const id = await db.tx(async (q) => {
        const { rows } = await q.query(
          `INSERT INTO issues (engagement_id, title, description, severity, owner, due_date, control_id, test_id, eval_run_id, card_id, created_by, incident_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, number`,
          [
            req.params.id,
            b.title,
            b.description,
            b.severity,
            b.owner,
            b.dueDate,
            b.controlId,
            b.testId,
            b.evalRunId,
            cardId,
            actorOf(req),
            b.incidentId,
          ],
        );
        await logAudit(q, actorOf(req), 'issue.raised', `issue:I-${rows[0].number}`, {
          title: b.title,
          severity: b.severity,
        });
        return rows[0].id;
      });
      const { rows } = await db.query(`${ISSUE_SELECT} WHERE i.id = $1`, [id]);
      emit('issue', { changed: true });
      res.status(201).json(toIssue(rows[0]));
    }),
  );

  // Issue lifecycle, like a defect: open → in remediation → ready for retest →
  // closed (by an approver, with a passed retest on record when a test raised it)
  // or risk accepted (by someone who can accept risk, with a reason).
  const NEXT: Record<string, string[]> = {
    open: ['in_remediation', 'risk_accepted'],
    in_remediation: ['ready_for_retest', 'open', 'risk_accepted'],
    ready_for_retest: ['closed', 'in_remediation'],
    closed: ['open'],
    risk_accepted: ['open'],
  };
  r.patch(
    '/issues/:id',
    wrap(async (req, res) => {
      const b = z
        .object({
          status: IssueStatus.optional(),
          severity: Severity.optional(),
          owner: z.string().max(120).optional(),
          dueDate: z.string().nullable().optional(),
          managementResponse: z.string().max(4000).optional(),
          note: z.string().max(2000).optional(),
        })
        .parse(req.body);
      const { rows: before } = await db.query(`SELECT * FROM issues WHERE id = $1`, [req.params.id]);
      const i = before[0];
      if (!i) throw httpError(404, 'Issue not found');
      if (b.status && b.status !== i.status) {
        if (!NEXT[i.status].includes(b.status))
          throw httpError(
            409,
            `An issue that is ${i.status.replace(/_/g, ' ')} can't go to ${b.status.replace(/_/g, ' ')}`,
          );
        if (b.status === 'closed') {
          requirePerm(req, 'approve');
          if (i.test_id) {
            const { rows: rt } = await db.query(
              `SELECT 1 FROM tests WHERE control_id = (SELECT control_id FROM tests WHERE id = $1) AND status = 'passed' AND reviewed_by IS NOT NULL AND created_at > $2`,
              [i.test_id, i.created_at],
            );
            if (!rt.length) throw httpError(409, 'Close it after a retest of the control passes and is reviewed');
          }
        }
        if (b.status === 'risk_accepted') {
          requirePerm(req, 'accept_risk');
          if (!b.note?.trim()) throw httpError(400, 'Say why the risk is accepted');
        }
      }
      const map: Record<string, string> = {
        status: 'status',
        severity: 'severity',
        owner: 'owner',
        dueDate: 'due_date',
        managementResponse: 'management_response',
      };
      const keys = Object.keys(b).filter((k) => map[k]);
      const closing = b.status === 'closed' || b.status === 'risk_accepted';
      await db.tx(async (q) => {
        if (keys.length) {
          await q.query(
            `UPDATE issues SET ${[...keys.map((k, n) => `${map[k]} = $${n + 2}`), ...(closing ? [`closed_by = $${keys.length + 2}`, 'closed_at = now()'] : b.status ? ['closed_by = NULL', 'closed_at = NULL'] : [])].join(', ')} WHERE id = $1`,
            [i.id, ...keys.map((k) => (b as any)[k]), ...(closing ? [actorOf(req)] : [])],
          );
        }
        await logAudit(q, actorOf(req), b.status ? `issue.${b.status}` : 'issue.changed', `issue:I-${i.number}`, {
          ...Object.fromEntries(
            keys.map((k) => [k, { from: k === 'dueDate' ? toDay(i.due_date) : i[map[k]], to: (b as any)[k] }]),
          ),
          ...(b.note ? { note: b.note } : {}),
        });
      });
      const { rows } = await db.query(`${ISSUE_SELECT} WHERE i.id = $1`, [i.id]);
      emit('issue', { changed: true });
      res.json(toIssue(rows[0]));
    }),
  );
}
