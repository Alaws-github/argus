// The Review assistant (Validate stage, role independent_reviewer): challenges a use case before
// sign-off. The standard checks run on every provider because they are facts, not judgement; a
// model adds its own challenges on top but can never remove one. A person signs off (rule 1).
import { ReviewChallenges, riskRating } from '@gh/shared';
import type { SourcePassage } from '@gh/shared';
import type { Queryable } from '../core/db.js';
import { sourcesBlock } from '../knowledge/kb.js';
import { S, ask, clientPassages, controlsOf, str, type Ctl } from './drafting.js';
import type { AgentContext, AgentResult, Log } from './types.js';

type Challenge = ReviewChallenges['challenges'][number];
const OPEN_ISSUE = ['open', 'in_remediation', 'ready_for_retest'];
const CONCLUDED = ['passed', 'failed'];

/** The answer the model fills in. */
const REVIEW_SCHEMA = S({
  challenges: {
    type: 'array',
    items: S({
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      area: { type: 'string', enum: ['evidence', 'testing', 'issues', 'risk', 'controls', 'other'] },
      finding: str,
      ref: str,
    }),
  },
  readiness: { type: 'string', enum: ['ready', 'not_ready'] },
  summary: str,
});

/** What the review works from: the use case's controls, tests (with evidence counts), issues, risks and appetite. */
async function reviewInputs(ctx: AgentContext, q: Queryable, log: Log) {
  const controls = await controlsOf(q, ctx.card.id);
  const ids = controls.map((c) => c.id);
  const { rows: tests } = await q.query(
    `SELECT t.*, (SELECT count(*)::int FROM evidence e WHERE e.test_id = t.id OR e.control_id = t.control_id) AS ev,
       (SELECT count(*)::int FROM evidence e WHERE (e.test_id = t.id OR e.control_id = t.control_id) AND e.kind <> 'note') AS ev_strong
     FROM tests t WHERE t.control_id = ANY($1) ORDER BY t.number`,
    [ids],
  );
  const { rows: issues } = await q.query(
    `SELECT * FROM issues WHERE card_id = $1 OR control_id = ANY($2) ORDER BY number`,
    [ctx.card.id, ids],
  );
  const { rows: risks } = await q.query(
    `SELECT r.*, (SELECT count(*)::int FROM control_risks cr JOIN controls c ON c.id = cr.control_id WHERE cr.risk_id = r.id AND c.status = 'operating') AS operating FROM risks r WHERE r.card_id = $1 ORDER BY r.number`,
    [ctx.card.id],
  );
  const { rows: eng } = await q.query(`SELECT appetite FROM engagements WHERE id = $1`, [ctx.card.engagementId]);
  const { rows: people } = await q.query(`SELECT name, former_names FROM users`);
  const appetite: number = eng[0]?.appetite?.maxResidual ?? 8;
  // Two names are the same person when one account has had both (segregation of duties, rule 3).
  const samePerson = (a: string | null, b: string | null) =>
    !!a &&
    !!b &&
    people.some((p: any) => {
      const names = [p.name, ...(p.former_names ?? [])];
      return names.includes(a) && names.includes(b);
    });
  await log(
    'step',
    `Read ${controls.length} controls, ${tests.length} tests, ${issues.length} issues and ${risks.length} risks`,
  );
  return { controls, tests: tests as any[], issues: issues as any[], risks: risks as any[], appetite, samePerson };
}
type ReviewInputs = Awaited<ReturnType<typeof reviewInputs>>;

