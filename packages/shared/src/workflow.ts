// Client workflows (v1.7): a client's own way of taking an AI use case from
// idea to live, drawn as steps and arrows, with ARGUS's governance steps built
// in. The governance steps (the five gates) can't be removed, skipped or put
// out of order, and every agent step must be followed by a person's decision.
// The same checks run in the browser (as you draw) and on the server (before
// anything is saved as published), so the rules can't be bypassed.
import { z } from 'zod';
import { toolById } from './tools-catalog.js';

export const WF_NODE_TYPES = ['start', 'gate', 'agent', 'person', 'task', 'condition', 'notify', 'end'] as const;
export type WfNodeType = (typeof WF_NODE_TYPES)[number];

export const WF_NODE_INFO: Record<WfNodeType, { label: string; hint: string; icon: string }> = {
  start: { label: 'Trigger', hint: 'What starts the workflow: a new use case, a vendor change, a scheduled review, an incident', icon: 'bolt' },
  gate: { label: 'Governance gate', hint: 'An ARGUS stage that must be passed. Built in; can be moved but not removed or skipped', icon: 'lock' },
  agent: { label: 'Agent step', hint: 'An ARGUS agent drafts something. A person must decide on it before the workflow ends', icon: 'agents' },
  person: { label: 'Person decides', hint: 'A named role approves, reviews or signs off', icon: 'person' },
  task: { label: 'Client step', hint: "A step in the client's own process, such as a legal review or a change board", icon: 'check' },
  condition: { label: 'Condition', hint: 'Splits the path, for example "Is the risk tier high?" Label each way out', icon: 'branch' },
  notify: { label: 'Notify', hint: 'Who should be told. ARGUS records it; it does not send messages', icon: 'mail' },
  end: { label: 'End', hint: 'Where the workflow finishes', icon: 'check' },
};

// The governance gates, in the order every path must pass them.
export const WF_GATES = [
  { id: 'g-intake', stage: 'intake', label: 'Intake: use case registered' },
  { id: 'g-classify', stage: 'classify', label: 'Risk classified and approved' },
  { id: 'g-design', stage: 'design', label: 'Controls designed and approved' },
  { id: 'g-test', stage: 'test', label: 'Controls tested and reviewed' },
  { id: 'g-signoff', stage: 'validate', label: 'Signed off by a named person' },
] as const;
export const WF_LOCKED = new Set<string>(['start', ...WF_GATES.map((g) => g.id)]);

export const WfNode = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  type: z.enum(WF_NODE_TYPES),
  label: z.string().trim().min(1).max(80),
  x: z.number().min(-5000).max(20000),
  y: z.number().min(-5000).max(20000),
  config: z.object({
    role: z.string().max(60).optional(),        // person: who decides; notify: who is told
    agent: z.string().max(40).optional(),       // agent: which ARGUS agent role
    trigger: z.string().max(80).optional(),     // start: what starts it
    question: z.string().max(160).optional(),   // condition: the question asked
    stage: z.string().max(20).optional(),       // gate: the ARGUS stage
    note: z.string().max(400).optional(),
    // v1.7.1: the business tool this step happens in (BUSINESS_TOOLS id), where in it, and a read-only connector that reads it.
    tool: z.string().max(40).optional(),
    toolDetail: z.string().max(120).optional(),
    connectorId: z.string().uuid().nullable().optional(),
  }).default({}),
});
export type WfNode = z.infer<typeof WfNode>;
export const WfEdge = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  from: z.string(),
  to: z.string(),
  label: z.string().trim().max(40).optional(),
  // A rework arrow goes back to an earlier step (for example "changes requested").
  rework: z.boolean().optional(),
});
export type WfEdge = z.infer<typeof WfEdge>;
export const WfGraph = z.object({ nodes: z.array(WfNode).max(80), edges: z.array(WfEdge).max(200) });
export type WfGraph = z.infer<typeof WfGraph>;

export interface Workflow {
  id: string;
  key: string; // WF-1
  name: string;
  description: string;
  status: 'draft' | 'published' | 'retired';
  version: number; // last published version, 0 if never
  graph: WfGraph;
  changedSincePublish: boolean;
  updatedBy: string;
  updatedAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
}
export interface WorkflowVersion { version: number; name: string; publishedBy: string; publishedAt: string; note: string; nodes: number }

export const WF_TEMPLATES = ['standard', 'm365', 'servicenow', 'google', 'minimal'] as const;
export const WF_TEMPLATE_INFO: Record<(typeof WF_TEMPLATES)[number], { label: string; hint: string }> = {
  standard: { label: 'Standard', hint: 'The five gates with agent drafts, reviewer approvals, a high-risk check and sign-off' },
  m365: { label: 'Microsoft 365', hint: 'The standard workflow with steps in SharePoint, Teams, Excel, Power Automate and Outlook' },
  servicenow: { label: 'ServiceNow and Jira', hint: 'Requests and change approvals in ServiceNow, testing tracked in Jira, policies in Confluence' },
  google: { label: 'Google Workspace and Slack', hint: 'Evidence in Google Drive, the risk register in Google Sheets, approvals and notices in Slack' },
  minimal: { label: 'Gates only', hint: 'Just the five governance gates in a line, to build around' },
};
export const NewWorkflow = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(400).default(''), template: z.enum(WF_TEMPLATES).default('standard') });
export const SaveWorkflow = z.object({ name: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(400).optional(), graph: WfGraph.optional() });

