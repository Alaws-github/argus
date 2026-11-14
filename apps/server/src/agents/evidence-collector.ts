// The Evidence Collector (Collect evidence stage): lists the evidence each control of a use case
// needs, what has arrived and what is still missing. It drafts; a person collects and moves on.
import { EvidencePlan } from '@gh/shared';
import type { SourcePassage } from '@gh/shared';
import type { Queryable } from '../core/db.js';
import { mergePassages, pinned, snapshot, sourcesBlock, strayCitations } from '../knowledge/kb.js';
import {
  S,
  ask,
  clientPassages,
  controlsOf,
  evidenceOf,
  str,
  strs,
  wrapEvidence,
  type Ctl,
  type Ev,
} from './drafting.js';
import type { AgentContext, AgentResult, Log } from './types.js';

/** The answer the model fills in. */
const EVIDENCE_PLAN_SCHEMA = S({
  requests: {
    type: 'array',
    items: S({
      controlKey: str,
      item: str,
      why: str,
      askFrom: str,
      status: { type: 'string', enum: ['received', 'partial', 'missing'] },
      evidenceKeys: strs,
      note: str,
      sources: strs,
    }),
  },
  summary: str,
});

/**
 * What the agent works from: the use case's controls, their evidence, and the passages it may cite
 * (each control's library entry, the evidence-strength guidance and matching client documents).
 */
async function evidenceInputs(ctx: AgentContext, q: Queryable, log: Log) {
  const controls = await controlsOf(q, ctx.card.id);
  if (!controls.length) throw new Error('This use case has no controls yet. Approve its control design first.');
  const evidence = await evidenceOf(q, controls);
  await log('step', `Read ${controls.length} controls and ${evidence.length} evidence items for ${ctx.card.key}`);
  const passages = mergePassages(
    await pinned(q, ['M-EVIDENCE', ...(controls.map((c) => c.code).filter(Boolean) as string[])]),
    await clientPassages(
      q,
      ctx.card.engagementId,
      `evidence ${ctx.card.title} ${controls.map((c) => c.title).join(' ')}`,
    ),
  );
  await log(
    'step',
    `Retrieved ${passages.length} passages: library entries, evidence guidance and matching client documents`,
  );
  return { controls, evidence, passages };
}

/**
 * The offline rules: each control's expected evidence, matched to uploads by control. They can't
 * read contents, so a control with only walkthrough notes is "partial".
 */
function evidencePlanByRules(controls: Ctl[], evidence: Ev[], passages: SourcePassage[]): EvidencePlan {
  const libPassage = (c: Ctl) => passages.filter((p) => p.ref === c.code).map((p) => p.id);
  const guide = passages.filter((p) => p.ref === 'M-EVIDENCE').map((p) => p.id);
  const requests = controls.map((c) => {
    const mine = evidence.filter((e) => e.controlId === c.id);
    const strong = mine.filter((e) => e.kind !== 'note');
    return {
      controlKey: c.key,
      item: c.expected || `Evidence that "${c.title}" operates, covering the test period`,
      why: c.objective.slice(0, 380) || 'Shows the control is in place and operating',
      askFrom: c.owner || 'Control owner',
      status: (strong.length ? 'received' : mine.length ? 'partial' : 'missing') as 'received' | 'partial' | 'missing',
      evidenceKeys: mine.map((e) => e.key).slice(0, 10),
      note: strong.length
        ? 'Matched by control. Check it covers the whole test period.'
        : mine.length
          ? 'Only walkthrough notes so far; ask for a system export or sample.'
          : 'Nothing uploaded yet.',
      sources: [...libPassage(c), ...(mine.length && !strong.length ? guide : [])],
    };
  });
  const missing = requests.filter((r) => r.status !== 'received').length;
  return EvidencePlan.parse({
    requests,
    summary: `${requests.length} requests across ${controls.length} controls; ${missing} still missing or partial. Rule-based dry run: matches are by control, not by reading contents.`,
  });
}

/** The model's brief: the use case, its controls, the uploaded evidence (wrapped as data) and the sources. */
function evidenceBrief(ctx: AgentContext, controls: Ctl[], evidence: Ev[], passages: SourcePassage[]) {
  return [
    `<use_case key="${ctx.card.key}" tier="${ctx.card.tier ?? 'unknown'}">${ctx.card.title}</use_case>`,
    '<controls>',
    ...controls.map(
      (c) =>
        `- ${c.key} ${c.title} (owner: ${c.owner || 'not set'}). Objective: ${c.objective}. Evidence usually expected: ${c.expected || 'not stated'}`,
    ),
    '</controls>',
    '<uploaded_evidence>',
    ...(evidence.length
      ? evidence.map(
          (e) => `${wrapEvidence(e)}\n(attached to ${controls.find((c) => c.id === e.controlId)?.key ?? 'a test'})`,
        )
      : ['None yet.']),
    '</uploaded_evidence>',
    sourcesBlock(passages),
  ].join('\n');
}

/** Rule 6: every control and evidence key belongs to this use case, and every source is one it was given. */
function checkEvidencePlan(plan: EvidencePlan, controls: Ctl[], evidence: Ev[], passages: SourcePassage[]) {
  const ctlKeys = new Set(controls.map((c) => c.key));
  const evKeys = new Set(evidence.map((e) => e.key));
  const bad = plan.requests.flatMap((r) => [
    ...(ctlKeys.has(r.controlKey) ? [] : [r.controlKey]),
    ...r.evidenceKeys.filter((k) => !evKeys.has(k)),
  ]);
  const strayK = strayCitations(
    plan.requests.flatMap((r) => r.sources),
    passages,
  );
  if (bad.length || strayK.length)
    throw new Error(
      `The draft cites keys that aren't part of this use case: ${[...new Set([...bad, ...strayK])].join(', ')}`,
    );
}

/** Drafts the evidence request list for one use case. */
export async function runEvidenceCollector(
  ctx: AgentContext,
  q: Queryable,
  log: Log,
): Promise<AgentResult<EvidencePlan>> {
  const { controls, evidence, passages } = await evidenceInputs(ctx, q, log);
  let result: AgentResult<EvidencePlan>;
  if (ctx.provider.type === 'rules') {
    await log(
      'step',
      "Provider is the built-in rules: listing each control's expected evidence and matching uploads by control",
    );
    result = {
      output: evidencePlanByRules(controls, evidence, passages),
      tokensIn: 0,
      tokensOut: 0,
      tokensCached: 0,
    };
  } else {
    result = await ask(
      ctx,
      log,
      'evidence_collector',
      'submit_evidence_plan',
      EVIDENCE_PLAN_SCHEMA,
      EvidencePlan,
      evidenceBrief(ctx, controls, evidence, passages),
      q,
      passages,
    );
  }
  checkEvidencePlan(result.output, controls, evidence, passages);
  result.output.sourcePassages = snapshot(
    passages,
    result.output.requests.flatMap((r) => r.sources),
  );
  await log('step', 'Checked every control, evidence and source key against the register');
  await log(
    'output',
    `${result.output.requests.length} evidence requests, ${result.output.requests.filter((r) => r.status === 'missing').length} missing`,
  );
  return result;
}
