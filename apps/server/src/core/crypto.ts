// Encrypts provider API keys at rest with AES-256-GCM. The key comes from
// SECRET_KEY (64 hex chars) or is generated once into data/secret.key.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from './db.js';

let key: Buffer | null = null;

function getKey(): Buffer {
  if (key) return key;
  if (process.env.SECRET_KEY) {
    key = Buffer.from(process.env.SECRET_KEY, 'hex');
    if (key.length !== 32) throw new Error('SECRET_KEY must be 64 hex characters (32 bytes)');
    return key;
  }
  const file = resolve(DATA_DIR, 'secret.key');
  if (existsSync(file)) {
    key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  } else {
    mkdirSync(DATA_DIR, { recursive: true });
    key = randomBytes(32);
    writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  }
  return key;
}

/** Encrypts a secret with AES-256-GCM and the key in data/secret.key. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', getKey(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

/** Decrypts a secret encrypted by encrypt(). */
export function decrypt(token: string): string {
  const [v, iv, tag, body] = token.split(':');
  if (v !== 'v1') throw new Error('Unknown key format');
  const d = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}
