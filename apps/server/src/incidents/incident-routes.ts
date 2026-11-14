// Incidents on live AI systems: what happened, who must be told and by when,
// what was done, and the lessons. Closing one is a sign-off: it needs a
// reviewer or lead who didn't report it, a root cause, lessons, and every
// required notice marked as sent.
import type { Router } from 'express';
import { z } from 'zod';
import {
  can,
  INCIDENT_STATUSES,
  NewIncident,
  NOTIFY_CLOCKS,
  Severity,
  type Incident,
  type NotifyClock,
} from '@gh/shared';
import type { Db } from '../core/db.js';
import { logAudit } from '../audit/audit.js';
import { requireDifferentPerson } from '../auth/auth.js';
import { emit } from '../core/realtime.js';
import { type Wrap, httpError, type ActorOf } from '../core/http.js';
import { toIso } from '../core/format.js';

const SELECT = `
  SELECT i.*, v.name AS inventory_name, c.key AS card_key,
    COALESCE((SELECT json_agg('I-' || s.number ORDER BY s.number) FROM issues s WHERE s.incident_id = i.id), '[]') AS issue_keys
  FROM incidents i LEFT JOIN inventory v ON v.id = i.inventory_id LEFT JOIN cards c ON c.id = i.card_id`;

/** An incident row as an API record. */
export const toIncident = (r: any): Incident => ({
  id: r.id,
  key: `INC-${r.number}`,
  engagementId: r.engagement_id,
  title: r.title,
  description: r.description,
  severity: r.severity,
  status: r.status,
  occurredAt: toIso(r.occurred_at),
  awareAt: toIso(r.aware_at)!,
  inventoryId: r.inventory_id,
  inventoryName: r.inventory_name ?? null,
  cardId: r.card_id,
  cardKey: r.card_key ?? null,
  owner: r.owner,
  notices: r.notices ?? [],
  timeline: r.timeline ?? [],
  rootCause: r.root_cause,
  lessons: r.lessons,
  issueKeys: r.issue_keys ?? [],
  reportedBy: r.reported_by,
  createdAt: toIso(r.created_at)!,
  closedBy: r.closed_by,
  closedAt: toIso(r.closed_at),
});

const Patch = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().max(4000).optional(),
  severity: Severity.optional(),
  owner: z.string().max(120).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  rootCause: z.string().max(4000).optional(),
  lessons: z.string().max(4000).optional(),
  note: z.string().trim().min(3).max(2000).optional(),
  addClock: z.enum(Object.keys(NOTIFY_CLOCKS) as [NotifyClock, ...NotifyClock[]]).optional(),
  sent: z
    .object({ clock: z.string(), reference: z.string().trim().min(2).max(300), sentAt: z.string().optional() })
    .optional(),
});

/**
 * Registers these 3 routes on the API router (each path is under /api):
 * - GET /engagements/:id/incidents
 * - POST /engagements/:id/incidents
 * - PATCH /incidents/:id
 */
