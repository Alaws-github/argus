// The AI inventory: list, add and update systems and agents.
import { InventoryInput } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { toInventory } from './inventory-records.js';
import { logAudit } from '../audit/audit.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';

/**
 * Registers these 3 routes on the API router (each path is under /api):
 * - GET /engagements/:id/inventory
 * - POST /engagements/:id/inventory
 * - PATCH /inventory/:id
 */
export function inventoryRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // --------------------------------------------------------------- inventory
  const cardKeyMap = async (engagementId: string) =>
    Object.fromEntries(
      (await db.query(`SELECT id, key FROM cards WHERE engagement_id = $1`, [engagementId])).rows.map((c: any) => [
        c.id,
        c.key,
      ]),
    );

  r.get(
    '/engagements/:id/inventory',
    wrap(async (req, res) => {
      const keys = await cardKeyMap(req.params.id);
      const { rows } = await db.query(`SELECT * FROM inventory WHERE engagement_id = $1 ORDER BY kind, number`, [
        req.params.id,
      ]);
      res.json(rows.map((x: any) => toInventory(x, keys)));
    }),
  );

  const invCols = (b: Partial<z.infer<typeof InventoryInput>>) => {
    const m: Record<string, [string, unknown]> = {};
    const map: Record<string, string> = {
      kind: 'kind',
      name: 'name',
      owner: 'owner',
      description: 'description',
      vendor: 'vendor',
      status: 'status',
      identity: 'identity',
      mandate: 'mandate',
      limits: 'limits',
      approvalThreshold: 'approval_threshold',
      stepLimit: 'step_limit',
      killSwitchTestedAt: 'kill_switch_tested_at',
      lastReviewAt: 'last_review_at',
      cardIds: 'card_ids',
    };
    for (const [k, v] of Object.entries(b)) if (map[k]) m[k] = [map[k], k === 'cardIds' ? JSON.stringify(v) : v];
    return m;
  };

  r.post(
    '/engagements/:id/inventory',
    wrap(async (req, res) => {
      const b = InventoryInput.parse(req.body);
      const cols = Object.values(invCols(b));
      const id = await db.tx(async (q) => {
        const { rows } = await q.query(
          `INSERT INTO inventory (engagement_id, ${cols.map((c) => c[0]).join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id, number`,
          [req.params.id, ...cols.map((c) => c[1])],
        );
        await logAudit(q, actorOf(req), 'inventory.added', `inventory:AI-INV-${rows[0].number}`, {
          kind: b.kind,
          name: b.name,
        });
        return rows[0].id;
      });
      const { rows } = await db.query(`SELECT * FROM inventory WHERE id = $1`, [id]);
      res.status(201).json(toInventory(rows[0], await cardKeyMap(req.params.id)));
    }),
  );

  r.patch(
    '/inventory/:id',
    wrap(async (req, res) => {
      const b = InventoryInput.partial().parse(req.body);
      const { rows: before } = await db.query(`SELECT * FROM inventory WHERE id = $1`, [req.params.id]);
      if (!before[0]) throw httpError(404, 'Inventory item not found');
      const cols = Object.entries(invCols(b));
      if (!cols.length) throw httpError(400, 'Nothing to change');
      await db.tx(async (q) => {
        await q.query(
          `UPDATE inventory SET ${cols.map(([, c], i) => `${c[0]} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [before[0].id, ...cols.map(([, c]) => c[1])],
        );
        await logAudit(
          q,
          actorOf(req),
          'inventory.changed',
          `inventory:AI-INV-${before[0].number}`,
          Object.fromEntries(cols.map(([k, c]) => [k, { from: before[0][c[0]], to: (b as any)[k] }])),
        );
      });
      const { rows } = await db.query(`SELECT * FROM inventory WHERE id = $1`, [before[0].id]);
      res.json(toInventory(rows[0], await cardKeyMap(before[0].engagement_id)));
    }),
  );
}
