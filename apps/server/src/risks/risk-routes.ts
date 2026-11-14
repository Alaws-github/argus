// The risk register: list and update (owner, treatment, acceptance).
import { can } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { logAudit } from '../audit/audit.js';
import { type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { emit } from '../core/realtime.js';
import { RISK_SELECT, toRisk } from '../settings/settings-store.js';

export function riskRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  r.get(
    '/engagements/:id/risks',
    wrap(async (req, res) => {
      const { rows } = await db.query(
        `${RISK_SELECT} WHERE k.engagement_id = $1 ORDER BY (k.likelihood * k.impact) DESC, k.number`,
        [req.params.id],
      );
      res.json(rows.map(toRisk));
    }),
  );

  const RiskPatch = z.object({
    owner: z.string().max(120).optional(),
    treatment: z.enum(['mitigate', 'accept', 'transfer', 'avoid']).optional(),
    status: z.enum(['open', 'treated', 'closed']).optional(),
    likelihood: z.number().int().min(1).max(5).optional(),
    impact: z.number().int().min(1).max(5).optional(),
    residual_likelihood: z.number().int().min(1).max(5).nullable().optional(),
    residual_impact: z.number().int().min(1).max(5).nullable().optional(),
    accept: z.boolean().optional(),
  });

  r.patch(
    '/risks/:id',
    wrap(async (req, res) => {
      const { accept, ...patch } = RiskPatch.parse(req.body);
      const actor = actorOf(req);
      const keys = Object.keys(patch) as (keyof typeof patch)[];
      if (!keys.length && accept === undefined) return res.status(400).json({ error: 'Nothing to change' });
      const risk = await db.tx(async (q) => {
        const { rows: before } = await q.query(
          `SELECT k.*, e.appetite FROM risks k JOIN engagements e ON e.id = k.engagement_id WHERE k.id = $1`,
          [req.params.id],
        );
        if (!before[0]) throw Object.assign(new Error('Risk not found'), { status: 404 });
        if (accept !== undefined) {
          // Accepting a risk is a sign-off: leads only, and above appetite it is
          // recorded as an escalated acceptance.
          if (!can(req.user!.role, 'approve'))
            throw Object.assign(new Error('Only a lead or reviewer can accept a risk'), { status: 403 });
          const rl = patch.residual_likelihood ?? before[0].residual_likelihood ?? before[0].likelihood;
          const ri = patch.residual_impact ?? before[0].residual_impact ?? before[0].impact;
          const max = before[0].appetite?.maxResidual ?? 8;
          if (accept && rl * ri > max && req.user!.role !== 'admin' && req.user!.role !== 'lead')
            throw Object.assign(
              new Error(
                `Residual score ${rl * ri} is above appetite (${max}). Only a lead can accept it, on behalf of the ${before[0].appetite?.escalateTo ?? 'Board Risk Committee'}.`,
              ),
              { status: 403 },
            );
          await q.query(
            `UPDATE risks SET accepted_by = $2, treatment = CASE WHEN $3 THEN 'accept' ELSE treatment END WHERE id = $1`,
            [req.params.id, accept ? actor : null, accept],
          );
          await logAudit(
            q,
            actor,
            accept ? 'risk.accepted' : 'risk.acceptance_withdrawn',
            `risk:R-${before[0].number}`,
            { residual: rl * ri, appetite: max, aboveAppetite: rl * ri > max },
          );
        }
        if (keys.length) {
          const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
          await q.query(`UPDATE risks SET ${sets} WHERE id = $1`, [req.params.id, ...keys.map((k) => patch[k])]);
          const changes = Object.fromEntries(keys.map((k) => [k, { from: before[0][k], to: patch[k] }]));
          await logAudit(q, actor, 'risk.updated', `risk:R-${before[0].number}`, changes);
        }
        const { rows } = await q.query(`${RISK_SELECT} WHERE k.id = $1`, [req.params.id]);
        return toRisk(rows[0]);
      });
      emit('risk', risk);
      res.json(risk);
    }),
  );
}
