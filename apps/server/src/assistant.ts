// The assistant: a chat beside a use case or a register. It explains, checks
// and suggests; it never decides. Every suggestion is a proposed change that a
// person applies or discards. Applying replays it through the normal API with
// the person's own session, so their permissions, segregation of duties, exit
// criteria and audit entry all apply exactly as if they had clicked it by hand.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AssistantSuggestion, type AssistantMessage, type Card, type SourcePassage } from '@gh/shared';
import type { Db } from './db.js';
import { callStructured } from './llm.js';
import { mergePassages, search, sourcesBlock, strayCitations } from './kb.js';
import { apiKeyOf, getProviderRow, type ProviderRow } from './providers.js';
import { costUsd, priceFor } from './agents/pricing.js';
import { getCard, getEngagement, getSettings } from './store.js';
import { undecided } from './decisions.js';
import { checkCap } from './verifier.js';

const here = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(resolve(here, 'agents/prompts/assistant.md'), 'utf8');
export const ASSISTANT_RULES_VERSION = createHash('sha256').update(RULES).digest('hex').slice(0, 12);

// Lets the apply step call the API as the person while keeping their client
// address in the audit log. Only honoured from this process (see context.ts).
export const INTERNAL_TOKEN = randomBytes(24).toString('hex');

export const CONTEXT_KINDS = ['card', 'risks', 'controls', 'issues', 'engagement'] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

// ---------------------------------------------------------------------------
// The record the assistant sees, and the ids it may refer to
// ---------------------------------------------------------------------------
interface Context { text: string; ids: { cards: Set<string>; risks: Set<string>; controls: Set<string> }; card: Card | null; query: string; label: string }

const line = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join(' | ');

export async function buildContext(db: Db, engagementId: string, kind: ContextKind, id: string | null): Promise<Context> {
  const e = await getEngagement(db, engagementId);
  if (!e) throw Object.assign(new Error('Engagement not found'), { status: 404 });
  const ids = { cards: new Set<string>(), risks: new Set<string>(), controls: new Set<string>() };
  const out: string[] = [`<engagement>${line({ name: e.name, client: e.client, framework: e.framework, appetite: `residual score up to ${e.appetite.maxResidual} accepted without escalation` })}</engagement>`];
  let card: Card | null = null;
  let query = '';
  let label = e.name;

  if (kind === 'card') {
    card = id ? await getCard(db, id) : null;
    if (!card || card.engagementId !== engagementId) throw Object.assign(new Error('Use case not found'), { status: 404 });
    ids.cards.add(card.id);
    label = `${card.key} ${card.title}`;
    const u = card.useCase;
    query = `${card.title} ${u.description} ${u.dataUsed}`;
    out.push(`<use_case id="${card.id}" key="${card.key}">`, line({ title: card.title, stage: card.stage, status: card.status, tier: card.tier, note: card.statusNote }),
      line({ description: u.description, data: u.dataUsed, affected: u.affectedPeople, autonomy: u.autonomy, vendor: u.vendor, owner: u.businessOwner }), '</use_case>');
    const decisions = (card.decisions as any)?.[card.stage] ?? {};
    const verdicts = new Map<string, any>(((card.verification as any)?.[card.stage]?.items ?? []).map((v: any) => [v.item, v]));
    const tag = (item: string) => [decisions[item] ? `decided: ${decisions[item].decision} by ${decisions[item].by}` : 'undecided', verdicts.get(item) ? `Verifier: ${verdicts.get(item).verdict} (${verdicts.get(item).reason})` : ''].filter(Boolean).join('; ');
    if (card.stage === 'classify' && card.classification) {
      const c = card.classification;
      out.push('<draft stage="classify">', `tier [${tag('tier')}]: ${c.tier}, oversight ${c.oversight}. ${c.tierRationale} cites ${c.tierSources.join(', ') || 'nothing'}`);
      c.risks.forEach((r, i) => out.push(`risk:${i} [${tag(`risk:${i}`)}]: ${r.title} (${r.category}, L${r.likelihood} x I${r.impact}). ${r.rationale} cites ${r.sources.join(', ') || 'nothing'}`));
      if (c.openQuestions.length) out.push(`open questions: ${c.openQuestions.join(' / ')}`);
      out.push('</draft>');
    }
    if (card.stage === 'design' && card.design) {
      out.push('<draft stage="design">');
      card.design.controls.forEach((c, i) => out.push(`control:${i} [${tag(`control:${i}`)}]: ${c.libraryCode ?? ''} ${c.title}. Owner ${c.owner}. ${c.objective} Treats: ${c.riskTitles.join('; ')}. cites ${c.sources.join(', ') || 'nothing'}`));
      if (card.design.gaps.length) out.push(`gaps: ${card.design.gaps.join(' / ')}`);
      out.push('</draft>');
    }
    const d = (card.drafts as any)?.[card.stage];
    if (d && ['validate', 'report', 'evidence', 'test'].includes(card.stage)) out.push(`<draft stage="${card.stage}">${JSON.stringify(d).slice(0, 3000)}</draft>`);
    if (['classify', 'design', 'validate', 'report'].includes(card.stage)) out.push(`undecided items: ${undecided(card).join(', ') || 'none'}`);
    await registers(db, engagementId, out, ids, card.id);
  } else {
    label = { risks: 'Risk register', controls: 'Control register', issues: 'Issues', engagement: e.name }[kind];
    query = `${e.name} ${e.client} ${kind}`;
    await registers(db, engagementId, out, ids, null, kind);
  }
  return { text: out.join('\n'), ids, card, query, label };
}

