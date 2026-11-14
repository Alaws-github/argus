// AI model providers (Models & Keys): list, test, add, update and remove.
import { ProviderInput } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { logAudit } from '../audit/audit.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { encrypt } from '../core/crypto.js';
import { type Db } from '../core/db.js';
import { PROVIDER_SELECT, apiKeyOf, discoverModels, getProviderRow, toProvider } from './providers.js';

export function providerRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // --------------------------------------------------------------- providers
  const listProviders = async () =>
    (await db.query(`${PROVIDER_SELECT} ORDER BY p.built_in DESC, p.created_at`)).rows.map(toProvider);

  r.get(
    '/providers',
    wrap(async (_req, res) => res.json(await listProviders())),
  );

  // Test a provider before saving it: lists its models with the given settings.
  r.post(
    '/providers/test',
    wrap(async (req, res) => {
      const body = z
        .object({
          type: ProviderInput.shape.type,
          baseUrl: z.string().url(),
          apiKey: z.string().optional(),
          id: z.string().uuid().optional(),
        })
        .parse(req.body);
      let key = body.apiKey || undefined;
      if (!key && body.id) {
        const row = await getProviderRow(db, body.id);
        if (row) key = apiKeyOf(row);
      }
      try {
        const models = await discoverModels(body.type, body.baseUrl, key);
        res.json({
          ok: true,
          models,
          message: `Connected. ${models.length} model${models.length === 1 ? '' : 's'} found.`,
        });
      } catch (e: any) {
        res.json({ ok: false, models: [], message: String(e?.message ?? e) });
      }
    }),
  );

  r.post(
    '/providers',
    wrap(async (req, res) => {
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
            input.type,
            input.name,
            input.baseUrl,
            key ? encrypt(key) : null,
            key ? key.slice(-4) : null,
            input.billed,
            input.maxConcurrent,
            JSON.stringify(models),
            JSON.stringify(input.prices ?? {}),
            status,
            statusText,
            input.enabled ?? true,
          ],
        );
        await logAudit(q, actor, 'provider.added', `provider:${input.name}`, {
          type: input.type,
          baseUrl: input.baseUrl,
          billed: input.billed,
          authSaved: !!key,
          models: models.length,
        });
        return rows[0].id;
      });
      res.status(201).json((await listProviders()).find((p) => p.id === id));
    }),
  );

  r.patch(
    '/providers/:id',
    wrap(async (req, res) => {
      const row = await getProviderRow(db, req.params.id);
      if (!row) throw httpError(404, 'Provider not found');
      const patch = ProviderInput.partial()
        .omit({ type: true })
        .extend({ clearKey: z.boolean().optional() })
        .parse(req.body);
      if (row.built_in && Object.keys(patch).some((k) => k !== 'enabled'))
        throw httpError(409, 'The built-in rules provider can only be turned on or off');
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
    }),
  );

  r.post(
    '/providers/:id/test',
    wrap(async (req, res) => {
      const row = await getProviderRow(db, req.params.id);
      if (!row) throw httpError(404, 'Provider not found');
      const actor = actorOf(req);
      try {
        const found = await discoverModels(row.type, row.base_url, apiKeyOf(row));
        const models = [...new Set([...found, ...(row.models ?? [])])];
        await db.query(
          `UPDATE providers SET status='connected', status_text=NULL, checked_at=now(), models=$2 WHERE id=$1`,
          [row.id, JSON.stringify(models)],
        );
        await logAudit(db, actor, 'provider.tested', `provider:${row.name}`, { ok: true, models: found.length });
      } catch (e: any) {
        const message = String(e?.message ?? e);
        await db.query(`UPDATE providers SET status='error', status_text=$2, checked_at=now() WHERE id=$1`, [
          row.id,
          message,
        ]);
        await logAudit(db, actor, 'provider.tested', `provider:${row.name}`, { ok: false, error: message });
      }
      res.json((await listProviders()).find((p) => p.id === row.id));
    }),
  );

  r.delete(
    '/providers/:id',
    wrap(async (req, res) => {
      const p = (await listProviders()).find((x) => x.id === req.params.id);
      if (!p) throw httpError(404, 'Provider not found');
      if (p.builtIn) throw httpError(409, "The built-in rules provider can't be removed");
      if (p.usedBy > 0)
        throw httpError(
          409,
          `${p.usedBy} agent${p.usedBy === 1 ? ' uses' : 's use'} it. Move them to another provider first.`,
        );
      const actor = actorOf(req);
      await db.tx(async (q) => {
        await q.query(`DELETE FROM providers WHERE id = $1`, [p.id]);
        await logAudit(q, actor, 'provider.removed', `provider:${p.name}`, { type: p.type });
      });
      res.json({ ok: true });
    }),
  );
}
