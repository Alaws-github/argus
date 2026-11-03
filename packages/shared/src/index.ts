// Shared domain model for the Governance & Risk harness.
// Used by the server (validation, agent output parsing) and the web app (labels, types).
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Stages: each column on the board. One agent owns a stage; a gate means a
// named person approves the agent's output before the card moves on.
// ---------------------------------------------------------------------------
export const STAGES = [
  'intake',
  'classify',
  'design',
  'evidence',
  'test',
  'remediate',
  'validate',
  'report',
  'closed',
] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

export const STAGE_LABELS: Record<Stage, string> = {
  intake: 'Intake',
  classify: 'Classify risk',
  design: 'Design controls',
  evidence: 'Collect evidence',
  test: 'Test controls',
  remediate: 'Remediate',
  validate: 'Validate',
  report: 'Board report',
  closed: 'Closed',
};

export const STAGE_HINTS: Record<Stage, string> = {
  intake: 'New AI use cases. You decide which go forward.',
  classify: 'Risk Classifier · tier, oversight, starting risks',
  design: 'Control Designer · controls mapped to each risk',
  evidence: 'Evidence Collector · request list and gap check',
  test: 'Control Tester · drafts results for a person to conclude',
  remediate: 'Control owner · fixes what failed testing',
  validate: 'Review assistant drafts challenges · a person signs off',
  report: 'Report Writer drafts the board summary · a person approves',
  closed: 'Governed and reported',
};

// Stages that have an agent wired up. The rest are moved by a person for now.
export const AGENT_STAGES: Stage[] = ['classify', 'design', 'evidence', 'test', 'validate', 'report'];
// Stages where an agent only drafts: the card always stops for a person, gate or no gate.
export const DRAFT_STAGES: Stage[] = ['evidence', 'test', 'validate', 'report'];

// Default gates: a person signs off before the card leaves these stages.
export const DEFAULT_GATES: Record<Stage, boolean> = {
  intake: true,
  classify: true,
  design: true,
  evidence: false,
  test: false,
  remediate: false,
  validate: true,
  report: true,
  closed: false,
};