async function registers(db: Db, engagementId: string, out: string[], ids: Context['ids'], cardId: string | null, focus?: string) {
  const scope = cardId ? 'AND k.card_id = $2' : '';
  const args = cardId ? [engagementId, cardId] : [engagementId];
  const { rows: risks } = await db.query(
    `SELECT k.*, c.key AS card_key, (SELECT count(*) FROM control_risks cr WHERE cr.risk_id = k.id)::int AS controls FROM risks k JOIN cards c ON c.id = k.card_id WHERE k.engagement_id = $1 ${scope} ORDER BY k.likelihood * k.impact DESC LIMIT 40`, args);
  if (risks.length) {
    out.push('<risk_register>');
    for (const r of risks) {
      ids.risks.add(r.id);
      out.push(`R-${r.number} id=${r.id} ${line({ useCase: r.card_key, title: r.title, category: r.category, score: r.likelihood * r.impact, residual: r.residual_likelihood ? r.residual_likelihood * r.residual_impact : 'not set', owner: r.owner || 'none', treatment: r.treatment, status: r.status, controls: r.controls })}`);
    }
    out.push('</risk_register>');
  }
  const cscope = cardId ? 'AND c.card_id = $2' : '';
  const { rows: controls } = await db.query(
    `SELECT c.*, k.key AS card_key, l.code, (SELECT count(*) FROM tests t WHERE t.control_id = c.id)::int AS tests FROM controls c LEFT JOIN cards k ON k.id = c.card_id LEFT JOIN control_library l ON l.id = c.library_id WHERE c.engagement_id = $1 ${cscope} ORDER BY c.number LIMIT ${focus === 'controls' ? 60 : 30}`, args);
  if (controls.length) {
    out.push('<controls>');
    for (const c of controls) {
      ids.controls.add(c.id);
      out.push(`C-${c.number} id=${c.id} ${line({ useCase: c.card_key, library: c.code, title: c.title, owner: c.owner || 'none', status: c.status, tests: c.tests })}`);
    }
    out.push('</controls>');
  }
  const iscope = cardId ? 'AND i.card_id = $2' : '';
  const { rows: issues } = await db.query(`SELECT i.* FROM issues i WHERE i.engagement_id = $1 ${iscope} ORDER BY i.number DESC LIMIT 30`, args);
  if (issues.length) {
    out.push('<issues>', ...issues.map((i: any) => `I-${i.number} ${line({ title: i.title, severity: i.severity, status: i.status, owner: i.owner || 'none', due: i.due_date })}`), '</issues>');
  }
  if (!cardId) {
    const { rows: cards } = await db.query(`SELECT id, key, title, stage, status, tier FROM cards WHERE engagement_id = $1 ORDER BY number`, [engagementId]);
    for (const c of cards) ids.cards.add(c.id);
    out.push('<use_cases>', ...cards.map((c: any) => `${c.key} id=${c.id} ${line({ title: c.title, stage: c.stage, status: c.status, tier: c.tier })}`), '</use_cases>');
  }
}

