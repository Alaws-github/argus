// The knowledge base: trusted text the agents must ground their drafts in.
// Shared passages (framework summaries, library controls, methodology) plus
// each engagement's own material (the client description, use case profiles,
// evidence notes and text files, uploaded client documents).
//
// Search is hybrid: Postgres full-text search for exact terms ("Article 14",
// "GOVERN 1.6") and, when an embedding provider is set, vector similarity for
// meaning. The two rankings are merged with reciprocal rank fusion.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SourcePassage } from '@gh/shared';
import { DATA_DIR, vectorAvailable, type Db, type Queryable } from './db.js';
import { LIBRARY, OBLIGATIONS } from './library.js';
import { apiKeyOf, getProviderRow } from './providers.js';
import { getSettings } from './store.js';

const FRAMEWORK_LINKS: Record<string, string> = {
  'EU AI Act': 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
  'NIST AI RMF': 'https://www.nist.gov/itl/ai-risk-management-framework',
  'ISO/IEC 42001': 'https://www.iso.org/standard/81230.html',
  'OWASP LLM Top 10': 'https://genai.owasp.org/llm-top-10/',
};

// Working guidance in the harness's own words, so agents apply the same
// method a careful assessor would. Not a quotation of any standard.
const METHODOLOGY: { ref: string; title: string; text: string }[] = [
  {
    ref: 'M-TIERS', title: 'Risk tiers',
    text: 'Classify each AI use case into one of four tiers modelled on the EU AI Act. Prohibited: practices that manipulate people, exploit vulnerabilities, score people socially, or identify them biometrically in public in ways the Act bans. High: the system shapes decisions about individuals in areas such as credit, employment, insurance, education, essential services or law enforcement, or is a safety component. Limited: people interact with the AI or see AI-generated content, so transparency duties apply. Minimal: everything else. When signals are mixed, choose the higher tier and say why.',
  },
  {
    ref: 'M-OVERSIGHT', title: 'Human oversight models',
    text: 'Human in command: a person makes the decision and the AI only informs it; required for high-tier decisions about individuals. Human in the loop: a person approves each output before it takes effect. Human on the loop: the AI acts and a person monitors and can intervene. The more an output affects a person and the harder it is to reverse, the closer the person must be to the decision.',
  },
  {
    ref: 'M-SAMPLING', title: 'Sample sizes for testing controls',
    text: 'Typical practice for testing whether a manual control operated: annual control, 1 instance; quarterly, 2; monthly, 2 to 5; weekly, 5 to 15; daily, 20 to 40; many times a day, 25 to 60. Choose the higher end when the control is key, the risk is high, or prior testing found exceptions. Automated controls can be tested once if change management over them is effective. A sample is only valid if drawn from the whole population for the period.',
  },
  {
    ref: 'M-EVIDENCE', title: 'Strength of evidence',
    text: 'From strongest to weakest: evidence the assessor produced (re-performance, inspecting the system directly); system-generated records covering the whole period (logs, exports with timestamps); documents signed or approved at the time; screenshots; walkthrough notes and interviews. Walkthrough notes show how a control is meant to work, not that it operated. A pass should rest on evidence covering the sample, not on a description.',
  },
  {
    ref: 'M-EXCEPTIONS', title: 'Exceptions and conclusions',
    text: 'An exception is an item in the sample where the control did not operate as designed. A test with any exception is not a pass. Record the number of exceptions, what went wrong and why. One exception in a key control is usually enough to conclude the control is not operating effectively; raise an issue and agree a fix and a retest.',
  },
  {
    ref: 'M-FINDINGS', title: 'Writing findings',
    text: 'A good finding states the condition (what was found), the criteria (what should be), the cause (why it happened), the effect (why it matters) and the recommendation (what to do, and who owns it). Write so a director can act on it. Do not soften a failure.',
  },
  {
    ref: 'M-AGENTS', title: 'AI agents acting on their own',
    text: 'Before an AI agent may act without a person approving each step, it needs a named owner, its own identity, a written mandate of what it may do and touch, limits on value or volume, a threshold above which a person approves, a step limit, a kill switch tested in the last 90 days and an independent review in the last 90 days.',
  },
];

const STOP = new Set('the a an and or of to in on for with by is are be as at it its this that from was were not no can may must should will into than then their there these those which who what when how why our your'.split(' '));

