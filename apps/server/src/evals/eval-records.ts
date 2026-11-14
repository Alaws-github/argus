// Turns evaluation suite and case rows into API records.
import { toIso } from '../core/format.js';

export const SUITE_SELECT = `
    SELECT s.*, i.name AS inventory_name, p.name AS provider_name,
      (SELECT count(*)::int FROM eval_cases c WHERE c.suite_id = s.id) AS cases,
      (SELECT row_to_json(x) FROM (SELECT r.id, r.passed, r.total, r.ended_at, r.started_at, r.status FROM eval_runs r WHERE r.suite_id = s.id ORDER BY r.started_at DESC LIMIT 1) x) AS last_run,
      (SELECT json_agg(t.p ORDER BY t.st) FROM (SELECT round(r.passed * 100.0 / r.total)::int AS p, r.started_at AS st FROM eval_runs r WHERE r.suite_id = s.id AND r.status = 'completed' AND r.total > 0 ORDER BY r.started_at DESC LIMIT 10) t) AS trend
    FROM eval_suites s LEFT JOIN inventory i ON i.id = s.inventory_id LEFT JOIN providers p ON p.id = s.provider_id`;

export const toSuite = (r: any) => ({
  id: r.id,
  key: `EV-${r.number}`,
  engagementId: r.engagement_id,
  name: r.name,
  kind: r.kind,
  inventoryId: r.inventory_id,
  inventoryName: r.inventory_name,
  providerId: r.provider_id,
  providerName: r.provider_name ?? 'Removed provider',
  model: r.model,
  systemPrompt: r.system_prompt,
  thresholdPct: r.threshold_pct,
  judgeProviderId: r.judge_provider_id,
  judgeModel: r.judge_model,
  cases: r.cases,
  lastRun: r.last_run
    ? {
        id: r.last_run.id,
        passed: r.last_run.passed,
        total: r.last_run.total,
        passPct: r.last_run.total ? Math.round((r.last_run.passed / r.last_run.total) * 100) : 0,
        at: toIso(r.last_run.ended_at ?? r.last_run.started_at),
        status: r.last_run.status,
      }
    : null,
  schedule: r.schedule ?? 'off',
  nextRunAt: toIso(r.next_run_at),
  driftDropPct: r.drift_drop_pct ?? 10,
  trend: r.trend ?? [],
});

export const toCase = (c: any) => ({
  id: c.id,
  suiteId: c.suite_id,
  name: c.name,
  category: c.category,
  ref: c.ref,
  input: c.input,
  check: c.check,
  expected: c.expected,
  severity: c.severity,
});
