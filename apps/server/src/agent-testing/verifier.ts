// The Verifier: an advisory check (LLM-as-a-judge) on whether each item of a
// draft is backed by the knowledge-base passages it cites. It never decides
// anything: its verdicts sit beside the draft for the reviewer to weigh.
//
// Two ways to judge:
// - rules (offline): word overlap between the claim and its cited passages.
//   Cheap and repeatable, but it only spots items whose sources are off-topic.
// - live: a model reads each claim and its passages. Its "supported" verdicts
//   must quote a cited passage word for word; the server checks the quote, so
//   a judge that invents support is caught.
// How far to trust either is measured on the Agent testing page, against
// claims people have already labelled good or bad.
import { createHash } from 'node:crypto';
import { readPrompt } from '../core/paths.js';
import 'node:fs';
import 'node:path';
import type { Card, ItemVerdict, SourcePassage, Verdict, Verification } from '@gh/shared';
import type { Db, Queryable } from '../core/db.js';
import { callStructured } from '../ai/llm.js';
import { sourcesBlock } from '../knowledge/kb.js';
import { apiKeyOf, getProviderRow, type ProviderRow } from '../ai/providers.js';
import { costUsd, priceFor } from '../agents/pricing.js';
import { getCard, getSettings, monthSpend } from '../settings/settings-store.js';
import { logAudit } from '../audit/audit.js';

const RULES = readPrompt('verifier.md');
/** The Verifier's rules file version (rule 8). */
export const VERIFIER_RULES_VERSION = createHash('sha256').update(RULES).digest('hex').slice(0, 12);

// One thing the Verifier checks: an item of a draft, in words, and what it cites.
export interface Claim {
  item: string;
  kind: 'tier' | 'risk' | 'control';
  text: string;
  sources: string[];
}

/** The stages whose drafts the Verifier checks. */
export const VERIFIED_STAGES = ['classify', 'design'] as const;

/** The claims to check in a card's draft at its current stage. */
export const claimsFor = (card: Card) => claimsFromDraft(card.stage, card);

/** The claims in a classification or design draft, with the passages each one cites. */
export function claimsFromDraft(
  stage: string,
  card: Pick<Partial<Card>, 'classification' | 'design'>,
): { claims: Claim[]; passages: SourcePassage[] } {
  if (stage === 'classify' && card.classification) {
    const c = card.classification;
    return {
      passages: c.sourcePassages ?? [],
      claims: [
        {
          item: 'tier',
          kind: 'tier',
          text: `Tier: ${c.tier}. Oversight: ${c.oversight.replace(/_/g, ' ')}. ${c.tierRationale}`,
          sources: c.tierSources ?? [],
        },
        ...c.risks.map((r, i) => ({
          item: `risk:${i}`,
          kind: 'risk' as const,
          text: `${r.title} (${r.category.replace('_', ' ')} risk). ${r.rationale}`,
          sources: r.sources ?? [],
        })),
      ],
    };
  }
  if (stage === 'design' && card.design) {
    const d = card.design;
    return {
      passages: d.sourcePassages ?? [],
      claims: d.controls.map((c, i) => ({
        item: `control:${i}`,
        kind: 'control' as const,
        text: `${c.libraryCode ? `${c.libraryCode} ` : ''}${c.title}. Objective: ${c.objective} Treats: ${c.riskTitles.join('; ')}.`,
        sources: c.sources ?? [],
      })),
    };
  }
  return { claims: [], passages: [] };
}

