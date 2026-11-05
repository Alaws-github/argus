// v0.3 domain: people and permissions, controls, inventory, testing, evidence,
// issues, evaluations and readiness assessment. All names are generic and all
// references point at public standards.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// People, roles, segregation of duties
// ---------------------------------------------------------------------------
export const ROLES = ['admin', 'lead', 'reviewer', 'preparer', 'viewer'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  lead: 'Engagement lead',
  reviewer: 'Reviewer',
  preparer: 'Preparer',
  viewer: 'Viewer',
};

export const ROLE_HINTS: Record<Role, string> = {
  admin: 'Everything, including users, models and workspace settings',
  lead: 'Runs engagements: settings, gates, risk acceptance, report sign-off',
  reviewer: 'Approves gates and reviews tests prepared by someone else',
  preparer: 'Adds use cases, controls, tests, evidence and issues',
  viewer: 'Reads everything, changes nothing',
};

export type Permission =
  | 'read'
  | 'prepare' // create and edit working items
  | 'approve' // gate approvals, test review
  | 'accept_risk'
  | 'sign_off_report'
  | 'manage_engagement'
  | 'manage_agents'
  | 'manage_models'
  | 'manage_users';

const P: Record<Role, Permission[]> = {
  admin: ['read', 'prepare', 'approve', 'accept_risk', 'sign_off_report', 'manage_engagement', 'manage_agents', 'manage_models', 'manage_users'],
  lead: ['read', 'prepare', 'approve', 'accept_risk', 'sign_off_report', 'manage_engagement', 'manage_agents'],
  reviewer: ['read', 'prepare', 'approve'],
  preparer: ['read', 'prepare'],
  viewer: ['read'],
};
export const can = (role: Role | undefined, p: Permission) => !!role && P[role].includes(p);

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  // Names this person used before; their past approvals carry those names.
  formerNames: string[];
  /** Set while an admin is acting as this person: the admin who really is signed in. */
  realUser?: { id: string; name: string; email: string } | null;
}

// ---------------------------------------------------------------------------
// Control library and register
// ---------------------------------------------------------------------------
export const CONTROL_DOMAINS = ['governance', 'risk', 'data', 'model', 'security', 'oversight', 'transparency', 'third_party', 'monitoring'] as const;
export type ControlDomain = (typeof CONTROL_DOMAINS)[number];
export const DOMAIN_LABELS: Record<ControlDomain, string> = {
  governance: 'Governance and accountability',
  risk: 'Risk and impact assessment',
  data: 'Data governance and privacy',
  model: 'Model testing and validation',
  security: 'Security',
  oversight: 'Human oversight',
  transparency: 'Transparency',
  third_party: 'Third parties',
  monitoring: 'Monitoring and incidents',
};

export interface FrameworkRefs {
  nistAiRmf?: string[];
  iso42001?: string[];
  nistCsf?: string[];
  coso?: string[];
  euAiAct?: string[];
  jdpa?: string[];
  owasp?: string[];
}

export const FRAMEWORK_LABELS: Record<keyof FrameworkRefs, string> = {
  nistAiRmf: 'NIST AI RMF',
  iso42001: 'ISO/IEC 42001',
  nistCsf: 'NIST CSF 2.0',
  coso: 'COSO',
  euAiAct: 'EU AI Act',
  jdpa: 'Jamaica DPA',
  owasp: 'OWASP',
};

export interface LibraryControl {
  id: string;
  code: string;
  title: string;
  objective: string;
  domain: ControlDomain;
  type: 'preventive' | 'detective' | 'corrective';
  frequency: string;
  evidenceExpected: string;
  testProcedure: string;
  riskCategories: string[];
  refs: FrameworkRefs;
  builtIn: boolean;
}

export const ControlStatus = z.enum(['proposed', 'designed', 'operating', 'failed']);
export type ControlStatus = z.infer<typeof ControlStatus>;

export interface EngagementControl {
  id: string;
  key: string;
  engagementId: string;
  cardId: string | null;
  cardKey: string | null;
  libraryId: string | null;
  libraryCode: string | null;
  title: string;
  objective: string;
  type: string;
  frequency: string;
  owner: string;
  status: ControlStatus;
  refs: FrameworkRefs;
  riskIds: string[];
  riskKeys: string[];
  tests: { total: number; passed: number; failed: number; open: number };
  evidence: number;
  openIssues: number;
}

