// Sign-in, sessions, your account and the People and roles page. Passwords are
// hashed; names are unique (current and former) because approvals are recorded
// by name.
import type { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import { Role } from '@gh/shared';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { passwordAllowed } from './sso.js';
import { COOKIE, IDLE_HOURS, createSession, endSession, tokenId, hashPassword, readCookie, setCookie, toUser, userFromToken, verifyPassword } from './auth.js';

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
    if (!(await passwordAllowed(db, rows[0].role))) throw httpError(403, 'Sign in with single sign-on instead. Passwords are only for admins here.');
    const token = await createSession(db, rows[0].id, req);
    await logAudit(db, rows[0].name, 'auth.signed_in', `user:${rows[0].email}`, { ip: req.ip });
    setCookie(res, token);
    res.json({ ok: true, user: toUser(rows[0]) });
  }));

  r.post('/auth/logout', wrap(async (req, res) => {
    await endSession(db, readCookie(req.header('cookie')));
    if (req.user) await logAudit(db, req.user.name, 'auth.signed_out', `user:${req.user.email}`, {});
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  r.get('/auth/me', wrap(async (req, res) => res.json(req.user)));

  // A name is how approvals are recorded, so it must not match anyone's current
  // or former name. The old name is kept so segregation of duties still holds.
  const nameTaken = async (name: string, exceptId: string | null = null) =>
    (await db.query(
      `SELECT 1 FROM users WHERE id IS DISTINCT FROM $2 AND (lower(name) = lower($1) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(former_names) f WHERE lower(f) = lower($1)))`,
      [name, exceptId],
    )).rows.length > 0;

  r.patch('/auth/me', wrap(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
    const me = req.user!;
    if (body.name === me.name) return res.json(me);
    if (await nameTaken(body.name, me.id)) throw httpError(409, 'Someone already uses that name, or used it before. Names are how approvals are recorded, so they must be unique.');
    await db.tx(async (q) => {
      await q.query(
        `UPDATE users SET name = $2, former_names = CASE WHEN former_names ? $3 THEN former_names ELSE former_names || to_jsonb($3::text) END WHERE id = $1`,
        [me.id, body.name, me.name],
      );
      await logAudit(q, body.name, 'user.renamed', `user:${me.email}`, { from: me.name, to: body.name });
    });
    const { rows } = await db.query(`SELECT * FROM users WHERE id = $1`, [me.id]);
    res.json(toUser(rows[0]));
  }));

  // Where you're signed in. The public id is a prefix of the stored hash, never the token.
  r.get('/auth/sessions', wrap(async (req, res) => {
    const current = tokenId(readCookie(req.header('cookie')) ?? '');
    const { rows } = await db.query(
      `SELECT id, created_at, last_used_at, expires_at, ip, user_agent FROM sessions
       WHERE user_id = $1 AND expires_at > now() AND last_used_at > now() - ($2 || ' hours')::interval ORDER BY last_used_at DESC`,
      [req.user!.id, String(IDLE_HOURS)],
    );
    const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));
    res.json(rows.map((s: any) => ({
      id: s.id.slice(0, 16), current: s.id === current, createdAt: iso(s.created_at), lastUsedAt: iso(s.last_used_at), expiresAt: iso(s.expires_at),
      ip: s.ip, userAgent: s.user_agent,
    })));
  }));

  r.delete('/auth/sessions/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!/^[0-9a-f]{16}$/.test(id)) throw httpError(404, 'Session not found');
    await db.tx(async (q) => {
      const { rows } = await q.query(`DELETE FROM sessions WHERE user_id = $1 AND left(id, 16) = $2 RETURNING ip`, [req.user!.id, id]);
      if (!rows[0]) throw httpError(404, 'Session not found');
      await logAudit(q, req.user!.name, 'auth.signed_out_session', `user:${req.user!.email}`, { sessionIp: rows[0].ip });
    });
    res.json({ ok: true });
  }));

  r.post('/auth/sessions/end-all', wrap(async (req, res) => {
    await db.tx(async (q) => {
      const { rows } = await q.query(`DELETE FROM sessions WHERE user_id = $1 RETURNING id`, [req.user!.id]);
      await logAudit(q, req.user!.name, 'auth.signed_out_everywhere', `user:${req.user!.email}`, { sessions: rows.length });
    });
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

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
    if (await nameTaken(body.name)) throw httpError(409, 'Someone already has that name. Names are how approvals are recorded, so they must be unique.');
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
