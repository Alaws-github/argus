// Evidence connectors: read-only pulls from a client's systems. A connector
// fetches one address (a report, an export, a file) over HTTP(S), stores what
// comes back in the evidence vault with its SHA-256 fingerprint, reads its
// text for the agents, and links it to a control. It only ever sends GET.
//
// Guarding the server: by default a connector may not reach this machine or
// a private network (so a connector can't be used to probe internal systems).
// An admin can allow that for a client system on the local network.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import type { Connector } from '@gh/shared';
import { DATA_DIR, type Db } from './db.js';
import { logAudit } from './audit.js';
import { decrypt } from './crypto.js';
import { extract } from './extract.js';
import { putEvidence } from './storage.js';
import { indexEvidence, scheduleEmbedding } from './kb.js';
import { emit } from './realtime.js';
import { getSettings } from './store.js';

const MAX_BYTES = 10 * 1024 * 1024;
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export const CONNECTOR_SELECT = `SELECT n.*, c.number AS control_number FROM connectors n LEFT JOIN controls c ON c.id = n.control_id`;
export const toConnector = (r: any): Connector => ({
  id: r.id, key: `CN-${r.number}`, name: r.name, url: r.url, auth: r.auth, headerName: r.header_name, secretSet: !!r.secret_enc,
  controlId: r.control_id, controlKey: r.control_number ? `C-${r.control_number}` : null, schedule: r.schedule, enabled: r.enabled,
  nextPullAt: iso(r.next_pull_at), lastPullAt: iso(r.last_pull_at), lastStatus: r.last_status, lastMessage: r.last_message, pulls: r.pulls, createdBy: r.created_by,
});

function privateAddress(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
    return false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function checkAddress(url: URL, allowPrivate: boolean) {
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https addresses can be used');
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(privateAddress)) {
    throw new Error(`${url.hostname} is on this machine or a private network. An admin can allow that under Settings > General if it is a client system on your network.`);
  }
}

function authHeaders(r: any): Record<string, string> {
  if (r.auth === 'none' || !r.secret_enc) return {};
  const secret = decrypt(r.secret_enc);
  if (r.auth === 'bearer') return { authorization: `Bearer ${secret}` };
  if (r.auth === 'basic') return { authorization: `Basic ${Buffer.from(secret).toString('base64')}` };
  return { [r.header_name || 'x-api-key']: secret };
}

const extFor = (mime: string) =>
  mime.includes('json') ? 'json' : mime.includes('csv') ? 'csv' : mime.includes('pdf') ? 'pdf' : mime.includes('spreadsheetml') ? 'xlsx' : mime.includes('wordprocessingml') ? 'docx' : mime.includes('html') ? 'html' : 'txt';

// Fetch, following up to three redirects, checking every address on the way.
async function fetchChecked(start: string, headers: Record<string, string>, allowPrivate: boolean) {
  let url = new URL(start);
  for (let hop = 0; hop < 4; hop++) {
    await checkAddress(url, allowPrivate);
    const res = await fetch(url, { method: 'GET', headers: { accept: '*/*', 'user-agent': 'ARGUS-EvidenceConnector', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url.hostname}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new Error('The file is over 10 MB');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('The file is over 10 MB');
    return { buf, mime: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim(), disposition: res.headers.get('content-disposition') ?? '', url };
  }
  throw new Error('Too many redirects');
}

export async function pull(db: Db, connectorId: string, actor: string): Promise<Connector> {
  const { rows } = await db.query(`SELECT * FROM connectors WHERE id = $1`, [connectorId]);
  const r = rows[0];
  if (!r) throw Object.assign(new Error('Connector not found'), { status: 404 });
  if (!r.enabled) throw Object.assign(new Error('This connector is switched off'), { status: 409 });
  const allowPrivate = (await getSettings(db)).connectorsAllowPrivate;
  const key = `CN-${r.number}`;
  try {
    const got = await fetchChecked(r.url, authHeaders(r), allowPrivate);
    const hash = createHash('sha256').update(got.buf).digest('hex');
    if (hash === r.last_sha256) {
      await db.tx(async (q) => {
        await q.query(`UPDATE connectors SET last_pull_at = now(), last_status = 'unchanged', last_message = $2, pulls = pulls + 1 WHERE id = $1`, [r.id, 'Same content as the last pull; no new evidence added']);
        await logAudit(q, actor, 'connector.pulled', `connector:${key}`, { url: r.url, sha256: hash, unchanged: true });
      });
    } else {
      const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(got.disposition)?.[1];
      const fromPath = decodeURIComponent(got.url.pathname.split('/').pop() || '');
      const filename = (fromHeader || (/\.\w{2,5}$/.test(fromPath) ? fromPath : `${r.name.replace(/[^\w-]+/g, '-').toLowerCase()}.${extFor(got.mime)}`)).slice(0, 180);
      await putEvidence(hash, got.buf);
      const read = await extract(got.buf, filename, got.mime);
      const title = `${r.name}, pulled ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const ev = await db.tx(async (q) => {
        const { rows: ins } = await q.query(
          `INSERT INTO evidence (engagement_id, title, kind, filename, mime, size, sha256, source, collected_by, control_id, text_content, text_note, connector_id)
           VALUES ($1,$2,'file',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [r.engagement_id, title, filename, got.mime, got.buf.length, hash, `${key} ${r.url}`, `${key} (${actor})`, r.control_id, read?.text || null, read?.note ?? null, r.id],
        );
        await q.query(`UPDATE connectors SET last_pull_at = now(), last_status = 'added', last_message = $2, last_sha256 = $3, pulls = pulls + 1 WHERE id = $1`, [r.id, `Added E-${ins[0].number} (${got.buf.length < 1024 ? `${got.buf.length} bytes` : `${(got.buf.length / 1024).toFixed(1)} KB`})`, hash]);
        await logAudit(q, actor, 'connector.pulled', `connector:${key}`, { url: r.url, evidence: `E-${ins[0].number}`, sha256: hash, bytes: got.buf.length, read: read?.note ?? null });
        return ins[0];
      });
      await indexEvidence(db, ev).catch(() => {});
      scheduleEmbedding(db);
      emit('evidence', { engagementId: r.engagement_id });
    }
  } catch (e: any) {
    const msg = String(e?.cause?.code ?? e?.message ?? e).slice(0, 300);
    await db.tx(async (q) => {
      await q.query(`UPDATE connectors SET last_pull_at = now(), last_status = 'failed', last_message = $2, pulls = pulls + 1 WHERE id = $1`, [r.id, msg]);
      await logAudit(q, actor, 'connector.failed', `connector:${key}`, { url: r.url, error: msg });
    });
  }
  const { rows: out } = await db.query(`${CONNECTOR_SELECT} WHERE n.id = $1`, [r.id]);
  return toConnector(out[0]);
}

// Pull every scheduled connector that is due. Called by the monitoring tick.
export async function pullDue(db: Db) {
  const { rows } = await db.query(
    `SELECT n.id, n.schedule FROM connectors n JOIN engagements e ON e.id = n.engagement_id
     WHERE n.enabled AND n.schedule <> 'manual' AND n.next_pull_at <= now() AND e.archived_at IS NULL AND NOT e.paused`);
  for (const c of rows) {
    const next = new Date(Date.now() + (c.schedule === 'weekly' ? 7 : 1) * 864e5).toISOString();
    await db.query(`UPDATE connectors SET next_pull_at = $2 WHERE id = $1`, [c.id, next]);
    await pull(db, c.id, 'Connector schedule').catch((e) => console.warn(`[connector] ${e.message}`));
  }
}
