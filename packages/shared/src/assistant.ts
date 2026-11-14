// The assistant: conversations, answers and the suggestions it may make.
import { z } from 'zod';
import { SourcePassage } from './grounding.js';

// ---------------------------------------------------------------------------
// The assistant
// ---------------------------------------------------------------------------
// A change the assistant proposes. Nothing happens until a person clicks
// Apply; then it runs through the normal API under that person's name.
const sBase = { title: z.string().trim().min(3).max(160), why: z.string().max(600).default('') };
const level = z.number().int().min(1).max(5);
/**
 * A change the assistant may suggest. Only these kinds exist; none approves, signs off, concludes, accepts
 * a risk or closes (rule 15).
 */
export const AssistantSuggestion = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('decide_item'),
    ...sBase,
    cardId: z.string().uuid(),
    item: z.string().regex(/^(tier|summary|risk:\d+|control:\d+|challenge:\d+)$/),
    decision: z.enum(['accept', 'edit', 'reject']),
    edit: z.record(z.any()).optional(),
    reason: z.string().max(600).optional(),
  }),
  z.object({
    kind: z.literal('update_risk'),
    ...sBase,
    riskId: z.string().uuid(),
    owner: z.string().max(120).optional(),
    treatment: z.enum(['mitigate', 'transfer', 'avoid', 'accept']).optional(),
    likelihood: level.optional(),
    impact: level.optional(),
    residual_likelihood: level.optional(),
    residual_impact: level.optional(),
  }),
  z.object({
    kind: z.literal('update_control'),
    ...sBase,
    controlId: z.string().uuid(),
    newTitle: z.string().trim().min(3).max(200).optional(),
    owner: z.string().max(120).optional(),
    objective: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal('raise_issue'),
    ...sBase,
    issueTitle: z.string().trim().min(3).max(200),
    description: z.string().max(4000).default(''),
    severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
    controlId: z.string().uuid().nullable().optional(),
    cardId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    kind: z.literal('rerun_agent'),
    ...sBase,
    cardId: z.string().uuid(),
    note: z.string().trim().min(3).max(2000),
  }),
]);
/** A suggestion as stored and shown: what the assistant proposed, plus its id and outcome. */
export type AssistantSuggestion = z.infer<typeof AssistantSuggestion> & {
  id: string;
  status: 'open' | 'applied' | 'discarded' | 'failed';
  by?: string;
  at?: string;
  error?: string;
};

/** One message in an assistant conversation: the text, citations, suggestions, basis and the steps it took. */
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
  /** v1.6: what the answer drew on: the page on screen, ARGUS records, the knowledge base. */
  basis: ('page' | 'records' | 'knowledge')[];
  /** v1.6: the look-ups it made before answering, in plain words. */
  trail: string[];
  /** v1.7: how long it worked, and the asker's thumbs up or down. */
  workedMs?: number | null;
  feedback?: 'up' | 'down' | null;
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
