// Evidence connector API: set up read-only pulls from client systems, pull
// now, and see what each pull brought back. Credentials are write-only.
import type { NextFunction, Request, Response, Router } from 'express';
import { ConnectorInput } from '@gh/shared';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { encrypt } from './crypto.js';
import { CONNECTOR_SELECT, pull, toConnector } from './connectors.js';

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const firstPull = (schedule: string) => (schedule === 'manual' ? null : new Date().toISOString());

export function connectorRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  r.get('/engagements/:id/connectors', wrap(async (req, res) => {
    const { rows } = await db.query(`${CONNECTOR_SELECT} WHERE n.engagement_id = $1 ORDER BY n.number`, [req.params.id]);
    res.json(rows.map(toConnector));
  }));

  r.post('/engagements/:id/connectors', wrap(async (req, res) => {
    const b = ConnectorInput.parse(req.body);
    if (b.auth !== 'none' && !b.secret) throw httpError(400, 'Add the token, key or user:password for this connector');
    if (b.auth === 'header' && !b.headerName) throw httpError(400, 'Name the header the key goes in, for example x-api-key');
    const row = await db.tx(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO connectors (engagement_id, name, url, auth, header_name, secret_enc, control_id, schedule, enabled, next_pull_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.params.id, b.name, b.url, b.auth, b.headerName, b.secret ? encrypt(b.secret) : null, b.controlId, b.schedule, b.enabled, firstPull(b.schedule), actorOf(req)],
      );
      // The secret never goes in the audit log.
      await logAudit(q, actorOf(req), 'connector.added', `connector:CN-${rows[0].number}`, { name: b.name, url: b.url, auth: b.auth, schedule: b.schedule });
      return rows[0];
    });
    const { rows } = await db.query(`${CONNECTOR_SELECT} WHERE n.id = $1`, [row.id]);
    res.status(201).json(toConnector(rows[0]));
  }));

  r.patch('/connectors/:id', wrap(async (req, res) => {
    const b = ConnectorInput.partial().parse(req.body);
    await db.tx(async (q) => {
      const { rows } = await q.query(`SELECT * FROM connectors WHERE id = $1`, [req.params.id]);
      const c = rows[0];
      if (!c) throw httpError(404, 'Connector not found');
      const set: Record<string, unknown> = {};
      for (const [k, col] of [['name', 'name'], ['url', 'url'], ['auth', 'auth'], ['headerName', 'header_name'], ['controlId', 'control_id'], ['schedule', 'schedule'], ['enabled', 'enabled']] as const) {
        if ((b as any)[k] !== undefined && (b as any)[k] !== c[col]) set[col] = (b as any)[k];
      }
      if (b.secret) set.secret_enc = encrypt(b.secret);
      if (set.schedule !== undefined) set.next_pull_at = firstPull(String(set.schedule));
      const cols = Object.keys(set);
      if (!cols.length) throw httpError(400, 'Nothing to change');
      await q.query(`UPDATE connectors SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [c.id, ...cols.map((k) => set[k])]);
      await logAudit(q, actorOf(req), 'connector.changed', `connector:CN-${c.number}`, Object.fromEntries(cols.filter((k) => k !== 'secret_enc' && k !== 'next_pull_at').map((k) => [k, { from: c[k], to: set[k] }]).concat(b.secret ? [['secret', 'replaced']] : [])));
    });
    const { rows } = await db.query(`${CONNECTOR_SELECT} WHERE n.id = $1`, [req.params.id]);
    res.json(toConnector(rows[0]));
  }));

  r.delete('/connectors/:id', wrap(async (req, res) => {
    await db.tx(async (q) => {
      const { rows } = await q.query(`SELECT * FROM connectors WHERE id = $1`, [req.params.id]);
      if (!rows[0]) throw httpError(404, 'Connector not found');
      // Evidence it pulled stays in the vault; only the connector goes.
      await q.query(`DELETE FROM connectors WHERE id = $1`, [rows[0].id]);
      await logAudit(q, actorOf(req), 'connector.removed', `connector:CN-${rows[0].number}`, { name: rows[0].name, url: rows[0].url });
    });
    res.json({ ok: true });
  }));

  r.post('/connectors/:id/pull', wrap(async (req, res) => {
    res.json(await pull(db, req.params.id, actorOf(req)));
  }));
}
