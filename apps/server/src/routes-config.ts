// Configuration endpoints: workspace settings, model providers, agents and
// engagement settings. Every change is audited; API keys never leave the server.
import type { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import {
  AgentPatch, NewAgent, roleForStage, AGENT_ROLES, EngagementPatch, FRAMEWORK_CHOICES, NewEngagement, ProviderInput, STAGES, WorkspaceSettings,
  type Stage, toolById, workflowTemplate,
} from '@gh/shared';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { encrypt } from './crypto.js';
import { emit } from './realtime.js';
import { RULES_VERSION as CLASSIFIER_RULES } from './agents/risk-classifier.js';
import { RULES_VERSION as DESIGNER_RULES } from './agents/control-designer.js';
import { ensureAgents } from './seed.js';
import { ensureEngagementKnowledge, indexEngagement, scheduleEmbedding } from './kb.js';
import { DRAFTING_RULES_VERSIONS } from './agents/drafting.js';
import { PLANNER_RULES_VERSION } from './planner.js';
import { AGENT_SELECT, getEngagement, getSettings, monthSpend, toAgent, toEngagement } from './store.js';
import { PROVIDER_SELECT, apiKeyOf, discoverModels, getProviderRow, toProvider } from './providers.js';

const RULES_VERSIONS: Record<string, string> = { use_case_planner: PLANNER_RULES_VERSION, risk_classifier: CLASSIFIER_RULES, control_designer: DESIGNER_RULES, ...DRAFTING_RULES_VERSIONS };

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

export function configRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  // ---------------------------------------------------------------- settings
  r.get('/settings', wrap(async (_req, res) => {
    const s = await getSettings(db);
    res.json({ ...s, monthSpendUsd: await monthSpend(db, s.timeZone) });
  }));

  r.put('/settings', wrap(async (req, res) => {
    const patch = WorkspaceSettings.partial().parse(req.body);
    if (patch.timeZone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: patch.timeZone });
      } catch {
        throw httpError(400, `${patch.timeZone} isn't a time zone`);
      }
    }
    if (patch.defaultProviderId && !(await getProviderRow(db, patch.defaultProviderId))) throw httpError(400, 'That provider no longer exists');
    const actor = actorOf(req);
    const before = await getSettings(db);
    await db.tx(async (q) => {
      for (const [k, v] of Object.entries(patch)) {
        await q.query(
          `INSERT INTO settings (key, value, updated_by) VALUES ($1,$2,$3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [k, JSON.stringify(v), actor],
        );
      }
      const changes = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { from: (before as any)[k], to: v }]));
      await logAudit(q, actor, 'settings.updated', 'workspace', changes);
    });
    emit('usage', { changed: true });
    const s = await getSettings(db);
    res.json({ ...s, monthSpendUsd: await monthSpend(db, s.timeZone) });
  }));

  // --------------------------------------------------------------- providers
  const listProviders = async () => (await db.query(`${PROVIDER_SELECT} ORDER BY p.built_in DESC, p.created_at`)).rows.map(toProvider);

  r.get('/providers', wrap(async (_req, res) => res.json(await listProviders())));

  // Test a provider before saving it: lists its models with the given settings.
  r.post('/providers/test', wrap(async (req, res) => {
    const body = z.object({ type: ProviderInput.shape.type, baseUrl: z.string().url(), apiKey: z.string().optional(), id: z.string().uuid().optional() }).parse(req.body);
    let key = body.apiKey || undefined;
    if (!key && body.id) {
      const row = await getProviderRow(db, body.id);
      if (row) key = apiKeyOf(row);
    }
    try {
      const models = await discoverModels(body.type, body.baseUrl, key);
      res.json({ ok: true, models, message: `Connected. ${models.length} model${models.length === 1 ? '' : 's'} found.` });
    } catch (e: any) {
      res.json({ ok: false, models: [], message: String(e?.message ?? e) });
    }
  }));

  r.post('/providers', wrap(async (req, res) => {
    const input = ProviderInput.parse(req.body);
    const actor = actorOf(req);
    const key = input.apiKey?.trim() || null;
    let models = input.models ?? [];
    let status = 'untested';
    let statusText: string | null = null;
    try {
      const found = await discoverModels(input.type, input.baseUrl, key ?? undefined);
      models = [...new Set([...found, ...models])];
      status = 'connected';
    } catch (e: any) {
      statusText = String(e?.message ?? e);
      status = 'error';
    }
    const id = await db.tx(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO providers (type, name, base_url, api_key_enc, key_last4, billed, max_concurrent, models, prices, status, status_text, checked_at, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12) RETURNING id`,
        [
          input.type, input.name, input.baseUrl, key ? encrypt(key) : null, key ? key.slice(-4) : null,
          input.billed, input.maxConcurrent, JSON.stringify(models), JSON.stringify(input.prices ?? {}),
          status, statusText, input.enabled ?? true,
        ],
      );
      await logAudit(q, actor, 'provider.added', `provider:${input.name}`, { type: input.type, baseUrl: input.baseUrl, billed: input.billed, authSaved: !!key, models: models.length });
      return rows[0].id;
    });
    res.status(201).json((await listProviders()).find((p) => p.id === id));
  }));

  r.patch('/providers/:id', wrap(async (req, res) => {
    const row = await getProviderRow(db, req.params.id);
    if (!row) throw httpError(404, 'Provider not found');
    const patch = ProviderInput.partial().omit({ type: true }).extend({ clearKey: z.boolean().optional() }).parse(req.body);
    if (row.built_in && Object.keys(patch).some((k) => k !== 'enabled')) throw httpError(409, 'The built-in rules provider can only be turned on or off');
    const actor = actorOf(req);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length + 1}`);
    };
    if (patch.name !== undefined) set('name', patch.name);
    if (patch.baseUrl !== undefined) set('base_url', patch.baseUrl);
    if (patch.billed !== undefined) set('billed', patch.billed);
    if (patch.maxConcurrent !== undefined) set('max_concurrent', patch.maxConcurrent);
    if (patch.models !== undefined) set('models', JSON.stringify([...new Set(patch.models)]));
    if (patch.prices !== undefined) set('prices', JSON.stringify(patch.prices));
    if (patch.enabled !== undefined) set('enabled', patch.enabled);
    if (patch.apiKey?.trim()) {
      set('api_key_enc', encrypt(patch.apiKey.trim()));
      set('key_last4', patch.apiKey.trim().slice(-4));
      set('status', 'untested');
    } else if (patch.clearKey) {
      set('api_key_enc', null);
      set('key_last4', null);
      set('status', 'untested');
    }
    if (!sets.length) throw httpError(400, 'Nothing to change');
    await db.tx(async (q) => {
      await q.query(`UPDATE providers SET ${sets.join(', ')} WHERE id = $1`, [row.id, ...vals]);
      const { apiKey, clearKey, ...safe } = patch;
      await logAudit(q, actor, 'provider.changed', `provider:${row.name}`, {
        ...safe,
        ...(apiKey?.trim() ? { auth: 'replaced' } : clearKey ? { auth: 'removed' } : {}),
        ...(safe.prices ? { prices: Object.keys(safe.prices).length } : {}),
        ...(safe.models ? { models: safe.models.length } : {}),
      });
    });
    res.json((await listProviders()).find((p) => p.id === row.id));
  }));

  r.post('/providers/:id/test', wrap(async (req, res) => {
    const row = await getProviderRow(db, req.params.id);
    if (!row) throw httpError(404, 'Provider not found');
    const actor = actorOf(req);
    try {
      const found = await discoverModels(row.type, row.base_url, apiKeyOf(row));
      const models = [...new Set([...found, ...(row.models ?? [])])];
      await db.query(`UPDATE providers SET status='connected', status_text=NULL, checked_at=now(), models=$2 WHERE id=$1`, [row.id, JSON.stringify(models)]);
      await logAudit(db, actor, 'provider.tested', `provider:${row.name}`, { ok: true, models: found.length });
    } catch (e: any) {
      const message = String(e?.message ?? e);
      await db.query(`UPDATE providers SET status='error', status_text=$2, checked_at=now() WHERE id=$1`, [row.id, message]);
      await logAudit(db, actor, 'provider.tested', `provider:${row.name}`, { ok: false, error: message });
    }
    res.json((await listProviders()).find((p) => p.id === row.id));
  }));

  r.delete('/providers/:id', wrap(async (req, res) => {
    const p = (await listProviders()).find((x) => x.id === req.params.id);
    if (!p) throw httpError(404, 'Provider not found');
    if (p.builtIn) throw httpError(409, "The built-in rules provider can't be removed");
    if (p.usedBy > 0) throw httpError(409, `${p.usedBy} agent${p.usedBy === 1 ? ' uses' : 's use'} it. Move them to another provider first.`);
    const actor = actorOf(req);
    await db.tx(async (q) => {
      await q.query(`DELETE FROM providers WHERE id = $1`, [p.id]);
      await logAudit(q, actor, 'provider.removed', `provider:${p.name}`, { type: p.type });
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------------ agents
  r.get('/engagements/:id/agents', wrap(async (req, res) => {
    const { rows } = await db.query(`${AGENT_SELECT} WHERE a.engagement_id = $1 ORDER BY a.created_at`, [req.params.id]);
    const order = STAGES as readonly string[];
    res.json(rows.map((r: any) => ({ ...toAgent(r), rulesVersion: RULES_VERSIONS[r.role] ?? null })).sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage)));
  }));

  r.patch('/agents/:id', wrap(async (req, res) => {
    const patch = AgentPatch.parse(req.body);
    const actor = actorOf(req);
    const { rows } = await db.query(`${AGENT_SELECT} WHERE a.id = $1`, [req.params.id]);
    if (!rows[0]) throw httpError(404, 'Agent not found');
    const before = toAgent(rows[0]);
    if (patch.enabled && !before.built) throw httpError(409, `${before.name} isn't built yet, so it can't be turned on`);
    for (const pid of [patch.providerId, patch.fallbackProviderId]) {
      if (pid && !(await getProviderRow(db, pid))) throw httpError(400, 'That provider no longer exists');
    }
    const cols: Record<string, string> = {
      name: 'name', enabled: 'enabled', route: 'route', providerId: 'provider_id', model: 'model', effort: 'effort',
      fallbackProviderId: 'fallback_provider_id', fallbackModel: 'fallback_model', summary: 'summary',
      instructions: 'instructions', tools: 'tools', maxCostUsd: 'max_cost_usd', timeoutMin: 'timeout_min', concurrency: 'concurrency',
      mode: 'mode', maxSteps: 'max_steps', selfCheck: 'self_check',
    };
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) throw httpError(400, 'Nothing to change');
    const vals = keys.map((k) => (k === 'tools' ? JSON.stringify(patch[k]) : patch[k]));
    await db.tx(async (q) => {
      await q.query(`UPDATE agents SET ${keys.map((k, i) => `${cols[k]} = $${i + 2}`).join(', ')} WHERE id = $1`, [before.id, ...vals]);
      const changes = Object.fromEntries(
        keys.map((k) => [k, k === 'instructions' ? { from: `${before.instructions.length} chars`, to: `${patch.instructions!.length} chars` } : { from: (before as any)[k], to: patch[k] }]),
      );
      await logAudit(q, actor, 'agent.changed', `agent:${before.name}`, changes);
    });
    if (patch.enabled) await db.query(`UPDATE agents SET killed_at = NULL WHERE id = $1`, [before.id]);
    const { rows: after } = await db.query(`${AGENT_SELECT} WHERE a.id = $1`, [before.id]);
    res.json({ ...toAgent(after[0]), rulesVersion: RULES_VERSIONS[before.role] ?? null });
  }));

  // Add an agent to a stage. It does that stage's job; it starts from the
  // stage's built-in agent's model, tools and limits unless told otherwise.
  const createAgent = async (engagementId: string, body: NewAgent, actor: string, action = 'agent.created') => {
    const role = roleForStage(body.stage);
    if (!role) throw httpError(422, 'No agent can work on that stage');
    for (const pid of [body.providerId, body.fallbackProviderId]) {
      if (pid && !(await getProviderRow(db, pid))) throw httpError(400, 'That provider no longer exists');
    }
    const { rows: base } = await db.query(`SELECT * FROM agents WHERE engagement_id = $1 AND role = $2 ORDER BY custom, created_at LIMIT 1`, [engagementId, role]);
    const b = base[0] ?? {};
    const { rows: dup } = await db.query(`SELECT 1 FROM agents WHERE engagement_id = $1 AND lower(name) = lower($2)`, [engagementId, body.name]);
    if (dup.length) throw httpError(409, `There is already an agent called ${body.name}`);
    const id = await db.tx(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO agents (engagement_id, role, name, stage, route, enabled, provider_id, model, effort, fallback_provider_id, fallback_model, summary, instructions, tools, max_cost_usd, timeout_min, concurrency, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true) RETURNING id`,
        [engagementId, role, body.name, AGENT_ROLES[role].stage, body.route, body.enabled,
          body.providerId !== undefined ? body.providerId : b.provider_id ?? null, body.model ?? b.model ?? 'rules-v1', body.effort ?? b.effort ?? 'medium',
          body.fallbackProviderId !== undefined ? body.fallbackProviderId : b.fallback_provider_id ?? null, body.fallbackModel !== undefined ? body.fallbackModel : b.fallback_model ?? null,
          body.summary || AGENT_ROLES[role].summary, body.instructions, JSON.stringify(body.tools ?? b.tools ?? AGENT_ROLES[role].tools),
          body.maxCostUsd ?? b.max_cost_usd ?? 1, body.timeoutMin ?? b.timeout_min ?? 10, body.concurrency ?? b.concurrency ?? 2],
      );
      await logAudit(q, actor, action, `agent:${body.name}`, { stage: AGENT_ROLES[role].stage, job: AGENT_ROLES[role].name, route: body.route, enabled: body.enabled, model: body.model ?? b.model });
      return rows[0].id as string;
    });
    const { rows } = await db.query(`${AGENT_SELECT} WHERE a.id = $1`, [id]);
    emit('agents', { engagementId });
    return { ...toAgent(rows[0]), rulesVersion: RULES_VERSIONS[role] ?? null };
  };

  r.post('/engagements/:id/agents', wrap(async (req, res) => {
    res.status(201).json(await createAgent(req.params.id, NewAgent.parse(req.body), actorOf(req)));
  }));

  r.post('/agents/:id/duplicate', wrap(async (req, res) => {
    const { rows } = await db.query(`${AGENT_SELECT} WHERE a.id = $1`, [req.params.id]);
    if (!rows[0]) throw httpError(404, 'Agent not found');
    const a = toAgent(rows[0]);
    let name = `${a.name} (copy)`.slice(0, 60);
    for (let n = 2; (await db.query(`SELECT 1 FROM agents WHERE engagement_id = $1 AND lower(name) = lower($2)`, [a.engagementId, name])).rows.length; n++) name = `${a.name} (copy ${n})`.slice(0, 60);
    res.status(201).json(await createAgent(a.engagementId, {
      stage: a.stage, name, enabled: false, route: a.route, providerId: a.providerId, model: a.model, effort: a.effort,
      fallbackProviderId: a.fallbackProviderId, fallbackModel: a.fallbackModel, summary: a.summary, instructions: a.instructions,
      tools: a.tools, maxCostUsd: a.maxCostUsd, timeoutMin: a.timeoutMin, concurrency: a.concurrency,
    }, actorOf(req), 'agent.duplicated'));
  }));

  r.delete('/agents/:id', wrap(async (req, res) => {
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
  }));

  // -------------------------------------------------------------- engagement
  // Add an engagement: the client, what's in scope, where people step in and
  // which models run the agents. Everything lands in one transaction.
  r.post('/engagements', wrap(async (req, res) => {
    const b = NewEngagement.parse(req.body);
    const actor = actorOf(req);
    const slugBase = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'engagement';
    const { rows: taken } = await db.query(`SELECT slug, prefix FROM engagements`);
    if (taken.some((e: any) => e.prefix === b.prefix)) throw httpError(409, `Another engagement already uses the prefix ${b.prefix}. Card keys must be unique, so pick another.`);
    let slug = slugBase;
    for (let n = 2; taken.some((e: any) => e.slug === slug); n++) slug = `${slugBase}-${n}`;
    for (const a of Object.values(b.agents)) if (!(await getProviderRow(db, a.providerId))) throw httpError(400, 'A chosen provider no longer exists');
    const gates = Object.fromEntries(STAGES.map((st) => [st, st === 'intake' ? true : st === 'closed' ? false : !!b.gates[st]]));
    const labels = FRAMEWORK_CHOICES.filter((f) => b.frameworks.includes(f.id)).map((f) => f.label);

    const id = await db.tx(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO engagements (slug, name, client, prefix, color, gates, about, framework, sector, appetite, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [slug, b.name, b.client, b.prefix, b.color, JSON.stringify(gates), b.about, labels.join(' · '), b.sector, JSON.stringify(b.appetite), actor],
      );
      const eid = rows[0].id;
      // The person who creates an engagement is its first member.
      await q.query(`INSERT INTO engagement_members (engagement_id, user_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [eid, req.user!.id, actor]);
      await ensureAgents(q, eid);
      for (const [role, a] of Object.entries(b.agents)) {
        await q.query(`UPDATE agents SET provider_id = $3, model = $4, effort = $5 WHERE engagement_id = $1 AND role = $2`, [eid, role, a.providerId, a.model, a.effort]);
      }
      let soa = 0;
      if (b.startSoa) {
        const { rows: lib } = await q.query(`SELECT id, code, refs FROM control_library`);
        for (const l of lib) {
          const hits = b.frameworks.filter((f) => (l.refs?.[f] ?? []).length);
          if (!hits.length) continue;
          const names = FRAMEWORK_CHOICES.filter((f) => hits.includes(f.id)).map((f) => f.label).join(', ');
          await q.query(`INSERT INTO soa (engagement_id, library_id, applicable, justification, decided_by) VALUES ($1,$2,true,$3,$4)`, [
            eid, l.id, `Starting position: maps to ${names}, which is in scope. Confirm or exclude with a reason.`, actor,
          ]);
          soa++;
        }
      }
      let n = 0;
      for (const title of b.useCases) {
        n++;
        const useCase = { title, businessOwner: '', description: '', dataUsed: '', affectedPeople: '', autonomy: 'human_in_loop', vendor: '' };
        await q.query(`INSERT INTO cards (engagement_id, number, key, title, use_case, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
          eid, n, `${b.prefix}-${n}`, title, JSON.stringify(useCase), actor,
        ]);
      }
      await q.query(`UPDATE engagements SET card_seq = $2, client_tools = $3 WHERE id = $1`, [eid, n, JSON.stringify(b.clientTools.filter((t) => toolById(t)))]);
      // v1.7.4: a client workflow or client tools chosen at creation switches on the module that shows them.
      if (b.workflow || b.clientTools.length) await q.query(`UPDATE engagements SET modules = modules || '{"connectors": true}'::jsonb WHERE id = $1`, [eid]);
      // A starting client workflow, as a draft: the real process is usually agreed with the client later.
      let workflow: string | null = null;
      if (b.workflow) {
        const g = workflowTemplate(b.workflow.template);
        const { rows: wf } = await q.query(`INSERT INTO workflows (engagement_id, name, description, graph, updated_by) VALUES ($1,$2,$3,$4,$5) RETURNING number`,
          [eid, b.workflow.name ?? `${b.client} AI approval`, 'Started with the engagement. Agree the real process with the client, then publish.', JSON.stringify(g), actor]);
        workflow = `WF-${wf[0].number}`;
        await logAudit(q, actor, 'workflow.created', `workflow:${workflow}`, { name: b.workflow.name ?? `${b.client} AI approval`, template: b.workflow.template, withEngagement: true });
      }
      await logAudit(q, actor, 'engagement.created', `engagement:${slug}`, {
        name: b.name, client: b.client, prefix: b.prefix, frameworks: labels, soaStarted: soa, useCases: n, clientTools: b.clientTools, workflow,
        gates: Object.keys(gates).filter((k) => gates[k]), models: Object.fromEntries(Object.entries(b.agents).map(([k, v]) => [k, v.model])),
      });
      return eid;
    });
    const { rows } = await db.query(`SELECT * FROM engagements WHERE id = $1`, [id]);
    const e = toEngagement(rows[0]);
    await ensureEngagementKnowledge(db, e.id).catch(() => {});
    if (req.method === 'PATCH' && (req.body as any)?.about !== undefined) await indexEngagement(db, { id: e.id, name: e.name, client: e.client, about: e.about });
    scheduleEmbedding(db);
    emit('engagement', e);
    res.status(201).json(e);
  }));

  r.patch('/engagements/:id', wrap(async (req, res) => {
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
    for (const k of ['name', 'client', 'prefix', 'framework', 'about', 'paused'] as const) if (patch[k] !== undefined) set(k, patch[k]);
    if (patch.gates) {
      const gates = { ...before.gates };
      for (const [k, v] of Object.entries(patch.gates)) if ((STAGES as readonly string[]).includes(k)) gates[k as Stage] = v;
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
      const changes = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, k === 'about' ? 'updated' : { from: (before as any)[k], to: v }]));
      await logAudit(q, actor, 'engagement.changed', `engagement:${before.slug}`, changes);
    });
    const { rows } = await db.query(`SELECT * FROM engagements WHERE id = $1`, [before.id]);
    const e = toEngagement(rows[0]);
    await ensureEngagementKnowledge(db, e.id).catch(() => {});
    if (req.method === 'PATCH' && (req.body as any)?.about !== undefined) await indexEngagement(db, { id: e.id, name: e.name, client: e.client, about: e.about });
    scheduleEmbedding(db);
    emit('engagement', e);
    res.json(e);
  }));
}
