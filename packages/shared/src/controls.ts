// The control library, the control register and framework references.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Control library and register
// ---------------------------------------------------------------------------
export const CONTROL_DOMAINS = [
  'governance',
  'risk',
  'data',
  'model',
  'security',
  'oversight',
  'transparency',
  'third_party',
  'monitoring',
] as const;
export type ControlDomain = (typeof CONTROL_DOMAINS)[number];
export const DOMAIN_LABELS: Record<ControlDomain, string> = {
  governance: 'Governance and accountability',
  risk: 'Risk and impact assessment',
  data: 'Data governance and privacy',
  model: 'Model testing and validation',
  security: 'Security',
  oversight: 'Human oversight',
  transparency: 'Transparency',
  third_party: 'Third parties',
  monitoring: 'Monitoring and incidents',
};

export interface FrameworkRefs {
  nistAiRmf?: string[];
  iso42001?: string[];
  nistCsf?: string[];
  coso?: string[];
  euAiAct?: string[];
  jdpa?: string[];
  owasp?: string[];
  fdaGmlp?: string[]; // v1.7.3: FDA Good Machine Learning Practice principles and AI device guidance
  hipaa?: string[]; // v1.7.3: HIPAA Privacy, Security and Breach rules, and HHS health AI rules (45 CFR)
}

export const FRAMEWORK_LABELS: Record<keyof FrameworkRefs, string> = {
  nistAiRmf: 'NIST AI RMF',
  iso42001: 'ISO/IEC 42001',
  nistCsf: 'NIST CSF 2.0',
  coso: 'COSO',
  euAiAct: 'EU AI Act',
  jdpa: 'Jamaica DPA',
  owasp: 'OWASP',
  fdaGmlp: 'FDA GMLP',
  hipaa: 'HIPAA',
};

export interface LibraryControl {
  id: string;
  code: string;
  title: string;
  objective: string;
  domain: ControlDomain;
  type: 'preventive' | 'detective' | 'corrective';
  frequency: string;
  evidenceExpected: string;
  testProcedure: string;
  riskCategories: string[];
  refs: FrameworkRefs;
  builtIn: boolean;
}

// How a control works: stops a problem, spots it, or fixes it after.
export const ControlType = z.enum(['preventive', 'detective', 'corrective']);
export const ControlStatus = z.enum(['proposed', 'designed', 'operating', 'failed']);
export type ControlStatus = z.infer<typeof ControlStatus>;

export interface EngagementControl {
  id: string;
  key: string;
  engagementId: string;
  cardId: string | null;
  cardKey: string | null;
  libraryId: string | null;
  libraryCode: string | null;
  title: string;
  objective: string;
  type: string;
  frequency: string;
  owner: string;
  status: ControlStatus;
  refs: FrameworkRefs;
  riskIds: string[];
  riskKeys: string[];
  tests: { total: number; passed: number; failed: number; open: number };
  evidence: number;
  openIssues: number;
}

export const ControlInput = z.object({
  title: z.string().trim().min(3).max(200),
  objective: z.string().max(2000).default(''),
  type: z.enum(['preventive', 'detective', 'corrective']).default('preventive'),
  frequency: z.string().max(60).default('per change'),
  owner: z.string().max(120).default(''),
  status: ControlStatus.optional(),
  libraryId: z.string().uuid().nullable().optional(),
  cardId: z.string().uuid().nullable().optional(),
  riskIds: z.array(z.string().uuid()).default([]),
});

export interface Obligation {
  id: string;
  source: string;
  ref: string;
  title: string;
  summary: string;
  libraryCodes: string[];
}

// What the Control Designer returns.
export const ControlDesign = z.object({
  controls: z
    .array(
      z.object({
        libraryCode: z.string().max(20).nullable(),
        title: z.string().min(3).max(200),
        objective: z.string().max(800),
        owner: z.string().max(120),
        riskTitles: z.array(z.string().max(200)).min(1),
        testApproach: z.string().max(800),
        sources: z.array(z.string().max(12)).max(6).default([]),
      }),
    )
    .min(1)
    .max(16),
  gaps: z.array(z.string().max(300)).max(8),
  sourcePassages: z.array(z.any()).default([]),
});
export type ControlDesign = z.infer<typeof ControlDesign>;
