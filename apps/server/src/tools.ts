// Read-only tools the agents use to look things up (v1.6). Every tool reads;
// none writes. Results are capped and wrapped as data. Scope: the agent's own
// engagement, plus open (not members-only) and unarchived engagements for the
// cross-engagement look-ups, so members-only work never leaks out (rule 16).
// Passages a tool returns go into the run's retrieval ledger: an agent may
// cite only what it was given or looked up (rule 25).
import type { AgentRole, SourcePassage } from '@gh/shared';
import type { Queryable } from './db.js';
import { mergePassages, search } from './kb.js';
import type { ToolSpec } from './llm.js';

export interface ToolScope {
  q: Queryable;
  engagementId: string;
  cardId: string | null;
  role: AgentRole | 'assistant';
  ledger: SourcePassage[];
  /** Questions this run may still ask a person (0 when asking is off). */
  questionsLeft: number;
  /** Every tool result in this run, so the Report Writer's figures can be checked against what it read. */
  seen?: string[];
}
export interface ToolOutcome { text: string; summary: string; question?: { question: string; to: string; why: string } }
interface Tool extends ToolSpec { roles: (AgentRole | 'assistant')[] | 'all'; run: (args: any, s: ToolScope) => Promise<ToolOutcome> }

const MAX_CHARS = 4000;
const cap = (s: string) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n(truncated: narrow the request or ask for the next part)` : s);
const S = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required });
const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const list = (rows: string[], none: string) => (rows.length ? rows.join('\n') : none);
const keyNum = (k: unknown, prefix: string) => {
  const m = String(k ?? '').trim().toUpperCase().match(new RegExp(`^${prefix}-(\\d+)$`));
  return m ? Number(m[1]) : null;
};

/** Engagements an agent may look across: its own, and open, unarchived ones. */
async function shareable(s: ToolScope): Promise<string[]> {
  const { rows } = await s.q.query(`SELECT id FROM engagements WHERE id = $1 OR (access <> 'members' AND archived_at IS NULL)`, [s.engagementId]);
  return rows.map((r: any) => r.id);
}
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)));
const STOP = new Set('with that this from they them their have which will would about into used uses when what where there these those other than then also only such some more most very each every person people data model system tool customer customers'.split(' '));

const TOOLS: Tool[] = [
  {
    name: 'search_knowledge', roles: 'all',
    description: 'Search the knowledge base: framework summaries (EU AI Act, ISO/IEC 42001, NIST AI RMF, OWASP LLM Top 10, data protection law), the control library, method guidance, and the client\'s own documents. Write the query in the standards\' own terms. Returns passages with K-numbers you may cite.',
    schema: S({ query: str('What to look for'), kinds: { type: 'array', items: { type: 'string', enum: ['framework', 'control', 'methodology', 'upload', 'client', 'evidence'] }, description: 'Optional: limit to these kinds' }, limit: int('How many passages, 1 to 8') }, ['query']),
    async run(a, s) {
      const kinds = Array.isArray(a.kinds) && a.kinds.length ? a.kinds : undefined;
      const got = await search(s.q as any, s.engagementId, String(a.query ?? '').slice(0, 400), { limit: Math.min(Math.max(Number(a.limit) || 6, 1), 8), kinds });
      s.ledger.splice(0, s.ledger.length, ...mergePassages(s.ledger, got));
      return {
        summary: `Searched the knowledge base for "${String(a.query).slice(0, 80)}" (${got.length} passage${got.length === 1 ? '' : 's'}${got.length ? `: ${got.map((p) => p.id).join(', ')}` : ''})`,
        text: got.length ? got.map((p) => `<source id="${p.id}" kind="${p.kind}" ref="${p.ref}" title="${p.title.replace(/"/g, "'")}">\n${p.text}\n</source>`).join('\n') : 'Nothing matched. Try other words, or the terms a standard would use.',
      };
    },
  },
  {
    name: 'get_engagement', roles: 'all',
    description: 'The engagement: client, sector, frameworks in scope, risk appetite, description and which modules are on.',
    schema: S({}),
    async run(_a, s) {
      const { rows } = await s.q.query(`SELECT * FROM engagements WHERE id = $1`, [s.engagementId]);
      const e = rows[0];
      return { summary: 'Read the engagement details', text: e ? `Client: ${e.client}\nEngagement: ${e.name}\nSector: ${e.sector ?? ''}\nFrameworks: ${e.framework ?? ''}\nRisk appetite: residual score up to ${e.appetite?.maxResidual ?? '?'} accepted without escalation (${e.appetite?.escalateTo ?? 'escalate to the lead'})\nAbout: ${e.about ?? ''}` : 'Not found' };
    },
  },
  {
    name: 'get_use_case', roles: 'all',
    description: 'One use case by key (for example AI-3): its profile, stage, status, tier, classification, control design, and how reviewers decided its draft items, with reasons.',
    schema: S({ key: str('The use case key, for example AI-3') }, ['key']),
    async run(a, s) {
      const ids = await shareable(s);
      const { rows } = await s.q.query(`SELECT c.*, e.client FROM cards c JOIN engagements e ON e.id = c.engagement_id WHERE upper(c.key) = upper($1) AND c.engagement_id = ANY($2)`, [String(a.key ?? ''), ids]);
      const c = rows[0];
      if (!c) return { summary: `Looked for ${a.key}: not found`, text: 'Not found (or not visible from this engagement).' };
      const u = c.use_case ?? {};
      const cls = c.classification;
      const decided = Object.entries(c.decisions ?? {}).flatMap(([stage, items]: any) => Object.entries(items ?? {}).map(([item, d]: any) => `${stage} ${item}: ${d.decision}${d.reason ? ` (${d.reason})` : ''}${d.by ? ` by ${d.by}` : ''}`));
      return {
        summary: `Opened ${c.key} ${c.title}${c.engagement_id !== s.engagementId ? ` (${c.client})` : ''}`,
        text: cap([
          `${c.key} ${c.title} (${c.client})`, `Stage: ${c.stage}, status: ${c.status}, tier: ${c.tier ?? 'not yet classified'}`,
          `Description: ${u.description ?? ''}`, `Data used: ${u.dataUsed ?? ''}`, `People affected: ${u.affectedPeople ?? ''}`, `Autonomy: ${u.autonomy ?? ''}`, `Vendor: ${u.vendor ?? ''}`, `Owner: ${u.businessOwner ?? ''}`,
          cls ? `Classification: tier ${cls.tier}, oversight ${cls.oversight}. Risks: ${(cls.risks ?? []).map((r: any) => `${r.title} (${r.category}, ${r.likelihood}x${r.impact})`).join('; ')}` : '',
          c.design ? `Controls designed: ${(c.design.controls ?? []).map((x: any) => `${x.libraryCode ?? ''} ${x.title}`).join('; ')}` : '',
          decided.length ? `Reviewer decisions:\n${decided.slice(0, 20).join('\n')}` : '',
        ].filter(Boolean).join('\n')),
      };
    },
  },
  {
    name: 'find_similar_use_cases', roles: ['use_case_planner', 'risk_classifier', 'control_designer', 'assistant'],
    description: 'Find use cases like a description, on this engagement and other open engagements, with how they were tiered, their risks and controls. Use it to stay consistent and to spot duplicates.',
    schema: S({ text: str('What the use case does'), limit: int('How many, 1 to 5') }, ['text']),
    async run(a, s) {
      const ids = await shareable(s);
      const want = words(String(a.text ?? ''));
      const { rows } = await s.q.query(`SELECT c.key, c.title, c.tier, c.stage, c.use_case, c.classification, c.design, c.engagement_id, e.client FROM cards c JOIN engagements e ON e.id = c.engagement_id WHERE c.engagement_id = ANY($1) AND ($2::uuid IS NULL OR c.id <> $2) LIMIT 400`, [ids, s.cardId]);
      const scored = rows.map((c: any) => {
        const have = words(`${c.title} ${c.use_case?.description ?? ''} ${c.use_case?.dataUsed ?? ''}`);
        let hit = 0;
        for (const w of want) if (have.has(w)) hit++;
        return { c, score: want.size ? hit / Math.sqrt(want.size * Math.max(have.size, 1)) : 0 };
      }).filter((x) => x.score > 0.08).sort((x, y) => y.score - x.score).slice(0, Math.min(Number(a.limit) || 3, 5));
      return {
        summary: `Looked for similar use cases (${scored.length} found${scored.length ? `: ${scored.map((x) => x.c.key).join(', ')}` : ''})`,
        text: list(scored.map(({ c }) => `${c.key} ${c.title} (${c.engagement_id === s.engagementId ? 'this engagement' : c.client}). Stage ${c.stage}. Tier ${c.tier ?? 'not yet classified'}${c.classification ? `, oversight ${c.classification.oversight}. Risks: ${(c.classification.risks ?? []).map((r: any) => r.title).join('; ')}` : ''}${c.design ? `. Controls: ${(c.design.controls ?? []).map((x: any) => x.libraryCode ?? x.title).join(', ')}` : ''}`), 'No similar use cases.'),
      };
    },
  },
  {
    name: 'get_reviewer_decisions', roles: ['risk_classifier', 'control_designer', 'evidence_collector', 'control_tester', 'independent_reviewer', 'report_writer', 'use_case_planner'],
    description: 'How reviewers on this engagement decided earlier AI drafts for your stage: what they edited or rejected, and why. Learn from it; don\'t repeat corrected mistakes.',
    schema: S({ limit: int('How many decisions, 1 to 15') }),
    async run(a, s) {
      const stage = STAGE_OF[s.role as AgentRole];
      const { rows } = await s.q.query(`SELECT key, title, decisions FROM cards WHERE engagement_id = $1 AND decisions ? $2 AND ($3::uuid IS NULL OR id <> $3) ORDER BY updated_at DESC LIMIT 20`, [s.engagementId, stage ?? 'classify', s.cardId]);
      const out: string[] = [];
      for (const c of rows) for (const [item, d] of Object.entries((c.decisions ?? {})[stage ?? 'classify'] ?? {}) as any) {
        if (d.decision === 'accept' && out.length > 6) continue;
        out.push(`${c.key} ${item}: ${d.decision}${d.edit ? ` to ${JSON.stringify(d.edit)}` : ''}${d.reason ? `. Reason: ${d.reason}` : ''}`);
      }
      return { summary: `Read ${Math.min(out.length, Number(a.limit) || 10)} earlier reviewer decisions`, text: list(out.slice(0, Math.min(Number(a.limit) || 10, 15)), 'No earlier decisions for this stage yet.') };
    },
  },
  {
    name: 'list_risks', roles: 'all',
    description: 'The risk register for this engagement, optionally for one use case, or only risks above appetite, without a control, or without an owner.',
    schema: S({ useCase: str('Optional use case key'), only: { type: 'string', enum: ['all', 'above_appetite', 'no_control', 'no_owner'], description: 'Optional filter' } }),
    async run(a, s) {
      const { rows } = await s.q.query(
        `SELECT k.*, c.key AS card_key, e.appetite, (SELECT count(*) FROM control_risks cr WHERE cr.risk_id = k.id)::int AS controls
         FROM risks k JOIN cards c ON c.id = k.card_id JOIN engagements e ON e.id = k.engagement_id WHERE k.engagement_id = $1 ${a.useCase ? 'AND upper(c.key) = upper($2)' : ''} ORDER BY k.likelihood * k.impact DESC LIMIT 60`,
        a.useCase ? [s.engagementId, a.useCase] : [s.engagementId]);
      const keep = rows.filter((r: any) => a.only === 'no_control' ? r.controls === 0 : a.only === 'no_owner' ? !r.owner : a.only === 'above_appetite' ? (r.residual_likelihood ? r.residual_likelihood * r.residual_impact : r.likelihood * r.impact) > (r.appetite?.maxResidual ?? 8) : true);
      return { summary: `Read the risk register (${keep.length} risks)`, text: cap(list(keep.map((r: any) => `R-${r.number} ${r.title} [${r.card_key}] ${r.category}, score ${r.likelihood * r.impact}, residual ${r.residual_likelihood ? r.residual_likelihood * r.residual_impact : 'not set'}, owner ${r.owner || 'none'}, ${r.treatment}, ${r.status}, ${r.controls} controls`), 'No risks yet.')) };
    },
  },
  {
    name: 'list_controls', roles: 'all',
    description: 'Controls on this engagement, optionally for one use case: owner, status, library code and tests.',
    schema: S({ useCase: str('Optional use case key') }),
    async run(a, s) {
      const { rows } = await s.q.query(
        `SELECT c.*, k.key AS card_key, l.code, (SELECT count(*) FROM tests t WHERE t.control_id = c.id)::int AS tests FROM controls c LEFT JOIN cards k ON k.id = c.card_id LEFT JOIN control_library l ON l.id = c.library_id
         WHERE c.engagement_id = $1 ${a.useCase ? 'AND upper(k.key) = upper($2)' : ''} ORDER BY c.number LIMIT 80`, a.useCase ? [s.engagementId, a.useCase] : [s.engagementId]);
      return { summary: `Read the controls (${rows.length})`, text: cap(list(rows.map((c: any) => `C-${c.number} ${c.code ?? ''} ${c.title} [${c.card_key ?? 'engagement'}] owner ${c.owner || 'none'}, ${c.status}, ${c.tests} tests. Objective: ${c.objective}`), 'No controls yet.')) };
    },
  },
  {
    name: 'search_library', roles: ['control_designer', 'evidence_collector', 'control_tester', 'independent_reviewer', 'assistant'],
    description: 'The control library: 31 reusable controls with objectives, test procedures and the evidence usually expected. Search by words or give a code (for example OVS-01).',
    schema: S({ text: str('Words to look for, or a library code') }, ['text']),
    async run(a, s) {
      const t = String(a.text ?? '').trim();
      const { rows } = await s.q.query(`SELECT * FROM control_library ORDER BY code`);
      const want = words(t);
      const hits = rows.filter((l: any) => l.code.toLowerCase() === t.toLowerCase()).concat(rows.map((l: any) => {
        const have = words(`${l.title} ${l.objective} ${l.domain} ${(l.risk_categories ?? []).join(' ')}`);
        let n = 0; for (const w of want) if (have.has(w)) n++;
        return { l, n };
      }).filter((x: any) => x.n > 0).sort((x: any, y: any) => y.n - x.n).map((x: any) => x.l)).slice(0, 5);
      return { summary: `Searched the control library for "${t.slice(0, 60)}" (${hits.length})`, text: cap(list(hits.map((l: any) => `${l.code} ${l.title}: ${l.objective} Test: ${l.test_procedure} Evidence usually expected: ${l.evidence_expected}`), 'No library control matched.')) };
    },
  },
  {
    name: 'list_tests', roles: ['control_tester', 'independent_reviewer', 'report_writer', 'evidence_collector', 'assistant'],
    description: 'Tests on this engagement, optionally for one use case: procedure, sample, result, exceptions, preparer and reviewer.',
    schema: S({ useCase: str('Optional use case key') }),
    async run(a, s) {
      const { rows } = await s.q.query(
        `SELECT t.*, c.number AS c_number, k.key AS card_key FROM tests t JOIN controls c ON c.id = t.control_id LEFT JOIN cards k ON k.id = c.card_id WHERE t.engagement_id = $1 ${a.useCase ? 'AND upper(k.key) = upper($2)' : ''} ORDER BY t.number LIMIT 60`,
        a.useCase ? [s.engagementId, a.useCase] : [s.engagementId]);
      return { summary: `Read the tests (${rows.length})`, text: cap(list(rows.map((t: any) => `T-${t.number} ${t.title} [C-${t.c_number}, ${t.card_key ?? ''}] ${t.status}, sample ${t.sample_size ?? 'not stated'}, exceptions ${t.exceptions}, prepared by ${t.prepared_by ?? '-'}, reviewed by ${t.reviewed_by ?? '-'}. Procedure: ${t.procedure}. Actual: ${t.actual || '-'}`), 'No tests yet.')) };
    },
  },
  {
    name: 'list_evidence', roles: ['evidence_collector', 'control_tester', 'independent_reviewer', 'assistant'],
    description: 'Evidence items on this engagement, optionally for one control (C-number): kind, title, what was read from files.',
    schema: S({ control: str('Optional control key, for example C-4') }),
    async run(a, s) {
      const n = keyNum(a.control, 'C');
      const { rows } = await s.q.query(
        `SELECT e.*, c.number AS c_number FROM evidence e LEFT JOIN controls c ON c.id = e.control_id WHERE e.engagement_id = $1 ${n ? 'AND c.number = $2' : ''} ORDER BY e.number DESC LIMIT 50`,
        n ? [s.engagementId, n] : [s.engagementId]);
      return { summary: `Listed evidence (${rows.length})`, text: cap(list(rows.map((e: any) => `E-${e.number} ${e.title} (${e.kind}${e.c_number ? `, C-${e.c_number}` : ''})${e.text_note ? `: ${e.text_note}` : ''}${e.kind === 'note' ? `. Note: ${String(e.note ?? '').slice(0, 200)}` : ''}`), 'No evidence yet.')) };
    },
  },
  {
    name: 'read_evidence', roles: ['evidence_collector', 'control_tester', 'independent_reviewer', 'assistant'],
    description: 'The text of one evidence item (E-number): a note, or what was read from a PDF, Word, Excel or text file. Long items come in parts: pass offset to read on.',
    schema: S({ key: str('Evidence key, for example E-12'), offset: int('Character to start from, default 0') }, ['key']),
    async run(a, s) {
      const n = keyNum(a.key, 'E');
      const { rows } = n ? await s.q.query(`SELECT * FROM evidence WHERE engagement_id = $1 AND number = $2`, [s.engagementId, n]) : { rows: [] as any[] };
      const e = rows[0];
      if (!e) return { summary: `Looked for ${a.key}: not found`, text: 'Not found on this engagement.' };
      const body = e.kind === 'note' ? e.note ?? '' : e.text_content ?? `(${e.kind}: nothing readable${e.text_note ? `, ${e.text_note}` : ''})`;
      const from = Math.max(Number(a.offset) || 0, 0);
      return { summary: `Read E-${e.number} ${e.title}${from ? ` from character ${from}` : ''}`, text: `<evidence key="E-${e.number}" title="${String(e.title).replace(/"/g, "'")}">\n${cap(body.slice(from))}\n</evidence>` };
    },
  },
  {
    name: 'list_issues', roles: ['independent_reviewer', 'report_writer', 'control_tester', 'assistant'],
    description: 'Issues (findings) on this engagement with severity, status, owner and due date.',
    schema: S({ open: { type: 'boolean', description: 'Only open issues' } }),
    async run(a, s) {
      const { rows } = await s.q.query(`SELECT * FROM issues WHERE engagement_id = $1 ${a.open ? `AND status NOT IN ('closed','risk_accepted')` : ''} ORDER BY number DESC LIMIT 50`, [s.engagementId]);
      return { summary: `Read the issues (${rows.length})`, text: cap(list(rows.map((i: any) => `I-${i.number} ${i.title}: ${i.severity}, ${i.status}, owner ${i.owner || 'none'}, due ${i.due_date ?? 'not set'}`), 'No issues.')) };
    },
  },
  {
    name: 'list_incidents', roles: ['independent_reviewer', 'report_writer', 'risk_classifier', 'assistant'],
    description: 'AI incidents on this engagement with severity, status and what happened.',
    schema: S({}),
    async run(_a, s) {
      const { rows } = await s.q.query(`SELECT * FROM incidents WHERE engagement_id = $1 ORDER BY number DESC LIMIT 30`, [s.engagementId]).catch(() => ({ rows: [] as any[] }));
      return { summary: `Read the incidents (${rows.length})`, text: cap(list(rows.map((i: any) => `INC-${i.number} ${i.title}: ${i.severity}, ${i.status}. ${String(i.description ?? '').slice(0, 200)}`), 'No incidents.')) };
    },
  },
  {
    name: 'get_inventory', roles: ['use_case_planner', 'risk_classifier', 'control_designer', 'assistant'],
    description: 'The AI inventory on this engagement: systems, models, agents and vendors, with owners and status.',
    schema: S({ text: str('Optional words to filter by') }),
    async run(a, s) {
      const { rows } = await s.q.query(`SELECT * FROM inventory WHERE engagement_id = $1 ORDER BY number LIMIT 60`, [s.engagementId]);
      const t = String(a.text ?? '').toLowerCase();
      const keep = t ? rows.filter((r: any) => `${r.name} ${r.vendor} ${r.description}`.toLowerCase().includes(t)) : rows;
      return { summary: `Read the AI inventory (${keep.length})`, text: cap(list(keep.map((r: any) => `INV-${r.number} ${r.name} (${r.kind}) vendor ${r.vendor || 'in-house'}, owner ${r.owner || 'none'}, ${r.status}. ${String(r.description ?? '').slice(0, 160)}`), 'Nothing in the inventory.')) };
    },
  },
  {
    name: 'get_eval_results', roles: ['control_tester', 'independent_reviewer', 'report_writer', 'assistant'],
    description: 'The latest evaluation runs (accuracy, red teaming) on this engagement\'s AI systems, with pass rates.',
    schema: S({}),
    async run(_a, s) {
      const { rows } = await s.q.query(`SELECT r.*, s.name, s.threshold_pct FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE s.engagement_id = $1 ORDER BY r.started_at DESC LIMIT 15`, [s.engagementId]);
      return { summary: `Read the latest evaluation runs (${rows.length})`, text: list(rows.map((r: any) => `${r.name}: ${r.status}, ${r.passed}/${r.total} passed (threshold ${r.threshold_pct}%), model ${r.model}`), 'No evaluation runs.') };
    },
  },
  {
    name: 'ask_person', roles: ['risk_classifier', 'control_designer', 'evidence_collector', 'control_tester', 'independent_reviewer'],
    description: 'Ask a person a question when something you need is missing or unclear and you can\'t find it with the other tools. Your run pauses until someone answers. Ask one clear question; say why it matters.',
    schema: S({ question: str('The question, in plain words'), to: { type: 'string', enum: ['business_owner', 'reviewer', 'preparer'], description: 'Who is best placed to answer' }, why: str('Why you need it') }, ['question', 'why']),
    async run(a, s) {
      if (s.questionsLeft <= 0) return { summary: 'Tried to ask a person, but no more questions are allowed in this run', text: 'You can\'t ask more questions now. Submit your best draft and list what is unknown as open questions.' };
      return { summary: `Asked: ${String(a.question).slice(0, 120)}`, text: 'Question sent. Stop here.', question: { question: String(a.question ?? '').slice(0, 600), to: String(a.to ?? 'business_owner'), why: String(a.why ?? '').slice(0, 300) } };
    },
  },
];

const STAGE_OF: Partial<Record<AgentRole, string>> = {
  risk_classifier: 'classify', control_designer: 'design', evidence_collector: 'evidence', control_tester: 'test', independent_reviewer: 'validate', report_writer: 'report', use_case_planner: 'intake',
};

/** The tools a role may use. allow narrows them (the agent's tick list); asking can be switched off. */
export function toolsFor(role: AgentRole | 'assistant', opts: { allow?: string[] | null; canAsk?: boolean } = {}): Tool[] {
  return TOOLS.filter((t) => (t.roles === 'all' || t.roles.includes(role)) && (!opts.allow?.length || opts.allow.includes(t.name)) && (t.name !== 'ask_person' || opts.canAsk !== false));
}
export const TOOL_NAMES = TOOLS.map((t) => t.name);
export type { Tool };
