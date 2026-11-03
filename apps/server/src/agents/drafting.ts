// The four drafting agents: Evidence Collector, Control Tester, Review
// assistant and Report Writer. Each reads what the harness already holds for
// one use case and drafts; a named person decides. The server checks every
// reference and figure they return before anyone sees it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { BoardSummary, EvidencePlan, ReviewChallenges, TestDrafts, riskRating, type SourcePassage } from '@gh/shared';
import { DATA_DIR, type Queryable } from '../db.js';
import { callStructured } from '../llm.js';
import { mergePassages, pinned, snapshot, sourcesBlock, strayCitations } from '../kb.js';
import type { AgentContext, AgentResult, Log } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => readFileSync(resolve(here, 'prompts', f), 'utf8');
const version = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 12);
const RULES = {
  evidence_collector: load('evidence-collector.md'),
  control_tester: load('control-tester.md'),
  independent_reviewer: load('review-assistant.md'),
  report_writer: load('report-writer.md'),
};
export const DRAFTING_RULES_VERSIONS: Record<string, string> = Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, version(v)]));

// ------------------------------------------------------------------ reading
interface Ctl { id: string; key: string; title: string; objective: string; owner: string; status: string; expected: string; procedure: string; code: string | null }
interface Ev { id: string; key: string; title: string; kind: string; controlId: string | null; testId: string | null; text: string }

async function controlsOf(q: Queryable, cardId: string): Promise<Ctl[]> {
  const { rows } = await q.query(
    `SELECT c.id, c.number, c.title, c.objective, c.owner, c.status, COALESCE(l.evidence_expected, '') AS expected, COALESCE(l.test_procedure, '') AS procedure, l.code
     FROM controls c LEFT JOIN control_library l ON l.id = c.library_id WHERE c.card_id = $1 ORDER BY c.number`,
    [cardId],
  );
  return rows.map((r: any) => ({ id: r.id, key: `C-${r.number}`, title: r.title, objective: r.objective, owner: r.owner, status: r.status, expected: r.expected, procedure: r.procedure, code: r.code ?? null }));
}

const TEXTY = /^text\/|json|csv|xml|markdown/;
// What an agent may read of an evidence item. Text files are read up to a
// limit; anything else is described, never guessed at.
function readable(r: any): string {
  if (r.kind === 'note') return String(r.note ?? '').slice(0, 6000);
  if (r.kind === 'link') return `Link: ${r.url} (the agent can't open links)`;
  const path = resolve(DATA_DIR, 'evidence', r.sha256);
  const texty = TEXTY.test(r.mime ?? '') || /\.(txt|csv|md|json|log)$/i.test(r.filename ?? '');
  if (!texty) return `File ${r.filename ?? ''} (${r.mime ?? 'unknown type'}): the agent can't read this kind of file`;
  if (!existsSync(path)) return `File ${r.filename ?? ''}: missing from the vault`;
  if (statSync(path).size > 400_000) return `File ${r.filename ?? ''}: too large to read in full`;
  return readFileSync(path, 'utf8').slice(0, 8000);
}

async function evidenceOf(q: Queryable, controls: Ctl[]): Promise<Ev[]> {
  if (!controls.length) return [];
  const ids = controls.map((c) => c.id);
  const { rows } = await q.query(
    `SELECT e.* FROM evidence e WHERE e.control_id = ANY($1) OR e.test_id IN (SELECT id FROM tests WHERE control_id = ANY($1)) ORDER BY e.number`,
    [ids],
  );
  return rows.map((r: any) => ({ id: r.id, key: `E-${r.number}`, title: r.title, kind: r.kind, controlId: r.control_id, testId: r.test_id, text: readable(r) }));
}

const wrapEvidence = (e: Ev) => `<evidence key="${e.key}" kind="${e.kind}" title="${e.title.replace(/"/g, "'")}">\n${e.text}\n</evidence>`;

