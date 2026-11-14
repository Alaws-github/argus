// Risk tiers, risk scoring and the risk register.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Risk tiers. Modelled on the EU AI Act's four tiers, which most clients
// recognise; mapped to NIST AI RMF "Map" outputs in the classifier prompt.
// ---------------------------------------------------------------------------
export const RiskTier = z.enum(['prohibited', 'high', 'limited', 'minimal']);
export type RiskTier = z.infer<typeof RiskTier>;

/** Each risk tier in words. */
export const TIER_LABELS: Record<RiskTier, string> = {
  prohibited: 'Prohibited',
  high: 'High',
  limited: 'Limited',
  minimal: 'Minimal',
};

/** How a person oversees the system: in command, in the loop or on the loop. */
export const Oversight = z.enum(['human_in_command', 'human_in_loop', 'human_on_loop']);
export type Oversight = z.infer<typeof Oversight>;

/** Each oversight model in words. */
export const OVERSIGHT_LABELS: Record<Oversight, string> = {
  human_in_command: 'Human in command',
  human_in_loop: 'Human in the loop',
  human_on_loop: 'Human on the loop',
};

/** The kinds of AI risk (fairness, privacy, accuracy and so on). */
export const RiskCategory = z.enum([
  'privacy',
  'fairness',
  'accuracy',
  'security',
  'transparency',
  'accountability',
  'third_party',
  'regulatory',
  'operational',
]);
export type RiskCategory = z.infer<typeof RiskCategory>;

/** A starting risk the Risk Classifier proposes, with its scores and sources. */
export const ProposedRisk = z.object({
  title: z.string().min(3).max(200),
  category: RiskCategory,
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  rationale: z.string().max(600),
  // Knowledge-base passages (K-ids) the risk rests on. Checked by the server.
  sources: z.array(z.string().max(12)).max(6).default([]),
});
export type ProposedRisk = z.infer<typeof ProposedRisk>;

// What the Risk Classifier must return. The server rejects anything else.
export const Classification = z.object({
  tier: RiskTier,
  tierRationale: z.string().min(10).max(1200),
  oversight: Oversight,
  oversightRationale: z.string().max(800),
  factors: z.array(z.string().max(200)).max(10),
  risks: z.array(ProposedRisk).min(1).max(8),
  openQuestions: z.array(z.string().max(300)).max(6),
  frameworkRefs: z.array(z.string().max(80)).max(8),
  tierSources: z.array(z.string().max(12)).max(6).default([]),
  // The passages the agent cited, copied at run time so the reviewer reads exactly what it saw.
  sourcePassages: z.array(z.any()).default([]),
});
export type Classification = z.infer<typeof Classification>;

/** A risk's score: likelihood times impact (1 to 25). */
export function riskScore(likelihood: number, impact: number) {
  return likelihood * impact;
}
/** A score as a rating: critical, high, medium or low. */
export function riskRating(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 20) return 'critical';
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

/** A risk in the register, with its inherent and residual scores and the controls that treat it. */
export interface Risk {
  id: string;
  key: string;
  cardId: string;
  cardKey: string;
  title: string;
  category: RiskCategory;
  likelihood: number;
  impact: number;
  score: number;
  owner: string;
  treatment: 'mitigate' | 'accept' | 'transfer' | 'avoid';
  status: 'open' | 'treated' | 'closed';
  rationale: string;
  createdAt: string;
  residualLikelihood: number | null;
  residualImpact: number | null;
  residualScore: number | null;
  acceptedBy: string | null;
  controlCount: number;
}
