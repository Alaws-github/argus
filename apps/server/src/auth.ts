// Sign-in, sessions and permission checks. Passwords are hashed with scrypt;
// session tokens are random, stored hashed, and sent as an HttpOnly cookie.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { can, type Permission, type Role, type User } from '@gh/shared';
import type { Db, Queryable } from './db.js';
import { requestContext } from './context.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const COOKIE = 'gh_session';
const SESSION_DAYS = 7;
// A session also ends after this long without use.
export const IDLE_HOURS = 12;

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

export const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

export function toUser(r: any): User {
  const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  return {
    id: r.id, email: r.email, name: r.name, role: r.role, disabled: r.disabled, createdAt: iso(r.created_at)!, lastSeenAt: iso(r.last_seen_at),
    formerNames: r.former_names ?? [],
  };
}

export async function createSession(q: Queryable, userId: string, req: Request) {
  const token = randomBytes(32).toString('base64url');
  await q.query(`INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES ($1,$2, now() + ($3 || ' days')::interval, $4, $5)`, [
    tokenId(token), userId, String(SESSION_DAYS), req.ip ? req.ip.replace(/^::ffff:/, '') : null, String(req.header('user-agent') ?? '').slice(0, 300),
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
    `SELECT u.*, s.last_used_at, s.acting_as FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now() AND s.last_used_at > now() - ($2 || ' hours')::interval AND NOT u.disabled`,
    [tokenId(token), String(IDLE_HOURS)],
  );
  if (!rows[0]) return null;
  if (Date.now() - new Date(rows[0].last_used_at).getTime() > 60_000) {
    await q.query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [tokenId(token)]);
  }
  const real = toUser(rows[0]);
  // Act as: only an admin, only while the workspace allows it, only as an active account.
  if (rows[0].acting_as && real.role === 'admin') {
    const { rows: s } = await q.query(`SELECT value FROM settings WHERE key = 'allowActAs'`);
    if (s[0]?.value === true) {
      const { rows: as } = await q.query(`SELECT * FROM users WHERE id = $1 AND NOT disabled`, [rows[0].acting_as]);
      if (as[0]) return { ...toUser(as[0]), realUser: { id: real.id, name: real.name, email: real.email } };
    }
  }
  return real;
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

const PUBLIC = new Set(['/health', '/auth/state', '/auth/login', '/auth/setup', '/auth/sso', '/auth/sso/start', '/auth/sso/callback']);

// Route-level permissions: the first matching rule decides. Anything not
// listed needs 'read' for GET and 'prepare' otherwise.
const RULES: [string, RegExp, Permission][] = [
  ['*', /^\/users/, 'manage_users'],
  ['*', /^\/sso\/config/, 'manage_users'],
  ['*', /^\/auth\/(sessions|me|act-as)/, 'read'],
  ['POST', /^\/engagements$/, 'manage_engagement'],
  ['POST', /^\/knowledge\/(reindex|embeddings)/, 'manage_models'],
  ['GET', /^\/agent-testing/, 'read'],
  ['*', /^\/agent-testing/, 'manage_models'],
  ['POST', /^\/engagements\/[^/]+\/(archive|restore)$/, 'manage_engagement'],
  ['GET', /^\/engagements\/[^/]+\/export$/, 'manage_engagement'],
  ['DELETE', /^\/engagements\/[^/]+$/, 'manage_users'],
  ['GET', /^\/providers/, 'read'],
  ['*', /^\/providers/, 'manage_models'],
  ['PUT', /^\/settings$/, 'manage_models'],
  ['PATCH', /^\/agents\//, 'manage_agents'],
  ['DELETE', /^\/agents\//, 'manage_agents'],
  ['POST', /^\/engagements\/[^/]+\/agents$/, 'manage_agents'],
  ['POST', /^\/agents\//, 'manage_agents'],
  ['PATCH', /^\/engagements\/[^/]+$/, 'manage_engagement'],
  ['PUT', /^\/engagements\/[^/]+\/soa/, 'manage_engagement'],
  ['PUT', /^\/engagements\/[^/]+\/assessment/, 'manage_engagement'],
  ['POST', /^\/engagements\/[^/]+\/report\/sign/, 'sign_off_report'],
  ['POST', /^\/tests\/[^/]+\/review/, 'approve'],
  ['PATCH', /^\/evals\/[^/]+\/schedule$/, 'manage_engagement'],
  ['POST', /^\/connectors\/[^/]+\/pull$/, 'prepare'],
  ['PUT', /^\/engagements\/[^/]+\/access$/, 'manage_engagement'],
  ['POST', /^\/engagements\/[^/]+\/members$/, 'manage_engagement'],
  ['DELETE', /^\/engagements\/[^/]+\/members\//, 'manage_engagement'],
  ['POST', /^\/engagements\/[^/]+\/connectors$/, 'manage_engagement'],
  ['*', /^\/connectors\//, 'manage_engagement'],
  // v1.7.3: pipeline ingest tokens and write-back targets are engagement configuration.
  ['PUT', /^\/engagements\/[^/]+\/requirements\//, 'manage_engagement'],
  ['*', /^\/engagements\/[^/]+\/ingest-tokens/, 'manage_engagement'],
  ['*', /^\/ingest-tokens\//, 'manage_engagement'],
  ['POST', /^\/engagements\/[^/]+\/outbound$/, 'manage_engagement'],
  ['*', /^\/outbound\//, 'manage_engagement'],
  ['POST', /^\/alerts\/[^/]+\/acknowledge$/, 'approve'],
  ['POST', /^\/library/, 'manage_engagement'],
  ['GET', /^\/workflows/, 'read'],
  ['*', /^\/workflows\//, 'manage_engagement'],
  ['POST', /^\/engagements\/[^/]+\/workflows$/, 'manage_engagement'],
  ['PATCH', /^\/library/, 'manage_engagement'],
];

export function authMiddleware(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (PUBLIC.has(req.path)) return next();
      const user = await userFromToken(db, readCookie(req.header('cookie')));
      if (!user) return res.status(401).json({ error: 'Sign in to continue' });
      req.user = user;
      if (user.realUser) {
        const store = requestContext.getStore();
        if (store) { store.realActor = user.realUser.name; store.actingAs = user.name; }
      }
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

// True when a recorded name is this person, under their current name or any
// name they used before. Records keep the name used at the time, so a rename
// must never let someone approve their own work.
export function isMe(req: Request, name: string | null | undefined) {
  return !!name && !!req.user && (name === req.user.name || req.user.formerNames.includes(name));
}

// Segregation of duties: the person who prepared something can't approve it.
export function requireDifferentPerson(req: Request, preparer: string | null | undefined, what: string) {
  if (isMe(req, preparer)) {
    throw Object.assign(new Error(`You prepared this ${what}, so someone else has to approve it`), { status: 403 });
  }
}
