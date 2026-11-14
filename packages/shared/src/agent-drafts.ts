// What each drafting agent returns. Each one drafts; a named person decides.
import { z } from 'zod';
import { SourcePassage } from './grounding.js';

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
export type TestDraft = TestDrafts['results'][number] & {
  runId: string;
  model: string;
  at: string;
  used?: boolean;
  sourcePassages?: SourcePassage[];
};

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
  test?: Pick<TestDrafts, 'summary'> & {
    count: number;
    proposed: Record<'pass' | 'fail' | 'cannot_assess', number>;
  } & DraftMeta;
  validate?: ReviewChallenges & DraftMeta;
  report?: BoardSummary & DraftMeta & { approvedBy?: string; approvedAt?: string };
}
export interface DraftMeta {
  runId: string;
  model: string;
  at: string;
}
