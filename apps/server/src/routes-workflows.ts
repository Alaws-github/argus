// Client workflows API (v1.7). Leads draw the client's process around ARGUS's
// governance gates; the server checks the shape on every save (the gates can't
// be removed) and the full rules before a publish (no way round a gate, gates
// in order, a person decides after every agent step). Every save, publish,
// restore and retirement is in the audit log; each publish keeps a version.
import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { NewWorkflow, SaveWorkflow, WF_LOCKED, validateWorkflow, workflowTemplate, type WfGraph, type Workflow, type WorkflowVersion } from '@gh/shared';
import type { Db } from './db.js';
import { logAudit } from './audit.js';

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => unknown;
const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, ...extra });
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export const toWorkflow = (r: any): Workflow => ({
  id: r.id, key: `WF-${r.number}`, name: r.name, description: r.description, status: r.status, version: r.version, graph: r.graph,
  changedSincePublish: r.changed_since_publish, updatedBy: r.updated_by, updatedAt: iso(r.updated_at)!, publishedBy: r.published_by, publishedAt: iso(r.published_at),
});

// Shape checks on every save: the governance gates and the trigger stay.
function lockedMissing(g: WfGraph): string[] {
  const ids = new Set(g.nodes.map((n) => n.id));
  return [...WF_LOCKED].filter((id) => !ids.has(id));
}

