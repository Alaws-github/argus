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

// A hosted database (the live site's Neon database, say) is wiped only on purpose.
const url = process.env.DATABASE_URL;
if (url && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) && process.env.RESET_HOSTED !== 'yes') {
  console.error('[reset] DATABASE_URL points at a hosted database. Resetting would delete everything on that site.');
  console.error('[reset] For local work, close this terminal and open a new one without DATABASE_URL. To really wipe it, set RESET_HOSTED=yes.');
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
  DROP TABLE IF EXISTS engagement_members, connectors, monitor_alerts, incidents, assistant_messages, assistant_conversations, ai_spend, judge_calibrations, judge_labels, golden_runs, golden_cases, kb_chunks, kb_sources, assessments, eval_runs, eval_cases, eval_suites, issues, evidence, tests, inventory, soa, control_risks,
    obligations, run_events, runs, controls, control_library, risks, agents, cards, engagements, providers, audit_log, settings,
    sessions, users CASCADE;
  DROP SEQUENCE IF EXISTS run_seq, risk_seq, control_seq, inventory_seq, test_seq, evidence_seq, issue_seq, suite_seq, kb_seq, golden_seq, golden_run_seq, judge_label_seq, judge_cal_seq, incident_seq, alert_seq, connector_seq;
`);
await migrate(db);
await seed(db);
await ensureBaseline(db);
console.log(`[reset] ${db.kind} database rebuilt with the Client Zero demo. Open the app and create the first admin.`);
cancelEmbedding();
await db.close();
