// v1.7.4: every requirement of each framework in scope, and whether the
// engagement meets it. A framework is fully met only when every requirement
// is proven (a control in place that meets it, tested with a passing result
// and evidenced, nothing failed) or marked not applicable with a reason.
//
// A control meets a requirement through its framework references: its own
// (set when the control was added or mapped) plus those of the library
// control it is based on. Gaps can be closed by mapping one of the
// engagement's controls to the requirement, or by adding the library control
// that meets it. Scoping a requirement out needs a reason, and is audited.
import type { Request, Router } from 'express';
import { z } from 'zod';
import {
  FRAMEWORK_CATALOG,
  FRAMEWORK_LABELS,
  frameworksIn,
  refMeets,
  type FrameworkKey,
  type FrameworkRefs,
} from '@gh/shared';
import type { Db } from '../core/db.js';
import { logAudit } from '../audit/audit.js';
import { emit } from '../core/realtime.js';
import { mergeRefs } from './harmonize.js';
import { type Wrap, httpError } from '../core/http.js';
const KEYS = Object.keys(FRAMEWORK_CATALOG) as FrameworkKey[];

export type ReqStatus = 'proven' | 'in_progress' | 'gap' | 'not_applicable';

export async function requirementCoverage(db: Db, eid: string, only?: FrameworkKey) {
  const fw: string =
    (await db.query(`SELECT framework FROM engagements WHERE id = $1`, [eid])).rows[0]?.framework ?? '';
  const inScope = (frameworksIn(fw) as FrameworkKey[]).filter((k) => FRAMEWORK_CATALOG[k]);
  const keys = only ? [only] : inScope;
  const lib = (await db.query(`SELECT id, code, title, refs FROM control_library ORDER BY code`)).rows;
  const libById = new Map(lib.map((l: any) => [l.id, l]));
  const ctl = (
    await db.query(
      `SELECT c.id, c.number, c.title, c.status, c.framework_refs, c.library_id, k.key AS card_key,
       (SELECT count(*)::int FROM tests t WHERE t.control_id = c.id AND t.status = 'passed') AS passed,
       (SELECT count(*)::int FROM tests t WHERE t.control_id = c.id AND t.status = 'failed') AS failed,
       (SELECT count(*)::int FROM tests t WHERE t.control_id = c.id) AS tests,
       (SELECT count(*)::int FROM evidence e WHERE e.control_id = c.id OR e.test_id IN (SELECT id FROM tests WHERE control_id = c.id)) AS evidence
     FROM controls c LEFT JOIN cards k ON k.id = c.card_id WHERE c.engagement_id = $1 ORDER BY c.number`,
      [eid],
    )
  ).rows.map((c: any) => ({
    ...c,
    refs: mergeRefs(c.framework_refs, c.library_id ? (libById.get(c.library_id) as any)?.refs : null) as FrameworkRefs,
  }));
  const scoping = new Map(
    (await db.query(`SELECT * FROM framework_scoping WHERE engagement_id = $1`, [eid])).rows.map((s: any) => [
      `${s.framework}|${s.ref}`,
      s,
    ]),
  );
  const proven = (c: any) => c.passed > 0 && c.failed === 0 && c.evidence > 0;
  const frameworks = keys.map((k) => {
    const rows = FRAMEWORK_CATALOG[k].map((r) => {
      const meeting = ctl.filter((c: any) => (c.refs[k] ?? []).some((ref: string) => refMeets(ref, r.id)));
      const sc: any = scoping.get(`${k}|${r.id}`);
      const status: ReqStatus =
        sc && !sc.applicable
          ? 'not_applicable'
          : !meeting.length
            ? 'gap'
            : meeting.some(proven)
              ? 'proven'
              : 'in_progress';
      // What's still needed, in words.
      const next =
        status === 'gap'
          ? 'No control in place meets it'
          : status === 'in_progress'
            ? meeting.some((c: any) => c.failed)
              ? 'A test failed'
              : meeting.every((c: any) => !c.tests)
                ? 'Its control has no test yet'
                : meeting.every((c: any) => !c.passed)
                  ? 'No test has passed yet'
                  : 'Its control has no evidence yet'
            : '';
      return {
        id: r.id,
        title: r.title,
        group: r.group,
        status,
        next,
        controls: meeting.map((c: any) => ({
          id: c.id,
          key: `C-${c.number}`,
          title: c.title,
          cardKey: c.card_key,
          proven: proven(c),
        })),
        library: lib
          .filter((l: any) => (l.refs?.[k] ?? []).some((ref: string) => refMeets(ref, r.id)))
          .map((l: any) => ({ code: l.code, title: l.title })),
        scoping: sc ? { applicable: sc.applicable, reason: sc.reason, by: sc.decided_by, at: sc.decided_at } : null,
      };
    });
    const n = (s: ReqStatus) => rows.filter((r) => r.status === s).length;
    return {
      id: k,
      label: FRAMEWORK_LABELS[k],
      inScope: inScope.includes(k),
      total: rows.length,
      proven: n('proven'),
      inProgress: n('in_progress'),
      gap: n('gap'),
      notApplicable: n('not_applicable'),
      fullyMet: rows.every((r) => r.status === 'proven' || r.status === 'not_applicable'),
      rows,
    };
  });
  return { frameworks, inScope, controls: ctl.map((c: any) => ({ id: c.id, key: `C-${c.number}`, title: c.title })) };
}

