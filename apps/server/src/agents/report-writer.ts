// The Report Writer (Board report stage): drafts the board summary for one use case from the
// figures ARGUS holds. Every number in the draft must come from that data or from a record it
// looked up (rule 25). A person edits and signs off the report (rule 1).
import { BoardSummary } from '@gh/shared';
import type { Queryable } from '../core/db.js';
import { S, ask, controlsOf, plural, str, strs, type Ctl } from './drafting.js';
import type { AgentContext, AgentResult, Log } from './types.js';

/** The answer the model fills in. */
const BOARD_SUMMARY_SCHEMA = S({
  headline: str,
  summary: str,
  keyFigures: { type: 'array', items: S({ label: str, value: str }) },
  recommendations: strs,
  decisionsNeeded: strs,
});

/** The numbers in `text` that aren't in `data`, ignoring record keys, standard names and years. */
export function unknownFigures(text: string, data: string, keys: string[]): string[] {
  const allowed = new Set((data.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  let t = text;
  for (const k of keys) t = t.split(k).join(' ');
  t = t
    .replace(/\b[A-Z]{1,6}-\d+\b/g, ' ')
    .replace(/\bLLM\d{2}\b/g, ' ')
    .replace(/\bISO\/IEC \d+\b/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ');
  return [...new Set((t.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !allowed.has(Number(n))))];
}

/** The figures the report is written from: risks, controls, tests, issues, evaluation results and the review. */
async function reportFacts(ctx: AgentContext, q: Queryable) {
  const c = ctx.card;
  const controls = await controlsOf(q, c.id);
  const ids = controls.map((x) => x.id);
  const { rows: risks } = await q.query(`SELECT * FROM risks WHERE card_id = $1 ORDER BY likelihood * impact DESC`, [
    c.id,
  ]);
  const { rows: t } = await q.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='passed')::int AS passed, count(*) FILTER (WHERE status='failed')::int AS failed FROM tests WHERE control_id = ANY($1)`,
    [ids],
  );
  const { rows: iss } = await q.query(
    `SELECT severity, status, title, number FROM issues WHERE card_id = $1 OR control_id = ANY($2)`,
    [c.id, ids],
  );
  const { rows: ev } = await q.query(
    `SELECT s.name, s.kind, s.threshold_pct, r.passed, r.total FROM eval_suites s JOIN inventory i ON i.id = s.inventory_id
     JOIN LATERAL (SELECT passed, total FROM eval_runs WHERE suite_id = s.id AND status = 'completed' ORDER BY ended_at DESC LIMIT 1) r ON true
     WHERE i.card_ids ? $1::text`,
    [c.id],
  );
  const open = iss.filter((i: any) => ['open', 'in_remediation', 'ready_for_retest'].includes(i.status));
  const facts = {
    useCase: c.title,
    key: c.key,
    tier: c.tier,
    owner: c.useCase.businessOwner,
    risks: risks.map((r: any) => ({
      key: `R-${r.number}`,
      title: r.title,
      inherent: r.likelihood * r.impact,
      residual: r.residual_likelihood ? r.residual_likelihood * r.residual_impact : null,
      acceptedBy: r.accepted_by,
    })),
    controls: {
      total: controls.length,
      operating: controls.filter((x) => x.status === 'operating').length,
      failed: controls.filter((x) => x.status === 'failed').length,
    },
    tests: t[0],
    issues: {
      open: open.length,
      openCriticalOrHigh: open.filter((i: any) => ['critical', 'high'].includes(i.severity)).length,
      closed: iss.filter((i: any) => i.status === 'closed').length,
      openList: open.map((i: any) => `I-${i.number} ${i.title} (${i.severity})`),
    },
    evaluations: ev.map((e: any) => ({
      suite: e.name,
      kind: e.kind,
      passed: e.passed,
      total: e.total,
      passPct: e.total ? Math.round((e.passed / e.total) * 100) : 0,
      thresholdPct: e.threshold_pct,
    })),
    reviewChallenges: c.drafts?.validate
      ? c.drafts.validate.challenges.filter((x) => x.severity === 'high').length
      : null,
  };
  return { facts, controls, issueCount: iss.length, suiteCount: ev.length };
}
type ReportFacts = Awaited<ReturnType<typeof reportFacts>>['facts'];

/** The offline rules: the standard summary filled in from the figures, naming each problem that stops reliance. */
function boardSummaryByRules(ctx: AgentContext, facts: ReportFacts): BoardSummary {
  const c = ctx.card;
  const belowBar = facts.evaluations.filter((e: any) => e.passPct < e.thresholdPct);
  const problems = [
    ...(facts.controls.failed ? [plural(facts.controls.failed, 'control failed', 'controls failed') + ' testing'] : []),
    ...(facts.tests.failed && !facts.controls.failed
      ? [plural(facts.tests.failed, 'test failed', 'tests failed')]
      : []),
    ...(facts.issues.openCriticalOrHigh
      ? [plural(facts.issues.openCriticalOrHigh, 'serious issue open', 'serious issues open')]
      : []),
    ...(belowBar.length
      ? [plural(belowBar.length, 'evaluation suite below threshold', 'evaluation suites below threshold')]
      : []),
  ];
  const evalLine = facts.evaluations
    .map((e: any) => `${e.suite}: ${e.passed} of ${e.total} passed against a ${e.thresholdPct}% threshold`)
    .join('; ');
  return BoardSummary.parse({
    headline: problems.length
      ? `${c.title}: not ready to rely on yet (${problems.join('; ')})`
      : `${c.title}: assurance complete with no failures or serious issues open`,
    summary: [
      `${c.title} is classified as ${c.tier ?? 'not yet classified'} risk${c.useCase.businessOwner ? `, owned by the ${c.useCase.businessOwner}` : ''}.`,
      `Of ${facts.controls.total} controls, ${facts.controls.operating} were shown to operate and ${facts.controls.failed} failed testing; ${facts.tests.passed} of ${facts.tests.total} tests passed.${evalLine ? ` Evaluations: ${evalLine}.` : ''}`,
      facts.issues.open
        ? `${facts.issues.open} issues remain open, ${facts.issues.openCriticalOrHigh} of them critical or high.`
        : 'No issues remain open.',
    ].join('\n\n'),
    keyFigures: [
      { label: 'Controls operating', value: `${facts.controls.operating} of ${facts.controls.total}` },
      { label: 'Tests passed', value: `${facts.tests.passed} of ${facts.tests.total}` },
      { label: 'Open issues', value: String(facts.issues.open) },
      ...facts.evaluations.map((e: any) => ({ label: e.suite.slice(0, 80), value: `${e.passPct}%` })),
    ].slice(0, 8),
    recommendations: [
      ...facts.issues.openList.map((x: string) => `Close ${x} and retest before relying on the system.`),
      ...(facts.controls.failed ? ['Fix the controls that failed testing and retest them.'] : []),
      ...belowBar.map((e: any) => `Bring ${e.suite} above its threshold before wider use.`),
    ].slice(0, 6),
    decisionsNeeded: problems.length
      ? ['Whether to keep the system live while these problems are open, or accept the residual risk formally.']
      : [],
  });
}

/** Rule 25: every figure in the draft comes from the data given or a record the writer looked up (`seen`). */
function checkFigures(
  o: BoardSummary,
  ctx: AgentContext,
  facts: ReportFacts,
  controls: Ctl[],
  data: string,
  seen: string[],
) {
  const text = [
    o.headline,
    o.summary,
    ...o.keyFigures.map((k) => `${k.label} ${k.value}`),
    ...o.recommendations,
    ...o.decisionsNeeded,
  ].join('\n');
  const keys = [ctx.card.key, ...facts.risks.map((r: any) => r.key), ...controls.map((x) => x.key)];
  const stray = unknownFigures(text, `${data}\n${seen.join('\n')}`, keys);
  if (stray.length) throw new Error(`The draft cites figures that aren't in the data: ${stray.join(', ')}`);
}

/** Drafts the board summary for one use case. */
export async function runReportWriter(ctx: AgentContext, q: Queryable, log: Log): Promise<AgentResult<BoardSummary>> {
  const seen: string[] = [];
  const { facts, controls, issueCount, suiteCount } = await reportFacts(ctx, q);
  const data = JSON.stringify(facts);
  await log(
    'step',
    `Gathered the figures for ${ctx.card.key}: ${facts.controls.total} controls, ${facts.tests.total} tests, ${issueCount} issues, ${suiteCount} evaluation suites`,
  );

  let result: AgentResult<BoardSummary>;
  if (ctx.provider.type === 'rules') {
    await log('step', 'Provider is the built-in rules: filling the standard summary from the figures');
    result = { output: boardSummaryByRules(ctx, facts), tokensIn: 0, tokensOut: 0, tokensCached: 0 };
  } else {
    result = await ask(
      ctx,
      log,
      'report_writer',
      'submit_board_summary',
      BOARD_SUMMARY_SCHEMA,
      BoardSummary,
      `<data>\n${data}\n</data>`,
      q,
      [],
      seen,
    );
  }
  checkFigures(result.output, ctx, facts, controls, data, seen);
  await log('step', 'Checked every figure in the draft against the data');
  await log('output', result.output.headline);
  return result;
}
