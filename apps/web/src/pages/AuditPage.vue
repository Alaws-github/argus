<script setup lang="ts">
// The audit log: every action with who, what, when and from which address;
// filters, paging, CSV and a button that verifies the hash chain.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import KpiStrip from '../components/KpiStrip.vue';
import { api, csv, downloadText, socket, when } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
interface Row {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: Record<string, unknown>;
  ip: string | null;
}

// Plain-English names for actions, as GoldenEye shows them.
const LABELS: Record<string, string> = {
  'auth.signed_in': 'Signed in',
  'auth.failed': 'Failed to sign in',
  'auth.signed_out': 'Signed out',
  'auth.signed_out_session': 'Signed out a session',
  'auth.signed_out_everywhere': 'Signed out everywhere',
  'user.created_first_admin': 'Created the first account',
  'user.created': 'Added a person',
  'user.changed': 'Changed a person',
  'user.password_changed': 'Changed their password',
  'user.renamed': 'Changed their name',
  'engagement.created': 'Added the engagement',
  'engagement.changed': 'Changed the engagement',
  'engagement.seeded': 'Created the demo engagement',
  'settings.updated': 'Changed the settings',
  'provider.added': 'Added the provider',
  'provider.changed': 'Changed the provider',
  'provider.removed': 'Deleted the provider',
  'provider.tested': 'Tested the provider',
  'agent.changed': 'Changed the agent',
  'agent.killed': 'Stopped the agent',
  'agent.kill_switch_tested': 'Tested the kill switch',
  'card.created': 'Added a use case',
  'card.rejected': 'Did not take forward',
  'card.moved': 'Moved on',
  'gate.approved': 'Approved the gate',
  'gate.changes_requested': 'Requested changes',
  'run.started': 'Started a run',
  'run.succeeded': 'Run succeeded',
  'run.failed': 'Run failed',
  'agent.asked': 'An agent asked a question',
  'agent.answered': "Answered an agent's question",
  'agent.question_skipped': "Skipped an agent's question",
  'run.retried': 'Retried a run',
  'run.blocked': 'Run blocked',
  'controls.created_from_design': 'Created controls from the design',
  'risk.updated': 'Changed a risk',
  'risk.accepted': 'Accepted a risk',
  'risk.acceptance_withdrawn': 'Withdrew risk acceptance',
  'library.control_added': 'Added a library control',
  'soa.decided': 'Decided applicability',
  'control.added': 'Added a control',
  'control.changed': 'Changed a control',
  'inventory.added': 'Added to the inventory',
  'inventory.changed': 'Changed an inventory item',
  'test.added': 'Added a test',
  'test.changed': 'Changed a test',
  'test.concluded': 'Concluded a test',
  'test.reviewed': 'Reviewed a test',
  'evidence.added': 'Added evidence',
  'issue.raised': 'Raised an issue',
  'issue.changed': 'Changed an issue',
  'issue.in_remediation': 'Started remediation',
  'issue.ready_for_retest': 'Marked ready for retest',
  'issue.closed': 'Closed an issue',
  'issue.risk_accepted': "Accepted an issue's risk",
  'issue.open': 'Reopened an issue',
  'eval.suite_added': 'Added an eval suite',
  'eval.case_added': 'Added an eval case',
  'eval.case_removed': 'Removed an eval case',
  'eval.started': 'Started an eval run',
  'eval.completed': 'Completed an eval run',
  'assessment.scored': 'Scored an area',
  'report.signed_off': 'Signed off the report',
};
const label = (a: string) => LABELS[a] ?? a;

const f = ref({ q: '', actor: '', action: '', ip: '', from: '', to: '' });
const page = ref(1);
const pageSize = ref(50);
const data = ref<{ rows: Row[]; total: number; actors: string[]; actions: string[] }>({
  rows: [],
  total: 0,
  actors: [],
  actions: [],
});
const check = ref<{ ok: boolean; message: string } | null>(null);