/** A starting workflow: the governance spine, with the usual agent and person steps around it. */
export function workflowTemplate(kind: (typeof WF_TEMPLATES)[number] = 'standard'): WfGraph {
  const n = (id: string, type: WfNodeType, label: string, x: number, y: number, config: WfNode['config'] = {}): WfNode => ({ id, type, label, x, y, config });
  const g = (i: number, x: number, y: number) => n(WF_GATES[i].id, 'gate', WF_GATES[i].label, x, y, { stage: WF_GATES[i].stage });
  if (kind === 'minimal') {
    const nodes = [n('start', 'start', 'New AI use case proposed', 40, 80, { trigger: 'New AI use case proposed' }), ...WF_GATES.map((_, i) => g(i, 300 + (i % 3) * 260, 80 + Math.floor(i / 3) * 240)), n('end', 'end', 'Live under governance', 820, 320)];
    const ids = nodes.map((x) => x.id);
    return { nodes, edges: ids.slice(1).map((to, i) => ({ id: `e${i + 1}`, from: ids[i], to })) };
  }
  const nodes: WfNode[] = [
    // Three rows, read left to right like text.
    n('start', 'start', 'New AI use case proposed', 40, 80, { trigger: 'New AI use case proposed' }),
    g(0, 300, 80),
    n('a-classify', 'agent', 'Risk Classifier drafts the tier', 560, 80, { agent: 'risk_classifier' }),
    n('p-classify', 'person', 'Reviewer approves the tier', 820, 80, { role: 'Reviewer' }),
    g(1, 1080, 80),
    n('c-high', 'condition', 'High risk?', 1340, 80, { question: 'Is the risk tier high or prohibited?' }),
    n('t-dpia', 'task', 'Impact assessment (client)', 1340, 200, { role: 'Data Protection Officer' }),
    n('a-design', 'agent', 'Control Designer proposes controls', 40, 320, { agent: 'control_designer' }),
    n('p-design', 'person', 'Reviewer approves the controls', 300, 320, { role: 'Reviewer' }),
    g(2, 560, 320),
    n('t-test', 'task', 'Preparer tests each control', 820, 320, { role: 'Preparer' }),
    g(3, 1080, 320),
    n('p-signoff', 'person', 'Lead signs off', 1340, 320, { role: 'Lead' }),
    g(4, 40, 560),
    n('notify', 'notify', 'Tell the model risk committee', 300, 560, { role: 'Model Risk Committee' }),
    n('end', 'end', 'Live under governance', 560, 560),
  ];
  const e = (id: string, from: string, to: string, label?: string, rework?: boolean): WfEdge => ({ id, from, to, ...(label ? { label } : {}), ...(rework ? { rework } : {}) });
  // Tool-flavoured templates: the same steps, each placed in the client's tools.
  const TOOLS: Record<string, Record<string, [string, string]>> = {
    m365: { start: ['sharepoint', 'AI request list'], 't-dpia': ['sharepoint', 'Impact assessments library'], 'p-classify': ['power_automate', 'Approval flow'], 'p-design': ['power_automate', 'Approval flow'], 't-test': ['excel', 'Control testing workbook'], 'p-signoff': ['teams', 'Model Risk channel'], notify: ['outlook', 'Committee mailbox'] },
    servicenow: { start: ['servicenow', 'AI intake request'], 'p-classify': ['servicenow', 'Risk approval'], 't-dpia': ['confluence', 'Impact assessment page'], 'p-design': ['servicenow', 'Change approval (CAB)'], 't-test': ['jira', 'GRC testing project'], 'p-signoff': ['servicenow', 'Sign-off task'], notify: ['jira', 'Release ticket'] },
    google: { start: ['google_sheets', 'AI intake form responses'], 't-dpia': ['google_drive', 'Impact assessments folder'], 'p-classify': ['slack', '#ai-governance approval'], 't-test': ['google_sheets', 'Control testing sheet'], 'p-signoff': ['slack', '#model-risk sign-off'], notify: ['slack', '#announcements'] },
  };
  const map = TOOLS[kind];
  if (map) for (const nd of nodes) if (map[nd.id]) nd.config = { ...nd.config, tool: map[nd.id][0], toolDetail: map[nd.id][1] };
  return {
    nodes,
    edges: [
      e('e1', 'start', 'g-intake'), e('e2', 'g-intake', 'a-classify'), e('e3', 'a-classify', 'p-classify'), e('e4', 'p-classify', 'g-classify'),
      e('e5', 'p-classify', 'a-classify', 'Changes requested', true),
      e('e6', 'g-classify', 'c-high'), e('e7', 'c-high', 't-dpia', 'Yes'), e('e8', 'c-high', 'a-design', 'No'), e('e9', 't-dpia', 'a-design'),
      e('e10', 'a-design', 'p-design'), e('e11', 'p-design', 'g-design'), e('e12', 'g-design', 't-test'), e('e13', 't-test', 'g-test'),
      e('e14', 'g-test', 'p-signoff'), e('e15', 'p-signoff', 'g-signoff'), e('e16', 'g-signoff', 'notify'), e('e17', 'notify', 'end'),
    ],
  };
}