// ---------------------------------------------------------------------------
// Suggestions: validated, kept to ids in the record, turned into API calls
// ---------------------------------------------------------------------------
export function checkSuggestion(raw: unknown, ctx: Context): { ok: true; s: z.infer<typeof AssistantSuggestion> } | { ok: false; why: string } {
  const p = AssistantSuggestion.safeParse(raw);
  if (!p.success) return { ok: false, why: p.error.issues[0]?.message ?? 'invalid' };
  const s = p.data;
  const has = (set: Set<string>, v?: string | null) => !v || set.has(v);
  if ('cardId' in s && s.cardId && !ctx.ids.cards.has(s.cardId)) return { ok: false, why: 'a use case not in this record' };
  if (s.kind === 'update_risk' && !has(ctx.ids.risks, s.riskId)) return { ok: false, why: 'a risk not in this record' };
  if (s.kind === 'update_control' && !has(ctx.ids.controls, s.controlId)) return { ok: false, why: 'a control not in this record' };
  if (s.kind === 'raise_issue' && !has(ctx.ids.controls, s.controlId)) return { ok: false, why: 'a control not in this record' };
  if (s.kind === 'decide_item') {
    if (!ctx.card || s.cardId !== ctx.card.id) return { ok: false, why: 'a decision outside this use case' };
    if (!undecided(ctx.card).includes(s.item) && !(ctx.card.decisions as any)?.[ctx.card.stage]?.[s.item]) return { ok: false, why: `${s.item} is not an item of the current draft` };
    if (s.decision !== 'accept' && (!s.reason || s.reason.trim().length < 3)) return { ok: false, why: 'an edit or rejection without a reason' };
  }
  return { ok: true, s };
}

export function toRequest(engagementId: string, s: z.infer<typeof AssistantSuggestion>): { method: string; path: string; body: unknown } {
  switch (s.kind) {
    case 'decide_item':
      return { method: 'POST', path: `/cards/${s.cardId}/decisions`, body: { item: s.item, decision: s.decision, ...(s.edit ? { edit: s.edit } : {}), ...(s.reason ? { reason: s.reason } : {}) } };
    case 'update_risk': {
      const { kind, riskId, title, why, ...patch } = s;
      return { method: 'PATCH', path: `/risks/${riskId}`, body: patch };
    }
    case 'update_control': {
      const { kind, controlId, title, why, ...patch } = s as any;
      return { method: 'PATCH', path: `/controls/${controlId}`, body: { ...(patch.newTitle ? { title: patch.newTitle } : {}), ...(patch.owner !== undefined ? { owner: patch.owner } : {}), ...(patch.objective !== undefined ? { objective: patch.objective } : {}) } };
    }
    case 'raise_issue':
      return { method: 'POST', path: `/engagements/${engagementId}/issues`, body: { title: s.issueTitle, description: s.description, severity: s.severity, controlId: s.controlId ?? null, cardId: s.cardId ?? null } };
    case 'rerun_agent':
      return { method: 'POST', path: `/cards/${s.cardId}/actions`, body: { action: 'request_changes', note: s.note } };
  }
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------
const SCHEMA = {
  type: 'object',
  required: ['answer', 'citations', 'suggestions'],
  properties: {
    answer: { type: 'string' },
    citations: { type: 'array', items: { type: 'string' } },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'title', 'why'],
        properties: {
          kind: { type: 'string', enum: ['decide_item', 'update_risk', 'update_control', 'raise_issue', 'rerun_agent'] },
          title: { type: 'string' }, why: { type: 'string' },
          cardId: { type: 'string' }, item: { type: 'string' }, decision: { type: 'string', enum: ['accept', 'edit', 'reject'] }, edit: { type: 'object' }, reason: { type: 'string' },
          riskId: { type: 'string' }, owner: { type: 'string' }, treatment: { type: 'string', enum: ['mitigate', 'transfer', 'avoid', 'accept'] },
          likelihood: { type: 'integer' }, impact: { type: 'integer' }, residual_likelihood: { type: 'integer' }, residual_impact: { type: 'integer' },
          controlId: { type: 'string' }, newTitle: { type: 'string' }, objective: { type: 'string' },
          issueTitle: { type: 'string' }, description: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          note: { type: 'string' },
        },
      },
    },
  },
};

