// v1.7.3: write-back. When a lead switches it on for an engagement, ARGUS
// sends short messages to the client's channels (Teams, Slack), creates
// tickets (Jira, ServiceNow) or posts to a webhook when set events happen:
// a use case waiting for a person, an agent's question, a failed test, a new
// issue or incident, a sign-off, a failed client step.
//
// What keeps it safe:
// - Off by default per engagement (engagements.write_back), and each target
//   only sends the events ticked for it.
// - Events come from the audit log, after the change has been committed. A
//   send can't change anything in ARGUS, and no agent can trigger one: the
//   agent tools (tools.ts) have no write-back tool.
// - The only writes are a message or a new ticket or record. ARGUS never
//   edits, closes or deletes anything in the client's tools.
// - Addresses get the same private-network check as connectors; redirects
//   are not followed; credentials and webhook addresses are encrypted.
// - Every send and every failure is in the audit log, with the payload's
//   SHA-256 and the response status, never the credential.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Request, Router } from 'express';
import { OUTBOUND_EVENTS, OUTBOUND_KINDS, OutboundInput, type OutboundEvent, type OutboundTarget } from '@gh/shared';
import type { Db } from '../core/db.js';
import { logAudit } from '../audit/audit.js';
import { decrypt, encrypt } from '../core/crypto.js';
import { getSettings } from '../settings/settings-store.js';
import { type Wrap, httpError } from '../core/http.js';
import { toIso } from '../core/format.js';

// Channel webhooks carry their own secret in the address, so the whole address is encrypted and only its site is shown.
const URL_IS_SECRET = new Set(['teams', 'slack']);
const shown = (kind: string, url: string) => (URL_IS_SECRET.has(kind) ? `${new URL(url).origin}/…` : url);

export const toTarget = (r: any): OutboundTarget => ({
  id: r.id,
  key: `WB-${r.number}`,
  name: r.name,
  kind: r.kind,
  url: r.url,
  project: r.project,
  secretSet: !!r.secret_enc,
  events: r.events ?? [],
  enabled: r.enabled,
  sends: r.sends,
  lastAt: toIso(r.last_at),
  lastStatus: r.last_status,
  lastMessage: r.last_message,
  createdBy: r.created_by,
});

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return (
      v === '::1' ||
      v === '::' ||
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe80') ||
      (v.startsWith('::ffff:') && privateAddress(v.slice(7)))
    );
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
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:'))
    throw new Error('Write-back only sends to https addresses');
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(privateAddress)) throw new Error(`${url.hostname} is on this machine or a private network`);
}

export interface Notice {
  event: OutboundEvent;
  engagement: string;
  prefix: string;
  subject: string;
  text: string;
  link: string;
  key: string | null;
}

// Build the request for one target. Exported for tests.
export function buildRequest(
  t: any,
  n: Notice,
  secret: string | null,
): { url: string; headers: Record<string, string>; body: unknown } {
  const title = `[ARGUS] ${n.subject}`;
  const plain = `${n.text}\n\nOpen in ARGUS: ${n.link}`;
  const basic: Record<string, string> = secret
    ? { authorization: `Basic ${Buffer.from(secret).toString('base64')}` }
    : {};
  switch (t.kind) {
    case 'teams':
      return { url: secret!, headers: {}, body: { text: `**${title}**\n\n${plain}` } };
    case 'slack':
      return { url: secret!, headers: {}, body: { text: `*${title}*\n${plain}` } };
    case 'jira':
      return {
        url: `${t.url.replace(/\/+$/, '')}/rest/api/3/issue`,
        headers: basic,
        body: {
          fields: {
            project: { key: t.project },
            issuetype: { name: 'Task' },
            summary: title.slice(0, 250),
            labels: ['argus', ...(n.key ? [n.key.replace(/[^\w-]/g, '')] : [])],
            description: {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: plain.slice(0, 30000) }] }],
            },
          },
        },
      };
    case 'servicenow':
      return {
        url: `${t.url.replace(/\/+$/, '')}/api/now/table/${encodeURIComponent(t.project || 'incident')}`,
        headers: basic,
        body: {
          short_description: title.slice(0, 160),
          description: plain,
          correlation_id: n.key ?? undefined,
          correlation_display: 'ARGUS',
        },
      };
    default:
      return {
        url: t.url,
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        body: {
          source: 'ARGUS',
          event: n.event,
          engagement: n.engagement,
          key: n.key,
          subject: n.subject,
          text: n.text,
          link: n.link,
        },
      };
  }
}

