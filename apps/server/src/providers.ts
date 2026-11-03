// Model providers: storage, key handling, connection tests and model discovery.
import type { Provider, ProviderType } from '@gh/shared';
import type { Queryable } from './db.js';
import { decrypt } from './crypto.js';
import { DEFAULT_PRICES } from './agents/pricing.js';

export interface ProviderRow {
  id: string;
  type: ProviderType;
  name: string;
  base_url: string;
  api_key_enc: string | null;
  key_last4: string | null;
  enabled: boolean;
  built_in: boolean;
  status: string;
  status_text: string | null;
  checked_at: any;
  models: string[];
  billed: boolean;
  max_concurrent: number | null;
  prices: Record<string, any>;
}

const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

const envKeyFor = (type: ProviderType) => (type === 'anthropic' ? process.env.ANTHROPIC_API_KEY : undefined);

export function toProvider(r: ProviderRow & { used_by?: number }): Provider {
  const fromEnv = !r.api_key_enc && !!envKeyFor(r.type);
  const prices = r.prices ?? {};
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    baseUrl: r.base_url,
    enabled: r.enabled,
    builtIn: r.built_in,
    status: r.status as Provider['status'],
    statusText: r.status_text,
    checkedAt: iso(r.checked_at),
    models: r.models ?? [],
    key: { set: !!r.api_key_enc || fromEnv, masked: r.key_last4 ? `••••${r.key_last4}` : fromEnv ? 'from ANTHROPIC_API_KEY' : null, fromEnv },
    billed: r.billed,
    maxConcurrent: r.max_concurrent,
    prices,
    unpriced: r.billed ? (r.models ?? []).filter((m) => !prices[m] && !DEFAULT_PRICES[m]) : [],
    usedBy: Number(r.used_by ?? 0),
  };
}

export const PROVIDER_SELECT = `
  SELECT p.*, (SELECT count(*)::int FROM agents a WHERE a.provider_id = p.id OR a.fallback_provider_id = p.id) AS used_by
  FROM providers p`;

export async function getProviderRow(q: Queryable, id: string): Promise<ProviderRow | null> {
  const { rows } = await q.query(`SELECT * FROM providers WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export function apiKeyOf(r: Pick<ProviderRow, 'type' | 'api_key_enc'>): string | undefined {
  if (r.api_key_enc) return decrypt(r.api_key_enc);
  return envKeyFor(r.type);
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

// Lists the models a provider serves. Used by "Test" and to fill model pickers.
export async function discoverModels(type: ProviderType, baseUrl: string, apiKey: string | undefined): Promise<string[]> {
  if (type === 'rules') return ['rules-v1'];
  const base = trimSlash(baseUrl);
  const signal = AbortSignal.timeout(15_000);
  let res: Response;
  if (type === 'anthropic') {
    if (!apiKey) throw new Error('No API key saved');
    res = await fetch(`${base}/v1/models?limit=100`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal });
  } else if (type === 'ollama') {
    if (!apiKey) throw new Error('No API key saved');
    res = await fetch(`${base}/api/tags`, { headers: { authorization: `Bearer ${apiKey}` }, signal });
  } else {
    res = await fetch(`${base}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal });
  }
  if (res.status === 401 || res.status === 403) throw new Error(`The provider refused the key (${res.status})`);
  if (!res.ok) throw new Error(`The provider answered ${res.status} ${res.statusText}`);
  const body: any = await res.json();
  const ids: string[] =
    type === 'ollama' ? (body.models ?? []).map((m: any) => m.name ?? m.model) : (body.data ?? []).map((m: any) => m.id);
  return ids.filter(Boolean).sort();
}
