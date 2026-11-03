<script setup lang="ts">
// Incidents on live AI systems: what happened, who must be told and by when,
// what was done about it, and the lessons. Closing needs a reviewer or lead
// who didn't report it, a root cause, lessons and every notice sent.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NOTIFY_CLOCKS, SEVERITIES, type Incident, type InventoryItem, type NotifyClock } from '@gh/shared';
import { api, day, socket } from '../api';
import { useApp } from '../stores/app';
import IssueTabs from '../components/IssueTabs.vue';

const app = useApp();
const incidents = ref<Incident[]>([]);
const inventory = ref<InventoryItem[]>([]);
const loading = ref(true);
const selId = ref<string | null>(null);
const sel = computed(() => incidents.value.find((i) => i.id === selId.value) ?? null);
const now = ref(Date.now());
let tick: any;

async function load() {
  try {
    const E = await app.eid();
    [incidents.value, inventory.value] = await Promise.all([api(`/engagements/${E}/incidents`), api(`/engagements/${E}/inventory`)]);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void load();
  socket.on('incident', load);
  tick = setInterval(() => (now.value = Date.now()), 60_000);
});
onBeforeUnmount(() => {
  socket.off('incident', load);
  clearInterval(tick);
});

const STATUS: Record<string, { label: string; pill: string }> = { open: { label: 'Open', pill: 'coral' }, contained: { label: 'Contained', pill: 'amber' }, resolved: { label: 'Resolved', pill: 'blue' }, closed: { label: 'Closed', pill: 'green' } };
const filter = ref<'live' | 'closed' | 'all'>('live');
const shown = computed(() => incidents.value.filter((i) => filter.value === 'all' || (filter.value === 'closed' ? i.status === 'closed' : i.status !== 'closed')));

// The next notice still to send, and how long is left.
function nextNotice(i: Incident) {
  return [...i.notices].filter((n) => !n.sentAt).sort((a, b) => a.due.localeCompare(b.due))[0] ?? null;
}
function left(due: string) {
  const ms = new Date(due).getTime() - now.value;
  const h = Math.round(Math.abs(ms) / 3600_000);
  const txt = h >= 48 ? `${Math.round(h / 24)} days` : `${h} hours`;
  return { overdue: ms < 0, text: ms < 0 ? `${txt} overdue` : `${txt} left` };
}