/** Standard checks on the tests: evidence behind each result, sample size, exceptions, review, issues, same person. */
function testChallenges({ tests, issues, samePerson }: ReviewInputs): Challenge[] {
  const ch: Challenge[] = [];
  for (const t of tests) {
    const key = `T-${t.number}`;
    if (CONCLUDED.includes(t.status) && !t.ev)
      ch.push({
        severity: 'high',
        area: 'testing',
        finding: `${key} was concluded ${t.status} with no evidence on it or its control. Attach the workpaper or retest.`,
        ref: key,
      });
    else if (t.status === 'passed' && !t.ev_strong)
      ch.push({
        severity: 'medium',
        area: 'evidence',
        finding: `${key} passed on walkthrough notes only. Ask for a system export or sample.`,
        ref: key,
      });
    if (t.status === 'passed' && t.kind === 'operating' && t.sample_size != null && t.sample_size < 25)
      ch.push({
        severity: 'medium',
        area: 'testing',
        finding: `${key} passed on a sample of ${t.sample_size}. Check the sample is enough for the control's frequency.`,
        ref: key,
      });
    if (t.status === 'passed' && t.exceptions > 0)
      ch.push({
        severity: 'high',
        area: 'testing',
        finding: `${key} is recorded as passed with ${t.exceptions} exceptions.`,
        ref: key,
      });
    if (!CONCLUDED.includes(t.status))
      ch.push({ severity: 'high', area: 'testing', finding: `${key} has no result yet.`, ref: key });
    else if (!t.reviewed_by)
      ch.push({ severity: 'high', area: 'testing', finding: `${key} is concluded but not reviewed.`, ref: key });
    if (t.status === 'failed' && !issues.some((i: any) => i.test_id === t.id))
      ch.push({
        severity: 'high',
        area: 'issues',
        finding: `${key} failed but no issue was raised for it, so nothing tracks the fix.`,
        ref: key,
      });
    if (samePerson(t.prepared_by, t.reviewed_by))
      ch.push({
        severity: 'high',
        area: 'testing',
        finding: `${key} was prepared and reviewed by the same person under different names.`,
        ref: key,
      });
  }
  return ch;
}

/** Standard checks on the issues: serious ones still open, open ones with no owner, ones closed suspiciously fast. */
function issueChallenges({ issues }: ReviewInputs): Challenge[] {
  const ch: Challenge[] = [];
  for (const i of issues) {
    const key = `I-${i.number}`;
    if (OPEN_ISSUE.includes(i.status) && ['critical', 'high'].includes(i.severity))
      ch.push({
        severity: 'high',
        area: 'issues',
        finding: `${key} (${i.severity}) is still open: ${i.title}.`,
        ref: key,
      });
    if (OPEN_ISSUE.includes(i.status) && !i.owner)
      ch.push({ severity: 'medium', area: 'issues', finding: `${key} has no owner.`, ref: key });
    if (
      i.status === 'closed' &&
      i.closed_at &&
      i.created_at &&
      new Date(i.closed_at).getTime() - new Date(i.created_at).getTime() < 864e5
    )
      ch.push({
        severity: 'low',
        area: 'issues',
        finding: `${key} was closed within a day of being raised. Check the fix and retest are real.`,
        ref: key,
      });
  }
  return ch;
}

/** Standard checks on the risks: residual scores against the appetite, acceptance, and high risks with no working control. */
function riskChallenges({ risks, appetite }: ReviewInputs): Challenge[] {
  const ch: Challenge[] = [];
  for (const r of risks) {
    const key = `R-${r.number}`;
    const inherent = r.likelihood * r.impact;
    if (!r.residual_likelihood || !r.residual_impact) {
      if (inherent > appetite && !r.accepted_by)
        ch.push({
          severity: 'high',
          area: 'risk',
          finding: `${key} has no residual score yet, and its inherent score of ${inherent} is above the appetite of ${appetite}. Score it after controls, then accept or treat it.`,
          ref: key,
        });
      else ch.push({ severity: 'low', area: 'risk', finding: `${key} has no residual score yet.`, ref: key });
    } else {
      const res = r.residual_likelihood * r.residual_impact;
      if (res > appetite && !r.accepted_by)
        ch.push({
          severity: 'high',
          area: 'risk',
          finding: `${key} has a residual score of ${res}, above the appetite of ${appetite}, and nobody has accepted it.`,
          ref: key,
        });
    }
    if (['critical', 'high'].includes(riskRating(r.likelihood * r.impact)) && !r.operating)
      ch.push({
        severity: 'high',
        area: 'controls',
        finding: `${key} is a high inherent risk with no control shown to operate.`,
        ref: key,
      });
  }
  return ch;
}

