// Core API: engagements, the board and its gate actions (approve, request
// changes, move on, retry, reject), runs, the risk register, overview and the
// audit log. Mounts the other route files at the end.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { AGENT_ROLES, AnswerQuestion, STAGES, UseCaseInput, riskRating, can, type Stage } from '@gh/shared';
import { configRoutes } from './routes-config.js';
import { authRoutes } from './routes-auth.js';
import { grcRoutes } from './routes-grc.js';
import { archiveRoutes } from './archive.js';
import { kbRoutes } from './routes-kb.js';
import { testingRoutes } from './routes-testing.js';
import { assistantRoutes } from './routes-assistant.js';
import { visibleIds } from './access.js';
import { incidentRoutes } from './routes-incidents.js';
import { harmonizeRoutes } from './harmonize.js';
import { ingestTokenRoutes } from './ingest.js';
import { outboundRoutes } from './outbound.js';
import { clientStepRoutes } from './client-steps.js';
import { connectorRoutes } from './routes-connectors.js';
import { planRoutes } from './routes-plans.js';
import { createCard } from './cards.js';
import { engagementKpis } from './kpis.js';
import { workflowRoutes } from './routes-workflows.js';
import { accessRoutes } from './routes-access.js';
import { ssoRoutes } from './sso.js';
import { requireDifferentPerson, requirePerm } from './auth.js';
import { MAX_PARALLEL } from './engine.js';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { DECIDED_STAGES, checkEdit, itemsFor, original, undecided } from './decisions.js';
import { indexUseCase, scheduleEmbedding } from './kb.js';
import { EXIT_CRITERIA, exitCriteria } from './exit-criteria.js';
import { advance, emitCard } from './engine.js';
import { emit } from './realtime.js';
import {
  agentStages, getCard, getEngagement, getSettings, monthSpend,
  toAudit, toCard, toEngagement, toEvent, toQuestion, toRisk, toRun, RISK_SELECT, RUN_SELECT,
} from './store.js';

// No sign-in yet: the web app sends the reviewer's name. Add real auth before
// this leaves a laptop (see README, "Before you put it on a server").
// The signed-in person's name is what approvals and the audit trail record.
const actorOf = (req: Request) => req.user?.name ?? 'unknown';

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

