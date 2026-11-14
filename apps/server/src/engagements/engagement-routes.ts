// Engagements: list, create (with the optional client workflow and tools) and update.
import { EngagementPatch, NewEngagement, STAGES, toolById, type Stage } from '@gh/shared';
import { type Router } from 'express';
import { visibleIds } from '../auth/access.js';
import { createEngagement } from './create-engagement.js';
import { logAudit } from '../audit/audit.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { ensureEngagementKnowledge, indexEngagement, scheduleEmbedding } from '../knowledge/kb.js';
import '../ai/providers.js';
import { emit } from '../core/realtime.js';
import '../setup/seed.js';
import { getEngagement, toEngagement } from '../settings/settings-store.js';

export function engagementRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  r.get(
    '/engagements',
    wrap(async (req, res) => {
      const ids = await visibleIds(db, req.user);
      const { rows } = await db.query(
        `SELECT * FROM engagements ${ids ? 'WHERE id = ANY($1)' : ''} ORDER BY created_at`,
        ids ? [ids] : [],
      );
      res.json(rows.map(toEngagement));
    }),
  );

  // -------------------------------------------------------------- engagement
  // Add an engagement: the client, what's in scope, where people step in and
  // which models run the agents. Everything lands in one transaction.
  r.post(
    '/engagements',
    wrap(async (req, res) => {
      const id = await createEngagement(db, NewEngagement.parse(req.body), req.user!, actorOf(req));
      const { rows } = await db.query(`SELECT * FROM engagements WHERE id = $1`, [id]);
      const e = toEngagement(rows[0]);
      await ensureEngagementKnowledge(db, e.id).catch(() => {});
      scheduleEmbedding(db);
      emit('engagement', e);
      res.status(201).json(e);
    }),
  );

  r.patch(
    '/engagements/:id',
    wrap(async (req, res) => {
      const patch = EngagementPatch.parse(req.body);
      const before = await getEngagement(db, req.params.id);
      if (!before) throw httpError(404, 'Engagement not found');
      const actor = actorOf(req);
      const sets: string[] = [];
      const vals: unknown[] = [];
      const set = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length + 1}`);
      };
      for (const k of ['name', 'client', 'prefix', 'framework', 'about', 'paused'] as const)
        if (patch[k] !== undefined) set(k, patch[k]);
      if (patch.gates) {
        const gates = { ...before.gates };
        for (const [k, v] of Object.entries(patch.gates))
          if ((STAGES as readonly string[]).includes(k)) gates[k as Stage] = v;
        gates.intake = true; // a person always decides what enters governance
        gates.closed = false;
        set('gates', JSON.stringify(gates));
      }
      if (patch.appetite) set('appetite', JSON.stringify(patch.appetite));
      if (patch.modules) set('modules', JSON.stringify({ ...before.modules, ...patch.modules }));
      if (patch.clientTools) set('client_tools', JSON.stringify(patch.clientTools.filter((t) => toolById(t))));
      if (patch.writeBack !== undefined) set('write_back', patch.writeBack);
      if (patch.clientStepsDefault !== undefined) set('client_steps_default', patch.clientStepsDefault);
      if (!sets.length) throw httpError(400, 'Nothing to change');
      await db.tx(async (q) => {
        await q.query(`UPDATE engagements SET ${sets.join(', ')} WHERE id = $1`, [before.id, ...vals]);
        const changes = Object.fromEntries(
          Object.entries(patch).map(([k, v]) => [k, k === 'about' ? 'updated' : { from: (before as any)[k], to: v }]),
        );
        await logAudit(q, actor, 'engagement.changed', `engagement:${before.slug}`, changes);
      });
      const { rows } = await db.query(`SELECT * FROM engagements WHERE id = $1`, [before.id]);
      const e = toEngagement(rows[0]);
      await ensureEngagementKnowledge(db, e.id).catch(() => {});
      if (req.method === 'PATCH' && (req.body as any)?.about !== undefined)
        await indexEngagement(db, { id: e.id, name: e.name, client: e.client, about: e.about });
      scheduleEmbedding(db);
      emit('engagement', e);
      res.json(e);
    }),
  );
}
