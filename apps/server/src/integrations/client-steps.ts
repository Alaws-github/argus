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
import type { Request, Router } from 'express';
import { z } from 'zod';
import { DONE_WORDS, type ClientStep, type ProofKind, type WfGraph } from '@gh/shared';
import type { Db, Queryable } from '../core/db.js';
import { logAudit } from '../audit/audit.js';
import { readConnector } from './connectors.js';
import { putEvidence } from '../core/storage.js';
import { getSettings } from '../settings/settings-store.js';
import { emit } from '../core/realtime.js';
import { type Wrap, httpError } from '../core/http.js';
import { toIso } from '../core/format.js';

const CLIENT_TYPES = new Set(['start', 'person', 'task', 'notify']);

// ------------------------------------------------------------ reading records
type Rec = { raw: unknown; text: string; status: string | null; label: string; url: string | null };
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
function statusOf(o: any): string | null {
  return (
    str(o?.fields?.status?.name) ??
    str(o?.status?.name) ??
    str(o?.state?.display_value) ??
    str(o?.state) ??
    str(o?.status) ??
    str(o?.fields?.Status) ??
    str(o?.fields?.ApprovalStatus) ??
    str(o?.approval) ??
    null
  );
}
function urlOf(o: any, base: URL | null): string | null {
  const u = str(o?.html_url) ?? str(o?.webUrl) ?? str(o?.web_url) ?? str(o?._links?.webui) ?? str(o?.permalink);
  if (u && /^https?:/.test(u)) return u;
  if (u && base) return new URL(u, base.origin).toString();
  if (typeof o?.self === 'string' && o?.key && /\/rest\/api\//.test(o.self))
    return `${new URL(o.self).origin}/browse/${o.key}`;
  return null;
}
const labelOf = (o: any, text: string) =>
  str(o?.key) ??
  str(o?.number) ??
  str(o?.iid) ??
  str(o?.id) ??
  str(o?.title)?.slice(0, 60) ??
  str(o?.name)?.slice(0, 60) ??
  text.slice(0, 60);

// Every object (or row) inside an array, anywhere in the reply: Jira issues, ServiceNow result, Graph value, GitHub issues, Sheets values.
function collect(v: unknown, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 5 || v == null) return out;
  if (Array.isArray(v)) {
    for (const x of v) {
      if (x && typeof x === 'object') {
        out.push(x);
        collect(x, out, depth + 1);
      }
    }
  } else if (typeof v === 'object') for (const x of Object.values(v as object)) collect(x, out, depth + 1);
  return out;
}

