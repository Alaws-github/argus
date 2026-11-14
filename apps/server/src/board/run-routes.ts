// Agent runs: the list and one run with its steps.
import { type Router } from 'express';
import { visibleIds } from '../auth/access.js';
import { type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { RUN_SELECT, getCard, toEvent, toRun } from '../settings/settings-store.js';

/**
 * Registers these 2 routes on the API router (each path is under /api):
 * - GET /runs
 * - GET /runs/:id
 */
export function runRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  r.get(
    '/runs',
    wrap(async (req, res) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (req.query.cardId) {
        params.push(String(req.query.cardId));
        conds.push(`r.card_id = $${params.length}`);
      }
      const ids = await visibleIds(db, req.user);
      if (ids) {
        params.push(ids);
        conds.push(`r.card_id IN (SELECT id FROM cards WHERE engagement_id = ANY($${params.length}))`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await db.query(`${RUN_SELECT} ${where} ORDER BY r.started_at DESC LIMIT 200`, params);
      res.json(rows.map(toRun));
    }),
  );

  r.get(
    '/runs/:id',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${RUN_SELECT} WHERE r.id = $1`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Run not found' });
      const { rows: events } = await db.query(`SELECT * FROM run_events WHERE run_id = $1 ORDER BY id`, [
        req.params.id,
      ]);
      const card = await getCard(db, rows[0].card_id);
      res.json({ run: toRun(rows[0]), events: events.map(toEvent), card });
    }),
  );
}
