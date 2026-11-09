// One call shape for every provider: send a system prompt and a user message,
// force a single structured answer that matches a JSON schema, get tokens back.
import type { Effort, ProviderType } from '@gh/shared';
import { demoChatbot } from './library.js';

export interface StructuredCall {
  type: ProviderType;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  effort: Effort;
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
}

export interface StructuredResult {
  input: unknown;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
}

// Effort sets the output budget. Forced structured output can't be combined with
// extended thinking on every provider, so effort maps to room to answer.
const MAX_TOKENS: Record<Effort, number> = { low: 2000, medium: 4000, high: 8000, xhigh: 12000, max: 16000 };

const trimSlash = (u: string) => u.replace(/\/+$/, '');

// Drafting is set to temperature 0 so the same input gives the same draft.
// Some newer models refuse a temperature setting; then we retry without it.
async function postDeterministic(url: string, headers: Record<string, string>, body: Record<string, any>, timeoutMs: number, where: 'top' | 'options' = 'top') {
  const withTemp = where === 'top' ? { ...body, temperature: 0 } : { ...body, options: { ...(body.options ?? {}), temperature: 0 } };
  try {
    return await post(url, headers, withTemp, timeoutMs);
  } catch (e: any) {
    if (/^400 /.test(e.message) && /temperature/i.test(e.message)) return post(url, headers, body, timeoutMs);
    throw e;
  }
}

// Busy or briefly broken providers (rate limits on free tiers, 5xx) are
// retried with a growing wait, honouring Retry-After, within the call's time
// budget. Errors that a retry can't fix (a bad key, a bad request) fail at once.
const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = Number(process.env.LLM_ATTEMPTS || 3);
const BACKOFF_MS = Number(process.env.LLM_BACKOFF_MS || 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ProviderError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(left) });
    } catch (e: any) {
      // Our own time limit ran out: don't retry. A dropped connection: retry.
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error(`The provider didn't answer within ${Math.round(timeoutMs / 1000)} seconds`);
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) { await sleep(Math.min(BACKOFF_MS * 2 ** (attempt - 1), Math.max(0, deadline - Date.now() - 1000))); continue; }
      throw new Error(`Couldn't reach the provider: ${e?.message ?? e}`);
    }
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message ?? j.error ?? j.message ?? detail;
    } catch {
      /* not JSON */
    }
    if (typeof detail !== 'string') detail = JSON.stringify(detail).slice(0, 300);
    // Newer OpenAI models take max_completion_tokens instead of max_tokens.
    const b = body as Record<string, any>;
    if (res.status === 400 && b && b.max_tokens !== undefined && /max_tokens/.test(detail)) {
      const { max_tokens, ...rest } = b;
      return post(url, headers, { ...rest, max_completion_tokens: max_tokens }, Math.max(1000, deadline - Date.now()));
    }
    lastErr = new ProviderError(res.status, `${res.status} from the provider: ${detail}`);
    if (!RETRY_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) break;
    const after = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 20_000) : BACKOFF_MS * 2 ** (attempt - 1);
    if (Date.now() + wait >= deadline) break;
    await sleep(wait);
  }
  if (lastErr instanceof ProviderError && lastErr.status === 429) {
    throw new ProviderError(429, `${lastErr.message}. The provider is rate-limiting this key; it was tried ${MAX_ATTEMPTS} times. Wait a minute, or add a fallback model for this agent.`);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** The model stopped because it ran out of output room, so its answer is incomplete. */
export class TruncatedError extends Error {
  constructor(public maxTokens: number) {
    super(`The model ran out of room before finishing its answer (output limit ${maxTokens} tokens). Raise the agent's effort, or pick a model that doesn't spend its budget on reasoning.`);
  }
}

function parseJsonText(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : s).trim());
}

/** The model answered, but not with valid JSON. Worth one more try. */
export class MalformedError extends Error {}
const parseArgs = (raw: unknown) => {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { throw new MalformedError("The model's answer wasn't valid JSON"); }
};
const parseText = (raw: string) => {
  try { return parseJsonText(raw); } catch { throw new MalformedError("The model's answer wasn't valid JSON"); }
};

// One structured call. If the model runs out of output room it is asked once
// more with twice the room, since reasoning models spend part of it thinking.
export async function callStructured(c: StructuredCall): Promise<StructuredResult> {
  const max = MAX_TOKENS[c.effort];
  try {
    return await callOnce(c, max);
  } catch (e) {
    if (!(e instanceof TruncatedError) || max >= 32_000) throw e;
    try {
      return await callOnce(c, Math.min(max * 2, 32_000));
    } catch (e2) {
      if (e2 instanceof TruncatedError) throw new TruncatedError(Math.min(max * 2, 32_000));
      throw e2;
    }
  }
}