export function readRecords(buf: Buffer, mime: string, base: URL | null = null): Rec[] {
  const s = buf.toString('utf8');
  let json: unknown;
  if (mime.includes('json') || /^\s*[[{]/.test(s)) {
    try {
      json = JSON.parse(s);
    } catch {
      /* text */
    }
  }
  if (json !== undefined) {
    const objs = collect(json);
    const recs = (objs.length ? objs : [json]).map((o: any) => {
      const text = JSON.stringify(o);
      return {
        raw: o,
        text,
        status: Array.isArray(o) ? null : statusOf(o),
        label: Array.isArray(o) ? o.map(String).join(' | ').slice(0, 60) : labelOf(o, text),
        url: Array.isArray(o) ? null : urlOf(o, base),
      };
    });
    return recs;
  }
  // Text, CSV, a document: each line is a record.
  return s
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => ({ raw: l, text: l, status: null, label: l.trim().slice(0, 60), url: null }));
}

const mentions = (text: string, key: string) =>
  new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[-]/g, '\\-')}(?![0-9])`, 'i').test(text);

export function evaluateProof(
  recs: Rec[],
  key: string,
  proof: ProofKind,
  wanted: string,
): { status: ClientStep['status']; detail: string; matched: Rec[] } {
  // Prefer records with a status (a ticket, a request); otherwise keep the outermost matching records,
  // so a ticket and the comment inside it don't count twice.
  const hits = recs.filter((r) => mentions(r.text, key));
  const withStatus = hits.filter((r) => r.status !== null);
  const list = (
    withStatus.length
      ? withStatus
      : hits.filter((r) => !hits.some((o) => o !== r && o.text.length > r.text.length && o.text.includes(r.text)))
  ).slice(0, 20);
  if (!list.length) return { status: 'failed', detail: `No record mentions ${key}`, matched: [] };
  const names = list
    .slice(0, 5)
    .map((r) => `${r.label}${r.status ? ` (${r.status})` : ''}`)
    .join(', ');
  if (proof === 'mentions')
    return {
      status: 'passed',
      detail: `${list.length} record${list.length === 1 ? '' : 's'} mention ${key}: ${names}`,
      matched: list,
    };
  const want = wanted
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const isWanted = (r: Rec) =>
    r.status
      ? want.includes(r.status.toLowerCase())
      : want.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i').test(r.text));
  if (proof === 'status') {
    const ok = list.filter(isWanted);
    return ok.length
      ? {
          status: 'passed',
          detail: `${ok
            .map((r) => r.label)
            .slice(0, 5)
            .join(', ')} ${ok.length === 1 ? 'is' : 'are'} ${wanted}`,
          matched: ok,
        }
      : { status: 'pending', detail: `Found ${names}, none ${wanted} yet`, matched: list };
  }
  // all_done
  const done = (r: Rec) =>
    (want.length ? isWanted(r) : false) || (!!r.status && DONE_WORDS.includes(r.status.toLowerCase()));
  const open = list.filter((r) => !done(r));
  return open.length
    ? {
        status: 'pending',
        detail: `${open.length} of ${list.length} not done: ${open
          .slice(0, 5)
          .map((r) => `${r.label}${r.status ? ` (${r.status})` : ''}`)
          .join(', ')}`,
        matched: list,
      }
    : { status: 'passed', detail: `All ${list.length} done: ${names}`, matched: list };
}

// ------------------------------------------------------------------ routes
function orderSteps(g: WfGraph) {
  const start = g.nodes.find((n) => n.type === 'start');
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const e of g.edges.filter((x) => x.from === id)) queue.push(e.to);
  }
  for (const n of g.nodes) if (!seen.has(n.id)) order.push(n.id);
  return order
    .map((id) => g.nodes.find((n) => n.id === id)!)
    .filter((n) => CLIENT_TYPES.has(n.type) && (n.config.tool || n.config.proof));
}

export type WorkflowMode = 'auto' | 'none' | 'pinned';
// The workflow a use case follows (v1.7.4):
// - pinned: the one chosen for it (if still published);
// - none: no client workflow, so no client steps;
// - auto: the engagement default, which is the most recently published workflow, or none if the engagement says so.
export async function followedWorkflow(
  q: Queryable,
  c: { id: string; engagement_id: string; workflow_id: string | null; workflow_mode?: string | null },
) {
  const published = (
    await q.query(
      `SELECT id, number, name, version, published_at FROM workflows WHERE engagement_id = $1 AND status = 'published' ORDER BY published_at DESC NULLS LAST`,
      [c.engagement_id],
    )
  ).rows;
  const eng = (await q.query(`SELECT client_steps_default FROM engagements WHERE id = $1`, [c.engagement_id])).rows[0];
  const mode = (c.workflow_mode ?? 'auto') as WorkflowMode;
  const defaultOn = eng?.client_steps_default !== false;
  const off = mode === 'none' || (mode === 'auto' && !defaultOn);
  const w = off
    ? null
    : ((mode === 'pinned' ? published.find((x: any) => x.id === c.workflow_id) : null) ?? published[0] ?? null);
  if (!w) return { w: null, graph: null as WfGraph | null, requireSteps: false, published, mode, off, defaultOn };
  const v = (
    await q.query(
      `SELECT graph, require_steps FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC LIMIT 1`,
      [w.id],
    )
  ).rows[0];
  return {
    w,
    graph: (v?.graph ?? null) as WfGraph | null,
    requireSteps: !!v?.require_steps,
    published,
    mode,
    off,
    defaultOn,
  };
}

// Steps a person or a check tracks: those with a proof. Steps without one are shown as context only.
export const trackedSteps = (g: WfGraph) => orderSteps(g).filter((n) => n.config.proof);

// For the sign-off exit criterion: tracked client steps not done yet, when the followed workflow requires them.
export async function stepsBlockingSignOff(q: Queryable, cardId: string): Promise<string[]> {
  const c = (await q.query(`SELECT id, engagement_id, workflow_id, workflow_mode FROM cards WHERE id = $1`, [cardId]))
    .rows[0];
  if (!c) return [];
  const f = await followedWorkflow(q, c);
  if (!f.graph || !f.requireSteps) return [];
  const done = new Set(
    (await q.query(`SELECT node_id FROM card_step_checks WHERE card_id = $1 AND status = 'passed'`, [c.id])).rows.map(
      (x: any) => x.node_id,
    ),
  );
  return trackedSteps(f.graph)
    .filter((n) => !done.has(n.id))
    .map((n) => n.label);
}

export function clientStepRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  const cardOf = async (id: string) => {
    const c = (
      await db.query(
        `SELECT id, key, engagement_id, workflow_id, workflow_mode FROM cards WHERE id::text = $1 OR key = $1`,
        [id],
      )
    ).rows[0];
    if (!c) throw httpError(404, 'Use case not found');
    return c;
  };
  const followed = (c: any) => followedWorkflow(db, c);
  const steps = async (c: any) => {
    const { w, graph, published, mode, off, defaultOn, requireSteps } = await followed(c);
    const checks = new Map(
      (
        await db.query(
          `SELECT s.*, e.number AS evidence_number FROM card_step_checks s LEFT JOIN evidence e ON e.id = s.evidence_id WHERE s.card_id = $1`,
          [c.id],
        )
      ).rows.map((x: any) => [x.node_id, x]),
    );
    const conns = new Map(
      (await db.query(`SELECT id, number FROM connectors WHERE engagement_id = $1`, [c.engagement_id])).rows.map(
        (x: any) => [x.id, `CN-${x.number}`],
      ),
    );
    const list: ClientStep[] = (graph ? orderSteps(graph) : []).map((n) => {
      const k: any = checks.get(n.id);
      const proof = (n.config.proof ?? '') as ProofKind;
      return {
        nodeId: n.id,
        label: n.label,
        type: n.type,
        tool: n.config.tool ?? '',
        toolDetail: n.config.toolDetail ?? '',
        proof,
        proofStatus: n.config.proofStatus ?? '',
        connectorKey: n.config.connectorId ? (conns.get(n.config.connectorId) ?? null) : null,
        status: k?.status ?? 'not_checked',
        detail: k?.detail ?? '',
        record: k?.record ?? null,
        recordUrl: k?.record_url ?? null,
        evidenceKey: k?.evidence_number ? `E-${k.evidence_number}` : null,
        checkedBy: k?.checked_by ?? null,
        checkedAt: toIso(k?.checked_at),
      };
    });
    return {
      workflow: w ? { id: w.id, key: `WF-${w.number}`, name: w.name, version: w.version } : null,
      workflows: published.map((x: any) => ({ id: x.id, key: `WF-${x.number}`, name: x.name, version: x.version })),
      chosen: mode === 'pinned',
      mode,
      off,
      defaultOn,
      requireSteps,
      steps: list,
      summary: (() => {
        const t = list.filter((s) => s.proof);
        return {
          total: t.length,
          passed: t.filter((s) => s.status === 'passed').length,
          failed: t.filter((s) => s.status === 'failed').length,
          pending: t.filter((s) => s.status === 'pending').length,
        };
      })(),
    };
  };

  r.get(
    '/cards/:id/client-steps',
    wrap(async (req, res) => res.json(await steps(await cardOf(req.params.id)))),
  );

  r.put(
    '/cards/:id/workflow',
    wrap(async (req, res) => {
      const b0 = z
        .object({
          mode: z.enum(['auto', 'none', 'pinned']).optional(),
          workflowId: z.string().uuid().nullable().optional(),
        })
        .parse(req.body);
      const b = { mode: b0.mode ?? (b0.workflowId ? 'pinned' : 'auto'), workflowId: b0.workflowId ?? null };
      if (b.mode === 'pinned' && !b.workflowId) throw httpError(400, 'Pick the workflow to follow');
      if (b.mode !== 'pinned') b.workflowId = null;
      const c = await cardOf(req.params.id);
      await db.tx(async (q) => {
        let name: string | null = null;
        if (b.workflowId) {
          const w = (
            await q.query(`SELECT name, status FROM workflows WHERE id = $1 AND engagement_id = $2`, [
              b.workflowId,
              c.engagement_id,
            ])
          ).rows[0];
          if (!w) throw httpError(404, 'Workflow not found in this engagement');
          if (w.status !== 'published') throw httpError(409, 'Only a published workflow can be followed');
          name = w.name;
        }
        await q.query(`UPDATE cards SET workflow_id = $2, workflow_mode = $3 WHERE id = $1`, [
          c.id,
          b.workflowId,
          b.mode,
        ]);
        await logAudit(q, actorOf(req), 'card.workflow_set', `card:${c.key}`, {
          workflow: b.mode === 'none' ? 'no client workflow' : (name ?? 'the engagement default'),
        });
      });
      res.json(await steps(await cardOf(c.id)));
    }),
  );

  r.post(
    '/cards/:id/client-steps/check',
    wrap(async (req, res) => {
      const c = await cardOf(req.params.id);
      await checkCard(db, c, actorOf(req), true);
      emit('evidence', { engagementId: c.engagement_id });
      res.json(await steps(c));
    }),
  );

  // A person confirms a step by hand (or a step whose proof is "a person confirms"), with a link or a note.
  r.post(
    '/cards/:id/client-steps/:node/confirm',
    wrap(async (req, res) => {
      const b = z
        .object({
          link: z
            .string()
            .url()
            .max(2000)
            .refine((u) => /^https?:\/\//i.test(u), 'Use an http or https link')
            .optional(),
          note: z.string().trim().max(600).default(''),
        })
        .parse(req.body);
      if (!b.link && b.note.length < 3)
        throw httpError(400, 'Add a link to the record, or a note saying where the proof is');
      const c = await cardOf(req.params.id);
      const { graph } = await followed(c);
      const n = graph?.nodes.find((x) => x.id === req.params.node && CLIENT_TYPES.has(x.type));
      if (!n) throw httpError(404, 'That step is not in the workflow this use case follows');
      if (n.config.proof !== 'manual')
        throw httpError(
          409,
          n.config.proof
            ? 'This step is checked through its connector. Use Check now.'
            : 'This step isn\'t tracked. Set its proof to "A person confirms it" in the workflow to confirm it here.',
        );
      await db.tx(async (q) => {
        await q.query(
          `INSERT INTO card_step_checks (card_id, node_id, status, detail, record, record_url, checked_by, checked_at) VALUES ($1,$2,'passed',$3,$4,$5,$6,now())
         ON CONFLICT (card_id, node_id) DO UPDATE SET status = 'passed', detail = $3, record = $4, record_url = $5, evidence_id = NULL, checked_by = $6, checked_at = now()`,
          [
            c.id,
            n.id,
            `Confirmed by ${actorOf(req)}${b.note ? `: ${b.note}` : ''}`,
            b.link ? new URL(b.link).hostname : null,
            b.link ?? null,
            actorOf(req),
          ],
        );
        await logAudit(q, actorOf(req), 'client_step.confirmed', `card:${c.key}`, {
          useCase: c.key,
          step: n.label,
          node: n.id,
          link: b.link ?? null,
          note: b.note || null,
        });
      });
      res.json(await steps(c));
    }),
  );
  r.delete(
    '/cards/:id/client-steps/:node',
    wrap(async (req, res) => {
      const c = await cardOf(req.params.id);
      await db.tx(async (q) => {
        const { rows } = await q.query(
          `DELETE FROM card_step_checks WHERE card_id = $1 AND node_id = $2 RETURNING status`,
          [c.id, req.params.node],
        );
        if (!rows[0]) throw httpError(404, 'Nothing recorded for that step');
        await logAudit(q, actorOf(req), 'client_step.cleared', `card:${c.key}`, {
          useCase: c.key,
          node: req.params.node,
          was: rows[0].status,
        });
      });
      res.json(await steps(c));
    }),
  );
}

// Check every step of a use case that has a connector and a proof. Each connector is read once.
// strict: refuse (409) when there's nothing to check; the schedule passes false and just skips.
export async function checkCard(db: Db, c: any, actor: string, strict: boolean) {
  const { graph, off } = await followedWorkflow(db, c);
  if (!graph) {
    if (!strict) return;
    throw httpError(
      409,
      off
        ? 'This use case follows no client workflow'
        : 'No published client workflow to check against. Publish one under Client workflows.',
    );
  }
  const allowPrivate = (await getSettings(db)).connectorsAllowPrivate;
  const todo = orderSteps(graph).filter((n) => n.config.proof && n.config.proof !== 'manual' && n.config.connectorId);
  if (!todo.length) {
    if (!strict) return;
    throw httpError(409, 'No step in this workflow has a proof checked through a connector');
  }
  const reads = new Map<string, Promise<{ recs: Rec[]; row: any } | { error: string }>>();
  for (const n of todo) {
    const id = n.config.connectorId!;
    if (!reads.has(id))
      reads.set(
        id,
        (async () => {
          const row = (
            await db.query(`SELECT * FROM connectors WHERE id = $1 AND engagement_id = $2`, [id, c.engagement_id])
          ).rows[0];
          if (!row) return { error: 'Its connector was removed' };
          if (!row.enabled) return { error: `CN-${row.number} is switched off` };
          try {
            const got = await readConnector(row, allowPrivate);
            return { recs: readRecords(got.buf, got.mime, got.url), row };
          } catch (e: any) {
            return {
              error: `CN-${row.number} could not be read: ${String(e?.cause?.code ?? e?.message ?? e).slice(0, 200)}`,
            };
          }
        })(),
      );
  }
  for (const n of todo) {
    const got = await reads.get(n.config.connectorId!)!;
    const out =
      'error' in got
        ? { status: 'failed' as const, detail: got.error, matched: [] as Rec[] }
        : evaluateProof(got.recs, c.key, n.config.proof as ProofKind, n.config.proofStatus ?? '');
    const first = out.matched[0] ?? null;
    const prev = (await db.query(`SELECT * FROM card_step_checks WHERE card_id = $1 AND node_id = $2`, [c.id, n.id]))
      .rows[0];
    let evidenceId: string | null = prev?.evidence_id ?? null;
    // A passed check files what proved it, once per distinct content.
    if (out.status === 'passed' && 'row' in got) {
      const body = Buffer.from(
        JSON.stringify(
          out.matched.map((m) => m.raw),
          null,
          2,
        ),
      );
      const sha = createHash('sha256').update(body).digest('hex');
      const same = evidenceId
        ? (await db.query(`SELECT 1 FROM evidence WHERE id = $1 AND sha256 = $2`, [evidenceId, sha])).rows[0]
        : null;
      if (!same) {
        await putEvidence(sha, body);
        evidenceId = (
          await db.query(
            `INSERT INTO evidence (engagement_id, title, kind, filename, mime, size, sha256, url, source, collected_by, control_id, card_id, text_content, meta)
             VALUES ($1,$2,'file',$3,'application/json',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [
              c.engagement_id,
              `${c.key}: ${n.label} (proof from CN-${got.row.number})`,
              `${c.key}-${n.id}-proof.json`,
              body.length,
              sha,
              first?.url ?? null,
              `CN-${got.row.number} client step check`,
              `${actor} (client step check)`,
              got.row.control_id,
              c.id,
              out.matched
                .map((m) => m.text)
                .join('\n')
                .slice(0, 20000),
              JSON.stringify({ clientStep: n.id, proof: n.config.proof }),
            ],
          )
        ).rows[0].id;
      }
    }
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO card_step_checks (card_id, node_id, status, detail, record, record_url, evidence_id, checked_by, checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
           ON CONFLICT (card_id, node_id) DO UPDATE SET status = $3, detail = $4, record = $5, record_url = $6, evidence_id = $7, checked_by = $8, checked_at = now()`,
        [c.id, n.id, out.status, out.detail.slice(0, 600), first?.label ?? null, first?.url ?? null, evidenceId, actor],
      );
      // Logged only when the result changes, so a re-check doesn't fill the audit log (or send the same notice again).
      if (prev?.status !== out.status || prev?.detail !== out.detail.slice(0, 600))
        await logAudit(q, actor, 'client_step.checked', `card:${c.key}`, {
          useCase: c.key,
          step: n.label,
          node: n.id,
          status: out.status,
          detail: out.detail.slice(0, 300),
          record: first?.label ?? null,
        });
    });
  }
}

// v1.7.4: scheduled checks. A step is due when its connector pulls daily or weekly and the use case
// hasn't been checked for that step within the period. Archived, paused and closed use cases are skipped.
export async function checkDueSteps(db: Db, limit = 20) {
  const { rows: cards } = await db.query(
    `SELECT c.id, c.key, c.engagement_id, c.workflow_id, c.workflow_mode FROM cards c JOIN engagements e ON e.id = c.engagement_id
     WHERE e.archived_at IS NULL AND NOT e.paused AND c.stage <> 'closed' AND c.workflow_mode <> 'none'
       AND EXISTS (SELECT 1 FROM workflows w WHERE w.engagement_id = c.engagement_id AND w.status = 'published')`,
  );
  let done = 0;
  for (const c of cards) {
    if (done >= limit) break;
    const f = await followedWorkflow(db, c);
    if (!f.graph) continue;
    const ids = [
      ...new Set(
        orderSteps(f.graph)
          .filter((n) => n.config.proof && n.config.proof !== 'manual' && n.config.connectorId)
          .map((n) => n.config.connectorId!),
      ),
    ];
    if (!ids.length) continue;
    const conns = (
      await db.query(`SELECT id, schedule FROM connectors WHERE id = ANY($1) AND enabled AND schedule <> 'manual'`, [
        ids,
      ])
    ).rows;
    if (!conns.length) continue;
    const period = (id: string) => (conns.find((x: any) => x.id === id)?.schedule === 'weekly' ? 7 : 1) * 864e5;
    const last = new Map(
      (await db.query(`SELECT node_id, checked_at FROM card_step_checks WHERE card_id = $1`, [c.id])).rows.map(
        (x: any) => [x.node_id, new Date(x.checked_at).getTime()],
      ),
    );
    const due = orderSteps(f.graph).some(
      (n) =>
        n.config.connectorId &&
        conns.some((x: any) => x.id === n.config.connectorId) &&
        n.config.proof &&
        n.config.proof !== 'manual' &&
        Date.now() - (last.get(n.id) ?? 0) >= period(n.config.connectorId),
    );
    if (!due) continue;
    await checkCard(db, c, 'Client step schedule', false).catch((e) =>
      console.warn(`[client steps] ${c.key}: ${e.message}`),
    );
    done++;
  }
}