// Report
const adding = ref(false);
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const blank = () => ({ title: '', description: '', severity: 'high', occurredAt: '', awareAt: localNow(), inventoryId: '', cardId: '', owner: '', clocks: [] as NotifyClock[] });
const form = ref(blank());
async function report() {
  try {
    const f = form.value;
    const i = await api<Incident>(`/engagements/${app.engagementId}/incidents`, {
      method: 'POST',
      body: { ...f, occurredAt: f.occurredAt ? new Date(f.occurredAt).toISOString() : null, awareAt: new Date(f.awareAt).toISOString(), inventoryId: f.inventoryId || null, cardId: f.cardId || null },
    });
    adding.value = false;
    form.value = blank();
    await load();
    selId.value = i.id;
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}

// Detail actions
async function patch(body: Record<string, unknown>, ok?: string) {
  try {
    await api(`/incidents/${sel.value!.id}`, { method: 'PATCH', body });
    if (ok) app.toast(ok);
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const note = ref('');
const sentRef = ref<Record<string, string>>({});
const rc = ref({ rootCause: '', lessons: '' });
function open(i: Incident) {
  selId.value = i.id;
  rc.value = { rootCause: i.rootCause, lessons: i.lessons };
  note.value = '';
}
const action = ref({ title: '', severity: 'high', owner: '' });
async function raiseAction() {
  try {
    await api(`/engagements/${app.engagementId}/issues`, { method: 'POST', body: { ...action.value, incidentId: sel.value!.id, cardId: sel.value!.cardId, description: `Corrective action for ${sel.value!.key}: ${sel.value!.title}` } });
    action.value = { title: '', severity: 'high', owner: '' };
    app.toast('Corrective action raised as an issue');
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const CLOCKS = Object.entries(NOTIFY_CLOCKS) as [NotifyClock, (typeof NOTIFY_CLOCKS)[NotifyClock]][];
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Incidents</h1>
        <p>When a live AI system causes harm, leaks data or fails: what happened, who must be told and by when, what was done, and the lessons. Deadlines follow the EU AI Act and the Jamaica Data Protection Act.</p>
      </div>
      <button v-if="app.can('prepare')" class="btn primary" @click="adding = true">Report an incident</button>
    </div>
    <IssueTabs />

    <div class="toolbar">
      <div class="filters">
        <button class="filter" :class="{ active: filter === 'live' }" @click="filter = 'live'">Not closed<span class="count">{{ incidents.filter((i) => i.status !== 'closed').length }}</span></button>
        <button class="filter" :class="{ active: filter === 'closed' }" @click="filter = 'closed'">Closed<span class="count">{{ incidents.filter((i) => i.status === 'closed').length }}</span></button>
        <button class="filter" :class="{ active: filter === 'all' }" @click="filter = 'all'">All<span class="count">{{ incidents.length }}</span></button>
      </div>
    </div>
    <div v-if="loading" class="muted">Loading…</div>
    <div v-else-if="!shown.length" class="card muted small">No incidents here. Report one when a live AI system causes harm, leaks data or stops working as it should.</div>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Severity</th><th>Incident</th><th>System</th><th>Next notice</th><th>Owner</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="i in shown" :key="i.id" class="clickable" @click="open(i)">
            <td class="mono">{{ i.key }}</td>
            <td><span class="sev" :class="i.severity">{{ i.severity }}</span></td>
            <td style="min-width: 240px">{{ i.title }}<div class="small faint">Aware {{ day(i.awareAt) }} · reported by {{ i.reportedBy }}</div></td>
            <td class="small">{{ i.inventoryName ?? '—' }}<template v-if="i.cardKey"> · {{ i.cardKey }}</template></td>
            <td class="small">
              <template v-if="nextNotice(i)"><strong :style="{ color: left(nextNotice(i)!.due).overdue ? 'var(--danger)' : 'var(--warn)' }">{{ left(nextNotice(i)!.due).text }}</strong><div class="faint">{{ nextNotice(i)!.to }}</div></template>
              <span v-else class="faint">{{ i.notices.length ? 'All sent' : 'None required' }}</span>
            </td>
            <td class="small">{{ i.owner || '—' }}</td>
            <td><span class="pill" :class="STATUS[i.status].pill">{{ STATUS[i.status].label }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Detail -->
    <template v-if="sel">
      <div class="backdrop" @click="selId = null" />
      <aside class="panel" role="dialog" :aria-label="sel.key">
        <div class="spread"><div class="row"><span class="mono faint">{{ sel.key }}</span><span class="sev" :class="sel.severity">{{ sel.severity }}</span><span class="pill" :class="STATUS[sel.status].pill">{{ STATUS[sel.status].label }}</span></div><button class="btn ghost sm" aria-label="Close" @click="selId = null">✕</button></div>
        <h1 style="font-size: 19px">{{ sel.title }}</h1>
        <p class="small">{{ sel.description || 'No description yet.' }}</p>
        <p class="small faint">Occurred {{ sel.occurredAt ? day(sel.occurredAt) : 'unknown' }} · aware {{ day(sel.awareAt) }} · {{ sel.inventoryName ?? 'no system linked' }}{{ sel.cardKey ? ` · ${sel.cardKey}` : '' }} · owner {{ sel.owner || 'not set' }}</p>

        <section class="stack" style="gap: 8px">
          <h2>Who must be told</h2>
          <div v-for="n in sel.notices" :key="n.clock" class="draft-item" :class="n.sentAt ? 'accept' : ''">
            <div class="spread"><strong class="small">{{ NOTIFY_CLOCKS[n.clock].label }}</strong>
              <span v-if="n.sentAt" class="small" style="color: var(--ok)">Sent {{ day(n.sentAt) }} by {{ n.sentBy }}</span>
              <span v-else class="small" :style="{ color: left(n.due).overdue ? 'var(--danger)' : 'var(--warn)' }">Due {{ new Date(n.due).toLocaleString() }} · {{ left(n.due).text }}</span>
            </div>
            <div v-if="n.sentAt" class="small faint">Reference: {{ n.reference }}</div>
            <form v-else-if="app.can('prepare') && sel.status !== 'closed'" class="row" @submit.prevent="patch({ sent: { clock: n.clock, reference: sentRef[n.clock] } }, 'Notice recorded')">
              <input v-model="sentRef[n.clock]" class="input grow" placeholder="Reference, e.g. email to the regulator, case number" required minlength="2" />
              <button class="btn sm">Record as sent</button>
            </form>
          </div>
          <p v-if="!sel.notices.length" class="small muted">No notices required so far.</p>
          <select v-if="app.can('prepare') && sel.status !== 'closed'" class="select" style="max-width: 420px" aria-label="Add a required notice" @change="(e) => { const v = (e.target as HTMLSelectElement).value; if (v) patch({ addClock: v }); (e.target as HTMLSelectElement).value = ''; }">
            <option value="">+ Add a required notice…</option>
            <option v-for="[k, c] in CLOCKS.filter(([k]) => !sel!.notices.some((n) => n.clock === k))" :key="k" :value="k">{{ c.label }} ({{ c.hours >= 48 ? `${c.hours / 24} days` : `${c.hours} hours` }})</option>
          </select>
        </section>

        <section class="stack" style="gap: 8px">
          <h2>Timeline</h2>
          <ul class="timeline"><li v-for="(t, k) in sel.timeline" :key="k"><span class="small faint">{{ new Date(t.at).toLocaleString() }} · {{ t.by }}</span><div class="small">{{ t.text }}</div></li></ul>
          <form v-if="app.can('prepare') && sel.status !== 'closed'" class="row" @submit.prevent="patch({ note }, 'Added to the timeline'); note = ''">
            <input v-model="note" class="input grow" placeholder="What happened or was done" minlength="3" required /><button class="btn sm">Add</button>
          </form>
        </section>

        <section class="stack" style="gap: 8px">
          <h2>Corrective actions</h2>
          <p class="small">{{ sel.issueKeys.length ? `Tracked as ${sel.issueKeys.join(', ')} on the Issues page.` : 'None yet.' }}</p>
          <form v-if="app.can('prepare') && sel.status !== 'closed'" class="row" style="flex-wrap: wrap" @submit.prevent="raiseAction">
            <input v-model="action.title" class="input grow" placeholder="What must be fixed" required minlength="3" />
            <select v-model="action.severity" class="select" style="width: auto"><option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option></select>
            <input v-model="action.owner" class="input" style="width: 160px" placeholder="Owner" />
            <button class="btn sm">Raise</button>
          </form>
        </section>

        <section class="stack" style="gap: 8px">
          <h2>Root cause and lessons</h2>
          <textarea v-model="rc.rootCause" class="textarea" placeholder="Why it happened" :disabled="sel.status === 'closed'" />
          <textarea v-model="rc.lessons" class="textarea" placeholder="What changes so it doesn't happen again" :disabled="sel.status === 'closed'" />
          <div v-if="sel.status !== 'closed' && app.can('prepare')" class="row" style="flex-wrap: wrap">
            <button class="btn sm" @click="patch({ rootCause: rc.rootCause, lessons: rc.lessons }, 'Saved')">Save</button>
            <button v-if="sel.status === 'open'" class="btn sm" @click="patch({ status: 'contained' })">Mark contained</button>
            <button v-if="sel.status !== 'resolved'" class="btn sm" @click="patch({ status: 'resolved' })">Mark resolved</button>
            <button v-if="app.can('approve')" class="btn sm primary" @click="patch({ status: 'closed', rootCause: rc.rootCause, lessons: rc.lessons }, 'Incident closed')">Close incident</button>
          </div>
          <p v-if="sel.status === 'closed'" class="small faint">Closed by {{ sel.closedBy }} on {{ day(sel.closedAt) }}.</p>
          <p v-else class="small faint">Closing needs a reviewer or lead who didn't report it, the root cause and lessons, every notice recorded as sent, and its corrective actions closed.</p>
        </section>
      </aside>
    </template>

    <!-- Report -->
    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="report">
        <div class="spread"><h2>Report an incident</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div>
        <label class="field"><span>What happened</span><input v-model="form.title" class="input" required minlength="3" placeholder="e.g. Chatbot showed one customer another's balance" /></label>
        <label class="field"><span>Details</span><textarea v-model="form.description" class="textarea" /></label>
        <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px">
          <label class="field"><span>Severity</span><select v-model="form.severity" class="select"><option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option></select></label>
          <label class="field"><span>When it happened</span><input v-model="form.occurredAt" type="datetime-local" class="input" /></label>
          <label class="field"><span>When you became aware</span><input v-model="form.awareAt" type="datetime-local" class="input" required /></label>
          <label class="field"><span>AI system</span><select v-model="form.inventoryId" class="select"><option value="">Not linked</option><option v-for="v in inventory" :key="v.id" :value="v.id">{{ v.name }}</option></select></label>
          <label class="field"><span>Use case</span><select v-model="form.cardId" class="select"><option value="">Not linked</option><option v-for="c in app.cards" :key="c.id" :value="c.id">{{ c.key }} {{ c.title }}</option></select></label>
          <label class="field"><span>Owner</span><input v-model="form.owner" class="input" /></label>
        </div>
        <fieldset class="field"><span>Who must be told (deadlines count from when you became aware)</span>
          <label v-for="[k, c] in CLOCKS" :key="k" class="small row" style="gap: 6px"><input v-model="form.clocks" type="checkbox" :value="k" />{{ c.label }} · within {{ c.hours >= 48 ? `${c.hours / 24} days` : `${c.hours} hours` }}</label>
        </fieldset>
        <p class="small faint">The deadlines are a guide from the EU AI Act Article 73 and the Jamaica Data Protection Act 2020. Confirm what applies with the client's legal team.</p>
        <div class="row"><button class="btn primary">Report</button><button type="button" class="btn" @click="adding = false">Cancel</button></div>
      </form>
    </template>
  </div>
</template>
