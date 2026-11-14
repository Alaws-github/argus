// Workspace settings: read and update.
import { WorkspaceSettings } from '@gh/shared';
import { type Router } from 'express';
import { logAudit } from '../audit/audit.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { getProviderRow } from '../ai/providers.js';
import { emit } from '../core/realtime.js';
import { getSettings, monthSpend } from './settings-store.js';

/**
 * Registers these 2 routes on the API router (each path is under /api):
 * - GET /settings
 * - PUT /settings
 */
export function settingsRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ---------------------------------------------------------------- settings
  r.get(
    '/settings',
    wrap(async (_req, res) => {
      const s = await getSettings(db);
      res.json({ ...s, monthSpendUsd: await monthSpend(db, s.timeZone) });
    }),
  );

  r.put(
    '/settings',
    wrap(async (req, res) => {
      const patch = WorkspaceSettings.partial().parse(req.body);
      if (patch.timeZone) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: patch.timeZone });
        } catch {
          throw httpError(400, `${patch.timeZone} isn't a time zone`);
        }
      }
      if (patch.defaultProviderId && !(await getProviderRow(db, patch.defaultProviderId)))
        throw httpError(400, 'That provider no longer exists');
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
        const changes = Object.fromEntries(
          Object.entries(patch).map(([k, v]) => [k, { from: (before as any)[k], to: v }]),
        );
        await logAudit(q, actor, 'settings.updated', 'workspace', changes);
      });
      emit('usage', { changed: true });
      const s = await getSettings(db);
      res.json({ ...s, monthSpendUsd: await monthSpend(db, s.timeZone) });
    }),
  );
}
