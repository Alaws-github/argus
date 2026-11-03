// Row mappers and shared queries.
import { AGENT_ROLES } from '@gh/shared';
import type { AgentConfig, AgentRole, AuditEntry, Card, Engagement, Risk, Run, RunEvent, Stage, WorkspaceSettings } from '@gh/shared';
import type { Queryable } from './db.js';

const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const num = (v: any) => (v == null ? 0 : Number(v));

export function toEngagement(r: any): Engagement {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    client: r.client,
    prefix: r.prefix,
    color: r.color,
    framework: r.framework,
    gates: r.gates,
    about: r.about ?? '',
    paused: !!r.paused,
    appetite: { maxResidual: 8, statement: '', escalateTo: 'Board Risk Committee', ...(r.appetite ?? {}) },
    reportSignedBy: r.report_signed_by ?? null,
    reportSignedAt: iso(r.report_signed_at),
    sector: r.sector ?? '',
    archivedAt: iso(r.archived_at),
    archivedBy: r.archived_by ?? null,
    archiveReason: r.archive_reason ?? null,
    createdAt: iso(r.created_at)!,
  };
}

export function toCard(r: any): Card {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    number: r.number,
    key: r.key,
    title: r.title,
    stage: r.stage,
    status: r.status,
    statusNote: r.status_note,
    useCase: r.use_case,
    tier: r.tier,
    classification: r.classification,
    design: r.design ?? null,
    createdBy: r.created_by ?? null,
    latestRunId: r.latest_run_id,
    costUsd: num(r.cost_usd),
    createdAt: iso(r.created_at)!,
    stageEnteredAt: iso(r.stage_entered_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

export function toRun(r: any): Run {
  return {
    id: r.id,
    number: r.number,
    cardId: r.card_id,
    cardKey: r.card_key,
    stage: r.stage,
    agent: r.agent,
    model: r.model,
    runtime: r.runtime,
    status: r.status,
    error: r.error,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costUsd: num(r.cost_usd),
    startedAt: iso(r.started_at)!,
    endedAt: iso(r.ended_at),
  };
}

export function toEvent(r: any): RunEvent {
  return { id: Number(r.id), runId: r.run_id, at: iso(r.at)!, kind: r.kind, text: r.text };
}

export function toRisk(r: any): Risk {
  return {
    id: r.id,
    key: `R-${r.number}`,
    cardId: r.card_id,
    cardKey: r.card_key,
    title: r.title,
    category: r.category,
    likelihood: r.likelihood,
    impact: r.impact,
    score: r.likelihood * r.impact,
    owner: r.owner,
    treatment: r.treatment,
    status: r.status,
    rationale: r.rationale,
    createdAt: iso(r.created_at)!,
    residualLikelihood: r.residual_likelihood ?? null,
    residualImpact: r.residual_impact ?? null,
    residualScore: r.residual_likelihood && r.residual_impact ? r.residual_likelihood * r.residual_impact : null,
    acceptedBy: r.accepted_by ?? null,
    controlCount: Number(r.control_count ?? 0),
  };
}

export function toAudit(r: any): AuditEntry {
  return { id: Number(r.id), at: iso(r.at)!, actor: r.actor, action: r.action, entity: r.entity, detail: r.detail };
}

export async function getCard(q: Queryable, idOrKey: string): Promise<Card | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey);
  const { rows } = await q.query(`SELECT * FROM cards WHERE ${isUuid ? 'id' : 'key'} = $1`, [idOrKey]);
  return rows[0] ? toCard(rows[0]) : null;
}

export async function getEngagement(q: Queryable, id: string): Promise<Engagement | null> {
  const { rows } = await q.query(`SELECT * FROM engagements WHERE id = $1`, [id]);
  return rows[0] ? toEngagement(rows[0]) : null;
}

export async function getSetting<T>(q: Queryable, key: string, fallback: T): Promise<T> {
  const { rows } = await q.query(`SELECT value FROM settings WHERE key = $1`, [key]);
  return rows[0] ? (rows[0].value as T) : fallback;
}

// Spend on billed providers since the start of this month in the workspace time zone.
export async function monthSpend(q: Queryable, timeZone = 'UTC'): Promise<number> {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(cost_usd),0) AS usd FROM runs
     WHERE billed AND started_at >= (date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1)`,
    [timeZone],
  );
  return num(rows[0].usd);
}

export const SETTING_DEFAULTS: WorkspaceSettings = {
  autoStart: true,
  spendCapUsd: 50,
  warnAtPct: 75,
  pauseAtCap: true,
  timeZone: 'America/Jamaica',
  defaultProviderId: null,
  defaultModel: 'claude-sonnet-5-5',
  defaultEffort: 'medium',
  defaultFallbackModel: null,
};

export async function getSettings(q: Queryable): Promise<WorkspaceSettings> {
  const { rows } = await q.query(`SELECT key, value FROM settings`);
  const out: any = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  return out;
}

export function toAgent(r: any): AgentConfig {
  const meta = AGENT_ROLES[r.role as AgentRole];
  return {
    id: r.id,
    engagementId: r.engagement_id,
    role: r.role,
    name: r.name,
    stage: r.stage,
    route: r.route,
    enabled: r.enabled,
    built: meta?.built ?? false,
    providerId: r.provider_id,
    model: r.model,
    effort: r.effort,
    fallbackProviderId: r.fallback_provider_id,
    fallbackModel: r.fallback_model,
    summary: r.summary,
    instructions: r.instructions,
    tools: r.tools,
    maxCostUsd: num(r.max_cost_usd),
    timeoutMin: r.timeout_min,
    concurrency: r.concurrency,
    activeRuns: Number(r.active_runs ?? 0),
    killedAt: iso(r.killed_at),
    killTestedAt: iso(r.kill_tested_at),
    rulesVersion: null,
  };
}

export const AGENT_SELECT = `
  SELECT a.*, (SELECT count(*)::int FROM runs r WHERE r.agent_id = a.id AND r.status = 'running') AS active_runs
  FROM agents a`;

// Stages where a built, enabled agent will pick cards up.
export async function agentStages(q: Queryable, engagementId: string): Promise<Stage[]> {
  const { rows } = await q.query(`SELECT role, stage FROM agents WHERE engagement_id = $1 AND enabled`, [engagementId]);
  return rows.filter((r: any) => AGENT_ROLES[r.role as AgentRole]?.built).map((r: any) => r.stage);
}

export const RUN_SELECT = `SELECT r.*, c.key AS card_key FROM runs r JOIN cards c ON c.id = r.card_id`;
export const RISK_SELECT = `SELECT k.*, c.key AS card_key, (SELECT count(*) FROM control_risks cr WHERE cr.risk_id = k.id)::int AS control_count FROM risks k JOIN cards c ON c.id = k.card_id`;
