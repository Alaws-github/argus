// Control tests, evidence and issues.
import { z } from 'zod';
import { TestDraft } from './agent-drafts.js';

// ---------------------------------------------------------------------------
// Testing, evidence, issues
// ---------------------------------------------------------------------------
export const TEST_STATUSES = ['not_started', 'in_progress', 'passed', 'failed', 'blocked'] as const;
/** Where a control test is: not started, in progress, passed, failed or blocked. */
export const TestStatus = z.enum(TEST_STATUSES);
export type TestStatus = z.infer<typeof TestStatus>;
/** Each test status in words. */
export const TEST_STATUS_LABELS: Record<TestStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  passed: 'Passed',
  failed: 'Failed',
  blocked: 'Blocked',
};

/** A control test as a person adds or edits it. */
export const TestInput = z.object({
  controlId: z.string().uuid(),
  kind: z.enum(['design', 'operating', 'automated', 'retest']).default('operating'),
  title: z.string().trim().min(3).max(200),
  procedure: z.string().max(4000).default(''),
  population: z.string().max(300).default(''),
  sampleSize: z.number().int().min(0).max(100000).nullable().default(null),
  expected: z.string().max(1000).default(''),
});

/** A control test with its preparer, reviewer, result and any agent draft. */
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

/** An evidence item with its SHA-256, source and what it is attached to. */
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

/** Issue and incident severities, worst first. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
/** One severity. */
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

/** An issue's defect-style lifecycle, in order. */
export const ISSUE_STATUSES = ['open', 'in_remediation', 'ready_for_retest', 'closed', 'risk_accepted'] as const;
/** One issue status. */
export const IssueStatus = z.enum(ISSUE_STATUSES);
export type IssueStatus = z.infer<typeof IssueStatus>;
/** Each issue status in words. */
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  in_remediation: 'In remediation',
  ready_for_retest: 'Ready for retest',
  closed: 'Closed',
  risk_accepted: 'Risk accepted',
};

/** An issue as a person raises it. */
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

/** An issue with its owner, due date, links and lifecycle. */
export interface Issue {
  id: string;
  key: string;
  engagementId: string;
  title: string;
  /** v1.7.3: the ticket it became in the client's tool, when write-back created one (GRC-12). */
  externalRef?: string | null;
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
