// Row mappers and shared queries.
import { AGENT_ROLES, DEFAULT_MAX_STEPS, NO_MODULES } from '@gh/shared';
import type {
  AgentConfig,
  AgentQuestion,
  AgentRole,
  AuditEntry,
  Card,
  Engagement,
  Risk,
  Run,
  RunEvent,
  Stage,
  WorkspaceSettings,
} from '@gh/shared';
import type { Queryable } from '../core/db.js';
import { toIso } from '../core/format.js';

const num = (v: any) => (v == null ? 0 : Number(v));

/** An engagement row as an API record. */
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
    reportSignedAt: toIso(r.report_signed_at),
    sector: r.sector ?? '',
    archivedAt: toIso(r.archived_at),
    archivedBy: r.archived_by ?? null,
    archiveReason: r.archive_reason ?? null,
    access: r.access ?? 'open',
    modules: { ...NO_MODULES, ...(r.modules ?? {}) },
    clientTools: Array.isArray(r.client_tools) ? r.client_tools : [],
    writeBack: !!r.write_back,
    clientStepsDefault: r.client_steps_default !== false,
    createdAt: toIso(r.created_at)!,
  };
}

/** A card row as an API record. */
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
    updatedBy: r.updated_by ?? null,
    drafts: r.drafts ?? {},
    decisions: r.decisions ?? {},
    verification: r.verification ?? {},
    latestRunId: r.latest_run_id,
    costUsd: num(r.cost_usd),
    createdAt: toIso(r.created_at)!,
    stageEnteredAt: toIso(r.stage_entered_at)!,
    updatedAt: toIso(r.updated_at)!,
  };
}

/** A run row as an API record. */
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
    startedAt: toIso(r.started_at)!,
    endedAt: toIso(r.ended_at),
    mode: r.mode === 'agentic' ? 'agentic' : 'single',
    steps: Number(r.steps ?? 0),
  };
}

/** An agent question row as an API record. */
export function toQuestion(r: any): AgentQuestion {
  return {
    id: r.id,
    cardId: r.card_id,
    runId: r.run_id,
    stage: r.stage,
    agent: r.agent,
    question: r.question,
    why: r.why,
    askedTo: r.asked_to,
    status: r.status,
    answer: r.answer,
    answeredBy: r.answered_by,
    askedAt: toIso(r.asked_at)!,
    answeredAt: toIso(r.answered_at),
  };
}

/** A run event row as an API record. */
export function toEvent(r: any): RunEvent {
  return { id: Number(r.id), runId: r.run_id, at: toIso(r.at)!, kind: r.kind, text: r.text };
}

/** A risk row as an API record. */
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
    createdAt: toIso(r.created_at)!,
    residualLikelihood: r.residual_likelihood ?? null,
    residualImpact: r.residual_impact ?? null,
    residualScore: r.residual_likelihood && r.residual_impact ? r.residual_likelihood * r.residual_impact : null,
    acceptedBy: r.accepted_by ?? null,
    controlCount: Number(r.control_count ?? 0),
  };
}

/** An audit row as an API record. */
export function toAudit(r: any): AuditEntry {
  return {
    id: Number(r.id),
    at: toIso(r.at)!,
    actor: r.actor,
    action: r.action,
    entity: r.entity,
    detail: r.detail,
    realActor: r.real_actor ?? null,
  };
}

/** A card by id or key, or null. */
export async function getCard(q: Queryable, idOrKey: string): Promise<Card | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey);
  const { rows } = await q.query(`SELECT * FROM cards WHERE ${isUuid ? 'id' : 'key'} = $1`, [idOrKey]);
  return rows[0] ? toCard(rows[0]) : null;
}

/** An engagement by id, or null. */
export async function getEngagement(q: Queryable, id: string): Promise<Engagement | null> {
  const { rows } = await q.query(`SELECT * FROM engagements WHERE id = $1`, [id]);
  return rows[0] ? toEngagement(rows[0]) : null;
}

/** One workspace setting, or the fallback. */
export async function getSetting<T>(q: Queryable, key: string, fallback: T): Promise<T> {
  const { rows } = await q.query(`SELECT value FROM settings WHERE key = $1`, [key]);
  return rows[0] ? (rows[0].value as T) : fallback;
}

// Spend on billed providers since the start of this month in the workspace time zone.
export async function monthSpend(q: Queryable, timeZone = 'UTC'): Promise<number> {
  const { rows } = await q.query(
    `SELECT (SELECT COALESCE(SUM(cost_usd),0) FROM runs
              WHERE billed AND started_at >= (date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1))
          + (SELECT COALESCE(SUM(cost_usd),0) FROM ai_spend
              WHERE at >= (date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1)) AS usd`,
    [timeZone],
  );
  return num(rows[0].usd);
}

/** The workspace settings before anyone changes them. */
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
  embedProviderId: null,
  embedModel: '',
  verifierProviderId: null,
  verifierModel: '',
  verifierLive: false,
  assistantProviderId: null,
  assistantModel: '',
  assistantInstructions: '',
  connectorsAllowPrivate: false,
  allowActAs: false,
};

/** Every workspace setting, with the defaults filled in. */
export async function getSettings(q: Queryable): Promise<WorkspaceSettings> {
  const { rows } = await q.query(`SELECT key, value FROM settings`);
  const out: any = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  return out;
}

/** An agent row as an API record. */
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
    custom: !!r.custom,
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
    mode: r.mode === 'single' ? 'single' : 'agentic',
    maxSteps: Number(r.max_steps ?? DEFAULT_MAX_STEPS),
    selfCheck: r.self_check !== false,
    activeRuns: Number(r.active_runs ?? 0),
    killedAt: toIso(r.killed_at),
    killTestedAt: toIso(r.kill_tested_at),
    rulesVersion: null,
  };
}

/** The query for agents with their rules version and active runs. */
export const AGENT_SELECT = `
  SELECT a.*, (SELECT count(*)::int FROM runs r WHERE r.agent_id = a.id AND r.status = 'running') AS active_runs
  FROM agents a`;

// Stages where a built, enabled agent will pick cards up.
export async function agentStages(q: Queryable, engagementId: string): Promise<Stage[]> {
  const { rows } = await q.query(`SELECT role, stage FROM agents WHERE engagement_id = $1 AND enabled`, [engagementId]);
  return rows
    .filter((r: any) => AGENT_ROLES[r.role as AgentRole]?.built && r.role !== 'use_case_planner')
    .map((r: any) => r.stage);
}

/** The query for runs with their card's key. */
export const RUN_SELECT = `SELECT r.*, c.key AS card_key FROM runs r JOIN cards c ON c.id = r.card_id`;
/** The query for risks with their card's key and the number of controls that treat them. */
export const RISK_SELECT = `SELECT k.*, c.key AS card_key, (SELECT count(*) FROM control_risks cr WHERE cr.risk_id = k.id)::int AS control_count FROM risks k JOIN cards c ON c.id = k.card_id`;
