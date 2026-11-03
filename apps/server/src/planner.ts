// The Use Case Planner: the first agent a use case meets. The person describes
// the idea; the Planner asks questions and drafts the intake brief. The person
// edits the brief and adds it to Intake under their own name. Fields a person
// typed are never overwritten by the Planner.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_FIELDS, PlanBrief, type Plan, type PlanMessage } from '@gh/shared';
import type { Db, Queryable } from './db.js';
import { callStructured } from './llm.js';
import { apiKeyOf, getProviderRow, type ProviderRow } from './providers.js';
import { costUsd, priceFor } from './agents/pricing.js';
import { checkCap, recordSpend } from './verifier.js';
import { getSettings, monthSpend } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(resolve(here, 'agents/prompts/use-case-planner.md'), 'utf8');
export const PLANNER_RULES_VERSION = createHash('sha256').update(RULES).digest('hex').slice(0, 12);

const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));

export const missingFields = (b: PlanBrief) =>
  PLAN_FIELDS.filter((f) => f.required && !String(b[f.key] ?? '').trim()).map((f) => f.label);

export const toPlan = (r: any): Plan => {
  const brief = PlanBrief.parse(r.brief ?? {});
  return {
    id: r.id, key: `P-${r.number}`, mode: r.mode, status: r.status, brief, edited: r.edited ?? [], messages: r.messages ?? [],
    missing: missingFields(brief), cardKey: r.card_key ?? null, createdBy: r.created_by, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
};

export const OPENING =
  "What AI use case do you want to put through governance? Describe what it does and who it affects in a sentence or two. I'll ask a few questions, then draft a brief you can edit.";

interface Target { provider: ProviderRow; model: string; effort: string; agentName: string }

// The engagement's Use Case Planner agent and the model it should use now.
// Returns null when the agent is switched off (the person fills it in by hand).
export async function plannerTarget(q: Queryable, engagementId: string): Promise<Target | 'off'> {
  const { rows } = await q.query(
    `SELECT * FROM agents WHERE engagement_id = $1 AND role = 'use_case_planner' AND enabled ORDER BY custom NULLS FIRST, created_at LIMIT 1`, [engagementId]);
  const a = rows[0];
  if (!a) return 'off';
  const s = await getSettings(q);
  const capped = s.pauseAtCap && s.spendCapUsd != null && (await monthSpend(q, s.timeZone)) >= s.spendCapUsd;
  for (const [pid, model] of [[a.provider_id, a.model], [a.fallback_provider_id ?? a.provider_id, a.fallback_model]]) {
    if (!pid || !model) continue;
    const p = await getProviderRow(q, pid);
    if (p?.enabled && !(capped && p.billed)) return { provider: p, model, effort: a.effort, agentName: a.name };
  }
  const rules = (await q.query(`SELECT * FROM providers WHERE type = 'rules' LIMIT 1`)).rows[0];
  return { provider: rules, model: 'rules-v1', effort: 'low', agentName: a.name };
}

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    brief: {
      type: 'object',
      properties: {
        title: { type: 'string' }, description: { type: 'string' }, businessOwner: { type: 'string' }, dataUsed: { type: 'string' },
        affectedPeople: { type: 'string' }, vendor: { type: 'string' },
        autonomy: { type: 'string', enum: ['assistive', 'human_in_loop', 'human_on_loop', 'autonomous'] },
        category: { type: 'string', enum: ['decision', 'chatbot', 'agent', 'generative', 'analytics', 'other'] },
        priority: { type: 'string', enum: ['p1', 'p2', 'p3'] },
      },
      required: ['title', 'description', 'businessOwner', 'dataUsed', 'affectedPeople', 'autonomy', 'vendor', 'category', 'priority'],
    },
    ready: { type: 'boolean' },
  },
  required: ['reply', 'brief', 'ready'],
};

export interface Turn { reply: string; brief: PlanBrief; model: string; runtime: 'rules' | 'live'; costUsd: number }

