// The API router: /health, then every feature's routes, registered in the order they were
// before v1.7.6 (Express matches routes in order). Each feature folder has its own *-routes.ts.
import { AGENT_ROLES } from '@gh/shared';
import { Router } from 'express';
import { agentRoutes } from './agents/agent-routes.js';
import { killSwitchRoutes } from './agents/kill-switch-routes.js';
import { providerRoutes } from './ai/provider-routes.js';
import { auditRoutes } from './audit/audit-routes.js';
import { boardRoutes } from './board/board-routes.js';
import { runRoutes } from './board/run-routes.js';
import { controlRoutes } from './controls/control-routes.js';
import { libraryRoutes } from './controls/library-routes.js';
import { soaRoutes } from './controls/soa-routes.js';
import { traceabilityRoutes } from './controls/traceability-routes.js';
import { engagementRoutes } from './engagements/engagement-routes.js';
import { overviewRoutes } from './engagements/overview-routes.js';
import { alertRoutes } from './evals/alert-routes.js';
import { evalRoutes } from './evals/eval-routes.js';
import { inventoryRoutes } from './inventory/inventory-routes.js';
import { issueRoutes } from './issues/issue-routes.js';
import { assessmentRoutes } from './reporting/assessment-routes.js';
import { reportRoutes } from './reporting/report-routes.js';
import { riskRoutes } from './risks/risk-routes.js';
import { settingsRoutes } from './settings/settings-routes.js';
import { evidenceRoutes } from './testing/evidence-routes.js';
import { testRoutes } from './testing/test-routes.js';
import { archiveRoutes } from './engagements/archive.js';
import { clientStepRoutes } from './integrations/client-steps.js';
import { actorOf, wrap } from './core/http.js';
import type { Db } from './core/db.js';
import { harmonizeRoutes } from './controls/harmonize.js';
import { ingestTokenRoutes } from './integrations/ingest.js';
import { outboundRoutes } from './integrations/outbound.js';
import { requirementRoutes } from './controls/requirements.js';
import { accessRoutes } from './auth/access-routes.js';
import { assistantRoutes } from './assistant/assistant-routes.js';
import { authRoutes } from './auth/auth-routes.js';
import { connectorRoutes } from './integrations/connector-routes.js';
import { incidentRoutes } from './incidents/incident-routes.js';
import { kbRoutes } from './knowledge/kb-routes.js';
import { planRoutes } from './agents/plan-routes.js';
import { testingRoutes } from './agent-testing/agent-testing-routes.js';
import { workflowRoutes } from './integrations/workflow-routes.js';
import { ssoRoutes } from './auth/sso.js';

// No sign-in yet: the web app sends the reviewer's name. Add real auth before
// this leaves a laptop (see README, "Before you put it on a server").
// The signed-in person's name is what approvals and the audit trail record.

export function apiRouter(db: Db) {
  const r = Router();

  // runtime: 'live' when any enabled, built agent is on a model provider rather
  // than the offline rules.
  r.get(
    '/health',
    wrap(async (_req, res) => {
      const { rows } = await db.query(
        `SELECT a.role, a.model, p.type, p.name FROM agents a LEFT JOIN providers p ON p.id = a.provider_id WHERE a.enabled`,
      );
      const live = rows.filter(
        (x: any) => AGENT_ROLES[x.role as keyof typeof AGENT_ROLES]?.built && x.type && x.type !== 'rules',
      );
      res.json({
        ok: true,
        db: db.kind,
        runtime: live.length ? 'live' : 'dry-run',
        model: live[0] ? `${live[0].model} on ${live[0].name}` : 'rules-v1',
      });
    }),
  );

  // Each feature registers its own routes. The order matters only where two paths could match the same request.
  engagementRoutes(r, db, actorOf, wrap);
  boardRoutes(r, db, actorOf, wrap);
  runRoutes(r, db, actorOf, wrap);
  riskRoutes(r, db, actorOf, wrap);
  overviewRoutes(r, db, actorOf, wrap);
  auditRoutes(r, db, actorOf, wrap);
  settingsRoutes(r, db, actorOf, wrap);
  providerRoutes(r, db, actorOf, wrap);
  agentRoutes(r, db, actorOf, wrap);
  authRoutes(r, db, wrap);
  libraryRoutes(r, db, actorOf, wrap);
  soaRoutes(r, db, actorOf, wrap);
  controlRoutes(r, db, actorOf, wrap);
  inventoryRoutes(r, db, actorOf, wrap);
  testRoutes(r, db, actorOf, wrap);
  evidenceRoutes(r, db, actorOf, wrap);
  issueRoutes(r, db, actorOf, wrap);
  traceabilityRoutes(r, db, actorOf, wrap);
  evalRoutes(r, db, actorOf, wrap);
  alertRoutes(r, db, actorOf, wrap);
  assessmentRoutes(r, db, actorOf, wrap);
  reportRoutes(r, db, actorOf, wrap);
  killSwitchRoutes(r, db, actorOf, wrap);
  archiveRoutes(r, db, actorOf, wrap);
  kbRoutes(r, db, actorOf, wrap);
  testingRoutes(r, db, actorOf, wrap);
  assistantRoutes(r, db, actorOf, wrap);
  incidentRoutes(r, db, actorOf, wrap);
  planRoutes(r, db, actorOf, wrap);
  workflowRoutes(r, db, actorOf, wrap);
  connectorRoutes(r, db, actorOf, wrap);
  harmonizeRoutes(r, db, actorOf, wrap);
  ingestTokenRoutes(r, db, actorOf, wrap);
  outboundRoutes(r, db, actorOf, wrap);
  clientStepRoutes(r, db, actorOf, wrap);
  requirementRoutes(r, db, actorOf, wrap);
  accessRoutes(r, db, actorOf, wrap);
  ssoRoutes(r, db, actorOf, wrap);
  return r;
}