// Split text into passages of roughly 900 characters on paragraph boundaries.
export function chunk(text: string, max = 900): string[] {
  const paras = text.replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (p.length > max) {
      if (cur) out.push(cur), (cur = '');
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
      continue;
    }
    if ((cur + '\n\n' + p).length > max && cur) out.push(cur), (cur = '');
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

// ------------------------------------------------------------- embeddings
interface Embedder { model: string; embed: (texts: string[]) => Promise<number[][]> }

// The embedding provider is a workspace setting: any OpenAI-compatible
// /embeddings endpoint (OpenAI, Voyage, local Ollama at /v1, LM Studio) or
// Ollama's own /api/embed. Null when none is set.
export async function getEmbedder(q: Queryable): Promise<Embedder | null> {
  if (!vectorAvailable) return null;
  const s = await getSettings(q);
  if (!s.embedProviderId || !s.embedModel) return null;
  const p = await getProviderRow(q, s.embedProviderId);
  if (!p || !p.enabled || p.type === 'rules' || p.type === 'anthropic') return null;
  const key = apiKeyOf(p);
  const base = p.base_url.replace(/\/+$/, '');
  return {
    model: `${p.id}:${s.embedModel}`,
    embed: async (texts) => {
      const native = p.type === 'ollama';
      const res = await fetch(native ? `${base}/api/embed` : `${base}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: s.embedModel, input: texts }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`${res.status} from the embedding provider: ${(await res.text()).slice(0, 200)}`);
      const j: any = await res.json();
      const vecs: number[][] = native ? j.embeddings : (j.data ?? []).sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
      if (!Array.isArray(vecs) || vecs.length !== texts.length) throw new Error('The embedding provider returned the wrong number of vectors');
      return vecs;
    },
  };
}

const toVec = (v: number[]) => `[${v.map((x) => Number(x).toFixed(6)).join(',')}]`;

// Embed any chunks that lack a vector for the current model. Best effort: a
// failure leaves them keyword-searchable.
export async function embedPending(db: Db, engagementId?: string | null) {
  const e = await getEmbedder(db);
  if (!e) return { embedded: 0, note: 'No embedding provider set, so search is keyword only' };
  let embedded = 0;
  for (;;) {
    const { rows } = await db.query(
      `SELECT id, heading, text FROM kb_chunks WHERE embed_model IS DISTINCT FROM $1 ${engagementId === undefined ? '' : 'AND (engagement_id = $2 OR engagement_id IS NULL)'} LIMIT 32`,
      engagementId === undefined ? [e.model] : [e.model, engagementId],
    );
    if (!rows.length) break;
    const vecs = await e.embed(rows.map((r: any) => `${r.heading}\n${r.text}`.slice(0, 4000)));
    for (let i = 0; i < rows.length; i++) await db.query(`UPDATE kb_chunks SET embedding = $2::vector, embed_model = $3 WHERE id = $1`, [rows[i].id, toVec(vecs[i]), e.model]);
    embedded += rows.length;
  }
  return { embedded, note: `${embedded} passages embedded` };
}

// ----------------------------------------------------------------- ingest
export interface SourceInput {
  engagementId: string | null;
  kind: 'framework' | 'control' | 'methodology' | 'client' | 'use_case' | 'evidence' | 'upload';
  title: string;
  ref: string;
  text: string;
  origin?: string;
  evidenceId?: string | null;
  cardId?: string | null;
  createdBy?: string;
}

// Replace a source's passages (idempotent by kind + ref + engagement).
export async function upsertSource(q: Queryable, s: SourceInput) {
  const { rows: old } = await q.query(
    `SELECT id FROM kb_sources WHERE kind = $1 AND ref = $2 AND engagement_id IS NOT DISTINCT FROM $3`,
    [s.kind, s.ref, s.engagementId],
  );
  if (old[0]) await q.query(`DELETE FROM kb_sources WHERE id = $1`, [old[0].id]);
  const { rows } = await q.query(
    `INSERT INTO kb_sources (engagement_id, kind, title, ref, origin, evidence_id, card_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [s.engagementId, s.kind, s.title, s.ref, s.origin ?? 'built_in', s.evidenceId ?? null, s.cardId ?? null, s.createdBy ?? 'system'],
  );
  const parts = chunk(s.text);
  for (let i = 0; i < parts.length; i++) {
    await q.query(`INSERT INTO kb_chunks (source_id, engagement_id, ord, heading, text) VALUES ($1,$2,$3,$4,$5)`, [rows[0].id, s.engagementId, i, s.title, parts[i]]);
  }
  return { id: rows[0].id as string, chunks: parts.length };
}

// Shared passages every engagement can use. Runs on every start; only adds
// what is missing.
export async function ensureKnowledge(q: Queryable) {
  const { rows } = await q.query(`SELECT kind, ref FROM kb_sources WHERE engagement_id IS NULL`);
  const have = new Set(rows.map((r: any) => `${r.kind}:${r.ref}`));
  const add = async (s: SourceInput) => {
    if (!have.has(`${s.kind}:${s.ref}`)) await upsertSource(q, s);
  };
  for (const o of OBLIGATIONS) {
    await add({
      engagementId: null, kind: 'framework', ref: `${o.source} ${o.ref}`, title: `${o.source} ${o.ref}: ${o.title}`,
      text: `${o.summary}\n\nIn the harness this is met by the library controls ${o.codes.join(', ')}.${FRAMEWORK_LINKS[o.source] ? `\n\nOfficial text: ${FRAMEWORK_LINKS[o.source]}` : ''}\n\n(Summary in the harness's own words, not a quotation.)`,
    });
  }
  for (const c of LIBRARY) {
    const refs = Object.entries(c.refs).map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join('; ');
    await add({
      engagementId: null, kind: 'control', ref: c.code, title: `${c.code} ${c.title}`,
      text: `Objective: ${c.objective}\n\nType: ${c.type}, ${c.frequency}. Treats: ${c.categories.join(', ')}.\n\nTest procedure: ${c.test}\n\nEvidence usually expected: ${c.evidence}\n\nMaps to: ${refs}`,
    });
  }
  for (const m of METHODOLOGY) await add({ engagementId: null, kind: 'methodology', ref: m.ref, title: m.title, text: m.text });
}

const TEXTY = /^text\/|json|csv|xml|markdown/;

// Index an evidence item so agents can retrieve it. Notes and text files only.
export async function indexEvidence(q: Queryable, e: any) {
  let text = '';
  if (e.kind === 'note') text = e.note ?? '';
  else if (e.kind === 'file' && (TEXTY.test(e.mime ?? '') || /\.(txt|csv|md|json|log)$/i.test(e.filename ?? ''))) {
    const path = resolve(DATA_DIR, 'evidence', e.sha256);
    if (existsSync(path) && statSync(path).size < 400_000) text = readFileSync(path, 'utf8');
  }
  if (!text.trim()) return;
  await upsertSource(q, { engagementId: e.engagement_id, kind: 'evidence', ref: `E-${e.number}`, title: `E-${e.number} ${e.title}`, text, origin: 'evidence', evidenceId: e.id, createdBy: e.collected_by });
}

export async function indexUseCase(q: Queryable, card: any) {
  const u = card.use_case ?? card.useCase;
  const text = [`Business owner: ${u.businessOwner || 'not stated'}`, `What it does: ${u.description || 'not stated'}`, `Data used: ${u.dataUsed || 'not stated'}`,
    `People affected: ${u.affectedPeople || 'not stated'}`, `Autonomy: ${u.autonomy}`, `Vendor or model: ${u.vendor || 'not stated'}`].join('\n\n');
  await upsertSource(q, { engagementId: card.engagement_id ?? card.engagementId, kind: 'use_case', ref: card.key, title: `${card.key} ${card.title}`, text, origin: 'card', cardId: card.id });
}

export async function indexEngagement(q: Queryable, e: { id: string; name: string; client: string; about: string }) {
  if (!e.about?.trim()) return;
  await upsertSource(q, { engagementId: e.id, kind: 'client', ref: 'about', title: `About ${e.client || e.name}`, text: e.about });
}

// ----------------------------------------------------------------- search
export interface SearchOptions { kinds?: string[]; limit?: number }

const toPassage = (r: any): SourcePassage => ({
  id: `K-${r.number}`, title: r.heading, kind: r.kind, ref: r.ref, text: r.text, score: Number(r.score ?? 0),
});

// Hybrid search over the shared passages and one engagement's own.
export async function search(db: Db, engagementId: string | null, query: string, opts: SearchOptions = {}): Promise<SourcePassage[]> {
  const limit = opts.limit ?? 6;
  // Words of three or more letters, and any number (so "Article 14" keeps its 14).
  const words = [...new Set((query.toLowerCase().match(/[a-z]{3,}|\d+/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 24);
  const scope = `(c.engagement_id IS NULL OR c.engagement_id = $1)${opts.kinds?.length ? ` AND s.kind = ANY($2)` : ''}`;
  const base = opts.kinds?.length ? [engagementId, opts.kinds] : [engagementId];
  const select = `SELECT c.number, c.heading, c.text, s.kind, s.ref FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id`;

  const lists: any[][] = [];
  if (words.length) {
    // Rank first by how many of the query's terms a passage contains, then by
    // density, so a passage matching every term beats one repeating a single word.
    const n = base.length;
    const covered = words.map((_, i) => `(c.tsv @@ to_tsquery('english', $${n + 2 + i}))::int`).join(' + ');
    const { rows } = await db.query(
      `${select.replace('SELECT', `SELECT (${covered}) AS covered, ts_rank_cd(c.tsv, to_tsquery('english', $${n + 1}), 32) AS score,`)}
       WHERE ${scope} AND c.tsv @@ to_tsquery('english', $${n + 1}) ORDER BY covered DESC, score DESC LIMIT 20`,
      [...base, words.join(' | '), ...words],
    );
    lists.push(rows);
  }
  const e = await getEmbedder(db).catch(() => null);
  if (e) {
    try {
      const [v] = await e.embed([query.slice(0, 2000)]);
      const { rows } = await db.query(
        `${select.replace('SELECT', `SELECT 1 - (c.embedding <=> $${base.length + 1}::vector) AS score,`)} WHERE ${scope} AND c.embed_model = $${base.length + 2} ORDER BY c.embedding <=> $${base.length + 1}::vector LIMIT 20`,
        [...base, toVec(v), e.model],
      );
      lists.push(rows);
    } catch (err: any) {
      console.warn(`[kb] meaning search skipped: ${err.message}`);
    }
  }
  // Reciprocal rank fusion: a passage near the top of either list wins.
  const fused = new Map<number, { row: any; score: number }>();
  for (const list of lists) list.forEach((row, i) => {
    const f = fused.get(row.number) ?? { row, score: 0 };
    f.score += 1 / (60 + i + 1);
    fused.set(row.number, f);
  });
  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((f) => toPassage({ ...f.row, score: f.score }));
}

// What an agent sees: each passage tagged with its id, marked as data.
export function sourcesBlock(passages: SourcePassage[]) {
  if (!passages.length) return '<sources>None found.</sources>';
  return ['<sources>', ...passages.map((p) => `<source id="${p.id}" kind="${p.kind}" title="${p.title.replace(/"/g, "'")}">\n${p.text}\n</source>`), '</sources>'].join('\n');
}

// Every id an agent cites must be one it was given.
export function strayCitations(cited: string[], given: SourcePassage[]) {
  const ok = new Set(given.map((p) => p.id));
  return [...new Set(cited.filter((c) => !ok.has(c)))];
}

// Stored on a draft so the reviewer can read exactly what the agent saw.
export const snapshot = (passages: SourcePassage[], cited: string[]) =>
  passages.filter((p) => cited.includes(p.id)).map((p) => ({ ...p, text: p.text.slice(0, 1200) }));

// Shared passages by their source ref, for guidance an agent must always see
// (for example the tier rules or sampling guidance), whatever the search finds.
export async function pinned(q: Queryable, refs: string[]): Promise<SourcePassage[]> {
  if (!refs.length) return [];
  const { rows } = await q.query(
    `SELECT c.number, c.heading, c.text, s.kind, s.ref FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id
     WHERE s.engagement_id IS NULL AND s.ref = ANY($1) ORDER BY s.ref, c.ord`,
    [refs],
  );
  return rows.map((r: any) => toPassage({ ...r, score: 1 }));
}

// Merge passage lists without duplicates, keeping the first occurrence.
export function mergePassages(...lists: SourcePassage[][]): SourcePassage[] {
  const seen = new Set<string>();
  return lists.flat().filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

// Index an engagement's own material that isn't indexed yet: the client
// description, every use case and every readable evidence item.
export async function ensureEngagementKnowledge(q: Queryable, engagementId: string) {
  const { rows: e } = await q.query(`SELECT id, name, client, about FROM engagements WHERE id = $1`, [engagementId]);
  if (!e[0]) return;
  const { rows: have } = await q.query(`SELECT kind, ref FROM kb_sources WHERE engagement_id = $1`, [engagementId]);
  const has = new Set(have.map((r: any) => `${r.kind}:${r.ref}`));
  if (!has.has('client:about')) await indexEngagement(q, e[0]);
  const { rows: cards } = await q.query(`SELECT id, engagement_id, key, title, use_case FROM cards WHERE engagement_id = $1`, [engagementId]);
  for (const c of cards) if (!has.has(`use_case:${c.key}`)) await indexUseCase(q, c);
  const { rows: ev } = await q.query(`SELECT * FROM evidence WHERE engagement_id = $1`, [engagementId]);
  for (const x of ev) if (!has.has(`evidence:E-${x.number}`)) await indexEvidence(q, x);
}

// Embedding runs in the background after changes, a few seconds after the
// last one, so a burst of uploads is embedded in one pass.
let embedTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleEmbedding(db: Db) {
  if (embedTimer) clearTimeout(embedTimer);
  embedTimer = setTimeout(() => {
    embedTimer = null;
    embedPending(db).catch((e) => console.warn(`[kb] embedding failed: ${e.message}`));
  }, 3000);
}

// Called before the database closes (for example by db:reset).
export function cancelEmbedding() {
  if (embedTimer) clearTimeout(embedTimer);
  embedTimer = null;
}