// Keep what the person typed; take the Planner's value for everything else.
function merge(current: PlanBrief, proposed: Partial<PlanBrief>, edited: string[]): PlanBrief {
  const out: any = { ...current };
  for (const f of PLAN_FIELDS) {
    if (edited.includes(f.key)) continue;
    const v = (proposed as any)[f.key];
    if (typeof v === 'string' && v.trim()) out[f.key] = v.trim();
  }
  const parsed = PlanBrief.safeParse(out);
  return parsed.success ? parsed.data : current;
}

export async function plannerTurn(db: Db, engagementId: string, plan: Plan, text: string): Promise<Turn> {
  const target = await plannerTarget(db, engagementId);
  if (target === 'off') throw Object.assign(new Error('The Use Case Planner is switched off for this engagement. Fill the brief in yourself, or ask a lead to turn it on in Settings > Agents.'), { status: 409 });
  if (target.provider.type === 'rules') return rulesTurn(plan, text);
  await checkCap(db, target);
  const history: PlanMessage[] = [...plan.messages, { role: 'user', text, at: '', author: '' }];
  const user = [
    `<brief>${JSON.stringify(plan.brief)}</brief>`,
    `<edited>${plan.edited.join(', ') || 'none'}</edited>`,
    '<conversation>',
    ...history.slice(-16).map((m) => `${m.role === 'planner' ? 'planner' : 'person'}: ${m.text.slice(0, 2000)}`),
    '</conversation>',
  ].join('\n');
  const res = await callStructured({
    type: target.provider.type, baseUrl: target.provider.base_url, apiKey: apiKeyOf(target.provider), model: target.model, effort: target.effort as any,
    system: RULES, user, toolName: 'submit_plan', toolDescription: 'Reply to the person and return the brief as it should now read.', schema: SCHEMA, timeoutMs: 120_000,
  });
  const out = res.input as any;
  const brief = merge(plan.brief, out?.brief ?? {}, plan.edited);
  const usd = target.provider.billed ? costUsd(priceFor(target.model, target.provider.prices), res.tokensIn, res.tokensOut, res.tokensCached) : 0;
  await recordSpend(db, 'Use Case Planner', target.model, usd);
  return { reply: String(out?.reply ?? '').slice(0, 3000) || 'I updated the brief. Check it on the right.', brief, model: target.model, runtime: 'live', costUsd: usd };
}

// ---------------------------------------------------------------- offline rules
// No model: the Planner files each answer under the question it asked, spots a
// few obvious things from keywords, and asks for the next missing field.
const QUESTIONS: Record<string, string> = {
  title: 'What should we call it? A short name is fine, for example "Loan pre-approval scoring".',
  description: 'What does it do, and who acts on what it produces?',
  businessOwner: 'Who in the business is accountable for it? A role is enough, for example "Head of Retail Credit".',
  dataUsed: 'What data does it use? Name each source, and say if any of it identifies a person.',
  affectedPeople: 'Who sees its output or is decided about by it? Roughly how many?',
  autonomy: 'Does a person check each output before it takes effect, or does it act on its own?',
  vendor: 'Is it built in-house, or bought from a vendor? Which product or model?',
};
const ORDER = ['title', 'description', 'businessOwner', 'dataUsed', 'affectedPeople', 'autonomy', 'vendor'] as const;

