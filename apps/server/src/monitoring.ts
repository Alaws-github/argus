// Monitoring: runs evaluation suites on a schedule and raises an alert when a
// run falls below its threshold, drops against its recent baseline (drift), or
// fails. Alerts are for people: someone acknowledges each one, and can turn it
// into an issue. Scheduled runs respect the engagement's pause, archiving and
// the monthly spend cap.
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { emit } from './realtime.js';
import { getSettings, monthSpend } from './store.js';
import { pullDue } from './connectors.js';
import { dispatchOutbound } from './outbound.js';
import { checkDueSteps } from './client-steps.js';

export const MONITOR_TICK_MS = Number(process.env.MONITOR_TICK_MS || 15_000);
const PERIOD_MS = { daily: 864e5, weekly: 7 * 864e5 } as const;
let busy = false;

// Called after every completed or failed run, scheduled or not.
export async function checkRun(db: Db, runId: string) {
  const { rows } = await db.query(
    `SELECT r.*, s.engagement_id, s.name, s.threshold_pct, s.drift_drop_pct FROM eval_runs r JOIN eval_suites s ON s.id = r.suite_id WHERE r.id = $1`, [runId]);
  const r = rows[0];
  if (!r) return;
  const alerts: { kind: string; message: string; pass: number | null; base: number | null }[] = [];
  if (r.status === 'failed') {
    alerts.push({ kind: 'run_failed', message: `${r.name} didn't finish: ${r.error ?? 'unknown error'}`, pass: null, base: null });
  } else if (r.status === 'completed' && r.total) {
    const pct = Math.round((r.passed / r.total) * 100);
    const { rows: prev } = await db.query(
      `SELECT passed, total FROM eval_runs WHERE suite_id = $1 AND status = 'completed' AND id <> $2 AND total > 0 ORDER BY started_at DESC LIMIT 3`, [r.suite_id, r.id]);
    const base = prev.length ? Math.round(prev.reduce((n: number, p: any) => n + (p.passed / p.total) * 100, 0) / prev.length) : null;
    if (pct < r.threshold_pct) alerts.push({ kind: 'below_threshold', message: `${r.name} passed ${pct}%, below its ${r.threshold_pct}% threshold`, pass: pct, base });
    if (base !== null && base - pct >= r.drift_drop_pct) alerts.push({ kind: 'drift', message: `${r.name} dropped to ${pct}% from a recent average of ${base}% (alert at a ${r.drift_drop_pct}-point drop)`, pass: pct, base });
  }
  for (const a of alerts) {
    await db.tx(async (q) => {
      const { rows: ins } = await q.query(
        `INSERT INTO monitor_alerts (engagement_id, suite_id, run_id, kind, message, pass_pct, baseline_pct) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (run_id, kind) DO NOTHING RETURNING number`,
        [r.engagement_id, r.suite_id, r.id, a.kind, a.message, a.pass, a.base]);
      if (ins[0]) await logAudit(q, 'Monitoring', 'monitor.alert', `alert:AL-${ins[0].number}`, { kind: a.kind, message: a.message });
    });
  }
  if (alerts.length) emit('alert', { engagementId: r.engagement_id });
}

export function nextRun(schedule: string, from = Date.now()) {
  const p = PERIOD_MS[schedule as keyof typeof PERIOD_MS];
  return p ? new Date(from + p).toISOString() : null;
}

// Start any suites that are due. runSuite is passed in to avoid an import cycle.
export function startMonitoring(db: Db, start: (suiteId: string, actor: string) => Promise<string | null>) {
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await pullDue(db).catch((e) => console.warn(`[connector] tick failed: ${e.message}`));
      await dispatchOutbound(db).catch((e) => console.warn(`[write-back] tick failed: ${e.message}`));
      await checkDueSteps(db).catch((e) => console.warn(`[client steps] tick failed: ${e.message}`));
      const { rows } = await db.query(
        `SELECT s.id, s.name, s.schedule, s.engagement_id, p.billed FROM eval_suites s JOIN engagements e ON e.id = s.engagement_id LEFT JOIN providers p ON p.id = s.provider_id
         WHERE s.schedule <> 'off' AND s.next_run_at <= now() AND e.archived_at IS NULL AND NOT e.paused`);
      if (!rows.length) return;
      const settings = await getSettings(db);
      const capped = settings.pauseAtCap && settings.spendCapUsd != null && (await monthSpend(db, settings.timeZone)) >= settings.spendCapUsd;
      for (const s of rows) {
        await db.query(`UPDATE eval_suites SET next_run_at = $2 WHERE id = $1`, [s.id, nextRun(s.schedule)]);
        if (capped && s.billed) {
          await logAudit(db, 'Monitoring', 'monitor.skipped', `eval:${s.name}`, { reason: 'Monthly spend cap reached' });
          continue;
        }
        await start(s.id, 'Monitoring').catch((e) => console.warn(`[monitor] ${s.name}: ${e.message}`));
      }
    } catch (e: any) {
      console.warn(`[monitor] tick failed: ${e.message}`);
    } finally {
      busy = false;
    }
  }, MONITOR_TICK_MS);
}