interface Target { provider: ProviderRow; model: string }
export async function assistantTarget(db: Db): Promise<Target | null> {
  const s = await getSettings(db);
  if (!s.assistantProviderId || !s.assistantModel) return null;
  const provider = await getProviderRow(db, s.assistantProviderId);
  if (!provider || !provider.enabled || provider.type === 'rules') return null;
  return { provider, model: s.assistantModel };
}

export interface Reply { text: string; citations: string[]; passages: SourcePassage[]; suggestions: any[]; dropped: string[]; model: string; runtime: 'rules' | 'live'; costUsd: number }

export async function answer(db: Db, engagementId: string, ctx: Context, question: string, history: { role: string; text: string }[]): Promise<Reply> {
  const passages = mergePassages(
    await search(db, engagementId, question, { limit: 6 }),
    await search(db, engagementId, `${question} ${ctx.query}`.slice(0, 600), { limit: 4 }),
  );
  const target = await assistantTarget(db);
  if (!target) return rulesAnswer(ctx, question, passages);
  await checkCap(db, target);

  const user = [
    ctx.text,
    '',
    sourcesBlock(passages),
    '',
    ...(history.length ? ['<conversation>', ...history.slice(-8).map((m) => `${m.role}: ${m.text.slice(0, 1500)}`), '</conversation>', ''] : []),
    `<question>${question}</question>`,
  ].join('\n');
  const res = await callStructured({
    type: target.provider.type, baseUrl: target.provider.base_url, apiKey: apiKeyOf(target.provider), model: target.model, effort: 'medium',
    system: RULES, user, toolName: 'submit_answer', toolDescription: 'Answer the team member.', schema: SCHEMA, timeoutMs: 180_000,
  });
  const out = res.input as any;
  const citations = (Array.isArray(out?.citations) ? out.citations : []).map(String);
  const stray = strayCitations(citations, passages);
  const dropped: string[] = stray.map((s) => `citation ${s} (not a passage it was given)`);
  const suggestions: any[] = [];
  for (const raw of (Array.isArray(out?.suggestions) ? out.suggestions : []).slice(0, 6)) {
    const c = checkSuggestion(raw, ctx);
    if (c.ok) suggestions.push({ ...c.s, id: randomBytes(6).toString('hex'), status: 'open' });
    else dropped.push(`a suggestion "${String(raw?.title ?? raw?.kind ?? '').slice(0, 80)}" (${c.why})`);
  }
  const kept = citations.filter((c: string) => !stray.includes(c));
  return {
    text: String(out?.answer ?? '').slice(0, 6000) || 'No answer came back. Try asking again.',
    citations: kept, passages: passages.filter((p) => kept.includes(p.id)).map((p) => ({ ...p, text: p.text.slice(0, 1200) })),
    suggestions: suggestions.slice(0, 4), dropped, model: target.model, runtime: 'live',
    costUsd: target.provider.billed ? costUsd(priceFor(target.model, target.provider.prices), res.tokensIn, res.tokensOut, res.tokensCached) : 0,
  };
}

