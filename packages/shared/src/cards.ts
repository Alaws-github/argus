// Cards: an AI use case moving through governance, its status, profile, drafts and decisions.
import { z } from 'zod';
import { CardDrafts } from './agent-drafts.js';
import { ControlDesign } from './controls.js';
import { CardDecisions } from './grounding.js';
import { Classification, RiskTier } from './risks.js';
import { Stage } from './stages.js';
import { CardVerification } from './verifier.js';

// ---------------------------------------------------------------------------
// Card = an AI use case moving through governance.
// ---------------------------------------------------------------------------
export const CardStatus = z.enum([
  'idle',
  'queued',
  'running',
  'needs_approval',
  'changes_requested',
  'failed',
  'question',
]);
export type CardStatus = z.infer<typeof CardStatus>;

/** Each card status in words, as the board shows it. */
export const STATUS_LABELS: Record<CardStatus, string> = {
  idle: 'Waiting',
  queued: 'Queued',
  running: 'Agent Working',
  needs_approval: 'Needs Your Approval',
  changes_requested: 'Changes Requested',
  failed: 'Run Failed',
  question: 'Question for You',
};

/** How much the AI system acts on its own, as declared in the use case profile. */
export const Autonomy = z.enum(['assistive', 'human_in_loop', 'human_on_loop', 'autonomous']);
export type Autonomy = z.infer<typeof Autonomy>;

// What kind of AI it is, and how soon the team should look at it. Shown on the
// board card; the Planner suggests both, a person can change them.
export const UseCaseCategory = z.enum(['decision', 'chatbot', 'agent', 'generative', 'analytics', 'other']);
export type UseCaseCategory = z.infer<typeof UseCaseCategory>;
/** Each use case category in words. */
export const CATEGORY_LABELS: Record<UseCaseCategory, string> = {
  decision: 'Decision',
  chatbot: 'Chatbot',
  agent: 'AI agent',
  generative: 'Generative',
  analytics: 'Analytics',
  other: 'Other',
};
/** A use case's priority (P1 urgent to P3 later). */
export const Priority = z.enum(['p1', 'p2', 'p3']);
export type Priority = z.infer<typeof Priority>;
/** Each priority in words. */
export const PRIORITY_LABELS: Record<Priority, string> = { p1: 'P1 Urgent', p2: 'P2 Normal', p3: 'P3 Later' };

/** The use case profile a person fills in at intake. */
export const UseCaseInput = z.object({
  title: z.string().min(3).max(160),
  businessOwner: z.string().max(120).default(''),
  description: z.string().max(4000).default(''),
  dataUsed: z.string().max(2000).default(''),
  affectedPeople: z.string().max(1000).default(''),
  autonomy: Autonomy.default('human_in_loop'),
  vendor: z.string().max(200).default(''),
  category: UseCaseCategory.default('other'),
  priority: Priority.default('p2'),
});
export type UseCaseInput = z.infer<typeof UseCaseInput>;

/** A use case on the board: its stage, status, profile, drafts, decisions and Verifier verdicts. */
export interface Card {
  id: string;
  engagementId: string;
  number: number;
  key: string;
  title: string;
  stage: Stage;
  status: CardStatus;
  statusNote: string | null;
  useCase: UseCaseInput;
  tier: RiskTier | null;
  classification: Classification | null;
  design: ControlDesign | null;
  createdBy: string | null;
  /** The last person (not an agent) whose change to this card is in the audit log. */
  updatedBy?: string | null;
  drafts: CardDrafts;
  decisions: CardDecisions;
  verification: CardVerification;
  latestRunId: string | null;
  costUsd: number;
  createdAt: string;
  stageEnteredAt: string;
  updatedAt: string;
}