export const ControlInput = z.object({
  title: z.string().trim().min(3).max(200),
  objective: z.string().max(2000).default(''),
  type: z.enum(['preventive', 'detective', 'corrective']).default('preventive'),
  frequency: z.string().max(60).default('per change'),
  owner: z.string().max(120).default(''),
  status: ControlStatus.optional(),
  libraryId: z.string().uuid().nullable().optional(),
  cardId: z.string().uuid().nullable().optional(),
  riskIds: z.array(z.string().uuid()).default([]),
});

export interface Obligation {
  id: string;
  source: string;
  ref: string;
  title: string;
  summary: string;
  libraryCodes: string[];
}

// What the Control Designer returns.
export const ControlDesign = z.object({
  controls: z
    .array(
      z.object({
        libraryCode: z.string().max(20).nullable(),
        title: z.string().min(3).max(200),
        objective: z.string().max(800),
        owner: z.string().max(120),
        riskTitles: z.array(z.string().max(200)).min(1),
        testApproach: z.string().max(800),
        sources: z.array(z.string().max(12)).max(6).default([]),
      }),
    )
    .min(1)
    .max(16),
  gaps: z.array(z.string().max(300)).max(8),
  sourcePassages: z.array(z.any()).default([]),
});
export type ControlDesign = z.infer<typeof ControlDesign>;

// ---------------------------------------------------------------------------
// AI inventory and agent register
// ---------------------------------------------------------------------------
export const INVENTORY_KINDS = ['system', 'model', 'agent', 'dataset', 'vendor'] as const;
export const InventoryKind = z.enum(INVENTORY_KINDS);
export type InventoryKind = z.infer<typeof InventoryKind>;

export const InventoryInput = z.object({
  kind: InventoryKind,
  name: z.string().trim().min(2).max(160),
  owner: z.string().max(120).default(''),
  description: z.string().max(2000).default(''),
  vendor: z.string().max(160).default(''),
  status: z.enum(['proposed', 'live', 'retired']).default('live'),
  cardIds: z.array(z.string().uuid()).default([]),
  // Agent register fields (used when kind = agent)
  identity: z.string().max(200).default(''),
  mandate: z.string().max(2000).default(''),
  limits: z.string().max(500).default(''),
  approvalThreshold: z.string().max(300).default(''),
  stepLimit: z.number().int().min(0).max(10000).nullable().default(null),
  killSwitchTestedAt: z.string().nullable().default(null),
  lastReviewAt: z.string().nullable().default(null),
});
export type InventoryInput = z.infer<typeof InventoryInput>;

export interface InventoryItem extends InventoryInput {
  id: string;
  key: string;
  cardKeys: string[];
  readiness: { ok: boolean; missing: string[] } | null;
  createdAt: string;
}

