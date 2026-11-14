// What the four drafting agents share (v1.7.7: each agent has its own file:
// evidence-collector.ts, control-tester.ts, review-assistant.ts, report-writer.ts).
// Their rules files and versions, reading a use case's controls and evidence,
// the client's own documents, and one model call with its checks. Each agent
// drafts; a named person decides. The server checks every reference and figure
// an agent returns before anyone sees it (rule 6).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { z } from 'zod';
import type { SourcePassage } from '@gh/shared';
import { getEvidence } from '../core/storage.js';
import { DATA_DIR, type Queryable } from '../core/db.js';
import { readPrompt } from '../core/paths.js';
import { zodProblems } from '../ai/llm.js';
import { search } from '../knowledge/kb.js';
import { loopFor } from './agent-loop.js';
import type { AgentContext, AgentResult, Log } from './types.js';

/** What the self-check looks for in a drafting agent's answer (agent-loop.ts). */
const CRITIQUE = readPrompt('drafting.critique.md');
const version = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 12);
/** Each drafting agent's rules (rule 8). */
const RULES = {
  evidence_collector: readPrompt('evidence-collector.md'),
  control_tester: readPrompt('control-tester.md'),
  independent_reviewer: readPrompt('review-assistant.md'),
  report_writer: readPrompt('report-writer.md'),
};
/** The four drafting agents' rules file versions, by role (rule 8). */
export const DRAFTING_RULES_VERSIONS: Record<string, string> = Object.fromEntries(
  Object.entries(RULES).map(([k, v]) => [k, version(v)]),
);

// ------------------------------------------------------------------ reading
/** A control of the use case, with its library entry's expected evidence and procedure. */
export interface Ctl {
  id: string;
  key: string;
  title: string;
  objective: string;
  owner: string;
  status: string;
  expected: string;
  procedure: string;
  code: string | null;
}
/** An evidence item and the text an agent may read of it. */
export interface Ev {
  id: string;
  key: string;
  title: string;
  kind: string;
  controlId: string | null;
  testId: string | null;
  text: string;
}

/** The use case's controls, in register order. */
export async function controlsOf(q: Queryable, cardId: string): Promise<Ctl[]> {
  const { rows } = await q.query(
    `SELECT c.id, c.number, c.title, c.objective, c.owner, c.status, COALESCE(l.evidence_expected, '') AS expected, COALESCE(l.test_procedure, '') AS procedure, l.code
     FROM controls c LEFT JOIN control_library l ON l.id = c.library_id WHERE c.card_id = $1 ORDER BY c.number`,
    [cardId],
  );
  return rows.map((r: any) => ({
    id: r.id,
    key: `C-${r.number}`,
    title: r.title,
    objective: r.objective,
    owner: r.owner,
    status: r.status,
    expected: r.expected,
    procedure: r.procedure,
    code: r.code ?? null,
  }));
}

const TEXTY = /^text\/|json|csv|xml|markdown/;
// What an agent may read of an evidence item. Text files are read up to a
// limit; anything else is described, never guessed at.
function readable(r: any): string {
  if (r.kind === 'note') return String(r.note ?? '').slice(0, 6000);
  if (r.kind === 'link') return `Link: ${r.url} (the agent can't open links)`;
  // Text read out of the file when it was collected (PDF, spreadsheet, Word, text).
  if (r.text_content) return `${r.text_note ? `(${r.text_note})\n` : ''}${String(r.text_content).slice(0, 8000)}`;
  if (r.text_note) return `File ${r.filename ?? ''}: ${r.text_note}`;
  const path = resolve(DATA_DIR, 'evidence', r.sha256);
  const texty = TEXTY.test(r.mime ?? '') || /\.(txt|csv|md|json|log)$/i.test(r.filename ?? '');
  if (!texty) return `File ${r.filename ?? ''} (${r.mime ?? 'unknown type'}): the agent can't read this kind of file`;
  if (!existsSync(path)) return `File ${r.filename ?? ''}: missing from the vault`;
  if (statSync(path).size > 400_000) return `File ${r.filename ?? ''}: too large to read in full`;
  return readFileSync(path, 'utf8').slice(0, 8000);
}