// Offline: no model, so no free-text reasoning. It shows what the knowledge
// base says, and the gaps the harness's own checks can see, with suggestions
// built from those checks.
function rulesAnswer(ctx: Context, question: string, passages: SourcePassage[]): Reply {
  const lines: string[] = [];
  const suggestions: any[] = [];
  const add = (s: any) => {
    const c = checkSuggestion(s, ctx);
    if (c.ok && suggestions.length < 4) suggestions.push({ ...c.s, id: randomBytes(6).toString('hex'), status: 'open' });
  };
  const card = ctx.card;
  if (card?.stage === 'classify' && card.classification) {
    const c = card.classification;
    lines.push(`The Risk Classifier proposes ${c.tier} risk with ${c.oversight.replace(/_/g, ' ')}, and ${c.risks.length} starting risks.`);
    const left = undecided(card);
    lines.push(left.length ? `${left.length} item${left.length === 1 ? '' : 's'} still need your decision: ${left.join(', ')}.` : 'Every item has a decision; a reviewer can approve.');
    const v = (card.verification as any)?.classify;
    c.risks.forEach((r, i) => {
      const verdict = v?.items.find((x: any) => x.item === `risk:${i}`);
      if (!r.sources.length) {
        lines.push(`risk:${i} "${r.title}" cites no source. Check it against the profile before keeping it.`);
      } else if (verdict && verdict.verdict !== 'supported') {
        lines.push(`The Verifier says risk:${i} "${r.title}" is ${verdict.verdict}: ${verdict.reason}`);
        add({ kind: 'rerun_agent', title: `Ask the Risk Classifier to reconsider "${r.title}"`, why: 'The Verifier found its sources don\'t back it up.', cardId: card.id, note: `Reconsider "${r.title}": the Verifier found it ${verdict.verdict} by its sources. Cite a passage that supports it or drop it.` });
      }
    });
    if (c.openQuestions.length) lines.push(`Questions for the business owner: ${c.openQuestions.join(' ')}`);
  } else if (card?.stage === 'design' && card.design) {
    lines.push(`The Control Designer proposes ${card.design.controls.length} controls.`);
    const left = undecided(card);
    if (left.length) lines.push(`${left.length} still need your decision.`);
    card.design.controls.forEach((c, i) => {
      if (!c.owner || /business owner/i.test(c.owner)) add({ kind: 'decide_item', title: `Name an owner for ${c.libraryCode ?? c.title}`, why: 'A control without a named owner is hard to test.', cardId: card.id, item: `control:${i}`, decision: 'edit', edit: { owner: card.useCase.businessOwner || 'Business owner' }, reason: 'Named the accountable owner' });
    });
    if (card.design.gaps.length) lines.push(`Gaps the agent noted: ${card.design.gaps.join(' ')}`);
  } else if (card) {
    lines.push(`${card.key} is at ${card.stage}, status ${card.status.replace('_', ' ')}.${card.statusNote ? ` ${card.statusNote}` : ''}`);
  }
  // Register gaps any reader would want flagged.
  const bare = ctx.text.split('\n').filter((l) => /^R-\d+ /.test(l) && / controls: 0\b/.test(l) && /score: (1[2-9]|2\d)\b/.test(l));
  if (bare.length) lines.push(`${bare.length} risk${bare.length === 1 ? '' : 's'} scoring 12 or more have no control: ${bare.map((l) => l.split(' ')[0]).join(', ')}.`);
  const noOwner = ctx.text.split('\n').filter((l) => /^R-\d+ /.test(l) && / owner: none\b/.test(l));
  for (const l of noOwner.slice(0, 2)) {
    const id = l.match(/id=([0-9a-f-]{36})/)?.[1];
    const uc = l.match(/useCase: (\S+)/)?.[1];
    if (id) add({ kind: 'update_risk', riskId: id, owner: 'Business owner', title: `Give ${l.split(' ')[0]} an owner`, why: `Every risk needs a named owner${uc ? ` (it belongs to ${uc})` : ''}. Change the name before applying if needed.` });
  }
  if (passages.length) lines.push(`From the knowledge base on "${question.slice(0, 80)}": ${passages.slice(0, 2).map((p) => `${p.title} (${p.id})`).join('; ')}. Open the sources below to read them.`);
  else lines.push('Nothing in the knowledge base matched the question.');
  lines.push('This is the offline assistant: it reports what the harness can check by itself. Choose a model for the assistant on the Models page for full answers.');
  const top = passages.slice(0, 2);
  return { text: lines.join('\n\n'), citations: top.map((p) => p.id), passages: top.map((p) => ({ ...p, text: p.text.slice(0, 1200) })), suggestions, dropped: [], model: 'rules', runtime: 'rules', costUsd: 0 };
}

export const toMessage = (r: any): AssistantMessage => ({
  id: r.id, role: r.role, text: r.text, citations: r.citations ?? [], passages: r.passages ?? [], suggestions: r.suggestions ?? [], dropped: r.dropped ?? [],
  model: r.model, runtime: r.runtime, author: r.author, at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
});
