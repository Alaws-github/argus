// The numbers behind the KPI tiles at the top of each page (v1.7). One read
// that counts across the engagement, so every page's tiles come from the same
// moment and a page needs one request, not one per tile. Read-only.
import type { Queryable } from './db.js';

const one = async (q: Queryable, sql: string, args: unknown[]) => (await q.query(sql, args)).rows[0] ?? {};

export async function engagementKpis(q: Queryable, engagementId: string) {
  const E = [engagementId];
  const [cards, risks, controls, tests, evidence, issues, incidents, inventory, evals, kb, runs, audit, questions] = await Promise.all([
    one(q, `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status IN ('needs_approval','question','failed') OR (stage='intake' AND status='idle'))::int AS needs_you,
      count(*) FILTER (WHERE status IN ('running','queued'))::int AS working,
      count(*) FILTER (WHERE stage='closed')::int AS closed,
      count(*) FILTER (WHERE tier IN ('high','prohibited'))::int AS high_tier,
      count(*) FILTER (WHERE tier IS NOT NULL)::int AS tiered,
      count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS added_30d
      FROM cards WHERE engagement_id = $1`, E),
    one(q, `SELECT count(*) FILTER (WHERE k.status <> 'closed')::int AS open,
      count(*) FILTER (WHERE k.status <> 'closed' AND k.likelihood * k.impact >= 12)::int AS high,
      count(*) FILTER (WHERE k.status <> 'closed' AND coalesce(k.residual_likelihood * k.residual_impact, k.likelihood * k.impact) > coalesce((e.appetite->>'maxResidual')::int, 8) AND k.accepted_by IS NULL)::int AS above_appetite,
      count(*) FILTER (WHERE k.status <> 'closed' AND coalesce(k.owner,'') = '')::int AS no_owner,
      count(*) FILTER (WHERE k.status <> 'closed' AND NOT EXISTS (SELECT 1 FROM control_risks cr WHERE cr.risk_id = k.id))::int AS no_control,
      round(avg(k.likelihood * k.impact) FILTER (WHERE k.status <> 'closed'), 1)::float AS avg_score
      FROM risks k JOIN engagements e ON e.id = k.engagement_id WHERE k.engagement_id = $1`, E),
    one(q, `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'operating')::int AS operating,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE coalesce(owner,'') = '')::int AS no_owner,
      count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM tests t WHERE t.control_id = c.id))::int AS untested
      FROM controls c WHERE engagement_id = $1`, E),
    one(q, `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'passed')::int AS passed,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status IN ('passed','failed') AND reviewed_by IS NULL)::int AS awaiting_review,
      count(*) FILTER (WHERE status IN ('not_started','in_progress','blocked'))::int AS open
      FROM tests WHERE engagement_id = $1`, E),
    one(q, `SELECT count(*)::int AS total, count(*) FILTER (WHERE collected_at > now() - interval '30 days')::int AS added_30d FROM evidence WHERE engagement_id = $1`, E),
    one(q, `SELECT count(*) FILTER (WHERE status NOT IN ('closed','risk_accepted'))::int AS open,
      count(*) FILTER (WHERE status NOT IN ('closed','risk_accepted') AND due_date < current_date)::int AS overdue,
      count(*) FILTER (WHERE status NOT IN ('closed','risk_accepted') AND severity IN ('critical','high'))::int AS severe,
      count(*) FILTER (WHERE status = 'ready_for_retest')::int AS retest,
      count(*) FILTER (WHERE status = 'closed')::int AS closed
      FROM issues WHERE engagement_id = $1`, E),
    one(q, `SELECT count(*) FILTER (WHERE status IN ('open','contained'))::int AS open,
      count(*) FILTER (WHERE status IN ('open','contained') AND severity IN ('critical','high'))::int AS severe,
      count(*)::int AS total FROM incidents WHERE engagement_id = $1`, E),
    one(q, `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'live')::int AS live FROM inventory WHERE engagement_id = $1`, E),
    one(q, `SELECT (SELECT count(*)::int FROM eval_suites WHERE engagement_id = $1) AS suites,
      count(r.*)::int AS runs, coalesce(round(100.0 * sum(r.passed) / nullif(sum(r.total), 0)), 0)::int AS pass_pct
      FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE s.engagement_id = $1 AND r.status = 'completed' AND r.started_at > now() - interval '30 days'`, E),
    one(q, `SELECT (SELECT count(*)::int FROM kb_sources WHERE engagement_id = $1 AND kind IN ('upload','client')) AS client_docs,
      (SELECT count(*)::int FROM kb_sources WHERE engagement_id IS NULL) AS shared_sources,
      (SELECT count(*)::int FROM kb_chunks WHERE engagement_id = $1 OR engagement_id IS NULL) AS passages,
      (SELECT count(*)::int FROM kb_chunks WHERE (engagement_id = $1 OR engagement_id IS NULL) AND embed_model IS NOT NULL) AS embedded`, E),
    one(q, `SELECT count(*) FILTER (WHERE r.started_at > now() - interval '30 days')::int AS runs_30d,
      count(*) FILTER (WHERE r.started_at > now() - interval '30 days' AND r.status = 'failed')::int AS failed_30d,
      coalesce(sum(r.cost_usd) FILTER (WHERE r.started_at > date_trunc('month', now())), 0)::float AS cost_month,
      count(*) FILTER (WHERE r.status = 'running')::int AS running,
      round(avg(r.steps) FILTER (WHERE r.mode = 'agentic'), 1)::float AS avg_steps
      FROM runs r JOIN cards c ON c.id = r.card_id WHERE c.engagement_id = $1`, E),
    one(q, `SELECT count(*) FILTER (WHERE at > now() - interval '1 day')::int AS today, count(*) FILTER (WHERE at > now() - interval '7 days')::int AS week,
      count(DISTINCT actor) FILTER (WHERE at > now() - interval '7 days')::int AS people_week FROM audit_log WHERE engagement_id = $1`, E),
    one(q, `SELECT count(*) FILTER (WHERE status = 'open')::int AS open FROM agent_questions WHERE engagement_id = $1`, E),
  ]);
  return { cards, risks, controls, tests, evidence, issues, incidents, inventory, evals, kb, runs, audit, questions, at: new Date().toISOString() };
}
