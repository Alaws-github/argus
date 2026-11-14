// v1.7.3: evidence pushed from CI/CD pipelines. A lead creates an ingest
// token for an engagement (Settings > Connected tools > Pipelines); a
// pipeline in GitHub Actions, GitLab CI, Bitbucket Pipelines, Azure DevOps or
// anywhere else posts eval results, fairness metrics, drift reports or an
// SBOM to POST /api/ingest/evidence with that token. Each push becomes a
// fingerprinted evidence item, audited as the token, never as a person.
//
// The token can only add evidence to its own engagement. It can't read
// anything, and it can't approve, test or change a record. Only the SHA-256 of
// the token is stored; the token itself is shown once, when it is created.
import { randomBytes } from 'node:crypto';
import express, { type Router } from 'express';
import { IngestEvidence, IngestTokenInput, type IngestToken } from '@gh/shared';
import type { Db } from '../core/db.js';
import { logAudit } from '../audit/audit.js';
import { extract } from '../core/extract.js';
import { putEvidence } from '../core/storage.js';
import { indexEvidence, scheduleEmbedding } from '../knowledge/kb.js';
import { emit } from '../core/realtime.js';
import { requestContext } from '../core/context.js';
import { type Wrap, httpError, type ActorOf } from '../core/http.js';
import { sha256, toIso } from '../core/format.js';

/** Only the token's SHA-256 is stored; the token itself is shown once. */
const hashToken = (t: string) => sha256(t);
const MAX_BYTES = 10 * 1024 * 1024;

const SELECT = `SELECT t.*, c.number AS control_number FROM ingest_tokens t LEFT JOIN controls c ON c.id = t.control_id`;
const toToken = (r: any): IngestToken => ({
  id: r.id,
  key: `IT-${r.number}`,
  name: r.name,
  hint: r.hint,
  controlId: r.control_id,
  controlKey: r.control_number ? `C-${r.control_number}` : null,
  createdBy: r.created_by,
  createdAt: toIso(r.created_at)!,
  lastUsedAt: toIso(r.last_used_at),
  uses: r.uses,
  revokedAt: toIso(r.revoked_at),
});

// Managing tokens: under /engagements/:id, so access, archive and permission rules apply as usual.
/**
 * Registers these 3 routes on the API router (each path is under /api):
 * - GET /engagements/:id/ingest-tokens
 * - POST /engagements/:id/ingest-tokens
 * - DELETE /ingest-tokens/:id
 */