/** The model's brief: every control, test, issue and risk, the checks already found, and matching client documents. */
function reviewBrief(ctx: AgentContext, inputs: ReviewInputs, ch: Challenge[], policy: SourcePassage[]) {
  const { controls, tests, issues, risks, appetite } = inputs;
  return [
    `<use_case key="${ctx.card.key}" tier="${ctx.card.tier ?? 'unknown'}">${ctx.card.title}</use_case>`,
    `<risk_appetite max_residual="${appetite}" />`,
    '<controls>',
    ...controls.map((c: Ctl) => `- ${c.key} ${c.title}: ${c.status}`),
    '</controls>',
    '<tests>',
    ...tests.map(
      (t: any) =>
        `- T-${t.number} ${t.title}: ${t.status}, kind ${t.kind}, sample ${t.sample_size ?? 'not stated'}, exceptions ${t.exceptions}, evidence ${t.ev} (${t.ev_strong} not notes), prepared by ${t.prepared_by ?? '-'}, reviewed by ${t.reviewed_by ?? '-'}. Actual: ${t.actual || '-'}`,
    ),
    '</tests>',
    '<issues>',
    ...(issues.length
      ? issues.map((i: any) => `- I-${i.number} ${i.title}: ${i.severity}, ${i.status}, owner ${i.owner || '-'}`)
      : ['None.']),
    '</issues>',
    '<risks>',
    ...risks.map(
      (r: any) =>
        `- R-${r.number} ${r.title}: inherent ${r.likelihood * r.impact}, residual ${r.residual_likelihood ? r.residual_likelihood * r.residual_impact : 'not set'}, accepted by ${r.accepted_by ?? '-'}, operating controls ${r.operating}`,
    ),
    '</risks>',
    '<checks_already_found>',
    ...ch.map((c) => `- [${c.severity}] ${c.finding}`),
    '</checks_already_found>',
    ...(policy.length
      ? [
          '',
          "The client's own documents that bear on this use case. A challenge based on one gives its K-number as ref.",
          sourcesBlock(policy),
        ]
      : []),
  ].join('\n');
}

/**
 * Adds the model's challenges to the standard ones. A challenge may cite only a client passage it was
 * given (rule 25). The standard findings always stand, whatever the model says, and any high one
 * means not ready.
 */
function mergeModelReview(ch: Challenge[], model: ReviewChallenges, policy: SourcePassage[]): ReviewChallenges {
  const strayRefs = model.challenges
    .map((c) => c.ref)
    .filter((x) => /^K-\d+$/.test(x ?? '') && !policy.some((p) => p.id === x));
  if (strayRefs.length)
    throw new Error(`The review cites sources it wasn't given: ${[...new Set(strayRefs)].join(', ')}`);
  const merged = [
    ...ch,
    ...model.challenges.filter((m) => !ch.some((c) => c.ref && c.ref === m.ref && c.area === m.area)),
  ].slice(0, 30);
  return {
    challenges: merged,
    readiness: merged.some((c) => c.severity === 'high') ? 'not_ready' : model.readiness,
    summary: model.summary,
  };
}

/** Drafts the challenges for one use case before sign-off. */
export async function runReviewAssistant(
  ctx: AgentContext,
  q: Queryable,
  log: Log,
): Promise<AgentResult<ReviewChallenges>> {
  const inputs = await reviewInputs(ctx, q, log);
  const ch = [...testChallenges(inputs), ...issueChallenges(inputs), ...riskChallenges(inputs)];

  let output: ReviewChallenges;
  let usage = { tokensIn: 0, tokensOut: 0, tokensCached: 0 };
  const policy =
    ctx.provider.type === 'rules'
      ? []
      : await clientPassages(
          q,
          ctx.card.engagementId,
          `${ctx.card.title} ${ctx.card.useCase.description} policy requirements`,
        );
  if (policy.length)
    await log('step', `Read ${policy.length} matching client documents: ${policy.map((p) => p.id).join(', ')}`);
  if (ctx.provider.type === 'rules') {
    await log('step', 'Provider is the built-in rules: applying the standard review checks');
    output = {
      challenges: ch.slice(0, 30),
      readiness: ch.some((c) => c.severity === 'high') ? 'not_ready' : 'ready',
      summary: `${ch.length} challenges from the standard checks, ${ch.filter((c) => c.severity === 'high').length} high. Rule-based: judgement calls on evidence quality need a person or a model.`,
    };
  } else {
    const r = await ask(
      ctx,
      log,
      'independent_reviewer',
      'submit_challenges',
      REVIEW_SCHEMA,
      ReviewChallenges,
      reviewBrief(ctx, inputs, ch, policy),
      q,
      policy,
    );
    output = mergeModelReview(ch, r.output, policy);
    usage = { tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensCached: r.tokensCached };
  }
  await log(
    'output',
    `${output.challenges.length} challenges, ${output.challenges.filter((c) => c.severity === 'high').length} high: ${output.readiness === 'ready' ? 'ready for sign-off' : 'not ready'}`,
  );
  return { output: ReviewChallenges.parse(output), ...usage };
}
