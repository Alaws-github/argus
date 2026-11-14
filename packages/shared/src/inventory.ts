// The AI inventory and the agent register checks.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// AI inventory and agent register
// ---------------------------------------------------------------------------
export const INVENTORY_KINDS = ['system', 'model', 'agent', 'dataset', 'vendor'] as const;
export const InventoryKind = z.enum(INVENTORY_KINDS);
export type InventoryKind = z.infer<typeof InventoryKind>;

export const InventoryInput = z.object({
  kind: InventoryKind,
  name: z.string().trim().min(2).max(160),
  owner: z.string().max(120).default(''),
  description: z.string().max(2000).default(''),
  vendor: z.string().max(160).default(''),
  status: z.enum(['proposed', 'live', 'retired']).default('live'),
  cardIds: z.array(z.string().uuid()).default([]),
  // Agent register fields (used when kind = agent)
  identity: z.string().max(200).default(''),
  mandate: z.string().max(2000).default(''),
  limits: z.string().max(500).default(''),
  approvalThreshold: z.string().max(300).default(''),
  stepLimit: z.number().int().min(0).max(10000).nullable().default(null),
  killSwitchTestedAt: z.string().nullable().default(null),
  lastReviewAt: z.string().nullable().default(null),
});
export type InventoryInput = z.infer<typeof InventoryInput>;

export interface InventoryItem extends InventoryInput {
  id: string;
  key: string;
  cardKeys: string[];
  readiness: { ok: boolean; missing: string[] } | null;
  createdAt: string;
}

// An agent is ready to act alone only when all of these hold.
export function agentReadiness(
  i: Pick<
    InventoryInput,
    | 'owner'
    | 'identity'
    | 'mandate'
    | 'limits'
    | 'approvalThreshold'
    | 'stepLimit'
    | 'killSwitchTestedAt'
    | 'lastReviewAt'
  >,
  now = Date.now(),
) {
  const days = (d: string | null) => (d ? (now - Date.parse(d)) / 864e5 : Infinity);
  const missing: string[] = [];
  if (!i.owner) missing.push('A named human owner');
  if (!i.identity) missing.push('Its own identity (not a shared login)');
  if (!i.mandate) missing.push('A written mandate: what it may do and touch');
  if (!i.limits) missing.push('Limits on value or volume');
  if (!i.approvalThreshold) missing.push('An approval threshold for a person');
  if (!i.stepLimit) missing.push('A step limit');
  if (days(i.killSwitchTestedAt) > 90) missing.push('A kill switch tested in the last 90 days');
  if (days(i.lastReviewAt) > 90) missing.push('An independent review in the last 90 days');
  return { ok: missing.length === 0, missing };
}
