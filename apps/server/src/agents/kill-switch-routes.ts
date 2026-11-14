// The kill switch: stop an agent at once, audited.
import { type Router } from 'express';
import { z } from 'zod';
import { logAudit } from '../audit/audit.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { emit } from '../core/realtime.js';

/**
 * Registers this route on the API router (each path is under /api):
 * - POST /agents/:id/kill
 */
export function killSwitchRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ------------------------------------------------- agent kill switch, audit
  r.post(
    '/agents/:id/kill',
    wrap(async (req, res) => {
      const b = z.object({ test: z.boolean().default(false) }).parse(req.body ?? {});
      const { rows } = await db.query(`SELECT * FROM agents WHERE id = $1`, [req.params.id]);
      const a = rows[0];
      if (!a) throw httpError(404, 'Agent not found');
      let stopped = 0;
      await db.tx(async (q) => {
        if (b.test) {
          // A test proves the switch works without leaving the agent off: it is
          // switched off, checked, and switched back to how it was.
          await q.query(`UPDATE agents SET enabled = false WHERE id = $1`, [a.id]);
          const { rows: chk } = await q.query(`SELECT enabled FROM agents WHERE id = $1`, [a.id]);
          if (chk[0].enabled) throw httpError(500, 'The kill switch did not take effect');
          await q.query(`UPDATE agents SET enabled = $2, kill_tested_at = now() WHERE id = $1`, [a.id, a.enabled]);
          await logAudit(q, actorOf(req), 'agent.kill_switch_tested', `agent:${a.name}`, { result: 'passed' });
          return;
        }
        const { rows: runs } = await q.query(
          `UPDATE runs SET status = 'failed', error = 'Stopped by the kill switch', ended_at = now() WHERE agent_id = $1 AND status = 'running' RETURNING card_id`,
          [a.id],
        );
        stopped = runs.length;
        for (const r0 of runs)
          await q.query(`UPDATE cards SET status = 'failed', status_note = $2 WHERE id = $1`, [
            r0.card_id,
            `Stopped by the kill switch (${actorOf(req)}).`,
          ]);
        await q.query(
          `UPDATE cards SET status = 'idle', status_note = $3 WHERE engagement_id = $1 AND stage = $2 AND status = 'queued'`,
          [a.engagement_id, a.stage, `${a.name} is switched off. Turn it back on in Settings > Agents.`],
        );
        await q.query(`UPDATE agents SET enabled = false, killed_at = now() WHERE id = $1`, [a.id]);
        await logAudit(q, actorOf(req), 'agent.killed', `agent:${a.name}`, { runsStopped: stopped });
      });
      emit('card', { changed: true });
      res.json({ ok: true, stopped });
    }),
  );
}