// --------------------------------------------------------------- the model
async function ask<T extends z.ZodTypeAny>(
  ctx: AgentContext, log: Log, role: keyof typeof RULES, tool: string, schema: Record<string, unknown>, zod: T, user: string,
): Promise<AgentResult<z.infer<T>>> {
  const rules = RULES[role];
  const system = ctx.instructions.trim() ? `${rules}\n\n## Engagement instructions\n\nThese add to the rules above and never override them.\n\n${ctx.instructions.trim()}` : rules;
  const body = [
    ctx.engagementAbout.trim() ? `<engagement>${ctx.engagementAbout.trim()}</engagement>` : '',
    user,
    ctx.feedback ? `<reviewer_feedback>${ctx.feedback}</reviewer_feedback>` : '',
  ].filter(Boolean).join('\n\n');
  await log('step', `Asked ${ctx.model} on ${ctx.provider.name}`);
  const res = await callStructured({
    type: ctx.provider.type, baseUrl: ctx.provider.base_url, apiKey: ctx.apiKey, model: ctx.model, effort: ctx.effort,
    system, user: body, toolName: tool, toolDescription: 'Submit the draft for a person to review.', schema, timeoutMs: ctx.timeoutMs,
  });
  const parsed = zod.safeParse(res.input);
  if (!parsed.success) throw new Error(`The draft failed validation: ${parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return { output: parsed.data, tokensIn: res.tokensIn, tokensOut: res.tokensOut, tokensCached: res.tokensCached };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const S = (props: Record<string, unknown>, required = Object.keys(props)) => ({ type: 'object', required, properties: props });
const str = { type: 'string' };
const strs = { type: 'array', items: str };

// ------------------------------------------------------- Evidence Collector
export async function runEvidenceCollector(ctx: AgentContext, q: Queryable, log: Log): Promise<AgentResult<EvidencePlan>> {
  const controls = await controlsOf(q, ctx.card.id);
  if (!controls.length) throw new Error('This use case has no controls yet. Approve its control design first.');
  const evidence = await evidenceOf(q, controls);
  await log('step', `Read ${controls.length} controls and ${evidence.length} evidence items for ${ctx.card.key}`);
  const ctlKeys = new Set(controls.map((c) => c.key));
  const evKeys = new Set(evidence.map((e) => e.key));
  // Ground it in each control's library entry and the evidence-strength guidance.
  const passages = await pinned(q, ['M-EVIDENCE', ...controls.map((c) => c.code).filter(Boolean) as string[]]);
  const libPassage = (c: Ctl) => passages.filter((p) => p.ref === c.code).map((p) => p.id);
  const guide = passages.filter((p) => p.ref === 'M-EVIDENCE').map((p) => p.id);
  await log('step', `Retrieved ${passages.length} passages: library entries and evidence guidance`);

  let result: AgentResult<EvidencePlan>;
  if (ctx.provider.type === 'rules') {
    await log('step', 'Provider is the built-in rules: listing each control\'s expected evidence and matching uploads by control');
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
        note: strong.length ? 'Matched by control. Check it covers the whole test period.' : mine.length ? 'Only walkthrough notes so far; ask for a system export or sample.' : 'Nothing uploaded yet.',
        sources: [...libPassage(c), ...(mine.length && !strong.length ? guide : [])],
      };
    });
    const missing = requests.filter((r) => r.status !== 'received').length;
    result = { output: EvidencePlan.parse({ requests, summary: `${requests.length} requests across ${controls.length} controls; ${missing} still missing or partial. Rule-based dry run: matches are by control, not by reading contents.` }), tokensIn: 0, tokensOut: 0, tokensCached: 0 };
  } else {
    const user = [
      `<use_case key="${ctx.card.key}" tier="${ctx.card.tier ?? 'unknown'}">${ctx.card.title}</use_case>`,
      '<controls>', ...controls.map((c) => `- ${c.key} ${c.title} (owner: ${c.owner || 'not set'}). Objective: ${c.objective}. Evidence usually expected: ${c.expected || 'not stated'}`), '</controls>',
      '<uploaded_evidence>', ...(evidence.length ? evidence.map((e) => `${wrapEvidence(e)}\n(attached to ${controls.find((c) => c.id === e.controlId)?.key ?? 'a test'})`) : ['None yet.']), '</uploaded_evidence>',
      sourcesBlock(passages),
    ].join('\n');
    result = await ask(ctx, log, 'evidence_collector', 'submit_evidence_plan', S({
      requests: { type: 'array', items: S({ controlKey: str, item: str, why: str, askFrom: str, status: { type: 'string', enum: ['received', 'partial', 'missing'] }, evidenceKeys: strs, note: str, sources: strs }) },
      summary: str,
    }), EvidencePlan, user);
  }
  const bad = result.output.requests.flatMap((r) => [...(ctlKeys.has(r.controlKey) ? [] : [r.controlKey]), ...r.evidenceKeys.filter((k) => !evKeys.has(k))]);
  const strayK = strayCitations(result.output.requests.flatMap((r) => r.sources), passages);
  if (bad.length || strayK.length) throw new Error(`The draft cites keys that aren't part of this use case: ${[...new Set([...bad, ...strayK])].join(', ')}`);
  result.output.sourcePassages = snapshot(passages, result.output.requests.flatMap((r) => r.sources));
  await log('step', 'Checked every control, evidence and source key against the register');
  await log('output', `${result.output.requests.length} evidence requests, ${result.output.requests.filter((r) => r.status === 'missing').length} missing`);
  return result;
}

// ----------------------------------------------------------- Control Tester
export interface TesterOutput extends TestDrafts {
  sourcePassages: SourcePassage[];
  byTest: Record<string, string>; // test key -> test id, for applying drafts
}

export async function runControlTester(ctx: AgentContext, q: Queryable, log: Log): Promise<AgentResult<TesterOutput>> {
  const controls = await controlsOf(q, ctx.card.id);
  const { rows: tests } = await q.query(
    `SELECT t.* FROM tests t WHERE t.control_id = ANY($1) AND t.status NOT IN ('passed','failed') ORDER BY t.number`,
    [controls.map((c) => c.id)],
  );
  if (!tests.length) throw new Error('There are no open tests for this use case. Add a test, or move on if every test is concluded.');
  const evidence = await evidenceOf(q, controls);
  await log('step', `Read ${tests.length} open tests and ${evidence.length} evidence items`);
  const keyOf = (t: any) => `T-${t.number}`;
  const passages = await pinned(q, ['M-SAMPLING', 'M-EXCEPTIONS', 'M-EVIDENCE']);
  const guide = (ref: string) => passages.filter((p) => p.ref === ref).map((p) => p.id);
  const allowed = (t: any) => new Set(evidence.filter((e) => e.testId === t.id || e.controlId === t.control_id).map((e) => e.key));

  let drafts: TestDrafts;
  let usage = { tokensIn: 0, tokensOut: 0, tokensCached: 0 };
  if (ctx.provider.type === 'rules') {
    await log('step', 'Provider is the built-in rules: they can spot stated exceptions but never propose a pass');
    const EXC = /(\d+)\s+(?:of|out of)\s+(\d+)\b[^.\n]*?\b(without|missing|no|not|exceptions?|fail(?:ed|s)?|late|unsigned)\b/i;
    // Quote the whole sentence the exception appears in, not a fragment.
    const sentence = (text: string, at: number) => {
      const start = Math.max(text.lastIndexOf('.', at) + 1, text.lastIndexOf('\n', at) + 1);
      const end = text.slice(at).search(/[.\n]/);
      return text.slice(start, end < 0 ? undefined : at + end + 1).trim().slice(0, 300);
    };
    drafts = {
      results: tests.map((t: any) => {
        const mine = evidence.filter((e) => e.testId === t.id || e.controlId === t.control_id);
        const hit = mine.map((e) => ({ e, m: EXC.exec(e.text) })).find((x) => x.m);
        if (hit) {
          return {
            testKey: keyOf(t), proposed: 'fail' as const, actual: `${hit.e.key} states: "${sentence(hit.e.text, hit.m!.index)}"`, exceptions: Number(hit.m![1]),
            evidenceKeys: [hit.e.key], reasoning: 'The evidence states exceptions in so many words. Confirm the count against the sample.', sources: guide('M-EXCEPTIONS'),
          };
        }
        return {
          testKey: keyOf(t), proposed: 'cannot_assess' as const, actual: '', exceptions: 0, evidenceKeys: mine.map((e) => e.key).slice(0, 10),
          sources: mine.length && mine.every((e) => e.kind === 'note') ? guide('M-EVIDENCE') : [],
          reasoning: mine.length ? `Rules can't judge a pass. Read ${mine.map((e) => e.key).join(', ')} and conclude it yourself, or run this agent on a model.` : 'No evidence is attached to this test or its control.',
        };
      }),
      summary: 'Rule-based dry run: only exceptions the evidence states outright are flagged; everything else needs a person or a model.',
    };
  } else {
    const user = [
      `<use_case key="${ctx.card.key}">${ctx.card.title}</use_case>`,
      '<open_tests>',
      ...tests.map((t: any) => {
        const c = controls.find((x) => x.id === t.control_id)!;
        return [`<test key="${keyOf(t)}" control="${c.key}" kind="${t.kind}">`, `Control: ${c.title}`, `Procedure: ${t.procedure || 'not stated'}`, `Population: ${t.population || 'not stated'}`,
          `Sample size: ${t.sample_size ?? 'not stated'}`, `Expected: ${t.expected || 'not stated'}`, `Evidence you may cite: ${[...allowed(t)].join(', ') || 'none'}`, '</test>'].join('\n');
      }),
      '</open_tests>',
      '<evidence_items>', ...(evidence.length ? evidence.map(wrapEvidence) : ['None attached.']), '</evidence_items>',
      sourcesBlock(passages),
    ].join('\n');
    const r = await ask(ctx, log, 'control_tester', 'submit_test_drafts', S({
      results: { type: 'array', items: S({ testKey: str, proposed: { type: 'string', enum: ['pass', 'fail', 'cannot_assess'] }, actual: str, exceptions: { type: 'integer', minimum: 0 }, evidenceKeys: strs, reasoning: str, sources: strs }) },
      summary: str,
    }), TestDrafts, user);
    drafts = r.output;
    usage = { tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensCached: r.tokensCached };
  }

  // Guardrails: only this use case's open tests, only evidence attached to that
  // test or its control, never a pass with exceptions or without evidence.
  const byKey = new Map(tests.map((t: any) => [keyOf(t), t]));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const d of drafts.results) {
    const t = byKey.get(d.testKey);
    if (!t) problems.push(`${d.testKey} isn't an open test for this use case`);
    else {
      const ok = allowed(t);
      const stray = d.evidenceKeys.filter((k) => !ok.has(k));
      if (stray.length) problems.push(`${d.testKey} cites evidence not attached to it: ${stray.join(', ')}`);
      if (d.proposed === 'pass' && d.exceptions > 0) problems.push(`${d.testKey} proposes a pass with ${d.exceptions} exceptions`);
      if (d.proposed === 'pass' && !d.evidenceKeys.length) problems.push(`${d.testKey} proposes a pass without citing evidence`);
    }
    if (seen.has(d.testKey)) problems.push(`${d.testKey} appears twice`);
    seen.add(d.testKey);
  }
  const strayK = strayCitations(drafts.results.flatMap((d) => d.sources), passages);
  if (strayK.length) problems.push(`cites sources it wasn't given: ${strayK.join(', ')}`);
  if (problems.length) throw new Error(`The draft was rejected: ${problems.join('; ')}`);
  await log('step', 'Checked every test key and evidence citation; no pass with exceptions or without evidence');
  const n = (p: string) => drafts.results.filter((d) => d.proposed === p).length;
  await log('output', `${drafts.results.length} drafts: ${n('pass')} pass, ${n('fail')} fail, ${n('cannot_assess')} can't assess`);
  return { output: { ...drafts, sourcePassages: snapshot(passages, drafts.results.flatMap((d) => d.sources)), byTest: Object.fromEntries(tests.map((t: any) => [keyOf(t), t.id])) }, ...usage };
}