async function callOnce(c: StructuredCall, max: number): Promise<StructuredResult> {
  const base = trimSlash(c.baseUrl);

  if (c.type === 'anthropic') {
    if (!c.apiKey) throw new Error('This provider has no API key. Add one on Models & keys.');
    const r = await postDeterministic(
      `${base}/v1/messages`,
      { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: c.model,
        max_tokens: max,
        system: c.system,
        tools: [{ name: c.toolName, description: c.toolDescription, input_schema: c.schema }],
        tool_choice: { type: 'tool', name: c.toolName },
        messages: [{ role: 'user', content: c.user }],
      },
      c.timeoutMs,
    );
    if (r.stop_reason === 'max_tokens') throw new TruncatedError(max);
    const block = (r.content ?? []).find((b: any) => b.type === 'tool_use');
    if (!block) throw new Error('The model returned no structured answer');
    return {
      input: block.input,
      tokensIn: r.usage?.input_tokens ?? 0,
      tokensOut: r.usage?.output_tokens ?? 0,
      tokensCached: r.usage?.cache_read_input_tokens ?? 0,
    };
  }

  if (c.type === 'ollama') {
    if (!c.apiKey) throw new Error('This provider has no API key. Add one on Models & keys.');
    const r = await postDeterministic(
      `${base}/api/chat`,
      { authorization: `Bearer ${c.apiKey}` },
      {
        model: c.model,
        stream: false,
        format: c.schema,
        options: { num_predict: max },
        messages: [
          { role: 'system', content: `${c.system}\n\nAnswer with JSON only, matching the schema you were given.` },
          { role: 'user', content: c.user },
        ],
      },
      c.timeoutMs,
      'options',
    );
    if (r.done_reason === 'length') throw new TruncatedError(max);
    return {
      input: parseText(r.message?.content ?? ''),
      tokensIn: r.prompt_eval_count ?? 0,
      tokensOut: r.eval_count ?? 0,
      tokensCached: 0,
    };
  }

  if (c.type === 'openai') {
    const url = `${base}/chat/completions`;
    const headers: Record<string, string> = c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {};
    const messages = [
      { role: 'system', content: c.system },
      { role: 'user', content: c.user },
    ];
    let r: any;
    try {
      r = await postDeterministic(url, headers, {
        model: c.model,
        max_tokens: max,
        messages,
        tools: [{ type: 'function', function: { name: c.toolName, description: c.toolDescription, parameters: c.schema } }],
        tool_choice: { type: 'function', function: { name: c.toolName } },
      }, c.timeoutMs);
    } catch (e: any) {
      // Some services (Perplexity, some gateways) don't take tool calls. Ask for
      // JSON matching the schema instead; the answer is validated the same way.
      if (!/^400 /.test(e.message) || !/tool|function/i.test(e.message)) throw e;
      const jsonMessages = [{ role: 'system', content: `${c.system}\n\nAnswer with one JSON object only, matching this schema:\n${JSON.stringify(c.schema)}` }, messages[1]];
      try {
        r = await postDeterministic(url, headers, {
          model: c.model, max_tokens: max, messages: jsonMessages,
          response_format: { type: 'json_schema', json_schema: { name: c.toolName, schema: c.schema } },
        }, c.timeoutMs);
      } catch (e2: any) {
        if (!/^400 /.test(e2.message)) throw e2;
        r = await postDeterministic(url, headers, { model: c.model, max_tokens: max, messages: jsonMessages }, c.timeoutMs);
      }
    }
    if (r.choices?.[0]?.finish_reason === 'length') throw new TruncatedError(max);
    const msg = r.choices?.[0]?.message ?? {};
    const call = msg.tool_calls?.[0]?.function?.arguments;
    // Some local servers ignore tool_choice and answer in plain text; accept JSON there too.
    const input = call ? parseArgs(call) : parseText(msg.content ?? '');
    return {
      input,
      tokensIn: r.usage?.prompt_tokens ?? 0,
      tokensOut: r.usage?.completion_tokens ?? 0,
      tokensCached: r.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };
  }

  throw new Error(`Provider type ${c.type} can't make model calls`);
}

