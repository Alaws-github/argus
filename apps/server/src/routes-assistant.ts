// Assistant API: a person's conversation about a use case or a register, and
// applying or discarding what the assistant suggests.
import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { clientIp } from './context.js';
import { emit } from './realtime.js';
import { answer, assistantTarget, ASSISTANT_RULES_VERSION, buildContext, CONTEXT_KINDS, INTERNAL_TOKEN, toMessage, toRequest } from './assistant.js';
import { recordSpend } from './verifier.js';
import { AssistantSuggestion } from '@gh/shared';

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const toConversation = (c: any) => ({ id: c.id, title: c.title, kind: c.context_kind, contextId: c.context_id, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at) });
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));
const titleOf = (q: string) => { const t = q.replace(/\s+/g, ' ').trim(); return t.length > 70 ? `${t.slice(0, 67)}...` : t; };
const snippet = (text: string, q: string) => { const i = text.toLowerCase().indexOf(q.toLowerCase()); const from = Math.max(0, i - 40); return `${from ? '...' : ''}${text.slice(from, from + 120).replace(/\s+/g, ' ')}`; };
const Thread = z.object({ kind: z.enum(CONTEXT_KINDS), contextId: z.string().max(80).default('') });

export function assistantRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  // Conversations belong to the person who started them; nobody else can read them.
  const ownConversation = async (req: Request, cid: string) => {
    const { rows } = await db.query(`SELECT * FROM assistant_conversations WHERE id = $1 AND engagement_id = $2`, [cid, req.params.id]);
    if (!rows[0] || rows[0].user_id !== req.user!.id) throw httpError(404, 'Conversation not found');
    return rows[0];
  };
  const messagesOf = async (cid: string) =>
    (await db.query(`SELECT * FROM assistant_messages WHERE conversation_id = $1 ORDER BY created_at LIMIT 400`, [cid])).rows.map(toMessage);
  const latestFor = async (req: Request, kind: string, contextId: string) =>
    (await db.query(`SELECT * FROM assistant_conversations WHERE engagement_id = $1 AND user_id = $2 AND context_kind = $3 AND context_id = $4 ORDER BY updated_at DESC LIMIT 1`,
      [req.params.id, req.user!.id, kind, contextId])).rows[0] ?? null;

  // The latest conversation about a record (kept for the card drawer and older clients).
  r.get('/engagements/:id/assistant', wrap(async (req, res) => {
    const t = Thread.parse({ kind: req.query.kind, contextId: req.query.contextId ?? '' });
    const c = await latestFor(req, t.kind, t.contextId);
    const target = await assistantTarget(db);
    res.json({ conversation: c ? toConversation(c) : null, messages: c ? await messagesOf(c.id) : [], model: target ? target.model : null, rulesVersion: ASSISTANT_RULES_VERSION });
  }));

  // Your conversations, newest first. q searches titles and every message.
  r.get('/engagements/:id/assistant/conversations', wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const { rows } = await db.query(
      `SELECT c.*, (SELECT count(*) FROM assistant_messages m WHERE m.conversation_id = c.id)::int AS messages,
              ${q ? `(SELECT m.text FROM assistant_messages m WHERE m.conversation_id = c.id AND m.text ILIKE $3 ORDER BY m.created_at LIMIT 1)` : 'NULL'} AS match
       FROM assistant_conversations c WHERE c.engagement_id = $1 AND c.user_id = $2
       ${q ? `AND (c.title ILIKE $3 OR EXISTS (SELECT 1 FROM assistant_messages m WHERE m.conversation_id = c.id AND m.text ILIKE $3))` : ''}
       ORDER BY c.updated_at DESC LIMIT 100`,
      q ? [req.params.id, req.user!.id, like] : [req.params.id, req.user!.id],
    );
    res.json(rows.map((c: any) => ({ ...toConversation(c), messages: c.messages, match: c.match ? snippet(c.match, q) : null })));
  }));

  r.get('/engagements/:id/assistant/conversations/:cid', wrap(async (req, res) => {
    const c = await ownConversation(req, req.params.cid);
    const target = await assistantTarget(db);
    res.json({ conversation: toConversation(c), messages: await messagesOf(c.id), model: target ? target.model : null, rulesVersion: ASSISTANT_RULES_VERSION });
  }));

  r.patch('/engagements/:id/assistant/conversations/:cid', wrap(async (req, res) => {
    const b = z.object({ title: z.string().trim().min(1).max(120) }).parse(req.body);
    await ownConversation(req, req.params.cid);
    const { rows } = await db.query(`UPDATE assistant_conversations SET title = $2 WHERE id = $1 RETURNING *`, [req.params.cid, b.title]);
    res.json(toConversation(rows[0]));
  }));

  // Ask. Carries on the conversation named, or with newConversation starts one;
  // with neither it carries on the latest one about this record.
  r.post('/engagements/:id/assistant', wrap(async (req, res) => {
    const b = Thread.extend({
      question: z.string().trim().min(2).max(2000),
      conversationId: z.string().uuid().nullish(),
      newConversation: z.boolean().optional(),
      page: z.object({ path: z.string().max(200), snapshot: z.string().max(20000).default('') }).nullish(),
    }).parse(req.body);
    const ctx = await buildContext(db, req.params.id, b.kind, b.contextId || null, b.page ?? null);
    let conv = b.conversationId ? await ownConversation(req, b.conversationId) : b.newConversation ? null : await latestFor(req, b.kind, b.contextId);
    const hist = conv
      ? (await db.query(`SELECT role, text FROM assistant_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 8`, [conv.id])).rows.reverse()
      : [];
    const reply = await answer(db, req.params.id, ctx, b.question, hist);
    const out = await db.tx(async (q) => {
      if (!conv) {
        conv = (await q.query(
          `INSERT INTO assistant_conversations (engagement_id, user_id, title, context_kind, context_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.params.id, req.user!.id, titleOf(b.question), b.kind, b.contextId],
        )).rows[0];
      } else {
        await q.query(`UPDATE assistant_conversations SET updated_at = now() WHERE id = $1`, [conv.id]);
      }
      const ins = (role: string, text: string, extra: any = {}) =>
        q.query(
          `INSERT INTO assistant_messages (engagement_id, user_id, conversation_id, context_kind, context_id, page, role, text, citations, passages, suggestions, dropped, model, runtime, author, basis, trail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
          [req.params.id, req.user!.id, conv.id, b.kind, b.contextId, ctx.page?.path ?? null, role, text, JSON.stringify(extra.citations ?? []), JSON.stringify(extra.passages ?? []),
            JSON.stringify(extra.suggestions ?? []), JSON.stringify(extra.dropped ?? []), extra.model ?? null, extra.runtime ?? null, role === 'user' ? actorOf(req) : 'Assistant', JSON.stringify(extra.basis ?? []), JSON.stringify(extra.trail ?? [])],
        );
      const u = (await ins('user', b.question)).rows[0];
      const a = (await ins('assistant', reply.text, reply)).rows[0];
      await recordSpend(q, 'assistant', reply.model, reply.costUsd);
      await logAudit(q, actorOf(req), 'assistant.answered', `assistant:${b.kind}${b.contextId ? `:${ctx.label.split(' ')[0]}` : ''}`, {
        question: b.question.slice(0, 300), page: ctx.page?.path ?? null, model: reply.model, runtime: reply.runtime, citations: reply.citations, suggestions: reply.suggestions.length, dropped: reply.dropped,
      });
      return [u, a];
    });
    res.status(201).json(out.map(toMessage));
  }));

  const loadSuggestion = async (req: Request) => {
    const { rows } = await db.query(`SELECT * FROM assistant_messages WHERE id = $1 AND engagement_id = $2`, [req.params.mid, req.params.id]);
    const m = rows[0];
    if (!m) throw httpError(404, 'Message not found');
    if (m.user_id !== req.user!.id) throw httpError(403, 'Suggestions belong to the person who asked');
    const i = (m.suggestions ?? []).findIndex((s: any) => s.id === req.params.sid);
    if (i < 0) throw httpError(404, 'Suggestion not found');
    if (m.suggestions[i].status === 'applied' || m.suggestions[i].status === 'discarded') throw httpError(409, `Already ${m.suggestions[i].status}`);
    return { m, i, s: m.suggestions[i] };
  };
  const setStatus = (q: any, mid: string, i: number, patch: Record<string, unknown>) =>
    q.query(`UPDATE assistant_messages SET suggestions = jsonb_set(suggestions, ARRAY[$2::text], suggestions->$3::int || $4::jsonb) WHERE id = $1`, [mid, String(i), i, JSON.stringify(patch)]);

  // Apply: replay the change through the API as this person. Their role,
  // segregation of duties, exit criteria and the change's own audit entry all
  // apply; the assistant gets no extra power.
  r.post('/engagements/:id/assistant/:mid/suggestions/:sid/apply', wrap(async (req, res) => {
    const { m, i, s } = await loadSuggestion(req);
    const parsed = AssistantSuggestion.parse(s);
    const call = toRequest(req.params.id, parsed);
    const resp = await fetch(`http://127.0.0.1:${req.socket.localPort}/api${call.path}`, {
      method: call.method,
      headers: { 'content-type': 'application/json', cookie: req.headers.cookie ?? '', 'x-gh-internal': INTERNAL_TOKEN, 'x-gh-client-ip': clientIp(req) ?? '' },
      body: JSON.stringify(call.body),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      await setStatus(db, m.id, i, { status: 'failed', error: String(body.error ?? resp.status).slice(0, 400) });
      throw httpError(resp.status, body.error ?? 'The change was refused');
    }
    await db.tx(async (q) => {
      await setStatus(q, m.id, i, { status: 'applied', by: actorOf(req), at: new Date().toISOString(), error: null });
      await logAudit(q, actorOf(req), 'assistant.suggestion_applied', `assistant:${m.context_kind}`, { kind: parsed.kind, title: parsed.title, proposedBy: m.model === 'rules' ? 'offline assistant' : m.model, request: `${call.method} ${call.path}` });
    });
    emit('assistant', { engagementId: req.params.id });
    res.json({ ok: true, result: body });
  }));

  r.post('/engagements/:id/assistant/:mid/suggestions/:sid/discard', wrap(async (req, res) => {
    const { m, i, s } = await loadSuggestion(req);
    await db.tx(async (q) => {
      await setStatus(q, m.id, i, { status: 'discarded', by: actorOf(req), at: new Date().toISOString() });
      await logAudit(q, actorOf(req), 'assistant.suggestion_discarded', `assistant:${m.context_kind}`, { kind: s.kind, title: s.title });
    });
    res.json({ ok: true });
  }));
}
