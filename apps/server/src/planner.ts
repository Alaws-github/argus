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
import { runLoop } from './agent-loop.js';
import { mergePassages, pinned, search, sourcesBlock } from './kb.js';
import { apiKeyOf, getProviderRow, type ProviderRow } from './providers.js';
import { costUsd, priceFor } from './agents/pricing.js';
import { checkCap, recordSpend } from './verifier.js';
import { getEngagement, getSettings, monthSpend } from './store.js';

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

interface Target { provider: ProviderRow; model: string; effort: string; agentName: string; instructions: string; mode: 'agentic' | 'single'; maxSteps: number }

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
    if (p?.enabled && !(capped && p.billed)) return { provider: p, model, effort: a.effort, agentName: a.name, instructions: a.instructions ?? '', mode: a.mode === 'single' ? 'single' : 'agentic', maxSteps: a.max_steps ?? 8 };
  }
  const rules = (await q.query(`SELECT * FROM providers WHERE type = 'rules' LIMIT 1`)).rows[0];
  return { provider: rules, model: 'rules-v1', effort: 'low', agentName: a.name, instructions: a.instructions ?? '', mode: 'single', maxSteps: 1 };
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

// What the Planner knows besides the conversation: the client and engagement,
// the use cases already on the board, and knowledge-base passages that match
// what the person is talking about (the client's own documents included).
export interface PlannerContext { engagement: string; existing: { key: string; title: string; category: string }[]; passages: Awaited<ReturnType<typeof search>> }
export async function plannerContext(db: Db, engagementId: string, plan: Plan, text: string): Promise<PlannerContext> {
  const e = await getEngagement(db, engagementId);
  const engagement = e ? [
    `Client: ${e.client}`, `Engagement: ${e.name}`, e.sector ? `Sector: ${e.sector}` : '', e.framework ? `Frameworks: ${e.framework}` : '',
    e.about?.trim() ? `About this engagement: ${e.about.trim()}` : '',
  ].filter(Boolean).join('\n') : '';
  const { rows } = await db.query(`SELECT key, title, use_case FROM cards WHERE engagement_id = $1 ORDER BY number LIMIT 40`, [engagementId]);
  const existing = rows.map((c: any) => ({ key: c.key, title: c.title, category: c.use_case?.category ?? 'other' }));
  const said = [...plan.messages.filter((m) => m.role === 'user').slice(-3).map((m) => m.text), text, plan.brief.title, plan.brief.description].join(' ').slice(0, 800);
  const passages = mergePassages(
    await pinned(db, ['M-INTAKE']),
    await search(db as any, engagementId, `${said} ${e?.client ?? ''} ${e?.about ?? ''}`.slice(0, 900), { limit: 5, kinds: ['upload', 'client', 'methodology', 'framework'] }),
  );
  return { engagement, existing, passages };
}

