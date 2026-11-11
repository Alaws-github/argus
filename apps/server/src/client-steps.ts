// v1.7.3: client steps on a use case. A use case follows one of the
// engagement's published client workflows. Each client step in it (a person,
// client step, trigger or notice in the client's own tools) can say what
// proves it was done: a record that mentions the use case key, a record with
// a given status, every record done, or a person confirming with a link.
//
// ARGUS checks the steps by reading each step's connector (read-only, the
// same guards as an evidence pull) and finding records that mention the use
// case key (AI-3). A passed check files the matching records as fingerprinted
// evidence against the use case. Checks never move the use case: the five
// governance gates are still decided by named people (rule 1). They give the
// person deciding the client's own paper trail, checked.
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { DONE_WORDS, type ClientStep, type ProofKind, type WfGraph } from '@gh/shared';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { readConnector } from './connectors.js';
import { putEvidence } from './storage.js';
import { getSettings } from './store.js';
import { emit } from './realtime.js';

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const CLIENT_TYPES = new Set(['start', 'person', 'task', 'notify']);

// ------------------------------------------------------------ reading records
type Rec = { raw: unknown; text: string; status: string | null; label: string; url: string | null };
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
function statusOf(o: any): string | null {
  return str(o?.fields?.status?.name) ?? str(o?.status?.name) ?? str(o?.state?.display_value) ?? str(o?.state) ?? str(o?.status)
    ?? str(o?.fields?.Status) ?? str(o?.fields?.ApprovalStatus) ?? str(o?.approval) ?? null;
}
function urlOf(o: any, base: URL | null): string | null {
  const u = str(o?.html_url) ?? str(o?.webUrl) ?? str(o?.web_url) ?? str(o?._links?.webui) ?? str(o?.permalink);
  if (u && /^https?:/.test(u)) return u;
  if (u && base) return new URL(u, base.origin).toString();
  if (typeof o?.self === 'string' && o?.key && /\/rest\/api\//.test(o.self)) return `${new URL(o.self).origin}/browse/${o.key}`;
  return null;
}
const labelOf = (o: any, text: string) => str(o?.key) ?? str(o?.number) ?? str(o?.iid) ?? str(o?.id) ?? str(o?.title)?.slice(0, 60) ?? str(o?.name)?.slice(0, 60) ?? text.slice(0, 60);

// Every object (or row) inside an array, anywhere in the reply: Jira issues, ServiceNow result, Graph value, GitHub issues, Sheets values.
function collect(v: unknown, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 5 || v == null) return out;
  if (Array.isArray(v)) {
    for (const x of v) { if (x && typeof x === 'object') { out.push(x); collect(x, out, depth + 1); } }
  } else if (typeof v === 'object') for (const x of Object.values(v as object)) collect(x, out, depth + 1);
  return out;
}