async function load() {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f.value)) if (v.trim()) params.set(k, v.trim());
  params.set('page', String(page.value));
  params.set('pageSize', String(pageSize.value));
  try {
    data.value = await api(`/audit?${params}`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
let t: ReturnType<typeof setTimeout> | undefined;
watch(
  f,
  () => {
    clearTimeout(t);
    t = setTimeout(() => ((page.value = 1), load()), 250);
  },
  { deep: true },
);
watch([page, pageSize], load);
const onAudit = () => page.value === 1 && void load();
onMounted(() => {
  void load();
  socket.on('audit', onAudit);
});
onBeforeUnmount(() => socket.off('audit', onAudit));

const filtered = computed(() => Object.values(f.value).some((v) => v.trim()));
const pages = computed(() => Math.max(1, Math.ceil(data.value.total / pageSize.value)));
const range = computed(() =>
  data.value.total
    ? `${(page.value - 1) * pageSize.value + 1}–${Math.min(page.value * pageSize.value, data.value.total)} of ${data.value.total}`
    : '0',
);
const clear = () => (f.value = { q: '', actor: '', action: '', ip: '', from: '', to: '' });
const detail = (d: Record<string, unknown>) =>
  Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
async function verify() {
  check.value = await api('/audit/verify');
}
function exportCsv() {
  downloadText(
    `audit-log-page-${page.value}.csv`,
    csv([
      ['When', 'Who', 'What', 'On', 'Detail', 'From'],
      ...data.value.rows.map((a) => [a.at, a.actor, label(a.action), a.entity, detail(a.detail), a.ip ?? '']),
    ]),
    'text/csv',
  );
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Audit log</h1>
        <p
          >Every action by a person or an agent, newest first, with the address it came from. Each entry carries the
          hash of the one before it, so an edited or deleted entry breaks the chain.</p
        >
      </div>
      <div class="stack" style="align-items: flex-end; gap: 6px">
        <div class="row"
          ><button class="btn" :disabled="!data.rows.length" @click="exportCsv">Download CSV</button
          ><button class="btn" @click="verify">Verify the chain</button></div
        >
        <span v-if="check" class="small" :class="check.ok ? '' : 'error'" :style="check.ok ? 'color: var(--ok)' : ''">{{
          check.message
        }}</span>
      </div>
    </div>
    <KpiStrip page="audit" />

    <form
      class="card"
      style="margin-bottom: 14px; gap: 10px"
      role="search"
      aria-label="Filter the audit log"
      @submit.prevent
    >
      <div class="grid audit-filters">
        <label class="field"
          ><span>Search</span><input v-model="f.q" class="input" placeholder="A name, email, key, engagement or action"
        /></label>
        <label class="field"
          ><span>Who</span>
          <select v-model="f.actor" class="select"
            ><option value="">Everyone</option
            ><option v-for="a in data.actors" :key="a" :value="a">{{
              a === app.user?.name ? `You (${a})` : a
            }}</option></select
          >
        </label>
        <label class="field"
          ><span>What</span>
          <select v-model="f.action" class="select"
            ><option value="">Everything</option
            ><option v-for="a in data.actions" :key="a" :value="a">{{ label(a) }}</option></select
          >
        </label>
        <label class="field"><span>From</span><input v-model="f.ip" class="input" placeholder="An IP address" /></label>
      </div>
      <div class="row" style="flex-wrap: wrap; align-items: flex-end">
        <label class="field"
          ><span>When</span><input v-model="f.from" type="date" class="input" aria-label="From date"
        /></label>
        <span class="faint" style="padding-bottom: 9px">to</span>
        <label class="field"
          ><span class="sr-only">To date</span><input v-model="f.to" type="date" class="input" aria-label="To date"
        /></label>
        <button v-if="filtered" type="button" class="btn ghost" @click="clear">Clear filters</button>
      </div>
    </form>

    <div v-if="!data.rows.length" class="card empty"
      ><h2>{{ filtered ? 'Nothing matches' : 'Nothing yet' }}</h2></div
    >
    <div v-else class="table-wrap">
      <table>
        <thead
          ><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>Detail</th><th>From</th></tr></thead
        >
        <tbody>
          <tr v-for="a in data.rows" :key="a.id">
            <td class="faint" style="white-space: nowrap">{{ when(a.at) }}</td>
            <td>{{ a.actor === app.user?.name ? 'You' : a.actor }}</td>
            <td>{{ label(a.action) }}</td>
            <td class="mono small">{{ a.entity }}</td>
            <td class="small muted" style="max-width: 380px">{{ detail(a.detail) }}</td>
            <td class="mono small faint">{{ a.ip ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="spread" style="margin-top: 12px; flex-wrap: wrap">
      <span class="small faint">{{ range }}</span>
      <div class="row">
        <button class="btn sm" :disabled="page <= 1" @click="page--">Newer</button>
        <span class="small">{{ page }} / {{ pages }}</span>
        <button class="btn sm" :disabled="page >= pages" @click="page++">Older</button>
        <label class="row small faint"
          >Per page
          <select v-model.number="pageSize" class="select" style="width: auto"
            ><option v-for="n in [25, 50, 100, 200]" :key="n" :value="n">{{ n }}</option></select
          >
        </label>
      </div>
    </div>
  </div>
</template>