export function routes(db: Db) {
  const r = Router();

  // runtime: 'live' when any enabled, built agent is on a model provider rather
  // than the offline rules.
  r.get('/health', wrap(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT a.role, a.model, p.type, p.name FROM agents a LEFT JOIN providers p ON p.id = a.provider_id WHERE a.enabled`,
    );
    const live = rows.filter((x: any) => AGENT_ROLES[x.role as keyof typeof AGENT_ROLES]?.built && x.type && x.type !== 'rules');
    res.json({ ok: true, db: db.kind, runtime: live.length ? 'live' : 'dry-run', model: live[0] ? `${live[0].model} on ${live[0].name}` : 'rules-v1' });
  }));

  r.get('/engagements', wrap(async (req, res) => {
    const ids = await visibleIds(db, req.user);
    const { rows } = await db.query(`SELECT * FROM engagements ${ids ? 'WHERE id = ANY($1)' : ''} ORDER BY created_at`, ids ? [ids] : []);
    res.json(rows.map(toEngagement));
  }));

  r.get('/engagements/:id/board', wrap(async (req, res) => {
    const engagement = await getEngagement(db, req.params.id);
    if (!engagement) return res.status(404).json({ error: 'Engagement not found' });
    // updated_by: the last person (an account, not an agent) whose change to the card is in the audit log.
    // Card keys are unique across engagements (each has its own prefix).
    const { rows } = await db.query(
      `SELECT c.*, (SELECT a.actor FROM audit_log a WHERE a.entity = 'card:' || c.key
                      AND EXISTS (SELECT 1 FROM users u WHERE u.name = a.actor OR u.former_names ? a.actor)
                    ORDER BY a.id DESC LIMIT 1) AS updated_by
       FROM cards c WHERE c.engagement_id = $1 ORDER BY c.stage_entered_at`, [engagement.id]);
    const { rows: busy } = await db.query(`SELECT count(*)::int AS n FROM cards WHERE status = 'running'`);
    res.json({
      engagement,
      cards: rows.map(toCard),
      slots: { busy: busy[0].n, limit: MAX_PARALLEL },
      autoStart: (await getSettings(db)).autoStart,
      agentStages: await agentStages(db, engagement.id),
    });
  }));

  r.post('/engagements/:id/cards', wrap(async (req, res) => {
    const input = UseCaseInput.parse(req.body);
    const actor = actorOf(req);
    const card = await db.tx((q) => createCard(q, req.params.id, input, actor));
    scheduleEmbedding(db);
    emit('card', card);
    res.status(201).json(card);
  }));

  r.get('/cards/:idOrKey', wrap(async (req, res) => {
    const card = await getCard(db, req.params.idOrKey);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    const { rows: runs } = await db.query(`${RUN_SELECT} WHERE r.card_id = $1 ORDER BY r.started_at DESC`, [card.id]);
    const { rows: risks } = await db.query(`${RISK_SELECT} WHERE k.card_id = $1 ORDER BY k.number`, [card.id]);
    const { rows: audit } = await db.query(`SELECT * FROM audit_log WHERE entity = $1 ORDER BY id DESC LIMIT 50`, [`card:${card.key}`]);
    const { rows: controls } = await db.query(
      `SELECT c.id, c.number, c.title, c.status, c.owner, l.code AS library_code,
         (SELECT count(*)::int FROM tests t WHERE t.control_id = c.id) AS tests,
         (SELECT count(*)::int FROM evidence e WHERE e.control_id = c.id) AS evidence
       FROM controls c LEFT JOIN control_library l ON l.id = c.library_id WHERE c.card_id = $1 ORDER BY c.number`,
      [card.id],
    );
    res.json({
      card, runs: runs.map(toRun), risks: risks.map(toRisk), activity: audit.map(toAudit),
      controls: controls.map((c: any) => ({ id: c.id, key: `C-${c.number}`, title: c.title, status: c.status, owner: c.owner, libraryCode: c.library_code, tests: c.tests, evidence: c.evidence })),
      exitCriteria: { required: EXIT_CRITERIA[card.stage] ?? [], unmet: await exitCriteria(db, card) },
      questions: (await db.query(`SELECT * FROM agent_questions WHERE card_id = $1 ORDER BY asked_at`, [card.id])).rows.map(toQuestion),
    });
  }));

  // An agent's question (rule 27). Anyone who can prepare work answers or skips
  // it, under their own name; the card is queued again and the agent's next run
  // gets every answer for this stage. The answer informs the draft; it decides nothing.
  r.post('/cards/:id/questions/:qid/:verb(answer|skip)', wrap(async (req, res) => {
    const verb = req.params.verb as 'answer' | 'skip';
    const answer = verb === 'answer' ? AnswerQuestion.parse(req.body).answer : null;
    const card = await getCard(db, req.params.id);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    const { rows } = await db.query(`SELECT * FROM agent_questions WHERE id::text = $1 AND card_id = $2`, [req.params.qid, card.id]);
    const qn = rows[0];
    if (!qn) return res.status(404).json({ error: 'Question not found' });
    if (qn.status !== 'open') return res.status(409).json({ error: 'This question was already answered or skipped' });
    const actor = actorOf(req);
    await db.tx(async (q) => {
      await q.query(`UPDATE agent_questions SET status=$2, answer=$3, answered_by=$4, answered_at=now() WHERE id=$1`, [qn.id, verb === 'answer' ? 'answered' : 'skipped', answer, actor]);
      // Back to the agent only when nothing else is open and the card is still waiting on it.
      const { rows: open } = await q.query(`SELECT 1 FROM agent_questions WHERE card_id = $1 AND stage = $2 AND status = 'open'`, [card.id, qn.stage]);
      if (!open.length && card.status === 'question' && card.stage === qn.stage) {
        await q.query(`UPDATE cards SET status='queued', status_note=$2, updated_at=now() WHERE id=$1`, [card.id, qn.feedback ? `Feedback: ${qn.feedback}` : null]);
      }
      await logAudit(q, actor, verb === 'answer' ? 'agent.answered' : 'agent.question_skipped', `card:${card.key}`, { question: qn.question, ...(answer ? { answer } : {}), agent: qn.agent, stage: qn.stage });
    });
    await emitCard(db, card.id);
    res.json({ ok: true });
  }));

  // A reviewer's decision on one item of an agent's draft, or "accept the rest".
  r.post('/cards/:id/decisions', wrap(async (req, res) => {
    requirePerm(req, 'approve');
    const b = z.object({
      item: z.string().max(40).optional(),
      decision: z.enum(['accept', 'edit', 'reject']).optional(),
      edit: z.record(z.any()).optional(),
      reason: z.string().trim().max(600).optional(),
      rest: z.literal('accept').optional(),
    }).parse(req.body);
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
      if (b.decision === 'reject' && (b.reason ?? '').length < 3) return res.status(400).json({ error: 'Say why you are rejecting it. The reason goes in the audit trail.' });
      if (b.item === 'summary' && b.decision === 'reject') return res.status(400).json({ error: 'Edit the summary, or run the Report Writer again with a note' });
      if (b.item === 'tier' && b.decision === 'reject') return res.status(400).json({ error: 'A use case needs a tier: accept it, or edit it to the tier you judge right' });
      const edit = b.decision === 'edit' ? checkEdit(b.item, b.edit) : undefined;
      if (b.decision === 'edit' && (b.reason ?? '').length < 3) return res.status(400).json({ error: 'Say why you changed it. The reason goes in the audit trail.' });
      updates[b.item] = { decision: b.decision, ...(edit ? { edit } : {}), ...(b.reason ? { reason: b.reason } : {}), by: actor, at: now };
    }
    await db.tx(async (q) => {
      for (const [k, v] of Object.entries(updates)) {
        await q.query(
          `UPDATE cards SET decisions = jsonb_set(decisions, ARRAY[$2::text], COALESCE(decisions->$2, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb), true), updated_at = now() WHERE id = $1`,
          [card.id, card.stage, k, JSON.stringify(v)],
        );
      }
      await logAudit(q, actor, b.rest ? 'draft.rest_accepted' : `draft.item_${b.decision}ed`.replace('editeded', 'edited').replace('accepteded', 'accepted'), `card:${card.key}`, b.rest
        ? { stage: card.stage, items: Object.keys(updates) }
        : { stage: card.stage, item: b.item, ...(b.decision !== 'accept' ? { agentProposed: original(card, b.item!) } : {}), ...(b.edit ? { changedTo: (updates[b.item!] as any).edit } : {}), ...(b.reason ? { reason: b.reason } : {}) });
    });
    await emitCard(db, card.id);
    res.json(await getCard(db, card.id));
  }));

  const Action = z.object({
    action: z.enum(['approve', 'request_changes', 'retry', 'advance', 'reject']),
    note: z.string().max(2000).optional(),
  });

  r.post('/cards/:id/actions', wrap(async (req, res) => {
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
          if (left.length) return conflict(`Decide each item of the draft first: ${left.length} left. Accept, edit or reject each one, or accept the rest.`);
        }
        await advance(db, card.id, actor, note);
        break;

      case 'advance':
        // Manual stages only. An agent stage or a gated stage needs the approve path.
        if (hasAgent) return conflict('An agent owns this stage. Approve its output instead.');
        if (card.stage === 'intake') return conflict('Use approve to take a use case forward from Intake');
        // On a gated manual stage, the person moving the card on is its approver.
        if (gated) requirePerm(req, 'approve');
        await advance(db, card.id, actor, gated ? note ?? 'Signed off' : note);
        break;

      case 'request_changes':
        requirePerm(req, 'approve');
        if (card.status !== 'needs_approval') return conflict('Nothing is waiting for approval on this card');
        if (!note?.trim()) return res.status(400).json({ error: 'Say what to change so the agent can address it' });
        await db.tx(async (q) => {
          await q.query(`UPDATE cards SET status='queued', status_note=$2, updated_at=now() WHERE id=$1`, [card.id, `Feedback: ${note.trim()}`]);
          await logAudit(q, actor, 'gate.changes_requested', `card:${card.key}`, { stage: card.stage, note });
        });
        break;

      case 'retry':
        if (card.status !== 'failed') return conflict('Only a failed run can be retried');
        await db.tx(async (q) => {
          await q.query(`UPDATE cards SET status='queued', status_note=NULL, updated_at=now() WHERE id=$1`, [card.id]);
          await logAudit(q, actor, 'run.retried', `card:${card.key}`, { stage: card.stage });
        });
        break;

      case 'reject':
        requirePerm(req, 'approve');
        requireDifferentPerson(req, card.createdBy, 'use case');
        if (card.stage !== 'intake') return conflict('Only a card in Intake can be rejected');
        await db.tx(async (q) => {
          await q.query(`UPDATE cards SET stage='closed', status='idle', status_note=$2, stage_entered_at=now(), updated_at=now() WHERE id=$1`, [
            card.id,
            `Not taken forward${note ? `: ${note}` : ''}`,
          ]);
          await logAudit(q, actor, 'card.rejected', `card:${card.key}`, { note });
        });
        break;
    }
    await emitCard(db, card.id);
    res.json(await getCard(db, card.id));
  }));

  r.get('/runs', wrap(async (req, res) => {
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
  }));

  r.get('/runs/:id', wrap(async (req, res) => {
    const { rows } = await db.query(`${RUN_SELECT} WHERE r.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Run not found' });
    const { rows: events } = await db.query(`SELECT * FROM run_events WHERE run_id = $1 ORDER BY id`, [req.params.id]);
    const card = await getCard(db, rows[0].card_id);
    res.json({ run: toRun(rows[0]), events: events.map(toEvent), card });
  }));

  r.get('/engagements/:id/risks', wrap(async (req, res) => {
    const { rows } = await db.query(`${RISK_SELECT} WHERE k.engagement_id = $1 ORDER BY (k.likelihood * k.impact) DESC, k.number`, [req.params.id]);
    res.json(rows.map(toRisk));
  }));

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

  r.patch('/risks/:id', wrap(async (req, res) => {
    const { accept, ...patch } = RiskPatch.parse(req.body);
    const actor = actorOf(req);
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length && accept === undefined) return res.status(400).json({ error: 'Nothing to change' });
    const risk = await db.tx(async (q) => {
      const { rows: before } = await q.query(`SELECT k.*, e.appetite FROM risks k JOIN engagements e ON e.id = k.engagement_id WHERE k.id = $1`, [req.params.id]);
      if (!before[0]) throw Object.assign(new Error('Risk not found'), { status: 404 });
      if (accept !== undefined) {
        // Accepting a risk is a sign-off: leads only, and above appetite it is
        // recorded as an escalated acceptance.
        if (!can(req.user!.role, 'approve')) throw Object.assign(new Error('Only a lead or reviewer can accept a risk'), { status: 403 });
        const rl = patch.residual_likelihood ?? before[0].residual_likelihood ?? before[0].likelihood;
        const ri = patch.residual_impact ?? before[0].residual_impact ?? before[0].impact;
        const max = before[0].appetite?.maxResidual ?? 8;
        if (accept && rl * ri > max && req.user!.role !== 'admin' && req.user!.role !== 'lead')
          throw Object.assign(new Error(`Residual score ${rl * ri} is above appetite (${max}). Only a lead can accept it, on behalf of the ${before[0].appetite?.escalateTo ?? 'Board Risk Committee'}.`), { status: 403 });
        await q.query(`UPDATE risks SET accepted_by = $2, treatment = CASE WHEN $3 THEN 'accept' ELSE treatment END WHERE id = $1`, [req.params.id, accept ? actor : null, accept]);
        await logAudit(q, actor, accept ? 'risk.accepted' : 'risk.acceptance_withdrawn', `risk:R-${before[0].number}`, { residual: rl * ri, appetite: max, aboveAppetite: rl * ri > max });
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
  }));

  // v1.7: the numbers for every page's KPI tiles, in one read.
  r.get('/engagements/:id/kpis', wrap(async (req, res) => {
    res.json(await engagementKpis(db, req.params.id));
  }));

  r.get('/engagements/:id/overview', wrap(async (req, res) => {
    const id = req.params.id;
    const { rows: cards } = await db.query(`SELECT stage, status, tier FROM cards WHERE engagement_id = $1`, [id]);
    const { rows: risks } = await db.query(`SELECT likelihood, impact, status FROM risks WHERE engagement_id = $1`, [id]);
    const { rows: runs } = await db.query(
      `SELECT r.status, r.cost_usd FROM runs r JOIN cards c ON c.id = r.card_id WHERE c.engagement_id = $1`,
      [id],
    );
    const active = cards.filter((c: any) => !(c.stage === 'closed' && !c.tier));
    const classified = active.filter((c: any) => c.tier && c.stage !== 'classify').length;
    const tiers: Record<string, number> = { prohibited: 0, high: 0, limited: 0, minimal: 0 };
    for (const c of active) if (c.tier) tiers[c.tier]++;
    const openHigh = risks.filter((k: any) => k.status === 'open' && ['critical', 'high'].includes(riskRating(k.likelihood * k.impact))).length;
    const finished = runs.filter((x: any) => x.status !== 'running');
    const byStage = Object.fromEntries(STAGES.map((s) => [s, cards.filter((c: any) => c.stage === s).length]));
    res.json({
      useCases: active.length,
      classified,
      coveragePct: active.length ? Math.round((classified / active.length) * 100) : 0,
      tiers,
      risks: { total: risks.length, open: risks.filter((k: any) => k.status === 'open').length, openHigh },
      needsYou: cards.filter((c: any) => c.status === 'needs_approval' || c.status === 'failed' || (c.stage === 'intake' && c.status === 'idle')).length,
      runs: {
        total: runs.length,
        succeededPct: finished.length ? Math.round((finished.filter((x: any) => x.status === 'succeeded').length / finished.length) * 100) : 0,
        spendUsd: runs.reduce((a: number, x: any) => a + Number(x.cost_usd), 0),
      },
      month: await (async () => {
        const s = await getSettings(db);
        return { spendUsd: await monthSpend(db, s.timeZone), capUsd: s.spendCapUsd, warnAtPct: s.warnAtPct, pauseAtCap: s.pauseAtCap };
      })(),
      byStage,
    });
  }));

  // Activity over time for the Overview charts: agent runs and their cost by
  // stage, agent or model, run outcomes, use cases added and closed, and how
  // people decided the agents' draft items.
  r.get('/engagements/:id/activity', wrap(async (req, res) => {
    const { days } = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90, 365].includes(n)).default(30) }).parse(req.query);
    const id = req.params.id;
    const tz = (await getSettings(db)).timeZone;
    const dayList: string[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) dayList.push(new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10));
    const since = dayList[0];
    const { rows: runs } = await db.query(
      `SELECT to_char(r.started_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, r.stage, r.agent, r.model, r.status, r.cost_usd
       FROM runs r JOIN cards c ON c.id = r.card_id WHERE c.engagement_id = $1 AND r.started_at >= $2::date`, [id, since, tz]);
    const { rows: cards } = await db.query(
      `SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS created, CASE WHEN stage = 'closed' THEN to_char(stage_entered_at AT TIME ZONE $3, 'YYYY-MM-DD') END AS closed
       FROM cards WHERE engagement_id = $1 AND (created_at >= $2::date OR stage_entered_at >= $2::date)`, [id, since, tz]);
    const { rows: decisions } = await db.query(
      `SELECT action, detail FROM audit_log WHERE engagement_id = $1 AND at >= $2::date AND action LIKE 'draft.%'`, [id, since]);
    const idx = new Map(dayList.map((d, i) => [d, i]));
    const series = (key: 'stage' | 'agent' | 'model', metric: 'cost' | 'runs') => {
      const out: Record<string, number[]> = {};
      for (const r of runs) {
        const i = idx.get(r.day);
        if (i == null) continue;
        const name = String(r[key] ?? 'unknown');
        out[name] ??= dayList.map(() => 0);
        out[name][i] += metric === 'cost' ? Number(r.cost_usd) : 1;
      }
      return out;
    };
    const counts = (pick: (x: any) => string | null) => {
      const a = dayList.map(() => 0);
      for (const x of cards) { const d = pick(x); const i = d ? idx.get(d) : undefined; if (i != null) a[i]++; }
      return a;
    };
    const outcome = (st: string) => { const a = dayList.map(() => 0); for (const r of runs) { const i = idx.get(r.day); if (i != null && r.status === st) a[i]++; } return a; };
    const d = { accepted: 0, edited: 0, rejected: 0 };
    for (const x of decisions) {
      if (x.action === 'draft.rest_accepted') d.accepted += (x.detail?.items ?? []).length;
      else if (x.action === 'draft.item_accepted') d.accepted++;
      else if (x.action === 'draft.item_edited') d.edited++;
      else if (x.action === 'draft.item_rejected') d.rejected++;
    }
    res.json({
      days: dayList,
      cost: { stage: series('stage', 'cost'), agent: series('agent', 'cost'), model: series('model', 'cost') },
      runs: { stage: series('stage', 'runs'), agent: series('agent', 'runs'), model: series('model', 'runs') },
      outcomes: { succeeded: outcome('succeeded'), failed: outcome('failed') },
      flow: { added: counts((x) => x.created), closed: counts((x) => x.closed) },
      decisions: d,
    });
  }));

  // Audit log with filters: free text, who, what, address and a date range.
  r.get('/audit', wrap(async (req, res) => {
    const f = z.object({
      q: z.string().max(200).optional(),
      actor: z.string().max(120).optional(),
      action: z.string().max(120).optional(),
      ip: z.string().max(60).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().refine((n) => [25, 50, 100, 200].includes(n)).default(50),
      limit: z.coerce.number().int().optional(),
    }).parse(req.query);
    const where: string[] = [];
    const vals: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      vals.push(v);
      where.push(sql.replace('?', `$${vals.length}`));
    };
    if (f.q?.trim()) add(`(actor ILIKE ? OR action ILIKE $X OR entity ILIKE $X OR detail::text ILIKE $X)`.replace(/\$X/g, `$${vals.length + 1}`), `%${f.q.trim()}%`);
    if (f.actor) add(`actor = ?`, f.actor);
    if (f.action) add(`action = ?`, f.action);
    if (f.ip?.trim()) add(`ip ILIKE ?`, `${f.ip.trim()}%`);
    if (f.from) add(`at >= ?::date`, f.from);
    if (f.to) add(`at < (?::date + 1)`, f.to);
    // Members-only engagements stay private in the audit log too.
    const ids = await visibleIds(db, req.user);
    if (ids) add(`(engagement_id IS NULL OR engagement_id = ANY(?))`, ids);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const size = f.limit ? Math.min(f.limit, 1000) : f.pageSize;
    const { rows: total } = await db.query(`SELECT count(*)::int AS n FROM audit_log ${w}`, vals);
    const { rows } = await db.query(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ${size} OFFSET ${(f.page - 1) * size}`, vals);
    const { rows: actors } = await db.query(`SELECT DISTINCT actor FROM audit_log ORDER BY actor`);
    const { rows: actions } = await db.query(`SELECT DISTINCT action FROM audit_log ORDER BY action`);
    res.json({
      rows: rows.map((r: any) => ({ ...toAudit(r), ip: r.ip ?? null })),
      total: total[0].n, page: f.page, pageSize: size,
      actors: actors.map((a: any) => a.actor), actions: actions.map((a: any) => a.action),
    });
  }));

  configRoutes(r, db, actorOf, wrap);
  authRoutes(r, db, wrap);
  grcRoutes(r, db, actorOf, wrap);
  archiveRoutes(r, db, actorOf, wrap);
  kbRoutes(r, db, actorOf, wrap);
  testingRoutes(r, db, actorOf, wrap);
  assistantRoutes(r, db, actorOf, wrap);
  incidentRoutes(r, db, actorOf, wrap);
  planRoutes(r, db, actorOf, wrap);
  workflowRoutes(r, db, actorOf, wrap);
  connectorRoutes(r, db, actorOf, wrap);
  harmonizeRoutes(r, db, actorOf, wrap);
  ingestTokenRoutes(r, db, actorOf, wrap);
  outboundRoutes(r, db, actorOf, wrap);
  clientStepRoutes(r, db, actorOf, wrap);
  accessRoutes(r, db, actorOf, wrap);
  ssoRoutes(r, db, actorOf, wrap);
  return r;
}
