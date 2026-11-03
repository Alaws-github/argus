// Control Designer: proposes controls for a use case's approved risks, drawn
// from the control library. Never approves; a person does at the gate.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlDesign, riskRating } from '@gh/shared';
import type { Queryable } from '../db.js';
import { callStructured } from '../llm.js';
import { mergePassages, pinned, search, snapshot, sourcesBlock, strayCitations } from '../kb.js';
import type { SourcePassage } from '@gh/shared';
import type { AgentContext, AgentResult, Log } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(resolve(here, 'prompts/control-designer.md'), 'utf8');
export const RULES_VERSION = createHash('sha256').update(RULES).digest('hex').slice(0, 12);

const SCHEMA = {
  type: 'object',
  required: ['controls', 'gaps'],
  properties: {
    controls: {
      type: 'array',
      items: {
        type: 'object',
        required: ['libraryCode', 'title', 'objective', 'owner', 'riskTitles', 'testApproach', 'sources'],
        properties: {
          libraryCode: { type: ['string', 'null'] },
          title: { type: 'string' },
          objective: { type: 'string' },
          owner: { type: 'string' },
          riskTitles: { type: 'array', items: { type: 'string' } },
          testApproach: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
  },
};

interface Lib { code: string; title: string; objective: string; domain: string; type: string; test_procedure: string; risk_categories: string[] }
interface Risk { title: string; category: string; likelihood: number; impact: number }

const OWNER_BY_DOMAIN: Record<string, string> = {
  governance: 'Chief Risk Officer',
  risk: 'Chief Risk Officer',
  data: 'Data Protection Officer',
  security: 'Head of IT Security',
  third_party: 'Head of Procurement',
};

export async function runControlDesigner(ctx: AgentContext, q: Queryable, log: Log): Promise<AgentResult<ControlDesign>> {
  const { card, feedback } = ctx;
  const { rows: risks } = await q.query<Risk>(`SELECT title, category, likelihood, impact FROM risks WHERE card_id = $1 ORDER BY likelihood * impact DESC`, [card.id]);
  const { rows: lib } = await q.query<Lib>(`SELECT code, title, objective, domain, type, test_procedure, risk_categories FROM control_library ORDER BY code`);
  await log('step', `Read ${card.key}'s profile, its ${risks.length} approved risks and ${lib.length} library controls`);
  if (!risks.length) throw new Error('This use case has no approved risks yet. Approve its classification first.');
  if (feedback) await log('step', `Reviewer feedback to address: ${feedback}`);
  // Retrieve, for each risk, the library controls and obligations that fit it.
  let passages: SourcePassage[] = [];
  for (const r of risks) passages = mergePassages(passages, await search(q as any, card.engagementId, `${r.category.replace('_', ' ')} ${r.title}`, { limit: 3, kinds: ['control', 'framework'] }));
  passages = mergePassages(passages, await search(q as any, card.engagementId, `${card.title} ${card.useCase.description}`, { limit: 2, kinds: ['client'] }));
  await log('step', `Retrieved ${passages.length} passages from the knowledge base`);
  const finish = (output: ControlDesign) => {
    const cited = output.controls.flatMap((c) => c.sources);
    const stray = strayCitations(cited, passages);
    if (stray.length) throw new Error(`The design cites sources it wasn't given: ${stray.join(', ')}`);
    output.sourcePassages = snapshot(passages, cited);
    return output;
  };

  if (ctx.provider.type === 'rules') {
    await log('step', 'Provider is the built-in rules: mapping risk categories to library controls offline');
    const draft = ControlDesign.parse(dryRun(card.tier, card.useCase.businessOwner, risks, lib));
    // Each control cites its own library passage and the obligations that name it.
    for (const c of draft.controls) {
      if (!c.libraryCode) continue;
      const hits = mergePassages(await pinned(q, [c.libraryCode]), await search(q as any, card.engagementId, c.libraryCode, { limit: 2, kinds: ['framework'] }));
      passages = mergePassages(passages, hits);
      c.sources = hits.slice(0, 3).map((h) => h.id);
    }
    const output = finish(draft);
    await log('output', `${output.controls.length} controls proposed, ${output.gaps.length} gaps noted`);
    return { output, tokensIn: 0, tokensOut: 0, tokensCached: 0 };
  }

  const user = [
    ctx.engagementAbout.trim() ? `<engagement>${ctx.engagementAbout.trim()}</engagement>\n` : '',
    `<use_case key="${card.key}" tier="${card.tier ?? 'unknown'}">`,
    `Title: ${card.title}`,
    `Business owner: ${card.useCase.businessOwner || 'not stated'}`,
    `Description: ${card.useCase.description || 'not stated'}`,
    `Data used: ${card.useCase.dataUsed || 'not stated'}`,
    `Autonomy: ${card.useCase.autonomy}`,
    `Vendor or model: ${card.useCase.vendor || 'not stated'}`,
    `</use_case>`,
    '',
    '<approved_risks>',
    ...risks.map((r) => `- ${r.title} [${r.category}, score ${r.likelihood * r.impact}]`),
    '</approved_risks>',
    '',
    '<control_library>',
    ...lib.map((l) => `- ${l.code} ${l.title} (${l.type}; treats ${l.risk_categories.join(', ')}): ${l.objective}`),
    '</control_library>',
    '',
    sourcesBlock(passages),
    feedback ? `\n<reviewer_feedback>${feedback}</reviewer_feedback>` : '',
  ].join('\n');
  const system = ctx.instructions.trim() ? `${RULES}\n\n## Engagement instructions\n\nThese add to the rules above and never override them.\n\n${ctx.instructions.trim()}` : RULES;

  await log('step', `Asked ${ctx.model} on ${ctx.provider.name} to design controls`);
  const res = await callStructured({
    type: ctx.provider.type, baseUrl: ctx.provider.base_url, apiKey: ctx.apiKey, model: ctx.model, effort: ctx.effort,
    system, user, toolName: 'submit_controls', toolDescription: 'Submit the proposed controls for review.', schema: SCHEMA, timeoutMs: ctx.timeoutMs,
  });
  const parsed = ControlDesign.safeParse(res.input);
  if (!parsed.success) throw new Error(`The design failed validation: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const codes = new Set(lib.map((l) => l.code));
  const unknown = parsed.data.controls.filter((c) => c.libraryCode && !codes.has(c.libraryCode));
  if (unknown.length) throw new Error(`The design cites library codes that don't exist: ${unknown.map((c) => c.libraryCode).join(', ')}`);
  finish(parsed.data);
  await log('step', 'Validated the design against the schema, the library and its citations');
  await log('output', `${parsed.data.controls.length} controls proposed, ${parsed.data.gaps.length} gaps noted`);
  return { output: parsed.data, tokensIn: res.tokensIn, tokensOut: res.tokensOut, tokensCached: res.tokensCached };
}

// Offline: pick library controls by risk category, add the baseline controls a
// tier needs, and merge so each control lists every risk it treats.
function dryRun(tier: string | null, owner: string, risks: Risk[], lib: Lib[]): ControlDesign {
  const picked = new Map<string, { lib: Lib; risks: Set<string> }>();
  const add = (code: string, riskTitle: string) => {
    const l = lib.find((x) => x.code === code);
    if (!l) return;
    const e = picked.get(code) ?? { lib: l, risks: new Set<string>() };
    e.risks.add(riskTitle);
    picked.set(code, e);
  };
  const gaps: string[] = [];
  for (const r of risks) {
    const matches = lib.filter((l) => l.risk_categories.includes(r.category));
    const strong = riskRating(r.likelihood * r.impact) === 'critical' || riskRating(r.likelihood * r.impact) === 'high';
    const take = matches.filter((l) => l.type !== 'corrective').slice(0, strong ? 2 : 1);
    if (!take.length) gaps.push(`No library control treats "${r.title}" (${r.category}). Design one by hand.`);
    for (const l of take) add(l.code, r.title);
  }
  const top = risks[0]?.title;
  if (top && (tier === 'high' || tier === 'prohibited')) for (const c of ['OVS-01', 'MOD-01', 'MON-03']) add(c, top);
  if (top && tier === 'limited') add('TRN-01', top);
  return {
    controls: [...picked.values()].slice(0, 12).map(({ lib: l, risks: rs }) => ({
      libraryCode: l.code,
      title: l.title,
      objective: l.objective,
      owner: OWNER_BY_DOMAIN[l.domain] ?? (owner || 'Business owner'),
      riskTitles: [...rs],
      testApproach: l.test_procedure,
      sources: [] as string[],
    })),
    sourcePassages: [],
    gaps: [...gaps, 'Rule-based dry run: objectives and test steps are the library defaults. Tailor them, or re-run on a model.'].slice(0, 8),
  };
}