export function nextStage(s: Stage): Stage | null {
  const i = STAGES.indexOf(s);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

// ---------------------------------------------------------------------------
// Card = an AI use case moving through governance.
// ---------------------------------------------------------------------------
export const CardStatus = z.enum(['idle', 'queued', 'running', 'needs_approval', 'changes_requested', 'failed']);
export type CardStatus = z.infer<typeof CardStatus>;

export const STATUS_LABELS: Record<CardStatus, string> = {
  idle: 'Waiting',
  queued: 'Queued',
  running: 'Agent working',
  needs_approval: 'Needs your approval',
  changes_requested: 'Changes requested',
  failed: 'Run failed',
};

export const Autonomy = z.enum(['assistive', 'human_in_loop', 'human_on_loop', 'autonomous']);
export type Autonomy = z.infer<typeof Autonomy>;

export const UseCaseInput = z.object({
  title: z.string().min(3).max(160),
  businessOwner: z.string().max(120).default(''),
  description: z.string().max(4000).default(''),
  dataUsed: z.string().max(2000).default(''),
  affectedPeople: z.string().max(1000).default(''),
  autonomy: Autonomy.default('human_in_loop'),
  vendor: z.string().max(200).default(''),
});
export type UseCaseInput = z.infer<typeof UseCaseInput>;

// ---------------------------------------------------------------------------
// Risk tiers. Modelled on the EU AI Act's four tiers, which most clients
// recognise; mapped to NIST AI RMF "Map" outputs in the classifier prompt.
// ---------------------------------------------------------------------------
export const RiskTier = z.enum(['prohibited', 'high', 'limited', 'minimal']);
export type RiskTier = z.infer<typeof RiskTier>;

export const TIER_LABELS: Record<RiskTier, string> = {
  prohibited: 'Prohibited',
  high: 'High',
  limited: 'Limited',
  minimal: 'Minimal',
};

export const Oversight = z.enum(['human_in_command', 'human_in_loop', 'human_on_loop']);
export type Oversight = z.infer<typeof Oversight>;

export const OVERSIGHT_LABELS: Record<Oversight, string> = {
  human_in_command: 'Human in command',
  human_in_loop: 'Human in the loop',
  human_on_loop: 'Human on the loop',
};

export const RiskCategory = z.enum([
  'privacy',
  'fairness',
  'accuracy',
  'security',
  'transparency',
  'accountability',
  'third_party',
  'regulatory',
  'operational',
]);
export type RiskCategory = z.infer<typeof RiskCategory>;

export const ProposedRisk = z.object({
  title: z.string().min(3).max(200),
  category: RiskCategory,
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  rationale: z.string().max(600),
  // Knowledge-base passages (K-ids) the risk rests on. Checked by the server.
  sources: z.array(z.string().max(12)).max(6).default([]),
});
export type ProposedRisk = z.infer<typeof ProposedRisk>;

// What the Risk Classifier must return. The server rejects anything else.
export const Classification = z.object({
  tier: RiskTier,
  tierRationale: z.string().min(10).max(1200),
  oversight: Oversight,
  oversightRationale: z.string().max(800),
  factors: z.array(z.string().max(200)).max(10),
  risks: z.array(ProposedRisk).min(1).max(8),
  openQuestions: z.array(z.string().max(300)).max(6),
  frameworkRefs: z.array(z.string().max(80)).max(8),
  tierSources: z.array(z.string().max(12)).max(6).default([]),
  // The passages the agent cited, copied at run time so the reviewer reads exactly what it saw.
  sourcePassages: z.array(z.any()).default([]),
});
export type Classification = z.infer<typeof Classification>;

export function riskScore(likelihood: number, impact: number) {
  return likelihood * impact;
}
export function riskRating(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 20) return 'critical';
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Runs, controls, audit
// ---------------------------------------------------------------------------
export const RunStatus = z.enum(['running', 'succeeded', 'failed']);
export type RunStatus = z.infer<typeof RunStatus>;

export const ControlType = z.enum(['preventive', 'detective', 'corrective']);
export const ControlStatus = z.enum(['proposed', 'designed', 'operating', 'failed']);

export interface Card {
  id: string;
  engagementId: string;
  number: number;
  key: string;
  title: string;
  stage: Stage;
  status: CardStatus;
  statusNote: string | null;
  useCase: UseCaseInput;
  tier: RiskTier | null;
  classification: Classification | null;
  design: import('./grc.js').ControlDesign | null;
  createdBy: string | null;
  drafts: import('./grc.js').CardDrafts;
  decisions: import('./grc.js').CardDecisions;
  verification: import('./grc.js').CardVerification;
  latestRunId: string | null;
  costUsd: number;
  createdAt: string;
  stageEnteredAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  number: number;
  cardId: string;
  cardKey: string;
  stage: Stage;
  agent: string;
  model: string;
  runtime: 'live' | 'dry-run';
  status: RunStatus;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  startedAt: string;
  endedAt: string | null;
}

export interface RunEvent {
  id: number;
  runId: string;
  at: string;
  kind: 'step' | 'output' | 'error';
  text: string;
}

export interface Risk {
  id: string;
  key: string;
  cardId: string;
  cardKey: string;
  title: string;
  category: RiskCategory;
  likelihood: number;
  impact: number;
  score: number;
  owner: string;
  treatment: 'mitigate' | 'accept' | 'transfer' | 'avoid';
  status: 'open' | 'treated' | 'closed';
  rationale: string;
  createdAt: string;
  residualLikelihood: number | null;
  residualImpact: number | null;
  residualScore: number | null;
  acceptedBy: string | null;
  controlCount: number;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Providers and models (the "Models & keys" page). Shared by every engagement.
// ---------------------------------------------------------------------------
export const ProviderType = z.enum(['anthropic', 'openai', 'ollama', 'rules']);
export type ProviderType = z.infer<typeof ProviderType>;

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI-compatible',
  ollama: 'Ollama Cloud',
  rules: 'Built-in rules (offline)',
};

export const PROVIDER_DEFAULT_URLS: Record<ProviderType, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'http://localhost:1234/v1',
  ollama: 'https://ollama.com',
  rules: '',
};

