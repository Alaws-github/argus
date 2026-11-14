// Traceability: the chain from obligation to control, test and evidence.
import { frameworksIn } from '@gh/shared';
import { type Router } from 'express';
import { CONTROL_SELECT, toControl } from './control-records.js';
import { type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { OPTIONAL_SOURCES } from './library-health.js';

/**
 * Registers this route on the API router (each path is under /api):
 * - GET /engagements/:id/traceability
 */
export function traceabilityRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ------------------------------------------------------------ traceability
  // Obligation → library control → engagement control → test → evidence → issue.
  r.get(
    '/engagements/:id/traceability',
    wrap(async (req, res) => {
      const id = req.params.id;
      const fw: string =
        (await db.query(`SELECT framework FROM engagements WHERE id = $1`, [id])).rows[0]?.framework ?? '';
      // v1.7.3: healthcare obligations show only where the engagement chose that framework.
      const inFw = frameworksIn(fw) as string[];
      const chosen = (src: string) => {
        const k = OPTIONAL_SOURCES[src];
        return !k || inFw.includes(k);
      };
      const obl = (await db.query(`SELECT * FROM obligations ORDER BY source, ref`)).rows.filter((o: any) =>
        chosen(o.source),
      );
      const { rows: lib } = await db.query(
        `SELECT l.id, l.code, l.title, s.applicable, s.justification FROM control_library l LEFT JOIN soa s ON s.library_id = l.id AND s.engagement_id = $1`,
        [id],
      );
      const { rows: ctl } = await db.query(`${CONTROL_SELECT} WHERE c.engagement_id = $1`, [id]);
      const controls = ctl.map(toControl);
      const rows = obl.map((o: any) => {
        const codes: string[] = o.library_codes;
        const links = codes.map((code) => {
          const l = lib.find((x: any) => x.code === code);
          const cs = controls.filter((c) => c.libraryCode === code);
          const excluded = l?.applicable === false;
          const gap = excluded
            ? null
            : !cs.length
              ? 'No control in place'
              : cs.some((c) => !c.tests.total)
                ? 'Control has no test'
                : cs.some((c) => !c.evidence)
                  ? 'Control has no evidence'
                  : cs.some((c) => c.tests.failed)
                    ? 'A test failed'
                    : null;
          return {
            code,
            title: l?.title ?? code,
            excluded,
            justification: l?.justification ?? null,
            controls: cs.map((c) => ({
              id: c.id,
              key: c.key,
              title: c.title,
              cardKey: c.cardKey,
              status: c.status,
              tests: c.tests,
              evidence: c.evidence,
              openIssues: c.openIssues,
            })),
            gap,
          };
        });
        const status = links.every((l) => l.excluded)
          ? 'excluded'
          : links.some((l) => l.gap === 'No control in place')
            ? 'gap'
            : links.some((l) => l.gap)
              ? 'partial'
              : 'covered';
        return { id: o.id, source: o.source, ref: o.ref, title: o.title, summary: o.summary, status, links };
      });
      res.json(rows);
    }),
  );
}
