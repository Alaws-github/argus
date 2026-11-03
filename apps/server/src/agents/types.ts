// Shared shapes for agents: what the engine hands an agent for one run
// (the context) and what the agent hands back (its output and token usage).
import type { Card, Effort } from '@gh/shared';
import type { ProviderRow } from '../providers.js';

export type Log = (kind: 'step' | 'output' | 'error', text: string) => Promise<void>;

// Everything an agent needs for one run, resolved by the engine from the
// agent's settings and its provider.
export interface AgentContext {
  card: Card;
  feedback: string | null;
  provider: ProviderRow;
  apiKey: string | undefined;
  model: string;
  effort: Effort;
  instructions: string;
  engagementAbout: string;
  timeoutMs: number;
}

export interface AgentResult<T> {
  output: T;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
}
