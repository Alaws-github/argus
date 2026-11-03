// Configuration endpoints: workspace settings, model providers, agents and
// engagement settings. Every change is audited; API keys never leave the server.
import type { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import {
  AgentPatch, EngagementPatch, ProviderInput, STAGES, WorkspaceSettings,
  type Stage,
} from '@gh/shared';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { encrypt } from './crypto.js';
import { emit } from './realtime.js';
import { RULES_VERSION as CLASSIFIER_RULES } from './agents/risk-classifier.js';
import { RULES_VERSION as DESIGNER_RULES } from './agents/control-designer.js';
import { AGENT_SELECT, getEngagement, getSettings, monthSpend, toAgent, toEngagement } from './store.js';
import { PROVIDER_SELECT, apiKeyOf, discoverModels, getProviderRow, toProvider } from './providers.js';

const RULES_VERSIONS: Record<string, string> = { risk_classifier: CLASSIFIER_RULES, control_designer: DESIGNER_RULES };

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

  // -------------------------------------------------------------- engagement
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
    if (!sets.length) throw httpError(400, 'Nothing to change');
    await db.tx(async (q) => {
      await q.query(`UPDATE engagements SET ${sets.join(', ')} WHERE id = $1`, [before.id, ...vals]);
      const changes = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, k === 'about' ? 'updated' : { from: (before as any)[k], to: v }]));
      await logAudit(q, actor, 'engagement.changed', `engagement:${before.slug}`, changes);
    });
    const { rows } = await db.query(`SELECT * FROM engagements WHERE id = $1`, [before.id]);
    const e = toEngagement(rows[0]);
    emit('engagement', e);
    res.json(e);
  }));
}
