// The Control Tester (Test controls stage): drafts a result for each open test of a use case from
// the evidence attached to it. A draft is not a result: a person concludes every test (rule 1).
import { TestDrafts } from '@gh/shared';
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

/** The Control Tester's drafts with the passages they cite and each test's id. */
export interface TesterOutput extends TestDrafts {
  sourcePassages: SourcePassage[];
  byTest: Record<string, string>; // test key -> test id, for applying drafts
}

/** The answer the model fills in. */
const TEST_DRAFTS_SCHEMA = S({
  results: {
    type: 'array',
    items: S({
      testKey: str,
      proposed: { type: 'string', enum: ['pass', 'fail', 'cannot_assess'] },
      actual: str,
      exceptions: { type: 'integer', minimum: 0 },
      evidenceKeys: strs,
      reasoning: str,
      sources: strs,
    }),
  },
  summary: str,
});

/** A test's key, T-n. */
const testKey = (t: any) => `T-${t.number}`;

/** The evidence keys a draft may cite for a test: what's attached to the test or its control. */
const evidenceAllowedFor = (evidence: Ev[], t: any) =>
  new Set(evidence.filter((e) => e.testId === t.id || e.controlId === t.control_id).map((e) => e.key));

/** A stated exception: "3 of 25 ... without / missing / late ...". */
const STATED_EXCEPTION =
  /(\d+)\s+(?:of|out of)\s+(\d+)\b[^.\n]*?\b(without|missing|no|not|exceptions?|fail(?:ed|s)?|late|unsigned)\b/i;

/** The whole sentence around a position in the text, so a quote is never a fragment. */
function sentenceAt(text: string, at: number) {
  const start = Math.max(text.lastIndexOf('.', at) + 1, text.lastIndexOf('\n', at) + 1);
  const end = text.slice(at).search(/[.\n]/);
  return text
    .slice(start, end < 0 ? undefined : at + end + 1)
    .trim()
    .slice(0, 300);
}

/** What the agent works from: the use case's open tests, their evidence, and the testing guidance it may cite. */
async function testerInputs(ctx: AgentContext, q: Queryable, log: Log) {
  const controls = await controlsOf(q, ctx.card.id);
  const { rows: tests } = await q.query(
    `SELECT t.* FROM tests t WHERE t.control_id = ANY($1) AND t.status NOT IN ('passed','failed') ORDER BY t.number`,
    [controls.map((c) => c.id)],
  );
  if (!tests.length)
    throw new Error('There are no open tests for this use case. Add a test, or move on if every test is concluded.');
  const evidence = await evidenceOf(q, controls);
  await log('step', `Read ${tests.length} open tests and ${evidence.length} evidence items`);
  const passages = mergePassages(
    await pinned(q, ['M-SAMPLING', 'M-EXCEPTIONS', 'M-EVIDENCE']),
    await clientPassages(q, ctx.card.engagementId, `testing sample ${tests.map((t: any) => t.title).join(' ')}`),
  );
  return { controls, tests: tests as any[], evidence, passages };
}

/**
 * The offline rules: they flag a fail only where the evidence states exceptions in so many words,
 * and never propose a pass. Everything else is "can't assess" for a person or a model.
 */
function testDraftsByRules(tests: any[], evidence: Ev[], passages: SourcePassage[]): TestDrafts {
  const guide = (ref: string) => passages.filter((p) => p.ref === ref).map((p) => p.id);
  return {
    results: tests.map((t: any) => {
      const mine = evidence.filter((e) => e.testId === t.id || e.controlId === t.control_id);
      const hit = mine.map((e) => ({ e, m: STATED_EXCEPTION.exec(e.text) })).find((x) => x.m);
      if (hit) {
        return {
          testKey: testKey(t),
          proposed: 'fail' as const,
          actual: `${hit.e.key} states: "${sentenceAt(hit.e.text, hit.m!.index)}"`,
          exceptions: Number(hit.m![1]),
          evidenceKeys: [hit.e.key],
          reasoning: 'The evidence states exceptions in so many words. Confirm the count against the sample.',
          sources: guide('M-EXCEPTIONS'),
        };
      }
      return {
        testKey: testKey(t),
        proposed: 'cannot_assess' as const,
        actual: '',
        exceptions: 0,
        evidenceKeys: mine.map((e) => e.key).slice(0, 10),
        sources: mine.length && mine.every((e) => e.kind === 'note') ? guide('M-EVIDENCE') : [],
        reasoning: mine.length
          ? `Rules can't judge a pass. Read ${mine.map((e) => e.key).join(', ')} and conclude it yourself, or run this agent on a model.`
          : 'No evidence is attached to this test or its control.',
      };
    }),
    summary:
      'Rule-based dry run: only exceptions the evidence states outright are flagged; everything else needs a person or a model.',
  };
}