// --------------------------------------------------------- Review assistant
export async function runReviewAssistant(ctx: AgentContext, q: Queryable, log: Log): Promise<AgentResult<ReviewChallenges>> {
  const controls = await controlsOf(q, ctx.card.id);
  const ids = controls.map((c) => c.id);
  const { rows: tests } = await q.query(
    `SELECT t.*, (SELECT count(*)::int FROM evidence e WHERE e.test_id = t.id OR e.control_id = t.control_id) AS ev,
       (SELECT count(*)::int FROM evidence e WHERE (e.test_id = t.id OR e.control_id = t.control_id) AND e.kind <> 'note') AS ev_strong
     FROM tests t WHERE t.control_id = ANY($1) ORDER BY t.number`, [ids]);
  const { rows: issues } = await q.query(`SELECT * FROM issues WHERE card_id = $1 OR control_id = ANY($2) ORDER BY number`, [ctx.card.id, ids]);
  const { rows: risks } = await q.query(`SELECT r.*, (SELECT count(*)::int FROM control_risks cr JOIN controls c ON c.id = cr.control_id WHERE cr.risk_id = r.id AND c.status = 'operating') AS operating FROM risks r WHERE r.card_id = $1 ORDER BY r.number`, [ctx.card.id]);
  const { rows: eng } = await q.query(`SELECT appetite FROM engagements WHERE id = $1`, [ctx.card.engagementId]);
  const { rows: people } = await q.query(`SELECT name, former_names FROM users`);
  const appetite = eng[0]?.appetite?.maxResidual ?? 8;
  const samePerson = (a: string | null, b: string | null) => !!a && !!b && people.some((p: any) => { const names = [p.name, ...(p.former_names ?? [])]; return names.includes(a) && names.includes(b); });
  await log('step', `Read ${controls.length} controls, ${tests.length} tests, ${issues.length} issues and ${risks.length} risks`);

  // The rule checks run on every provider: they're facts, not judgement.
  const ch: ReviewChallenges['challenges'] = [];
  for (const t of tests) {
    const key = `T-${t.number}`;
    if (['passed', 'failed'].includes(t.status) && !t.ev) ch.push({ severity: 'high', area: 'testing', finding: `${key} was concluded ${t.status} with no evidence on it or its control. Attach the workpaper or retest.`, ref: key });
    else if (t.status === 'passed' && !t.ev_strong) ch.push({ severity: 'medium', area: 'evidence', finding: `${key} passed on walkthrough notes only. Ask for a system export or sample.`, ref: key });
    if (t.status === 'passed' && t.kind === 'operating' && t.sample_size != null && t.sample_size < 25) ch.push({ severity: 'medium', area: 'testing', finding: `${key} passed on a sample of ${t.sample_size}. Check the sample is enough for the control's frequency.`, ref: key });
    if (t.status === 'passed' && t.exceptions > 0) ch.push({ severity: 'high', area: 'testing', finding: `${key} is recorded as passed with ${t.exceptions} exceptions.`, ref: key });
    if (!['passed', 'failed'].includes(t.status)) ch.push({ severity: 'high', area: 'testing', finding: `${key} has no result yet.`, ref: key });
    else if (!t.reviewed_by) ch.push({ severity: 'high', area: 'testing', finding: `${key} is concluded but not reviewed.`, ref: key });
    if (t.status === 'failed' && !issues.some((i: any) => i.test_id === t.id)) ch.push({ severity: 'high', area: 'issues', finding: `${key} failed but no issue was raised for it, so nothing tracks the fix.`, ref: key });
    if (samePerson(t.prepared_by, t.reviewed_by)) ch.push({ severity: 'high', area: 'testing', finding: `${key} was prepared and reviewed by the same person under different names.`, ref: key });
  }
  for (const i of issues) {
    const key = `I-${i.number}`;
    if (['open', 'in_remediation', 'ready_for_retest'].includes(i.status) && ['critical', 'high'].includes(i.severity)) ch.push({ severity: 'high', area: 'issues', finding: `${key} (${i.severity}) is still open: ${i.title}.`, ref: key });
    if (['open', 'in_remediation', 'ready_for_retest'].includes(i.status) && !i.owner) ch.push({ severity: 'medium', area: 'issues', finding: `${key} has no owner.`, ref: key });
    if (i.status === 'closed' && i.closed_at && i.created_at && new Date(i.closed_at).getTime() - new Date(i.created_at).getTime() < 864e5) ch.push({ severity: 'low', area: 'issues', finding: `${key} was closed within a day of being raised. Check the fix and retest are real.`, ref: key });
  }
  for (const r of risks) {
    const key = `R-${r.number}`;
    const inherent = r.likelihood * r.impact;
    if (!r.residual_likelihood || !r.residual_impact) {
      if (inherent > appetite && !r.accepted_by) ch.push({ severity: 'high', area: 'risk', finding: `${key} has no residual score yet, and its inherent score of ${inherent} is above the appetite of ${appetite}. Score it after controls, then accept or treat it.`, ref: key });
      else ch.push({ severity: 'low', area: 'risk', finding: `${key} has no residual score yet.`, ref: key });
    } else {
      const res = r.residual_likelihood * r.residual_impact;
      if (res > appetite && !r.accepted_by) ch.push({ severity: 'high', area: 'risk', finding: `${key} has a residual score of ${res}, above the appetite of ${appetite}, and nobody has accepted it.`, ref: key });
    }
    if (['critical', 'high'].includes(riskRating(r.likelihood * r.impact)) && !r.operating) ch.push({ severity: 'high', area: 'controls', finding: `${key} is a high inherent risk with no control shown to operate.`, ref: key });
  }

  let output: ReviewChallenges;
  let usage = { tokensIn: 0, tokensOut: 0, tokensCached: 0 };
  if (ctx.provider.type === 'rules') {
    await log('step', 'Provider is the built-in rules: applying the standard review checks');
    output = { challenges: ch.slice(0, 30), readiness: ch.some((c) => c.severity === 'high') ? 'not_ready' : 'ready', summary: `${ch.length} challenges from the standard checks, ${ch.filter((c) => c.severity === 'high').length} high. Rule-based: judgement calls on evidence quality need a person or a model.` };
  } else {
    const user = [
      `<use_case key="${ctx.card.key}" tier="${ctx.card.tier ?? 'unknown'}">${ctx.card.title}</use_case>`,
      `<risk_appetite max_residual="${appetite}" />`,
      '<controls>', ...controls.map((c) => `- ${c.key} ${c.title}: ${c.status}`), '</controls>',
      '<tests>', ...tests.map((t: any) => `- T-${t.number} ${t.title}: ${t.status}, kind ${t.kind}, sample ${t.sample_size ?? 'not stated'}, exceptions ${t.exceptions}, evidence ${t.ev} (${t.ev_strong} not notes), prepared by ${t.prepared_by ?? '-'}, reviewed by ${t.reviewed_by ?? '-'}. Actual: ${t.actual || '-'}`), '</tests>',
      '<issues>', ...(issues.length ? issues.map((i: any) => `- I-${i.number} ${i.title}: ${i.severity}, ${i.status}, owner ${i.owner || '-'}`) : ['None.']), '</issues>',
      '<risks>', ...risks.map((r: any) => `- R-${r.number} ${r.title}: inherent ${r.likelihood * r.impact}, residual ${r.residual_likelihood ? r.residual_likelihood * r.residual_impact : 'not set'}, accepted by ${r.accepted_by ?? '-'}, operating controls ${r.operating}`), '</risks>',
      '<checks_already_found>', ...ch.map((c) => `- [${c.severity}] ${c.finding}`), '</checks_already_found>',
    ].join('\n');
    const r = await ask(ctx, log, 'independent_reviewer', 'submit_challenges', S({
      challenges: { type: 'array', items: S({ severity: { type: 'string', enum: ['high', 'medium', 'low'] }, area: { type: 'string', enum: ['evidence', 'testing', 'issues', 'risk', 'controls', 'other'] }, finding: str, ref: str }) },
      readiness: { type: 'string', enum: ['ready', 'not_ready'] },
      summary: str,
    }), ReviewChallenges, user);
    // The rule findings always stand, whatever the model says.
    const merged = [...ch, ...r.output.challenges.filter((m) => !ch.some((c) => c.ref && c.ref === m.ref && c.area === m.area))].slice(0, 30);
    output = { challenges: merged, readiness: merged.some((c) => c.severity === 'high') ? 'not_ready' : r.output.readiness, summary: r.output.summary };
    usage = { tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensCached: r.tokensCached };
  }
  await log('output', `${output.challenges.length} challenges, ${output.challenges.filter((c) => c.severity === 'high').length} high: ${output.readiness === 'ready' ? 'ready for sign-off' : 'not ready'}`);
  return { output: ReviewChallenges.parse(output), ...usage };
}

