// Turns AI inventory rows into API records, with the agent register readiness checks.
import { agentReadiness } from '@gh/shared';
import { toIso } from '../core/format.js';
/** An inventory row as an API record, with its use case keys and agent register checks. */
export const toInventory = (r: any, cardKeys: Record<string, string>) => {
  const item = {
    id: r.id,
    key: `AI-INV-${r.number}`,
    kind: r.kind,
    name: r.name,
    owner: r.owner,
    description: r.description,
    vendor: r.vendor,
    status: r.status,
    cardIds: r.card_ids,
    cardKeys: (r.card_ids as string[]).map((id) => cardKeys[id]).filter(Boolean),
    identity: r.identity,
    mandate: r.mandate,
    limits: r.limits,
    approvalThreshold: r.approval_threshold,
    stepLimit: r.step_limit,
    killSwitchTestedAt: toIso(r.kill_switch_tested_at),
    lastReviewAt: toIso(r.last_review_at),
    createdAt: toIso(r.created_at),
  };
  return { ...item, readiness: r.kind === 'agent' ? agentReadiness(item) : null };
};
