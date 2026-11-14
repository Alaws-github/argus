// The control library and the obligations it meets.
import { type Router } from 'express';
import { z } from 'zod';
import { toLibrary } from './control-records.js';
import { logAudit } from '../audit/audit.js';
import { type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';

export function libraryRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ----------------------------------------------------- library, obligations
  r.get(
    '/library',
    wrap(async (_req, res) => {
      const { rows } = await db.query(`SELECT * FROM control_library ORDER BY code`);
      res.json(rows.map(toLibrary));
    }),
  );

  const LibInput = z.object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,5}-\d{2,3}$/, 'Use a code like GOV-07'),
    title: z.string().trim().min(3).max(200),
    objective: z.string().max(2000).default(''),
    domain: z.string().max(40),
    type: z.enum(['preventive', 'detective', 'corrective']),
    frequency: z.string().max(60).default('per change'),
    evidenceExpected: z.string().max(1000).default(''),
    testProcedure: z.string().max(2000).default(''),
    riskCategories: z.array(z.string()).default([]),
  });
  r.post(
    '/library',
    wrap(async (req, res) => {
      const b = LibInput.parse(req.body);
      const { rows } = await db.tx(async (q) => {
        const out = await q.query(
          `INSERT INTO control_library (code, title, objective, domain, type, frequency, evidence_expected, test_procedure, risk_categories, refs, built_in)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}',false) RETURNING *`,
          [
            b.code,
            b.title,
            b.objective,
            b.domain,
            b.type,
            b.frequency,
            b.evidenceExpected,
            b.testProcedure,
            JSON.stringify(b.riskCategories),
          ],
        );
        await logAudit(q, actorOf(req), 'library.control_added', `library:${b.code}`, { title: b.title });
        return out;
      });
      res.status(201).json(toLibrary(rows[0]));
    }),
  );

  r.get(
    '/obligations',
    wrap(async (_req, res) => {
      const { rows } = await db.query(`SELECT * FROM obligations ORDER BY source, ref`);
      res.json(
        rows.map((o: any) => ({
          id: o.id,
          source: o.source,
          ref: o.ref,
          title: o.title,
          summary: o.summary,
          libraryCodes: o.library_codes,
        })),
      );
    }),
  );
}
