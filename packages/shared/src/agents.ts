// Agents per engagement, routing more than one agent per stage, engagements and modules.
import { z } from 'zod';
import { RiskTier } from './risks.js';
import { Module, Modules, MODULES, Stage } from './stages.js';

// ---------------------------------------------------------------------------
// Agents: one per stage, configured per engagement (Settings > Agents).
// ---------------------------------------------------------------------------
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
/** How much room the model has to answer (low to max output tokens). */
export const Effort = z.enum(EFFORTS);
export type Effort = z.infer<typeof Effort>;

/** The jobs an agent can do: one per stage, plus the Use Case Planner. */
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

/** Each agent role: its name, stage, whether it is built yet, a summary and the tools it may use. */
export const AGENT_ROLES: Record<
  AgentRole,
  { name: string; stage: Stage; built: boolean; summary: string; tools: AgentTool[] }
> = {
  use_case_planner: {
    name: 'Use Case Planner',
    stage: 'intake',
    built: true,
    summary: 'Talks a new use case through with the person who raises it and drafts the intake brief',
    tools: ['ask'],
  },
  risk_classifier: {
    name: 'Risk Classifier',
    stage: 'classify',
    built: true,
    summary: 'Tiers the use case, sets the oversight model, proposes starting risks',
    tools: ['read_profile', 'read_register', 'ask'],
  },
  control_designer: {
    name: 'Control Designer',
    stage: 'design',
    built: true,
    summary: 'Proposes controls for each approved risk from the control library',
    tools: ['read_profile', 'read_register', 'ask'],
  },
  evidence_collector: {
    name: 'Evidence Collector',
    stage: 'evidence',
    built: true,
    summary: 'Drafts the evidence request list for each control and checks what has arrived',
    tools: ['read_profile', 'read_register', 'read_evidence'],
  },
  control_tester: {
    name: 'Control Tester',
    stage: 'test',
    built: true,
    summary: 'Drafts test results from the attached evidence; a person concludes, someone else reviews',
    tools: ['read_register', 'read_evidence', 'ask'],
  },
  independent_reviewer: {
    name: 'Review assistant',
    stage: 'validate',
    built: true,
    summary: 'Lists challenges to the evidence pack for the person who signs off; not itself a second-line review',
    tools: ['read_register', 'read_evidence', 'ask'],
  },
  report_writer: {
    name: 'Report Writer',
    stage: 'report',
    built: true,
    summary: 'Drafts the board summary from the data, citing only figures it was given',
    tools: ['read_profile', 'read_register', 'read_evidence'],
  },
};

/** The groups of read-only tools an agent can be allowed (rule 23). */
export const AGENT_TOOLS = ['read_profile', 'read_register', 'read_evidence', 'ask'] as const;
/** How an agent works: agentic (looks things up, may ask, checks itself) or a single call. */
export const AgentMode = z.enum(['agentic', 'single']);
export type AgentMode = z.infer<typeof AgentMode>;
/** The default number of model steps per agentic run. */
export const DEFAULT_MAX_STEPS = 8;
/** The most model steps a run may take (rule 26). */
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
/** A person's answer to an agent's question (rule 27). */
export const AnswerQuestion = z.object({ answer: z.string().trim().min(1).max(4000) });
/** One group of read-only tools. */
export type AgentTool = (typeof AGENT_TOOLS)[number];

/** What each tool group lets an agent read, in words for Settings > AI Agents. */
export const AGENT_TOOL_INFO: Record<AgentTool, { label: string; hint: string }> = {
  read_profile: {
    label: 'Read use cases and the engagement',
    hint: 'This use case, the engagement, the AI inventory, and similar use cases (other engagements only if they are open to everyone)',
  },
  read_register: {
    label: 'Read the registers',
    hint: 'Risks, controls, tests, issues, incidents, the control library, evaluation results and how reviewers decided before. Read-only.',
  },
  read_evidence: { label: 'Read evidence', hint: 'Evidence files and notes on this engagement. Read-only.' },
  ask: {
    label: 'Ask a person a question',
    hint: 'The use case shows Question for You and the run pauses until someone answers or skips (at most 2 per stage)',
  },
};

// Which cards an agent takes. With two agents on one stage, a card goes to the
// most specific agent that takes it (a kind or priority beats a tier, a tier
// beats "all").
export const AgentRoute = z.enum([
  'all',
  'high_only',
  'not_minimal',
  'p1_only',
  'cat_decision',
  'cat_chatbot',
  'cat_agent',
  'cat_generative',
  'cat_analytics',
  'cat_other',
]);
export type AgentRoute = z.infer<typeof AgentRoute>;
/** Which cards an agent takes, in words (all, high tier only and so on). */
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
/** How specific a route is: the engine picks the most specific enabled agent that takes a card (rule 20). */
export const routeSpecificity = (r: AgentRoute) => (r === 'all' ? 0 : r === 'high_only' || r === 'not_minimal' ? 1 : 2);
/** Whether an agent with this route takes this card (by kind, priority or tier). */
export function routeTakes(
  route: AgentRoute,
  card: { tier: RiskTier | null; useCase: { category?: string; priority?: string } },
) {
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
/** The built-in agent role for a stage; added agents take their stage's role. */
export const roleForStage = (stage: string): AgentRole | null =>
  (Object.entries(AGENT_ROLES) as [AgentRole, (typeof AGENT_ROLES)[AgentRole]][]).find(
    ([, m]) => m.stage === stage && m.built,
  )?.[0] ?? null;

/** An engagement's agent: its role, model, fallback, instructions, tools, limits and kill switch state. */
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

/** A change to an agent's settings. */
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

/** Workspace-wide settings: spend cap, time zone, Verifier, assistant, connectors and act as. */
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

/** A client engagement: its details, gates, modules, appetite, client tools and archive state. */
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
  /** v1.7.4: new use cases follow the latest published client workflow (true) or none (false). */
  clientStepsDefault: boolean;
}

// Risk appetite: the highest residual score the engagement accepts without
// escalation, and who must accept anything above it.
export const RiskAppetite = z.object({
  maxResidual: z.number().int().min(1).max(25).default(8),
  statement: z.string().max(2000).default(''),
  escalateTo: z.string().max(120).default('Board Risk Committee'),
});
export type RiskAppetite = z.infer<typeof RiskAppetite>;

/** A change to an engagement's details, gates, modules or client tools. */
export const EngagementPatch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  client: z.string().trim().max(120).optional(),
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]{0,5}$/, 'Use 1 to 6 capital letters or digits, starting with a letter')
    .optional(),
  framework: z.string().trim().max(200).optional(),
  about: z.string().max(4000).optional(),
  paused: z.boolean().optional(),
  gates: z.record(z.boolean()).optional(),
  appetite: RiskAppetite.optional(),
  modules: z
    .object(
      Object.fromEntries(MODULES.map((m) => [m, z.boolean().optional()])) as Record<
        Module,
        z.ZodOptional<z.ZodBoolean>
      >,
    )
    .optional(),
  clientTools: z.array(z.string().max(40)).max(40).optional(),
  writeBack: z.boolean().optional(),
  clientStepsDefault: z.boolean().optional(),
});
