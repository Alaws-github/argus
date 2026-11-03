import type { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import { Role } from '@gh/shared';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { COOKIE, createSession, endSession, hashPassword, readCookie, setCookie, toUser, userFromToken, verifyPassword } from './auth.js';

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const Password = z.string().min(10, 'Use at least 10 characters').max(200);

export function authRoutes(r: Router, db: Db, wrap: Wrap) {
  const userCount = async () => (await db.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n as number;

  r.get('/auth/state', wrap(async (req, res) => {
    const user = await userFromToken(db, readCookie(req.header('cookie')));
    res.json({ needsSetup: (await userCount()) === 0, user });
  }));

  // First run only: creates the admin account.
  r.post('/auth/setup', wrap(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email(), password: Password }).parse(req.body);
    if ((await userCount()) > 0) throw httpError(409, 'Setup is already done. Sign in instead.');
    const token = await db.tx(async (q) => {
      const { rows } = await q.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,'admin',$3) RETURNING id`, [
        body.email.toLowerCase(), body.name, await hashPassword(body.password),
      ]);
      await logAudit(q, body.name, 'user.created_first_admin', `user:${body.email.toLowerCase()}`, {});
      return createSession(q, rows[0].id, req);
    });
    setCookie(res, token);
    res.json({ ok: true });
  }));

  r.post('/auth/login', wrap(async (req, res) => {
    const body = z.object({ email: z.string().trim(), password: z.string() }).parse(req.body);
    const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [body.email.toLowerCase()]);
    const ok = rows[0] && !rows[0].disabled && (await verifyPassword(body.password, rows[0].password_hash));
    if (!ok) {
      await logAudit(db, body.email.slice(0, 80), 'auth.failed', `user:${body.email.slice(0, 80)}`, {});
      throw httpError(401, "That email and password don't match an active account");
    }
    const token = await createSession(db, rows[0].id, req);
    await logAudit(db, rows[0].name, 'auth.signed_in', `user:${rows[0].email}`, { ip: req.ip });
    setCookie(res, token);
    res.json({ ok: true, user: toUser(rows[0]) });
  }));

  r.post('/auth/logout', wrap(async (req, res) => {
    await endSession(db, readCookie(req.header('cookie')));
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  r.get('/auth/me', wrap(async (req, res) => res.json(req.user)));

  r.post('/auth/password', wrap(async (req, res) => {
    const body = z.object({ current: z.string(), next: Password }).parse(req.body);
    const { rows } = await db.query(`SELECT * FROM users WHERE id = $1`, [req.user!.id]);
    if (!(await verifyPassword(body.current, rows[0].password_hash))) throw httpError(400, "The current password isn't right");
    await db.tx(async (q) => {
      await q.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [req.user!.id, await hashPassword(body.next)]);
      await q.query(`DELETE FROM sessions WHERE user_id = $1`, [req.user!.id]);
      await logAudit(q, req.user!.name, 'user.password_changed', `user:${req.user!.email}`, {});
    });
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- users
  r.get('/users', wrap(async (_req, res) => {
    const { rows } = await db.query(`SELECT * FROM users ORDER BY created_at`);
    res.json(rows.map(toUser));
  }));

  r.post('/users', wrap(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email(), role: Role, password: Password }).parse(req.body);
    const exists = await db.query(`SELECT 1 FROM users WHERE email = $1`, [body.email.toLowerCase()]);
    if (exists.rows[0]) throw httpError(409, 'Someone already uses that email');
    const names = await db.query(`SELECT 1 FROM users WHERE lower(name) = lower($1)`, [body.name]);
    if (names.rows[0]) throw httpError(409, 'Someone already has that name. Names are how approvals are recorded, so they must be unique.');
    const user = await db.tx(async (q) => {
      const { rows } = await q.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING *`, [
        body.email.toLowerCase(), body.name, body.role, await hashPassword(body.password),
      ]);
      await logAudit(q, req.user!.name, 'user.created', `user:${body.email.toLowerCase()}`, { role: body.role });
      return toUser(rows[0]);
    });
    res.status(201).json(user);
  }));

  r.patch('/users/:id', wrap(async (req, res) => {
    const body = z.object({ role: Role.optional(), disabled: z.boolean().optional(), password: Password.optional() }).parse(req.body);
    const { rows } = await db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id]);
    if (!rows[0]) throw httpError(404, 'User not found');
    if (rows[0].id === req.user!.id && (body.disabled || (body.role && body.role !== 'admin'))) {
      throw httpError(409, "You can't disable yourself or remove your own admin role");
    }
    await db.tx(async (q) => {
      if (body.role) await q.query(`UPDATE users SET role = $2 WHERE id = $1`, [rows[0].id, body.role]);
      if (body.disabled !== undefined) {
        await q.query(`UPDATE users SET disabled = $2 WHERE id = $1`, [rows[0].id, body.disabled]);
        if (body.disabled) await q.query(`DELETE FROM sessions WHERE user_id = $1`, [rows[0].id]);
      }
      if (body.password) {
        await q.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [rows[0].id, await hashPassword(body.password)]);
        await q.query(`DELETE FROM sessions WHERE user_id = $1`, [rows[0].id]);
      }
      await logAudit(q, req.user!.name, 'user.changed', `user:${rows[0].email}`, {
        ...(body.role ? { role: { from: rows[0].role, to: body.role } } : {}),
        ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
        ...(body.password ? { credential: 'reset' } : {}),
      });
    });
    const { rows: after } = await db.query(`SELECT * FROM users WHERE id = $1`, [rows[0].id]);
    res.json(toUser(after[0]));
  }));
}
