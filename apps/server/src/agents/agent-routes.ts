// The engagement's agents: list, configure, add, duplicate and delete custom agents.
import { AGENT_ROLES, AgentPatch, NewAgent, STAGES, roleForStage } from '@gh/shared';
import { type Router } from 'express';
import { RULES_VERSION as DESIGNER_RULES } from './control-designer.js';
import { DRAFTING_RULES_VERSIONS } from './drafting.js';
import { RULES_VERSION as CLASSIFIER_RULES } from './risk-classifier.js';
import { logAudit } from '../audit/audit.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { PLANNER_RULES_VERSION } from './planner.js';
import { getProviderRow } from '../ai/providers.js';
import { emit } from '../core/realtime.js';
import { AGENT_SELECT, toAgent } from '../settings/settings-store.js';

const RULES_VERSIONS: Record<string, string> = {
  use_case_planner: PLANNER_RULES_VERSION,
  risk_classifier: CLASSIFIER_RULES,
  control_designer: DESIGNER_RULES,
  ...DRAFTING_RULES_VERSIONS,
};

export function agentRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ------------------------------------------------------------------ agents
  r.get(
    '/engagements/:id/agents',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${AGENT_SELECT} WHERE a.engagement_id = $1 ORDER BY a.created_at`, [
        req.params.id,
      ]);
      const order = STAGES as readonly string[];
      res.json(
        rows
          .map((r: any) => ({ ...toAgent(r), rulesVersion: RULES_VERSIONS[r.role] ?? null }))
          .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage)),
      );
    }),
  );

  r.patch(
    '/agents/:id',
    wrap(async (req, res) => {
      const patch = AgentPatch.parse(req.body);
      const actor = actorOf(req);
      const { rows } = await db.query(`${AGENT_SELECT} WHERE a.id = $1`, [req.params.id]);
      if (!rows[0]) throw httpError(404, 'Agent not found');
      const before = toAgent(rows[0]);
      if (patch.enabled && !before.built)
        throw httpError(409, `${before.name} isn't built yet, so it can't be turned on`);
      for (const pid of [patch.providerId, patch.fallbackProviderId]) {
        if (pid && !(await getProviderRow(db, pid))) throw httpError(400, 'That provider no longer exists');
      }
      const cols: Record<string, string> = {
        name: 'name',
        enabled: 'enabled',
        route: 'route',
        providerId: 'provider_id',
        model: 'model',
        effort: 'effort',
        fallbackProviderId: 'fallback_provider_id',
        fallbackModel: 'fallback_model',
        summary: 'summary',
        instructions: 'instructions',
        tools: 'tools',
        maxCostUsd: 'max_cost_usd',
        timeoutMin: 'timeout_min',
        concurrency: 'concurrency',
        mode: 'mode',
        maxSteps: 'max_steps',
        selfCheck: 'self_check',
      };
      const keys = Object.keys(patch) as (keyof typeof patch)[];
      if (!keys.length) throw httpError(400, 'Nothing to change');
      const vals = keys.map((k) => (k === 'tools' ? JSON.stringify(patch[k]) : patch[k]));
      await db.tx(async (q) => {
        await q.query(`UPDATE agents SET ${keys.map((k, i) => `${cols[k]} = $${i + 2}`).join(', ')} WHERE id = $1`, [
          before.id,
          ...vals,
        ]);
        const changes = Object.fromEntries(
          keys.map((k) => [
            k,
            k === 'instructions'
              ? { from: `${before.instructions.length} chars`, to: `${patch.instructions!.length} chars` }
              : { from: (before as any)[k], to: patch[k] },
          ]),
        );
        await logAudit(q, actor, 'agent.changed', `agent:${before.name}`, changes);
      });
      if (patch.enabled) await db.query(`UPDATE agents SET killed_at = NULL WHERE id = $1`, [before.id]);
      const { rows: after } = await db.query(`${AGENT_SELECT} WHERE a.id = $1`, [before.id]);
      res.json({ ...toAgent(after[0]), rulesVersion: RULES_VERSIONS[before.role] ?? null });
    }),
  );

  // Add an agent to a stage. It does that stage's job; it starts from the
  // stage's built-in agent's model, tools and limits unless told otherwise.
  const createAgent = async (engagementId: string, body: NewAgent, actor: string, action = 'agent.created') => {
    const role = roleForStage(body.stage);
    if (!role) throw httpError(422, 'No agent can work on that stage');
    for (const pid of [body.providerId, body.fallbackProviderId]) {
      if (pid && !(await getProviderRow(db, pid))) throw httpError(400, 'That provider no longer exists');
    }
    const { rows: base } = await db.query(
      `SELECT * FROM agents WHERE engagement_id = $1 AND role = $2 ORDER BY custom, created_at LIMIT 1`,
      [engagementId, role],
    );
    const b = base[0] ?? {};
    const { rows: dup } = await db.query(`SELECT 1 FROM agents WHERE engagement_id = $1 AND lower(name) = lower($2)`, [
      engagementId,
      body.name,
    ]);
    if (dup.length) throw httpError(409, `There is already an agent called ${body.name}`);
    const id = await db.tx(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO agents (engagement_id, role, name, stage, route, enabled, provider_id, model, effort, fallback_provider_id, fallback_model, summary, instructions, tools, max_cost_usd, timeout_min, concurrency, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true) RETURNING id`,
        [
          engagementId,
          role,
          body.name,
          AGENT_ROLES[role].stage,
          body.route,
          body.enabled,
          body.providerId !== undefined ? body.providerId : (b.provider_id ?? null),
          body.model ?? b.model ?? 'rules-v1',
          body.effort ?? b.effort ?? 'medium',
          body.fallbackProviderId !== undefined ? body.fallbackProviderId : (b.fallback_provider_id ?? null),
          body.fallbackModel !== undefined ? body.fallbackModel : (b.fallback_model ?? null),
          body.summary || AGENT_ROLES[role].summary,
          body.instructions,
          JSON.stringify(body.tools ?? b.tools ?? AGENT_ROLES[role].tools),
          body.maxCostUsd ?? b.max_cost_usd ?? 1,
          body.timeoutMin ?? b.timeout_min ?? 10,
          body.concurrency ?? b.concurrency ?? 2,
        ],
      );
      await logAudit(q, actor, action, `agent:${body.name}`, {
        stage: AGENT_ROLES[role].stage,
        job: AGENT_ROLES[role].name,
        route: body.route,
        enabled: body.enabled,
        model: body.model ?? b.model,
      });
      return rows[0].id as string;
    });
    const { rows } = await db.query(`${AGENT_SELECT} WHERE a.id = $1`, [id]);
    emit('agents', { engagementId });
    return { ...toAgent(rows[0]), rulesVersion: RULES_VERSIONS[role] ?? null };
  };

  r.post(
    '/engagements/:id/agents',
    wrap(async (req, res) => {
      res.status(201).json(await createAgent(req.params.id, NewAgent.parse(req.body), actorOf(req)));
    }),
  );

  r.post(
    '/agents/:id/duplicate',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${AGENT_SELECT} WHERE a.id = $1`, [req.params.id]);
      if (!rows[0]) throw httpError(404, 'Agent not found');
      const a = toAgent(rows[0]);
      let name = `${a.name} (copy)`.slice(0, 60);
      for (
        let n = 2;
        (
          await db.query(`SELECT 1 FROM agents WHERE engagement_id = $1 AND lower(name) = lower($2)`, [
            a.engagementId,
            name,
          ])
        ).rows.length;
        n++
      )
        name = `${a.name} (copy ${n})`.slice(0, 60);
      res.status(201).json(
        await createAgent(
          a.engagementId,
          {
            stage: a.stage,
            name,
            enabled: false,
            route: a.route,
            providerId: a.providerId,
            model: a.model,
            effort: a.effort,
            fallbackProviderId: a.fallbackProviderId,
            fallbackModel: a.fallbackModel,
            summary: a.summary,
            instructions: a.instructions,
            tools: a.tools,
            maxCostUsd: a.maxCostUsd,
            timeoutMin: a.timeoutMin,
            concurrency: a.concurrency,
          },
          actorOf(req),
          'agent.duplicated',
        ),
      );
    }),
  );

  r.delete(
    '/agents/:id',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${AGENT_SELECT} WHERE a.id = $1`, [req.params.id]);
      if (!rows[0]) throw httpError(404, 'Agent not found');
      const a = toAgent(rows[0]);
      if (!a.custom) throw httpError(409, `${a.name} is the stage's built-in agent. Turn it off instead.`);
      if (a.activeRuns) throw httpError(409, `${a.name} is running. Wait for it to finish.`);
      await db.tx(async (q) => {
        await q.query(`DELETE FROM agents WHERE id = $1`, [a.id]);
        await logAudit(q, actorOf(req), 'agent.deleted', `agent:${a.name}`, { stage: a.stage, route: a.route });
      });
      emit('agents', { engagementId: a.engagementId });
      res.status(204).end();
    }),
  );
}
