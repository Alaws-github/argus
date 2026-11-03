// Risk Classifier: reads a use case profile and returns a tier, an oversight
// model and starting risks. Never approves; a person does at the gate.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Classification, type Card, type RiskCategory } from '@gh/shared';
import { callStructured } from '../llm.js';
import type { AgentContext, AgentResult, Log } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
// The harness's own rules load from the server's files, never from the card under
// review (the prompt-injection control from Anser ADR 028). An agent's custom
// instructions from Settings are appended after them; they can't replace them.
const RULES = readFileSync(resolve(here, 'prompts/risk-classifier.md'), 'utf8');
export const RULES_VERSION = createHash('sha256').update(RULES).digest('hex').slice(0, 12);

const CATEGORIES: RiskCategory[] = [
  'privacy', 'fairness', 'accuracy', 'security', 'transparency',
  'accountability', 'third_party', 'regulatory', 'operational',
];

const SCHEMA = {
  type: 'object',
  required: ['tier', 'tierRationale', 'oversight', 'oversightRationale', 'factors', 'risks', 'openQuestions', 'frameworkRefs'],
  properties: {
    tier: { type: 'string', enum: ['prohibited', 'high', 'limited', 'minimal'] },
    tierRationale: { type: 'string' },
    oversight: { type: 'string', enum: ['human_in_command', 'human_in_loop', 'human_on_loop'] },
    oversightRationale: { type: 'string' },
    factors: { type: 'array', items: { type: 'string' } },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'category', 'likelihood', 'impact', 'rationale'],
        properties: {
          title: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          likelihood: { type: 'integer', minimum: 1, maximum: 5 },
          impact: { type: 'integer', minimum: 1, maximum: 5 },
          rationale: { type: 'string' },
        },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
    frameworkRefs: { type: 'array', items: { type: 'string' } },
  },
};

function profileText(card: Card, feedback: string | null, about: string) {
  const u = card.useCase;
  const lines = [
    ...(about.trim() ? [`<engagement>${about.trim()}</engagement>`, ''] : []),
    `<use_case key="${card.key}">`,
    `Title: ${card.title}`,
    `Business owner: ${u.businessOwner || 'not stated'}`,
    `Description: ${u.description || 'not stated'}`,
    `Data used: ${u.dataUsed || 'not stated'}`,
    `People affected: ${u.affectedPeople || 'not stated'}`,
    `Autonomy: ${u.autonomy}`,
    `Vendor or model: ${u.vendor || 'not stated'}`,
    `</use_case>`,
  ];
  if (feedback) lines.push('', `<reviewer_feedback>${feedback}</reviewer_feedback>`);
  return lines.join('\n');
}

