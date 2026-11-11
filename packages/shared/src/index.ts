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
  classify: 'Classify Risk',
  design: 'Design Controls',
  evidence: 'Collect Evidence',
  test: 'Test Controls',
  remediate: 'Remediate',
  validate: 'Validate',
  report: 'Board Report',
  closed: 'Closed',
};

// Five steps a person sees. Underneath, the engine keeps its eight stages, so
// every stage check, agent and test is unchanged; the board, Overview and
// report group them like this. Remediate is part of Test; Validate and the
// board report are one sign-off.
export const PHASES = ['intake', 'assess', 'controls', 'test', 'signoff', 'closed'] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABELS: Record<Phase, string> = {
  intake: 'Intake', assess: 'Assess Risk', controls: 'Controls', test: 'Test', signoff: 'Sign-off & Report', closed: 'Done',
};
export const PHASE_OF: Record<Stage, Phase> = {
  intake: 'intake', classify: 'assess', design: 'controls', evidence: 'test', test: 'test', remediate: 'test', validate: 'signoff', report: 'signoff', closed: 'closed',
};
export const PHASE_HINTS: Record<Phase, string> = {
  intake: 'New AI use cases. The AI helps write the brief; you decide which go forward.',
  assess: 'The AI drafts the risk tier and starting risks; you decide each one.',
  controls: 'The AI proposes controls for each risk; you decide each one.',
  test: 'Evidence, tests and fixes. The AI drafts; a person concludes and someone else reviews.',
  signoff: 'The AI challenges the evidence and drafts the board summary; a person signs off.',
  closed: 'Governed and reported.',
};
// The step inside a phase, shown on the card when a phase has more than one.
export const STEP_LABELS: Partial<Record<Stage, string>> = {
  evidence: 'Collecting Evidence', test: 'Testing', remediate: 'Fixing Findings', validate: 'Final Review', report: 'Board Report',
};

// Optional parts of an engagement. The core flow is always on; these are
// switched on per engagement under Engagement settings > General, so a new
// engagement starts simple. They are hidden when off, not removed.
export const MODULES = ['evals', 'incidents', 'inventory', 'connectors', 'soa', 'advanced_ai'] as const;
export type Module = (typeof MODULES)[number];
export const MODULE_INFO: Record<Module, { label: string; hint: string }> = {
  evals: { label: 'AI testing and monitoring', hint: 'Evaluation suites, red teaming against the OWASP LLM Top 10, scheduled runs and drift alerts' },
  incidents: { label: 'Incidents', hint: 'Record AI incidents with their regulatory notification deadlines' },
  inventory: { label: 'AI inventory', hint: 'Every AI system and agent in use at the client, with the agent register checks' },
  connectors: { label: 'Evidence connectors', hint: 'Pull reports and exports from the client\'s systems on a schedule' },
  soa: { label: 'Statement of Applicability and traceability', hint: 'Which controls apply and why, and the chain from obligation to evidence' },
  advanced_ai: { label: 'Advanced AI settings', hint: 'More than one agent per stage with routing, and testing the agents on the golden dataset' },
};
export type Modules = Record<Module, boolean>;
export const NO_MODULES: Modules = { evals: false, incidents: false, inventory: false, connectors: false, soa: false, advanced_ai: false };
export const ALL_MODULES: Modules = { evals: true, incidents: true, inventory: true, connectors: true, soa: true, advanced_ai: true };

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
export const CardStatus = z.enum(['idle', 'queued', 'running', 'needs_approval', 'changes_requested', 'failed', 'question']);
export type CardStatus = z.infer<typeof CardStatus>;

export const STATUS_LABELS: Record<CardStatus, string> = {
  idle: 'Waiting',
  queued: 'Queued',
  running: 'Agent Working',
  needs_approval: 'Needs Your Approval',
  changes_requested: 'Changes Requested',
  failed: 'Run Failed',
  question: 'Question for You',
};

export const Autonomy = z.enum(['assistive', 'human_in_loop', 'human_on_loop', 'autonomous']);
export type Autonomy = z.infer<typeof Autonomy>;

// What kind of AI it is, and how soon the team should look at it. Shown on the
// board card; the Planner suggests both, a person can change them.
export const UseCaseCategory = z.enum(['decision', 'chatbot', 'agent', 'generative', 'analytics', 'other']);
export type UseCaseCategory = z.infer<typeof UseCaseCategory>;
export const CATEGORY_LABELS: Record<UseCaseCategory, string> = {
  decision: 'Decision', chatbot: 'Chatbot', agent: 'AI agent', generative: 'Generative', analytics: 'Analytics', other: 'Other',
};
export const Priority = z.enum(['p1', 'p2', 'p3']);
export type Priority = z.infer<typeof Priority>;
export const PRIORITY_LABELS: Record<Priority, string> = { p1: 'P1 Urgent', p2: 'P2 Normal', p3: 'P3 Later' };

