// Creating a use case card. Used by "+ Add use case" (quick add) and by a plan
// being added to Intake.
import type { Card, UseCaseInput } from '@gh/shared';
import type { Queryable } from '../core/db.js';
import { logAudit } from '../audit/audit.js';
import { indexUseCase } from '../knowledge/kb.js';
import { toCard } from '../settings/settings-store.js';

export async function createCard(
  q: Queryable,
  engagementId: string,
  input: UseCaseInput,
  actor: string,
  detail: Record<string, unknown> = {},
): Promise<Card> {
  const { rows } = await q.query(
    `UPDATE engagements SET card_seq = card_seq + 1 WHERE id = $1 RETURNING prefix, card_seq`,
    [engagementId],
  );
  if (!rows[0]) throw Object.assign(new Error('Engagement not found'), { status: 404 });
  const key = `${rows[0].prefix}-${rows[0].card_seq}`;
  const { rows: c } = await q.query(
    `INSERT INTO cards (engagement_id, number, key, title, use_case, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [engagementId, rows[0].card_seq, key, input.title, JSON.stringify(input), actor],
  );
  await logAudit(q, actor, 'card.created', `card:${key}`, { title: input.title, ...detail });
  await indexUseCase(q, c[0]);
  return toCard(c[0]);
}
