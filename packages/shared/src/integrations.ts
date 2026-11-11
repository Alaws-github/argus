// v1.7.3: how ARGUS fits into a client's own tools, beyond reading them.
//
// 1. Proof of client steps: each client step in a published workflow can say
//    what record proves it was done (PROOF_KINDS). ARGUS checks the step for
//    each use case by reading the step's connector and finding the records
//    that mention the use case key (AI-3), or a person confirms it with a link.
// 2. Evidence pushed from pipelines: a CI/CD job posts eval results, fairness
//    metrics, drift reports or an SBOM with an ingest token (IngestEvidence).
// 3. Write-back: when an engagement switches it on, ARGUS sends messages or
//    creates tickets in the client's tools on set events (OUTBOUND_KINDS,
//    OUTBOUND_EVENTS). Off by default; only people and events trigger a send,
//    never an agent; every send is audited.
import { z } from 'zod';

export const PROOF_KINDS = {
  '': 'Not checked',
  mentions: 'A record mentions the use case key',
  status: 'A record for the use case has a given status',
  all_done: 'Every record for the use case is done',
  manual: 'A person confirms it, with a link',
} as const;
export type ProofKind = keyof typeof PROOF_KINDS;
/** Status words that count as done for all_done (case does not matter). */
export const DONE_WORDS = ['done', 'closed', 'resolved', 'approved', 'complete', 'completed', 'implemented', 'accepted', 'signed', '3', '7'];

export interface ClientStep {
  nodeId: string;
  label: string;
  type: string;
  tool: string;
  toolDetail: string;
  proof: ProofKind;
  proofStatus: string;
  connectorKey: string | null;
  status: 'passed' | 'failed' | 'pending' | 'not_checked';
  detail: string;
  record: string | null;
  recordUrl: string | null;
  evidenceKey: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
}

// --------------------------------------------------------------- pipelines
export const IngestTokenInput = z.object({
  name: z.string().trim().min(3).max(80),
  controlId: z.string().uuid().nullable().default(null),
});
export interface IngestToken { id: string; key: string; name: string; hint: string; controlId: string | null; controlKey: string | null; createdBy: string; createdAt: string; lastUsedAt: string | null; uses: number; revokedAt: string | null }
export const INGEST_KINDS = ['eval', 'fairness', 'drift', 'sbom', 'test_report', 'model_card', 'other'] as const;
export const INGEST_KIND_LABELS: Record<(typeof INGEST_KINDS)[number], string> = {
  eval: 'Evaluation results', fairness: 'Fairness metrics', drift: 'Drift report', sbom: 'Software bill of materials', test_report: 'Test report', model_card: 'Model card', other: 'Other',
};
export const IngestEvidence = z.object({
  title: z.string().trim().min(3).max(200),
  kind: z.enum(INGEST_KINDS).default('other'),
  /** Control key (C-3) to file it against; else the token's control. */
  control: z.string().regex(/^C-\d+$/i).optional(),
  /** Use case key (AI-3) it belongs to. */
  useCase: z.string().regex(/^[A-Z][A-Z0-9]{0,5}-\d+$/i).optional(),
  filename: z.string().max(180).optional(),
  mime: z.string().max(120).optional(),
  content: z.string().max(10_000_000).optional(),
  contentBase64: z.string().max(14_000_000).optional(),
  url: z.string().url().max(2000).optional(),
  source: z.object({ system: z.string().max(40).optional(), repo: z.string().max(200).optional(), branch: z.string().max(120).optional(), commit: z.string().max(80).optional(), run: z.string().max(200).optional(), pipelineUrl: z.string().url().max(2000).optional() }).default({}),
  metrics: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
}).refine((b) => b.content || b.contentBase64 || b.url, 'Send content, contentBase64 or a url');
export type IngestEvidence = z.infer<typeof IngestEvidence>;

// --------------------------------------------------------------- write-back
export const OUTBOUND_KINDS = {
  teams: { label: 'Teams channel message', tool: 'teams', help: "Create a Workflows (or incoming webhook) URL for the channel in Teams and paste it. ARGUS posts a short message; it can't read the channel through it." },
  slack: { label: 'Slack channel message', tool: 'slack', help: 'Create a Slack app incoming webhook for the channel and paste its URL.' },
  jira: { label: 'Jira ticket', tool: 'jira', help: 'Site address (https://your-site.atlassian.net), the project key, and email:API token for an account that can create issues in that project.' },
  servicenow: { label: 'ServiceNow record', tool: 'servicenow', help: 'Instance address (https://your-instance.service-now.com), the table (for example incident or sn_grc_issue), and user:password for an integration user that can create records in it.' },
  webhook: { label: 'Webhook (any system)', tool: 'other', help: 'Any address that accepts a JSON POST, for example a Power Automate or Zapier flow. Optional bearer token.' },
} as const;
export type OutboundKind = keyof typeof OUTBOUND_KINDS;
export const OUTBOUND_EVENTS = {
  'card.waiting': 'A use case is waiting for a person (approval or review)',
  'card.question': 'An agent asked a question',
  'test.failed': 'A control test failed',
  'issue.raised': 'An issue was raised',
  'card.signed_off': 'A use case was signed off',
  'incident.raised': 'An incident was raised',
  'step.failed': 'A client step check failed',
} as const;
export type OutboundEvent = keyof typeof OUTBOUND_EVENTS;
export const OutboundInput = z.object({
  name: z.string().trim().min(3).max(80),
  kind: z.enum(Object.keys(OUTBOUND_KINDS) as [OutboundKind, ...OutboundKind[]]),
  url: z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Use an https address'), // http only reaches a private network, when an admin allows it
  project: z.string().trim().max(80).default(''),
  secret: z.string().max(4000).optional(),
  events: z.array(z.enum(Object.keys(OUTBOUND_EVENTS) as [OutboundEvent, ...OutboundEvent[]])).max(10).default([]),
  enabled: z.boolean().default(true),
});
export type OutboundInput = z.infer<typeof OutboundInput>;
export interface OutboundTarget { id: string; key: string; name: string; kind: OutboundKind; url: string; project: string; secretSet: boolean; events: OutboundEvent[]; enabled: boolean; sends: number; lastAt: string | null; lastStatus: string | null; lastMessage: string | null; createdBy: string }
