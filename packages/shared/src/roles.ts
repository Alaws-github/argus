// People, roles and permissions, including segregation of duties.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// People, roles, segregation of duties
// ---------------------------------------------------------------------------
export const ROLES = ['admin', 'lead', 'reviewer', 'preparer', 'viewer'] as const;
/** A person's role: admin, lead, reviewer, preparer or viewer. */
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/** Each role in words. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  lead: 'Engagement lead',
  reviewer: 'Reviewer',
  preparer: 'Preparer',
  viewer: 'Viewer',
};

/** What each role can do, in one line. */
export const ROLE_HINTS: Record<Role, string> = {
  admin: 'Everything, including users, models and workspace settings',
  lead: 'Runs engagements: settings, gates, risk acceptance, report sign-off',
  reviewer: 'Approves gates and reviews tests prepared by someone else',
  preparer: 'Adds use cases, controls, tests, evidence and issues',
  viewer: 'Reads everything, changes nothing',
};

/** Something a role may do (prepare, approve, manage the engagement and so on). */
export type Permission =
  | 'read'
  | 'prepare' // create and edit working items
  | 'approve' // gate approvals, test review
  | 'accept_risk'
  | 'sign_off_report'
  | 'manage_engagement'
  | 'manage_agents'
  | 'manage_models'
  | 'manage_users';

const P: Record<Role, Permission[]> = {
  admin: [
    'read',
    'prepare',
    'approve',
    'accept_risk',
    'sign_off_report',
    'manage_engagement',
    'manage_agents',
    'manage_models',
    'manage_users',
  ],
  lead: ['read', 'prepare', 'approve', 'accept_risk', 'sign_off_report', 'manage_engagement', 'manage_agents'],
  reviewer: ['read', 'prepare', 'approve'],
  preparer: ['read', 'prepare'],
  viewer: ['read'],
};
/** Whether a role has a permission. */
export const can = (role: Role | undefined, p: Permission) => !!role && P[role].includes(p);

/** A person with an account, as the API returns them. */
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  // Names this person used before; their past approvals carry those names.
  formerNames: string[];
  /** Set while an admin is acting as this person: the admin who really is signed in. */
  realUser?: { id: string; name: string; email: string } | null;
}
