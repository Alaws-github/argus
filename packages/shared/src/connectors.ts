// Evidence connectors: read-only links to client systems.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Evidence connectors
// ---------------------------------------------------------------------------
// A read-only link to a client system: the harness fetches a report, export
// or file over HTTPS and files it as fingerprinted evidence. It never writes
// back. Credentials are encrypted and never shown again.
// azure_ad: Microsoft Entra app (tenant, client, secret); google_sa: a Google service account JSON key (v1.7.1).
export const CONNECTOR_AUTH = [
  'none',
  'bearer',
  'header',
  'basic',
  'azure_ad',
  'google_sa',
  'aws_sigv4',
  'azure_sas',
] as const;
/** How often a connector pulls by itself. */
export const CONNECTOR_SCHEDULES = ['manual', 'daily', 'weekly'] as const;
/** A connector as a person sets it up: the tool, address, sign-in and schedule. */
export const ConnectorInput = z.object({
  name: z.string().trim().min(3).max(120),
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'Use an http or https address')
    .refine((u) => !/[{}]|%7B|%7D/i.test(u), 'Replace the {…} parts of the example address with the real ids'),
  /** v1.7.1: which business tool this reads (BUSINESS_TOOLS id), or '' for a plain link. */
  tool: z.string().max(40).default(''),
  auth: z.enum(CONNECTOR_AUTH).default('none'),
  headerName: z.string().trim().max(80).default(''),
  secret: z.string().max(4000).optional(),
  controlId: z.string().uuid().nullable().default(null),
  schedule: z.enum(CONNECTOR_SCHEDULES).default('manual'),
  enabled: z.boolean().default(true),
});
export type ConnectorInput = z.infer<typeof ConnectorInput>;

/** A read-only link to a client system, as the API returns it (never with its credentials). */
export interface Connector {
  id: string;
  key: string; // CN-1
  name: string;
  url: string;
  auth: (typeof CONNECTOR_AUTH)[number];
  tool: string;
  headerName: string;
  secretSet: boolean;
  controlId: string | null;
  controlKey: string | null;
  schedule: (typeof CONNECTOR_SCHEDULES)[number];
  enabled: boolean;
  nextPullAt: string | null;
  lastPullAt: string | null;
  lastStatus: 'never' | 'added' | 'unchanged' | 'failed';
  lastMessage: string;
  pulls: number;
  createdBy: string;
}
