// Retrieval checks (v1.6): does the knowledge base find the right passage for a
// question? A fixed set of questions, worded the way a team member or an agent
// would ask them (not copied from the titles), each with the passages a good
// answer needs. Scored as recall at 5 and 10 (was a right passage in the top 5
// or 10?) and MRR (how high the first right one came), overall and per kind,
// with keyword search alone and with meaning search added when an embedding
// model is set. Shown on Checking the AI > Retrieval; `npm run test:rag` runs it.
import type { Db } from './db.js';
import { getEmbedder, search } from './kb.js';

export interface RetrievalCase { query: string; expect: string[]; kind: 'framework' | 'control' | 'methodology' }
export const RETRIEVAL_SET: RetrievalCase[] = [
  { query: 'a person must be able to override or stop a high-risk system', expect: ['EU AI Act Art. 14', 'OVS-01', 'M-OVERSIGHT'], kind: 'framework' },
  { query: 'what logs must we keep of what the AI did', expect: ['EU AI Act Art. 12', 'MON-03'], kind: 'framework' },
  { query: 'training data quality and bias in datasets', expect: ['EU AI Act Art. 10', 'DAT-02'], kind: 'framework' },
  { query: 'staff need training to understand AI', expect: ['EU AI Act Art. 4', 'GOV-03'], kind: 'framework' },
  { query: 'tell customers they are talking to a bot', expect: ['EU AI Act Art. 50', 'TRN-01'], kind: 'framework' },
  { query: 'report a serious AI incident to the regulator', expect: ['EU AI Act Art. 73', 'MON-02'], kind: 'framework' },
  { query: 'assess impact on fundamental rights before deployment', expect: ['EU AI Act Art. 27', 'ISO/IEC 42001 6.1.4', 'RSK-03'], kind: 'framework' },
  { query: 'keep a list of all AI systems in the organisation', expect: ['NIST AI RMF GOVERN 1.6', 'RSK-01'], kind: 'framework' },
  { query: 'kill switch to deactivate a model that misbehaves', expect: ['NIST AI RMF MANAGE 2.4', 'OVS-02'], kind: 'framework' },
  { query: 'malicious instructions hidden in a document the chatbot reads', expect: ['OWASP LLM Top 10 LLM01', 'SEC-01'], kind: 'framework' },
  { query: 'an agent with too many permissions takes actions nobody approved', expect: ['OWASP LLM Top 10 LLM06', 'SEC-02', 'OVS-03', 'M-AGENTS'], kind: 'framework' },
  { query: 'sending customer data to a vendor overseas', expect: ['Jamaica DPA 2020 Transfers', 'DAT-04'], kind: 'framework' },
  { query: 'third party AI supplier checks and contract clauses', expect: ['ISO/IEC 42001 A.10.3', 'TPR-01'], kind: 'control' },
  { query: 'test whether outcomes differ between groups of applicants', expect: ['MOD-02'], kind: 'control' },
  { query: 'chatbot making up answers that are not in the source', expect: ['MOD-04'], kind: 'control' },
  { query: 'how long do we keep chat transcripts', expect: ['DAT-03'], kind: 'control' },
  { query: 'retest after the vendor upgrades the model', expect: ['MOD-03', 'TPR-02'], kind: 'control' },
  { query: 'cap on spending for API calls', expect: ['SEC-05'], kind: 'control' },
  { query: 'how many items should we sample when testing a control', expect: ['M-SAMPLING'], kind: 'methodology' },
  { query: 'is a screenshot good enough evidence', expect: ['M-EVIDENCE'], kind: 'methodology' },
  { query: 'how to decide if a use case is high or limited risk', expect: ['M-TIERS', 'RSK-02'], kind: 'methodology' },
  { query: 'what to put in a finding: condition, criteria, cause, effect', expect: ['M-FINDINGS'], kind: 'methodology' },
  { query: 'what should a new use case brief contain', expect: ['M-INTAKE'], kind: 'methodology' },
];

export interface RetrievalScore { mode: 'keyword' | 'hybrid'; recall5: number; recall10: number; mrr: number; perKind: Record<string, { recall5: number; n: number }>; misses: { query: string; expect: string[]; got: string[] }[] }
export interface RetrievalReport { cases: number; embedModel: string | null; scores: RetrievalScore[] }

async function score(db: Db, mode: 'keyword' | 'hybrid'): Promise<RetrievalScore> {
  let r5 = 0, r10 = 0, mrr = 0;
  const per: Record<string, { hit: number; n: number }> = {};
  const misses: RetrievalScore['misses'] = [];
  for (const c of RETRIEVAL_SET) {
    // Shared passages only, so the score doesn't depend on any one engagement's documents.
    const got = await search(db, null, c.query, { limit: 10, keywordOnly: mode === 'keyword', kinds: ['framework', 'control', 'methodology'] });
    const refs = got.map((p) => p.ref);
    const rank = refs.findIndex((r) => c.expect.includes(r));
    const k = (per[c.kind] ??= { hit: 0, n: 0 });
    k.n++;
    if (rank >= 0 && rank < 5) { r5++; k.hit++; }
    if (rank >= 0) { r10++; mrr += 1 / (rank + 1); } else misses.push({ query: c.query, expect: c.expect, got: refs.slice(0, 5) });
  }
  const n = RETRIEVAL_SET.length;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    mode, recall5: round(r5 / n), recall10: round(r10 / n), mrr: round(mrr / n),
    perKind: Object.fromEntries(Object.entries(per).map(([kind, v]) => [kind, { recall5: round(v.hit / v.n), n: v.n }])),
    misses,
  };
}

export async function evalRetrieval(db: Db): Promise<RetrievalReport> {
  const e = await getEmbedder(db).catch(() => null);
  const scores = [await score(db, 'keyword')];
  if (e) scores.push(await score(db, 'hybrid'));
  return { cases: RETRIEVAL_SET.length, embedModel: e ? e.model.replace(/^[0-9a-f-]{36}:/, '') : null, scores };
}
