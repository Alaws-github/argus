// Turns control test and evidence rows into API records.
import { toIso } from '../core/format.js';
export const TEST_SELECT = `
  SELECT t.*, c.number AS control_number, c.title AS control_title,
    (SELECT count(*)::int FROM evidence e WHERE e.test_id = t.id) AS ev
  FROM tests t JOIN controls c ON c.id = t.control_id`;
export const toTest = (r: any) => ({
  id: r.id,
  key: `T-${r.number}`,
  engagementId: r.engagement_id,
  controlId: r.control_id,
  controlKey: `C-${r.control_number}`,
  controlTitle: r.control_title,
  kind: r.kind,
  title: r.title,
  procedure: r.procedure,
  population: r.population,
  sampleSize: r.sample_size,
  expected: r.expected,
  actual: r.actual,
  exceptions: r.exceptions,
  status: r.status,
  preparedBy: r.prepared_by,
  preparedAt: toIso(r.prepared_at),
  reviewedBy: r.reviewed_by,
  reviewedAt: toIso(r.reviewed_at),
  evidence: r.ev,
  createdAt: toIso(r.created_at),
  draft: r.draft ?? null,
});
export const toEvidence = (r: any) => ({
  id: r.id,
  key: `E-${r.number}`,
  engagementId: r.engagement_id,
  title: r.title,
  kind: r.kind,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  sha256: r.sha256,
  url: r.url,
  note: r.note,
  source: r.source,
  collectedBy: r.collected_by,
  collectedAt: toIso(r.collected_at),
  controlId: r.control_id,
  testId: r.test_id,
  verified: null as boolean | null,
  // What the harness could read of the file, for agents and search.
  readNote: r.text_note ?? null,
  readable: !!r.text_content,
});