/** What's wrong with a workflow, in plain words. Empty means it can be published. */
export function validateWorkflow(g: WfGraph): { problems: string[]; nodeProblems: Record<string, string[]> } {
  const problems: string[] = [];
  const nodeProblems: Record<string, string[]> = {};
  const flag = (id: string, msg: string) => { (nodeProblems[id] ??= []).push(msg); problems.push(msg); };
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const label = (id: string) => byId.get(id)?.label ?? id;

  if (new Set(g.nodes.map((n) => n.id)).size !== g.nodes.length) problems.push('Two steps share an id');
  for (const e of g.edges) if (!byId.has(e.from) || !byId.has(e.to)) problems.push(`An arrow points at a step that no longer exists`);
  const starts = g.nodes.filter((n) => n.type === 'start');
  const ends = g.nodes.filter((n) => n.type === 'end');
  if (starts.length !== 1) problems.push(starts.length ? 'A workflow has one trigger' : 'Add a trigger: what starts the workflow');
  if (!ends.length) problems.push('Add an end step');
  for (const gate of WF_GATES) if (!byId.has(gate.id)) problems.push(`The governance gate "${gate.label}" is missing. It can't be removed`);

  const fwd = g.edges.filter((e) => !e.rework && byId.has(e.from) && byId.has(e.to));
  const out = (id: string, skip?: Set<string>) => fwd.filter((e) => e.from === id && !skip?.has(e.to)).map((e) => e.to);
  const reach = (from: string, skip?: Set<string>) => {
    const seen = new Set<string>([from]);
    const stack = [from];
    while (stack.length) for (const nx of out(stack.pop()!, skip)) if (!seen.has(nx)) { seen.add(nx); stack.push(nx); }
    return seen;
  };
  const start = starts[0]?.id;
  const endIds = new Set(ends.map((n) => n.id));
  const reachesEnd = (from: string, skip?: Set<string>) => [...reach(from, skip)].some((id) => endIds.has(id));

  for (const n of g.nodes) {
    const ins = g.edges.filter((e) => e.to === n.id).length;
    const outs = g.edges.filter((e) => e.from === n.id).length;
    if (n.type !== 'start' && !ins) flag(n.id, `"${n.label}" has no arrow coming in`);
    if (n.type !== 'end' && !outs) flag(n.id, `"${n.label}" has no arrow going out`);
    if (n.type === 'person' && !n.config.role?.trim()) flag(n.id, `"${n.label}": say which role decides`);
    if (n.type === 'agent' && !n.config.agent) flag(n.id, `"${n.label}": pick which agent drafts`);
    if (n.config.tool && !toolById(n.config.tool)) flag(n.id, `"${n.label}": the tool it names isn't in the list`);
    if (n.config.connectorId && !n.config.tool) flag(n.id, `"${n.label}": pick the tool its connector reads`);
    if (n.type === 'condition') {
      const ways = g.edges.filter((e) => e.from === n.id);
      if (ways.length < 2) flag(n.id, `"${n.label}" needs at least two ways out`);
      if (ways.some((e) => !e.label?.trim())) flag(n.id, `"${n.label}": label each way out (for example Yes and No)`);
    }
  }
  if (start && endIds.size) {
    const fromStart = reach(start);
    if (![...fromStart].some((id) => endIds.has(id))) problems.push('There is no path from the trigger to an end');
    for (const n of g.nodes) if (n.type !== 'start' && !fromStart.has(n.id) && !g.edges.some((e) => e.rework && e.to === n.id)) flag(n.id, `"${n.label}" can't be reached from the trigger`);
    // No way round a gate: take the gate out, and the end must be out of reach.
    for (const gate of WF_GATES) if (byId.has(gate.id) && reachesEnd(start, new Set([gate.id]))) flag(gate.id, `There is a way round "${gate.label}". Every path must pass it`);
    // Gates in order: no forward path from a later gate back to an earlier one.
    WF_GATES.forEach((later, j) => WF_GATES.slice(0, j).forEach((earlier) => {
      if (byId.has(later.id) && byId.has(earlier.id) && reach(later.id).has(earlier.id)) flag(later.id, `"${later.label}" comes before "${earlier.label}". Keep the governance gates in order, or mark the arrow back as rework`);
    }));
    // Agents draft; people decide: from an agent, every path to an end meets a person or a gate.
    const deciders = new Set(g.nodes.filter((n) => n.type === 'person' || n.type === 'gate').map((n) => n.id));
    for (const n of g.nodes) if (n.type === 'agent' && reachesEnd(n.id, deciders)) flag(n.id, `"${n.label}" can reach the end without a person deciding on its draft`);
  }
  return { problems: [...new Set(problems)], nodeProblems };
}
