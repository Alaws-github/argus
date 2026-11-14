// Evaluation suites and red teaming.
import { z } from 'zod';
import { Severity } from './testing.js';

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