export function incidentRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  r.get(
    '/engagements/:id/incidents',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${SELECT} WHERE i.engagement_id = $1 ORDER BY i.number DESC`, [req.params.id]);
      res.json(rows.map(toIncident));
    }),
  );

  r.post(
    '/engagements/:id/incidents',
    wrap(async (req, res) => {
      const b = NewIncident.parse(req.body);
      const aware = new Date(b.awareAt);
      if (Number.isNaN(aware.getTime())) throw httpError(400, 'Say when you became aware of it');
      const notices = b.clocks.map((k) => ({
        clock: k,
        to: NOTIFY_CLOCKS[k].to,
        due: new Date(aware.getTime() + NOTIFY_CLOCKS[k].hours * 3600_000).toISOString(),
        sentAt: null,
        sentBy: null,
        reference: '',
      }));
      const actor = actorOf(req);
      const row = await db.tx(async (q) => {
        const { rows } = await q.query(
          `INSERT INTO incidents (engagement_id, title, description, severity, occurred_at, aware_at, inventory_id, card_id, owner, notices, timeline, reported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            req.params.id,
            b.title,
            b.description,
            b.severity,
            b.occurredAt,
            aware.toISOString(),
            b.inventoryId,
            b.cardId,
            b.owner,
            JSON.stringify(notices),
            JSON.stringify([{ at: new Date().toISOString(), by: actor, text: 'Reported' }]),
            actor,
          ],
        );
        await logAudit(q, actor, 'incident.reported', `incident:INC-${rows[0].number}`, {
          title: b.title,
          severity: b.severity,
          awareAt: aware.toISOString(),
          notices: notices.map((n) => `${n.to} by ${n.due}`),
        });
        return rows[0];
      });
      emit('incident', { engagementId: req.params.id });
      const { rows } = await db.query(`${SELECT} WHERE i.id = $1`, [row.id]);
      res.status(201).json(toIncident(rows[0]));
    }),
  );

  r.patch(
    '/incidents/:id',
    wrap(async (req, res) => {
      const b = Patch.parse(req.body);
      const actor = actorOf(req);
      await db.tx(async (q) => {
        const { rows } = await q.query(`SELECT * FROM incidents WHERE id = $1 FOR UPDATE`, [req.params.id]);
        const i = rows[0];
        if (!i) throw httpError(404, 'Incident not found');
        if (i.status === 'closed') throw httpError(409, 'This incident is closed');
        const timeline = [...(i.timeline ?? [])];
        const notices = [...(i.notices ?? [])];
        const now = new Date().toISOString();
        const changes: Record<string, unknown> = {};
        if (b.addClock) {
          if (notices.some((n: any) => n.clock === b.addClock))
            throw httpError(409, 'That notice is already on the incident');
          const c = NOTIFY_CLOCKS[b.addClock];
          notices.push({
            clock: b.addClock,
            to: c.to,
            due: new Date(new Date(i.aware_at).getTime() + c.hours * 3600_000).toISOString(),
            sentAt: null,
            sentBy: null,
            reference: '',
          });
          timeline.push({ at: now, by: actor, text: `Notice required: ${c.label}` });
          changes.noticeAdded = b.addClock;
        }
        if (b.sent) {
          const n = notices.find((x: any) => x.clock === b.sent!.clock);
          if (!n) throw httpError(404, 'No such notice on this incident');
          if (n.sentAt) throw httpError(409, 'Already recorded as sent');
          Object.assign(n, { sentAt: b.sent.sentAt ?? now, sentBy: actor, reference: b.sent.reference });
          const late = new Date(n.sentAt).getTime() > new Date(n.due).getTime();
          timeline.push({
            at: now,
            by: actor,
            text: `Notified ${n.to} (${b.sent.reference})${late ? ', after the deadline' : ''}`,
          });
          changes.noticeSent = { to: n.to, reference: b.sent.reference, late };
        }
        if (b.note) {
          timeline.push({ at: now, by: actor, text: b.note });
          changes.note = b.note;
        }
        const set: Record<string, unknown> = {};
        for (const [k, col] of [
          ['title', 'title'],
          ['description', 'description'],
          ['severity', 'severity'],
          ['owner', 'owner'],
          ['rootCause', 'root_cause'],
          ['lessons', 'lessons'],
        ] as const) {
          if ((b as any)[k] !== undefined && (b as any)[k] !== i[col]) set[col] = (b as any)[k];
        }
        if (b.status && b.status !== i.status) {
          if (b.status === 'closed') {
            if (!can(req.user!.role, 'approve')) throw httpError(403, 'Only a reviewer or lead can close an incident');
            requireDifferentPerson(req, i.reported_by, 'incident report');
            const rc = (b.rootCause ?? i.root_cause).trim();
            const ls = (b.lessons ?? i.lessons).trim();
            if (rc.length < 10 || ls.length < 10)
              throw httpError(409, 'Record the root cause and the lessons learned before closing');
            const unsent = notices.filter((n: any) => !n.sentAt);
            if (unsent.length)
              throw httpError(409, `Record these notices as sent first: ${unsent.map((n: any) => n.to).join(', ')}`);
            const { rows: open } = await q.query(
              `SELECT number FROM issues WHERE incident_id = $1 AND status NOT IN ('closed','risk_accepted')`,
              [i.id],
            );
            if (open.length)
              throw httpError(
                409,
                `Close its corrective actions first: ${open.map((o: any) => `I-${o.number}`).join(', ')}`,
              );
            set.closed_by = actor;
            set.closed_at = now;
          }
          set.status = b.status;
          timeline.push({ at: now, by: actor, text: `Status: ${b.status}` });
        }
        for (const k of Object.keys(set))
          if (!['closed_by', 'closed_at'].includes(k)) changes[k] = { from: i[k] ?? null, to: set[k] };
        if (!Object.keys(changes).length) throw httpError(400, 'Nothing to change');
        const cols = Object.keys(set);
        await q.query(
          `UPDATE incidents SET notices = $2, timeline = $3${cols.map((c, n) => `, ${c} = $${n + 4}`).join('')} WHERE id = $1`,
          [i.id, JSON.stringify(notices), JSON.stringify(timeline), ...cols.map((c) => set[c])],
        );
        await logAudit(
          q,
          actor,
          set.status === 'closed' ? 'incident.closed' : 'incident.updated',
          `incident:INC-${i.number}`,
          changes,
        );
      });
      emit('incident', { id: req.params.id });
      const { rows } = await db.query(`${SELECT} WHERE i.id = $1`, [req.params.id]);
      res.json(toIncident(rows[0]));
    }),
  );
}
