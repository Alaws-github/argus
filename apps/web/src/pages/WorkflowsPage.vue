<script setup lang="ts">
// Client workflows (v1.7): the list. Each workflow is a client's own process
// for taking an AI use case live, drawn around ARGUS's governance gates.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Workflow } from '@gh/shared';
import { api, ago } from '../api';
import { useApp } from '../stores/app';
import Icon from '../components/Icon.vue';

const app = useApp();
const router = useRouter();
const list = ref<(Workflow & { problems: number })[]>([]);
const loading = ref(true);
const adding = ref(false);
const form = ref({ name: '', description: '', template: 'standard' as 'standard' | 'minimal' });
const canEdit = computed(() => app.can('manage_engagement'));

async function load() {
  if (!app.engagementId) return; // the engagement loads after a direct visit; the watch below runs again then
  try { list.value = await api(`/engagements/${app.engagementId}/workflows`); } finally { loading.value = false; }
}
watch(() => app.engagementId, () => void load(), { immediate: true });

async function create() {
  try {
    const w = await api<Workflow>(`/engagements/${app.engagementId}/workflows`, { method: 'POST', body: form.value });
    app.toast(`${w.key} created`);
    void router.push(`/workflows/${w.id}`);
  } catch (e: any) { app.toast(e.message, 'error'); }
}
const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'amber'], published: ['Published', 'green'], retired: ['Retired', ''] };
const live = computed(() => list.value.filter((w) => w.status === 'published').length);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Client workflows</h1>
        <p>Draw how the client takes an AI use case from idea to live: their own steps, who decides, where agents help. ARGUS's governance gates are built into every workflow and can't be removed or skipped.</p>
      </div>
      <button v-if="canEdit" class="btn primary" @click="adding = true"><Icon name="plus" :size="15" />New workflow</button>
    </div>

    <div class="kpi-strip">
      <div class="kpi accent"><div class="kpi-top"><span class="kpi-icon"><Icon name="workflow" :size="15" /></span><span class="kpi-label">Workflows</span></div><div class="kpi-value">{{ list.length }}</div><div class="kpi-sub">On this engagement</div></div>
      <div class="kpi tone-ok"><div class="kpi-top"><span class="kpi-icon"><Icon name="check" :size="15" /></span><span class="kpi-label">Published</span></div><div class="kpi-value">{{ live }}</div><div class="kpi-sub">Passed every governance rule</div></div>
      <div class="kpi" :class="list.some((w) => w.problems) ? 'tone-warn' : 'tone-ok'"><div class="kpi-top"><span class="kpi-icon"><Icon name="alert" :size="15" /></span><span class="kpi-label">With problems</span></div><div class="kpi-value">{{ list.filter((w) => w.problems).length }}</div><div class="kpi-sub">Drafts that can't be published yet</div></div>
    </div>

    <div v-if="loading" class="muted">Loading…</div>
    <div v-else-if="!list.length" class="card empty">
      <h2>No workflows yet</h2>
      <p>Start from the standard workflow (the governance gates with the usual agent and person steps) and change it to match how the client works.</p>
      <button v-if="canEdit" class="btn primary" style="align-self: flex-start" @click="adding = true">New workflow</button>
    </div>
    <div v-else class="wf-cards">
      <RouterLink v-for="w in list" :key="w.id" :to="`/workflows/${w.id}`" class="card wf-card">
        <div class="spread"><span class="mono faint small">{{ w.key }}</span><span class="pill" :class="STATUS[w.status][1]"><span class="dot" />{{ STATUS[w.status][0] }}{{ w.version ? ` · v${w.version}` : '' }}</span></div>
        <h2>{{ w.name }}</h2>
        <p class="small muted">{{ w.description || 'No description' }}</p>
        <div class="spread small">
          <span class="faint">{{ w.graph.nodes.length }} steps · changed {{ ago(w.updatedAt) }} by {{ w.updatedBy }}</span>
          <span v-if="w.problems" class="badge warn">{{ w.problems }} to fix</span>
          <span v-else-if="w.changedSincePublish && w.version" class="badge info">Unpublished changes</span>
        </div>
      </RouterLink>
    </div>

    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="create">
        <div class="spread"><h2>New workflow</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div>
        <label class="field"><span>Name</span><input v-model="form.name" class="input" required minlength="2" placeholder="For example: Credit model approval" /></label>
        <label class="field"><span>What it covers <span class="faint">optional</span></span><textarea v-model="form.description" class="textarea" placeholder="Which use cases follow it, and whose process it is" /></label>
        <div class="field">
          <span>Start from</span>
          <label class="check-row"><input v-model="form.template" type="radio" value="standard" /><span><strong>Standard</strong><span class="muted small hint-inline">The five gates with agent drafts, reviewer approvals, a high-risk check and sign-off</span></span></label>
          <label class="check-row"><input v-model="form.template" type="radio" value="minimal" /><span><strong>Gates only</strong><span class="muted small hint-inline">Just the five governance gates in a line, to build around</span></span></label>
        </div>
        <div class="row"><button class="btn primary" :disabled="form.name.trim().length < 2">Create and open</button><button type="button" class="btn" @click="adding = false">Cancel</button></div>
      </form>
    </template>
  </div>
</template>
