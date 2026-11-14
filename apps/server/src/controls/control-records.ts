// Turns control library and control register rows into API records.
import { type FrameworkRefs } from '@gh/shared';
// ------------------------------------------------------------------ mappers
export const toLibrary = (r: any) => ({
  id: r.id,
  code: r.code,
  title: r.title,
  objective: r.objective,
  domain: r.domain,
  type: r.type,
  frequency: r.frequency,
  evidenceExpected: r.evidence_expected,
  testProcedure: r.test_procedure,
  riskCategories: r.risk_categories,
  refs: r.refs,
  builtIn: r.built_in,
});
/** The query for controls with their card, library control and test and evidence counts. */
export const CONTROL_SELECT = `
  SELECT c.*, k.key AS card_key, l.code AS library_code,
    COALESCE((SELECT json_agg(cr.risk_id) FROM control_risks cr WHERE cr.control_id = c.id), '[]') AS risk_ids,
    COALESCE((SELECT json_agg('R-' || r.number ORDER BY r.number) FROM control_risks cr JOIN risks r ON r.id = cr.risk_id WHERE cr.control_id = c.id), '[]') AS risk_keys,
    (SELECT count(*)::int FROM tests t WHERE t.control_id = c.id) AS t_total,
    (SELECT count(*)::int FROM tests t WHERE t.control_id = c.id AND t.status = 'passed') AS t_passed,
    (SELECT count(*)::int FROM tests t WHERE t.control_id = c.id AND t.status = 'failed') AS t_failed,
    (SELECT count(*)::int FROM evidence e WHERE e.control_id = c.id OR e.test_id IN (SELECT id FROM tests WHERE control_id = c.id)) AS ev,
    (SELECT count(*)::int FROM issues i WHERE i.control_id = c.id AND i.status IN ('open','in_remediation','ready_for_retest')) AS open_issues
  FROM controls c LEFT JOIN cards k ON k.id = c.card_id LEFT JOIN control_library l ON l.id = c.library_id`;
/** A control row as an API record. */
export const toControl = (r: any) => ({
  id: r.id,
  key: `C-${r.number}`,
  engagementId: r.engagement_id,
  cardId: r.card_id,
  cardKey: r.card_key,
  libraryId: r.library_id,
  libraryCode: r.library_code,
  title: r.title,
  objective: r.objective,
  type: r.type,
  frequency: r.frequency,
  owner: r.owner,
  status: r.status,
  refs: r.framework_refs as FrameworkRefs,
  riskIds: r.risk_ids,
  riskKeys: r.risk_keys,
  tests: { total: r.t_total, passed: r.t_passed, failed: r.t_failed, open: r.t_total - r.t_passed - r.t_failed },
  evidence: r.ev,
  openIssues: r.open_issues,
});
