// Single sign-on (OpenID Connect), scaffolded. It signs in people who already
// have an account here, matched by email, through the client's identity
// provider (Microsoft Entra ID, Google Workspace, Okta and others that speak
// OIDC). It never creates accounts or changes roles: an admin still adds each
// person and decides their role. Passwords keep working unless an admin turns
// them off for non-admins.
//
// The flow: /auth/sso/start sends the browser to the provider with a one-time
// state, a nonce and a PKCE challenge; /auth/sso/callback swaps the code for
// tokens, checks the ID token's signature, issuer, audience, nonce and expiry,
// then starts a normal session.
//
// Not done yet: MFA policy beyond what the provider enforces, SAML, signing
// out at the provider, and creating accounts from group claims.
import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { createSession, setCookie } from './auth.js';
import { decrypt, encrypt } from './crypto.js';

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

export const SsoConfig = z.object({
  enabled: z.boolean(),
  label: z.string().trim().max(60).default('your organisation'),
  issuer: z.string().trim().url().max(500),
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().max(2000).optional(),
  allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'A domain like client.example')).max(20).default([]),
  // Admins always keep password sign-in, so a broken provider can't lock everyone out.
  passwordsForNonAdmins: z.boolean().default(true),
});
type Stored = Omit<z.infer<typeof SsoConfig>, 'clientSecret'> & { secretEnc: string | null };

export async function getSso(db: Db): Promise<Stored | null> {
  const { rows } = await db.query(`SELECT value FROM settings WHERE key = 'sso'`);
  return rows[0]?.value ?? null;
}

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
const discoveries = new Map<string, { at: number; d: Discovery }>();
async function discover(issuer: string): Promise<Discovery> {
  const hit = discoveries.get(issuer);
  if (hit && Date.now() - hit.at < 3600_000) return hit.d;
  const res = await fetch(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`The provider's discovery document answered ${res.status}`);
  const d = (await res.json()) as Discovery;
  if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) throw new Error('The discovery document is missing endpoints');
  discoveries.set(issuer, { at: Date.now(), d });
  return d;
}

// One-time sign-in attempts, kept for ten minutes.
const pending = new Map<string, { nonce: string; verifier: string; redirectUri: string; at: number }>();
const b64url = (b: Buffer) => b.toString('base64url');
const base = (req: Request) => process.env.PUBLIC_URL?.replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;

