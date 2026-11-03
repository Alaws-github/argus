import { createHash } from 'node:crypto';
import type { Queryable } from './db.js';
import { emit } from './realtime.js';

const SECRET_KEYS = /key|token|secret|password/i;

function scrub(detail: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : v;
  return out;
}

// Stable JSON: keys sorted, so the hash doesn't depend on insertion order.
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export function auditHash(prev: string, row: { at: string; actor: string; action: string; entity: string; detail: unknown }) {
  return createHash('sha256').update(`${prev}|${row.at}|${row.actor}|${row.action}|${row.entity}|${canon(row.detail)}`).digest('hex');
}

// Call inside the change's own transaction so the change and its record
// commit together or not at all. Each row is chained to the one before it,
// so editing or deleting a row breaks every hash after it.
export async function logAudit(
  q: Queryable,
  actor: string,
  action: string,
  entity: string,
  detail: Record<string, unknown> = {},
) {
  await q.query(`SELECT pg_advisory_xact_lock(424242)`).catch(() => undefined);
  const { rows: last } = await q.query(`SELECT hash FROM audit_log WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1`);
  const prev = last[0]?.hash ?? 'genesis';
  const at = new Date().toISOString();
  const clean = scrub(detail);
  const hash = auditHash(prev, { at, actor, action, entity, detail: clean });
  const { rows } = await q.query(
    `INSERT INTO audit_log (at, actor, action, entity, detail, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [at, actor, action, entity, JSON.stringify(clean), prev, hash],
  );
  emit('audit', { id: rows[0].id, at, actor, action, entity });
}

// Recompute the chain. Rows written before v0.3 have no hash and are skipped.
export async function verifyAudit(q: Queryable) {
  const { rows } = await q.query(`SELECT id, at, actor, action, entity, detail, prev_hash, hash FROM audit_log WHERE hash IS NOT NULL ORDER BY id`);
  let prev = 'genesis';
  for (const r of rows) {
    const at = r.at instanceof Date ? r.at.toISOString() : new Date(r.at).toISOString();
    const expect = auditHash(prev, { at, actor: r.actor, action: r.action, entity: r.entity, detail: r.detail });
    if (r.prev_hash !== prev || r.hash !== expect) {
      return { ok: false, checked: rows.length, brokenAt: Number(r.id), message: `Row ${r.id} doesn't match the chain: it was changed, or a row before it was removed` };
    }
    prev = r.hash;
  }
  return { ok: true, checked: rows.length, brokenAt: null, message: `All ${rows.length} entries verified` };
}
