<script setup lang="ts">
// Issues, handled like defects: severity, owner, due date, management response,
// and a lifecycle that needs a passed retest before closing.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ISSUE_STATUS_LABELS, SEVERITIES, type Issue, type IssueStatus } from '@gh/shared';
import { api, csv, day, downloadText, socket } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const issues = ref<Issue[]>([]);
const loading = ref(true);
async function load() {
  try {
    issues.value = await api(`/engagements/${await app.eid()}/issues`);
    if (sel.value) sel.value = issues.value.find((i) => i.id === sel.value!.id) ?? null;
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void load();
  socket.on('issue', load);
});
onBeforeUnmount(() => socket.off('issue', load));

const OPEN: IssueStatus[] = ['open', 'in_remediation', 'ready_for_retest'];
const filter = ref<'open' | 'overdue' | 'done' | 'all'>('open');
const shown = computed(() =>
  issues.value.filter((i) =>
    filter.value === 'all' ? true : filter.value === 'open' ? OPEN.includes(i.status) : filter.value === 'overdue' ? i.overdue : !OPEN.includes(i.status),
  ),
);
const pill: Record<IssueStatus, string> = { open: 'coral', in_remediation: 'blue', ready_for_retest: 'amber', closed: 'green', risk_accepted: '' };

// Same lifecycle as the server enforces.
const NEXT: Record<IssueStatus, IssueStatus[]> = {
  open: ['in_remediation', 'risk_accepted'],
  in_remediation: ['ready_for_retest', 'open', 'risk_accepted'],
  ready_for_retest: ['closed', 'in_remediation'],
  closed: ['open'],
  risk_accepted: ['open'],
};
const moveLabel: Record<IssueStatus, string> = {
  open: 'Reopen',
  in_remediation: 'Start remediation',
  ready_for_retest: 'Ready for retest',
  closed: 'Close (retest passed)',
  risk_accepted: 'Accept the risk',
};
const allowed = (to: IssueStatus) => (to === 'closed' ? app.can('approve') : to === 'risk_accepted' ? app.can('accept_risk') : app.can('prepare'));

const sel = ref<Issue | null>(null);
const draft = ref({ owner: '', dueDate: '', managementResponse: '', severity: 'medium' });
const err = ref('');
function open(i: Issue) {
  sel.value = i;
  err.value = '';
  draft.value = { owner: i.owner, dueDate: i.dueDate ?? '', managementResponse: i.managementResponse, severity: i.severity };
}
async function patch(body: Record<string, unknown>) {
  err.value = '';
  try {
    sel.value = await api(`/issues/${sel.value!.id}`, { method: 'PATCH', body });
    await load();
    app.toast(`${sel.value!.key} updated`);
  } catch (e: any) {
    err.value = e.message;
  }
}
const saveDetails = () => patch({ owner: draft.value.owner, dueDate: draft.value.dueDate || null, managementResponse: draft.value.managementResponse, severity: draft.value.severity });
function move(to: IssueStatus) {
  if (to === 'risk_accepted') {
    const note = window.prompt('Why is the risk accepted? This is recorded with your name.');
    if (!note?.trim()) return;
    return patch({ status: to, note });
  }
  return patch({ status: to });
}

