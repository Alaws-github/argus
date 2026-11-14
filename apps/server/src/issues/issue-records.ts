// Turns issue rows into API records (keys, status, severity, linked records).
import { toDay, toIso } from '../core/format.js';
/** The query for issues with their control, test and use case. */
export const ISSUE_SELECT = `
  SELECT i.*, c.number AS control_number, t.number AS test_number, k.key AS card_key
  FROM issues i LEFT JOIN controls c ON c.id = i.control_id LEFT JOIN tests t ON t.id = i.test_id LEFT JOIN cards k ON k.id = i.card_id`;
/** An issue row as an API record. */
export const toIssue = (r: any) => {
  const due = toDay(r.due_date);
  const openish = ['open', 'in_remediation', 'ready_for_retest'].includes(r.status);
  return {
    id: r.id,
    key: `I-${r.number}`,
    engagementId: r.engagement_id,
    externalRef: r.external_ref ?? null,
    title: r.title,
    description: r.description,
    severity: r.severity,
    status: r.status,
    owner: r.owner,
    dueDate: due,
    overdue: !!(openish && due && due < new Date().toISOString().slice(0, 10)),
    managementResponse: r.management_response,
    controlId: r.control_id,
    controlKey: r.control_number ? `C-${r.control_number}` : null,
    testId: r.test_id,
    testKey: r.test_number ? `T-${r.test_number}` : null,
    evalRunId: r.eval_run_id,
    cardId: r.card_id,
    cardKey: r.card_key,
    createdBy: r.created_by,
    createdAt: toIso(r.created_at),
    closedAt: toIso(r.closed_at),
    closedBy: r.closed_by,
  };
};
