// Stages of the board, the five steps people see, gates and what each stage needs.
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
  intake: 'Intake',
  assess: 'Assess Risk',
  controls: 'Controls',
  test: 'Test',
  signoff: 'Sign-off & Report',
  closed: 'Done',
};
export const PHASE_OF: Record<Stage, Phase> = {
  intake: 'intake',
  classify: 'assess',
  design: 'controls',
  evidence: 'test',
  test: 'test',
  remediate: 'test',
  validate: 'signoff',
  report: 'signoff',
  closed: 'closed',
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
  evidence: 'Collecting Evidence',
  test: 'Testing',
  remediate: 'Fixing Findings',
  validate: 'Final Review',
  report: 'Board Report',
};

// Optional parts of an engagement. The core flow is always on; these are
// switched on per engagement under Engagement settings > General, so a new
// engagement starts simple. They are hidden when off, not removed.
export const MODULES = ['evals', 'incidents', 'inventory', 'connectors', 'soa', 'advanced_ai'] as const;
export type Module = (typeof MODULES)[number];
export const MODULE_INFO: Record<Module, { label: string; hint: string }> = {
  evals: {
    label: 'AI testing and monitoring',
    hint: 'Evaluation suites, red teaming against the OWASP LLM Top 10, scheduled runs and drift alerts',
  },
  incidents: { label: 'Incidents', hint: 'Record AI incidents with their regulatory notification deadlines' },
  inventory: {
    label: 'AI inventory',
    hint: 'Every AI system and agent in use at the client, with the agent register checks',
  },
  connectors: {
    label: 'Client tools and workflows',
    hint: "Client workflows and each use case's client steps, connectors to the client's tools, evidence pushed from pipelines, and write-back",
  },
  soa: {
    label: 'Statement of Applicability and traceability',
    hint: 'Which controls apply and why, and the chain from obligation to evidence',
  },
  advanced_ai: {
    label: 'Advanced AI settings',
    hint: 'More than one agent per stage with routing, and testing the agents on the golden dataset',
  },
};
export type Modules = Record<Module, boolean>;
export const NO_MODULES: Modules = {
  evals: false,
  incidents: false,
  inventory: false,
  connectors: false,
  soa: false,
  advanced_ai: false,
};
export const ALL_MODULES: Modules = {
  evals: true,
  incidents: true,
  inventory: true,
  connectors: true,
  soa: true,
  advanced_ai: true,
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
