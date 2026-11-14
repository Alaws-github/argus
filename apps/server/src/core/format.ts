// Small value formatters shared by the record mappers that turn database rows into API responses.
import { createHash } from 'node:crypto';

/** A timestamp from the database as an ISO 8601 string, or null when there is none. */
export const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

/** A date from the database as YYYY-MM-DD, or null when there is none. */
export const toDay = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;

/** SHA-256 of a file or text, as hex. Evidence is stored and checked by this hash. */
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
