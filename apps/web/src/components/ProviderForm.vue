<script setup lang="ts">
// Add or edit a model provider. Keys are write-only: the server never sends one back.
import { computed, reactive, ref } from 'vue';
import { PROVIDER_DEFAULT_URLS, PROVIDER_TYPE_LABELS, type ModelPrice, type Provider, type ProviderType } from '@gh/shared';
import { api } from '../api';

const props = defineProps<{ provider?: Provider }>();
const emit = defineEmits<{ saved: [Provider]; cancel: [] }>();

const editing = !!props.provider;
const form = reactive({
  type: (props.provider?.type ?? 'anthropic') as Exclude<ProviderType, 'rules'>,
  name: props.provider?.name ?? 'Anthropic',
  baseUrl: props.provider?.baseUrl ?? PROVIDER_DEFAULT_URLS.anthropic,
  apiKey: '',
  showKey: false,
  billed: props.provider?.billed ?? true,
  maxConcurrent: props.provider?.maxConcurrent?.toString() ?? '',
  models: [...(props.provider?.models ?? [])],
  prices: JSON.parse(JSON.stringify(props.provider?.prices ?? {})) as Record<string, ModelPrice>,
  newModel: '',
});
const busy = ref(false);
const error = ref('');
const test = ref<{ ok: boolean; message: string } | null>(null);

const hints: Record<string, string> = {
  anthropic: 'Leave as is unless you use a gateway.',
  ollama: 'Leave as is for Ollama Cloud. No /v1 at the end.',
  openai: 'Usually ends in /v1. LM Studio, vLLM, llama.cpp, OpenRouter, Azure OpenAI and others.',
};
const keyHint = computed(() =>
  form.type === 'ollama' ? 'From ollama.com/settings/keys' : form.type === 'openai' ? 'Optional for local servers' : 'From console.anthropic.com',
);

function pickType(t: Exclude<ProviderType, 'rules'>) {
  form.type = t;
  form.baseUrl = PROVIDER_DEFAULT_URLS[t];
  form.name = { anthropic: 'Anthropic', ollama: 'Ollama Cloud', openai: 'Local models' }[t];
  if (t === 'openai') form.billed = false;
  else form.billed = true;
}

function addModel() {
  const m = form.newModel.trim();
  if (m && !form.models.includes(m)) form.models.push(m);
  form.newModel = '';
}
function removeModel(m: string) {
  form.models = form.models.filter((x) => x !== m);
  delete form.prices[m];
}
function setPrice(m: string, field: keyof ModelPrice, v: string) {
  const p = form.prices[m] ?? { input: 0, cached: 0, output: 0 };
  if (v === '' && field !== 'cached') {
    delete form.prices[m];
    return;
  }
  form.prices[m] = { ...p, [field]: Math.max(0, Number(v) || 0) };
}

async function runTest() {
  test.value = null;
  busy.value = true;
  try {
    const r = await api('/providers/test', { method: 'POST', body: { type: form.type, baseUrl: form.baseUrl, apiKey: form.apiKey || undefined, id: props.provider?.id } });
    test.value = r;
    if (r.ok) for (const m of r.models) if (!form.models.includes(m)) form.models.push(m);
  } catch (e: any) {
    test.value = { ok: false, message: e.message };
  } finally {
    busy.value = false;
  }
}