export function ingestTokenRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  r.get(
    '/engagements/:id/ingest-tokens',
    wrap(async (req, res) => {
      res.json(
        (await db.query(`${SELECT} WHERE t.engagement_id = $1 ORDER BY t.number`, [req.params.id])).rows.map(toToken),
      );
    }),
  );
  r.post(
    '/engagements/:id/ingest-tokens',
    wrap(async (req, res) => {
      const b = IngestTokenInput.parse(req.body);
      const token = `argus_ing_${randomBytes(24).toString('base64url')}`;
      const row = await db.tx(async (q) => {
        const { rows } = await q.query(
          `INSERT INTO ingest_tokens (engagement_id, name, token_hash, hint, control_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [req.params.id, b.name, hashToken(token), `…${token.slice(-4)}`, b.controlId, actorOf(req)],
        );
        await logAudit(q, actorOf(req), 'ingest_token.created', `ingest_token:IT-${rows[0].number}`, { name: b.name });
        return rows[0];
      });
      const { rows } = await db.query(`${SELECT} WHERE t.id = $1`, [row.id]);
      res.status(201).json({ ...toToken(rows[0]), token }); // the only time the token is returned
    }),
  );
  r.delete(
    '/ingest-tokens/:id',
    wrap(async (req, res) => {
      await db.tx(async (q) => {
        const { rows } = await q.query(
          `UPDATE ingest_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING number, name`,
          [req.params.id],
        );
        if (!rows[0]) throw httpError(404, 'Token not found or already revoked');
        await logAudit(q, actorOf(req), 'ingest_token.revoked', `ingest_token:IT-${rows[0].number}`, {
          name: rows[0].name,
        });
      });
      res.json({ ok: true });
    }),
  );
}

type Push = ReturnType<typeof IngestEvidence.parse>;

/** The token in the Authorization header, checked: it must exist, not be revoked, and its engagement not archived. */
async function tokenFromHeader(db: Db, authorization: string | undefined) {
  const m = /^Bearer\s+(argus_ing_[\w-]{20,})$/.exec(authorization ?? '');
  if (!m) throw httpError(401, 'Send the ingest token as Authorization: Bearer argus_ing_…');
  const { rows: tk } = await db.query(
    `SELECT t.*, e.archived_at, e.paused, e.prefix FROM ingest_tokens t JOIN engagements e ON e.id = t.engagement_id WHERE t.token_hash = $1`,
    [hashToken(m[1])],
  );
  const t = tk[0];
  if (!t || t.revoked_at) throw httpError(401, 'This ingest token is not valid or was revoked');
  if (t.archived_at) throw httpError(409, 'The engagement is archived and read-only');
  return t;
}

/** The control (C-n) and use case (AI-n) the push names, within the token's engagement only. */
async function pushTargets(db: Db, eid: string, b: Push, tokenControlId: string | null) {
  let controlId: string | null = tokenControlId;
  if (b.control) {
    const c = (
      await db.query(`SELECT id FROM controls WHERE engagement_id = $1 AND number = $2`, [
        eid,
        Number(b.control.split('-')[1]),
      ])
    ).rows[0];
    if (!c) throw httpError(422, `No control ${b.control.toUpperCase()} in this engagement`);
    controlId = c.id;
  }
  let cardId: string | null = null;
  if (b.useCase) {
    const c = (
      await db.query(`SELECT id FROM cards WHERE engagement_id = $1 AND upper(key) = $2`, [
        eid,
        b.useCase.toUpperCase(),
      ])
    ).rows[0];
    if (!c) throw httpError(422, `No use case ${b.useCase.toUpperCase()} in this engagement`);
    cardId = c.id;
  }
  return { controlId, cardId };
}

/** Where the push came from, in one line: system, repository, @branch, commit and run. */
const pushOrigin = (source: Push['source']) =>
  [
    source.system,
    source.repo,
    source.branch && `@${source.branch}`,
    source.commit && source.commit.slice(0, 12),
    source.run && `run ${source.run}`,
  ]
    .filter(Boolean)
    .join(' ');

/**
 * The pushed content as a file: stored by its SHA-256 and its text read for search and for agents.
 * A push with only a link is fingerprinted by the link.
 */
async function storePushedContent(b: Push) {
  const buf = b.contentBase64
    ? Buffer.from(b.contentBase64, 'base64')
    : b.content !== undefined
      ? Buffer.from(b.content, 'utf8')
      : null;
  if (buf && buf.length > MAX_BYTES) throw httpError(413, 'The content is over 10 MB');
  if (!buf) return { buf: null, sha: sha256(b.url!), filename: null, mime: null, read: null };
  const filename = (
    b.filename ||
    `${b.kind}-${new Date().toISOString().slice(0, 10)}.${b.contentBase64 ? 'bin' : b.mime?.includes('json') || /^\s*[[{]/.test(b.content ?? '') ? 'json' : 'txt'}`
  )
    .replace(/[^\w.-]+/g, '-')
    .slice(0, 180);
  const mime =
    b.mime ||
    (filename.endsWith('.json') ? 'application/json' : filename.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
  const sha = sha256(buf);
  await putEvidence(sha, buf);
  const read: Awaited<ReturnType<typeof extract>> | null = await extract(buf, filename, mime).catch(() => null);
  return { buf, sha, filename, mime, read };
}

/** Saves the push as an evidence item and counts the token's use, audited as the pipeline (rule 31). */
async function savePushedEvidence(
  db: Db,
  t: any,
  b: Push,
  targets: { controlId: string | null; cardId: string | null },
  file: Awaited<ReturnType<typeof storePushedContent>>,
) {
  const actor = `Pipeline: ${t.name} (IT-${t.number})`;
  const where = pushOrigin(b.source);
  const meta = {
    kind: b.kind,
    source: b.source,
    metrics: b.metrics ?? null,
    useCase: b.useCase?.toUpperCase() ?? null,
  };
  const metricText = b.metrics
    ? Object.entries(b.metrics)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : '';
  return db.tx(async (q) => {
    const { rows } = await q.query(
      `INSERT INTO evidence (engagement_id, title, kind, filename, mime, size, sha256, url, note, source, collected_by, control_id, card_id, text_content, text_note, meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        t.engagement_id,
        b.title,
        file.buf ? 'file' : 'link',
        file.filename,
        file.mime,
        file.buf?.length ?? null,
        file.sha,
        b.url ?? b.source.pipelineUrl ?? null,
        metricText || null,
        `Pushed by pipeline${where ? `: ${where}` : ''}`.slice(0, 400),
        actor,
        targets.controlId,
        targets.cardId,
        [file.read?.text, metricText].filter(Boolean).join('\n\n') || null,
        file.read?.note ?? null,
        JSON.stringify(meta),
      ],
    );
    await q.query(`UPDATE ingest_tokens SET last_used_at = now(), uses = uses + 1 WHERE id = $1`, [t.id]);
    await logAudit(q, actor, 'evidence.pushed', `evidence:E-${rows[0].number}`, {
      title: b.title,
      kind: b.kind,
      sha256: file.sha,
      bytes: file.buf?.length ?? 0,
      useCase: meta.useCase,
      source: b.source,
    });
    return rows[0];
  });
}

// The push endpoint. Mounted before session sign-in: the token is the sign-in.
export function ingestRouter(db: Db) {
  const r = express.Router();
  r.post('/evidence', express.json({ limit: '15mb' }), async (req, res, next) => {
    try {
      const t = await tokenFromHeader(db, req.headers.authorization);
      const b = IngestEvidence.parse(req.body);
      const eid = t.engagement_id;
      const ctx = requestContext.getStore();
      if (ctx) ctx.engagementId = eid; // audit entries belong to the token's engagement
      const targets = await pushTargets(db, eid, b, t.control_id);
      const file = await storePushedContent(b);
      const ev = await savePushedEvidence(db, t, b, targets, file);
      await indexEvidence(db, ev).catch(() => {});
      scheduleEmbedding(db);
      emit('evidence', { engagementId: eid });
      res.status(201).json({
        evidence: `E-${ev.number}`,
        sha256: file.sha,
        control: targets.controlId ? (b.control?.toUpperCase() ?? 'from token') : null,
        useCase: b.useCase?.toUpperCase() ?? null,
      });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