/** The model's brief: each open test with its procedure and the evidence it may cite, then the evidence and sources. */
function testerBrief(ctx: AgentContext, tests: any[], controls: Ctl[], evidence: Ev[], passages: SourcePassage[]) {
  return [
    `<use_case key="${ctx.card.key}">${ctx.card.title}</use_case>`,
    '<open_tests>',
    ...tests.map((t: any) => {
      const c = controls.find((x) => x.id === t.control_id)!;
      return [
        `<test key="${testKey(t)}" control="${c.key}" kind="${t.kind}">`,
        `Control: ${c.title}`,
        `Procedure: ${t.procedure || 'not stated'}`,
        `Population: ${t.population || 'not stated'}`,
        `Sample size: ${t.sample_size ?? 'not stated'}`,
        `Expected: ${t.expected || 'not stated'}`,
        `Evidence you may cite: ${[...evidenceAllowedFor(evidence, t)].join(', ') || 'none'}`,
        '</test>',
      ].join('\n');
    }),
    '</open_tests>',
    '<evidence_items>',
    ...(evidence.length ? evidence.map(wrapEvidence) : ['None attached.']),
    '</evidence_items>',
    sourcesBlock(passages),
  ].join('\n');
}

/**
 * Guardrails (rule 6): only this use case's open tests, only evidence attached to that test or its
 * control, never a pass with exceptions or without evidence, no test twice, only sources it was given.
 */
function checkTestDrafts(drafts: TestDrafts, tests: any[], evidence: Ev[], passages: SourcePassage[]) {
  const byKey = new Map(tests.map((t: any) => [testKey(t), t]));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const d of drafts.results) {
    const t = byKey.get(d.testKey);
    if (!t) problems.push(`${d.testKey} isn't an open test for this use case`);
    else {
      const ok = evidenceAllowedFor(evidence, t);
      const stray = d.evidenceKeys.filter((k) => !ok.has(k));
      if (stray.length) problems.push(`${d.testKey} cites evidence not attached to it: ${stray.join(', ')}`);
      if (d.proposed === 'pass' && d.exceptions > 0)
        problems.push(`${d.testKey} proposes a pass with ${d.exceptions} exceptions`);
      if (d.proposed === 'pass' && !d.evidenceKeys.length)
        problems.push(`${d.testKey} proposes a pass without citing evidence`);
    }
    if (seen.has(d.testKey)) problems.push(`${d.testKey} appears twice`);
    seen.add(d.testKey);
  }
  const strayK = strayCitations(
    drafts.results.flatMap((d) => d.sources),
    passages,
  );
  if (strayK.length) problems.push(`cites sources it wasn't given: ${strayK.join(', ')}`);
  if (problems.length) throw new Error(`The draft was rejected: ${problems.join('; ')}`);
}

/** Drafts a result for each open test of one use case. */
export async function runControlTester(ctx: AgentContext, q: Queryable, log: Log): Promise<AgentResult<TesterOutput>> {
  const { controls, tests, evidence, passages } = await testerInputs(ctx, q, log);
  let drafts: TestDrafts;
  let usage = { tokensIn: 0, tokensOut: 0, tokensCached: 0 };
  if (ctx.provider.type === 'rules') {
    await log('step', 'Provider is the built-in rules: they can spot stated exceptions but never propose a pass');
    drafts = testDraftsByRules(tests, evidence, passages);
  } else {
    const r = await ask(
      ctx,
      log,
      'control_tester',
      'submit_test_drafts',
      TEST_DRAFTS_SCHEMA,
      TestDrafts,
      testerBrief(ctx, tests, controls, evidence, passages),
      q,
      passages,
    );
    drafts = r.output;
    usage = { tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensCached: r.tokensCached };
  }
  checkTestDrafts(drafts, tests, evidence, passages);
  await log('step', 'Checked every test key and evidence citation; no pass with exceptions or without evidence');
  const n = (p: string) => drafts.results.filter((d) => d.proposed === p).length;
  await log(
    'output',
    `${drafts.results.length} drafts: ${n('pass')} pass, ${n('fail')} fail, ${n('cannot_assess')} can't assess`,
  );
  return {
    output: {
      ...drafts,
      sourcePassages: snapshot(
        passages,
        drafts.results.flatMap((d) => d.sources),
      ),
      byTest: Object.fromEntries(tests.map((t: any) => [testKey(t), t.id])),
    },
    ...usage,
  };
}