async function save() {
  error.value = '';
  const mc = form.maxConcurrent.trim();
  if (mc && (!Number.isInteger(Number(mc)) || Number(mc) < 1)) {
    error.value = 'Requests at once is a whole number, 1 or more, or empty for no limit.';
    return;
  }
  busy.value = true;
  try {
    const body = {
      name: form.name,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey || undefined,
      billed: form.billed,
      maxConcurrent: mc ? Number(mc) : null,
      models: form.models,
      prices: form.prices,
      ...(editing ? {} : { type: form.type }),
    };
    const p = editing
      ? await api<Provider>(`/providers/${props.provider!.id}`, { method: 'PATCH', body })
      : await api<Provider>('/providers', { method: 'POST', body });
    emit('saved', p);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="stack" @submit.prevent="save">
    <div v-if="!editing" class="field">
      <span>Type</span>
      <div class="segmented">
        <button v-for="t in (['anthropic', 'ollama', 'openai'] as const)" :key="t" type="button" :class="{ on: form.type === t }" @click="pickType(t)">
          {{ PROVIDER_TYPE_LABELS[t] }}
        </button>
      </div>
    </div>
    <div class="grid" style="grid-template-columns: 1fr 1fr">
      <label class="field"><span>Name</span><input v-model="form.name" class="input" required /></label>
      <label class="field">
        <span>Requests at once</span>
        <input v-model="form.maxConcurrent" class="input" inputmode="numeric" placeholder="No limit" />
      </label>
    </div>
    <label class="field">
      <span>Base URL</span>
      <input v-model="form.baseUrl" class="input mono" required />
      <span class="hint">{{ hints[form.type] }}</span>
    </label>
    <label class="field">
      <span>API key{{ form.type === 'openai' ? ' (optional)' : '' }}</span>
      <div class="row">
        <input v-model="form.apiKey" class="input mono" :type="form.showKey ? 'text' : 'password'" autocomplete="off"
          :placeholder="provider?.key.set ? `Saved (${provider.key.masked}). Leave empty to keep it.` : 'Paste the key'" />
        <button type="button" class="btn sm" @click="form.showKey = !form.showKey">{{ form.showKey ? 'Hide' : 'Show' }}</button>
      </div>
      <span class="hint">{{ keyHint }}. Encrypted on this machine; agents never see it.</span>
    </label>
    <label class="switch" :class="{ on: form.billed }" style="align-items: flex-start">
      <input v-model="form.billed" type="checkbox" class="sr-only" />
      <span class="track" style="flex: none; margin-top: 2px" />
      <span><strong style="color: var(--text)">Billed</strong> <span class="muted">Its calls count toward the spend cap, priced per model. Turn off for a model you run yourself.</span></span>
    </label>

    <div class="row">
      <button type="button" class="btn sm" :disabled="busy" @click="runTest">Test and find models</button>
      <span v-if="test" class="small" :style="{ color: test.ok ? 'var(--ok)' : 'var(--danger)' }">{{ test.message }}</span>
    </div>

    <div class="field">
      <span>Models</span>
      <span class="hint">Agents pick from these. Test finds them; add any the provider doesn't list.{{ form.billed ? ' Each billed model needs a price, in USD per million tokens.' : '' }}</span>
      <div v-if="form.models.length" class="table-wrap">
        <table>
          <thead><tr><th>Model</th><th v-if="form.billed" class="num">Input</th><th v-if="form.billed" class="num">Cached</th><th v-if="form.billed" class="num">Output</th><th /></tr></thead>
          <tbody>
            <tr v-for="m in form.models" :key="m">
              <td class="mono">{{ m }}</td>
              <template v-if="form.billed">
                <td v-for="f in (['input', 'cached', 'output'] as const)" :key="f" class="num">
                  <input class="input mono" style="width: 76px; padding: 3px 6px; text-align: right" inputmode="decimal" :placeholder="f === 'cached' ? '0' : '—'"
                    :value="form.prices[m]?.[f] ?? ''" :aria-label="`${m} ${f} price`" @change="setPrice(m, f, ($event.target as HTMLInputElement).value)" />
                </td>
              </template>
              <td class="num"><button type="button" class="btn ghost sm" :aria-label="`Remove ${m}`" @click="removeModel(m)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="row">
        <input v-model="form.newModel" class="input mono" placeholder="Model ID, e.g. claude-sonnet-5-5" @keydown.enter.prevent="addModel" />
        <button type="button" class="btn sm" @click="addModel">Add model</button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div class="row" style="justify-content: flex-end">
      <button type="button" class="btn" @click="emit('cancel')">Cancel</button>
      <button class="btn primary" :disabled="busy">{{ editing ? 'Save changes' : 'Add provider' }}</button>
    </div>
  </form>
</template>