// An agent is ready to act alone only when all of these hold.
export function agentReadiness(i: Pick<InventoryInput, 'owner' | 'identity' | 'mandate' | 'limits' | 'approvalThreshold' | 'stepLimit' | 'killSwitchTestedAt' | 'lastReviewAt'>, now = Date.now()) {
  const days = (d: string | null) => (d ? (now - Date.parse(d)) / 864e5 : Infinity);
  const missing: string[] = [];
  if (!i.owner) missing.push('A named human owner');
  if (!i.identity) missing.push('Its own identity (not a shared login)');
  if (!i.mandate) missing.push('A written mandate: what it may do and touch');
  if (!i.limits) missing.push('Limits on value or volume');
  if (!i.approvalThreshold) missing.push('An approval threshold for a person');
  if (!i.stepLimit) missing.push('A step limit');
  if (days(i.killSwitchTestedAt) > 90) missing.push('A kill switch tested in the last 90 days');
  if (days(i.lastReviewAt) > 90) missing.push('An independent review in the last 90 days');
  return { ok: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Testing, evidence, issues
// ---------------------------------------------------------------------------
export const TEST_STATUSES = ['not_started', 'in_progress', 'passed', 'failed', 'blocked'] as const;
export const TestStatus = z.enum(TEST_STATUSES);
export type TestStatus = z.infer<typeof TestStatus>;
export const TEST_STATUS_LABELS: Record<TestStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  passed: 'Passed',
  failed: 'Failed',
  blocked: 'Blocked',
};

export const TestInput = z.object({
  controlId: z.string().uuid(),
  kind: z.enum(['design', 'operating', 'automated', 'retest']).default('operating'),
  title: z.string().trim().min(3).max(200),
  procedure: z.string().max(4000).default(''),
  population: z.string().max(300).default(''),
  sampleSize: z.number().int().min(0).max(100000).nullable().default(null),
  expected: z.string().max(1000).default(''),
});

export interface ControlTest {
  id: string;
  key: string;
  engagementId: string;
  controlId: string;
  controlKey: string;
  controlTitle: string;
  kind: 'design' | 'operating' | 'automated' | 'retest';
  title: string;
  procedure: string;
  population: string;
  sampleSize: number | null;
  expected: string;
  actual: string;
  exceptions: number;
  status: TestStatus;
  preparedBy: string | null;
  preparedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  evidence: number;
  createdAt: string;
  // The Control Tester's suggestion. Never a result: a person concludes the test.
  draft: TestDraft | null;
}

export interface Evidence {
  id: string;
  key: string;
  engagementId: string;
  title: string;
  kind: 'file' | 'link' | 'note' | 'run';
  filename: string | null;
  mime: string | null;
  size: number | null;
  sha256: string;
  url: string | null;
  note: string | null;
  source: string;
  collectedBy: string;
  collectedAt: string;
  controlId: string | null;
  testId: string | null;
  verified: boolean | null;
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

export const ISSUE_STATUSES = ['open', 'in_remediation', 'ready_for_retest', 'closed', 'risk_accepted'] as const;
export const IssueStatus = z.enum(ISSUE_STATUSES);
export type IssueStatus = z.infer<typeof IssueStatus>;
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  in_remediation: 'In remediation',
  ready_for_retest: 'Ready for retest',
  closed: 'Closed',
  risk_accepted: 'Risk accepted',
};

export const IssueInput = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().max(4000).default(''),
  severity: Severity.default('medium'),
  owner: z.string().max(120).default(''),
  dueDate: z.string().nullable().default(null),
  controlId: z.string().uuid().nullable().default(null),
  testId: z.string().uuid().nullable().default(null),
  evalRunId: z.string().uuid().nullable().default(null),
  cardId: z.string().uuid().nullable().default(null),
  incidentId: z.string().uuid().nullable().default(null),
});

export interface Issue {
  id: string;
  key: string;
  engagementId: string;
  title: string;
  description: string;
  severity: Severity;
  status: IssueStatus;
  owner: string;
  dueDate: string | null;
  overdue: boolean;
  managementResponse: string;
  controlId: string | null;
  controlKey: string | null;
  testId: string | null;
  testKey: string | null;
  evalRunId: string | null;
  cardId: string | null;
  cardKey: string | null;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
}

// ---------------------------------------------------------------------------
// Evaluations and red teaming
// ---------------------------------------------------------------------------
export const CHECKS = ['contains', 'not_contains', 'regex', 'refuses', 'max_length', 'judge'] as const;
export const CheckType = z.enum(CHECKS);
export type CheckType = z.infer<typeof CheckType>;
export const CHECK_LABELS: Record<CheckType, string> = {
  contains: 'Answer contains',
  not_contains: 'Answer must not contain',
  regex: 'Answer matches pattern',
  refuses: 'Model refuses',
  max_length: 'Answer under N characters',
  judge: 'A judge model decides',
};

export const EvalCaseInput = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().max(60).default('quality'),
  ref: z.string().max(60).default(''),
  input: z.string().min(1).max(8000),
  check: CheckType,
  expected: z.string().max(2000).default(''),
  severity: Severity.default('medium'),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

export const EvalSuiteInput = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(['quality', 'red_team']),
  inventoryId: z.string().uuid().nullable().default(null),
  providerId: z.string().uuid(),
  model: z.string().min(1).max(120),
  systemPrompt: z.string().max(8000).default(''),
  thresholdPct: z.number().int().min(0).max(100).default(90),
  judgeProviderId: z.string().uuid().nullable().default(null),
  judgeModel: z.string().max(120).nullable().default(null),
});

export interface EvalSuite {
  id: string;
  key: string;
  engagementId: string;
  name: string;
  kind: 'quality' | 'red_team';
  inventoryId: string | null;
  inventoryName: string | null;
  providerId: string;
  providerName: string;
  model: string;
  systemPrompt: string;
  thresholdPct: number;
  judgeProviderId: string | null;
  judgeModel: string | null;
  cases: number;
  lastRun: { id: string; passPct: number; passed: number; total: number; at: string; status: string } | null;
  // Monitoring: how often it runs by itself, and the drop that raises an alert.
  schedule: MonitorSchedule;
  nextRunAt: string | null;
  driftDropPct: number;
  // Pass rate of the last completed runs, oldest first, for the trend line.
  trend: number[];
}

