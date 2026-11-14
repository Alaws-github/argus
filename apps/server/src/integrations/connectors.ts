// Evidence connectors: read-only pulls from a client's systems. A connector
// fetches one address (a report, an export, a file) over HTTP(S), stores what
// comes back in the evidence vault with its SHA-256 fingerprint, reads its
// text for the agents, and links it to a control. It only ever sends GET.
//
// Guarding the server: by default a connector may not reach this machine or
// a private network (so a connector can't be used to probe internal systems).
// An admin can allow that for a client system on the local network.
import { createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { toolById, type Connector } from '@gh/shared';
import { SignJWT, importPKCS8 } from 'jose';
import type { Db } from '../core/db.js';
import { logAudit } from '../audit/audit.js';
import { decrypt } from '../core/crypto.js';
import { extract } from '../core/extract.js';
import { putEvidence } from '../core/storage.js';
import { indexEvidence, scheduleEmbedding } from '../knowledge/kb.js';
import { emit } from '../core/realtime.js';
import { getSettings } from '../settings/settings-store.js';
import { toIso } from '../core/format.js';

const MAX_BYTES = 10 * 1024 * 1024;
/** The query for connectors with their control. */
export const CONNECTOR_SELECT = `SELECT n.*, c.number AS control_number FROM connectors n LEFT JOIN controls c ON c.id = n.control_id`;
/** A connector row as an API record (never its credentials). */
export const toConnector = (r: any): Connector => ({
  id: r.id,
  key: `CN-${r.number}`,
  name: r.name,
  url: r.url,
  auth: r.auth,
  tool: r.tool ?? '',
  headerName: r.header_name,
  secretSet: !!r.secret_enc,
  controlId: r.control_id,
  controlKey: r.control_number ? `C-${r.control_number}` : null,
  schedule: r.schedule,
  enabled: r.enabled,
  nextPullAt: toIso(r.next_pull_at),
  lastPullAt: toIso(r.last_pull_at),
  lastStatus: r.last_status,
  lastMessage: r.last_message,
  pulls: r.pulls,
  createdBy: r.created_by,
});

function privateAddress(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
    return false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function checkAddress(url: URL, allowPrivate: boolean) {
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https addresses can be used');
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(privateAddress)) {
    throw new Error(
      `${url.hostname} is on this machine or a private network. An admin can allow that under Settings > General if it is a client system on your network.`,
    );
  }
}

// v1.7.1: sign-in for business tools. Microsoft 365 (Entra app, client
// credentials) and Google (service account) give a short-lived token from
// their identity service; the token request is the only POST a connector
// makes, and it goes to the identity service, never to the client's data.
// The token endpoints can be pointed elsewhere for tests (ARGUS_MS_TOKEN_URL,
// ARGUS_GOOGLE_TOKEN_URL).
const tokens = new Map<string, { token: string; until: number }>();
/** Checks a connector's sign-in secret has the parts its sign-in method needs. */
export function parseToolSecret(auth: string, secret: string): string | null {
  try {
    const j = JSON.parse(secret);
    if (auth === 'azure_ad')
      return j.tenantId && j.clientId && j.clientSecret ? null : 'Enter the tenant ID, client ID and client secret';
    if (auth === 'google_sa')
      return j.client_email && j.private_key
        ? null
        : 'Paste the whole service account JSON key (it has client_email and private_key)';
    if (auth === 'aws_sigv4')
      return j.accessKeyId && j.secretAccessKey && /^[a-z]{2}(-[a-z]+)+-\d$/.test(String(j.region ?? ''))
        ? null
        : 'Enter the access key ID, secret access key and region (for example us-east-1)';
  } catch {
    return auth === 'google_sa'
      ? 'Paste the whole service account JSON key'
      : auth === 'aws_sigv4'
        ? 'Enter the access key ID, secret access key and region'
        : 'Enter the tenant ID, client ID and client secret';
  }
  return null;
}
async function tokenFor(r: any, secret: string): Promise<string> {
  const scope =
    toolById(r.tool)?.read?.scope ??
    (r.auth === 'azure_ad' ? 'https://graph.microsoft.com/.default' : 'https://www.googleapis.com/auth/drive.readonly');
  const cacheKey = `${r.id}:${scope}:${createHash('sha256').update(secret).digest('hex').slice(0, 12)}`;
  const hit = tokens.get(cacheKey);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const j = JSON.parse(secret);
  let res: Response;
  if (r.auth === 'azure_ad') {
    const url = (
      process.env.ARGUS_MS_TOKEN_URL ?? 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token'
    ).replace('{tenant}', encodeURIComponent(j.tenantId));
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(20_000),
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: j.clientId,
        client_secret: j.clientSecret,
        scope,
      }),
    });
  } else {
    const aud = process.env.ARGUS_GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';
    const key = await importPKCS8(String(j.private_key), 'RS256');
    const assertion = await new SignJWT({ scope })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(j.client_email)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    res = await fetch(aud, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(20_000),
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const who = r.auth === 'azure_ad' ? 'Microsoft' : 'Google';
    throw new Error(
      `${who} refused the sign-in (${res.status}): ${String(body.error_description ?? body.error ?? 'no detail').slice(0, 160)}. Check the details and that an admin granted the read permissions.`,
    );
  }
  tokens.set(cacheKey, { token: body.access_token, until: Date.now() + Number(body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

// v1.7.3: AWS Signature Version 4 for a read (GET) from S3. The body is
// never signed (UNSIGNED-PAYLOAD, which S3 accepts), so only the address,
// the date and the key are in the signature.
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const rfc3986 = (v: string) =>
  encodeURIComponent(v).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
/** Signs an S3 GET with AWS Signature Version 4. */
export function sigV4(
  url: URL,
  k: { accessKeyId: string; secretAccessKey: string; region: string; sessionToken?: string },
  now = new Date(),
  service = 's3',
) {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-amz-date': amzDate,
  };
  if (k.sessionToken) headers['x-amz-security-token'] = k.sessionToken;
  const names = Object.keys(headers).sort();
  const query = [...url.searchParams.entries()]
    .map(([a, b]) => [rfc3986(a), rfc3986(b)])
    .sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1))
    .map(([a, b]) => `${a}=${b}`)
    .join('&');
  const path = (url.pathname || '/')
    .split('/')
    .map((seg) => rfc3986(decodeURIComponent(seg)))
    .join('/'); // S3: each segment encoded once
  const canonical = [
    'GET',
    path,
    query,
    names.map((n) => `${n}:${headers[n].trim()}\n`).join(''),
    names.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const scope = `${day}/${k.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + k.secretAccessKey, day), k.region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _host, ...send } = headers; // fetch sets Host itself, from the same URL
  return {
    ...send,
    authorization: `AWS4-HMAC-SHA256 Credential=${k.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

// v1.7.3: an Azure SAS token is kept encrypted and only added to the address when reading.
export function withSas(url: string, r: any): string {
  if (r.auth !== 'azure_sas' || !r.secret_enc) return url;
  const sas = decrypt(r.secret_enc).replace(/^\?/, '');
  return url + (url.includes('?') ? '&' : '?') + sas;
}

async function authHeaders(r: any, url?: URL): Promise<Record<string, string>> {
  if (r.auth === 'none' || r.auth === 'azure_sas' || !r.secret_enc) return {};
  const secret = decrypt(r.secret_enc);
  if (r.auth === 'aws_sigv4') return sigV4(url ?? new URL(r.url), JSON.parse(secret));
  if (r.auth === 'azure_ad' || r.auth === 'google_sa') return { authorization: `Bearer ${await tokenFor(r, secret)}` };
  if (r.auth === 'bearer') return { authorization: `Bearer ${secret}` };
  if (r.auth === 'basic') return { authorization: `Basic ${Buffer.from(secret).toString('base64')}` };
  return { [r.header_name || 'x-api-key']: secret };
}

const extFor = (mime: string) =>
  mime.includes('json')
    ? 'json'
    : mime.includes('csv')
      ? 'csv'
      : mime.includes('pdf')
        ? 'pdf'
        : mime.includes('spreadsheetml')
          ? 'xlsx'
          : mime.includes('wordprocessingml')
            ? 'docx'
            : mime.includes('html')
              ? 'html'
              : 'txt';

// Fetch, following up to three redirects, checking every address on the way.
async function fetchChecked(start: string, headers: Record<string, string>, allowPrivate: boolean) {
  let url = new URL(start);
  for (let hop = 0; hop < 4; hop++) {
    await checkAddress(url, allowPrivate);
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: '*/*', 'user-agent': 'ARGUS-EvidenceConnector', ...headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location')!, url);
      // A redirect to another site (Microsoft 365 sends file downloads to a signed link) never carries the credential.
      if (next.origin !== url.origin) headers = {};
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url.hostname}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new Error('The file is over 10 MB');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('The file is over 10 MB');
    return {
      buf,
      mime: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim(),
      disposition: res.headers.get('content-disposition') ?? '',
      url,
    };
  }
  throw new Error('Too many redirects');
}

// Read what a connector points at (used by pulls and by client step checks).
export async function readConnector(r: any, allowPrivate: boolean) {
  const target = withSas(r.url, r);
  return fetchChecked(target, await authHeaders(r, new URL(target)), allowPrivate);
}

/** Reads a connector once and files what it returns as evidence (rule 17), audited. */
export async function pull(db: Db, connectorId: string, actor: string): Promise<Connector> {
  const { rows } = await db.query(`SELECT * FROM connectors WHERE id = $1`, [connectorId]);
  const r = rows[0];
  if (!r) throw Object.assign(new Error('Connector not found'), { status: 404 });
  if (!r.enabled) throw Object.assign(new Error('This connector is switched off'), { status: 409 });
  const allowPrivate = (await getSettings(db)).connectorsAllowPrivate;
  const key = `CN-${r.number}`;
  try {
    const got = await readConnector(r, allowPrivate);
    const hash = createHash('sha256').update(got.buf).digest('hex');
    if (hash === r.last_sha256) {
      await db.tx(async (q) => {
        await q.query(
          `UPDATE connectors SET last_pull_at = now(), last_status = 'unchanged', last_message = $2, pulls = pulls + 1 WHERE id = $1`,
          [r.id, 'Same content as the last pull; no new evidence added'],
        );
        await logAudit(q, actor, 'connector.pulled', `connector:${key}`, { url: r.url, sha256: hash, unchanged: true });
      });
    } else {
      const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(got.disposition)?.[1];
      const fromPath = decodeURIComponent(got.url.pathname.split('/').pop() || '');
      const filename = (
        fromHeader ||
        (/\.\w{2,5}$/.test(fromPath)
          ? fromPath
          : `${r.name.replace(/[^\w-]+/g, '-').toLowerCase()}.${extFor(got.mime)}`)
      ).slice(0, 180);
      await putEvidence(hash, got.buf);
      const read = await extract(got.buf, filename, got.mime);
      const title = `${r.name}, pulled ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const ev = await db.tx(async (q) => {
        const { rows: ins } = await q.query(
          `INSERT INTO evidence (engagement_id, title, kind, filename, mime, size, sha256, source, collected_by, control_id, text_content, text_note, connector_id)
           VALUES ($1,$2,'file',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            r.engagement_id,
            title,
            filename,
            got.mime,
            got.buf.length,
            hash,
            `${key} ${r.url}`,
            `${key} (${actor})`,
            r.control_id,
            read?.text || null,
            read?.note ?? null,
            r.id,
          ],
        );
        await q.query(
          `UPDATE connectors SET last_pull_at = now(), last_status = 'added', last_message = $2, last_sha256 = $3, pulls = pulls + 1 WHERE id = $1`,
          [
            r.id,
            `Added E-${ins[0].number} (${got.buf.length < 1024 ? `${got.buf.length} bytes` : `${(got.buf.length / 1024).toFixed(1)} KB`})`,
            hash,
          ],
        );
        await logAudit(q, actor, 'connector.pulled', `connector:${key}`, {
          url: r.url,
          evidence: `E-${ins[0].number}`,
          sha256: hash,
          bytes: got.buf.length,
          read: read?.note ?? null,
        });
        return ins[0];
      });
      await indexEvidence(db, ev).catch(() => {});
      scheduleEmbedding(db);
      emit('evidence', { engagementId: r.engagement_id });
    }
  } catch (e: any) {
    const msg = String(e?.cause?.code ?? e?.message ?? e).slice(0, 300);
    await db.tx(async (q) => {
      await q.query(
        `UPDATE connectors SET last_pull_at = now(), last_status = 'failed', last_message = $2, pulls = pulls + 1 WHERE id = $1`,
        [r.id, msg],
      );
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
     WHERE n.enabled AND n.schedule <> 'manual' AND n.next_pull_at <= now() AND e.archived_at IS NULL AND NOT e.paused`,
  );
  for (const c of rows) {
    const next = new Date(Date.now() + (c.schedule === 'weekly' ? 7 : 1) * 864e5).toISOString();
    await db.query(`UPDATE connectors SET next_pull_at = $2 WHERE id = $1`, [c.id, next]);
    await pull(db, c.id, 'Connector schedule').catch((e) => console.warn(`[connector] ${e.message}`));
  }
}
