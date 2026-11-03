import './env.js';
// Drops every table and reseeds the demo engagement.
import { getDb, migrate } from './db.js';
import { ensureBaseline, seed } from './seed.js';

const db = await getDb();
await db.exec(`
  DROP TABLE IF EXISTS assessments, eval_runs, eval_cases, eval_suites, issues, evidence, tests, inventory, soa, control_risks,
    obligations, run_events, runs, controls, control_library, risks, agents, cards, engagements, providers, audit_log, settings,
    sessions, users CASCADE;
  DROP SEQUENCE IF EXISTS run_seq, risk_seq, control_seq, inventory_seq, test_seq, evidence_seq, issue_seq, suite_seq;
`);
await migrate(db);
await seed(db);
await ensureBaseline(db);
console.log(`[reset] ${db.kind} database rebuilt with the Client Zero demo`);
await db.close();