// USD per million tokens.
export const ModelPrice = z.object({
  input: z.number().min(0),
  cached: z.number().min(0).default(0),
  output: z.number().min(0),
});
export type ModelPrice = z.infer<typeof ModelPrice>;

export interface Provider {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl: string;
  enabled: boolean;
  builtIn: boolean;
  status: 'connected' | 'error' | 'untested';
  statusText: string | null;
  checkedAt: string | null;
  models: string[];
  key: { set: boolean; masked: string | null; fromEnv: boolean };
  billed: boolean;
  maxConcurrent: number | null;
  prices: Record<string, ModelPrice>;
  unpriced: string[];
  usedBy: number;
}

export const ProviderInput = z.object({
  type: ProviderType.exclude(['rules']),
  name: z.string().trim().min(2).max(60),
  baseUrl: z.string().trim().url().max(300),
  apiKey: z.string().max(500).optional(),
  billed: z.boolean().default(true),
  maxConcurrent: z.number().int().min(1).max(100).nullable().default(null),
  models: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  prices: z.record(ModelPrice).optional(),
  enabled: z.boolean().optional(),
});
export type ProviderInput = z.infer<typeof ProviderInput>;

// ---------------------------------------------------------------------------
// Agents: one per stage, configured per engagement (Settings > Agents).
// ---------------------------------------------------------------------------
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const Effort = z.enum(EFFORTS);
export type Effort = z.infer<typeof Effort>;

export const AgentRole = z.enum([
  'risk_classifier',
  'control_designer',
  'evidence_collector',
  'control_tester',
  'independent_reviewer',
  'report_writer',
]);
export type AgentRole = z.infer<typeof AgentRole>;

export const AGENT_ROLES: Record<AgentRole, { name: string; stage: Stage; built: boolean; summary: string; tools: AgentTool[] }> = {
  risk_classifier: { name: 'Risk Classifier', stage: 'classify', built: true, summary: 'Tiers the use case, sets the oversight model, proposes starting risks', tools: ['read_profile', 'ask'] },
  control_designer: { name: 'Control Designer', stage: 'design', built: true, summary: 'Proposes controls for each approved risk from the control library', tools: ['read_profile', 'read_register', 'ask'] },
  evidence_collector: { name: 'Evidence Collector', stage: 'evidence', built: true, summary: 'Drafts the evidence request list for each control and checks what has arrived', tools: ['read_profile', 'read_register', 'read_evidence'] },
  control_tester: { name: 'Control Tester', stage: 'test', built: true, summary: 'Drafts test results from the attached evidence; a person concludes, someone else reviews', tools: ['read_register', 'read_evidence', 'ask'] },
  independent_reviewer: { name: 'Review assistant', stage: 'validate', built: true, summary: 'Lists challenges to the evidence pack for the person who signs off; not itself a second-line review', tools: ['read_register', 'read_evidence', 'ask'] },
  report_writer: { name: 'Report Writer', stage: 'report', built: true, summary: 'Drafts the board summary from the data, citing only figures it was given', tools: ['read_profile', 'read_register', 'read_evidence'] },
};

export const AGENT_TOOLS = ['read_profile', 'read_register', 'read_evidence', 'ask'] as const;
export type AgentTool = (typeof AGENT_TOOLS)[number];

export const AGENT_TOOL_INFO: Record<AgentTool, { label: string; hint: string }> = {
  read_profile: { label: 'Read the use case profile', hint: 'What the business wrote about the use case' },
  read_register: { label: 'Read the risk and control registers', hint: 'For this engagement only' },
  read_evidence: { label: 'Read evidence', hint: 'Items already collected for this use case. Read-only.' },
  ask: { label: 'Ask you a question', hint: 'Stops the card at Needs you until you answer' },
};

