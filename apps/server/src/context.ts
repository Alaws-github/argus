// Per-request context, so code deep in a transaction (the audit log) can see
// who the request came from without every caller passing it along.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export const requestContext = new AsyncLocalStorage<{ ip: string | null }>();

export const clientIp = (req: Request) => (req.ip ? req.ip.replace(/^::ffff:/, '') : null);

export function withRequestContext(req: Request, _res: Response, next: NextFunction) {
  requestContext.run({ ip: clientIp(req) }, next);
}
