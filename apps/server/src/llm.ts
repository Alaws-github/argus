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

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message ?? j.error ?? j.message ?? detail;
    } catch {
      /* not JSON */
    }
    throw new Error(`${res.status} from the provider: ${detail}`);
  }
  return JSON.parse(text);
}

function parseJsonText(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : s).trim());
}

export async function callStructured(c: StructuredCall): Promise<StructuredResult> {
  const base = trimSlash(c.baseUrl);
  const max = MAX_TOKENS[c.effort];

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
    return {
      input: parseJsonText(r.message?.content ?? ''),
      tokensIn: r.prompt_eval_count ?? 0,
      tokensOut: r.eval_count ?? 0,
      tokensCached: 0,
    };
  }

  if (c.type === 'openai') {
    const r = await postDeterministic(
      `${base}/chat/completions`,
      c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {},
      {
        model: c.model,
        max_tokens: max,
        messages: [
          { role: 'system', content: c.system },
          { role: 'user', content: c.user },
        ],
        tools: [{ type: 'function', function: { name: c.toolName, description: c.toolDescription, parameters: c.schema } }],
        tool_choice: { type: 'function', function: { name: c.toolName } },
      },
      c.timeoutMs,
    );
    const msg = r.choices?.[0]?.message ?? {};
    const call = msg.tool_calls?.[0]?.function?.arguments;
    // Some local servers ignore tool_choice and answer in plain text; accept JSON there too.
    const input = call ? (typeof call === 'string' ? JSON.parse(call) : call) : parseJsonText(msg.content ?? '');
    return {
      input,
      tokensIn: r.usage?.prompt_tokens ?? 0,
      tokensOut: r.usage?.completion_tokens ?? 0,
      tokensCached: r.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };
  }

  throw new Error(`Provider type ${c.type} can't make model calls`);
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
