// v1.7.3: cross-framework harmonization. One control, many frameworks: an
// engagement's controls (including the client's own, uploaded from their
// spreadsheet) are mapped once to a library control, and inherit its
// references to every framework at the same time. The matrix shows which
// framework references each control satisfies, how much of each framework
// in scope the engagement's controls cover, and suggests a library match
// for controls that aren't mapped yet. A person accepts each mapping.
import type { Router } from 'express';
import { z } from 'zod';
import { FRAMEWORK_CATALOG, FRAMEWORK_LABELS, frameworksIn, refMeets, type FrameworkRefs } from '@gh/shared';
import type { Db } from '../core/db.js';
import { logAudit } from '../audit/audit.js';
import { emit } from '../core/realtime.js';
import { type Wrap, httpError, type ActorOf } from '../core/http.js';
const STOP = new Set(
  'the a an and or of to for in on is are be by with each its it that this as at from before after per any all their they not no ai'.split(
    ' ',
  ),
);
const words = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, '')),
  );
// Word overlap (Jaccard), title counted twice. Good enough to rank 31 to 40 candidates; a person decides.
export function similarity(a: { title: string; objective: string }, b: { title: string; objective: string }) {
  const A = new Set([...words(a.title), ...words(a.title + ' ' + a.objective)]);
  const B = new Set([...words(b.title), ...words(b.title + ' ' + b.objective)]);
  const inter = [...A].filter((w) => B.has(w)).length;
  const titleHits = [...words(a.title)].filter((w) => words(b.title).has(w)).length;
  return (inter + titleHits) / (A.size + B.size - inter || 1);
}

/** Merges framework references, keeping each reference once. */
export function mergeRefs(...all: (FrameworkRefs | null | undefined)[]): FrameworkRefs {
  const out: Record<string, string[]> = {};
  for (const r of all)
    for (const [k, v] of Object.entries(r ?? {}))
      if (Array.isArray(v)) out[k] = [...new Set([...(out[k] ?? []), ...v])];
  return out;
}

/**
 * Registers these 2 routes on the API router (each path is under /api):
 * - GET /engagements/:id/harmonization
 * - POST /controls/:id/map
 */
export function harmonizeRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  r.get(
    '/engagements/:id/harmonization',
    wrap(async (req, res) => {
      const eid = req.params.id;
      const fw: string =
        (await db.query(`SELECT framework FROM engagements WHERE id = $1`, [eid])).rows[0]?.framework ?? '';
      const lib = (await db.query(`SELECT id, code, title, objective, refs FROM control_library ORDER BY code`)).rows;
      const ctl = (
        await db.query(
          `SELECT c.id, c.number, c.title, c.objective, c.framework_refs, c.library_id, l.code AS library_code, k.key AS card_key
       FROM controls c LEFT JOIN control_library l ON l.id = c.library_id LEFT JOIN cards k ON k.id = c.card_id WHERE c.engagement_id = $1 ORDER BY c.number`,
          [eid],
        )
      ).rows;
      const libById = new Map(lib.map((l: any) => [l.id, l]));
      const inScope = frameworksIn(fw) as (keyof FrameworkRefs)[];
      const keys = inScope.length ? inScope : (Object.keys(FRAMEWORK_LABELS) as (keyof FrameworkRefs)[]);
      const controls = ctl.map((c: any) => {
        const refs = mergeRefs(c.framework_refs, c.library_id ? (libById.get(c.library_id) as any)?.refs : null);
        const mapped = !!c.library_id || keys.some((k) => (refs[k] ?? []).length);
        const suggestions = c.library_id
          ? []
          : lib
              .map((l: any) => ({
                code: l.code,
                title: l.title,
                score: similarity(c, l),
                frameworks: keys.filter((k) => (l.refs?.[k] ?? []).length),
              }))
              .filter((s) => s.score >= 0.08)
              .sort((a, b) => b.score - a.score)
              .slice(0, 3)
              .map((s) => ({ ...s, score: Math.round(s.score * 100) }));
        return {
          id: c.id,
          key: `C-${c.number}`,
          title: c.title,
          cardKey: c.card_key,
          libraryCode: c.library_code,
          mapped,
          refs,
          frameworks: keys.filter((k) => (refs[k] ?? []).length).length,
          suggestions,
        };
      });
      // v1.7.4: coverage counts against the framework's complete requirement list, not just the library's references.
      const frameworks = keys.map((k) => {
        const all = (FRAMEWORK_CATALOG[k] ?? []).map((r) => r.id);
        const refs = controls.flatMap((c) => c.refs[k] ?? []);
        const covered = all.filter((id) => refs.some((x) => refMeets(x, id)));
        return {
          id: k,
          label: FRAMEWORK_LABELS[k],
          total: all.length,
          covered: covered.length,
          pct: all.length ? Math.round((covered.length / all.length) * 100) : 0,
          missing: all.filter((id) => !covered.includes(id)),
        };
      });
      const multi = controls.filter((c) => c.frameworks >= 2).length;
      res.json({
        frameworks,
        controls,
        summary: { controls: controls.length, unmapped: controls.filter((c) => !c.mapped).length, multi },
      });
    }),
  );

  // Map a control to a library control: it keeps its own references and gains the library's.
  r.post(
    '/controls/:id/map',
    wrap(async (req, res) => {
      const b = z.object({ libraryCode: z.string().min(2).max(20) }).parse(req.body);
      const out = await db.tx(async (q) => {
        const c = (await q.query(`SELECT * FROM controls WHERE id = $1`, [req.params.id])).rows[0];
        if (!c) throw httpError(404, 'Control not found');
        const l = (
          await q.query(`SELECT id, code, refs FROM control_library WHERE code = $1`, [b.libraryCode.toUpperCase()])
        ).rows[0];
        if (!l) throw httpError(404, `No library control ${b.libraryCode}`);
        const refs = mergeRefs(c.framework_refs, l.refs);
        await q.query(`UPDATE controls SET library_id = $2, framework_refs = $3 WHERE id = $1`, [
          c.id,
          l.id,
          JSON.stringify(refs),
        ]);
        await logAudit(q, actorOf(req), 'control.mapped', `control:C-${c.number}`, {
          library: l.code,
          frameworks: Object.keys(refs).filter((k) => (refs as any)[k].length),
        });
        return { key: `C-${c.number}`, libraryCode: l.code, refs, engagementId: c.engagement_id };
      });
      emit('controls', { engagementId: out.engagementId });
      res.json(out);
    }),
  );
}
