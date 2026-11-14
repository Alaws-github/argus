// The use case board: the board, adding a use case, a use case with its drafts, questions for a person, item decisions and gate actions.
import { AnswerQuestion, UseCaseInput, type Stage } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { logAudit } from '../audit/audit.js';
import { requireDifferentPerson, requirePerm } from '../auth/auth.js';
import { createCard } from './cards.js';
import { type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { DECIDED_STAGES, checkEdit, itemsFor, original, undecided } from './decisions.js';
import { MAX_PARALLEL, advance, emitCard } from './engine.js';
import { EXIT_CRITERIA, exitCriteria } from './exit-criteria.js';
import { scheduleEmbedding } from '../knowledge/kb.js';
import { emit } from '../core/realtime.js';
import {
  RISK_SELECT,
  RUN_SELECT,
  agentStages,
  getCard,
  getEngagement,
  getSettings,
  toAudit,
  toCard,
  toQuestion,
  toRisk,
  toRun,
} from '../settings/settings-store.js';

export function boardRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  r.get(
    '/engagements/:id/board',
    wrap(async (req, res) => {
      const engagement = await getEngagement(db, req.params.id);
      if (!engagement) return res.status(404).json({ error: 'Engagement not found' });
      // updated_by: the last person (an account, not an agent) whose change to the card is in the audit log.
      // Card keys are unique across engagements (each has its own prefix).
      const { rows } = await db.query(
        `SELECT c.*, (SELECT a.actor FROM audit_log a WHERE a.entity = 'card:' || c.key
                      AND EXISTS (SELECT 1 FROM users u WHERE u.name = a.actor OR u.former_names ? a.actor)
                    ORDER BY a.id DESC LIMIT 1) AS updated_by
       FROM cards c WHERE c.engagement_id = $1 ORDER BY c.stage_entered_at`,
        [engagement.id],
      );
      const { rows: busy } = await db.query(`SELECT count(*)::int AS n FROM cards WHERE status = 'running'`);
      res.json({
        engagement,
        cards: rows.map(toCard),
        slots: { busy: busy[0].n, limit: MAX_PARALLEL },
        autoStart: (await getSettings(db)).autoStart,
        agentStages: await agentStages(db, engagement.id),
      });
    }),
  );

  r.post(
    '/engagements/:id/cards',
    wrap(async (req, res) => {
      const input = UseCaseInput.parse(req.body);
      const actor = actorOf(req);
      const card = await db.tx((q) => createCard(q, req.params.id, input, actor));
      scheduleEmbedding(db);
      emit('card', card);
      res.status(201).json(card);
    }),
  );

  r.get(
    '/cards/:idOrKey',
    wrap(async (req, res) => {
      const card = await getCard(db, req.params.idOrKey);
      if (!card) return res.status(404).json({ error: 'Card not found' });
      const { rows: runs } = await db.query(`${RUN_SELECT} WHERE r.card_id = $1 ORDER BY r.started_at DESC`, [card.id]);
      const { rows: risks } = await db.query(`${RISK_SELECT} WHERE k.card_id = $1 ORDER BY k.number`, [card.id]);
      const { rows: audit } = await db.query(`SELECT * FROM audit_log WHERE entity = $1 ORDER BY id DESC LIMIT 50`, [
        `card:${card.key}`,
      ]);
      const { rows: controls } = await db.query(
        `SELECT c.id, c.number, c.title, c.status, c.owner, l.code AS library_code,
         (SELECT count(*)::int FROM tests t WHERE t.control_id = c.id) AS tests,
         (SELECT count(*)::int FROM evidence e WHERE e.control_id = c.id) AS evidence
       FROM controls c LEFT JOIN control_library l ON l.id = c.library_id WHERE c.card_id = $1 ORDER BY c.number`,
        [card.id],
      );
      res.json({
        card,
        runs: runs.map(toRun),
        risks: risks.map(toRisk),
        activity: audit.map(toAudit),
        controls: controls.map((c: any) => ({
          id: c.id,
          key: `C-${c.number}`,
          title: c.title,
          status: c.status,
          owner: c.owner,
          libraryCode: c.library_code,
          tests: c.tests,
          evidence: c.evidence,
        })),
        exitCriteria: { required: EXIT_CRITERIA[card.stage] ?? [], unmet: await exitCriteria(db, card) },
        questions: (
          await db.query(`SELECT * FROM agent_questions WHERE card_id = $1 ORDER BY asked_at`, [card.id])
        ).rows.map(toQuestion),
      });
    }),
  );

  // An agent's question (rule 27). Anyone who can prepare work answers or skips
  // it, under their own name; the card is queued again and the agent's next run
  // gets every answer for this stage. The answer informs the draft; it decides nothing.
  r.post(
    '/cards/:id/questions/:qid/:verb(answer|skip)',
    wrap(async (req, res) => {
      const verb = req.params.verb as 'answer' | 'skip';
      const answer = verb === 'answer' ? AnswerQuestion.parse(req.body).answer : null;
      const card = await getCard(db, req.params.id);
      if (!card) return res.status(404).json({ error: 'Card not found' });
      const { rows } = await db.query(`SELECT * FROM agent_questions WHERE id::text = $1 AND card_id = $2`, [
        req.params.qid,
        card.id,
      ]);
      const qn = rows[0];
      if (!qn) return res.status(404).json({ error: 'Question not found' });
      if (qn.status !== 'open') return res.status(409).json({ error: 'This question was already answered or skipped' });
      const actor = actorOf(req);
      await db.tx(async (q) => {
        await q.query(
          `UPDATE agent_questions SET status=$2, answer=$3, answered_by=$4, answered_at=now() WHERE id=$1`,
          [qn.id, verb === 'answer' ? 'answered' : 'skipped', answer, actor],
        );
        // Back to the agent only when nothing else is open and the card is still waiting on it.
        const { rows: open } = await q.query(
          `SELECT 1 FROM agent_questions WHERE card_id = $1 AND stage = $2 AND status = 'open'`,
          [card.id, qn.stage],
        );
        if (!open.length && card.status === 'question' && card.stage === qn.stage) {
          await q.query(`UPDATE cards SET status='queued', status_note=$2, updated_at=now() WHERE id=$1`, [
            card.id,
            qn.feedback ? `Feedback: ${qn.feedback}` : null,
          ]);
        }
        await logAudit(q, actor, verb === 'answer' ? 'agent.answered' : 'agent.question_skipped', `card:${card.key}`, {
          question: qn.question,
          ...(answer ? { answer } : {}),
          agent: qn.agent,
          stage: qn.stage,
        });
      });
      await emitCard(db, card.id);
      res.json({ ok: true });
    }),
  );

  // A reviewer's decision on one item of an agent's draft, or "accept the rest".
  r.post(
    '/cards/:id/decisions',
    wrap(async (req, res) => {
      requirePerm(req, 'approve');
      const b = z
        .object({
          item: z.string().max(40).optional(),
          decision: z.enum(['accept', 'edit', 'reject']).optional(),
          edit: z.record(z.any()).optional(),
          reason: z.string().trim().max(600).optional(),
          rest: z.literal('accept').optional(),
        })
        .parse(req.body);
      const card = await getCard(db, req.params.id);
      if (!card) return res.status(404).json({ error: 'Card not found' });
      if (card.status !== 'needs_approval' || !(DECIDED_STAGES as readonly string[]).includes(card.stage)) {
        return res.status(409).json({ error: 'There is no agent draft waiting for decisions on this card' });
      }
      const actor = actorOf(req);
      const now = new Date().toISOString();
      const items = itemsFor(card);
      const updates: Record<string, unknown> = {};
      if (b.rest) {
        for (const k of undecided(card)) updates[k] = { decision: 'accept', by: actor, at: now };
      } else {
        if (!b.item || !items.includes(b.item)) return res.status(400).json({ error: `Unknown item ${b.item ?? ''}` });
        if (!b.decision) return res.status(400).json({ error: 'Choose accept, edit or reject' });
        if (b.decision === 'reject' && (b.reason ?? '').length < 3)
          return res.status(400).json({ error: 'Say why you are rejecting it. The reason goes in the audit trail.' });
        if (b.item === 'summary' && b.decision === 'reject')
          return res.status(400).json({ error: 'Edit the summary, or run the Report Writer again with a note' });
        if (b.item === 'tier' && b.decision === 'reject')
          return res
            .status(400)
            .json({ error: 'A use case needs a tier: accept it, or edit it to the tier you judge right' });
        const edit = b.decision === 'edit' ? checkEdit(b.item, b.edit) : undefined;
        if (b.decision === 'edit' && (b.reason ?? '').length < 3)
          return res.status(400).json({ error: 'Say why you changed it. The reason goes in the audit trail.' });
        updates[b.item] = {
          decision: b.decision,
          ...(edit ? { edit } : {}),
          ...(b.reason ? { reason: b.reason } : {}),
          by: actor,
          at: now,
        };
      }
      await db.tx(async (q) => {
        for (const [k, v] of Object.entries(updates)) {
          await q.query(
            `UPDATE cards SET decisions = jsonb_set(decisions, ARRAY[$2::text], COALESCE(decisions->$2, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb), true), updated_at = now() WHERE id = $1`,
            [card.id, card.stage, k, JSON.stringify(v)],
          );
        }
        await logAudit(
          q,
          actor,
          b.rest
            ? 'draft.rest_accepted'
            : `draft.item_${b.decision}ed`.replace('editeded', 'edited').replace('accepteded', 'accepted'),
          `card:${card.key}`,
          b.rest
            ? { stage: card.stage, items: Object.keys(updates) }
            : {
                stage: card.stage,
                item: b.item,
                ...(b.decision !== 'accept' ? { agentProposed: original(card, b.item!) } : {}),
                ...(b.edit ? { changedTo: (updates[b.item!] as any).edit } : {}),
                ...(b.reason ? { reason: b.reason } : {}),
              },
        );
      });
      await emitCard(db, card.id);
      res.json(await getCard(db, card.id));
    }),
  );

  const Action = z.object({
    action: z.enum(['approve', 'request_changes', 'retry', 'advance', 'reject']),
    note: z.string().max(2000).optional(),
  });

  r.post(
    '/cards/:id/actions',
    wrap(async (req, res) => {
      const { action, note } = Action.parse(req.body);
      const actor = actorOf(req);
      const card = await getCard(db, req.params.id);
      if (!card) return res.status(404).json({ error: 'Card not found' });
      const engagement = await getEngagement(db, card.engagementId);
      const gated = Boolean(engagement?.gates[card.stage as Stage]);
      const hasAgent = (await agentStages(db, card.engagementId)).includes(card.stage);
      const conflict = (msg: string) => res.status(409).json({ error: msg });

      switch (action) {
        case 'approve':
          requirePerm(req, 'approve');
          if (card.stage === 'intake' ? card.status !== 'idle' : card.status !== 'needs_approval') {
            return conflict('Nothing is waiting for approval on this card');
          }
          if (card.stage === 'intake') requireDifferentPerson(req, card.createdBy, 'use case');
          // Human in the loop: every item of an agent's draft gets a decision first.
          if ((DECIDED_STAGES as readonly string[]).includes(card.stage)) {
            const left = undecided(card);
            if (left.length)
              return conflict(
                `Decide each item of the draft first: ${left.length} left. Accept, edit or reject each one, or accept the rest.`,
              );
          }
          await advance(db, card.id, actor, note);
          break;

        case 'advance':
          // Manual stages only. An agent stage or a gated stage needs the approve path.
          if (hasAgent) return conflict('An agent owns this stage. Approve its output instead.');
          if (card.stage === 'intake') return conflict('Use approve to take a use case forward from Intake');
          // On a gated manual stage, the person moving the card on is its approver.
          if (gated) requirePerm(req, 'approve');
          await advance(db, card.id, actor, gated ? (note ?? 'Signed off') : note);
          break;

        case 'request_changes':
          requirePerm(req, 'approve');
          if (card.status !== 'needs_approval') return conflict('Nothing is waiting for approval on this card');
          if (!note?.trim()) return res.status(400).json({ error: 'Say what to change so the agent can address it' });
          await db.tx(async (q) => {
            await q.query(`UPDATE cards SET status='queued', status_note=$2, updated_at=now() WHERE id=$1`, [
              card.id,
              `Feedback: ${note.trim()}`,
            ]);
            await logAudit(q, actor, 'gate.changes_requested', `card:${card.key}`, { stage: card.stage, note });
          });
          break;

        case 'retry':
          if (card.status !== 'failed') return conflict('Only a failed run can be retried');
          await db.tx(async (q) => {
            await q.query(`UPDATE cards SET status='queued', status_note=NULL, updated_at=now() WHERE id=$1`, [
              card.id,
            ]);
            await logAudit(q, actor, 'run.retried', `card:${card.key}`, { stage: card.stage });
          });
          break;

        case 'reject':
          requirePerm(req, 'approve');
          requireDifferentPerson(req, card.createdBy, 'use case');
          if (card.stage !== 'intake') return conflict('Only a card in Intake can be rejected');
          await db.tx(async (q) => {
            await q.query(
              `UPDATE cards SET stage='closed', status='idle', status_note=$2, stage_entered_at=now(), updated_at=now() WHERE id=$1`,
              [card.id, `Not taken forward${note ? `: ${note}` : ''}`],
            );
            await logAudit(q, actor, 'card.rejected', `card:${card.key}`, { note });
          });
          break;
      }
      await emitCard(db, card.id);
      res.json(await getCard(db, card.id));
    }),
  );
}
