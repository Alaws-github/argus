// Archiving makes an engagement read-only: records stay, nothing changes.
// This guard finds the engagement behind any write and refuses it while the
// engagement is archived, so no route can be missed.
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db.js';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Router } from 'express';
import { z } from 'zod';
import { DATA_DIR } from './db.js';
import { logAudit } from './audit.js';
import { emit } from './realtime.js';
import { toEngagement } from './store.js';

const OWNERS: [RegExp, string][] = [
  [/^\/engagements\/([^/]+)\//, `SELECT $1::uuid AS id`],
  [/^\/cards\/([^/]+)/, `SELECT engagement_id AS id FROM cards WHERE id::text = $1 OR key = $1`],
  [/^\/risks\/([^/]+)/, `SELECT engagement_id AS id FROM risks WHERE id = $1`],
  [/^\/controls\/([^/]+)/, `SELECT engagement_id AS id FROM controls WHERE id = $1`],
  [/^\/tests\/([^/]+)/, `SELECT engagement_id AS id FROM tests WHERE id = $1`],
  [/^\/issues\/([^/]+)/, `SELECT engagement_id AS id FROM issues WHERE id = $1`],
  [/^\/inventory\/([^/]+)/, `SELECT engagement_id AS id FROM inventory WHERE id = $1`],
  [/^\/agents\/([^/]+)/, `SELECT engagement_id AS id FROM agents WHERE id = $1`],
  [/^\/evals\/([^/]+)/, `SELECT engagement_id AS id FROM eval_suites WHERE id = $1`],
  [/^\/eval-cases\/([^/]+)/, `SELECT s.engagement_id AS id FROM eval_cases c JOIN eval_suites s ON s.id = c.suite_id WHERE c.id = $1`],
  [/^\/eval-runs\/([^/]+)/, `SELECT s.engagement_id AS id FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE r.id = $1`],
];

// Routes that act on the archive itself, plus the engagement settings change
// (refused separately below so the message is clearer).
const EXEMPT = /^\/engagements\/[^/]+\/(archive|restore|export)$/;

export function archiveGuard(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.method === 'GET' || EXEMPT.test(req.path)) return next();
      let id: string | null = null;
      if (req.path === '/evidence' && req.body?.engagementId) id = String(req.body.engagementId);
      const own = /^\/engagements\/([^/]+)$/.exec(req.path);
      if (own && req.method === 'PATCH') id = own[1];
      if (!id) {
        for (const [re, sql] of OWNERS) {
          const m = re.exec(req.path);
          if (!m) continue;
          const { rows } = await db.query(sql, [m[1]]).catch(() => ({ rows: [] as any[] }));
          id = rows[0]?.id ?? null;
          break;
        }
      }
      if (!id) return next();
      const { rows } = await db.query(`SELECT name, archived_at FROM engagements WHERE id::text = $1`, [id]);
      if (rows[0]?.archived_at) return res.status(409).json({ error: `${rows[0].name} is archived, so it's read-only. A lead can restore it in Settings.` });
      next();
    } catch (e) {
      next(e);
    }
  };
}

// ---------------------------------------------------------------- routes

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

// Everything one engagement holds, for keeping a record outside the harness.
const TABLES: [string, string][] = [
  ['cards', `SELECT * FROM cards WHERE engagement_id = $1 ORDER BY number`],
  ['risks', `SELECT * FROM risks WHERE engagement_id = $1 ORDER BY number`],
  ['controls', `SELECT * FROM controls WHERE engagement_id = $1 ORDER BY number`],
  ['controlRisks', `SELECT cr.* FROM control_risks cr JOIN controls c ON c.id = cr.control_id WHERE c.engagement_id = $1`],
  ['statementOfApplicability', `SELECT l.code, s.applicable, s.justification, s.decided_by, s.decided_at FROM soa s JOIN control_library l ON l.id = s.library_id WHERE s.engagement_id = $1 ORDER BY l.code`],
  ['inventory', `SELECT * FROM inventory WHERE engagement_id = $1 ORDER BY number`],
  ['tests', `SELECT * FROM tests WHERE engagement_id = $1 ORDER BY number`],
  ['evidence', `SELECT * FROM evidence WHERE engagement_id = $1 ORDER BY number`],
  ['issues', `SELECT * FROM issues WHERE engagement_id = $1 ORDER BY number`],
  ['evalSuites', `SELECT * FROM eval_suites WHERE engagement_id = $1 ORDER BY number`],
  ['evalCases', `SELECT c.* FROM eval_cases c JOIN eval_suites s ON s.id = c.suite_id WHERE s.engagement_id = $1`],
  ['evalRuns', `SELECT r.* FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE s.engagement_id = $1`],
  ['assessments', `SELECT * FROM assessments WHERE engagement_id = $1`],
  ['agents', `SELECT id, role, name, stage, enabled, provider_id, model, effort, instructions, max_cost_usd, timeout_min, killed_at, kill_tested_at FROM agents WHERE engagement_id = $1`],
  ['runs', `SELECT r.* FROM runs r JOIN cards c ON c.id = r.card_id WHERE c.engagement_id = $1 ORDER BY r.started_at`],
  ['runEvents', `SELECT ev.* FROM run_events ev JOIN runs r ON r.id = ev.run_id JOIN cards c ON c.id = r.card_id WHERE c.engagement_id = $1 ORDER BY ev.id`],
];

