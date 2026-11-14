// The knowledge base API: browse what the agents can draw on, search it the
// way an agent does, upload the client's own documents, and set up or test
// meaning-based search.
import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { vectorAvailable, type Db } from './db.js';
import { logAudit } from './audit.js';
import { embedPending, getEmbedder, scheduleEmbedding, search, upsertSource } from './kb.js';
import { apiKeyOf, getProviderRow } from './providers.js';
import { extract, kindOf } from './extract.js';

type Wrap = (
  fn: (req: Request, res: Response) => Promise<unknown>,
) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export function kbRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  r.get(
    '/engagements/:id/knowledge',
    wrap(async (req, res) => {
      const { rows } = await db.query(
        `SELECT s.*, (SELECT count(*)::int FROM kb_chunks c WHERE c.source_id = s.id) AS chunks,
         (SELECT count(*)::int FROM kb_chunks c WHERE c.source_id = s.id AND c.embed_model IS NOT NULL) AS embedded,
         (SELECT min(number) FROM kb_chunks c WHERE c.source_id = s.id) AS first_k
       FROM kb_sources s WHERE s.engagement_id IS NULL OR s.engagement_id = $1 ORDER BY s.engagement_id NULLS LAST, s.kind, s.ref`,
        [req.params.id],
      );
      const e = await getEmbedder(db).catch(() => null);
      res.json({
        sources: rows.map((s: any) => ({
          id: s.id,
          kind: s.kind,
          title: s.title,
          ref: s.ref,
          origin: s.origin,
          shared: s.engagement_id === null,
          chunks: s.chunks,
          embedded: s.embedded,
          firstPassage: s.first_k ? `K-${s.first_k}` : null,
          createdBy: s.created_by,
          createdAt: iso(s.created_at),
        })),
        search: { keyword: true, meaning: !!e, vectorAvailable },
      });
    }),
  );

  r.get(
    '/engagements/:id/knowledge/search',
    wrap(async (req, res) => {
      const q = z.string().trim().min(2).max(500).parse(req.query.q);
      res.json(await search(db, req.params.id, q, { limit: 8 }));
    }),
  );

  r.get(
    '/knowledge/passages/:kid',
    wrap(async (req, res) => {
      const n = Number(String(req.params.kid).replace(/^K-/, ''));
      const { rows } = await db.query(
        `SELECT c.number, c.heading, c.text, s.kind, s.ref, s.title FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id WHERE c.number = $1`,
        [n],
      );
      if (!rows[0]) throw httpError(404, 'Passage not found');
      res.json({
        id: `K-${rows[0].number}`,
        title: rows[0].heading,
        kind: rows[0].kind,
        ref: rows[0].ref,
        text: rows[0].text,
      });
    }),
  );

  // Client documents: policies, procedures, minutes. PDF, Word, Excel or text.
  r.post(
    '/engagements/:id/knowledge',
    wrap(async (req, res) => {
      const b = z
        .object({
          title: z.string().trim().min(3).max(200),
          text: z.string().max(400_000).optional(),
          filename: z.string().max(200).optional(),
          dataBase64: z.string().max(14_000_000).optional(),
        })
        .parse(req.body);
      let text = b.text ?? '';
      if (!text && b.dataBase64) {
        if (!kindOf(b.filename ?? ''))
          throw httpError(400, 'Upload a PDF, Word (.docx), Excel (.xlsx), text, Markdown or CSV file');
        const got = await extract(Buffer.from(b.dataBase64, 'base64'), b.filename);
        text = got?.text ?? '';
        if (!text.trim()) throw httpError(400, got?.note ?? 'Nothing readable in that file');
      }
      if (text.trim().length < 20) throw httpError(400, 'Add the document text (at least a sentence)');
      const ref = `U-${Date.now().toString(36)}`;
      const out = await db.tx(async (q) => {
        const r0 = await upsertSource(q, {
          engagementId: req.params.id,
          kind: 'upload',
          title: b.title,
          ref,
          text,
          origin: 'upload',
          createdBy: actorOf(req),
        });
        await logAudit(q, actorOf(req), 'knowledge.added', `knowledge:${b.title}`, {
          chunks: r0.chunks,
          chars: text.length,
        });
        return r0;
      });
      scheduleEmbedding(db);
      res.status(201).json(out);
    }),
  );

  r.delete(
    '/knowledge/:id',
    wrap(async (req, res) => {
      const { rows } = await db.query(`SELECT * FROM kb_sources WHERE id = $1`, [req.params.id]);
      if (!rows[0]) throw httpError(404, 'Source not found');
      if (rows[0].kind !== 'upload')
        throw httpError(
          409,
          'Only uploaded documents can be removed. Other sources follow the records they come from.',
        );
      await db.tx(async (q) => {
        await q.query(`DELETE FROM kb_sources WHERE id = $1`, [rows[0].id]);
        await logAudit(q, actorOf(req), 'knowledge.removed', `knowledge:${rows[0].title}`, {});
      });
      res.json({ ok: true });
    }),
  );

  // Embed everything that isn't embedded with the current model.
  r.post(
    '/knowledge/reindex',
    wrap(async (req, res) => {
      const out = await embedPending(db);
      await logAudit(db, actorOf(req), 'knowledge.reindexed', 'knowledge:all', out);
      res.json(out);
    }),
  );

  // Try an embedding provider and model before saving it as the default.
  r.post(
    '/knowledge/embeddings/test',
    wrap(async (req, res) => {
      const b = z.object({ providerId: z.string().uuid(), model: z.string().trim().min(1).max(120) }).parse(req.body);
      const p = await getProviderRow(db, b.providerId);
      if (!p) throw httpError(404, 'Provider not found');
      if (p.type === 'rules' || p.type === 'anthropic')
        throw httpError(
          400,
          `${p.name} doesn't offer embeddings. Use an OpenAI-compatible provider (OpenAI, Voyage, local Ollama or LM Studio) or Ollama.`,
        );
      const key = apiKeyOf(p);
      const base = p.base_url.replace(/\/+$/, '');
      const native = p.type === 'ollama';
      const t0 = Date.now();
      const r0 = await fetch(native ? `${base}/api/embed` : `${base}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: b.model, input: ['human oversight of AI decisions'] }),
        signal: AbortSignal.timeout(30_000),
      }).catch((e) => {
        throw httpError(502, `Couldn't reach ${p.name}: ${e.message}`);
      });
      if (!r0.ok) throw httpError(502, `${p.name} answered ${r0.status}: ${(await r0.text()).slice(0, 200)}`);
      const j: any = await r0.json();
      const v = native ? j.embeddings?.[0] : j.data?.[0]?.embedding;
      if (!Array.isArray(v)) throw httpError(502, `${p.name} didn't return an embedding for ${b.model}`);
      res.json({ ok: true, dims: v.length, ms: Date.now() - t0 });
    }),
  );
}