export function workflowRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  const load = async (id: string) => {
    const { rows } = await db.query(`SELECT * FROM workflows WHERE id::text = $1`, [id]);
    if (!rows[0]) throw httpError(404, 'Workflow not found');
    return rows[0];
  };

  r.get('/engagements/:id/workflows', wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT * FROM workflows WHERE engagement_id = $1 ORDER BY number`, [req.params.id]);
    res.json(rows.map((w: any) => ({ ...toWorkflow(w), problems: validateWorkflow(w.graph).problems.length })));
  }));

  r.post('/engagements/:id/workflows', wrap(async (req, res) => {
    const b = NewWorkflow.parse(req.body);
    const actor = actorOf(req);
    const w = await db.tx(async (q) => {
      const { rows } = await q.query(`INSERT INTO workflows (engagement_id, name, description, graph, updated_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.params.id, b.name, b.description, JSON.stringify(workflowTemplate(b.template)), actor]);
      await logAudit(q, actor, 'workflow.created', `workflow:WF-${rows[0].number}`, { name: b.name, template: b.template });
      return rows[0];
    });
    res.status(201).json(toWorkflow(w));
  }));

  r.get('/workflows/:wid', wrap(async (req, res) => {
    const w = await load(req.params.wid);
    const { rows } = await db.query(`SELECT version, name, note, published_by, published_at, jsonb_array_length(graph->'nodes') AS nodes FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC`, [w.id]);
    const versions: WorkflowVersion[] = rows.map((v: any) => ({ version: v.version, name: v.name, note: v.note, publishedBy: v.published_by, publishedAt: iso(v.published_at)!, nodes: Number(v.nodes) }));
    res.json({ workflow: toWorkflow(w), versions, check: validateWorkflow(w.graph) });
  }));

  r.get('/workflows/:wid/versions/:v', wrap(async (req, res) => {
    const w = await load(req.params.wid);
    const { rows } = await db.query(`SELECT * FROM workflow_versions WHERE workflow_id = $1 AND version = $2`, [w.id, Number(req.params.v)]);
    if (!rows[0]) throw httpError(404, 'Version not found');
    res.json({ version: rows[0].version, name: rows[0].name, graph: rows[0].graph, note: rows[0].note, publishedBy: rows[0].published_by, publishedAt: iso(rows[0].published_at) });
  }));

  // Save the draft. A drawing with problems can be saved (it's a draft); one
  // without its governance gates can't, so they can never be deleted.
  r.patch('/workflows/:wid', wrap(async (req, res) => {
    const b = SaveWorkflow.parse(req.body);
    const w = await load(req.params.wid);
    if (w.status === 'retired') throw httpError(409, 'This workflow is retired. Restore a version to work on it again');
    if (b.graph) {
      const gone = lockedMissing(b.graph);
      if (gone.length) throw httpError(409, `The governance steps can't be removed (${gone.join(', ')})`);
    }
    const actor = actorOf(req);
    const next = await db.tx(async (q) => {
      const { rows } = await q.query(
        `UPDATE workflows SET name = coalesce($2, name), description = coalesce($3, description), graph = coalesce($4::jsonb, graph), changed_since_publish = true, updated_by = $5, updated_at = now() WHERE id = $1 RETURNING *`,
        [w.id, b.name ?? null, b.description ?? null, b.graph ? JSON.stringify(b.graph) : null, actor]);
      await logAudit(q, actor, 'workflow.saved', `workflow:WF-${w.number}`, {
        ...(b.name && b.name !== w.name ? { name: { from: w.name, to: b.name } } : {}),
        ...(b.graph ? { steps: b.graph.nodes.length, arrows: b.graph.edges.length } : {}),
      });
      return rows[0];
    });
    res.json({ workflow: toWorkflow(next), check: validateWorkflow(next.graph) });
  }));

  // Publish: only a workflow that passes every rule. Keeps a numbered copy.
  r.post('/workflows/:wid/publish', wrap(async (req, res) => {
    const b = z.object({ note: z.string().trim().max(300).default('') }).parse(req.body ?? {});
    const w = await load(req.params.wid);
    const check = validateWorkflow(w.graph);
    if (check.problems.length) throw httpError(409, `Fix ${check.problems.length} problem${check.problems.length === 1 ? '' : 's'} before publishing: ${check.problems.slice(0, 3).join('; ')}`, { problems: check.problems });
    if (w.status === 'published' && !w.changed_since_publish) throw httpError(409, 'Nothing has changed since the last publish');
    const actor = actorOf(req);
    const next = await db.tx(async (q) => {
      const v = w.version + 1;
      await q.query(`INSERT INTO workflow_versions (workflow_id, version, name, graph, note, published_by) VALUES ($1,$2,$3,$4,$5,$6)`, [w.id, v, w.name, JSON.stringify(w.graph), b.note, actor]);
      const { rows } = await q.query(`UPDATE workflows SET status = 'published', version = $2, changed_since_publish = false, published_by = $3, published_at = now() WHERE id = $1 RETURNING *`, [w.id, v, actor]);
      await logAudit(q, actor, 'workflow.published', `workflow:WF-${w.number}`, { version: v, note: b.note, steps: w.graph.nodes.length });
      return rows[0];
    });
    res.json({ workflow: toWorkflow(next), check });
  }));

  // Bring a published version back as the draft (the current draft is replaced; the versions stay).
  r.post('/workflows/:wid/restore', wrap(async (req, res) => {
    const b = z.object({ version: z.number().int().min(1) }).parse(req.body);
    const w = await load(req.params.wid);
    const { rows: vr } = await db.query(`SELECT * FROM workflow_versions WHERE workflow_id = $1 AND version = $2`, [w.id, b.version]);
    if (!vr[0]) throw httpError(404, 'Version not found');
    const actor = actorOf(req);
    const next = await db.tx(async (q) => {
      const { rows } = await q.query(`UPDATE workflows SET graph = $2, name = $3, status = CASE WHEN status = 'retired' THEN 'draft' ELSE status END, changed_since_publish = true, updated_by = $4, updated_at = now() WHERE id = $1 RETURNING *`,
        [w.id, JSON.stringify(vr[0].graph), vr[0].name, actor]);
      await logAudit(q, actor, 'workflow.restored', `workflow:WF-${w.number}`, { version: b.version });
      return rows[0];
    });
    res.json({ workflow: toWorkflow(next), check: validateWorkflow(next.graph) });
  }));

  r.post('/workflows/:wid/retire', wrap(async (req, res) => {
    const w = await load(req.params.wid);
    const actor = actorOf(req);
    const next = await db.tx(async (q) => {
      const { rows } = await q.query(`UPDATE workflows SET status = 'retired', updated_by = $2, updated_at = now() WHERE id = $1 RETURNING *`, [w.id, actor]);
      await logAudit(q, actor, 'workflow.retired', `workflow:WF-${w.number}`, { version: w.version });
      return rows[0];
    });
    res.json({ workflow: toWorkflow(next) });
  }));
}