export function archiveRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  const load = async (id: string) => {
    const { rows } = await db.query(`SELECT * FROM engagements WHERE id::text = $1`, [id]);
    if (!rows[0]) throw httpError(404, 'Engagement not found');
    return rows[0];
  };

  r.post('/engagements/:id/archive', wrap(async (req, res) => {
    const b = z.object({ reason: z.string().trim().max(500).default('') }).parse(req.body ?? {});
    const e = await load(req.params.id);
    if (e.archived_at) throw httpError(409, 'Already archived');
    const { rows: active } = await db.query(`SELECT count(*)::int AS n FROM engagements WHERE archived_at IS NULL`);
    if (active[0].n <= 1) throw httpError(409, "This is the only active engagement. Add another before archiving it.");
    const { rows: running } = await db.query(`SELECT count(*)::int AS n FROM cards WHERE engagement_id = $1 AND status = 'running'`, [e.id]);
    if (running[0].n) throw httpError(409, `${running[0].n} agent run${running[0].n === 1 ? ' is' : 's are'} in progress. Wait for ${running[0].n === 1 ? 'it' : 'them'} to finish, or stop the agent, then archive.`);
    await db.tx(async (q) => {
      // Queued work would never run while archived, so hand it back to a person.
      await q.query(`UPDATE cards SET status = 'idle', status_note = 'Engagement archived' WHERE engagement_id = $1 AND status = 'queued'`, [e.id]);
      await q.query(`UPDATE engagements SET archived_at = now(), archived_by = $2, archive_reason = $3 WHERE id = $1`, [e.id, actorOf(req), b.reason || null]);
      await logAudit(q, actorOf(req), 'engagement.archived', `engagement:${e.slug}`, { name: e.name, ...(b.reason ? { reason: b.reason } : {}) });
    });
    const out = toEngagement(await load(e.id));
    emit('engagement', out);
    res.json(out);
  }));

  r.post('/engagements/:id/restore', wrap(async (req, res) => {
    const e = await load(req.params.id);
    if (!e.archived_at) throw httpError(409, "It isn't archived");
    await db.tx(async (q) => {
      await q.query(`UPDATE engagements SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = $1`, [e.id]);
      await logAudit(q, actorOf(req), 'engagement.restored', `engagement:${e.slug}`, { name: e.name, archivedBy: e.archived_by });
    });
    const out = toEngagement(await load(e.id));
    emit('engagement', out);
    res.json(out);
  }));

  // A full JSON record: every table plus the engagement's audit entries.
  // Evidence files are listed by hash; download them from the vault first if needed.
  r.get('/engagements/:id/export', wrap(async (req, res) => {
    const e = await load(req.params.id);
    const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), exportedBy: actorOf(req), engagement: toEngagement(e) };
    for (const [k, sql] of TABLES) out[k] = (await db.query(sql, [e.id])).rows;
    out.audit = (await db.query(
      `SELECT a.* FROM audit_log a WHERE a.entity = $1 OR a.entity LIKE 'card:' || $2 || '-%' ORDER BY a.id`,
      [`engagement:${e.slug}`, e.prefix],
    )).rows;
    await logAudit(db, actorOf(req), 'engagement.exported', `engagement:${e.slug}`, {});
    res.setHeader('content-disposition', `attachment; filename="${e.slug}-record-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(out);
  }));

  // Admin only, after archiving, with the name typed to confirm. The audit log
  // keeps every entry about it, plus who deleted it and what went.
  r.delete('/engagements/:id', wrap(async (req, res) => {
    const b = z.object({ confirm: z.string() }).parse(req.body ?? {});
    const e = await load(req.params.id);
    if (!e.archived_at) throw httpError(409, 'Archive it first. Deleting is only for archived engagements.');
    if (b.confirm.trim() !== e.name) throw httpError(400, `Type the engagement's name, ${e.name}, to confirm`);
    const counts: Record<string, number> = {};
    for (const [k, sql] of TABLES.slice(0, 13)) counts[k] = (await db.query(`SELECT count(*)::int AS n FROM (${sql}) x`, [e.id])).rows[0].n;
    const { rows: files } = await db.query(`SELECT DISTINCT sha256 FROM evidence WHERE engagement_id = $1 AND kind IN ('file','run')`, [e.id]);
    await db.tx(async (q) => {
      // Rows that point at the engagement's cards without cascading.
      await q.query(`DELETE FROM run_events WHERE run_id IN (SELECT r.id FROM runs r JOIN cards c ON c.id = r.card_id WHERE c.engagement_id = $1)`, [e.id]);
      await q.query(`DELETE FROM runs WHERE card_id IN (SELECT id FROM cards WHERE engagement_id = $1)`, [e.id]);
      await q.query(`DELETE FROM engagements WHERE id = $1`, [e.id]);
      await logAudit(q, actorOf(req), 'engagement.deleted', `engagement:${e.slug}`, {
        name: e.name, client: e.client, prefix: e.prefix, archivedBy: e.archived_by, archivedAt: e.archived_at instanceof Date ? e.archived_at.toISOString() : e.archived_at, removed: counts,
      });
    });
    // Remove stored files no other engagement still uses.
    let removed = 0;
    for (const f of files) {
      const { rows } = await db.query(`SELECT 1 FROM evidence WHERE sha256 = $1 LIMIT 1`, [f.sha256]);
      const path = resolve(DATA_DIR, 'evidence', f.sha256);
      if (!rows.length && existsSync(path)) {
        unlinkSync(path);
        removed++;
      }
    }
    emit('engagement:deleted', { id: e.id });
    res.json({ ok: true, removed: counts, filesRemoved: removed });
  }));
}
