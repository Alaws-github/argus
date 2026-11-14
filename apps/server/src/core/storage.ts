// Evidence file storage. Files are named by their SHA-256 and kept in
// data/evidence. When R2 is configured (R2_ACCOUNT_ID, R2_BUCKET,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY), every file is also written to that
// Cloudflare R2 bucket, and a file missing on disk is fetched back from R2.
// That matters on a hosted container, whose disk is wiped when it restarts:
// R2 keeps the evidence, so its fingerprint still verifies.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { DATA_DIR } from './db.js';

const DIR = resolve(DATA_DIR, 'evidence');
const env = process.env;
const r2 =
  env.R2_ACCOUNT_ID && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
    ? {
        client: new AwsClient({
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          service: 's3',
          region: 'auto',
        }),
        base: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/evidence/`,
      }
    : null;
// R2_ENDPOINT overrides the address, for testing against another S3-compatible store.
if (r2 && env.R2_ENDPOINT) r2.base = `${env.R2_ENDPOINT.replace(/\/+$/, '')}/${env.R2_BUCKET}/evidence/`;

/** Where evidence files are kept: disk, or Cloudflare R2. */
export const storageKind = () => (r2 ? 'r2' : 'disk');
const local = (hash: string) => resolve(DIR, hash.replace(/[^a-f0-9]/gi, ''));

/** Stores an evidence file by its SHA-256 (on disk, and in R2 when set up). */
export async function putEvidence(hash: string, body: Buffer | string) {
  mkdirSync(DIR, { recursive: true });
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (!existsSync(local(hash))) writeFileSync(local(hash), buf);
  if (r2) {
    const res = await r2.client.fetch(r2.base + hash, { method: 'PUT', body: new Uint8Array(buf) });
    if (!res.ok) throw new Error(`Couldn't save the file to R2 (${res.status})`);
  }
}

// The stored file, or null if it is missing everywhere.
export async function getEvidence(hash: string): Promise<Buffer | null> {
  if (existsSync(local(hash))) return readFileSync(local(hash));
  if (!r2) return null;
  const res = await r2.client.fetch(r2.base + hash);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't read the file from R2 (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(DIR, { recursive: true });
  writeFileSync(local(hash), buf);
  return buf;
}

/** Deletes an evidence file. */
export async function deleteEvidence(hash: string) {
  let removed = false;
  if (existsSync(local(hash))) {
    unlinkSync(local(hash));
    removed = true;
  }
  if (r2) {
    const res = await r2.client.fetch(r2.base + hash, { method: 'DELETE' });
    removed = removed || res.ok;
  }
  return removed;
}
