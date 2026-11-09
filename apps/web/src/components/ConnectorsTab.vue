<script setup lang="ts">
// Connectors: read-only pulls from the client's business tools and report
// links. Each pull is fingerprinted and filed in the evidence vault against a
// control. Two views (v1.7.2): `manage` in Settings > Connected tools (add,
// edit, remove, the private-network switch), and the everyday view in Tests and
// Evidence (what each connector pulled, and Pull now).
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { toolById, type Connector, type EngagementControl } from '@gh/shared';
import { api, ago } from '../api';
import { useApp } from '../stores/app';
import ConnectorForm from './ConnectorForm.vue';

const props = defineProps<{ controls?: EngagementControl[]; manage?: boolean }>();
const emit = defineEmits<{ pulled: [] }>();
const app = useApp();
const route = useRoute();
const list = ref<Connector[]>([]);
const allowPrivate = ref(false);
const busy = ref<string | null>(null);
const form = ref<{ editing: Connector | null; tool?: string } | null>(null);

async function load() {
  list.value = await api(`/engagements/${await app.eid()}/connectors`).catch(() => []);
  if (props.manage && app.can('manage_models')) allowPrivate.value = (await api('/settings').catch(() => ({})))?.connectorsAllowPrivate ?? false;
}
onMounted(async () => {
  await load();
  // Opened with ?new=1&tool=...: start the form for that tool.
  if (props.manage && route.query.new && app.can('manage_engagement')) form.value = { editing: null, tool: typeof route.query.tool === 'string' ? route.query.tool : undefined };
});
async function pullNow(c: Connector) {
  busy.value = c.id;
  try {
    const r = await api<Connector>(`/connectors/${c.id}/pull`, { method: 'POST', body: {} });
    app.toast(r.lastStatus === 'failed' ? `Pull failed: ${r.lastMessage}` : r.lastMessage, r.lastStatus === 'failed' ? 'error' : 'info');
    await load();
    emit('pulled');
  } finally {
    busy.value = null;
  }
}
async function remove(c: Connector) {
  if (!window.confirm(`Remove ${c.key} ${c.name}? Evidence it already pulled stays in the vault. Workflow steps linked to it lose the link.`)) return;
  await api(`/connectors/${c.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message, 'error'));
  await load();
}
async function setPrivate(v: boolean) {
  try {
    await api('/settings', { method: 'PUT', body: { connectorsAllowPrivate: v } });
    allowPrivate.value = v;
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function saved() { form.value = null; await load(); }
const AUTH: Record<string, string> = { none: 'No sign-in', bearer: 'token', header: 'API key', basic: 'user and password', azure_ad: 'Microsoft Entra app', google_sa: 'Google service account' };
const STATUS: Record<string, string> = { never: 'Not pulled yet', added: 'New evidence added', unchanged: 'No change', failed: 'Failed' };
</script>

<template>
  <div class="stack" style="gap: 12px">
    <div class="spread" style="flex-wrap: wrap; gap: 8px">
      <p v-if="manage" class="small muted" style="max-width: 760px">A connector reads a document, export, ticket list or message history from the client's business tools (Microsoft 365, ServiceNow, Jira, Google Workspace, Slack and others) or any report link, and files it as fingerprinted evidence against a control. Workflow steps link to these connectors. ARGUS never changes anything in those tools. Credentials are encrypted and never shown again.</p>
      <p v-else class="small muted" style="max-width: 760px">What ARGUS pulled from the client's tools, read-only, and when. Each pull is filed in the Evidence Vault with its fingerprint. <template v-if="app.can('manage_engagement')">Add or change connectors in <RouterLink to="/settings/integrations">Settings > Connected tools</RouterLink>.</template></p>
      <button v-if="manage && app.can('manage_engagement')" class="btn primary" @click="form = { editing: null }">Add connector</button>
    </div>
    <div v-if="!list.length" class="card muted small">No connectors yet.<template v-if="!manage && app.can('manage_engagement')"> <RouterLink to="/settings/integrations">Set one up</RouterLink>.</template></div>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Connector</th><th>Control</th><th>Schedule</th><th>Last pull</th><th /></tr></thead>
        <tbody>
          <tr v-for="c in list" :key="c.id">
            <td class="mono">{{ c.key }}</td>
            <td style="min-width: 240px"><i v-if="toolById(c.tool)" class="tool-mono" :style="{ background: toolById(c.tool)!.color, marginRight: '6px' }">{{ toolById(c.tool)!.mono }}</i>{{ c.name }}<div class="small faint mono" style="white-space: normal; word-break: break-all">{{ c.url }}</div><div v-if="manage" class="small faint">{{ c.auth === 'none' ? 'No sign-in' : `${AUTH[c.auth] ?? c.auth} ${c.secretSet ? 'saved' : 'missing'}` }}{{ c.enabled ? '' : ' · switched off' }}</div></td>
            <td class="mono small">{{ c.controlKey ?? '—' }}</td>
            <td class="small">{{ c.schedule === 'manual' ? 'On request' : c.schedule }}<div v-if="c.nextPullAt" class="faint">next {{ new Date(c.nextPullAt).toLocaleString() }}</div></td>
            <td class="small"><span :style="{ color: c.lastStatus === 'failed' ? 'var(--danger)' : c.lastStatus === 'added' ? 'var(--ok)' : '' }">{{ STATUS[c.lastStatus] }}</span><div v-if="c.lastPullAt" class="faint">{{ ago(c.lastPullAt) }} ago · {{ c.lastMessage }}</div></td>
            <td class="row" style="gap: 4px; justify-content: flex-end">
              <button v-if="app.can('prepare')" class="btn sm" :disabled="busy === c.id || !c.enabled" @click="pullNow(c)">{{ busy === c.id ? 'Pulling…' : 'Pull now' }}</button>
              <template v-if="manage && app.can('manage_engagement')">
                <button class="btn sm ghost" @click="form = { editing: c }">Edit</button>
                <button class="btn sm ghost" @click="remove(c)">Remove</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="manage && app.can('manage_models')" type="button" class="switch" :class="{ on: allowPrivate }" role="switch" :aria-checked="allowPrivate" @click="setPrivate(!allowPrivate)">
      <span class="track" /><span class="small">Allow connectors to reach this machine or a private network (only for client systems on your own network)</span>
    </button>
    <ConnectorForm v-if="form" :editing="form.editing" :tool="form.tool" :controls="props.controls" @saved="saved" @close="form = null" />
  </div>
</template>
