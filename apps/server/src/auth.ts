// Sign-in, sessions and permission checks. Passwords are hashed with scrypt;
// session tokens are random, stored hashed, and sent as an HttpOnly cookie.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { can, type Permission, type Role, type User } from '@gh/shared';
import type { Db, Queryable } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const COOKIE = 'gh_session';
const SESSION_DAYS = 7;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, salt, key] = stored.split(':');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

export function toUser(r: any): User {
  const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  return { id: r.id, email: r.email, name: r.name, role: r.role, disabled: r.disabled, createdAt: iso(r.created_at)!, lastSeenAt: iso(r.last_seen_at) };
}

export async function createSession(q: Queryable, userId: string, req: Request) {
  const token = randomBytes(32).toString('base64url');
  await q.query(`INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES ($1,$2, now() + ($3 || ' days')::interval, $4, $5)`, [
    tokenId(token), userId, String(SESSION_DAYS), req.ip ?? null, String(req.header('user-agent') ?? '').slice(0, 300),
  ]);
  return token;
}

export function setCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_DAYS * 864e5,
    path: '/',
  });
}

export function readCookie(header: string | undefined, name = COOKIE) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function userFromToken(q: Queryable, token: string | null): Promise<User | null> {
  if (!token) return null;
  const { rows } = await q.query(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now() AND NOT u.disabled`,
    [tokenId(token)],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function endSession(q: Queryable, token: string | null) {
  if (token) await q.query(`DELETE FROM sessions WHERE id = $1`, [tokenId(token)]);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const PUBLIC = new Set(['/health', '/auth/state', '/auth/login', '/auth/setup']);

// Route-level permissions: the first matching rule decides. Anything not
// listed needs 'read' for GET and 'prepare' otherwise.
const RULES: [string, RegExp, Permission][] = [
  ['*', /^\/users/, 'manage_users'],
  ['*', /^\/auth\/sessions/, 'read'],
  ['GET', /^\/providers/, 'read'],
  ['*', /^\/providers/, 'manage_models'],
  ['PUT', /^\/settings$/, 'manage_models'],
  ['PATCH', /^\/agents\//, 'manage_agents'],
  ['POST', /^\/agents\//, 'manage_agents'],
  ['PATCH', /^\/engagements\/[^/]+$/, 'manage_engagement'],
  ['PUT', /^\/engagements\/[^/]+\/soa/, 'manage_engagement'],
  ['PUT', /^\/engagements\/[^/]+\/assessment/, 'manage_engagement'],
  ['POST', /^\/engagements\/[^/]+\/report\/sign/, 'sign_off_report'],
  ['POST', /^\/tests\/[^/]+\/review/, 'approve'],
  ['POST', /^\/library/, 'manage_engagement'],
  ['PATCH', /^\/library/, 'manage_engagement'],
];

export function authMiddleware(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (PUBLIC.has(req.path)) return next();
      const user = await userFromToken(db, readCookie(req.header('cookie')));
      if (!user) return res.status(401).json({ error: 'Sign in to continue' });
      req.user = user;
      void db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`, [user.id]);
      const rule = RULES.find(([m, re]) => (m === '*' || m === req.method) && re.test(req.path));
      const need: Permission = rule ? rule[2] : req.method === 'GET' ? 'read' : 'prepare';
      if (!can(user.role, need)) return res.status(403).json({ error: `Your role (${user.role}) can't do this` });
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requirePerm(req: Request, p: Permission) {
  if (!can(req.user?.role as Role, p)) throw Object.assign(new Error(`Your role (${req.user?.role}) can't do this`), { status: 403 });
}

// Segregation of duties: the person who prepared something can't approve it.
export function requireDifferentPerson(req: Request, preparer: string | null | undefined, what: string) {
  if (preparer && req.user && preparer === req.user.name) {
    throw Object.assign(new Error(`You prepared this ${what}, so someone else has to approve it`), { status: 403 });
  }
}
