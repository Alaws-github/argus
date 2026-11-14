// AI model providers and models (the Models & keys page), prices and settings.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Providers and models (the "Models & keys" page). Shared by every engagement.
// ---------------------------------------------------------------------------
export const ProviderType = z.enum(['anthropic', 'openai', 'ollama', 'rules']);
export type ProviderType = z.infer<typeof ProviderType>;

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  anthropic: 'Anthropic format',
  openai: 'OpenAI-compatible format',
  ollama: 'Ollama format',
  rules: 'Built-in rules (offline)',
};

export const PROVIDER_DEFAULT_URLS: Record<ProviderType, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'http://localhost:1234/v1',
  ollama: 'https://ollama.com',
  rules: '',
};

// Ready-made settings for popular AI services. Most speak the OpenAI API, so
// they use the OpenAI-compatible connector with the right address filled in.
// Prices change often, so presets carry none: enter them on the Models page.
export interface ProviderPreset {
  id: string;
  label: string;
  type: Exclude<ProviderType, 'rules'>;
  name: string;
  baseUrl: string;
  billed: boolean;
  keyFrom: string;
  needsKey: boolean;
  hint: string;
  examples: string[];
}
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    type: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    billed: true,
    keyFrom: 'console.anthropic.com',
    needsKey: true,
    hint: 'Leave the address as is unless you use a gateway.',
    examples: ['claude-sonnet-5-5', 'claude-haiku-4-5'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    type: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    billed: true,
    keyFrom: 'platform.openai.com/api-keys',
    needsKey: true,
    hint: 'Test finds every model on your account.',
    examples: [],
  },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    type: 'openai',
    name: 'Azure OpenAI',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1',
    billed: true,
    keyFrom: "the Azure portal, under your resource's Keys and Endpoint",
    needsKey: true,
    hint: 'Replace YOUR-RESOURCE with your resource name. Add your deployment names as models.',
    examples: [],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    type: 'openai',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    billed: true,
    keyFrom: 'aistudio.google.com/apikey',
    needsKey: true,
    hint: "Google's OpenAI-compatible address.",
    examples: [],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    type: 'openai',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    billed: true,
    keyFrom: 'console.mistral.ai',
    needsKey: true,
    hint: 'EU-hosted models.',
    examples: [],
  },
  {
    id: 'groq',
    label: 'Groq',
    type: 'openai',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    billed: true,
    keyFrom: 'console.groq.com/keys',
    needsKey: true,
    hint: 'Fast open-weight models.',
    examples: [],
  },
  {
    id: 'together',
    label: 'Together AI',
    type: 'openai',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    billed: true,
    keyFrom: 'api.together.ai',
    needsKey: true,
    hint: 'Hosted open-weight models.',
    examples: [],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    type: 'openai',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    billed: true,
    keyFrom: 'openrouter.ai/keys',
    needsKey: true,
    hint: 'One key for models from many companies. Model names look like company/model.',
    examples: [],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    type: 'openai',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    billed: true,
    keyFrom: 'platform.deepseek.com',
    needsKey: true,
    hint: 'Check where client data is processed before using it on client work.',
    examples: [],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    type: 'openai',
    name: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    billed: true,
    keyFrom: 'console.x.ai',
    needsKey: true,
    hint: '',
    examples: [],
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    type: 'openai',
    name: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    billed: true,
    keyFrom: 'perplexity.ai/settings/api',
    needsKey: true,
    hint: 'Answers come back as JSON rather than tool calls; the harness handles that. Add model names by hand.',
    examples: ['sonar', 'sonar-pro'],
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    type: 'ollama',
    name: 'Ollama Cloud',
    baseUrl: 'https://ollama.com',
    billed: true,
    keyFrom: 'ollama.com/settings/keys',
    needsKey: true,
    hint: 'No /v1 at the end.',
    examples: [],
  },
  {
    id: 'ollama-local',
    label: 'Ollama on this computer',
    type: 'openai',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    billed: false,
    keyFrom: '',
    needsKey: false,
    hint: 'Free and private: nothing leaves the machine. Start Ollama and pull a model first.',
    examples: [],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    type: 'openai',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    billed: false,
    keyFrom: '',
    needsKey: false,
    hint: 'Start the local server in LM Studio first.',
    examples: [],
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible',
    type: 'openai',
    name: 'Custom provider',
    baseUrl: 'http://localhost:8000/v1',
    billed: false,
    keyFrom: '',
    needsKey: false,
    hint: 'vLLM, llama.cpp, a company gateway or anything else that speaks the OpenAI API. Usually ends in /v1.',
    examples: [],
  },
];

// Which service a provider points at, judged from its address. The connection
// type says how the harness talks to it (many services speak OpenAI's API);
// the service says who it is.
const SERVICE_HOSTS: [RegExp, string][] = [
  [/generativelanguage\.googleapis\.com/, 'Google Gemini API'],
  [/aiplatform\.googleapis\.com/, 'Google Vertex AI'],
  [/api\.anthropic\.com/, 'Anthropic API'],
  [/\.openai\.azure\.com|\.cognitiveservices\.azure\.com/, 'Azure OpenAI'],
  [/api\.openai\.com/, 'OpenAI API'],
  [/api\.mistral\.ai/, 'Mistral API'],
  [/api\.groq\.com/, 'Groq API'],
  [/api\.together\.(xyz|ai)/, 'Together AI API'],
  [/openrouter\.ai/, 'OpenRouter'],
  [/api\.deepseek\.com/, 'DeepSeek API'],
  [/api\.x\.ai/, 'xAI API'],
  [/api\.perplexity\.ai/, 'Perplexity API'],
  [/ollama\.com/, 'Ollama Cloud'],
  [/(localhost|127\.0\.0\.1):11434/, 'Ollama (this computer)'],
  [/(localhost|127\.0\.0\.1):1234/, 'LM Studio (this computer)'],
];
export function serviceOf(type: ProviderType, baseUrl: string): string {
  if (type === 'rules') return 'Built-in rules';
  const hit = SERVICE_HOSTS.find(([re]) => re.test(baseUrl ?? ''));
  if (hit) return hit[1];
  return type === 'anthropic' ? 'Anthropic API' : type === 'ollama' ? 'Ollama API' : 'Custom service';
}

// USD per million tokens.
export const ModelPrice = z.object({
  input: z.number().min(0),
  cached: z.number().min(0).default(0),
  output: z.number().min(0),
});
export type ModelPrice = z.infer<typeof ModelPrice>;

export interface Provider {
  id: string;
  type: ProviderType;
  /** Who the provider is, e.g. "Google Gemini API". `type` is only how we connect. */
  service: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  builtIn: boolean;
  status: 'connected' | 'error' | 'untested';
  statusText: string | null;
  checkedAt: string | null;
  models: string[];
  key: { set: boolean; masked: string | null; fromEnv: boolean };
  billed: boolean;
  maxConcurrent: number | null;
  prices: Record<string, ModelPrice>;
  unpriced: string[];
  usedBy: number;
}

export const ProviderInput = z.object({
  type: ProviderType.exclude(['rules']),
  name: z.string().trim().min(2).max(60),
  baseUrl: z.string().trim().url().max(300),
  apiKey: z.string().max(500).optional(),
  billed: z.boolean().default(true),
  maxConcurrent: z.number().int().min(1).max(100).nullable().default(null),
  models: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  prices: z.record(ModelPrice).optional(),
  enabled: z.boolean().optional(),
});
export type ProviderInput = z.infer<typeof ProviderInput>;
