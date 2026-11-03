<script setup lang="ts">
// The knowledge base: everything the AI agents ground their drafts in, a
// search box that finds passages the way an agent does, and uploads for the
// client's own documents (policies, procedures, minutes).
import { computed, onMounted, ref } from 'vue';
import type { SourcePassage } from '@gh/shared';
import { api, day } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
interface Source { id: string; kind: string; title: string; ref: string; origin: string; shared: boolean; chunks: number; embedded: number; firstPassage: string | null; createdBy: string; createdAt: string }
const sources = ref<Source[]>([]);
const status = ref({ keyword: true, meaning: false, vectorAvailable: false });
const loading = ref(true);

async function load() {
  try {
    const d = await api(`/engagements/${await app.eid()}/knowledge`);
    sources.value = d.sources;
    status.value = d.search;
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const GROUPS = [
  { kind: 'upload', label: 'Client documents', hint: 'Policies, procedures and minutes you uploaded for this engagement' },
  { kind: 'client', label: 'About the client', hint: 'From the engagement settings' },
  { kind: 'use_case', label: 'Use case profiles', hint: 'Indexed as each use case is added' },
  { kind: 'evidence', label: 'Evidence', hint: 'Notes and text files from the evidence vault' },
  { kind: 'framework', label: 'Framework requirements', hint: 'Summaries in the harness\'s own words, with links to the official text' },
  { kind: 'control', label: 'Control library', hint: 'Objectives, test procedures and expected evidence' },
  { kind: 'methodology', label: 'Method', hint: 'Tiering, oversight, sampling, evidence strength, findings' },
] as const;
const group = ref<string>('');
const shown = computed(() => sources.value.filter((s) => !group.value || s.kind === group.value));
const count = (k: string) => sources.value.filter((s) => s.kind === k).length;

// Search, exactly as an agent would.
const q = ref('');
const hits = ref<SourcePassage[] | null>(null);
async function find() {
  if (q.value.trim().length < 2) return;
  hits.value = await api(`/engagements/${app.engagementId}/knowledge/search?q=${encodeURIComponent(q.value.trim())}`);
}

// Uploads: paste text or choose a text file.
const adding = ref(false);
const form = ref({ title: '', text: '' });
const fileEl = ref<HTMLInputElement | null>(null);
const fileName = ref('');
async function upload() {
  try {
    const f = fileEl.value?.files?.[0];
    const body: any = { title: form.value.title };
    if (f) {
      body.filename = f.name;
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      body.dataBase64 = btoa(bin);
    } else body.text = form.value.text;
    const r = await api(`/engagements/${app.engagementId}/knowledge`, { method: 'POST', body });
    app.toast(`Added in ${r.chunks} passage${r.chunks === 1 ? '' : 's'}. Agents can now cite it.`);
    adding.value = false;
    form.value = { title: '', text: '' };
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function remove(s: Source) {
  if (!window.confirm(`Remove "${s.title}" from the knowledge base? Drafts that already cite it keep their copy.`)) return;
  await api(`/knowledge/${s.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message, 'error'));
  await load();
}
const KIND: Record<string, string> = { framework: 'Framework', control: 'Library control', methodology: 'Method', client: 'Client', use_case: 'Use case', evidence: 'Evidence', upload: 'Client document' };
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Knowledge base</h1>
        <p>What the AI agents ground their drafts in. Every proposed risk, control and evidence request cites the passages it rests on, and the harness rejects any citation an agent wasn't given.</p>
      </div>
      <button v-if="app.can('prepare')" class="btn primary" @click="adding = true">Add a client document</button>
    </div>

    <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); margin-bottom: 16px">
      <div class="tile"><span class="label-caps">Passages</span><span class="big">{{ sources.reduce((n, s) => n + s.chunks, 0) }}</span><span class="small faint">from {{ sources.length }} sources</span></div>
      <div class="tile"><span class="label-caps">Keyword search</span><span class="big" style="font-size: 18px; color: var(--ok)">On</span><span class="small faint">Finds exact terms like "Article 14"</span></div>
      <div class="tile">
        <span class="label-caps">Meaning search</span>
        <span class="big" style="font-size: 18px" :style="{ color: status.meaning ? 'var(--ok)' : 'var(--warn)' }">{{ status.meaning ? 'On' : 'Off' }}</span>
        <span class="small faint">{{ status.meaning ? 'Finds passages that mean the same thing in other words' : 'Set an embedding provider on the Models page to find passages by meaning' }}</span>
      </div>
    </div>

    <form class="card" style="margin-bottom: 16px; gap: 10px" role="search" @submit.prevent="find">
      <h2>Search as an agent would</h2>
      <div class="row"><input v-model="q" class="input grow" placeholder="e.g. who must review loan declines before they go out?" aria-label="Search the knowledge base" /><button class="btn">Search</button></div>
      <div v-if="hits" class="stack" style="gap: 8px">
        <p v-if="!hits.length" class="small muted">Nothing found.</p>
        <blockquote v-for="h in hits" :key="h.id" class="passage">
          <div class="small faint"><span class="mono">{{ h.id }}</span> · {{ KIND[h.kind] ?? h.kind }} · {{ h.title }}</div>
          <div class="small">{{ h.text.length > 420 ? h.text.slice(0, 420) + '…' : h.text }}</div>
        </blockquote>
      </div>
    </form>

    <div class="toolbar">
      <div class="filters">
        <button class="filter" :class="{ active: !group }" @click="group = ''">All<span class="count">{{ sources.length }}</span></button>
        <template v-for="g in GROUPS" :key="g.kind"><button v-if="count(g.kind)" class="filter" :class="{ active: group === g.kind }" :title="g.hint" @click="group = g.kind">{{ g.label }}<span class="count">{{ count(g.kind) }}</span></button></template>
      </div>
    </div>
    <div v-if="loading" class="muted">Loading…</div>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Source</th><th>Kind</th><th class="num">Passages</th><th>Scope</th><th>Added</th><th /></tr></thead>
        <tbody>
          <tr v-for="s in shown" :key="s.id">
            <td style="min-width: 260px">{{ s.title }}<div v-if="s.firstPassage" class="small faint mono">from {{ s.firstPassage }}</div></td>
            <td class="small">{{ KIND[s.kind] ?? s.kind }}</td>
            <td class="num">{{ s.chunks }}<span v-if="status.meaning" class="small faint" :title="'Embedded for meaning search'"> · {{ s.embedded }}</span></td>
            <td class="small">{{ s.shared ? 'All engagements' : 'This engagement' }}</td>
            <td class="small faint">{{ s.shared ? 'Built in' : `${s.createdBy}, ${day(s.createdAt)}` }}</td>
            <td><button v-if="s.kind === 'upload' && app.can('prepare')" class="btn ghost sm" :aria-label="`Remove ${s.title}`" @click="remove(s)">Remove</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="upload">
        <div class="spread"><h2>Add a client document</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div>
        <p class="small muted">The client's AI policy, risk procedures, committee minutes. Agents will cite it in their drafts for this engagement only.</p>
        <label class="field"><span>Title</span><input v-model="form.title" class="input" required minlength="3" placeholder="e.g. Group AI Policy v2 (2026)" /></label>
        <div class="field"><span>A PDF, Word, Excel, text or CSV file</span>
          <span class="file-pick"><label class="btn"><input ref="fileEl" type="file" accept=".pdf,.docx,.xlsx,.txt,.md,.markdown,.csv,.json" class="sr-only" @change="fileName = fileEl?.files?.[0]?.name ?? ''" />Choose file</label><span class="small" :class="fileName ? '' : 'faint'">{{ fileName || 'No file chosen' }}</span></span>
        </div>
        <label class="field"><span>Or paste the text</span><textarea v-model="form.text" class="textarea" style="min-height: 140px" placeholder="Or paste text here, for example from a scanned document." /></label>
        <div class="row"><button class="btn primary">Add to knowledge base</button><button type="button" class="btn" @click="adding = false">Cancel</button></div>
      </form>
    </template>
  </div>
</template>