// Send one notice to one target, audited either way. Returns the result line.
export async function send(db: Db, t: any, n: Notice, actor: string): Promise<{ ok: boolean; message: string }> {
  const allowPrivate = (await getSettings(db)).connectorsAllowPrivate;
  const secret = t.secret_enc ? decrypt(t.secret_enc) : null;
  let ok = false,
    message = '',
    status = 0,
    ref: string | null = null;
  const req = buildRequest(t, n, secret);
  const payload = JSON.stringify(req.body);
  try {
    const url = new URL(req.url);
    await checkAddress(url, allowPrivate);
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'ARGUS-WriteBack',
        ...req.headers,
      },
      body: payload,
      signal: AbortSignal.timeout(20_000),
    });
    status = res.status;
    const body: any = await res.json().catch(() => null);
    ok = res.ok;
    ref = body?.key ?? body?.result?.number ?? null;
    message = ok
      ? `Sent (${res.status})${ref ? `: ${ref}` : ''}`
      : `${res.status} ${res.statusText}: ${String(body?.errorMessages?.[0] ?? body?.error?.message ?? body?.message ?? '').slice(0, 160)}`.trim();
  } catch (e: any) {
    message = String(e?.cause?.code ?? e?.message ?? e).slice(0, 200);
  }
  await db.tx(async (q) => {
    await q.query(
      `UPDATE outbound_targets SET sends = sends + 1, last_at = now(), last_status = $2, last_message = $3 WHERE id = $1`,
      [t.id, ok ? 'sent' : 'failed', message],
    );
    await logAudit(q, actor, ok ? 'writeback.sent' : 'writeback.failed', `writeback:WB-${t.number}`, {
      kind: t.kind,
      event: n.event,
      about: n.key,
      status,
      sha256: createHash('sha256').update(payload).digest('hex'),
      ...(ref ? { created: ref } : {}),
      ...(ok ? {} : { error: message }),
    });
  });
  // An issue sent to a ticketing tool remembers the ticket it became.
  if (ok && ref && n.key?.startsWith('I-'))
    await db
      .query(
        `UPDATE issues SET external_ref = $2 WHERE engagement_id = (SELECT engagement_id FROM outbound_targets WHERE id = $3) AND number = $1 AND external_ref IS NULL`,
        [Number(n.key.slice(2)), String(ref), t.id],
      )
      .catch(() => {});
  return { ok, message };
}

// Which audit entries are events, and what to say about them.
export function eventOf(row: {
  action: string;
  entity: string;
  detail: any;
}): { event: OutboundEvent; key: string | null } | null {
  const key = row.entity.split(':')[1] ?? null;
  const d = row.detail ?? {};
  if (row.action === 'run.succeeded') return { event: 'card.waiting', key };
  if (row.action === 'agent.asked') return { event: 'card.question', key };
  if (row.action === 'test.reviewed' && d.result === 'failed') return { event: 'test.failed', key };
  if (row.action === 'issue.raised') return { event: 'issue.raised', key };
  if ((row.action === 'gate.approved' || row.action === 'card.moved') && d.to === 'closed')
    return { event: 'card.signed_off', key };
  if (row.action === 'incident.reported') return { event: 'incident.raised', key };
  if (row.action === 'client_step.checked' && d.status === 'failed') return { event: 'step.failed', key };
  return null;
}
function describe(event: OutboundEvent, key: string | null, actor: string, d: any): { subject: string; text: string } {
  switch (event) {
    case 'card.waiting':
      return {
        subject: `${key} is waiting for a person`,
        text: `${actor} finished a draft for ${key}${d.stage ? ` (${d.stage})` : ''}. A person needs to review and decide.`,
      };
    case 'card.question':
      return {
        subject: `${key}: the agent has a question`,
        text: `${actor} asked: ${String(d.question ?? '').slice(0, 400)}`,
      };
    case 'test.failed':
      return {
        subject: `Test ${key} failed`,
        text: `${actor} concluded test ${key} as failed${d.note ? `: ${String(d.note).slice(0, 300)}` : ''}.`,
      };
    case 'issue.raised':
      return {
        subject: `New issue ${key}: ${String(d.title ?? '').slice(0, 120)}`,
        text: `${actor} raised ${key}${d.severity ? ` (${d.severity})` : ''}.`,
      };
    case 'card.signed_off':
      return { subject: `${key} signed off`, text: `${actor} signed off ${key}. It is now live under governance.` };
    case 'incident.raised':
      return {
        subject: `Incident ${key}: ${String(d.title ?? '').slice(0, 120)}`,
        text: `${actor} reported an incident${d.severity ? ` (${d.severity})` : ''}. ${Array.isArray(d.notices) && d.notices.length ? `Notices due: ${d.notices.join('; ')}.` : ''}`.trim(),
      };
    case 'step.failed':
      return {
        subject: `${d.useCase ?? key}: client step "${d.step ?? ''}" not done`,
        text: `${d.detail ?? 'The check found no record that proves the step.'}`,
      };
  }
}
const linkFor = (event: OutboundEvent, key: string | null, d: any) => {
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');
  const path =
    event === 'issue.raised'
      ? `/issues?focus=${key}`
      : event === 'test.failed'
        ? `/testing/tests?focus=${key}`
        : event === 'incident.raised'
          ? `/incidents?focus=${key}`
          : `/?card=${d?.useCase ?? key}`;
  return `${base || ''}${path}`;
};