export function requirementRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  r.get(
    '/engagements/:id/requirements',
    wrap(async (req, res) => {
      const only =
        typeof req.query.framework === 'string' && KEYS.includes(req.query.framework as FrameworkKey)
          ? (req.query.framework as FrameworkKey)
          : undefined;
      res.json(await requirementCoverage(db, req.params.id, only));
    }),
  );

  // Mark a requirement not applicable (with a reason an auditor would accept), or applicable again.
  r.put(
    '/engagements/:id/requirements/:fw',
    wrap(async (req, res) => {
      const fw = req.params.fw as FrameworkKey;
      if (!FRAMEWORK_CATALOG[fw]) throw httpError(404, 'Unknown framework');
      const b = z
        .object({ ref: z.string().max(60), applicable: z.boolean(), reason: z.string().trim().max(1000).default('') })
        .parse(req.body);
      if (!FRAMEWORK_CATALOG[fw].some((x) => x.id === b.ref))
        throw httpError(404, `${b.ref} is not a requirement of ${FRAMEWORK_LABELS[fw]}`);
      if (!b.applicable && b.reason.length < 10)
        throw httpError(400, 'Say why it does not apply (at least a sentence an auditor would accept)');
      await db.tx(async (q) => {
        if (b.applicable)
          await q.query(`DELETE FROM framework_scoping WHERE engagement_id = $1 AND framework = $2 AND ref = $3`, [
            req.params.id,
            fw,
            b.ref,
          ]);
        else
          await q.query(
            `INSERT INTO framework_scoping (engagement_id, framework, ref, applicable, reason, decided_by) VALUES ($1,$2,$3,false,$4,$5)
         ON CONFLICT (engagement_id, framework, ref) DO UPDATE SET applicable = false, reason = $4, decided_by = $5, decided_at = now()`,
            [req.params.id, fw, b.ref, b.reason, actorOf(req)],
          );
        await logAudit(
          q,
          actorOf(req),
          b.applicable ? 'requirement.applicable' : 'requirement.not_applicable',
          `requirement:${FRAMEWORK_LABELS[fw]} ${b.ref}`,
          { framework: fw, ref: b.ref, ...(b.applicable ? {} : { reason: b.reason }) },
        );
      });
      emit('controls', { engagementId: req.params.id });
      res.json(await requirementCoverage(db, req.params.id, fw));
    }),
  );

  // Map one of the engagement's controls to a requirement (or remove the mapping).
  r.post(
    '/controls/:id/refs',
    wrap(async (req, res) => {
      const b = z
        .object({ framework: z.string(), ref: z.string().max(60), remove: z.boolean().default(false) })
        .parse(req.body);
      const fw = b.framework as FrameworkKey;
      if (!FRAMEWORK_CATALOG[fw]?.some((x) => x.id === b.ref)) throw httpError(404, 'Unknown requirement');
      const out = await db.tx(async (q) => {
        const c = (await q.query(`SELECT * FROM controls WHERE id = $1`, [req.params.id])).rows[0];
        if (!c) throw httpError(404, 'Control not found');
        const refs: Record<string, string[]> = { ...(c.framework_refs ?? {}) };
        refs[fw] = b.remove ? (refs[fw] ?? []).filter((x) => x !== b.ref) : [...new Set([...(refs[fw] ?? []), b.ref])];
        await q.query(`UPDATE controls SET framework_refs = $2 WHERE id = $1`, [c.id, JSON.stringify(refs)]);
        await logAudit(q, actorOf(req), b.remove ? 'control.unmapped' : 'control.mapped', `control:C-${c.number}`, {
          framework: fw,
          requirement: b.ref,
        });
        return { engagementId: c.engagement_id };
      });
      emit('controls', { engagementId: out.engagementId });
      res.json(await requirementCoverage(db, out.engagementId, fw));
    }),
  );
}