// ---------------------------------------------------------------------------
// One repair attempt. check() lists what is wrong with an answer's format
// (a field out of range, a misspelt option, missing JSON). The model is shown
// its answer and the problems and asked once to correct them. The caller's
// own strict checks still run on whatever comes back, so a repair can never
// let through something the rules refuse.
// ---------------------------------------------------------------------------
export interface CheckedResult extends StructuredResult { repaired: string[] }
export async function callStructuredChecked(c: StructuredCall, check: (input: unknown) => string[]): Promise<CheckedResult> {
  let first: StructuredResult | null = null;
  let problems: string[];
  try {
    first = await callStructured(c);
    problems = check(first.input);
    if (!problems.length) return { ...first, repaired: [] };
  } catch (e) {
    if (!(e instanceof MalformedError)) throw e;
    problems = [e.message];
  }
  const shown = first ? JSON.stringify(first.input).slice(0, 12_000) : '(not valid JSON)';
  const second = await callStructured({
    ...c,
    user: `${c.user}\n\n<previous_answer>${shown}</previous_answer>\n<problems>\n${problems.slice(0, 20).map((p) => `- ${p}`).join('\n')}\n</problems>\nYour previous answer had the problems listed. Return the whole answer again with them corrected. Change nothing else.`,
  });
  return {
    ...second,
    tokensIn: second.tokensIn + (first?.tokensIn ?? 0),
    tokensOut: second.tokensOut + (first?.tokensOut ?? 0),
    tokensCached: second.tokensCached + (first?.tokensCached ?? 0),
    repaired: problems,
  };
}

/** Zod issues as short lines a model can act on. */
export const zodProblems = (schema: { safeParse: (x: unknown) => any }) => (input: unknown): string[] => {
  const p = schema.safeParse(input);
  return p.success ? [] : p.error.issues.map((i: any) => `${i.path.join('.') || 'answer'}: ${i.message}`);
};

// ---------------------------------------------------------------------------
// One turn of a tool-using conversation (v1.6 agent loop). The transcript is
// provider-neutral; each provider's message shapes are built here. The model
// may call any of the tools, or the caller may force one (forceTool).
// ---------------------------------------------------------------------------
export interface ToolSpec { name: string; description: string; schema: Record<string, unknown> }
export interface ToolCall {
  id: string; name: string; args: unknown; raw?: string;
  /** Provider-specific fields on the call that must be sent back unchanged on the next step,
   * such as Gemini's thought signature (`extra_content.google.thought_signature`). */
  extra?: Record<string, unknown>;
}
export type ChatMsg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; calls: ToolCall[] }
  | { role: 'tool'; callId: string; name: string; content: string };
export interface ChatStepCall {
  type: ProviderType; baseUrl: string; apiKey: string | undefined; model: string; effort: Effort;
  system: string; messages: ChatMsg[]; tools: ToolSpec[]; forceTool?: string | null; timeoutMs: number;
}
export interface ChatStepResult { text: string; calls: ToolCall[]; tokensIn: number; tokensOut: number; tokensCached: number }
/** The provider refused tool use for this model; the caller falls back to a single call. */
export class ToolsUnsupportedError extends Error {}

let callSeq = 0;
const newId = () => `call_${Date.now().toString(36)}_${(callSeq++).toString(36)}`;
const safeArgs = (raw: unknown): { args: unknown; raw?: string } => {
  if (typeof raw !== 'string') return { args: raw ?? {} };
  try { return { args: JSON.parse(raw) }; } catch { return { args: null, raw }; }
};

export async function chatStep(c: ChatStepCall): Promise<ChatStepResult> {
  const max = MAX_TOKENS[c.effort];
  try {
    return await chatOnce(c, max);
  } catch (e) {
    if (!(e instanceof TruncatedError) || max >= 32_000) throw e;
    return chatOnce(c, Math.min(max * 2, 32_000));
  }
}