export const AgentRoute = z.enum(['all', 'high_only', 'not_minimal']);
export const ROUTE_LABELS: Record<z.infer<typeof AgentRoute>, string> = {
  all: 'All use cases',
  high_only: 'High and prohibited tier only',
  not_minimal: 'Everything but minimal tier',
};

export interface AgentConfig {
  id: string;
  engagementId: string;
  role: AgentRole;
  name: string;
  stage: Stage;
  route: z.infer<typeof AgentRoute>;
  enabled: boolean;
  built: boolean;
  providerId: string | null;
  model: string;
  effort: Effort;
  fallbackProviderId: string | null;
  fallbackModel: string | null;
  summary: string;
  instructions: string;
  tools: AgentTool[];
  maxCostUsd: number;
  timeoutMin: number;
  concurrency: number;
  activeRuns: number;
  killedAt: string | null;
  killTestedAt: string | null;
  // sha256 prefix of the agent's built-in rules file, stamped on every run.
  rulesVersion: string | null;
}

export const AgentPatch = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  enabled: z.boolean().optional(),
  route: AgentRoute.optional(),
  providerId: z.string().uuid().nullable().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  effort: Effort.optional(),
  fallbackProviderId: z.string().uuid().nullable().optional(),
  fallbackModel: z.string().trim().max(120).nullable().optional(),
  summary: z.string().max(200).optional(),
  instructions: z.string().max(8000).optional(),
  tools: z.array(z.enum(AGENT_TOOLS)).optional(),
  maxCostUsd: z.number().min(0).max(1000).optional(),
  timeoutMin: z.number().int().min(1).max(120).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
});
export type AgentPatch = z.infer<typeof AgentPatch>;

export const WorkspaceSettings = z.object({
  autoStart: z.boolean(),
  spendCapUsd: z.number().min(0).max(100000).nullable(),
  warnAtPct: z.union([z.literal(50), z.literal(75), z.literal(90)]),
  pauseAtCap: z.boolean(),
  timeZone: z.string().min(1).max(60),
  defaultProviderId: z.string().uuid().nullable(),
  defaultModel: z.string().max(120),
  defaultEffort: Effort,
  defaultFallbackModel: z.string().max(120).nullable(),
  // Meaning-based search: an OpenAI-compatible or Ollama provider and its embedding model.
  embedProviderId: z.string().uuid().nullable(),
  embedModel: z.string().max(120),
  // The Verifier: which model judges drafts, and whether it checks every new
  // classification and control design by itself. Off by default.
  verifierProviderId: z.string().uuid().nullable(),
  verifierModel: z.string().max(120),
  verifierLive: z.boolean(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

export interface Engagement {
  id: string;
  slug: string;
  name: string;
  prefix: string;
  color: string;
  client: string;
  gates: Record<Stage, boolean>;
  framework: string;
  about: string;
  paused: boolean;
  appetite: RiskAppetite;
  reportSignedBy: string | null;
  reportSignedAt: string | null;
  sector: string;
  createdAt: string;
  // Archived engagements are read-only and hidden from the switcher's main list.
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
}

// Risk appetite: the highest residual score the engagement accepts without
// escalation, and who must accept anything above it.
export const RiskAppetite = z.object({
  maxResidual: z.number().int().min(1).max(25).default(8),
  statement: z.string().max(2000).default(''),
  escalateTo: z.string().max(120).default('Board Risk Committee'),
});
export type RiskAppetite = z.infer<typeof RiskAppetite>;

export const EngagementPatch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  client: z.string().trim().max(120).optional(),
  prefix: z.string().trim().regex(/^[A-Z][A-Z0-9]{0,5}$/, 'Use 1 to 6 capital letters or digits, starting with a letter').optional(),
  framework: z.string().trim().max(200).optional(),
  about: z.string().max(4000).optional(),
  paused: z.boolean().optional(),
  gates: z.record(z.boolean()).optional(),
  appetite: RiskAppetite.optional(),
});
export * from './grc.js';
