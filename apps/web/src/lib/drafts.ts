// Which items of an agent's draft a person decides on, mirroring the server's
// decisions.ts, so the board and the side panel can show progress.
import type { Card } from '@gh/shared';

export function draftItems(card: Card): string[] {
  if (card.status !== 'needs_approval') return [];
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

export function draftProgress(card: Card) {
  const items = draftItems(card);
  const d = card.decisions?.[card.stage] ?? {};
  return { total: items.length, decided: items.filter((k) => d[k]).length };
}

// A one-line, plain-English description of what an agent's draft is, for the board.
export function draftSummary(card: Card): string | null {
  if (card.status !== 'needs_approval') return null;
  const c = card;
  switch (c.stage) {
    case 'classify':
      return c.classification
        ? `AI proposes ${c.classification.tier} risk · ${c.classification.risks.length} risks`
        : null;
    case 'design':
      return c.design ? `AI proposes ${c.design.controls.length} controls` : null;
    case 'evidence': {
      const p = c.drafts?.evidence;
      return p
        ? `AI request list · ${p.requests.filter((r) => r.status !== 'received').length} items still needed`
        : null;
    }
    case 'test': {
      const t = c.drafts?.test;
      return t ? `AI drafted ${t.count} test results` : null;
    }
    case 'validate': {
      const v = c.drafts?.validate;
      return v
        ? `AI raised ${v.challenges.length} challenges · ${v.challenges.filter((x) => x.severity === 'high').length} high`
        : null;
    }
    case 'report':
      return c.drafts?.report ? 'AI drafted the board summary' : null;
  }
  return null;
}
