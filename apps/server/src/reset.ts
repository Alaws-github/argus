import './env.js';
// Rebuilds the database with the Client Zero demo. Every account is removed,
// so the next visit shows "Create the first admin".
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, getDb, migrate } from './db.js';
import { ensureBaseline, seed } from './seed.js';
import { cancelEmbedding } from './kb.js';

// The embedded database allows one program at a time. Resetting it while the
// app is running damages it, so refuse.
const PORT = Number(process.env.PORT || 4300);
const running = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
if (running) {
  console.error(`[reset] The app is running on port ${PORT}. Stop it first (Ctrl+C in its terminal), then run npm run db:reset again.`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  // Embedded database: start from an empty folder, which also recovers one
  // that was damaged. Evidence files go too, since their records do.
  // data/secret.key is kept so saved model keys stay readable after a restore.
  for (const dir of ['pglite', 'evidence']) {
    const p = resolve(DATA_DIR, dir);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
}

const db = await getDb();
await db.exec(`
  DROP TABLE IF EXISTS ai_spend, judge_calibrations, judge_labels, golden_runs, golden_cases, kb_chunks, kb_sources, assessments, eval_runs, eval_cases, eval_suites, issues, evidence, tests, inventory, soa, control_risks,
    obligations, run_events, runs, controls, control_library, risks, agents, cards, engagements, providers, audit_log, settings,
    sessions, users CASCADE;
  DROP SEQUENCE IF EXISTS run_seq, risk_seq, control_seq, inventory_seq, test_seq, evidence_seq, issue_seq, suite_seq, kb_seq, golden_seq, golden_run_seq, judge_label_seq, judge_cal_seq;
`);
await migrate(db);
await seed(db);
await ensureBaseline(db);
console.log(`[reset] ${db.kind} database rebuilt with the Client Zero demo. Open the app and create the first admin.`);
cancelEmbedding();
await db.close();