function guessCategory(t: string): PlanBrief['category'] | null {
  if (/\b(chat ?bot|chatbot|virtual assistant|whatsapp|answers? (customer )?questions)\b/i.test(t)) return 'chatbot';
  if (/\b(agent|agentic|takes? actions?|books?|executes?|sends? (emails|payments))\b/i.test(t)) return 'agent';
  if (/\b(summari[sz]|draft|writes?|generat|copilot|gpt|translate)/i.test(t)) return 'generative';
  if (/\b(scor|approv|declin|credit|fraud|triage|rank|eligib|underwrit|claims?|hire|hiring|screen)/i.test(t)) return 'decision';
  if (/\b(forecast|predict|dashboard|analytics|segment)/i.test(t)) return 'analytics';
  return null;
}
function guessAutonomy(t: string): PlanBrief['autonomy'] | null {
  if (/\b(fully automat|no (human|person)|without (review|a person|anyone)|on its own|automatically (approves|declines|sends|pays))/i.test(t)) return 'autonomous';
  if (/\b(monitor|spot.?check|sample|reviews? (some|a sample))/i.test(t)) return 'human_on_loop';
  if (/\b(approves? each|reviews? (each|every)|checks? (each|every)|signs? off|confirm|override)/i.test(t)) return 'human_in_loop';
  if (/\b(suggest|assist|helps?|recommend)/i.test(t)) return 'assistive';
  return null;
}
const guessPeople = (t: string) => {
  const hits = ['customers', 'applicants', 'employees', 'staff', 'claimants', 'policyholders', 'patients', 'members', 'students', 'candidates', 'directors']
    .filter((w) => new RegExp(`\\b${w.replace(/s$/, '')}s?\\b`, 'i').test(t));
  return hits.length ? hits.map((h) => h[0].toUpperCase() + h.slice(1)).join(', ') + ' (from your description; check it)' : '';
};
const titleFrom = (t: string) =>
  t.replace(/^(hi|hello)[,!.\s]+/i, '').replace(/^(we|i)( want| would like| need| plan)? to (build|use|add|launch|deploy|introduce|roll out|put in)\s+/i, '')
    .replace(/^(an?|the)\s+/i, '').split(/[.!?\n]| that | which | to /i)[0].trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 80);

function rulesTurn(plan: Plan, text: string): Turn {
  const b: any = { ...plan.brief };
  const free = (k: string) => !plan.edited.includes(k);
  const lastAsk = [...plan.messages].reverse().find((m) => m.role === 'planner')?.text ?? '';
  const asked = ORDER.find((k) => lastAsk.includes(QUESTIONS[k]));
  const first = !plan.messages.some((m) => m.role === 'user');

  if (asked && free(asked) && asked !== 'autonomy') b[asked] = text.trim().slice(0, asked === 'title' ? 160 : 2000);
  if (first) {
    if (free('description') && !b.description) b.description = text.trim().slice(0, 4000);
    if (free('title') && !b.title) { const t = titleFrom(text); const words = t.split(/\s+/).length; if (words >= 3 && words <= 10) b.title = t; }
  }
  const all = `${b.description} ${text}`;
  const auto = guessAutonomy(asked === 'autonomy' ? text : all);
  if (free('autonomy') && auto && (asked === 'autonomy' || !plan.messages.length || first)) b.autonomy = auto;
  const cat = guessCategory(all);
  if (free('category') && cat) b.category = cat;
  if (free('priority') && /\b(urgent|asap|already live|in production|regulator|deadline)\b/i.test(text)) b.priority = 'p1';
  if (free('affectedPeople') && !b.affectedPeople) b.affectedPeople = guessPeople(all);
  if (free('vendor') && !b.vendor) {
    const v = /\b(in-house|chatgpt|gpt-?\d\w*|claude|gemini|copilot|azure openai|openai|anthropic|salesforce|servicenow)\b/i.exec(all)?.[0];
    if (v) b.vendor = v;
  }

  const brief = PlanBrief.parse(b);
  // Autonomy has a default, so it counts as answered only once asked or guessed.
  const autonomyKnown = plan.edited.includes('autonomy') || asked === 'autonomy' || !!auto || plan.messages.some((m) => m.role === 'planner' && m.text.includes(QUESTIONS.autonomy));
  const next = ORDER.find((k) => (k === 'autonomy' ? !autonomyKnown : !String((brief as any)[k] ?? '').trim()) && !(k === 'vendor' && plan.messages.some((m) => m.text.includes(QUESTIONS.vendor))));
  const lines: string[] = [];
  if (first) lines.push("Thanks. I've started the brief on the right from what you wrote.");
  else lines.push('Got it, I added that to the brief.');
  if (next) lines.push(QUESTIONS[next]);
  else lines.push('The brief has everything Intake needs. Check each field on the right, change anything that isn\'t quite right, then click Add to Intake.');
  if (first) lines.push('(I\'m running on the offline rules, so I only fill the brief from your words. A lead can give me a model in Settings > Agents for better drafting.)');
  return { reply: lines.join('\n\n'), brief, model: 'rules-v1', runtime: 'rules', costUsd: 0 };
}