async function chatOnce(c: ChatStepCall, max: number): Promise<ChatStepResult> {
  const base = trimSlash(c.baseUrl);
  if (c.type === 'anthropic') {
    if (!c.apiKey) throw new Error('This provider has no API key. Add one on Models & keys.');
    const messages: any[] = [];
    for (const m of c.messages) {
      if (m.role === 'user') messages.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant') messages.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.calls.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.args ?? {} }))] });
      else {
        const block = { type: 'tool_result', tool_use_id: m.callId, content: m.content };
        const last = messages[messages.length - 1];
        if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(block);
        else messages.push({ role: 'user', content: [block] });
      }
    }
    const r = await postDeterministic(`${base}/v1/messages`, { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }, {
      model: c.model, max_tokens: max,
      // The rules and tool list repeat on every turn: cache them.
      system: [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }],
      tools: c.tools.map((t, i) => ({ name: t.name, description: t.description, input_schema: t.schema, ...(i === c.tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) })),
      tool_choice: c.forceTool ? { type: 'tool', name: c.forceTool } : { type: 'auto' },
      messages,
    }, c.timeoutMs);
    if (r.stop_reason === 'max_tokens') throw new TruncatedError(max);
    const blocks = r.content ?? [];
    return {
      text: blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n'),
      calls: blocks.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, args: b.input })),
      tokensIn: r.usage?.input_tokens ?? 0, tokensOut: r.usage?.output_tokens ?? 0, tokensCached: r.usage?.cache_read_input_tokens ?? 0,
    };
  }

  // OpenAI-compatible and Ollama share the chat shape; Ollama sends arguments as objects.
  const ollama = c.type === 'ollama';
  if (ollama && !c.apiKey) throw new Error('This provider has no API key. Add one on Models & keys.');
  const messages: any[] = [{ role: 'system', content: c.system }];
  for (const m of c.messages) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.content || (ollama ? '' : null), tool_calls: m.calls.map((t) => (ollama ? { function: { name: t.name, arguments: t.args ?? {} } } : { ...(t.extra ?? {}), id: t.id, type: 'function', function: { name: t.name, arguments: t.raw ?? JSON.stringify(t.args ?? {}) } })) });
    else messages.push(ollama ? { role: 'tool', content: m.content } : { role: 'tool', tool_call_id: m.callId, content: m.content });
  }
  const tools = c.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  const url = ollama ? `${base}/api/chat` : `${base}/chat/completions`;
  const headers: Record<string, string> = c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {};
  let r: any;
  try {
    r = ollama
      ? await postDeterministic(url, headers, { model: c.model, stream: false, options: { num_predict: max }, messages, tools }, c.timeoutMs, 'options')
      : await postDeterministic(url, headers, { model: c.model, max_tokens: max, messages, tools, tool_choice: c.forceTool ? { type: 'function', function: { name: c.forceTool } } : 'auto' }, c.timeoutMs);
  } catch (e: any) {
    // A 400 about tools or function calls (including a missing Gemini thought signature) means
    // tool use doesn't work here: the loop falls back to a single call instead of failing.
    if (/^400 /.test(e.message) && /tool|function|thought_signature/i.test(e.message)) throw new ToolsUnsupportedError(e.message);
    throw e;
  }
  if (ollama) {
    if (r.done_reason === 'length') throw new TruncatedError(max);
    const msg = r.message ?? {};
    return {
      text: msg.content ?? '', calls: (msg.tool_calls ?? []).map((t: any) => ({ id: newId(), name: t.function?.name, ...safeArgs(t.function?.arguments) })),
      tokensIn: r.prompt_eval_count ?? 0, tokensOut: r.eval_count ?? 0, tokensCached: 0,
    };
  }
  const choice = r.choices?.[0] ?? {};
  if (choice.finish_reason === 'length') throw new TruncatedError(max);
  const msg = choice.message ?? {};
  return {
    text: typeof msg.content === 'string' ? msg.content : '',
    calls: (msg.tool_calls ?? []).map((t: any) => {
      // Keep anything beyond the standard fields (Gemini puts its thought signature in extra_content).
      const { id, type, function: fn, index, ...extra } = t ?? {};
      return { id: id ?? newId(), name: fn?.name, ...safeArgs(fn?.arguments), ...(Object.keys(extra).length ? { extra } : {}) };
    }),
    tokensIn: r.usage?.prompt_tokens ?? 0, tokensOut: r.usage?.completion_tokens ?? 0, tokensCached: r.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

// Plain chat call, used by evaluation suites to exercise the system under test.
export interface TextCall {
  type: ProviderType;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}

export async function callText(c: TextCall): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const base = trimSlash(c.baseUrl);
  if (c.type === 'rules') {
    if (c.model !== 'demo-chatbot-v1') throw new Error(`${c.model} can't answer free text. Use demo-chatbot-v1 or a model provider.`);
    return { text: demoChatbot(c.user), tokensIn: 0, tokensOut: 0 };
  }
  if (c.type === 'anthropic') {
    if (!c.apiKey) throw new Error('This provider has no API key. Add one on Models & keys.');
    const r = await post(`${base}/v1/messages`, { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }, {
      model: c.model, max_tokens: c.maxTokens, ...(c.system ? { system: c.system } : {}), messages: [{ role: 'user', content: c.user }],
    }, c.timeoutMs);
    const text = (r.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    return { text, tokensIn: r.usage?.input_tokens ?? 0, tokensOut: r.usage?.output_tokens ?? 0 };
  }
  const messages = [...(c.system ? [{ role: 'system', content: c.system }] : []), { role: 'user', content: c.user }];
  if (c.type === 'ollama') {
    if (!c.apiKey) throw new Error('This provider has no API key. Add one on Models & keys.');
    const r = await post(`${base}/api/chat`, { authorization: `Bearer ${c.apiKey}` }, { model: c.model, stream: false, options: { num_predict: c.maxTokens }, messages }, c.timeoutMs);
    return { text: r.message?.content ?? '', tokensIn: r.prompt_eval_count ?? 0, tokensOut: r.eval_count ?? 0 };
  }
  const r = await post(`${base}/chat/completions`, c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}, { model: c.model, max_tokens: c.maxTokens, messages }, c.timeoutMs);
  return { text: r.choices?.[0]?.message?.content ?? '', tokensIn: r.usage?.prompt_tokens ?? 0, tokensOut: r.usage?.completion_tokens ?? 0 };
}
