// Database adapter. Uses real Postgres when DATABASE_URL is set, otherwise an
// embedded Postgres (PGlite) stored in ./data, so the harness runs with no Docker.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  kind: 'postgres' | 'pglite';
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(here, '../../../data');

async function openPostgres(url: string): Promise<Db> {
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: url });
  return {
    kind: 'postgres',
    query: (sql, params) => pool.query(sql, params as any[]) as any,
    exec: async (sql) => {
      await pool.query(sql);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (s, p) => client.query(s, p as any[]) as any });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new PGlite(resolve(DATA_DIR, 'pglite'));
  await db.waitReady;
  return {
    kind: 'pglite',
    query: (sql, params) => db.query(sql, params as any[]) as any,
    exec: async (sql) => {
      await db.exec(sql);
    },
    tx: (fn) => db.transaction((t) => fn({ query: (s, p) => t.query(s, p as any[]) as any })),
    close: () => db.close(),
  };
}

let instance: Db | null = null;

export async function getDb(): Promise<Db> {
  if (instance) return instance;
  instance = process.env.DATABASE_URL ? await openPostgres(process.env.DATABASE_URL) : await openPglite();
  return instance;
}

export async function migrate(db: Db) {
  const sql = readFileSync(resolve(here, 'schema.sql'), 'utf8');
  await db.exec(sql);
}
