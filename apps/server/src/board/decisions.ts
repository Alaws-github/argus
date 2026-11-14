// Human decisions on each item of an agent's draft. A reviewer accepts, edits
// or rejects every proposed risk, control, challenge or summary before the
// stage is approved; only what they accept (as edited) goes into the registers.
// Undecided items count as accepted only when a stage has no gate and the
// engine moves the card on by itself, because the lead chose that.
import { z } from 'zod';
import { RiskCategory, RiskTier, Oversight, type Card, type ItemDecision } from '@gh/shared';

/** The stages whose drafts are decided item by item (rule 12). */
export const DECIDED_STAGES = ['classify', 'design', 'validate', 'report'] as const;

// The items a person decides on, for the card's current stage and draft.
export function itemsFor(card: Card): string[] {
  switch (card.stage) {
    case 'classify':
      return card.classification ? ['tier', ...card.classification.risks.map((_, i) => `risk:${i}`)] : [];
    case 'design':
      return card.design ? card.design.controls.map((_, i) => `control:${i}`) : [];
    case 'validate':
      return card.drafts?.validate ? card.drafts.validate.challenges.map((_, i) => `challenge:${i}`) : [];
    case 'report':
      return card.drafts?.report ? ['summary'] : [];
  }
  return [];
}

/** The draft items at the card's stage that have no decision yet. */
export function undecided(card: Card): string[] {
  const d = card.decisions?.[card.stage] ?? {};
  return itemsFor(card).filter((k) => !d[k]);
}

// What may be edited on each kind of item.
const EDITS: Record<string, z.ZodTypeAny> = {
  tier: z.object({ tier: RiskTier, oversight: Oversight }).partial(),
  risk: z
    .object({
      title: z.string().trim().min(3).max(200),
      category: RiskCategory,
      likelihood: z.number().int().min(1).max(5),
      impact: z.number().int().min(1).max(5),
    })
    .partial(),
  control: z
    .object({ title: z.string().trim().min(3).max(200), owner: z.string().max(120), objective: z.string().max(800) })
    .partial(),
  summary: z
    .object({ headline: z.string().trim().min(5).max(200), summary: z.string().trim().min(20).max(4000) })
    .partial(),
};

/** Checks an edited draft item has the right fields and values. */
export function checkEdit(item: string, edit: unknown) {
  const kind = item.split(':')[0];
  const schema = EDITS[kind];
  if (!schema)
    throw Object.assign(
      new Error(`${kind === 'challenge' ? 'A challenge' : 'This item'} can be accepted or rejected, not edited`),
      { status: 400 },
    );
  const parsed = schema.parse(edit);
  if (!Object.keys(parsed).length) throw Object.assign(new Error('Nothing was changed'), { status: 400 });
  return parsed as Record<string, unknown>;
}

// The agent's original for an item, recorded alongside any edit.
export function original(card: Card, item: string): unknown {
  const [kind, n] = item.split(':');
  const i = Number(n);
  if (kind === 'tier') return { tier: card.classification?.tier, oversight: card.classification?.oversight };
  if (kind === 'risk') return card.classification?.risks[i];
  if (kind === 'control') return card.design?.controls[i];
  if (kind === 'challenge') return card.drafts?.validate?.challenges[i];
  if (kind === 'summary') return { headline: card.drafts?.report?.headline, summary: card.drafts?.report?.summary };
  return null;
}

// Apply a decision to an item: null when rejected, the edited copy when edited.
export function decided<T extends object>(item: T, d: ItemDecision | undefined): T | null {
  if (d?.decision === 'reject') return null;
  if (d?.decision === 'edit' && d.edit) return { ...item, ...d.edit };
  return item;
}
