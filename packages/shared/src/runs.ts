// Agent runs, their log lines, and audit log records.
import { z } from 'zod';
import { Stage } from './stages.js';

// ---------------------------------------------------------------------------
// Runs and audit
// ---------------------------------------------------------------------------
export const RunStatus = z.enum(['running', 'succeeded', 'failed', 'waiting']);
export type RunStatus = z.infer<typeof RunStatus>;

/** One agent run on a card: the model, mode, steps, cost and result. */
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

/** One line in a run's log (rule 24). */
export interface RunEvent {
  id: number;
  runId: string;
  at: string;
  kind: 'step' | 'output' | 'error';
  text: string;
}

/** One audit log entry, with its hash in the chain. */
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
