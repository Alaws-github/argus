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
      }),
    )
    .min(1)
    .max(16),
  gaps: z.array(z.string().max(300)).max(8),
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
