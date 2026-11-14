// The Verifier (LLM-as-a-judge) and agent testing on the golden dataset.
import { z } from 'zod';
import { SourcePassage } from './grounding.js';

// ---------------------------------------------------------------------------
// The Verifier (LLM-as-a-judge) and agent testing
// ---------------------------------------------------------------------------
// The Verifier reads one draft item and the passages it cites, and says whether
// those passages back it up. It is advisory: it never accepts, rejects or
// approves anything, and its verdict never counts as a person's decision.
export const VERDICTS = ['supported', 'partly', 'unsupported', 'contradicted'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_LABELS: Record<Verdict, string> = {
  supported: 'Backed by what it cites',
  partly: 'Only partly backed by what it cites',
  unsupported: 'Not backed by what it cites',
  contradicted: 'What it cites says otherwise',
};
/** v1.7.4: what a reviewer should do with each Verifier verdict, in plain words. */
export const VERDICT_ADVICE: Record<Verdict, string> = {
  supported: 'The passages it cites say the same thing.',
  partly: 'Some of it is not in the passages it cites. Check that part yourself before accepting.',
  unsupported: 'The passages it cites are about something else. Check it yourself before accepting.',
  contradicted: 'The passages it cites say something different. Look closely before accepting.',
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

export const GoldenRisk = z.object({
  title: z.string().min(3).max(200),
  category: z.string(),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
});

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

export interface GoldenCheck {
  label: string;
  pass: boolean;
  detail: string;
}
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
  /** v1.6: 'agentic' (tools and self-check) or 'single' (one call). */
  mode: 'agentic' | 'single';
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
  sources: z
    .array(z.string().regex(/^K-\d+$/))
    .max(6)
    .default([]),
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
