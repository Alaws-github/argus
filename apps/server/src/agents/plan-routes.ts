// Plans: where a use case starts. With the AI (the default) the person talks
// it through with the Use Case Planner, which drafts the brief. Or they fill
// the brief in themselves. Either way a person adds it to Intake, under their
// own name, and the audit log records which fields the Planner drafted.
import type { Request, Router } from 'express';
import { z } from 'zod';
import { PlanBrief, UseCaseInput, can, type PlanMessage } from '@gh/shared';
import type { Db } from '../core/db.js';
import { logAudit } from '../audit/audit.js';
import { createCard } from '../board/cards.js';
import { scheduleEmbedding } from '../knowledge/kb.js';
import { emit } from '../core/realtime.js';
import { OPENING, plannerTarget, plannerTurn, toPlan } from './planner.js';
import { type Wrap, httpError, type ActorOf } from '../core/http.js';
const SELECT = `SELECT p.*, c.key AS card_key FROM plans p LEFT JOIN cards c ON c.id = p.card_id`;
const now = () => new Date().toISOString();

/**
 * Registers these 7 routes on the API router (each path is under /api):
 * - GET /engagements/:id/plans
 * - POST /engagements/:id/plans
 * - GET /plans/:id
 * - POST /plans/:id/messages
 * - PATCH /plans/:id
 * - POST /plans/:id/add
 * - DELETE /plans/:id
 */