// ---------------------------------------------------------------------------
// Rules judge
// ---------------------------------------------------------------------------
const STOP = new Set(
  'this that with from have will been they their them which when what where would could should about into over under such than then there these those also only more most other some each every both very must make made used uses using risk risks control controls tier oversight people person data model system'.split(
    ' ',
  ),
);
const words = (s: string) =>
  new Set(
    (s.toLowerCase().match(/[a-z]{4,}/g) ?? [])
      .map((w) => w.replace(/(ing|ed|es|s)$/, ''))
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
const sentences = (s: string) => s.split(/(?<=[.;:])\s+/).filter((x) => x.trim().length > 20);

function ruleVerdict(claim: Claim, cited: SourcePassage[]): Omit<ItemVerdict, 'item'> {
  if (!claim.sources.length)
    return { verdict: 'unsupported', reason: 'It cites no source.', quote: '', quoteFound: false };
  if (!cited.length)
    return {
      verdict: 'unsupported',
      reason: 'Its cited passages are missing from the draft.',
      quote: '',
      quoteFound: false,
    };
  const want = words(claim.text);
  const text = cited.map((p) => p.text).join(' ');
  const have = words(text);
  const shared = [...want].filter((w) => have.has(w));
  const overlap = want.size ? shared.length / want.size : 0;
  // The tier claim must cite a passage that names that tier.
  if (claim.kind === 'tier') {
    const tier = claim.text.match(/^Tier: (\w+)/)?.[1] ?? '';
    const named = new RegExp(`\\b${tier}\\b`, 'i').test(text);
    if (!named)
      return {
        verdict: 'unsupported',
        reason: `None of its sources describes the ${tier} tier.`,
        quote: '',
        quoteFound: false,
      };
  }
  // Best sentence to show the reviewer: the one sharing the most words.
  let quote = '';
  let best = 0;
  for (const s of sentences(text)) {
    const n = [...words(s)].filter((w) => want.has(w)).length;
    if (n > best) {
      best = n;
      quote = s.trim().slice(0, 240);
    }
  }
  const pct = Math.round(overlap * 100);
  if (overlap >= 0.3)
    return {
      verdict: 'supported',
      reason: `${pct}% of its key words appear in the passages it cites.`,
      quote,
      quoteFound: !!quote,
    };
  if (overlap >= 0.15)
    return {
      verdict: 'partly',
      reason: `Only ${pct}% of its key words appear in the passages it cites.`,
      quote,
      quoteFound: !!quote,
    };
  return {
    verdict: 'unsupported',
    reason: `Only ${pct}% of its key words appear in the passages it cites.`,
    quote: '',
    quoteFound: false,
  };
}

// ---------------------------------------------------------------------------
// Live judge
// ---------------------------------------------------------------------------
const SCHEMA = {
  type: 'object',
  required: ['verdicts', 'summary'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['item', 'reasoning', 'verdict', 'quote'],
        properties: {
          item: { type: 'string' },
          reasoning: { type: 'string' },
          verdict: { type: 'string', enum: ['supported', 'partly', 'unsupported', 'contradicted'] },
          quote: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'.…]+|[\s"'.…]+$/g, '')
    .trim();

/** The provider and model the Verifier uses, or the offline rules. */
export interface JudgeTarget {
  provider: ProviderRow;
  model: string;
}
/** The Verifier's verdicts on a set of claims, and what they cost. */
export interface JudgeResult {
  items: ItemVerdict[];
  summary: string;
  runtime: 'rules' | 'live';
  model: string;
  costUsd: number;
}

/**
 * Checks each claim against its cited passages. A supported or partly verdict must quote a passage word
 * for word, or it is downgraded (rule 14).
 */
export async function judge(
  claims: Claim[],
  passages: SourcePassage[],
  target: JudgeTarget | null,
  timeoutMs = 300_000,
): Promise<JudgeResult> {
  const byId = new Map(passages.map((p) => [p.id, p]));
  const citedFor = (c: Claim) => c.sources.map((s) => byId.get(s)).filter(Boolean) as SourcePassage[];

  if (!target || target.provider.type === 'rules') {
    const items = claims.map((c) => ({ item: c.item, ...ruleVerdict(c, citedFor(c)) }));
    return { items, summary: tally(items), runtime: 'rules', model: 'rules', costUsd: 0 };
  }

  // Claims that cite nothing are unsupported without asking the model.
  const ask = claims.filter((c) => citedFor(c).length);
  const fixed: ItemVerdict[] = claims
    .filter((c) => !citedFor(c).length)
    .map((c) => ({ item: c.item, ...ruleVerdict(c, []) }));
  if (!ask.length) return { items: fixed, summary: tally(fixed), runtime: 'live', model: target.model, costUsd: 0 };

  const used = passages.filter((p) => ask.some((c) => c.sources.includes(p.id)));
  const user = [
    '<claims>',
    ...ask.map((c) => `<claim id="${c.item}" cites="${c.sources.join(', ')}">\n${c.text}\n</claim>`),
    '</claims>',
    '',
    sourcesBlock(used),
  ].join('\n');
  const res = await callStructured({
    type: target.provider.type,
    baseUrl: target.provider.base_url,
    apiKey: apiKeyOf(target.provider),
    model: target.model,
    effort: 'medium',
    system: RULES,
    user,
    toolName: 'submit_verdicts',
    toolDescription: 'Submit one verdict per claim.',
    schema: SCHEMA,
    timeoutMs,
  });
  const out = res.input as { verdicts?: any[]; summary?: string };
  const got = Array.isArray(out?.verdicts) ? out.verdicts : [];
  const ids = new Set(ask.map((c) => c.item));
  const extra = got.filter((v) => !ids.has(v?.item)).map((v) => v?.item);
  if (extra.length) throw new Error(`The Verifier answered claims it wasn't given: ${extra.join(', ')}`);
  const items: ItemVerdict[] = ask.map((c) => {
    const v = got.find((x) => x.item === c.item);
    const verdict: Verdict = ['supported', 'partly', 'unsupported', 'contradicted'].includes(v?.verdict)
      ? v.verdict
      : 'unsupported';
    if (!v)
      return {
        item: c.item,
        verdict: 'unsupported',
        reason: 'The Verifier gave no verdict on this item.',
        quote: '',
        quoteFound: false,
      };
    const quote = String(v.quote ?? '').slice(0, 400);
    const found = quote.length >= 12 && citedFor(c).some((p) => norm(p.text).includes(norm(quote)));
    // A "supported" or "partly" verdict must show its evidence. If the quote
    // isn't in the cited passages, the verdict isn't trusted.
    if ((verdict === 'supported' || verdict === 'partly') && !found) {
      return {
        item: c.item,
        verdict: 'unsupported',
        reason: `The Verifier said "${verdict}" but its quote isn't in the cited passages, so the verdict wasn't trusted. Its reasoning: ${String(v.reasoning ?? '').slice(0, 300)}`,
        quote,
        quoteFound: false,
      };
    }
    return { item: c.item, verdict, reason: String(v.reasoning ?? '').slice(0, 600), quote, quoteFound: found };
  });
  const all = claims.map((c) => items.find((i) => i.item === c.item) ?? fixed.find((i) => i.item === c.item)!);
  const cost = target.provider.billed
    ? costUsd(priceFor(target.model, target.provider.prices), res.tokensIn, res.tokensOut, res.tokensCached)
    : 0;
  return {
    items: all,
    summary: String(out?.summary ?? '').slice(0, 400) || tally(all),
    runtime: 'live',
    model: target.model,
    costUsd: cost,
  };
}

function tally(items: ItemVerdict[]) {
  const n = (v: Verdict) => items.filter((i) => i.verdict === v).length;
  const weak = items.length - n('supported');
  return weak
    ? `${n('supported')} of ${items.length} items are supported by their sources. Look closely at the other ${weak}.`
    : `All ${items.length} items are supported by their sources.`;
}

// The model the Verifier uses, from Settings. Null means the offline rules.
export async function verifierTarget(q: Queryable): Promise<JudgeTarget | null> {
  const s = await getSettings(q);
  if (!s.verifierProviderId || !s.verifierModel) return null;
  const provider = await getProviderRow(q, s.verifierProviderId);
  if (!provider || !provider.enabled) return null;
  return { provider, model: s.verifierModel };
}

// Refuse a billed call once the month's spend cap is reached, like card runs.
export async function checkCap(q: Queryable, target: JudgeTarget | null) {
  if (!target?.provider.billed) return;
  const s = await getSettings(q);
  if (s.pauseAtCap && s.spendCapUsd != null && (await monthSpend(q, s.timeZone)) >= s.spendCapUsd) {
    throw Object.assign(
      new Error(
        `Billed AI spend this month reached the $${s.spendCapUsd} cap. Raise it on Models, or use an unbilled model.`,
      ),
      { status: 409 },
    );
  }
}

/**
 * Records billed spend that isn't an agent run (Verifier, golden, calibration), which the spend cap
 * counts.
 */
export async function recordSpend(q: Queryable, source: string, model: string, usd: number) {
  if (usd > 0) await q.query(`INSERT INTO ai_spend (source, model, cost_usd) VALUES ($1,$2,$3)`, [source, model, usd]);
}

// Check one card's current draft and store the verdicts beside it.
export async function verifyCard(
  db: Db,
  cardId: string,
  trigger: 'auto' | 'manual',
  actor: string,
): Promise<Verification> {
  const card = await getCard(db, cardId);
  if (!card) throw Object.assign(new Error('Card not found'), { status: 404 });
  if (!(VERIFIED_STAGES as readonly string[]).includes(card.stage)) {
    throw Object.assign(new Error('The Verifier checks risk classifications and control designs'), { status: 409 });
  }
  const { claims, passages } = claimsFor(card);
  if (!claims.length) throw Object.assign(new Error('There is no draft to check at this stage'), { status: 409 });
  const target = await verifierTarget(db);
  await checkCap(db, target);
  const { rows: run } = await db.query(`SELECT model FROM runs WHERE id = $1`, [card.latestRunId]);
  const result = await judge(claims, passages, target);
  const v: Verification = {
    stage: card.stage,
    items: result.items,
    summary: result.summary,
    runtime: result.runtime,
    model: result.model,
    sameModel: result.runtime === 'live' && run[0]?.model === result.model,
    trigger,
    at: new Date().toISOString(),
  };
  const saved = await db.tx(async (q) => {
    // Only store it if the draft hasn't been replaced while the judge was working.
    const { rows: upd } = await q.query(
      `UPDATE cards SET verification = jsonb_set(verification, ARRAY[$2::text], $3::jsonb, true) WHERE id = $1 AND stage = $2 AND latest_run_id IS NOT DISTINCT FROM $4 RETURNING id`,
      [card.id, card.stage, JSON.stringify(v), card.latestRunId],
    );
    if (!upd.length) return false;
    await recordSpend(q, `verifier:${card.key}`, result.model, result.costUsd);
    const count = (x: Verdict) => v.items.filter((i) => i.verdict === x).length;
    await logAudit(q, trigger === 'auto' ? 'Verifier' : actor, 'verifier.checked', `card:${card.key}`, {
      stage: card.stage,
      model: v.model,
      runtime: v.runtime,
      supported: count('supported'),
      partly: count('partly'),
      unsupported: count('unsupported'),
      contradicted: count('contradicted'),
      sameModel: v.sameModel,
      advisory: true,
    });
    return true;
  });
  if (!saved)
    throw Object.assign(new Error('The draft changed while the Verifier was checking it. Check again.'), {
      status: 409,
    });
  return v;
}
