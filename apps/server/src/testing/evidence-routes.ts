// Evidence: list, upload, verify the hash and download.
import { type Router } from 'express';
import { z } from 'zod';
import { toEvidence } from './test-records.js';
import { logAudit } from '../audit/audit.js';
import { sha256 } from '../core/format.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { extract } from '../core/extract.js';
import { indexEvidence, scheduleEmbedding } from '../knowledge/kb.js';
import { getEvidence, putEvidence } from '../core/storage.js';

export function evidenceRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ---------------------------------------------------------------- evidence
  r.get(
    '/engagements/:id/evidence',
    wrap(async (req, res) => {
      const { rows } = await db.query(`SELECT * FROM evidence WHERE engagement_id = $1 ORDER BY number DESC`, [
        req.params.id,
      ]);
      res.json(rows.map(toEvidence));
    }),
  );

  r.post(
    '/evidence',
    wrap(async (req, res) => {
      const b = z
        .object({
          engagementId: z.string().uuid(),
          title: z.string().trim().min(3).max(200),
          kind: z.enum(['file', 'link', 'note']),
          filename: z.string().max(200).optional(),
          mime: z.string().max(100).optional(),
          dataBase64: z.string().max(14_000_000).optional(),
          url: z.string().url().max(1000).optional(),
          note: z.string().max(8000).optional(),
          source: z.string().max(200).default(''),
          controlId: z.string().uuid().nullable().default(null),
          testId: z.string().uuid().nullable().default(null),
        })
        .parse(req.body);
      let hash: string,
        size: number | null = null;
      let read: { text: string; note: string } | null = null;
      if (b.kind === 'file') {
        if (!b.dataBase64 || !b.filename) throw httpError(400, 'Attach a file');
        const buf = Buffer.from(b.dataBase64, 'base64');
        if (buf.length > 10 * 1024 * 1024) throw httpError(413, 'Files up to 10 MB');
        hash = sha256(buf);
        size = buf.length;
        await putEvidence(hash, buf);
        // Read PDFs, spreadsheets, Word and text files so agents can use them.
        read = await extract(buf, b.filename, b.mime ?? '');
      } else if (b.kind === 'link') {
        if (!b.url) throw httpError(400, 'Give the link');
        hash = sha256(b.url);
      } else {
        if (!b.note?.trim()) throw httpError(400, 'Write the note');
        hash = sha256(b.note);
      }
      const controlId =
        b.controlId ??
        (b.testId
          ? ((await db.query(`SELECT control_id FROM tests WHERE id = $1`, [b.testId])).rows[0]?.control_id ?? null)
          : null);
      const { rows } = await db.tx(async (q) => {
        const out = await q.query(
          `INSERT INTO evidence (engagement_id, title, kind, filename, mime, size, sha256, url, note, source, collected_by, control_id, test_id, text_content, text_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [
            b.engagementId,
            b.title,
            b.kind,
            b.filename ?? null,
            b.mime ?? null,
            size,
            hash,
            b.url ?? null,
            b.note ?? null,
            b.source,
            actorOf(req),
            controlId,
            b.testId,
            read?.text || null,
            read?.note ?? null,
          ],
        );
        await logAudit(q, actorOf(req), 'evidence.added', `evidence:E-${out.rows[0].number}`, {
          title: b.title,
          kind: b.kind,
          sha256: hash,
          ...(read ? { read: read.note } : {}),
        });
        return out;
      });
      // Agents can now retrieve it (notes and text files).
      await indexEvidence(db, rows[0]).catch((e) => console.warn(`[kb] evidence not indexed: ${e.message}`));
      scheduleEmbedding(db);
      res.status(201).json(toEvidence(rows[0]));
    }),
  );

  // Recompute the hash of what's stored and compare with what was recorded.
  r.get(
    '/evidence/:id/verify',
    wrap(async (req, res) => {
      const { rows } = await db.query(`SELECT * FROM evidence WHERE id = $1`, [req.params.id]);
      const e = rows[0];
      if (!e) throw httpError(404, 'Evidence not found');
      let actual: string | null = null;
      if (e.kind === 'file' || e.kind === 'run') {
        const stored = await getEvidence(e.sha256);
        actual = stored ? sha256(stored) : null;
      } else actual = sha256(e.kind === 'link' ? e.url : e.note);
      res.json({
        ok: actual === e.sha256,
        recorded: e.sha256,
        actual,
        message:
          actual === e.sha256
            ? 'Unchanged since it was collected'
            : actual
              ? 'The stored content no longer matches its recorded hash'
              : 'The stored file is missing',
      });
    }),
  );

  r.get(
    '/evidence/:id/download',
    wrap(async (req, res) => {
      const { rows } = await db.query(`SELECT * FROM evidence WHERE id = $1`, [req.params.id]);
      const e = rows[0];
      if (!e || !['file', 'run'].includes(e.kind)) throw httpError(404, 'No file for this evidence');
      const stored = await getEvidence(e.sha256);
      if (!stored) throw httpError(404, 'The stored file is missing');
      res.setHeader('content-type', e.mime || 'application/octet-stream');
      res.setHeader(
        'content-disposition',
        `attachment; filename="${String(e.filename || 'evidence').replace(/[^\w.-]/g, '_')}"`,
      );
      res.send(stored);
    }),
  );
}