export function ssoRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  // Public: does the sign-in page show the SSO button?
  r.get('/auth/sso', wrap(async (_req, res) => {
    const c = await getSso(db);
    res.json({ enabled: !!c?.enabled, label: c?.label ?? '', passwordsForNonAdmins: c?.passwordsForNonAdmins ?? true });
  }));

  r.get('/auth/sso/start', wrap(async (req, res) => {
    const c = await getSso(db);
    if (!c?.enabled) return res.redirect('/?sso_error=' + encodeURIComponent('Single sign-on is not set up'));
    try {
      const d = await discover(c.issuer);
      const state = b64url(randomBytes(24));
      const nonce = b64url(randomBytes(24));
      const verifier = b64url(randomBytes(32));
      const redirectUri = `${base(req)}/api/auth/sso/callback`;
      for (const [k, v] of pending) if (Date.now() - v.at > 600_000) pending.delete(k);
      pending.set(state, { nonce, verifier, redirectUri, at: Date.now() });
      const u = new URL(d.authorization_endpoint);
      u.search = new URLSearchParams({
        response_type: 'code', client_id: c.clientId, redirect_uri: redirectUri, scope: 'openid email profile', state, nonce,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      }).toString();
      res.redirect(u.toString());
    } catch (e: any) {
      res.redirect('/?sso_error=' + encodeURIComponent(`Couldn't reach the sign-in provider: ${e.message}`));
    }
  }));

  r.get('/auth/sso/callback', wrap(async (req, res) => {
    const fail = async (msg: string, who = 'unknown') => {
      await logAudit(db, who, 'auth.sso_failed', 'auth:sso', { reason: msg });
      res.redirect('/?sso_error=' + encodeURIComponent(msg));
    };
    const c = await getSso(db);
    const state = String(req.query.state ?? '');
    const p = pending.get(state);
    pending.delete(state);
    if (!c?.enabled) return fail('Single sign-on is not set up');
    if (req.query.error) return fail(`The provider said: ${String(req.query.error_description ?? req.query.error).slice(0, 200)}`);
    if (!p || Date.now() - p.at > 600_000) return fail('That sign-in link expired or was already used. Try again.');
    try {
      const d = await discover(c.issuer);
      const tr = await fetch(d.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code: String(req.query.code ?? ''), redirect_uri: p.redirectUri, client_id: c.clientId,
          ...(c.secretEnc ? { client_secret: decrypt(c.secretEnc) } : {}), code_verifier: p.verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const tok: any = await tr.json().catch(() => ({}));
      if (!tr.ok || !tok.id_token) return fail(`The provider refused the sign-in (${tok.error ?? tr.status})`);
      const { payload } = await jwtVerify(tok.id_token, createRemoteJWKSet(new URL(d.jwks_uri)), { issuer: d.issuer, audience: c.clientId });
      if (payload.nonce !== p.nonce) return fail('The sign-in response did not match this attempt');
      const email = String(payload.email ?? payload.preferred_username ?? '').toLowerCase();
      if (!email.includes('@')) return fail('The provider did not share an email address');
      if (payload.email_verified === false) return fail('The provider says that email address is not verified');
      if (c.allowedDomains.length && !c.allowedDomains.includes(email.split('@')[1])) return fail(`${email.split('@')[1]} is not an allowed domain`, email);
      const { rows } = await db.query(`SELECT * FROM users WHERE lower(email) = $1`, [email]);
      const u = rows[0];
      if (!u || u.disabled) return fail(`There's no active account for ${email}. Ask an admin to add you first.`, email);
      const token = await createSession(db, u.id, req);
      await logAudit(db, u.name, 'auth.signed_in', `user:${u.email}`, { method: 'sso', provider: d.issuer });
      setCookie(res, token);
      res.redirect('/');
    } catch (e: any) {
      return fail(`The sign-in could not be verified: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }));

  // Admin set-up. The client secret is write-only.
  r.get('/sso/config', wrap(async (_req, res) => {
    const c = await getSso(db);
    res.json(c ? { ...c, secretEnc: undefined, secretSet: !!c.secretEnc } : null);
  }));
  r.put('/sso/config', wrap(async (req, res) => {
    const b = SsoConfig.parse(req.body);
    const before = await getSso(db);
    if (b.enabled) await discover(b.issuer).catch((e) => { throw httpError(400, `Couldn't read ${b.issuer}/.well-known/openid-configuration: ${e.message}`); });
    const stored: Stored = {
      enabled: b.enabled, label: b.label, issuer: b.issuer, clientId: b.clientId, allowedDomains: b.allowedDomains, passwordsForNonAdmins: b.passwordsForNonAdmins,
      secretEnc: b.clientSecret ? encrypt(b.clientSecret) : before?.secretEnc ?? null,
    };
    await db.tx(async (q) => {
      await q.query(`INSERT INTO settings (key, value) VALUES ('sso', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(stored)]);
      await logAudit(q, actorOf(req), 'sso.configured', 'auth:sso', { enabled: b.enabled, issuer: b.issuer, clientId: b.clientId, allowedDomains: b.allowedDomains, passwordsForNonAdmins: b.passwordsForNonAdmins, secretChanged: !!b.clientSecret });
    });
    discoveries.delete(b.issuer);
    res.json({ ok: true, redirectUri: `${base(req)}/api/auth/sso/callback` });
  }));
}

// Password sign-in for non-admins can be switched off once SSO works.
export async function passwordAllowed(db: Db, role: string) {
  const c = await getSso(db);
  return role === 'admin' || !c?.enabled || c.passwordsForNonAdmins;
}
