// The readiness assessment areas and scores.

// ---------------------------------------------------------------------------
// Readiness assessment
// ---------------------------------------------------------------------------
// Areas follow the NIST AI RMF functions, split where ISO/IEC 42001 and the
// Jamaica DPA give a separate body of requirements.
export const ASSESSMENT_AREAS = [
  { id: 'govern', name: 'Governance and accountability', basis: 'NIST AI RMF Govern; ISO/IEC 42001 clauses 5 and 7' },
  { id: 'map', name: 'Inventory and risk classification', basis: 'NIST AI RMF Map; ISO/IEC 42001 6.1' },
  { id: 'controls', name: 'Control design', basis: 'COSO control activities; ISO/IEC 42001 Annex A' },
  { id: 'measure', name: 'Testing and validation', basis: 'NIST AI RMF Measure; ISO/IEC 42001 9.1' },
  { id: 'security', name: 'AI security', basis: 'OWASP LLM and Agentic Top 10; NIST CSF 2.0' },
  { id: 'privacy', name: 'Data protection', basis: 'Jamaica DPA 2020; ISO/IEC 42001 A.7' },
  { id: 'manage', name: 'Issue management and monitoring', basis: 'NIST AI RMF Manage; ISO/IEC 42001 clause 10' },
] as const;
/** One readiness assessment area. */
export type AreaId = (typeof ASSESSMENT_AREAS)[number]['id'];

// A common capability-maturity scale.
export const MATURITY = ['', 'Initial', 'Repeatable', 'Defined', 'Managed', 'Optimising'] as const;