// Read new audit entries and send what matches. Called by the monitoring tick.
let running = false;
export async function dispatchOutbound(db: Db) {
  if (running) return;
  running = true;
  try {
    const cur = (await db.query(`SELECT last_audit_id FROM outbound_cursor WHERE id = 1`)).rows[0];
    if (!cur) {
      await db.query(
        `INSERT INTO outbound_cursor (id, last_audit_id) SELECT 1, COALESCE(max(id), 0) FROM audit_log ON CONFLICT DO NOTHING`,
      );
      return;
    }
    const { rows } = await db.query(
      `SELECT a.id, a.actor, a.action, a.entity, a.detail, a.engagement_id FROM audit_log a WHERE a.id > $1 ORDER BY a.id LIMIT 200`,
      [cur.last_audit_id],
    );
    if (!rows.length) return;
    await db.query(`UPDATE outbound_cursor SET last_audit_id = $1 WHERE id = 1`, [rows[rows.length - 1].id]);
    const engs = new Map<string, any>();
    for (const row of rows) {
      const ev = eventOf(row);
      if (!ev || !row.engagement_id) continue;
      if (!engs.has(row.engagement_id))
        engs.set(
          row.engagement_id,
          (
            await db.query(`SELECT name, prefix, write_back, archived_at FROM engagements WHERE id = $1`, [
              row.engagement_id,
            ])
          ).rows[0],
        );
      const e = engs.get(row.engagement_id);
      if (!e?.write_back || e.archived_at) continue;
      const targets = (
        await db.query(`SELECT * FROM outbound_targets WHERE engagement_id = $1 AND enabled AND events ? $2`, [
          row.engagement_id,
          ev.event,
        ])
      ).rows;
      if (!targets.length) continue;
      const { subject, text } = describe(ev.event, ev.key, row.actor, row.detail);
      const n: Notice = {
        event: ev.event,
        engagement: e.name,
        prefix: e.prefix,
        subject,
        text,
        link: linkFor(ev.event, ev.key, row.detail),
        key: row.detail?.useCase ?? ev.key,
      };
      for (const t of targets)
        await send(db, t, n, 'Write-back').catch((err) => console.warn(`[write-back] ${err.message}`));
    }
  } finally {
    running = false;
  }
}

