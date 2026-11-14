// Per-request context, so code deep in a transaction (the audit log) can see
// who the request came from without every caller passing it along.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request data for the audit log: the client address, the engagement and whether it came from the
 * assistant.
 */
export const requestContext = new AsyncLocalStorage<{
  ip: string | null;
  engagementId?: string | null;
  realActor?: string | null;
  actingAs?: string | null;
}>();

/** The request's client address, without the IPv6 prefix for IPv4. */
export const clientIp = (req: Request) => (req.ip ? req.ip.replace(/^::ffff:/, '') : null);

// The assistant's Apply step calls the API from this process on the person's
// behalf. It passes their real address with a per-process token, honoured only
// from the loopback address, so the audit log shows where the person was.
let internalToken = '';
/** Sets the token the assistant uses to replay a change as the person (rule 15). */
export const setInternalToken = (t: string) => (internalToken = t);
const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** Middleware: starts the per-request context. */
export function withRequestContext(req: Request, _res: Response, next: NextFunction) {
  let ip = clientIp(req);
  const fwd = req.headers['x-gh-client-ip'];
  if (
    internalToken &&
    req.headers['x-gh-internal'] === internalToken &&
    ip &&
    LOOPBACK.has(ip) &&
    typeof fwd === 'string'
  )
    ip = fwd || null;
  requestContext.run({ ip }, next);
}