// ------------------------------------------------------------ Report Writer
// Every number in the draft must appear in the data the writer was given.
export function unknownFigures(text: string, data: string, keys: string[]): string[] {
  const allowed = new Set((data.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  let t = text;
  for (const k of keys) t = t.split(k).join(' ');
  t = t.replace(/\b[A-Z]{1,6}-\d+\b/g, ' ').replace(/\bLLM\d{2}\b/g, ' ').replace(/\bISO\/IEC \d+\b/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');
  return [...new Set((t.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !allowed.has(Number(n))))];
}

export async function runReportWriter(ctx: AgentContext, q: Queryable, log: Log): Promise<AgentResult<BoardSummary>> {
  const c = ctx.card;
  const controls = await controlsOf(q, c.id);
  const ids = controls.map((x) => x.id);
  const { rows: risks } = await q.query(`SELECT * FROM risks WHERE card_id = $1 ORDER BY likelihood * impact DESC`, [c.id]);
  const { rows: t } = await q.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='passed')::int AS passed, count(*) FILTER (WHERE status='failed')::int AS failed FROM tests WHERE control_id = ANY($1)`, [ids]);
  const { rows: iss } = await q.query(`SELECT severity, status, title, number FROM issues WHERE card_id = $1 OR control_id = ANY($2)`, [c.id, ids]);
  const { rows: ev } = await q.query(
    `SELECT s.name, s.kind, s.threshold_pct, r.passed, r.total FROM eval_suites s JOIN inventory i ON i.id = s.inventory_id
     JOIN LATERAL (SELECT passed, total FROM eval_runs WHERE suite_id = s.id AND status = 'completed' ORDER BY ended_at DESC LIMIT 1) r ON true
     WHERE i.card_ids ? $1::text`, [c.id]);
  const open = iss.filter((i: any) => ['open', 'in_remediation', 'ready_for_retest'].includes(i.status));
  const facts = {
    useCase: c.title, key: c.key, tier: c.tier, owner: c.useCase.businessOwner,
    risks: risks.map((r: any) => ({ key: `R-${r.number}`, title: r.title, inherent: r.likelihood * r.impact, residual: r.residual_likelihood ? r.residual_likelihood * r.residual_impact : null, acceptedBy: r.accepted_by })),
    controls: { total: controls.length, operating: controls.filter((x) => x.status === 'operating').length, failed: controls.filter((x) => x.status === 'failed').length },
    tests: t[0],
    issues: { open: open.length, openCriticalOrHigh: open.filter((i: any) => ['critical', 'high'].includes(i.severity)).length, closed: iss.filter((i: any) => i.status === 'closed').length, openList: open.map((i: any) => `I-${i.number} ${i.title} (${i.severity})`) },
    evaluations: ev.map((e: any) => ({ suite: e.name, kind: e.kind, passed: e.passed, total: e.total, passPct: e.total ? Math.round((e.passed / e.total) * 100) : 0, thresholdPct: e.threshold_pct })),
    reviewChallenges: c.drafts?.validate ? c.drafts.validate.challenges.filter((x) => x.severity === 'high').length : null,
  };
  const data = JSON.stringify(facts);
  await log('step', `Gathered the figures for ${c.key}: ${facts.controls.total} controls, ${facts.tests.total} tests, ${iss.length} issues, ${ev.length} evaluation suites`);

  let result: AgentResult<BoardSummary>;
  if (ctx.provider.type === 'rules') {
    await log('step', 'Provider is the built-in rules: filling the standard summary from the figures');
    const belowBar = facts.evaluations.filter((e) => e.passPct < e.thresholdPct);
    const problems = [
      ...(facts.controls.failed ? [plural(facts.controls.failed, 'control failed', 'controls failed') + ' testing'] : []),
      ...(facts.tests.failed && !facts.controls.failed ? [plural(facts.tests.failed, 'test failed', 'tests failed')] : []),
      ...(facts.issues.openCriticalOrHigh ? [plural(facts.issues.openCriticalOrHigh, 'serious issue open', 'serious issues open')] : []),
      ...(belowBar.length ? [plural(belowBar.length, 'evaluation suite below threshold', 'evaluation suites below threshold')] : []),
    ];
    const evalLine = facts.evaluations.map((e) => `${e.suite}: ${e.passed} of ${e.total} passed against a ${e.thresholdPct}% threshold`).join('; ');
    result = {
      output: BoardSummary.parse({
        headline: problems.length ? `${c.title}: not ready to rely on yet (${problems.join('; ')})` : `${c.title}: assurance complete with no failures or serious issues open`,
        summary: [
          `${c.title} is classified as ${c.tier ?? 'not yet classified'} risk${c.useCase.businessOwner ? `, owned by the ${c.useCase.businessOwner}` : ''}.`,
          `Of ${facts.controls.total} controls, ${facts.controls.operating} were shown to operate and ${facts.controls.failed} failed testing; ${facts.tests.passed} of ${facts.tests.total} tests passed.${evalLine ? ` Evaluations: ${evalLine}.` : ''}`,
          facts.issues.open ? `${facts.issues.open} issues remain open, ${facts.issues.openCriticalOrHigh} of them critical or high.` : 'No issues remain open.',
        ].join('\n\n'),
        keyFigures: [
          { label: 'Controls operating', value: `${facts.controls.operating} of ${facts.controls.total}` },
          { label: 'Tests passed', value: `${facts.tests.passed} of ${facts.tests.total}` },
          { label: 'Open issues', value: String(facts.issues.open) },
          ...facts.evaluations.map((e) => ({ label: e.suite.slice(0, 80), value: `${e.passPct}%` })),
        ].slice(0, 8),
        recommendations: [
          ...facts.issues.openList.map((x) => `Close ${x} and retest before relying on the system.`),
          ...(facts.controls.failed ? ['Fix the controls that failed testing and retest them.'] : []),
          ...belowBar.map((e) => `Bring ${e.suite} above its threshold before wider use.`),
        ].slice(0, 6),
        decisionsNeeded: problems.length ? ['Whether to keep the system live while these problems are open, or accept the residual risk formally.'] : [],
      }),
      tokensIn: 0, tokensOut: 0, tokensCached: 0,
    };
  } else {
    result = await ask(ctx, log, 'report_writer', 'submit_board_summary', S({
      headline: str, summary: str,
      keyFigures: { type: 'array', items: S({ label: str, value: str }) },
      recommendations: strs, decisionsNeeded: strs,
    }), BoardSummary, `<data>\n${data}\n</data>`);
  }
  const o = result.output;
  const text = [o.headline, o.summary, ...o.keyFigures.map((k) => `${k.label} ${k.value}`), ...o.recommendations, ...o.decisionsNeeded].join('\n');
  const keys = [c.key, ...facts.risks.map((r) => r.key), ...controls.map((x) => x.key)];
  const stray = unknownFigures(text, data, keys);
  if (stray.length) throw new Error(`The draft cites figures that aren't in the data: ${stray.join(', ')}`);
  await log('step', 'Checked every figure in the draft against the data');
  await log('output', o.headline);
  return result;
}
