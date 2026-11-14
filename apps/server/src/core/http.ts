// Shared helpers for route files: the async wrapper, the actor lookup and errors a person can see.
// Every feature's routes function takes (r, db, actorOf, wrap) so they're registered the same way.
import type { NextFunction, Request, Response } from 'express';

/** Wraps an async route handler so a rejected promise reaches Express's error handler (Express 4 doesn't catch them). */
export type Wrap = (
  fn: (req: Request, res: Response) => Promise<unknown>,
) => (req: Request, res: Response, next: NextFunction) => void;

/** Returns the name recorded as the actor in the audit log for this request. */
export type ActorOf = (req: Request) => string;

/** The signed-in person's name is what approvals and the audit trail record. */
export const actorOf: ActorOf = (req) => req.user?.name ?? 'unknown';

/** Wraps an async route handler so a rejected promise reaches Express's error handler. */
export const wrap: Wrap = (fn) => (req, res, next) => {
  fn(req, res).catch(next);
};

/** An error with an HTTP status. The error handler in index.ts sends its message (and any extra fields) to the browser. */
export const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status, ...extra });