export function readRecords(buf: Buffer, mime: string, base: URL | null = null): Rec[] {
  const s = buf.toString('utf8');
  let json: unknown;
  if (mime.includes('json') || /^\s*[[{]/.test(s)) { try { json = JSON.parse(s); } catch { /* text */ } }
  if (json !== undefined) {
    const objs = collect(json);
    const recs = (objs.length ? objs : [json]).map((o: any) => { const text = JSON.stringify(o); return { raw: o, text, status: Array.isArray(o) ? null : statusOf(o), label: Array.isArray(o) ? o.map(String).join(' | ').slice(0, 60) : labelOf(o, text), url: Array.isArray(o) ? null : urlOf(o, base) }; });
    return recs;
  }
  // Text, CSV, a document: each line is a record.
  return s.split(/\r?\n/).filter((l) => l.trim()).map((l) => ({ raw: l, text: l, status: null, label: l.trim().slice(0, 60), url: null }));
}

const mentions = (text: string, key: string) => new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[-]/g, '\\-')}(?![0-9])`, 'i').test(text);

export function evaluateProof(recs: Rec[], key: string, proof: ProofKind, wanted: string): { status: ClientStep['status']; detail: string; matched: Rec[] } {
  // Prefer records with a status (a ticket, a request); otherwise keep the outermost matching records,
  // so a ticket and the comment inside it don't count twice.
  const hits = recs.filter((r) => mentions(r.text, key));
  const withStatus = hits.filter((r) => r.status !== null);
  const list = (withStatus.length ? withStatus : hits.filter((r) => !hits.some((o) => o !== r && o.text.length > r.text.length && o.text.includes(r.text)))).slice(0, 20);
  if (!list.length) return { status: 'failed', detail: `No record mentions ${key}`, matched: [] };
  const names = list.slice(0, 5).map((r) => `${r.label}${r.status ? ` (${r.status})` : ''}`).join(', ');
  if (proof === 'mentions') return { status: 'passed', detail: `${list.length} record${list.length === 1 ? '' : 's'} mention ${key}: ${names}`, matched: list };
  const want = wanted.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  const isWanted = (r: Rec) => (r.status ? want.includes(r.status.toLowerCase()) : want.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i').test(r.text)));
  if (proof === 'status') {
    const ok = list.filter(isWanted);
    return ok.length ? { status: 'passed', detail: `${ok.map((r) => r.label).slice(0, 5).join(', ')} ${ok.length === 1 ? 'is' : 'are'} ${wanted}`, matched: ok }
      : { status: 'pending', detail: `Found ${names}, none ${wanted} yet`, matched: list };
  }
  // all_done
  const done = (r: Rec) => (want.length ? isWanted(r) : false) || (!!r.status && DONE_WORDS.includes(r.status.toLowerCase()));
  const open = list.filter((r) => !done(r));
  return open.length ? { status: 'pending', detail: `${open.length} of ${list.length} not done: ${open.slice(0, 5).map((r) => `${r.label}${r.status ? ` (${r.status})` : ''}`).join(', ')}`, matched: list }
    : { status: 'passed', detail: `All ${list.length} done: ${names}`, matched: list };
}

// ------------------------------------------------------------------ routes
function orderSteps(g: WfGraph) {
  const start = g.nodes.find((n) => n.type === 'start');
  const seen = new Set<string>(); const order: string[] = [];
  const queue = start ? [start.id] : [];
  while (queue.length) { const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id); order.push(id); for (const e of g.edges.filter((x) => x.from === id)) queue.push(e.to); }
  for (const n of g.nodes) if (!seen.has(n.id)) order.push(n.id);
  return order.map((id) => g.nodes.find((n) => n.id === id)!).filter((n) => CLIENT_TYPES.has(n.type) && (n.config.tool || n.config.proof));
}

export function clientStepRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  const cardOf = async (id: string) => {
    const c = (await db.query(`SELECT id, key, engagement_id, workflow_id FROM cards WHERE id::text = $1 OR key = $1`, [id])).rows[0];
    if (!c) throw httpError(404, 'Use case not found');
    return c;
  };
  // The workflow a use case follows: the one chosen for it, else the engagement's most recently published.
  const followed = async (c: any) => {
    const published = (await db.query(`SELECT id, number, name, version, published_at FROM workflows WHERE engagement_id = $1 AND status = 'published' ORDER BY published_at DESC NULLS LAST`, [c.engagement_id])).rows;
    const w = published.find((x: any) => x.id === c.workflow_id) ?? published[0] ?? null;
    if (!w) return { w: null, graph: null, published };
    const v = (await db.query(`SELECT graph FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC LIMIT 1`, [w.id])).rows[0];
    return { w, graph: (v?.graph ?? null) as WfGraph | null, published };
  };
  const steps = async (c: any) => {
    const { w, graph, published } = await followed(c);
    const checks = new Map((await db.query(
      `SELECT s.*, e.number AS evidence_number FROM card_step_checks s LEFT JOIN evidence e ON e.id = s.evidence_id WHERE s.card_id = $1`, [c.id])).rows.map((x: any) => [x.node_id, x]));
    const conns = new Map((await db.query(`SELECT id, number FROM connectors WHERE engagement_id = $1`, [c.engagement_id])).rows.map((x: any) => [x.id, `CN-${x.number}`]));
    const list: ClientStep[] = (graph ? orderSteps(graph) : []).map((n) => {
      const k: any = checks.get(n.id);
      const proof = (n.config.proof ?? '') as ProofKind;
      return {
        nodeId: n.id, label: n.label, type: n.type, tool: n.config.tool ?? '', toolDetail: n.config.toolDetail ?? '', proof, proofStatus: n.config.proofStatus ?? '',
        connectorKey: n.config.connectorId ? conns.get(n.config.connectorId) ?? null : null,
        status: k?.status ?? 'not_checked', detail: k?.detail ?? (proof ? '' : 'No proof set for this step in the workflow'), record: k?.record ?? null, recordUrl: k?.record_url ?? null,
        evidenceKey: k?.evidence_number ? `E-${k.evidence_number}` : null, checkedBy: k?.checked_by ?? null, checkedAt: iso(k?.checked_at),
      };
    });
    return {
      workflow: w ? { id: w.id, key: `WF-${w.number}`, name: w.name, version: w.version } : null,
      workflows: published.map((x: any) => ({ id: x.id, key: `WF-${x.number}`, name: x.name, version: x.version })),
      chosen: !!c.workflow_id, steps: list,
      summary: { total: list.length, passed: list.filter((s) => s.status === 'passed').length, failed: list.filter((s) => s.status === 'failed').length, pending: list.filter((s) => s.status === 'pending').length },
    };
  };

  r.get('/cards/:id/client-steps', wrap(async (req, res) => res.json(await steps(await cardOf(req.params.id)))));

  r.put('/cards/:id/workflow', wrap(async (req, res) => {
    const b = z.object({ workflowId: z.string().uuid().nullable() }).parse(req.body);
    const c = await cardOf(req.params.id);
    await db.tx(async (q) => {
      let name: string | null = null;
      if (b.workflowId) {
        const w = (await q.query(`SELECT name, status FROM workflows WHERE id = $1 AND engagement_id = $2`, [b.workflowId, c.engagement_id])).rows[0];
        if (!w) throw httpError(404, 'Workflow not found in this engagement');
        if (w.status !== 'published') throw httpError(409, 'Only a published workflow can be followed');
        name = w.name;
      }
      await q.query(`UPDATE cards SET workflow_id = $2 WHERE id = $1`, [c.id, b.workflowId]);
      await logAudit(q, actorOf(req), 'card.workflow_set', `card:${c.key}`, { workflow: name ?? 'the latest published' });
    });
    res.json(await steps(await cardOf(c.id)));
  }));

  // Check every step that has a connector and a proof. Each connector is read once.
  r.post('/cards/:id/client-steps/check', wrap(async (req, res) => {
    const c = await cardOf(req.params.id);
    const { graph } = await followed(c);
    if (!graph) throw httpError(409, 'No published client workflow to check against. Publish one under Client workflows.');
    const actor = actorOf(req);
    const allowPrivate = (await getSettings(db)).connectorsAllowPrivate;
    const todo = orderSteps(graph).filter((n) => n.config.proof && n.config.proof !== 'manual' && n.config.connectorId);
    if (!todo.length) throw httpError(409, 'No step in this workflow has a proof checked through a connector');
    const reads = new Map<string, Promise<{ recs: Rec[]; row: any } | { error: string }>>();
    for (const n of todo) {
      const id = n.config.connectorId!;
      if (!reads.has(id)) reads.set(id, (async () => {
        const row = (await db.query(`SELECT * FROM connectors WHERE id = $1 AND engagement_id = $2`, [id, c.engagement_id])).rows[0];
        if (!row) return { error: 'Its connector was removed' };
        if (!row.enabled) return { error: `CN-${row.number} is switched off` };
        try { const got = await readConnector(row, allowPrivate); return { recs: readRecords(got.buf, got.mime, got.url), row }; }
        catch (e: any) { return { error: `CN-${row.number} could not be read: ${String(e?.cause?.code ?? e?.message ?? e).slice(0, 200)}` }; }
      })());
    }
    for (const n of todo) {
      const got = await reads.get(n.config.connectorId!)!;
      const out = 'error' in got ? { status: 'failed' as const, detail: got.error, matched: [] as Rec[] } : evaluateProof(got.recs, c.key, n.config.proof as ProofKind, n.config.proofStatus ?? '');
      const first = out.matched[0] ?? null;
      const prev = (await db.query(`SELECT * FROM card_step_checks WHERE card_id = $1 AND node_id = $2`, [c.id, n.id])).rows[0];
      let evidenceId: string | null = prev?.evidence_id ?? null;
      // A passed check files what proved it, once per distinct content.
      if (out.status === 'passed' && 'row' in got) {
        const body = Buffer.from(JSON.stringify(out.matched.map((m) => m.raw), null, 2));
        const sha = createHash('sha256').update(body).digest('hex');
        const same = evidenceId ? (await db.query(`SELECT 1 FROM evidence WHERE id = $1 AND sha256 = $2`, [evidenceId, sha])).rows[0] : null;
        if (!same) {
          await putEvidence(sha, body);
          evidenceId = (await db.query(
            `INSERT INTO evidence (engagement_id, title, kind, filename, mime, size, sha256, url, source, collected_by, control_id, card_id, text_content, meta)
             VALUES ($1,$2,'file',$3,'application/json',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [c.engagement_id, `${c.key}: ${n.label} (proof from CN-${got.row.number})`, `${c.key}-${n.id}-proof.json`, body.length, sha, first?.url ?? null,
              `CN-${got.row.number} client step check`, `${actor} (client step check)`, got.row.control_id, c.id, out.matched.map((m) => m.text).join('\n').slice(0, 20000),
              JSON.stringify({ clientStep: n.id, proof: n.config.proof })])).rows[0].id;
        }
      }
      await db.tx(async (q) => {
        await q.query(
          `INSERT INTO card_step_checks (card_id, node_id, status, detail, record, record_url, evidence_id, checked_by, checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
           ON CONFLICT (card_id, node_id) DO UPDATE SET status = $3, detail = $4, record = $5, record_url = $6, evidence_id = $7, checked_by = $8, checked_at = now()`,
          [c.id, n.id, out.status, out.detail.slice(0, 600), first?.label ?? null, first?.url ?? null, evidenceId, actor]);
        // Logged only when the result changes, so a re-check doesn't fill the audit log (or send the same notice again).
        if (prev?.status !== out.status || prev?.detail !== out.detail.slice(0, 600))
          await logAudit(q, actor, 'client_step.checked', `card:${c.key}`, { useCase: c.key, step: n.label, node: n.id, status: out.status, detail: out.detail.slice(0, 300), record: first?.label ?? null });
      });
    }
    emit('evidence', { engagementId: c.engagement_id });
    res.json(await steps(c));
  }));

  // A person confirms a step by hand (or a step whose proof is "a person confirms"), with a link or a note.
  r.post('/cards/:id/client-steps/:node/confirm', wrap(async (req, res) => {
    const b = z.object({ link: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Use an http or https link').optional(), note: z.string().trim().max(600).default('') }).parse(req.body);
    if (!b.link && b.note.length < 3) throw httpError(400, 'Add a link to the record, or a note saying where the proof is');
    const c = await cardOf(req.params.id);
    const { graph } = await followed(c);
    const n = graph?.nodes.find((x) => x.id === req.params.node && CLIENT_TYPES.has(x.type));
    if (!n) throw httpError(404, 'That step is not in the workflow this use case follows');
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO card_step_checks (card_id, node_id, status, detail, record, record_url, checked_by, checked_at) VALUES ($1,$2,'passed',$3,$4,$5,$6,now())
         ON CONFLICT (card_id, node_id) DO UPDATE SET status = 'passed', detail = $3, record = $4, record_url = $5, evidence_id = NULL, checked_by = $6, checked_at = now()`,
        [c.id, n.id, `Confirmed by ${actorOf(req)}${b.note ? `: ${b.note}` : ''}`, b.link ? new URL(b.link).hostname : null, b.link ?? null, actorOf(req)]);
      await logAudit(q, actorOf(req), 'client_step.confirmed', `card:${c.key}`, { useCase: c.key, step: n.label, node: n.id, link: b.link ?? null, note: b.note || null });
    });
    res.json(await steps(c));
  }));
  r.delete('/cards/:id/client-steps/:node', wrap(async (req, res) => {
    const c = await cardOf(req.params.id);
    await db.tx(async (q) => {
      const { rows } = await q.query(`DELETE FROM card_step_checks WHERE card_id = $1 AND node_id = $2 RETURNING status`, [c.id, req.params.node]);
      if (!rows[0]) throw httpError(404, 'Nothing recorded for that step');
      await logAudit(q, actorOf(req), 'client_step.cleared', `card:${c.key}`, { useCase: c.key, node: req.params.node, was: rows[0].status });
    });
    res.json(await steps(c));
  }));
}
