<script setup lang="ts">
// Models and keys: AI providers, their keys (stored encrypted, shown masked),
// models and prices, and the monthly spending limit.
import { computed, onMounted, ref } from 'vue';
import { EFFORTS, PROVIDER_TYPE_LABELS, type Provider, type WorkspaceSettings } from '@gh/shared';
import { api, ago, money } from '../api';
import { useApp } from '../stores/app';
import ProviderForm from '../components/ProviderForm.vue';

const app = useApp();
const providers = ref<Provider[]>([]);
const settings = ref<(WorkspaceSettings & { monthSpendUsd: number }) | null>(null);
const adding = ref(false);
const editingId = ref<string | null>(null);
const testing = ref<string | null>(null);
const limit = ref({ cap: '', warnAtPct: 75, pauseAtCap: true, timeZone: '' });
const defaults = ref({ providerId: '', model: '', effort: 'medium', fallback: '' });
// Meaning-based search for the knowledge base.
const embed = ref({ providerId: '', model: '' });
// The assistant's model: any enabled model provider, or the offline assistant.
const assist = ref({ providerId: '', model: '' });
const assistProviders = computed(() => providers.value.filter((p) => p.enabled && p.type !== 'rules'));
async function saveAssist() {
  try {
    await api('/settings', { method: 'PUT', body: { assistantProviderId: assist.value.providerId || null, assistantModel: assist.value.providerId ? assist.value.model : '' } });
    app.toast(assist.value.providerId ? `The assistant now uses ${assist.value.model}` : 'The assistant is offline');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const embedNote = ref('');
const embedProviders = computed(() => providers.value.filter((p) => p.enabled && (p.type === 'openai' || p.type === 'ollama')));
const EMBED_HINTS: Record<string, string> = { ollama: 'nomic-embed-text', openai: 'text-embedding-3-small' };
async function testEmbed() {
  embedNote.value = 'Testing…';
  try {
    const r = await api('/knowledge/embeddings/test', { method: 'POST', body: embed.value });
    embedNote.value = `Works: ${r.dims} dimensions, ${r.ms} ms.`;
  } catch (e: any) {
    embedNote.value = e.message;
  }
}
async function saveEmbed() {
  try {
    await api('/settings', { method: 'PUT', body: { embedProviderId: embed.value.providerId || null, embedModel: embed.value.providerId ? embed.value.model : '' } });
    const r = embed.value.providerId ? await api('/knowledge/reindex', { method: 'POST' }) : { note: 'Meaning search is off; keyword search still works' };
    embedNote.value = r.note;
    app.toast('Saved');
  } catch (e: any) {
    embedNote.value = e.message;
  }
}
const timeZones = (Intl as any).supportedValuesOf?.('timeZone') ?? ['UTC', 'America/Jamaica'];

async function load() {
  providers.value = await api('/providers');
  settings.value = await api('/settings');
  const s = settings.value!;
  limit.value = { cap: s.spendCapUsd == null ? '' : String(s.spendCapUsd), warnAtPct: s.warnAtPct, pauseAtCap: s.pauseAtCap, timeZone: s.timeZone };
  defaults.value = { providerId: s.defaultProviderId ?? '', model: s.defaultModel, effort: s.defaultEffort, fallback: s.defaultFallbackModel ?? '' };
  embed.value = { providerId: s.embedProviderId ?? '', model: s.embedModel ?? '' };
  assist.value = { providerId: s.assistantProviderId ?? '', model: s.assistantModel ?? '' };
}
onMounted(load);

const pct = computed(() => {
  const s = settings.value;
  if (!s || !s.spendCapUsd) return 0;
  return Math.min(100, (s.monthSpendUsd / s.spendCapUsd) * 100);
});
const capState = computed(() => {
  const s = settings.value;
  if (!s || s.spendCapUsd == null) return null;
  if (s.monthSpendUsd >= s.spendCapUsd) return s.pauseAtCap ? 'paused' : 'over';
  if (pct.value >= s.warnAtPct) return 'warn';
  return null;
});
const defaultModels = computed(() => {
  const p = providers.value.find((x) => x.id === defaults.value.providerId);
  return p ? p.models : [...new Set(providers.value.filter((x) => x.type === 'anthropic').flatMap((x) => x.models))];
});

async function test(p: Provider) {
  testing.value = p.id;
  try {
    const next = await api<Provider>(`/providers/${p.id}/test`, { method: 'POST' });
    Object.assign(p, next);
    app.toast(next.status === 'connected' ? `${p.name}: connected` : `${p.name}: ${next.statusText}`, next.status === 'connected' ? 'info' : 'error');
  } finally {
    testing.value = null;
  }
}
async function toggle(p: Provider) {
  try {
    Object.assign(p, await api<Provider>(`/providers/${p.id}`, { method: 'PATCH', body: { enabled: !p.enabled } }));
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function remove(p: Provider) {
  if (!window.confirm(`Remove ${p.name}? Its saved key is deleted.`)) return;
  try {
    await api(`/providers/${p.id}`, { method: 'DELETE' });
    app.toast(`${p.name} removed`);
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function saveLimit() {
  try {
    const cap = limit.value.cap.trim();
    settings.value = await api('/settings', {
      method: 'PUT',
      body: { spendCapUsd: cap === '' ? null : Number(cap), warnAtPct: Number(limit.value.warnAtPct), pauseAtCap: limit.value.pauseAtCap, timeZone: limit.value.timeZone },
    });
    app.toast('Spending limit saved');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function saveDefaults() {
  try {
    settings.value = await api('/settings', {
      method: 'PUT',
      body: { defaultProviderId: defaults.value.providerId || null, defaultModel: defaults.value.model, defaultEffort: defaults.value.effort, defaultFallbackModel: defaults.value.fallback || null },
    });
    app.toast('Saved. New agents start with these.');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
function onSaved() {
  adding.value = false;
  editingId.value = null;
  void load();
  void app.refreshHealth();
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Models &amp; keys</h1>
        <p>Providers are shared by every engagement. Keys stay on this machine, encrypted in the harness's data folder, and agents never see them.</p>
      </div>
      <button class="btn primary" @click="adding = true">+ Add provider</button>
    </div>

    <div v-if="adding" class="card" style="margin-bottom: 16px">
      <h2>New provider</h2>
      <ProviderForm @saved="onSaved" @cancel="adding = false" />
    </div>

    <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); margin-bottom: 24px">
      <article v-for="p in providers" :key="p.id" class="card" :style="{ opacity: p.enabled ? 1 : 0.65 }">
        <template v-if="editingId === p.id">
          <h2>Edit {{ p.name }}</h2>
          <ProviderForm :provider="p" @saved="onSaved" @cancel="editingId = null" />
        </template>
        <template v-else>
          <div class="spread">
            <div class="row">
              <span class="provider-icon" :class="p.type">{{ p.type === 'rules' ? 'R' : p.type === 'ollama' ? 'O' : p.type === 'openai' ? 'AI' : 'API' }}</span>
              <div>
                <h2>{{ p.name }}</h2>
                <span class="mono small faint">{{ p.baseUrl || 'Offline, inside the harness' }}</span>
              </div>
            </div>
            <span class="pill" :class="!p.enabled ? '' : p.status === 'connected' ? 'green' : p.status === 'error' ? 'coral' : 'amber'">
              <span class="dot" />{{ !p.enabled ? 'Off' : p.status === 'connected' ? 'Connected' : p.status === 'error' ? 'Error' : 'Not tested' }}
            </span>
          </div>
          <dl class="kv facts">
            <dt>Type</dt><dd>{{ PROVIDER_TYPE_LABELS[p.type] }}</dd>
            <template v-if="p.type !== 'rules'">
              <dt>Key</dt><dd class="mono">{{ p.key.masked ?? 'No key saved' }}</dd>
            </template>
            <dt>Billed</dt><dd>{{ p.billed ? 'Yes' : 'No' }}</dd>
            <dt v-if="p.maxConcurrent">Requests at once</dt><dd v-if="p.maxConcurrent">{{ p.maxConcurrent }}</dd>
            <dt>Used by</dt><dd>{{ p.usedBy }} agent{{ p.usedBy === 1 ? '' : 's' }}</dd>
            <dt>Status</dt><dd>{{ p.checkedAt ? `Checked ${ago(p.checkedAt)} ago` : 'Not checked yet' }}</dd>
          </dl>
          <p v-if="p.status === 'error' && p.statusText" class="small" style="color: var(--danger)">{{ p.statusText }}</p>
          <div v-if="p.unpriced.length" class="notice warn small">
            No price yet for {{ p.unpriced.join(', ') }}. Runs on {{ p.unpriced.length === 1 ? 'it' : 'them' }} are recorded at $0 until you add one.
          </div>
          <div class="row" style="flex-wrap: wrap; gap: 6px">
            <span v-for="m in p.models.slice(0, 12)" :key="m" class="chip" :title="p.prices[m] ? `$${p.prices[m].input} in / $${p.prices[m].output} out per million` : ''">{{ m }}</span>
            <span v-if="p.models.length > 12" class="small faint">and {{ p.models.length - 12 }} more</span>
            <span v-if="!p.models.length" class="small faint">No models yet. Test it, or add them under Edit.</span>
          </div>
          <div class="row" style="justify-content: flex-end; margin-top: auto">
            <button class="btn sm ghost" @click="toggle(p)">{{ p.enabled ? 'Turn off' : 'Turn on' }}</button>
            <template v-if="!p.builtIn">
              <button class="btn sm" :disabled="testing === p.id" @click="test(p)">{{ testing === p.id ? 'Testing…' : 'Test' }}</button>
              <button class="btn sm" @click="editingId = p.id">Edit</button>
              <button class="btn sm danger" @click="remove(p)">Remove</button>
            </template>
          </div>
        </template>
      </article>
    </div>

    <div v-if="settings" class="grid" style="grid-template-columns: repeat(auto-fit, minmax(340px, 1fr))">
      <div class="card">
        <h2>Spending limit</h2>
        <div class="stack" style="gap: 6px">
          <div class="spread small"><span class="muted">Billed providers this month</span><strong>{{ money(settings.monthSpendUsd) }}{{ settings.spendCapUsd != null ? ` of ${money(settings.spendCapUsd)}` : '' }}</strong></div>
          <div class="meter"><i :style="{ width: `${pct}%`, background: capState ? (capState === 'warn' ? 'var(--warn)' : 'var(--danger)') : undefined }" /></div>
          <span class="small faint">{{ settings.spendCapUsd == null ? 'No monthly cap set.' : `${money(Math.max(0, settings.spendCapUsd - settings.monthSpendUsd))} left this month.` }}</span>
        </div>
        <div v-if="capState === 'paused'" class="notice danger small">The cap is reached. Runs on billed providers are paused until next month or a higher cap.</div>
        <div v-else-if="capState === 'over'" class="notice warn small">The cap is reached, but runs carry on because pausing at the cap is off.</div>
        <div v-else-if="capState === 'warn'" class="notice warn small">Spend has passed {{ settings.warnAtPct }}% of the cap.</div>
        <div class="grid" style="grid-template-columns: 1fr 1fr">
          <label class="field"><span>Monthly cap ($)</span><input v-model="limit.cap" class="input" inputmode="decimal" placeholder="No cap" /></label>
          <label class="field">
            <span>Warn me at</span>
            <select v-model.number="limit.warnAtPct" class="select"><option :value="50">50%</option><option :value="75">75%</option><option :value="90">90%</option></select>
          </label>
        </div>
        <label class="switch" :class="{ on: limit.pauseAtCap }" style="align-items: flex-start">
          <input v-model="limit.pauseAtCap" type="checkbox" class="sr-only" />
          <span class="track" style="flex: none; margin-top: 2px" />
          <span><strong style="color: var(--text)">Pause billed runs at the cap</strong> <span class="muted">Every provider counts but an unbilled one, whose calls cost nothing.</span></span>
        </label>
        <label class="field">
          <span>Time zone</span>
          <select v-model="limit.timeZone" class="select"><option v-for="t in timeZones" :key="t" :value="t">{{ t }}</option></select>
          <span class="hint">Where the month starts for the cap.</span>
        </label>
        <div><button class="btn primary" @click="saveLimit">Save</button></div>
      </div>

      <div class="card">
        <h2>Defaults for new agents</h2>
        <p class="small muted">Agents in engagements you add from now on start with these. Existing agents keep theirs; change them in Settings &gt; Agents.</p>
        <label class="field">
          <span>Provider</span>
          <select v-model="defaults.providerId" class="select">
            <option value="">Anthropic when it has a key, otherwise the built-in rules</option>
            <option v-for="p in providers.filter((x) => x.enabled)" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <div class="grid" style="grid-template-columns: 1fr 1fr">
          <label class="field">
            <span>Model</span>
            <select v-model="defaults.model" class="select"><option v-for="m in defaultModels" :key="m" :value="m">{{ m }}</option></select>
          </label>
          <label class="field">
            <span>Effort</span>
            <select v-model="defaults.effort" class="select"><option v-for="e in EFFORTS" :key="e" :value="e">{{ e }}</option></select>
          </label>
        </div>
        <label class="field">
          <span>Fallback</span>
          <select v-model="defaults.fallback" class="select">
            <option value="">No fallback</option>
            <option v-for="m in defaultModels.filter((x) => x !== defaults.model)" :key="m" :value="m">{{ m }}</option>
          </select>
          <span class="hint">Takes over when a run fails or its provider is off.</span>
        </label>
        <div><button class="btn primary" @click="saveDefaults">Save</button></div>
      </div>

      <div class="card">
        <h2>Assistant</h2>
        <p class="small muted">The model behind <strong>Ask</strong> in the top bar and on each use case. It explains and suggests; people apply or discard every suggestion. With no model it runs offline, reporting what the harness can check by itself.</p>
        <div class="grid" style="grid-template-columns: 1fr 1fr">
          <label class="field"><span>Provider</span>
            <select v-model="assist.providerId" class="select" @change="assist.model = assistProviders.find((p) => p.id === assist.providerId)?.models[0] ?? ''">
              <option value="">Offline assistant</option>
              <option v-for="p in assistProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label class="field"><span>Model</span>
            <select v-model="assist.model" class="select" :disabled="!assist.providerId"><option v-for="m in assistProviders.find((p) => p.id === assist.providerId)?.models ?? []" :key="m" :value="m">{{ m }}</option></select>
          </label>
        </div>
        <div><button class="btn primary" @click="saveAssist">Save</button></div>
      </div>

      <div class="card">
        <h2>Meaning-based search</h2>
        <p class="small muted">
          Agents find knowledge-base passages by keyword already. An embedding model also finds passages that mean the same thing in other words.
          Use Ollama on your own computer (free: <span class="mono">ollama pull nomic-embed-text</span>, then add it as an OpenAI-compatible provider at <span class="mono">http://localhost:11434/v1</span>), or OpenAI or Voyage.
        </p>
        <div class="grid" style="grid-template-columns: 1fr 1fr">
          <label class="field">
            <span>Provider</span>
            <select v-model="embed.providerId" class="select">
              <option value="">Off: keyword search only</option>
              <option v-for="p in embedProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>Embedding model</span>
            <input v-model="embed.model" class="input mono" :disabled="!embed.providerId" :placeholder="EMBED_HINTS[embedProviders.find((p) => p.id === embed.providerId)?.type ?? 'openai']" />
          </label>
        </div>
        <p v-if="embedNote" class="small">{{ embedNote }}</p>
        <div class="row">
          <button class="btn" :disabled="!embed.providerId || !embed.model" @click="testEmbed">Test</button>
          <button class="btn primary" @click="saveEmbed">Save and index</button>
        </div>
      </div>
    </div>
  </div>
</template>