const adding = ref(false);
const form = ref({ title: '', description: '', severity: 'medium', owner: '', dueDate: '' });
async function add() {
  try {
    const i = await api(`/engagements/${await app.eid()}/issues`, { method: 'POST', body: { ...form.value, dueDate: form.value.dueDate || null } });
    adding.value = false;
    form.value = { title: '', description: '', severity: 'medium', owner: '', dueDate: '' };
    app.toast(`${i.key} raised`);
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
function exportCsv() {
  downloadText(
    `issues-${app.engagement?.slug}.csv`,
    csv([
      ['Key', 'Title', 'Severity', 'Status', 'Owner', 'Due', 'Overdue', 'Use case', 'Control', 'Test', 'Raised by', 'Raised', 'Closed by', 'Management response'],
      ...issues.value.map((i) => [i.key, i.title, i.severity, ISSUE_STATUS_LABELS[i.status], i.owner, i.dueDate, i.overdue ? 'yes' : '', i.cardKey, i.controlKey, i.testKey, i.createdBy, day(i.createdAt), i.closedBy, i.managementResponse]),
    ]),
    'text/csv',
  );
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Issues</h1>
        <p>Findings from tests and evaluations, handled like defects: an owner, a due date, a management response, and a retest before anyone can close them.</p>
      </div>
      <div class="row">
        <button class="btn" :disabled="!issues.length" @click="exportCsv">Download CSV</button>
        <button v-if="app.can('prepare')" class="btn primary" @click="adding = true">Raise issue</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="filters">
        <button class="filter" :class="{ active: filter === 'open' }" @click="filter = 'open'">Open<span class="count">{{ issues.filter((i) => OPEN.includes(i.status)).length }}</span></button>
        <button class="filter" :class="{ active: filter === 'overdue' }" @click="filter = 'overdue'">Overdue<span class="count">{{ issues.filter((i) => i.overdue).length }}</span></button>
        <button class="filter" :class="{ active: filter === 'done' }" @click="filter = 'done'">Closed or accepted<span class="count">{{ issues.filter((i) => !OPEN.includes(i.status)).length }}</span></button>
        <button class="filter" :class="{ active: filter === 'all' }" @click="filter = 'all'">All<span class="count">{{ issues.length }}</span></button>
      </div>
    </div>
    <div v-if="loading" class="muted">Loading…</div>
    <div v-else-if="!shown.length" class="card empty"><h2>Nothing here</h2><p>Issues come from failed tests and evaluation runs, or you can raise one by hand.</p></div>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Severity</th><th>Issue</th><th>From</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="i in shown" :key="i.id" style="cursor: pointer" @click="open(i)">
            <td class="mono faint">{{ i.key }}</td>
            <td><span class="sev" :class="i.severity">{{ i.severity }}</span></td>
            <td style="min-width: 280px">{{ i.title }}</td>
            <td class="small mono">{{ [i.cardKey, i.controlKey, i.testKey].filter(Boolean).join(' · ') || (i.evalRunId ? 'evaluation' : '—') }}</td>
            <td class="small">{{ i.owner || '—' }}</td>
            <td class="small" :class="{ error: i.overdue }">{{ i.dueDate ? day(i.dueDate) : '—' }}<template v-if="i.overdue"> · overdue</template></td>
            <td><span class="pill" :class="pill[i.status]"><span class="dot" />{{ ISSUE_STATUS_LABELS[i.status] }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-if="sel">
      <div class="backdrop" @click="sel = null" />
      <aside class="panel" role="dialog" :aria-label="sel.title">
        <div class="spread">
          <div class="row"><span class="mono faint">{{ sel.key }}</span><span class="sev" :class="sel.severity">{{ sel.severity }}</span><span class="pill" :class="pill[sel.status]"><span class="dot" />{{ ISSUE_STATUS_LABELS[sel.status] }}</span></div>
          <button class="btn ghost sm" aria-label="Close" @click="sel = null">✕</button>
        </div>
        <h1 style="font-size: 19px">{{ sel.title }}</h1>
        <div v-if="sel.description" class="out" style="max-height: 220px">{{ sel.description }}</div>
        <dl class="kv">
          <dt>Raised</dt><dd>{{ sel.createdBy }}, {{ day(sel.createdAt) }}</dd>
          <dt v-if="sel.cardKey || sel.controlKey || sel.testKey">Linked to</dt>
          <dd v-if="sel.cardKey || sel.controlKey || sel.testKey" class="mono">{{ [sel.cardKey, sel.controlKey, sel.testKey].filter(Boolean).join(' · ') }}</dd>
          <dt v-if="sel.closedBy">{{ sel.status === 'closed' ? 'Closed' : 'Accepted' }}</dt><dd v-if="sel.closedBy">{{ sel.closedBy }}, {{ day(sel.closedAt) }}</dd>
        </dl>
        <div class="notice">
          <h3>Move it on</h3>
          <p v-if="sel.status === 'ready_for_retest' && sel.testKey" class="small">Closing needs a passed, reviewed retest of {{ sel.controlKey }}, added after this issue was raised.</p>
          <div class="row" style="flex-wrap: wrap">
            <button v-for="to in NEXT[sel.status]" :key="to" class="btn" :class="{ primary: to === 'closed' || to === 'in_remediation' || to === 'ready_for_retest' }" :disabled="!allowed(to)" :title="allowed(to) ? '' : 'Your role can\'t do this'" @click="move(to)">{{ moveLabel[to] }}</button>
          </div>
        </div>
        <section class="section">
          <span class="label-caps">Remediation</span>
          <div class="split">
            <label class="field"><span>Owner</span><input v-model="draft.owner" class="input" :disabled="!app.can('prepare')" /></label>
            <label class="field"><span>Due date</span><input v-model="draft.dueDate" type="date" class="input" :disabled="!app.can('prepare')" /></label>
          </div>
          <label class="field"><span>Severity</span><select v-model="draft.severity" class="select" :disabled="!app.can('prepare')"><option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option></select></label>
          <label class="field"><span>Management response</span><textarea v-model="draft.managementResponse" class="textarea" :disabled="!app.can('prepare')" placeholder="What the owner will do, and by when" /></label>
          <p v-if="err" class="error">{{ err }}</p>
          <div v-if="app.can('prepare')"><button class="btn" @click="saveDetails">Save</button></div>
        </section>
      </aside>
    </template>

    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="add">
        <div class="spread"><h2>Raise an issue</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div>
        <label class="field"><span>Title</span><input v-model="form.title" class="input" required minlength="3" /></label>
        <label class="field"><span>What was found</span><textarea v-model="form.description" class="textarea" /></label>
        <div class="split">
          <label class="field"><span>Severity</span><select v-model="form.severity" class="select"><option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option></select></label>
          <label class="field"><span>Due date</span><input v-model="form.dueDate" type="date" class="input" /></label>
        </div>
        <label class="field"><span>Owner</span><input v-model="form.owner" class="input" /></label>
        <div class="row"><button class="btn primary">Raise issue</button><button type="button" class="btn" @click="adding = false">Cancel</button></div>
      </form>
    </template>
  </div>
</template>
