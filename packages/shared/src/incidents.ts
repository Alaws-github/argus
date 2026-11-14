// Incidents and their regulatory notification clocks.
import { z } from 'zod';
import { Severity } from './testing.js';

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------
// Something that went wrong with a live AI system: a harmful output, a data
// leak, an outage. Each one tracks who must be told and by when.
export const INCIDENT_STATUSES = ['open', 'contained', 'resolved', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

// Notification clocks, counted from when the organisation became aware.
// EU AI Act Art. 73 (serious incidents) and the Jamaica DPA 2020 (breaches).
export const NOTIFY_CLOCKS = {
  ai_act_serious: {
    label: 'EU AI Act serious incident: market surveillance authority',
    hours: 15 * 24,
    to: 'Market surveillance authority',
  },
  ai_act_widespread: {
    label: 'EU AI Act widespread infringement or critical infrastructure',
    hours: 2 * 24,
    to: 'Market surveillance authority',
  },
  ai_act_death: { label: 'EU AI Act incident involving a death', hours: 10 * 24, to: 'Market surveillance authority' },
  jdpa_breach: {
    label: 'Jamaica DPA personal data breach: Information Commissioner',
    hours: 72,
    to: 'Information Commissioner',
  },
  data_subjects: { label: 'People affected by a personal data breach', hours: 72, to: 'Affected people' },
  hipaa_breach: {
    label: 'HIPAA breach of unsecured health information: affected people',
    hours: 60 * 24,
    to: 'Affected people (and HHS)',
  },
  internal: { label: 'Internal escalation (your own policy)', hours: 24, to: 'Board Risk Committee' },
} as const;
export type NotifyClock = keyof typeof NOTIFY_CLOCKS;

export const NewIncident = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().max(4000).default(''),
  severity: Severity.default('high'),
  occurredAt: z.string().nullable().default(null),
  awareAt: z.string().min(10),
  inventoryId: z.string().uuid().nullable().default(null),
  cardId: z.string().uuid().nullable().default(null),
  owner: z.string().max(120).default(''),
  clocks: z.array(z.enum(Object.keys(NOTIFY_CLOCKS) as [NotifyClock, ...NotifyClock[]])).default([]),
});
export type NewIncident = z.infer<typeof NewIncident>;

export interface IncidentNotice {
  clock: NotifyClock;
  to: string;
  due: string;
  sentAt: string | null;
  sentBy: string | null;
  reference: string;
}
export interface IncidentEvent {
  at: string;
  by: string;
  text: string;
}
export interface Incident {
  id: string;
  key: string; // INC-1
  engagementId: string;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  occurredAt: string | null;
  awareAt: string;
  inventoryId: string | null;
  inventoryName: string | null;
  cardId: string | null;
  cardKey: string | null;
  owner: string;
  notices: IncidentNotice[];
  timeline: IncidentEvent[];
  rootCause: string;
  lessons: string;
  issueKeys: string[];
  reportedBy: string;
  createdAt: string;
  closedBy: string | null;
  closedAt: string | null;
}
