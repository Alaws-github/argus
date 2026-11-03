<script setup lang="ts">
// Evidence connectors: read-only pulls from a client's systems. Each pull is
// fingerprinted and filed in the evidence vault against a control.
import { onMounted, ref } from 'vue';
import type { Connector, EngagementControl } from '@gh/shared';
import { api, ago } from '../api';
import { useApp } from '../stores/app';

const props = defineProps<{ controls: EngagementControl[] }>();
const emit = defineEmits<{ pulled: [] }>();
const app = useApp();
const list = ref<Connector[]>([]);
const allowPrivate = ref(false);
const busy = ref<string | null>(null);

async function load() {
  list.value = await api(`/engagements/${await app.eid()}/connectors`).catch(() => []);
  if (app.can('manage_models')) allowPrivate.value = (await api('/settings').catch(() => ({})))?.connectorsAllowPrivate ?? false;
}
onMounted(load);

const blank = () => ({ name: '', url: '', auth: 'none', headerName: '', secret: '', controlId: '', schedule: 'manual' });
const form = ref(blank());
const editing = ref<Connector | null>(null);
const open = ref(false);
function start(c?: Connector) {
  editing.value = c ?? null;
  form.value = c ? { name: c.name, url: c.url, auth: c.auth, headerName: c.headerName, secret: '', controlId: c.controlId ?? '', schedule: c.schedule } : blank();
  open.value = true;
}
async function save() {
  try {
    const body: any = { ...form.value, controlId: form.value.controlId || null };
    if (!body.secret) delete body.secret;
    if (editing.value) await api(`/connectors/${editing.value.id}`, { method: 'PATCH', body });
    else await api(`/engagements/${app.engagementId}/connectors`, { method: 'POST', body });
    open.value = false;
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
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
  if (!window.confirm(`Remove ${c.key} ${c.name}? Evidence it already pulled stays in the vault.`)) return;
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
const STATUS: Record<string, string> = { never: 'Not pulled yet', added: 'New evidence added', unchanged: 'No change', failed: 'Failed' };
</script>

<template>
  <div class="stack" style="gap: 12px">
    <div class="spread" style="flex-wrap: wrap; gap: 8px">
      <p class="small muted" style="max-width: 760px">A connector pulls a report, export or file from a client system over HTTPS, read-only, and files it here as fingerprinted evidence against a control. Use the system's report or export link with an API token. Credentials are encrypted and never shown again.</p>
      <button v-if="app.can('manage_engagement')" class="btn primary" @click="start()">Add connector</button>
    </div>
    <div v-if="!list.length" class="card muted small">No connectors yet.</div>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Connector</th><th>Control</th><th>Schedule</th><th>Last pull</th><th /></tr></thead>
        <tbody>
          <tr v-for="c in list" :key="c.id">
            <td class="mono">{{ c.key }}</td>
            <td style="min-width: 240px">{{ c.name }}<div class="small faint mono" style="white-space: normal; word-break: break-all">{{ c.url }}</div><div class="small faint">{{ c.auth === 'none' ? 'No sign-in' : `${c.auth} credential ${c.secretSet ? 'saved' : 'missing'}` }}{{ c.enabled ? '' : ' · switched off' }}</div></td>
            <td class="mono small">{{ c.controlKey ?? '—' }}</td>
            <td class="small">{{ c.schedule === 'manual' ? 'On request' : c.schedule }}<div v-if="c.nextPullAt" class="faint">next {{ new Date(c.nextPullAt).toLocaleString() }}</div></td>
            <td class="small"><span :style="{ color: c.lastStatus === 'failed' ? 'var(--danger)' : c.lastStatus === 'added' ? 'var(--ok)' : '' }">{{ STATUS[c.lastStatus] }}</span><div v-if="c.lastPullAt" class="faint">{{ ago(c.lastPullAt) }} ago · {{ c.lastMessage }}</div></td>
            <td class="row" style="gap: 4px; justify-content: flex-end">
              <button v-if="app.can('prepare')" class="btn sm" :disabled="busy === c.id || !c.enabled" @click="pullNow(c)">{{ busy === c.id ? 'Pulling…' : 'Pull now' }}</button>
              <button v-if="app.can('manage_engagement')" class="btn sm ghost" @click="start(c)">Edit</button>
              <button v-if="app.can('manage_engagement')" class="btn sm ghost" @click="remove(c)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="app.can('manage_models')" type="button" class="switch" :class="{ on: allowPrivate }" role="switch" :aria-checked="allowPrivate" @click="setPrivate(!allowPrivate)">
      <span class="track" /><span class="small">Allow connectors to reach this machine or a private network (only for client systems on your own network)</span>
    </button>

    <template v-if="open">
      <div class="backdrop" @click="open = false" />
      <form class="modal" @submit.prevent="save">
        <div class="spread"><h2>{{ editing ? `Edit ${editing.key}` : 'Add a connector' }}</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="open = false">✕</button></div>
        <label class="field"><span>Name</span><input v-model="form.name" class="input" required minlength="3" placeholder="e.g. Loan decisions export" /></label>
        <label class="field"><span>Address</span><input v-model="form.url" class="input mono" required placeholder="https://reports.client.example/loan-decisions.csv" /><span class="hint">A report, export or file link. The harness only ever reads it.</span></label>
        <div class="split">
          <label class="field"><span>Sign-in</span><select v-model="form.auth" class="select"><option value="none">None</option><option value="bearer">Bearer token</option><option value="header">API key in a header</option><option value="basic">User and password</option></select></label>
          <label v-if="form.auth === 'header'" class="field"><span>Header name</span><input v-model="form.headerName" class="input mono" placeholder="x-api-key" /></label>
        </div>
        <label v-if="form.auth !== 'none'" class="field"><span>{{ form.auth === 'basic' ? 'user:password' : 'Token or key' }}</span><input v-model="form.secret" type="password" class="input mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved. Leave empty to keep it.' : ''" /></label>
        <div class="split">
          <label class="field"><span>File against control</span><select v-model="form.controlId" class="select"><option value="">None</option><option v-for="c in props.controls" :key="c.id" :value="c.id">{{ c.key }} {{ c.title }}</option></select></label>
          <label class="field"><span>Pull</span><select v-model="form.schedule" class="select"><option value="manual">On request</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
        </div>
        <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" @click="open = false">Cancel</button></div>
      </form>
    </template>
  </div>
</template>