export const UseCaseInput = z.object({
  title: z.string().min(3).max(160),
  businessOwner: z.string().max(120).default(''),
  description: z.string().max(4000).default(''),
  dataUsed: z.string().max(2000).default(''),
  affectedPeople: z.string().max(1000).default(''),
  autonomy: Autonomy.default('human_in_loop'),
  vendor: z.string().max(200).default(''),
  category: UseCaseCategory.default('other'),
  priority: Priority.default('p2'),
});
export type UseCaseInput = z.infer<typeof UseCaseInput>;

// ---------------------------------------------------------------------------
// Plans: a use case being drafted before it reaches the board. The Use Case
// Planner asks questions and fills the brief; the person edits it and adds it
// to Intake under their own name. "Fill it in myself" skips the chat.
// ---------------------------------------------------------------------------
export const PlanBrief = z.object({
  title: z.string().max(160).default(''),
  businessOwner: z.string().max(120).default(''),
  description: z.string().max(4000).default(''),
  dataUsed: z.string().max(2000).default(''),
  affectedPeople: z.string().max(1000).default(''),
  autonomy: Autonomy.default('human_in_loop'),
  vendor: z.string().max(200).default(''),
  category: UseCaseCategory.default('other'),
  priority: Priority.default('p2'),
});
export type PlanBrief = z.infer<typeof PlanBrief>;
export const PLAN_FIELDS: { key: keyof PlanBrief; label: string; required: boolean }[] = [
  { key: 'title', label: 'Name', required: true },
  { key: 'description', label: 'What it does', required: true },
  { key: 'businessOwner', label: 'Business owner', required: true },
  { key: 'dataUsed', label: 'Data it uses', required: true },
  { key: 'affectedPeople', label: 'People affected', required: true },
  { key: 'autonomy', label: 'Autonomy', required: true },
  { key: 'vendor', label: 'Vendor or model', required: false },
  { key: 'category', label: 'Kind of AI', required: false },
  { key: 'priority', label: 'Priority', required: false },
];
export interface PlanMessage { role: 'planner' | 'user'; text: string; at: string; author: string; model?: string; runtime?: 'rules' | 'live' }
export interface Plan {
  id: string;
  key: string;
  mode: 'ai' | 'manual';
  status: 'draft' | 'added';
  brief: PlanBrief;
  /** Fields a person typed in the brief; the Planner won't overwrite them. */
  edited: string[];
  messages: PlanMessage[];
  missing: string[];
  cardKey: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

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
export const RunStatus = z.enum(['running', 'succeeded', 'failed', 'waiting']);
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
  /** The last person (not an agent) whose change to this card is in the audit log. */
  updatedBy?: string | null;
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
  /** v1.6: how the agent worked ('agentic' or 'single') and how many model steps it took. */
  mode: 'agentic' | 'single';
  steps: number;
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
  /** Set when an admin did this while acting as the actor. */
  realActor?: string | null;
}

// ---------------------------------------------------------------------------
// Providers and models (the "Models & keys" page). Shared by every engagement.
// ---------------------------------------------------------------------------
export const ProviderType = z.enum(['anthropic', 'openai', 'ollama', 'rules']);
export type ProviderType = z.infer<typeof ProviderType>;

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  anthropic: 'Anthropic format',
  openai: 'OpenAI-compatible format',
  ollama: 'Ollama format',
  rules: 'Built-in rules (offline)',
};

export const PROVIDER_DEFAULT_URLS: Record<ProviderType, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'http://localhost:1234/v1',
  ollama: 'https://ollama.com',
  rules: '',
};

