// Adding an engagement: frameworks to choose from and the wizard input.
import { z } from 'zod';
import { FRAMEWORK_LABELS, FrameworkRefs } from './controls.js';

// ---------------------------------------------------------------------------
// Adding an engagement (a client, or a project for a client)
// ---------------------------------------------------------------------------
export const FRAMEWORK_CHOICES = [
  { id: 'nistAiRmf', label: 'NIST AI RMF 1.0', hint: 'The usual backbone for AI risk management' },
  {
    id: 'iso42001',
    label: 'ISO/IEC 42001',
    hint: 'Certifiable AI management system; needs a Statement of Applicability',
  },
  { id: 'euAiAct', label: 'EU AI Act', hint: 'If the client serves people in the EU' },
  { id: 'jdpa', label: 'Jamaica Data Protection Act 2020', hint: 'Personal data of people in Jamaica' },
  { id: 'nistCsf', label: 'NIST CSF 2.0', hint: 'Security controls around the AI' },
  { id: 'coso', label: 'COSO Internal Control', hint: 'Financial reporting and internal audit' },
  { id: 'owasp', label: 'OWASP LLM and Agentic Top 10', hint: 'Red-team coverage for LLM apps and agents' },
  {
    id: 'fdaGmlp',
    label: 'FDA Good Machine Learning Practice',
    hint: 'AI in medical devices: the 10 GMLP principles, change control plans and device AI guidance',
  },
  {
    id: 'hipaa',
    label: 'HIPAA and HHS health AI rules',
    hint: 'Protected health information in AI, vendor agreements, and fair clinical decision support',
  },
] as const;
export type FrameworkChoice = (typeof FRAMEWORK_CHOICES)[number]['id'];
/** v1.7.3: which frameworks an engagement's framework text names ("NIST AI RMF 1.0 · ISO/IEC 42001", or older "NIST AI RMF, ISO/IEC 42001"). */
export const frameworksIn = (text: string): FrameworkChoice[] =>
  FRAMEWORK_CHOICES.filter((f) =>
    [f.label, f.label.replace(/\s+[\d.]+$/, ''), FRAMEWORK_LABELS[f.id as keyof FrameworkRefs]].some(
      (l) => l && text.includes(l),
    ),
  ).map((f) => f.id);

export const SECTORS = [
  'Banking and Credit',
  'Insurance',
  'Public Sector',
  'Healthcare',
  'Retail and Consumer',
  'Telecoms',
  'Professional Services',
  'Other',
] as const;

export const AgentModelChoice = z.object({
  providerId: z.string().uuid(),
  model: z.string().min(1).max(120),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
});

export const NewEngagement = z.object({
  name: z.string().trim().min(2).max(80),
  client: z.string().trim().min(2).max(120),
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]{0,5}$/, 'Use 1 to 6 capital letters or digits, starting with a letter'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#8b9dff'),
  sector: z.string().max(60).default(''),
  about: z.string().max(4000).default(''),
  frameworks: z.array(z.string()).min(1, 'Pick at least one framework').max(10),
  // Mark library controls that map to the chosen frameworks as applicable.
  startSoa: z.boolean().default(true),
  appetite: z.object({
    maxResidual: z.number().int().min(1).max(25),
    statement: z.string().max(2000).default(''),
    escalateTo: z.string().max(120).default('Board Risk Committee'),
  }),
  gates: z.record(z.boolean()),
  agents: z.record(AgentModelChoice),
  useCases: z.array(z.string().trim().min(3).max(200)).max(100).default([]),
  // v1.7.2: the tools the client uses, and a starting client workflow (a draft) if wanted.
  clientTools: z.array(z.string().max(40)).max(40).default([]),
  workflow: z
    .object({
      template: z.enum(['standard', 'm365', 'servicenow', 'google', 'minimal']),
      name: z.string().trim().min(2).max(80).optional(),
    })
    .nullable()
    .default(null),
  /** v1.7.4: switch on the Client tools and workflows module (client workflows, connected tools, client steps). */
  clientWorkflows: z.boolean().default(false),
});
export type NewEngagement = z.infer<typeof NewEngagement>;
