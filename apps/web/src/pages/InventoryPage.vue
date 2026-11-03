<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { INVENTORY_KINDS, type InventoryItem, type InventoryKind } from '@gh/shared';
import { api, csv, day, downloadText } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const items = ref<InventoryItem[]>([]);
const loading = ref(true);
async function load() {
  try {
    items.value = await api(`/engagements/${await app.eid()}/inventory`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const KIND_LABELS: Record<InventoryKind, string> = { system: 'AI systems', model: 'Models', agent: 'Agents', dataset: 'Datasets', vendor: 'Vendor AI' };
const kind = ref<InventoryKind | ''>('');
const shown = computed(() => items.value.filter((i) => !kind.value || i.kind === kind.value));
const agents = computed(() => items.value.filter((i) => i.kind === 'agent'));

const blank = () => ({
  kind: 'system' as InventoryKind, name: '', owner: '', description: '', vendor: '', status: 'live', cardIds: [] as string[],
  identity: '', mandate: '', limits: '', approvalThreshold: '', stepLimit: null as number | null, killSwitchTestedAt: '', lastReviewAt: '',
});
const editing = ref<null | { id: string | null; f: ReturnType<typeof blank> }>(null);
function edit(i?: InventoryItem) {
  editing.value = i
    ? { id: i.id, f: { ...blank(), ...i, killSwitchTestedAt: i.killSwitchTestedAt?.slice(0, 10) ?? '', lastReviewAt: i.lastReviewAt?.slice(0, 10) ?? '' } as any }
    : { id: null, f: { ...blank(), kind: (kind.value || 'system') as InventoryKind } };
}
async function save() {
  const { id, f } = editing.value!;
  const body = {
    kind: f.kind, name: f.name, owner: f.owner, description: f.description, vendor: f.vendor, status: f.status, cardIds: f.cardIds,
    identity: f.identity, mandate: f.mandate, limits: f.limits, approvalThreshold: f.approvalThreshold, stepLimit: f.stepLimit || null,
    killSwitchTestedAt: f.killSwitchTestedAt ? new Date(f.killSwitchTestedAt).toISOString() : null,
    lastReviewAt: f.lastReviewAt ? new Date(f.lastReviewAt).toISOString() : null,
  };
  try {
    if (id) await api(`/inventory/${id}`, { method: 'PATCH', body });
    else await api(`/engagements/${await app.eid()}/inventory`, { method: 'POST', body });
    editing.value = null;
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function stamp(i: InventoryItem, field: 'killSwitchTestedAt' | 'lastReviewAt') {
  try {
    await api(`/inventory/${i.id}`, { method: 'PATCH', body: { [field]: new Date().toISOString() } });
    app.toast(field === 'killSwitchTestedAt' ? 'Kill switch test recorded for today' : 'Review recorded for today');
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
function exportCsv() {
  downloadText(
    `ai-inventory-${app.engagement?.slug}.csv`,
    csv([
      ['Key', 'Kind', 'Name', 'Owner', 'Vendor', 'Status', 'Use cases', 'Identity', 'Mandate', 'Limits', 'Approval threshold', 'Step limit', 'Kill switch tested', 'Last review', 'Ready to act alone', 'Missing'],
      ...items.value.map((i) => [i.key, i.kind, i.name, i.owner, i.vendor, i.status, i.cardKeys.join(' '), i.identity, i.mandate, i.limits, i.approvalThreshold, i.stepLimit, day(i.killSwitchTestedAt), day(i.lastReviewAt), i.readiness ? (i.readiness.ok ? 'yes' : 'no') : '', i.readiness?.missing.join('; ') ?? '']),
    ]),
    'text/csv',
  );
}
const CHECKS = [
  'A named human owner', 'Its own identity (not a shared login)', 'A written mandate: what it may do and touch', 'Limits on value or volume',
  'An approval threshold for a person', 'A step limit', 'A kill switch tested in the last 90 days', 'An independent review in the last 90 days',
];
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>AI inventory</h1>
        <p>Every AI system, model, agent, dataset and vendor tool in scope, with an owner. Agents get a register of their own: an agent acts alone only when all eight readiness checks hold.</p>
      </div>
      <div class="row">
        <button class="btn" :disabled="!items.length" @click="exportCsv">Download CSV</button>
        <button v-if="app.can('prepare')" class="btn primary" @click="edit()">Add to inventory</button>
      </div>
    </div>

    <section v-if="agents.length" class="section" style="margin-bottom: 20px">
      <span class="label-caps">Agent register</span>
      <div class="grid-2">
        <div v-for="a in agents" :key="a.id" class="card">
          <div class="spread">
            <div><span class="mono faint">{{ a.key }}</span> <strong>{{ a.name }}</strong></div>
            <span class="badge" :class="a.readiness?.ok ? 'ok' : 'danger'">{{ a.readiness?.ok ? 'Ready to act alone' : `${a.readiness?.missing.length} checks missing` }}</span>
          </div>
          <p class="small muted">{{ a.description }}</p>
          <ul class="check-list">
            <li v-for="c in CHECKS" :key="c" :class="{ no: a.readiness?.missing.includes(c) }">{{ c }}</li>
          </ul>
          <div v-if="app.can('prepare')" class="row" style="flex-wrap: wrap">
            <button class="btn sm" @click="edit(a)">Edit</button>
            <button class="btn sm" @click="stamp(a, 'killSwitchTestedAt')">Record kill switch test</button>
            <button v-if="app.can('approve')" class="btn sm" @click="stamp(a, 'lastReviewAt')">Record review</button>
          </div>
        </div>
      </div>
    </section>

    <div class="toolbar">
      <div class="filters">
        <button class="filter" :class="{ active: !kind }" @click="kind = ''">All<span class="count">{{ items.length }}</span></button>
        <button v-for="k in INVENTORY_KINDS" :key="k" class="filter" :class="{ active: kind === k }" @click="kind = k">{{ KIND_LABELS[k] }}<span class="count">{{ items.filter((i) => i.kind === k).length }}</span></button>
      </div>
    </div>
    <div v-if="loading" class="muted">Loading…</div>
    <div v-else-if="!shown.length" class="card empty"><h2>Nothing in the inventory yet</h2><p>NIST AI RMF GOVERN 1.6 asks for an inventory of AI systems. Start with what's live.</p></div>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Name</th><th>Kind</th><th>Owner</th><th>Vendor</th><th>Use cases</th><th>Status</th><th /></tr></thead>
        <tbody>
          <tr v-for="i in shown" :key="i.id">
            <td class="mono faint">{{ i.key }}</td>
            <td style="min-width: 220px">{{ i.name }}<div class="small faint">{{ i.description }}</div></td>
            <td class="small">{{ i.kind }}</td>
            <td class="small"><span v-if="i.owner">{{ i.owner }}</span><span v-else class="badge warn">No owner</span></td>
            <td class="small">{{ i.vendor || '—' }}</td>
            <td class="mono small">{{ i.cardKeys.join(' ') || '—' }}</td>
            <td><span class="pill" :class="{ live: 'green', proposed: 'amber', retired: '' }[i.status]">{{ i.status }}</span></td>
            <td><button v-if="app.can('prepare')" class="btn sm" @click="edit(i)">Edit</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-if="editing">
      <div class="backdrop" @click="editing = null" />
      <form class="modal" @submit.prevent="save">
        <div class="spread"><h2>{{ editing.id ? 'Edit' : 'Add to inventory' }}</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="editing = null">✕</button></div>
        <div class="split">
          <label class="field"><span>Kind</span><select v-model="editing.f.kind" class="select"><option v-for="k in INVENTORY_KINDS" :key="k" :value="k">{{ k }}</option></select></label>
          <label class="field"><span>Status</span><select v-model="editing.f.status" class="select"><option>proposed</option><option>live</option><option>retired</option></select></label>
        </div>
        <label class="field"><span>Name</span><input v-model="editing.f.name" class="input" required minlength="2" /></label>
        <label class="field"><span>Description</span><textarea v-model="editing.f.description" class="textarea" /></label>
        <div class="split">
          <label class="field"><span>Owner</span><input v-model="editing.f.owner" class="input" placeholder="A named role" /></label>
          <label class="field"><span>Vendor</span><input v-model="editing.f.vendor" class="input" /></label>
        </div>
        <div class="field"><span>Use cases</span>
          <label v-for="c in app.cards" :key="c.id" class="check-row"><input v-model="editing.f.cardIds" type="checkbox" :value="c.id" />{{ c.key }} {{ c.title }}</label>
        </div>
        <template v-if="editing.f.kind === 'agent'">
          <span class="label-caps">Agent controls</span>
          <label class="field"><span>Identity</span><input v-model="editing.f.identity" class="input" placeholder="Its own service account, not a shared login" /></label>
          <label class="field"><span>Mandate</span><textarea v-model="editing.f.mandate" class="textarea" placeholder="What it may do and touch, and what it may not" /></label>
          <div class="split">
            <label class="field"><span>Limits</span><input v-model="editing.f.limits" class="input" placeholder="Value or volume caps" /></label>
            <label class="field"><span>Step limit</span><input v-model.number="editing.f.stepLimit" type="number" min="0" class="input" /></label>
          </div>
          <label class="field"><span>Approval threshold</span><input v-model="editing.f.approvalThreshold" class="input" placeholder="When a person must approve" /></label>
          <div class="split">
            <label class="field"><span>Kill switch last tested</span><input v-model="editing.f.killSwitchTestedAt" type="date" class="input" /></label>
            <label class="field"><span>Last independent review</span><input v-model="editing.f.lastReviewAt" type="date" class="input" /></label>
          </div>
        </template>
        <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" @click="editing = null">Cancel</button></div>
      </form>
    </template>
  </div>
</template>
