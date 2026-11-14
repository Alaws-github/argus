// Grounding (knowledge-base passages an agent may cite) and human decisions on drafts.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Grounding and human decisions on drafts
// ---------------------------------------------------------------------------
// A knowledge-base passage an agent was given and may cite as K-<number>.
export interface SourcePassage {
  id: string;
  title: string;
  kind: string;
  ref: string;
  text: string;
  score: number;
}
// v1.7.4: say what a cited passage is in words a reviewer understands, not just its K-id:
// what kind of source it is, its name, and the frameworks it draws on.
export const SOURCE_KINDS: Record<string, string> = {
  framework: 'Framework requirement',
  control: 'Library control',
  methodology: 'ARGUS method',
  client: 'About the client',
  use_case: 'Another use case',
  evidence: 'Evidence',
  upload: 'Client document',
};
const SOURCE_FRAMEWORKS: [RegExp, string][] = [
  [/EU AI Act/i, 'EU AI Act'],
  [/ISO\/IEC 42001|ISO 42001/i, 'ISO/IEC 42001'],
  [/NIST AI RMF|\b(GOVERN|MAP|MEASURE|MANAGE) \d/, 'NIST AI RMF'],
  [/NIST CSF/i, 'NIST CSF 2.0'],
  [/Jamaica (DPA|Data Protection Act)/i, 'Jamaica DPA 2020'],
  [/OWASP|\bLLM\d\d\b/i, 'OWASP LLM Top 10'],
  [/HIPAA|45 CFR/i, 'HIPAA'],
  [/GMLP|Good Machine Learning/i, 'FDA GMLP'],
  [/COSO/i, 'COSO'],
];
/** A source passage described in words: what it is and which frameworks it draws on. */
export function describeSource(p: Pick<SourcePassage, 'kind' | 'title' | 'ref' | 'text'>): {
  kind: string;
  name: string;
  basedOn: string[];
} {
  const all = SOURCE_FRAMEWORKS.filter(([re]) => re.test(`${p.title} ${p.ref} ${p.text}`)).map(([, n]) => n);
  // A framework passage *is* the framework; list what else it points to only for methods and controls.
  const own = p.kind === 'framework' ? SOURCE_FRAMEWORKS.find(([re]) => re.test(p.title))?.[1] : undefined;
  return {
    kind: SOURCE_KINDS[p.kind] ?? p.kind,
    name: p.title,
    basedOn: p.kind === 'framework' ? [] : all.filter((n) => n !== own).slice(0, 4),
  };
}

// A person's decision on one item of an agent's draft. Edits keep the agent's
// original alongside, so the audit trail shows what the AI proposed and what
// the person changed.
export const ItemDecision = z.object({
  decision: z.enum(['accept', 'edit', 'reject']),
  edit: z.record(z.any()).optional(),
  reason: z.string().max(600).optional(),
  by: z.string().optional(),
  at: z.string().optional(),
});
export type ItemDecision = z.infer<typeof ItemDecision>;

// Keyed by stage, then by what is being decided: 'tier', 'risk:0', 'control:2', 'challenge:1'.
export type CardDecisions = Partial<Record<string, Record<string, ItemDecision>>>;
