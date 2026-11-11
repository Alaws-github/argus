<script setup lang="ts">
// v1.7.3: the client's own steps for this use case, from the published
// client workflow it follows. ARGUS checks the steps that have a proof by
// reading their connectors for records that mention the use case key; a
// person can confirm a step with a link. Checks never move the use case:
// the governance gates are still decided by people.
import { onMounted, ref, watch } from 'vue';
import { toolById, type ClientStep } from '@gh/shared';
import { api, ago } from '../api';
import { useApp } from '../stores/app';

const props = defineProps<{ cardKey: string }>();
const app = useApp();
interface Data { workflow: { id: string; key: string; name: string; version: number } | null; workflows: { id: string; key: string; name: string; version: number }[]; chosen: boolean; steps: ClientStep[]; summary: { total: number; passed: number; failed: number; pending: number } }
const d = ref<Data | null>(null);
const busy = ref(false);
const confirming = ref<{ node: string; link: string; note: string } | null>(null);

async function load() { try { d.value = await api(`/cards/${props.cardKey}/client-steps`); } catch { d.value = null; } }
onMounted(load);
watch(() => props.cardKey, load);

async function run(fn: () => Promise<Data>, ok?: string) {
  busy.value = true;
  try { d.value = await fn(); if (ok) app.toast(ok); } catch (e: any) { app.toast(e.message, 'error'); } finally { busy.value = false; }
}
const check = () => run(() => api(`/cards/${props.cardKey}/client-steps/check`, { method: 'POST' }), 'Checked the client steps');
const follow = (id: string) => run(() => api(`/cards/${props.cardKey}/workflow`, { method: 'PUT', body: { workflowId: id || null } }));
const confirm = () => run(async () => { const c = confirming.value!; const r = await api<Data>(`/cards/${props.cardKey}/client-steps/${c.node}/confirm`, { method: 'POST', body: { link: c.link || undefined, note: c.note } }); confirming.value = null; return r; }, 'Step confirmed');
const clear = (node: string) => run(() => api(`/cards/${props.cardKey}/client-steps/${node}`, { method: 'DELETE' }));
const ICON: Record<ClientStep['status'], [string, string]> = { passed: ['✓', 'ok'], failed: ['✕', 'danger'], pending: ['…', 'warn'], not_checked: ['○', ''] };
</script>

<template>
  <section v-if="d && (d.workflow || d.workflows.length)" class="section client-steps">
    <div class="spread">
      <span class="label-caps">Client steps{{ d.summary.total ? ` (${d.summary.passed} of ${d.summary.total} done)` : '' }}</span>
      <button v-if="app.can('prepare') && d.steps.some((s) => s.connectorKey && s.proof && s.proof !== 'manual')" class="btn sm" :disabled="busy" @click="check">{{ busy ? 'Checking…' : 'Check now' }}</button>
    </div>
    <div class="row small">
      <span class="faint">Follows</span>
      <select class="select sm" :value="d.chosen ? d.workflow?.id : ''" :disabled="!app.can('prepare') || busy" aria-label="Client workflow this use case follows" @change="follow(($event.target as HTMLSelectElement).value)">
        <option value="">The latest published{{ !d.chosen && d.workflow ? ` (${d.workflow.name})` : '' }}</option>
        <option v-for="w in d.workflows" :key="w.id" :value="w.id">{{ w.key }} {{ w.name }} v{{ w.version }}</option>
      </select>
      <RouterLink v-if="d.workflow" :to="`/workflows/${d.workflow.id}`" class="small">Open</RouterLink>
    </div>
    <p v-if="!d.steps.length" class="small faint">The workflow has no steps in the client's tools yet.</p>
    <ol class="cs-list">
      <li v-for="s in d.steps" :key="s.nodeId">
        <span class="mark" :class="ICON[s.status][1]" :aria-label="s.status">{{ ICON[s.status][0] }}</span>
        <div class="body">
          <div class="spread">
            <span>{{ s.label }} <span v-if="toolById(s.tool)" class="small faint">in {{ toolById(s.tool)!.name }}{{ s.toolDetail ? `, ${s.toolDetail}` : '' }}</span></span>
            <span v-if="s.checkedAt" class="small faint">{{ ago(s.checkedAt) }}</span>
          </div>
          <div v-if="s.detail" class="small muted">{{ s.detail }}</div>
          <div class="small row">
            <a v-if="s.recordUrl" :href="s.recordUrl" target="_blank" rel="noopener noreferrer">{{ s.record ?? 'Open the record' }}</a>
            <RouterLink v-if="s.evidenceKey" :to="`/testing/evidence?focus=${s.evidenceKey}`">{{ s.evidenceKey }}</RouterLink>
            <span v-if="s.proof && s.proof !== 'manual' && s.connectorKey" class="faint">Checked through {{ s.connectorKey }}</span>
            <template v-if="app.can('prepare')">
              <button v-if="s.status !== 'passed'" class="linklike" @click="confirming = { node: s.nodeId, link: '', note: '' }">Confirm by hand</button>
              <button v-else-if="s.checkedBy && !s.evidenceKey" class="linklike" @click="clear(s.nodeId)">Undo</button>
            </template>
          </div>
          <form v-if="confirming?.node === s.nodeId" class="confirm" @submit.prevent="confirm">
            <input v-model="confirming.link" class="input sm" type="url" placeholder="Link to the record (ticket, approval, document)" />
            <input v-model="confirming.note" class="input sm" maxlength="600" placeholder="Or a note: where the proof is" />
            <div class="row"><button class="btn primary sm" :disabled="busy || (!confirming.link && confirming.note.trim().length < 3)">Confirm</button><button type="button" class="btn ghost sm" @click="confirming = null">Cancel</button></div>
          </form>
        </div>
      </li>
    </ol>
    <p class="small faint">These are the client's own steps, checked in their tools. They inform the people who decide at ARGUS's gates; they don't move the use case.</p>
  </section>
</template>

<style scoped>
.cs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.cs-list li { display: flex; gap: 10px; align-items: flex-start; }
.mark { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; border: 1px solid var(--line); color: var(--muted); }
.mark.ok { background: var(--ok); border-color: var(--ok); color: #fff; }
.mark.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
.mark.warn { border-color: var(--warn); color: var(--warn); }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.confirm { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.confirm .input { padding: 6px 9px; font-size: 13px; }
</style>