export function outboundRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  const one = async (id: string) =>
    toTarget((await db.query(`SELECT * FROM outbound_targets WHERE id = $1`, [id])).rows[0]);
  r.get(
    '/engagements/:id/outbound',
    wrap(async (req, res) => {
      res.json(
        (
          await db.query(`SELECT * FROM outbound_targets WHERE engagement_id = $1 ORDER BY number`, [req.params.id])
        ).rows.map(toTarget),
      );
    }),
  );
  r.post(
    '/engagements/:id/outbound',
    wrap(async (req, res) => {
      const b = OutboundInput.parse(req.body);
      if ((b.kind === 'jira' || b.kind === 'servicenow') && !b.secret)
        throw httpError(
          400,
          b.kind === 'jira'
            ? 'Enter email:API token for the Jira account'
            : 'Enter user:password for the ServiceNow integration user',
        );
      if (b.kind === 'jira' && !/^[A-Z][A-Z0-9_]{1,19}$/.test(b.project))
        throw httpError(400, 'Enter the Jira project key, for example GRC');
      if ((b.kind === 'jira' || b.kind === 'servicenow') && b.secret && !b.secret.includes(':'))
        throw httpError(400, 'Enter it as user:password (or email:API token)');
      const urlSecret = URL_IS_SECRET.has(b.kind);
      const row = await db.tx(async (q) => {
        const { rows } = await q.query(
          `INSERT INTO outbound_targets (engagement_id, name, kind, url, project, secret_enc, events, enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            req.params.id,
            b.name,
            b.kind,
            shown(b.kind, b.url),
            b.project,
            urlSecret ? encrypt(b.url) : b.secret ? encrypt(b.secret) : null,
            JSON.stringify(b.events),
            b.enabled,
            actorOf(req),
          ],
        );
        await logAudit(q, actorOf(req), 'writeback.target_added', `writeback:WB-${rows[0].number}`, {
          name: b.name,
          kind: b.kind,
          address: shown(b.kind, b.url),
          project: b.project || null,
          events: b.events,
        });
        return rows[0];
      });
      res.status(201).json(toTarget(row));
    }),
  );
  r.patch(
    '/outbound/:id',
    wrap(async (req, res) => {
      const b = OutboundInput.partial().parse(req.body);
      await db.tx(async (q) => {
        const t = (await q.query(`SELECT * FROM outbound_targets WHERE id = $1`, [req.params.id])).rows[0];
        if (!t) throw httpError(404, 'Write-back target not found');
        const set: Record<string, unknown> = {};
        if (b.name !== undefined) set.name = b.name;
        if (b.project !== undefined) set.project = b.project;
        if (b.events !== undefined) set.events = JSON.stringify(b.events);
        if (b.enabled !== undefined) set.enabled = b.enabled;
        if (b.url !== undefined && URL_IS_SECRET.has(t.kind)) {
          set.url = shown(t.kind, b.url);
          set.secret_enc = encrypt(b.url);
        } else if (b.url !== undefined) set.url = b.url;
        if (b.secret && !URL_IS_SECRET.has(t.kind)) set.secret_enc = encrypt(b.secret);
        const cols = Object.keys(set);
        if (!cols.length) throw httpError(400, 'Nothing to change');
        await q.query(
          `UPDATE outbound_targets SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [t.id, ...cols.map((k) => set[k])],
        );
        await logAudit(
          q,
          actorOf(req),
          'writeback.target_changed',
          `writeback:WB-${t.number}`,
          Object.fromEntries(
            cols
              .filter((k) => k !== 'secret_enc')
              .map((k) => [k, set[k]])
              .concat(set.secret_enc ? [['secret', 'replaced']] : []),
          ),
        );
      });
      res.json(await one(req.params.id));
    }),
  );
  r.delete(
    '/outbound/:id',
    wrap(async (req, res) => {
      await db.tx(async (q) => {
        const t = (
          await q.query(`DELETE FROM outbound_targets WHERE id = $1 RETURNING number, name, kind`, [req.params.id])
        ).rows[0];
        if (!t) throw httpError(404, 'Write-back target not found');
        await logAudit(q, actorOf(req), 'writeback.target_removed', `writeback:WB-${t.number}`, {
          name: t.name,
          kind: t.kind,
        });
      });
      res.json({ ok: true });
    }),
  );
  // Send a test message now. Needs write-back switched on, like any send.
  r.post(
    '/outbound/:id/test',
    wrap(async (req, res) => {
      const t = (
        await db.query(
          `SELECT o.*, e.name AS engagement_name, e.prefix, e.write_back FROM outbound_targets o JOIN engagements e ON e.id = o.engagement_id WHERE o.id = $1`,
          [req.params.id],
        )
      ).rows[0];
      if (!t) throw httpError(404, 'Write-back target not found');
      if (!t.write_back) throw httpError(409, 'Write-back is off for this engagement. Switch it on first.');
      const n: Notice = {
        event: 'card.waiting',
        engagement: t.engagement_name,
        prefix: t.prefix,
        subject: `Test from ARGUS (${t.engagement_name})`,
        text: `${actorOf(req)} sent this to check the ${OUTBOUND_KINDS[t.kind as keyof typeof OUTBOUND_KINDS]?.label ?? t.kind} works. It can be deleted.`,
        link: linkFor('card.waiting', null, {}),
        key: null,
      };
      const out = await send(db, t, n, actorOf(req));
      res.status(out.ok ? 200 : 502).json({
        ...out,
        target: await one(t.id),
        expose: true,
        error: out.ok ? undefined : `The send failed: ${out.message}`,
      });
    }),
  );
}
export { OUTBOUND_EVENTS };