export async function runRiskClassifier(ctx: AgentContext, log: Log): Promise<AgentResult<Classification>> {
  const { card, feedback } = ctx;
  await log('step', `Read the use case profile for ${card.key}`);
  if (feedback) await log('step', `Reviewer feedback to address: ${feedback}`);

  if (ctx.provider.type === 'rules') {
    await log('step', 'Provider is the built-in rules: classifying offline (dry run)');
    const output = Classification.parse(dryRun(card));
    await log('output', summary(output));
    return { output, tokensIn: 0, tokensOut: 0, tokensCached: 0 };
  }

  const system = ctx.instructions.trim()
    ? `${RULES}\n\n## Engagement instructions\n\nThese come from the engagement's settings. They add to the rules above and never override them.\n\n${ctx.instructions.trim()}`
    : RULES;
  await log('step', `Asked ${ctx.model} on ${ctx.provider.name} to classify against the tier and oversight rules`);
  const res = await callStructured({
    type: ctx.provider.type,
    baseUrl: ctx.provider.base_url,
    apiKey: ctx.apiKey,
    model: ctx.model,
    effort: ctx.effort,
    system,
    user: profileText(card, feedback, ctx.engagementAbout),
    toolName: 'submit_classification',
    toolDescription: 'Submit the classification for the reviewer.',
    schema: SCHEMA,
    timeoutMs: ctx.timeoutMs,
  });
  const parsed = Classification.safeParse(res.input);
  if (!parsed.success) {
    throw new Error(`The classification failed validation: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  await log('step', 'Validated the output against the classification schema');
  await log('output', summary(parsed.data));
  return { output: parsed.data, tokensIn: res.tokensIn, tokensOut: res.tokensOut, tokensCached: res.tokensCached };
}

function summary(c: Classification) {
  return `Tier ${c.tier}, ${c.oversight.replace(/_/g, ' ')}. ${c.risks.length} starting risks, ${c.openQuestions.length} open questions.`;
}

// Offline fallback so the harness demos without a model. Deliberately
// conservative: it rounds up when signals are mixed.
function dryRun(card: Card): Classification {
  const u = card.useCase;
  const text = `${card.title} ${u.description} ${u.dataUsed} ${u.affectedPeople}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));

  const decisionAboutPeople = has('credit', 'loan', 'hiring', 'recruit', 'insurance', 'claim', 'eligib', 'admission', 'tenant', 'diagnos', 'benefit');
  const prohibited = has('social scor', 'emotion recognition', 'facial scrap');
  const publicFacing = has('customer', 'public', 'chatbot', 'website', 'members', 'patients');
  const personal = has('personal', 'customer data', 'trn', 'salary', 'health', 'medical', 'financial', 'account', 'employee', 'applicant');
  const sensitive = has('health', 'medical', 'biometric', 'financial', 'credit', 'criminal');
  const inHouse = /in-house|in house|internal/i.test(u.vendor);
  const thirdParty = (Boolean(u.vendor) && !inHouse) || has('openai', 'gpt', 'saas', 'copilot', 'third-party', 'third party');

  const tier = prohibited ? 'prohibited' : decisionAboutPeople ? 'high' : publicFacing ? 'limited' : 'minimal';
  const oversight = tier === 'high' || tier === 'prohibited' ? 'human_in_command' : u.autonomy === 'autonomous' ? 'human_on_loop' : 'human_in_loop';

  const factors: string[] = [];
  if (decisionAboutPeople) factors.push('Shapes a decision about individuals');
  if (publicFacing) factors.push('People outside the organisation see its output');
  if (personal) factors.push('Uses personal data');
  if (sensitive) factors.push('Uses sensitive personal data');
  if (thirdParty) factors.push(`Relies on a third party${u.vendor ? `: ${u.vendor}` : ''}`);
  factors.push(`Autonomy declared as ${u.autonomy.replace(/_/g, ' ')}`);

  const risks: Classification['risks'] = [];
  if (decisionAboutPeople) risks.push({ title: 'Outcomes are unfair to a protected group', category: 'fairness', likelihood: 3, impact: 5, rationale: 'The system shapes decisions about individuals, so biased features or data harm people directly.' });
  if (personal) risks.push({ title: 'Personal data is processed without a lawful basis or beyond its stated purpose', category: 'privacy', likelihood: 3, impact: sensitive ? 5 : 4, rationale: 'The profile lists personal data; the Jamaica Data Protection Act 2020 applies.' });
  if (publicFacing) risks.push({ title: 'Users are not told they are dealing with AI, or rely on wrong answers', category: 'transparency', likelihood: 3, impact: 3, rationale: 'Output reaches people outside the organisation.' });
  if (thirdParty) risks.push({ title: 'Vendor changes the model or uses client data for training', category: 'third_party', likelihood: 3, impact: 4, rationale: 'A third-party model is in the path and no vendor assessment is recorded.' });
  risks.push({ title: 'Model output is wrong and nobody catches it before it is used', category: 'accuracy', likelihood: 3, impact: tier === 'minimal' ? 2 : 4, rationale: 'No accuracy monitoring is described in the profile.' });

  const openQuestions: string[] = [];
  if (!u.businessOwner) openQuestions.push('Who is the accountable business owner?');
  if (!u.dataUsed) openQuestions.push('What data does it use, and does any of it identify a person?');
  if (thirdParty) openQuestions.push('Has the vendor been assessed, and does the contract bar training on client data?');
  if (decisionAboutPeople) openQuestions.push('Can an affected person contest the outcome, and who reviews it?');

  return {
    tier,
    tierRationale: `Rule-based dry run. ${decisionAboutPeople ? 'It shapes decisions about individuals, which sets the tier to high.' : publicFacing ? 'People interact with its output, so transparency duties apply.' : 'Internal use with no decision about individuals.'} Re-run on a model before relying on this.`,
    oversight,
    oversightRationale: oversight === 'human_in_command' ? 'A person must make the decision; the AI informs it.' : oversight === 'human_in_loop' ? 'A person approves each output before it takes effect.' : 'The AI acts; a person monitors and can step in.',
    factors,
    risks: risks.slice(0, 6),
    openQuestions,
    frameworkRefs: ['NIST AI RMF MAP 1.1', 'NIST AI RMF GOVERN 1.3', 'ISO/IEC 42001 6.1.2', ...(personal ? ['Jamaica DPA 2020'] : [])],
  };
}