export const MONITOR_SCHEDULES = ['off', 'daily', 'weekly'] as const;
export type MonitorSchedule = (typeof MONITOR_SCHEDULES)[number];

// An alert from monitoring: a scheduled or manual run fell below its
// threshold, dropped against its recent baseline (drift), or failed to run.
export interface MonitorAlert {
  id: string;
  key: string; // AL-1
  suiteId: string;
  suiteName: string;
  runId: string | null;
  kind: 'below_threshold' | 'drift' | 'run_failed';
  message: string;
  passPct: number | null;
  baselinePct: number | null;
  status: 'open' | 'acknowledged';
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  note: string;
  issueKey: string | null;
  createdAt: string;
}

export interface EvalCase extends EvalCaseInput {
  id: string;
  suiteId: string;
}

export interface EvalResult {
  caseId: string;
  caseName: string;
  category: string;
  ref: string;
  severity: Severity;
  input: string;
  output: string;
  passed: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Readiness assessment
// ---------------------------------------------------------------------------
// Areas follow the NIST AI RMF functions, split where ISO/IEC 42001 and the
// Jamaica DPA give a separate body of requirements.
export const ASSESSMENT_AREAS = [
  { id: 'govern', name: 'Governance and accountability', basis: 'NIST AI RMF Govern; ISO/IEC 42001 clauses 5 and 7' },
  { id: 'map', name: 'Inventory and risk classification', basis: 'NIST AI RMF Map; ISO/IEC 42001 6.1' },
  { id: 'controls', name: 'Control design', basis: 'COSO control activities; ISO/IEC 42001 Annex A' },
  { id: 'measure', name: 'Testing and validation', basis: 'NIST AI RMF Measure; ISO/IEC 42001 9.1' },
  { id: 'security', name: 'AI security', basis: 'OWASP LLM and Agentic Top 10; NIST CSF 2.0' },
  { id: 'privacy', name: 'Data protection', basis: 'Jamaica DPA 2020; ISO/IEC 42001 A.7' },
  { id: 'manage', name: 'Issue management and monitoring', basis: 'NIST AI RMF Manage; ISO/IEC 42001 clause 10' },
] as const;
export type AreaId = (typeof ASSESSMENT_AREAS)[number]['id'];

// A common capability-maturity scale.
export const MATURITY = ['', 'Initial', 'Repeatable', 'Defined', 'Managed', 'Optimising'] as const;

// ---------------------------------------------------------------------------
// Adding an engagement (a client, or a project for a client)
// ---------------------------------------------------------------------------
export const FRAMEWORK_CHOICES = [
  { id: 'nistAiRmf', label: 'NIST AI RMF 1.0', hint: 'The usual backbone for AI risk management' },
  { id: 'iso42001', label: 'ISO/IEC 42001', hint: 'Certifiable AI management system; needs a Statement of Applicability' },
  { id: 'euAiAct', label: 'EU AI Act', hint: 'If the client serves people in the EU' },
  { id: 'jdpa', label: 'Jamaica Data Protection Act 2020', hint: 'Personal data of people in Jamaica' },
  { id: 'nistCsf', label: 'NIST CSF 2.0', hint: 'Security controls around the AI' },
  { id: 'coso', label: 'COSO Internal Control', hint: 'Financial reporting and internal audit' },
  { id: 'owasp', label: 'OWASP LLM and Agentic Top 10', hint: 'Red-team coverage for LLM apps and agents' },
] as const;
export type FrameworkChoice = (typeof FRAMEWORK_CHOICES)[number]['id'];

export const SECTORS = ['Banking and credit', 'Insurance', 'Public sector', 'Healthcare', 'Retail and consumer', 'Telecoms', 'Professional services', 'Other'] as const;

export const AgentModelChoice = z.object({
  providerId: z.string().uuid(),
  model: z.string().min(1).max(120),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
});

export const NewEngagement = z.object({
  name: z.string().trim().min(2).max(80),
  client: z.string().trim().min(2).max(120),
  prefix: z.string().trim().regex(/^[A-Z][A-Z0-9]{0,5}$/, 'Use 1 to 6 capital letters or digits, starting with a letter'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#8b9dff'),
  sector: z.string().max(60).default(''),
  about: z.string().max(4000).default(''),
  frameworks: z.array(z.string()).min(1, 'Pick at least one framework').max(10),
  // Mark library controls that map to the chosen frameworks as applicable.
  startSoa: z.boolean().default(true),
  appetite: z.object({ maxResidual: z.number().int().min(1).max(25), statement: z.string().max(2000).default(''), escalateTo: z.string().max(120).default('Board Risk Committee') }),
  gates: z.record(z.boolean()),
  agents: z.record(AgentModelChoice),
  useCases: z.array(z.string().trim().min(3).max(200)).max(100).default([]),
});
export type NewEngagement = z.infer<typeof NewEngagement>;

// ---------------------------------------------------------------------------
// Drafting agents. Each one drafts; a named person decides. None of their
// output counts as a preparer, a reviewer or a sign-off.
// ---------------------------------------------------------------------------
export const EvidencePlan = z.object({
  requests: z
    .array(
      z.object({
        controlKey: z.string().max(20),
        item: z.string().min(3).max(300),
        why: z.string().max(400),
        askFrom: z.string().max(120),
        status: z.enum(['received', 'partial', 'missing']),
        evidenceKeys: z.array(z.string().max(20)).max(10),
        note: z.string().max(400),
        sources: z.array(z.string().max(12)).max(6).default([]),
      }),
    )
    .min(1)
    .max(40),
  summary: z.string().max(800),
  sourcePassages: z.array(z.any()).default([]),
});
export type EvidencePlan = z.infer<typeof EvidencePlan>;

export const TestDrafts = z.object({
  results: z
    .array(
      z.object({
        testKey: z.string().max(20),
        proposed: z.enum(['pass', 'fail', 'cannot_assess']),
        actual: z.string().max(1500),
        exceptions: z.number().int().min(0).max(100000),
        evidenceKeys: z.array(z.string().max(20)).max(10),
        reasoning: z.string().max(1000),
        sources: z.array(z.string().max(12)).max(6).default([]),
      }),
    )
    .max(40),
  summary: z.string().max(800),
});
export type TestDrafts = z.infer<typeof TestDrafts>;
export type TestDraft = TestDrafts['results'][number] & { runId: string; model: string; at: string; used?: boolean; sourcePassages?: SourcePassage[] };

export const ReviewChallenges = z.object({
  challenges: z
    .array(
      z.object({
        severity: z.enum(['high', 'medium', 'low']),
        area: z.enum(['evidence', 'testing', 'issues', 'risk', 'controls', 'other']),
        finding: z.string().min(5).max(600),
        ref: z.string().max(40),
      }),
    )
    .max(30),
  readiness: z.enum(['ready', 'not_ready']),
  summary: z.string().max(800),
});
export type ReviewChallenges = z.infer<typeof ReviewChallenges>;

export const BoardSummary = z.object({
  headline: z.string().min(5).max(200),
  summary: z.string().min(20).max(2500),
  keyFigures: z.array(z.object({ label: z.string().max(80), value: z.string().max(40) })).max(8),
  recommendations: z.array(z.string().max(400)).max(6),
  decisionsNeeded: z.array(z.string().max(400)).max(4),
});
export type BoardSummary = z.infer<typeof BoardSummary>;

export interface CardDrafts {
  evidence?: EvidencePlan & DraftMeta;
  test?: Pick<TestDrafts, 'summary'> & { count: number; proposed: Record<'pass' | 'fail' | 'cannot_assess', number> } & DraftMeta;
  validate?: ReviewChallenges & DraftMeta;
  report?: BoardSummary & DraftMeta & { approvedBy?: string; approvedAt?: string };
}
export interface DraftMeta {
  runId: string;
  model: string;
  at: string;
}

// ---------------------------------------------------------------------------
// Grounding and human decisions on drafts
// ---------------------------------------------------------------------------
// A knowledge-base passage an agent was given and may cite as K-<number>.
export interface SourcePassage {
  id: string;
  title: string;
  kind: string;
  ref: string;
  text: string;
  score: number;
}

// A person's decision on one item of an agent's draft. Edits keep the agent's
// original alongside, so the audit trail shows what the AI proposed and what
// the person changed.
export const ItemDecision = z.object({
  decision: z.enum(['accept', 'edit', 'reject']),
  edit: z.record(z.any()).optional(),
  reason: z.string().max(600).optional(),
  by: z.string().optional(),
  at: z.string().optional(),
});
export type ItemDecision = z.infer<typeof ItemDecision>;

// Keyed by stage, then by what is being decided: 'tier', 'risk:0', 'control:2', 'challenge:1'.
export type CardDecisions = Partial<Record<string, Record<string, ItemDecision>>>;

// ---------------------------------------------------------------------------
// The Verifier (LLM-as-a-judge) and agent testing
// ---------------------------------------------------------------------------
// The Verifier reads one draft item and the passages it cites, and says whether
// those passages back it up. It is advisory: it never accepts, rejects or
// approves anything, and its verdict never counts as a person's decision.
export const VERDICTS = ['supported', 'partly', 'unsupported', 'contradicted'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_LABELS: Record<Verdict, string> = {
  supported: 'Supported by its sources',
  partly: 'Partly supported',
  unsupported: 'Not supported by its sources',
  contradicted: 'Its sources say otherwise',
};

export interface ItemVerdict {
  item: string; // 'tier', 'risk:0', 'control:1'
  verdict: Verdict;
  reason: string;
  // A short quote from a cited passage that backs a "supported" verdict. The
  // server checks it appears word for word, so the judge can't invent one.
  quote: string;
  quoteFound: boolean;
}

export interface Verification {
  stage: string;
  items: ItemVerdict[];
  summary: string;
  runtime: 'rules' | 'live';
  model: string;
  // True when the Verifier ran on the same model that wrote the draft, which
  // makes its verdict weaker (a model tends to approve its own work).
  sameModel: boolean;
  trigger: 'auto' | 'manual' | 'golden' | 'calibration';
  at: string;
}

export type CardVerification = Partial<Record<string, Verification>>;

// A golden case: an input with a known right answer, written and checked by a
// person. Running an agent over the whole set shows whether a new model, rules
// change or prompt change made it better or worse.
export const GOLDEN_AGENTS = ['risk_classifier', 'control_designer'] as const;
export type GoldenAgent = (typeof GOLDEN_AGENTS)[number];

export const GoldenExpected = z.object({
  tier: z.enum(['prohibited', 'high', 'limited', 'minimal']).optional(),
  oversight: z.enum(['human_in_command', 'human_in_loop', 'human_on_loop']).optional(),
  // Risk categories the classifier must raise, and ones it must not.
  mustRisk: z.array(z.string()).default([]),
  mustNotRisk: z.array(z.string()).default([]),
  // Library controls the designer must propose.
  mustControls: z.array(z.string()).default([]),
  why: z.string().max(1000).default(''),
});
export type GoldenExpected = z.infer<typeof GoldenExpected>;

export const GoldenRisk = z.object({ title: z.string().min(3).max(200), category: z.string(), likelihood: z.number().int().min(1).max(5), impact: z.number().int().min(1).max(5) });

export const NewGoldenCase = z.object({
  agent: z.enum(GOLDEN_AGENTS),
  title: z.string().trim().min(3).max(160),
  useCase: z.object({
    description: z.string().trim().min(10).max(4000),
    businessOwner: z.string().max(120).default(''),
    dataUsed: z.string().max(1000).default(''),
    affectedPeople: z.string().max(1000).default(''),
    autonomy: z.enum(['assistive', 'human_in_loop', 'autonomous']).default('human_in_loop'),
    vendor: z.string().max(200).default(''),
  }),
  tier: z.enum(['prohibited', 'high', 'limited', 'minimal']).nullable().default(null),
  risks: z.array(GoldenRisk).max(12).default([]),
  expected: GoldenExpected,
});
export type NewGoldenCase = z.infer<typeof NewGoldenCase>;

export interface GoldenCase extends NewGoldenCase {
  id: string;
  key: string; // G-1
  builtIn: boolean;
  createdBy: string;
  createdAt: string;
}

export interface GoldenCheck { label: string; pass: boolean; detail: string }
export interface GoldenResult {
  caseId: string;
  key: string;
  title: string;
  pass: boolean;
  checks: GoldenCheck[];
  got: string; // one line: what the agent produced
  error: string | null;
  verdicts?: { supported: number; total: number };
}

export interface GoldenRun {
  id: string;
  key: string; // GR-1
  agent: GoldenAgent;
  model: string;
  provider: string;
  runtime: 'dry-run' | 'live';
  rulesVersion: string;
  withVerifier: boolean;
  status: 'running' | 'done' | 'failed';
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  results: GoldenResult[];
  summary: { cases: number; passed: number; checks: number; checksPassed: number; supportedPct: number | null } | null;
  // Cases that passed on the previous run of this agent and fail now.
  regressions: string[];
  previous: string | null;
}

// A judge label: one claim, the passages it cites, and what a person decided.
// The Verifier is measured against these before anyone relies on it.
export const NewJudgeLabel = z.object({
  kind: z.enum(['risk', 'control', 'tier']),
  claim: z.string().trim().min(5).max(2000),
  sources: z.array(z.string().regex(/^K-\d+$/)).max(6).default([]),
  human: z.enum(['good', 'bad']),
  note: z.string().max(600).default(''),
});
export interface JudgeLabel {
  id: string;
  key: string; // L-1
  kind: 'risk' | 'control' | 'tier';
  claim: string;
  passages: SourcePassage[];
  human: 'good' | 'bad';
  note: string;
  origin: 'built_in' | 'manual' | 'decision';
  createdBy: string;
  createdAt: string;
}

export interface Calibration {
  id: string;
  key: string; // JC-1
  model: string;
  runtime: 'rules' | 'live';
  startedBy: string;
  at: string;
  labels: number;
  // Agreement between the Verifier and people. "False pass" is the dangerous
  // one: the Verifier called something good that a person rejected.
  agree: number;
  kappa: number;
  matrix: { goodGood: number; goodBad: number; badGood: number; badBad: number }; // judge-human
  falsePassRate: number;
  disagreements: { label: string; claim: string; human: 'good' | 'bad'; judge: Verdict; reason: string }[];
  trusted: boolean;
}

// The bar for trusting the Verifier, shown on the page and used in the verdict.
export const JUDGE_TRUST = { kappa: 0.6, falsePass: 0.1, minLabels: 10 } as const;

// ---------------------------------------------------------------------------
// The assistant
// ---------------------------------------------------------------------------
// A change the assistant proposes. Nothing happens until a person clicks
// Apply; then it runs through the normal API under that person's name.
const sBase = { title: z.string().trim().min(3).max(160), why: z.string().max(600).default('') };
const level = z.number().int().min(1).max(5);
export const AssistantSuggestion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('decide_item'), ...sBase, cardId: z.string().uuid(), item: z.string().regex(/^(tier|summary|risk:\d+|control:\d+|challenge:\d+)$/), decision: z.enum(['accept', 'edit', 'reject']), edit: z.record(z.any()).optional(), reason: z.string().max(600).optional() }),
  z.object({ kind: z.literal('update_risk'), ...sBase, riskId: z.string().uuid(), owner: z.string().max(120).optional(), treatment: z.enum(['mitigate', 'transfer', 'avoid', 'accept']).optional(), likelihood: level.optional(), impact: level.optional(), residual_likelihood: level.optional(), residual_impact: level.optional() }),
  z.object({ kind: z.literal('update_control'), ...sBase, controlId: z.string().uuid(), newTitle: z.string().trim().min(3).max(200).optional(), owner: z.string().max(120).optional(), objective: z.string().max(2000).optional() }),
  z.object({ kind: z.literal('raise_issue'), ...sBase, issueTitle: z.string().trim().min(3).max(200), description: z.string().max(4000).default(''), severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'), controlId: z.string().uuid().nullable().optional(), cardId: z.string().uuid().nullable().optional() }),
  z.object({ kind: z.literal('rerun_agent'), ...sBase, cardId: z.string().uuid(), note: z.string().trim().min(3).max(2000) }),
]);
export type AssistantSuggestion = z.infer<typeof AssistantSuggestion> & {
  id: string;
  status: 'open' | 'applied' | 'discarded' | 'failed';
  by?: string;
  at?: string;
  error?: string;
};

export interface AssistantMessage {
  id: string;
  conversationId?: string | null;
  role: 'user' | 'assistant';
  text: string;
  citations: string[];
  passages: SourcePassage[];
  suggestions: AssistantSuggestion[];
  // What the harness threw away from the answer, and why (for example an id
  // that isn't in the record), so nothing is dropped silently.
  dropped: string[];
  model: string | null;
  runtime: 'rules' | 'live' | null;
  author: string;
  at: string;
}

// One conversation with the assistant. It belongs to the person who started it.
export interface AssistantConversation {
  id: string;
  title: string;
  kind: 'card' | 'risks' | 'controls' | 'issues' | 'engagement';
  contextId: string;
  createdAt: string;
  updatedAt: string;
  messages?: number;
  match?: string | null;
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------
// Something that went wrong with a live AI system: a harmful output, a data
// leak, an outage. Each one tracks who must be told and by when.
export const INCIDENT_STATUSES = ['open', 'contained', 'resolved', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

// Notification clocks, counted from when the organisation became aware.
// EU AI Act Art. 73 (serious incidents) and the Jamaica DPA 2020 (breaches).
export const NOTIFY_CLOCKS = {
  ai_act_serious: { label: 'EU AI Act serious incident: market surveillance authority', hours: 15 * 24, to: 'Market surveillance authority' },
  ai_act_widespread: { label: 'EU AI Act widespread infringement or critical infrastructure', hours: 2 * 24, to: 'Market surveillance authority' },
  ai_act_death: { label: 'EU AI Act incident involving a death', hours: 10 * 24, to: 'Market surveillance authority' },
  jdpa_breach: { label: 'Jamaica DPA personal data breach: Information Commissioner', hours: 72, to: 'Information Commissioner' },
  data_subjects: { label: 'People affected by a personal data breach', hours: 72, to: 'Affected people' },
  internal: { label: 'Internal escalation (your own policy)', hours: 24, to: 'Board Risk Committee' },
} as const;
export type NotifyClock = keyof typeof NOTIFY_CLOCKS;

export const NewIncident = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().max(4000).default(''),
  severity: Severity.default('high'),
  occurredAt: z.string().nullable().default(null),
  awareAt: z.string().min(10),
  inventoryId: z.string().uuid().nullable().default(null),
  cardId: z.string().uuid().nullable().default(null),
  owner: z.string().max(120).default(''),
  clocks: z.array(z.enum(Object.keys(NOTIFY_CLOCKS) as [NotifyClock, ...NotifyClock[]])).default([]),
});
export type NewIncident = z.infer<typeof NewIncident>;

export interface IncidentNotice { clock: NotifyClock; to: string; due: string; sentAt: string | null; sentBy: string | null; reference: string }
export interface IncidentEvent { at: string; by: string; text: string }
export interface Incident {
  id: string;
  key: string; // INC-1
  engagementId: string;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  occurredAt: string | null;
  awareAt: string;
  inventoryId: string | null;
  inventoryName: string | null;
  cardId: string | null;
  cardKey: string | null;
  owner: string;
  notices: IncidentNotice[];
  timeline: IncidentEvent[];
  rootCause: string;
  lessons: string;
  issueKeys: string[];
  reportedBy: string;
  createdAt: string;
  closedBy: string | null;
  closedAt: string | null;
}

// ---------------------------------------------------------------------------
// Evidence connectors
// ---------------------------------------------------------------------------
// A read-only link to a client system: the harness fetches a report, export
// or file over HTTPS and files it as fingerprinted evidence. It never writes
// back. Credentials are encrypted and never shown again.
export const CONNECTOR_AUTH = ['none', 'bearer', 'header', 'basic'] as const;
export const CONNECTOR_SCHEDULES = ['manual', 'daily', 'weekly'] as const;
export const ConnectorInput = z.object({
  name: z.string().trim().min(3).max(120),
  url: z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Use an http or https address'),
  auth: z.enum(CONNECTOR_AUTH).default('none'),
  headerName: z.string().trim().max(80).default(''),
  secret: z.string().max(4000).optional(),
  controlId: z.string().uuid().nullable().default(null),
  schedule: z.enum(CONNECTOR_SCHEDULES).default('manual'),
  enabled: z.boolean().default(true),
});
export type ConnectorInput = z.infer<typeof ConnectorInput>;

export interface Connector {
  id: string;
  key: string; // CN-1
  name: string;
  url: string;
  auth: (typeof CONNECTOR_AUTH)[number];
  headerName: string;
  secretSet: boolean;
  controlId: string | null;
  controlKey: string | null;
  schedule: (typeof CONNECTOR_SCHEDULES)[number];
  enabled: boolean;
  nextPullAt: string | null;
  lastPullAt: string | null;
  lastStatus: 'never' | 'added' | 'unchanged' | 'failed';
  lastMessage: string;
  pulls: number;
  createdBy: string;
}