export function planRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  const load = async (req: Request, forWrite = false) => {
    const { rows } = await db.query(`${SELECT} WHERE p.id::text = $1`, [req.params.id]);
    if (!rows[0]) throw httpError(404, 'Plan not found');
    if (forWrite && rows[0].created_by_id && rows[0].created_by_id !== req.user!.id)
      throw httpError(403, `This is ${rows[0].created_by}'s draft. Only they can change it.`);
    return rows[0];
  };

  r.get(
    '/engagements/:id/plans',
    wrap(async (req, res) => {
      const { rows } = await db.query(
        `${SELECT} WHERE p.engagement_id = $1 AND p.created_by_id = $2 ORDER BY p.updated_at DESC LIMIT 50`,
        [req.params.id, req.user!.id],
      );
      const target = await plannerTarget(db, req.params.id);
      res.json({
        plans: rows.map(toPlan),
        planner:
          target === 'off'
            ? { on: false }
            : {
                on: true,
                name: target.agentName,
                model: target.model,
                runtime: target.provider.type === 'rules' ? 'rules' : 'live',
              },
      });
    }),
  );

  r.post(
    '/engagements/:id/plans',
    wrap(async (req, res) => {
      const body = z.object({ mode: z.enum(['ai', 'manual']).default('ai') }).parse(req.body ?? {});
      const target = await plannerTarget(db, req.params.id);
      const mode = target === 'off' ? 'manual' : body.mode;
      const messages: PlanMessage[] =
        mode === 'ai' && target !== 'off'
          ? [{ role: 'planner', text: OPENING, at: now(), author: target.agentName }]
          : [];
      const row = await db.tx(async (q) => {
        const { rows } = await q.query(
          `INSERT INTO plans (engagement_id, mode, brief, messages, created_by, created_by_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            req.params.id,
            mode,
            JSON.stringify(PlanBrief.parse({})),
            JSON.stringify(messages),
            actorOf(req),
            req.user!.id,
          ],
        );
        await logAudit(q, actorOf(req), 'plan.created', `plan:P-${rows[0].number}`, { mode });
        return rows[0];
      });
      res.status(201).json(toPlan(row));
    }),
  );

  r.get(
    '/plans/:id',
    wrap(async (req, res) => res.json(toPlan(await load(req)))),
  );

  // The person says something; the Planner answers and updates the brief.
  r.post(
    '/plans/:id/messages',
    wrap(async (req, res) => {
      const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
      const row = await load(req, true);
      if (row.status !== 'draft') throw httpError(409, 'This plan is already on the board');
      const plan = toPlan(row);
      const mine: PlanMessage = { role: 'user', text, at: now(), author: actorOf(req) };
      let turn;
      try {
        turn = await plannerTurn(db, row.engagement_id, plan, text);
      } catch (e: any) {
        // Keep what the person wrote even if the model call fails.
        await db.query(`UPDATE plans SET messages = $2, mode = 'ai', updated_at = now() WHERE id = $1`, [
          row.id,
          JSON.stringify([...plan.messages, mine]),
        ]);
        throw httpError(e.status ?? 502, `The Planner couldn't answer: ${e.message}`);
      }
      const target = await plannerTarget(db, row.engagement_id);
      const reply: PlanMessage = {
        role: 'planner',
        text: turn.reply,
        at: now(),
        author: target === 'off' ? 'Use Case Planner' : target.agentName,
        model: turn.model,
        runtime: turn.runtime,
      };
      const out = await db.tx(async (q) => {
        const { rows } = await q.query(
          `UPDATE plans SET messages = $2, brief = $3, mode = 'ai', updated_at = now() WHERE id = $1 RETURNING *`,
          [row.id, JSON.stringify([...plan.messages, mine, reply]), JSON.stringify(turn.brief)],
        );
        const changed = Object.keys(turn.brief).filter((k) => (turn.brief as any)[k] !== (plan.brief as any)[k]);
        await logAudit(q, reply.author, 'plan.drafted', `plan:P-${row.number}`, {
          model: turn.model,
          runtime: turn.runtime,
          fields: changed,
          costUsd: turn.costUsd,
        });
        return rows[0];
      });
      res.json(toPlan({ ...out, card_key: null }));
    }),
  );

  // The person edits the brief. Edited fields are theirs: the Planner keeps them.
  r.patch(
    '/plans/:id',
    wrap(async (req, res) => {
      const body = z
        .object({ brief: PlanBrief.partial().optional(), mode: z.enum(['ai', 'manual']).optional() })
        .parse(req.body);
      const row = await load(req, true);
      if (row.status !== 'draft') throw httpError(409, 'This plan is already on the board');
      const plan = toPlan(row);
      const brief = PlanBrief.parse({ ...plan.brief, ...(body.brief ?? {}) });
      const edited = new Set(plan.edited);
      for (const [k, v] of Object.entries(body.brief ?? {})) if ((plan.brief as any)[k] !== v) edited.add(k);
      const { rows } = await db.query(
        `UPDATE plans SET brief = $2, edited = $3, mode = COALESCE($4, mode), updated_at = now() WHERE id = $1 RETURNING *`,
        [row.id, JSON.stringify(brief), JSON.stringify([...edited]), body.mode ?? null],
      );
      res.json(toPlan({ ...rows[0], card_key: null }));
    }),
  );

  // Add to Intake: the person creates the card. The Planner can't.
  r.post(
    '/plans/:id/add',
    wrap(async (req, res) => {
      const row = await load(req, true);
      if (row.status !== 'draft') throw httpError(409, 'This plan is already on the board');
      const plan = toPlan(row);
      if (plan.missing.length) throw httpError(422, `Fill in ${plan.missing.join(', ')} first`);
      const input = UseCaseInput.parse(plan.brief);
      const drafted =
        plan.mode === 'ai'
          ? Object.keys(plan.brief).filter(
              (k) => !plan.edited.includes(k) && String((plan.brief as any)[k] ?? '').trim(),
            )
          : [];
      const card = await db.tx(async (q) => {
        const c = await createCard(q, row.engagement_id, input, actorOf(req), {
          plan: plan.key,
          mode: plan.mode,
          draftedByPlanner: drafted,
          editedByPerson: plan.edited,
        });
        await q.query(`UPDATE plans SET status = 'added', card_id = $2, updated_at = now() WHERE id = $1`, [
          row.id,
          c.id,
        ]);
        await logAudit(q, actorOf(req), 'plan.added', `plan:${plan.key}`, { card: c.key });
        return c;
      });
      scheduleEmbedding(db);
      emit('card', card);
      res.status(201).json({ plan: toPlan({ ...row, status: 'added', card_key: card.key }), card });
    }),
  );

  r.delete(
    '/plans/:id',
    wrap(async (req, res) => {
      const row = await load(req);
      if (row.created_by_id !== req.user!.id && !can(req.user!.role, 'manage_engagement'))
        throw httpError(403, 'Only the person who started it, or a lead, can delete a draft');
      if (row.status !== 'draft') throw httpError(409, 'It is already on the board; the card stays');
      await db.tx(async (q) => {
        await q.query(`DELETE FROM plans WHERE id = $1`, [row.id]);
        await logAudit(q, actorOf(req), 'plan.deleted', `plan:P-${row.number}`, {});
      });
      res.status(204).end();
    }),
  );
}