export async function plannerTurn(db: Db, engagementId: string, plan: Plan, text: string): Promise<Turn> {
  const target = await plannerTarget(db, engagementId);
  if (target === 'off') throw Object.assign(new Error('The Use Case Planner is switched off for this engagement. Fill the brief in yourself, or ask a lead to turn it on in Settings > Agents.'), { status: 409 });
  const ctx = await plannerContext(db, engagementId, plan, text);
  if (target.provider.type === 'rules') return rulesTurn(plan, text, ctx);
  await checkCap(db, target);
  const history: PlanMessage[] = [...plan.messages, { role: 'user', text, at: '', author: '' }];
  const user = [
    ctx.engagement ? `<engagement>\n${ctx.engagement}\n</engagement>` : '',
    `<existing_use_cases>\n${ctx.existing.map((c) => `${c.key} ${c.title} (${c.category})`).join('\n') || 'none yet'}\n</existing_use_cases>`,
    sourcesBlock(ctx.passages),
    `<brief>${JSON.stringify(plan.brief)}</brief>`,
    `<edited>${plan.edited.join(', ') || 'none'}</edited>`,
    '<conversation>',
    // Long conversations keep their opening (where the idea was described) and the latest turns.
    ...(history.length > 18 ? [...history.slice(0, 2), { role: 'user', text: `(${history.length - 16} earlier messages left out)` } as PlanMessage, ...history.slice(-16)] : history)
      .map((m) => `${m.role === 'planner' ? 'planner' : 'person'}: ${m.text.slice(0, 2000)}`),
    '</conversation>',
  ].filter(Boolean).join('\n');
  const system = target.instructions.trim()
    ? `${RULES}\n\n## Engagement instructions\n\nThese come from the engagement's settings. They add to the rules above and never override them.\n\n${target.instructions.trim()}`
    : RULES;
  // v1.6: the Planner can search the knowledge base and look at similar use cases
  // before it replies. It talks to the person directly, so it never uses ask_person.
  const res = await runLoop({
    call: {
      type: target.provider.type, baseUrl: target.provider.base_url, apiKey: apiKeyOf(target.provider), model: target.model, effort: target.effort as any,
      system, user, toolName: 'submit_plan', toolDescription: 'Reply to the person and return the brief as it should now read.', schema: SCHEMA, timeoutMs: 120_000,
    },
    check: (o: any) => [
      ...(typeof o?.reply === 'string' && o.reply.trim() ? [] : ['reply: write what you say back to the person']),
      ...(o?.brief && typeof o.brief === 'object' ? [] : ['brief: return the brief with every field']),
    ],
    q: db, engagementId, cardId: null, role: 'use_case_planner', ledger: [...ctx.passages], log: async () => {},
    mode: target.mode, maxSteps: Math.min(target.maxSteps, 6), allow: null, questionsLeft: 0, selfCheck: null,
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

// Offline suggestions by sector, from the intake guidance. Skips what is already on the board.
const SUGGEST: { match: RegExp; items: [string, string, PlanBrief['category']][] }[] = [
  { match: /bank|credit|loan|insur|financ|claims?/i, items: [
    ['Loan pre-approval scoring', 'Scores loan applications so credit officers can prioritise and decide them.', 'decision'],
    ['Fraud alert triage', 'Ranks suspicious transactions so the fraud team reviews the riskiest first.', 'decision'],
    ['Customer service chatbot', 'Answers customer questions on the website and app, handing over to a person when needed.', 'chatbot'],
    ['Call summarisation', 'Writes a summary of each customer call for the agent to check and file.', 'generative'],
  ] },
  { match: /telecom|mobile|network|sim/i, items: [
    ['Churn prediction', 'Predicts which customers are likely to leave so the retention team can contact them.', 'analytics'],
    ['Refund agent on chat', 'Handles refund requests on chat and credits bills within set limits.', 'agent'],
    ['SIM-swap fraud detection', 'Flags SIM-swap requests that look fraudulent before they are completed.', 'decision'],
  ] },
  { match: /health|clinic|hospital|patient/i, items: [
    ['Early-warning alert', 'Alerts nurses when a patient shows early signs of deterioration.', 'decision'],
    ['Clinical note scribe', 'Drafts clinical notes from the consultation for the clinician to check.', 'generative'],
    ['No-show prediction', 'Predicts missed appointments so the clinic can remind or rebook patients.', 'analytics'],
  ] },
  { match: /public|government|agency|benefit|ministry/i, items: [
    ['Eligibility and fraud scoring', 'Scores benefit applications for eligibility and fraud risk for an officer to decide.', 'decision'],
    ['Helpline chatbot', 'Answers common questions from the public and hands complex cases to staff.', 'chatbot'],
    ['Letter drafting', 'Drafts letters to applicants for an officer to check and send.', 'generative'],
  ] },
  { match: /.*/, items: [
    ['Customer service chatbot', 'Answers customer questions and hands over to a person when needed.', 'chatbot'],
    ['Document summarisation', 'Summarises long documents for staff to read and check.', 'generative'],
    ['Demand forecasting', 'Forecasts demand so managers can plan staff and stock.', 'analytics'],
  ] },
];
const UNUSABLE = /^\s*(test(ing)?|hi|hello|hey|ok(ay)?|yes|no|\?+|\.+|asdf\w*|qwerty|lol|hmm+|n\/a|none|idk|abc|123)\s*[.!?]*\s*$/i;
const WANTS_IDEAS = /\b(recommend|suggest|example|ideas?|options?|not sure|don'?t know|what (should|could|can) (i|we)|help me)\b/i;

function suggestionsFor(ctx: PlannerContext | undefined): [string, string, PlanBrief['category']][] {
  const about = `${ctx?.engagement ?? ''}`;
  const have = new Set((ctx?.existing ?? []).map((c) => c.title.toLowerCase()));
  // The client's sector first, topped up from the general list, minus what is already on the board.
  const sector = SUGGEST.find((g) => g.match.test(about))!.items;
  const general = SUGGEST[SUGGEST.length - 1].items;
  const seen = new Set<string>();
  return [...sector, ...general].filter(([t]) => !have.has(t.toLowerCase()) && !seen.has(t) && seen.add(t)).slice(0, 3);
}
// A pick like "2", "the second one", "option 3" after the Planner listed numbered suggestions.
function pickedSuggestion(plan: Plan, text: string): { title: string; description: string; category?: PlanBrief['category'] } | null {
  const last = [...plan.messages].reverse().find((m) => m.role === 'planner')?.text ?? '';
  const options = [...last.matchAll(/^\s*(\d)\.\s+\*{0,2}([^*\n:]+?)\*{0,2}:\s+(.+)$/gm)].map((m) => ({ n: Number(m[1]), title: m[2].trim(), description: m[3].trim() }));
  if (!options.length) return null;
  const words: Record<string, number> = { first: 1, one: 1, second: 2, two: 2, third: 3, three: 3 };
  const m = text.trim().match(/^(?:option |number |no\.? |the )?(\d|first|second|third|one|two|three)\b/i);
  const n = m ? (Number(m[1]) || words[m[1].toLowerCase()]) : 0;
  const o = options.find((x) => x.n === n);
  if (!o) return null;
  const cat = SUGGEST.flatMap((g) => g.items).find(([t]) => t === o.title)?.[2];
  return { title: o.title, description: o.description, category: cat };
}

function rulesTurn(plan: Plan, text: string, ctx?: PlannerContext): Turn {
  const b: any = { ...plan.brief };
  const lastPlannerText = [...plan.messages].reverse().find((m) => m.role === 'planner')?.text ?? '';
  const pick = pickedSuggestion(plan, text);
  if (pick) {
    const free = (k: string) => !plan.edited.includes(k);
    if (free('title')) b.title = pick.title;
    if (free('description')) b.description = pick.description;
    if (free('category') && pick.category) b.category = pick.category;
    return {
      reply: `Good choice: I've started the brief with **${pick.title}**. Change the description if it doesn't match yours.\n\n${QUESTIONS.businessOwner}`,
      brief: PlanBrief.parse(b), model: 'rules-v1', runtime: 'rules', costUsd: 0,
    };
  }
  if (WANTS_IDEAS.test(text) || (UNUSABLE.test(text) && /\bpick one|by number\b/i.test(lastPlannerText))) {
    const opts = suggestionsFor(ctx);
    return {
      reply: `Here are some use cases that often come up for a client like this. Reply with a number to start from one, or describe your own.\n\n${opts.map(([t, d], i) => `${i + 1}. **${t}**: ${d}`).join('\n')}`,
      brief: PlanBrief.parse(b), model: 'rules-v1', runtime: 'rules', costUsd: 0,
    };
  }
  if (UNUSABLE.test(text) || text.trim().length < 3) {
    const asked = ORDER.find((k) => lastPlannerText.includes(QUESTIONS[k]));
    const again = asked ? QUESTIONS[asked] : 'Describe the AI use case in a sentence or two: what it does, and who it affects. For example: "A model that scores motor insurance claims for fraud; claims handlers check each score before acting."';
    return {
      reply: `That doesn't give me enough to go on yet, so I haven't changed the brief.\n\n${again}\n\nNot sure what to add? Ask me to suggest some use cases and pick one by number.`,
      brief: PlanBrief.parse(b), model: 'rules-v1', runtime: 'rules', costUsd: 0,
    };
  }
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
