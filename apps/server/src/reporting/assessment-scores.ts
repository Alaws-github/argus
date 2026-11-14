// Suggests readiness assessment scores from the engagement's own records.
import { verifyAudit } from '../audit/audit.js';
import type { Queryable } from '../core/db.js';
import { getEngagement } from '../settings/settings-store.js';
// --------------------------------------------------------------- assessment
export async function suggestScores(q: Queryable, engagementId: string) {
  const one = async (sql: string, params: unknown[] = [engagementId]) => (await q.query(sql, params)).rows[0];
  const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
  const e = await getEngagement(q, engagementId);
  const out: Record<string, { score: number; reasons: string[] }> = {};

  const approvers = await one(
    `SELECT count(*)::int AS n FROM users WHERE role IN ('admin','lead','reviewer') AND NOT disabled`,
    [],
  );
  const gatesOn = Object.values(e?.gates ?? {}).filter(Boolean).length;
  const inv = await one(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE owner = '')::int AS unowned FROM inventory WHERE engagement_id = $1 AND status <> 'retired'`,
  );
  const chain = await verifyAudit(q);
  out.govern = {
    score: clamp(
      1 + (gatesOn >= 4 ? 1 : 0) + (approvers.n >= 2 ? 1 : 0) + (inv.n && !inv.unowned ? 1 : 0) + (chain.ok ? 1 : 0),
    ),
    reasons: [
      `${gatesOn} gates on`,
      `${approvers.n} people can approve`,
      inv.n ? `${inv.n - inv.unowned} of ${inv.n} inventory items have an owner` : 'Inventory is empty',
      chain.ok ? 'Audit trail verifies' : 'Audit trail is broken',
    ],
  };

  const cards = await one(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE tier IS NOT NULL AND stage NOT IN ('intake','classify'))::int AS classified FROM cards WHERE engagement_id = $1 AND NOT (stage = 'closed' AND tier IS NULL)`,
  );
  const cov = cards.n ? cards.classified / cards.n : 0;
  out.map = {
    score: clamp(1 + cov * 3 + (inv.n ? 1 : 0)),
    reasons: [`${Math.round(cov * 100)}% of use cases classified`, `${inv.n} inventory items`],
  };

  const hi = await one(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM control_risks cr WHERE cr.risk_id = r.id))::int AS treated FROM risks r WHERE r.engagement_id = $1 AND r.likelihood * r.impact >= 12`,
  );
  const soa = await one(`SELECT count(*)::int AS n FROM soa WHERE engagement_id = $1`);
  const treated = hi.n ? hi.treated / hi.n : 0;
  // Design alone reaches 3; proof that controls operate is what earns 4 and 5.
  const lib = await one(`SELECT count(*)::int AS n FROM control_library`, []);
  const ops = await one(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'operating')::int AS ok FROM controls WHERE engagement_id = $1`,
  );
  const soaShare = lib.n ? soa.n / lib.n : 0;
  out.controls = {
    score: hi.n ? clamp(1 + treated * 1.5 + soaShare * 0.5 + (ops.n ? (ops.ok / ops.n) * 2 : 0)) : 1,
    reasons: [
      hi.n ? `${hi.treated} of ${hi.n} high risks have a control` : 'No high risks registered yet',
      `${soa.n} of ${lib.n} Statement of Applicability decisions`,
      `${ops.ok} of ${ops.n} controls shown to operate`,
    ],
  };

  const t = await one(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE status IN ('passed','failed') AND reviewed_by IS NOT NULL)::int AS done, count(*) FILTER (WHERE status = 'passed')::int AS passed FROM tests WHERE engagement_id = $1`,
  );
  const evalQ = await one(
    `SELECT count(*)::int AS n FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE s.engagement_id = $1 AND s.kind = 'quality' AND r.status = 'completed'`,
  );
  out.measure = {
    score: t.n
      ? clamp(1 + (t.done / t.n) * 2 + (t.done ? t.passed / t.done : 0) + (evalQ.n ? 1 : 0))
      : clamp(1 + (evalQ.n ? 1 : 0)),
    reasons: [
      t.n ? `${t.done} of ${t.n} tests concluded and reviewed` : 'No control tests yet',
      t.done ? `${t.passed} passed` : '',
      `${evalQ.n} quality evaluation runs`,
    ].filter(Boolean),
  };

  const rt = await one(
    `SELECT r.passed, r.total FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE s.engagement_id = $1 AND s.kind = 'red_team' AND r.status = 'completed' ORDER BY r.ended_at DESC LIMIT 1`,
  );
  out.security = rt
    ? {
        score: clamp(1 + (rt.passed / Math.max(rt.total, 1)) * 4),
        reasons: [`Latest red-team run: ${rt.passed} of ${rt.total} attacks resisted`],
      }
    : { score: 1, reasons: ['No red-team run yet'] };

  const priv = await one(`SELECT count(DISTINCT r.card_id)::int AS n,
      count(DISTINCT r.card_id) FILTER (WHERE EXISTS (SELECT 1 FROM controls c JOIN control_library l ON l.id = c.library_id WHERE c.card_id = r.card_id AND l.domain = 'data'))::int AS covered,
      count(DISTINCT r.card_id) FILTER (WHERE EXISTS (SELECT 1 FROM controls c JOIN control_library l ON l.id = c.library_id WHERE c.card_id = r.card_id AND l.domain = 'data' AND c.status = 'operating'))::int AS proven
    FROM risks r WHERE r.engagement_id = $1 AND r.category = 'privacy'`);
  out.privacy = priv.n
    ? {
        score: clamp(1 + (priv.covered / priv.n) * 2 + (priv.proven / priv.n) * 2),
        reasons: [
          `${priv.covered} of ${priv.n} use cases with privacy risk have a data-protection control`,
          `${priv.proven} with one shown to operate`,
        ],
      }
    : { score: 2, reasons: ['No privacy risks registered yet'] };

  const is = await one(`SELECT count(*)::int AS n,
      count(*) FILTER (WHERE owner = '' AND status NOT IN ('closed','risk_accepted'))::int AS unowned,
      count(*) FILTER (WHERE due_date < current_date AND status IN ('open','in_remediation','ready_for_retest'))::int AS overdue,
      count(*) FILTER (WHERE status IN ('closed','risk_accepted'))::int AS closed,
      count(*) FILTER (WHERE severity = 'critical' AND status IN ('open','in_remediation','ready_for_retest'))::int AS crit
    FROM issues WHERE engagement_id = $1`);
  out.manage = is.n
    ? {
        score: clamp(
          1 + (is.unowned ? 0 : 1) + (is.overdue ? 0 : 1) + (is.closed / is.n >= 0.5 ? 1 : 0) + (is.crit ? 0 : 1),
        ),
        reasons: [
          `${is.n} issues, ${is.closed} closed`,
          `${is.overdue} overdue`,
          `${is.crit} critical open`,
          `${is.unowned} without an owner`,
        ],
      }
    : { score: 2, reasons: ['No issues raised yet: nothing tested, or nothing failed'] };
  return out;
}