/** Evidence attached to these controls or their tests, with what an agent may read of each. */
export async function evidenceOf(q: Queryable, controls: Ctl[]): Promise<Ev[]> {
  if (!controls.length) return [];
  const ids = controls.map((c) => c.id);
  const { rows } = await q.query(
    `SELECT e.* FROM evidence e WHERE e.control_id = ANY($1) OR e.test_id IN (SELECT id FROM tests WHERE control_id = ANY($1)) ORDER BY e.number`,
    [ids],
  );
  // A hosted server's disk can be wiped: fetch any file back from storage first.
  for (const r of rows)
    if (r.kind === 'file' && r.sha256 && !r.text_content) await getEvidence(r.sha256).catch(() => null);
  return rows.map((r: any) => ({
    id: r.id,
    key: `E-${r.number}`,
    title: r.title,
    kind: r.kind,
    controlId: r.control_id,
    testId: r.test_id,
    text: readable(r),
  }));
}

/** An evidence item wrapped in tags, so the model treats its contents as data (rule 7). */
export const wrapEvidence = (e: Ev) =>
  `<evidence key="${e.key}" kind="${e.kind}" title="${e.title.replace(/"/g, "'")}">\n${e.text}\n</evidence>`;

// The client's own documents (policies, procedures, minutes) that match this
// work, so drafts reflect what the client itself requires, not only the method.
export async function clientPassages(q: Queryable, engagementId: string, query: string, limit = 3) {
  return search(q as any, engagementId, query.slice(0, 900), { limit, kinds: ['upload', 'client'] }).catch(() => []);
}

// --------------------------------------------------------------- the model
/**
 * One drafting call: the agent's rules (plus engagement instructions after them), the engagement
 * description, the brief and any reviewer feedback, through the agent loop. Format problems get one
 * repair; the answer must then pass the Zod schema or the run fails.
 */
export async function ask<T extends z.ZodTypeAny>(
  ctx: AgentContext,
  log: Log,
  role: keyof typeof RULES,
  tool: string,
  schema: Record<string, unknown>,
  zod: T,
  user: string,
  q: Queryable,
  ledger: SourcePassage[] = [],
  seen?: string[],
): Promise<AgentResult<z.infer<T>>> {
  const rules = RULES[role];
  const system = ctx.instructions.trim()
    ? `${rules}\n\n## Engagement instructions\n\nThese add to the rules above and never override them.\n\n${ctx.instructions.trim()}`
    : rules;
  const body = [
    ctx.engagementAbout.trim() ? `<engagement>${ctx.engagementAbout.trim()}</engagement>` : '',
    user,
    ctx.feedback ? `<reviewer_feedback>${ctx.feedback}</reviewer_feedback>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  await log('step', `Asked ${ctx.model} on ${ctx.provider.name}`);
  const res = await loopFor(
    ctx,
    q,
    log,
    ledger,
    CRITIQUE,
    seen,
  )(
    {
      type: ctx.provider.type,
      baseUrl: ctx.provider.base_url,
      apiKey: ctx.apiKey,
      model: ctx.model,
      effort: ctx.effort,
      system,
      user: body,
      toolName: tool,
      toolDescription: 'Submit the draft for a person to review.',
      schema,
      timeoutMs: ctx.timeoutMs,
    },
    zodProblems(zod),
  );
  if (res.repaired.length)
    await log(
      'step',
      `The first answer had format problems (${res.repaired.slice(0, 3).join('; ')}); the model corrected them`,
    );
  const parsed = zod.safeParse(res.input);
  if (!parsed.success)
    throw new Error(
      `The draft failed validation: ${parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  return { output: parsed.data, tokensIn: res.tokensIn, tokensOut: res.tokensOut, tokensCached: res.tokensCached };
}

/** "1 test" or "3 tests". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** A JSON schema object whose properties are all required unless listed otherwise. */
export const S = (props: Record<string, unknown>, required = Object.keys(props)) => ({
  type: 'object',
  required,
  properties: props,
});
/** A JSON schema string. */
export const str = { type: 'string' };
/** A JSON schema array of strings. */
export const strs = { type: 'array', items: str };