// Ready-made settings for popular AI services. Most speak the OpenAI API, so
// they use the OpenAI-compatible connector with the right address filled in.
// Prices change often, so presets carry none: enter them on the Models page.
export interface ProviderPreset {
  id: string;
  label: string;
  type: Exclude<ProviderType, 'rules'>;
  name: string;
  baseUrl: string;
  billed: boolean;
  keyFrom: string;
  needsKey: boolean;
  hint: string;
  examples: string[];
}
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', type: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', billed: true, keyFrom: 'console.anthropic.com', needsKey: true, hint: 'Leave the address as is unless you use a gateway.', examples: ['claude-sonnet-5-5', 'claude-haiku-4-5'] },
  { id: 'openai', label: 'OpenAI', type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', billed: true, keyFrom: 'platform.openai.com/api-keys', needsKey: true, hint: 'Test finds every model on your account.', examples: [] },
  { id: 'azure', label: 'Azure OpenAI', type: 'openai', name: 'Azure OpenAI', baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1', billed: true, keyFrom: 'the Azure portal, under your resource\'s Keys and Endpoint', needsKey: true, hint: 'Replace YOUR-RESOURCE with your resource name. Add your deployment names as models.', examples: [] },
  { id: 'gemini', label: 'Google Gemini', type: 'openai', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', billed: true, keyFrom: 'aistudio.google.com/apikey', needsKey: true, hint: 'Google\'s OpenAI-compatible address.', examples: [] },
  { id: 'mistral', label: 'Mistral', type: 'openai', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', billed: true, keyFrom: 'console.mistral.ai', needsKey: true, hint: 'EU-hosted models.', examples: [] },
  { id: 'groq', label: 'Groq', type: 'openai', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', billed: true, keyFrom: 'console.groq.com/keys', needsKey: true, hint: 'Fast open-weight models.', examples: [] },
  { id: 'together', label: 'Together AI', type: 'openai', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', billed: true, keyFrom: 'api.together.ai', needsKey: true, hint: 'Hosted open-weight models.', examples: [] },
  { id: 'openrouter', label: 'OpenRouter', type: 'openai', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', billed: true, keyFrom: 'openrouter.ai/keys', needsKey: true, hint: 'One key for models from many companies. Model names look like company/model.', examples: [] },
  { id: 'deepseek', label: 'DeepSeek', type: 'openai', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', billed: true, keyFrom: 'platform.deepseek.com', needsKey: true, hint: 'Check where client data is processed before using it on client work.', examples: [] },
  { id: 'xai', label: 'xAI (Grok)', type: 'openai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', billed: true, keyFrom: 'console.x.ai', needsKey: true, hint: '', examples: [] },
  { id: 'perplexity', label: 'Perplexity', type: 'openai', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', billed: true, keyFrom: 'perplexity.ai/settings/api', needsKey: true, hint: 'Answers come back as JSON rather than tool calls; the harness handles that. Add model names by hand.', examples: ['sonar', 'sonar-pro'] },
  { id: 'ollama-cloud', label: 'Ollama Cloud', type: 'ollama', name: 'Ollama Cloud', baseUrl: 'https://ollama.com', billed: true, keyFrom: 'ollama.com/settings/keys', needsKey: true, hint: 'No /v1 at the end.', examples: [] },
  { id: 'ollama-local', label: 'Ollama on this computer', type: 'openai', name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', billed: false, keyFrom: '', needsKey: false, hint: 'Free and private: nothing leaves the machine. Start Ollama and pull a model first.', examples: [] },
  { id: 'lmstudio', label: 'LM Studio', type: 'openai', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', billed: false, keyFrom: '', needsKey: false, hint: 'Start the local server in LM Studio first.', examples: [] },
  { id: 'custom', label: 'Other OpenAI-compatible', type: 'openai', name: 'Custom provider', baseUrl: 'http://localhost:8000/v1', billed: false, keyFrom: '', needsKey: false, hint: 'vLLM, llama.cpp, a company gateway or anything else that speaks the OpenAI API. Usually ends in /v1.', examples: [] },
];

// Which service a provider points at, judged from its address. The connection
// type says how the harness talks to it (many services speak OpenAI's API);
// the service says who it is.
const SERVICE_HOSTS: [RegExp, string][] = [
  [/generativelanguage\.googleapis\.com/, 'Google Gemini API'],
  [/aiplatform\.googleapis\.com/, 'Google Vertex AI'],
  [/api\.anthropic\.com/, 'Anthropic API'],
  [/\.openai\.azure\.com|\.cognitiveservices\.azure\.com/, 'Azure OpenAI'],
  [/api\.openai\.com/, 'OpenAI API'],
  [/api\.mistral\.ai/, 'Mistral API'],
  [/api\.groq\.com/, 'Groq API'],
  [/api\.together\.(xyz|ai)/, 'Together AI API'],
  [/openrouter\.ai/, 'OpenRouter'],
  [/api\.deepseek\.com/, 'DeepSeek API'],
  [/api\.x\.ai/, 'xAI API'],
  [/api\.perplexity\.ai/, 'Perplexity API'],
  [/ollama\.com/, 'Ollama Cloud'],
  [/(localhost|127\.0\.0\.1):11434/, 'Ollama (this computer)'],
  [/(localhost|127\.0\.0\.1):1234/, 'LM Studio (this computer)'],
];
export function serviceOf(type: ProviderType, baseUrl: string): string {
  if (type === 'rules') return 'Built-in rules';
  const hit = SERVICE_HOSTS.find(([re]) => re.test(baseUrl ?? ''));
  if (hit) return hit[1];
  return type === 'anthropic' ? 'Anthropic API' : type === 'ollama' ? 'Ollama API' : 'Custom service';
}

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
  /** Who the provider is, e.g. "Google Gemini API". `type` is only how we connect. */
  service: string;
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
  'use_case_planner',
  'risk_classifier',
  'control_designer',
  'evidence_collector',
  'control_tester',
  'independent_reviewer',
  'report_writer',
]);
export type AgentRole = z.infer<typeof AgentRole>;

export const AGENT_ROLES: Record<AgentRole, { name: string; stage: Stage; built: boolean; summary: string; tools: AgentTool[] }> = {
  use_case_planner: { name: 'Use Case Planner', stage: 'intake', built: true, summary: 'Talks a new use case through with the person who raises it and drafts the intake brief', tools: ['ask'] },
  risk_classifier: { name: 'Risk Classifier', stage: 'classify', built: true, summary: 'Tiers the use case, sets the oversight model, proposes starting risks', tools: ['read_profile', 'read_register', 'ask'] },
  control_designer: { name: 'Control Designer', stage: 'design', built: true, summary: 'Proposes controls for each approved risk from the control library', tools: ['read_profile', 'read_register', 'ask'] },
  evidence_collector: { name: 'Evidence Collector', stage: 'evidence', built: true, summary: 'Drafts the evidence request list for each control and checks what has arrived', tools: ['read_profile', 'read_register', 'read_evidence'] },
  control_tester: { name: 'Control Tester', stage: 'test', built: true, summary: 'Drafts test results from the attached evidence; a person concludes, someone else reviews', tools: ['read_register', 'read_evidence', 'ask'] },
  independent_reviewer: { name: 'Review assistant', stage: 'validate', built: true, summary: 'Lists challenges to the evidence pack for the person who signs off; not itself a second-line review', tools: ['read_register', 'read_evidence', 'ask'] },
  report_writer: { name: 'Report Writer', stage: 'report', built: true, summary: 'Drafts the board summary from the data, citing only figures it was given', tools: ['read_profile', 'read_register', 'read_evidence'] },
};

export const AGENT_TOOLS = ['read_profile', 'read_register', 'read_evidence', 'ask'] as const;
export const AgentMode = z.enum(['agentic', 'single']);
export type AgentMode = z.infer<typeof AgentMode>;
export const DEFAULT_MAX_STEPS = 8;
export const MAX_STEPS_LIMIT = 20;
/** Most questions an agent may ask a person about one card at one stage. */
export const MAX_QUESTIONS = 2;

// A question an agent asked a person (v1.6, rule 27). The run pauses until it is answered or skipped.
export interface AgentQuestion {
  id: string;
  cardId: string | null;
  runId: string | null;
  stage: string;
  agent: string;
  question: string;
  why: string;
  askedTo: string;
  status: 'open' | 'answered' | 'skipped';
  answer: string | null;
  answeredBy: string | null;
  askedAt: string;
  answeredAt: string | null;
}
export const AnswerQuestion = z.object({ answer: z.string().trim().min(1).max(4000) });
export type AgentTool = (typeof AGENT_TOOLS)[number];

export const AGENT_TOOL_INFO: Record<AgentTool, { label: string; hint: string }> = {
  read_profile: { label: 'Read use cases and the engagement', hint: 'This use case, the engagement, the AI inventory, and similar use cases (other engagements only if they are open to everyone)' },
  read_register: { label: 'Read the registers', hint: 'Risks, controls, tests, issues, incidents, the control library, evaluation results and how reviewers decided before. Read-only.' },
  read_evidence: { label: 'Read evidence', hint: 'Evidence files and notes on this engagement. Read-only.' },
  ask: { label: 'Ask a person a question', hint: 'The use case shows Question for You and the run pauses until someone answers or skips (at most 2 per stage)' },
};

// Which cards an agent takes. With two agents on one stage, a card goes to the
// most specific agent that takes it (a kind or priority beats a tier, a tier
// beats "all").
export const AgentRoute = z.enum([
  'all', 'high_only', 'not_minimal', 'p1_only',
  'cat_decision', 'cat_chatbot', 'cat_agent', 'cat_generative', 'cat_analytics', 'cat_other',
]);
export type AgentRoute = z.infer<typeof AgentRoute>;
export const ROUTE_LABELS: Record<AgentRoute, string> = {
  all: 'All cards',
  high_only: 'High and prohibited tier only',
  not_minimal: 'Everything but minimal tier',
  p1_only: 'P1 urgent cards only',
  cat_decision: 'Decision systems only',
  cat_chatbot: 'Chatbots only',
  cat_agent: 'AI agents only',
  cat_generative: 'Generative AI only',
  cat_analytics: 'Analytics only',
  cat_other: 'Other kinds only',
};
export const routeSpecificity = (r: AgentRoute) => (r === 'all' ? 0 : r === 'high_only' || r === 'not_minimal' ? 1 : 2);
export function routeTakes(route: AgentRoute, card: { tier: RiskTier | null; useCase: { category?: string; priority?: string } }) {
  if (route === 'all') return true;
  if (route === 'p1_only') return card.useCase.priority === 'p1';
  if (route.startsWith('cat_')) return (card.useCase.category ?? 'other') === route.slice(4);
  if (!card.tier) return true;
  if (route === 'high_only') return card.tier === 'high' || card.tier === 'prohibited';
  return card.tier !== 'minimal';
}

// Adding an agent: it takes a stage, and does that stage's job (the stage's
// built-in role) with its own model, instructions, routing and limits.
export const NewAgent = z.object({
  stage: z.string(),
  name: z.string().trim().min(2).max(60),
  enabled: z.boolean().default(true),
  route: AgentRoute.default('all'),
  providerId: z.string().uuid().nullable().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  effort: Effort.optional(),
  fallbackProviderId: z.string().uuid().nullable().optional(),
  fallbackModel: z.string().trim().max(120).nullable().optional(),
  summary: z.string().max(200).default(''),
  instructions: z.string().max(8000).default(''),
  tools: z.array(z.enum(AGENT_TOOLS)).optional(),
  maxCostUsd: z.number().min(0).max(1000).optional(),
  timeoutMin: z.number().int().min(1).max(120).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
});
export type NewAgent = z.infer<typeof NewAgent>;
export const roleForStage = (stage: string): AgentRole | null =>
  ((Object.entries(AGENT_ROLES) as [AgentRole, (typeof AGENT_ROLES)[AgentRole]][]).find(([, m]) => m.stage === stage && m.built)?.[0]) ?? null;

export interface AgentConfig {
  id: string;
  engagementId: string;
  role: AgentRole;
  name: string;
  stage: Stage;
  route: AgentRoute;
  enabled: boolean;
  built: boolean;
  /** Added by a person (can be deleted); the built-in agent for a stage can only be turned off. */
  custom: boolean;
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
  /** v1.6: 'agentic' looks things up and checks its work; 'single' is one call (the v1.5 behaviour). */
  mode: AgentMode;
  /** Most model steps in one run; the last step must hand in the draft. */
  maxSteps: number;
  /** One critique of its own draft against the role's rubric before handing it in. */
  selfCheck: boolean;
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
  mode: AgentMode.optional(),
  maxSteps: z.number().int().min(2).max(MAX_STEPS_LIMIT).optional(),
  selfCheck: z.boolean().optional(),
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
  // The assistant's model. None means the offline assistant.
  assistantProviderId: z.string().uuid().nullable(),
  assistantModel: z.string().max(120),
  // Added to the assistant's own rules for every answer, never replacing them:
  // house style, what the firm calls things, what to stress.
  assistantInstructions: z.string().max(4000),
  // Evidence connectors may reach addresses on a private network or this
  // machine only when an admin allows it (off by default, against SSRF).
  connectorsAllowPrivate: z.boolean(),
  // Act as: an admin can work as any other person without signing out, to
  // run the whole flow alone (demos, testing, training). Off by default:
  // segregation of duties then rests on the audit log, which names both.
  allowActAs: z.boolean(),
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
  // 'open': everyone signed in can see it; 'members': its members and admins.
  access: 'open' | 'members';
  /** Optional parts switched on for this engagement (see MODULES). */
  modules: Modules;
  /** v1.7.2: the business tools this client uses (BUSINESS_TOOLS ids). Shapes tool lists in workflows and connectors. */
  clientTools: string[];
  /** v1.7.3: ARGUS may send messages and create tickets in the client's tools (off by default). */
  writeBack: boolean;
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
  modules: z.object(Object.fromEntries(MODULES.map((m) => [m, z.boolean().optional()])) as Record<Module, z.ZodOptional<z.ZodBoolean>>).optional(),
  clientTools: z.array(z.string().max(40)).max(40).optional(),
  writeBack: z.boolean().optional(),
});
export * from './grc.js';
export * from './workflow.js';
export * from './tools-catalog.js';
export * from './integrations.js';
