<script setup lang="ts">
// v1.7.3: write-back (Settings > Connected tools). Off by default. When a lead
// switches it on, ARGUS sends messages or creates tickets in the client's
// tools for the events ticked on each target. Every send is audited.
import { computed, onMounted, ref, watch } from 'vue';
import {
  OUTBOUND_EVENTS,
  OUTBOUND_KINDS,
  toolById,
  type OutboundEvent,
  type OutboundKind,
  type OutboundTarget,
} from '@gh/shared';
import { api, ago } from '../api';
import { useApp } from '../stores/app';
import AppIcon from './AppIcon.vue';

const app = useApp();
const list = ref<OutboundTarget[]>([]);
const canEdit = computed(() => app.can('manage_engagement'));
const form = ref<null | {
  id?: string;
  name: string;
  kind: OutboundKind;
  url: string;
  project: string;
  secret: string;
  events: OutboundEvent[];
}>(null);
const busy = ref('');
const on = computed(() => !!app.engagement?.writeBack);

async function load() {
  if (app.engagementId) list.value = await api(`/engagements/${app.engagementId}/outbound`);
}
onMounted(() => load().catch(() => {}));
watch(
  () => app.engagementId,
  () => load().catch(() => {}),
);

async function toggle() {
  const next = !on.value;
  if (
    next &&
    !confirm(
      "Switch write-back on? ARGUS will send messages and create tickets in the client's tools for the events ticked on each target below. It never edits or deletes anything there, and every send is audited.",
    )
  )
    return;
  try {
    const e = await api(`/engagements/${app.engagementId}`, { method: 'PATCH', body: { writeBack: next } });
    Object.assign(app.engagement!, e);
    app.toast(next ? 'Write-back is on' : 'Write-back is off. Nothing will be sent.');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const add = () =>
  (form.value = {
    name: '',
    kind: 'teams',
    url: '',
    project: '',
    secret: '',
    events: ['card.waiting', 'test.failed', 'issue.raised'],
  });
const edit = (t: OutboundTarget) =>
  (form.value = {
    id: t.id,
    name: t.name,
    kind: t.kind,
    url: '',
    project: t.project,
    secret: '',
    events: [...t.events],
  });
async function save() {
  const f = form.value!;
  busy.value = 'save';
  try {
    const body: any = { name: f.name, project: f.project, events: f.events };
    if (f.url) body.url = f.url;
    if (f.secret) body.secret = f.secret;
    if (f.id) await api(`/outbound/${f.id}`, { method: 'PATCH', body });
    else
      await api(`/engagements/${app.engagementId}/outbound`, {
        method: 'POST',
        body: { ...body, kind: f.kind, url: f.url },
      });
    form.value = null;
    app.toast('Saved');
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busy.value = '';
  }
}
async function remove(t: OutboundTarget) {
  if (!confirm(`Remove ${t.key} ${t.name}? Nothing more will be sent to it.`)) return;
  try {
    await api(`/outbound/${t.id}`, { method: 'DELETE' });
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function test(t: OutboundTarget) {
  busy.value = t.id;
  try {
    const r = await api<any>(`/outbound/${t.id}/test`, { method: 'POST' });
    app.toast(r.message);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busy.value = '';
    await load();
  }
}
const needsSecret = computed(() => form.value && (form.value.kind === 'jira' || form.value.kind === 'servicenow'));
const urlLabel = computed(
  () =>
    ({
      teams: 'Teams Workflows or webhook address',
      slack: 'Slack incoming webhook address',
      jira: 'Jira site address',
      servicenow: 'ServiceNow instance address',
      webhook: 'Webhook address',
    })[form.value?.kind ?? 'webhook'],
);
const urlHint = computed(
  () =>
    ({
      teams: 'https://…logic.azure.com/workflows/…',
      slack: 'https://hooks.slack.com/services/…',
      jira: 'https://your-site.atlassian.net',
      servicenow: 'https://your-instance.service-now.com',
      webhook: 'https://…',
    })[form.value?.kind ?? 'webhook'],
);
</script>

<template>
  <section class="card">
    <div class="spread">
      <h2>Write-back</h2>
      <label class="switch-row"
        ><input
          type="checkbox"
          role="switch"
          :checked="on"
          :disabled="!canEdit || !!app.engagement?.archivedAt"
          @change="toggle"
        /><span>{{ on ? 'On' : 'Off' }}</span></label
      >
    </div>
    <p class="small muted"
      >Let ARGUS tell the client's tools what happened: a message in a Teams or Slack channel, a new Jira ticket or
      ServiceNow record, or a post to a webhook, when a use case is waiting for someone, a test fails, an issue or
      incident is raised, a client step isn't done or a use case is signed off. ARGUS only sends new messages and
      creates new tickets; it never edits, closes or deletes anything there, and agents can't send. Every send is in the
      audit log.</p
    >
    <p v-if="!on" class="small" style="color: var(--warn)"
      >Off for this engagement: nothing is sent, even to the targets below.</p
    >

    <div v-if="list.length" class="table-wrap">
      <table>
        <thead
          ><tr><th>Key</th><th>Sends to</th><th>When</th><th>Last send</th><th v-if="canEdit"></th></tr
        ></thead>
        <tbody>
          <tr v-for="t in list" :key="t.id">
            <td class="mono">{{ t.key }}</td>
            <td
              ><i
                class="tool-mono"
                :style="{ background: toolById(OUTBOUND_KINDS[t.kind].tool)?.color ?? '#6b7280' }"
                >{{ toolById(OUTBOUND_KINDS[t.kind].tool)?.mono ?? 'WH' }}</i
              >
              {{ t.name
              }}<div class="small faint"
                >{{ OUTBOUND_KINDS[t.kind].label }}{{ t.project ? ` · ${t.project}` : '' }} ·
                <span class="mono">{{ t.url }}</span></div
              ></td
            >
            <td class="small">{{ t.events.map((e) => OUTBOUND_EVENTS[e]).join('; ') || 'No events ticked' }}</td>
            <td class="small">{{ t.lastAt ? `${ago(t.lastAt)}: ${t.lastMessage}` : 'Never' }}</td>
            <td v-if="canEdit"
              ><div class="row" style="flex-wrap: nowrap">
                <button
                  class="btn sm"
                  :disabled="!on || busy === t.id"
                  :title="on ? 'Sends a test message now' : 'Switch write-back on first'"
                  @click="test(t)"
                  >Send a test</button
                >
                <button class="btn ghost sm" @click="edit(t)">Edit</button>
                <button class="btn ghost sm" @click="remove(t)">Remove</button>
              </div></td
            >
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="canEdit" class="row"
      ><button class="btn sm" @click="add"><AppIcon name="plus" :size="13" />Add a write-back target</button></div
    >

    <template v-if="form">
      <div class="backdrop" @click="form = null" />
      <form class="modal" @submit.prevent="save">
        <div class="spread"
          ><h2>{{ form.id ? 'Edit write-back target' : 'Add a write-back target' }}</h2
          ><button type="button" class="btn ghost sm" aria-label="Close" @click="form = null">✕</button></div
        >
        <div v-if="!form.id" class="field">
          <span>Sends</span>
          <div class="tool-grid" role="radiogroup" style="max-height: none">
            <button
              v-for="(k, id) in OUTBOUND_KINDS"
              :key="id"
              type="button"
              role="radio"
              :aria-checked="form.kind === id"
              :class="{ on: form.kind === id }"
              @click="form.kind = id"
              ><i class="tool-mono" :style="{ background: toolById(k.tool)?.color ?? '#6b7280' }">{{
                toolById(k.tool)?.mono ?? 'WH'
              }}</i
              >{{ k.label }}</button
            >
          </div>
        </div>
        <p class="small muted">{{ OUTBOUND_KINDS[form.kind].help }}</p>
        <label class="field"
          ><span>Name</span
          ><input
            v-model="form.name"
            class="input"
            required
            minlength="3"
            placeholder="For example: Model Risk channel"
        /></label>
        <label class="field"
          ><span>{{ urlLabel }}</span
          ><input
            v-model="form.url"
            class="input mono"
            :required="!form.id"
            :placeholder="form.id ? 'Saved. Leave empty to keep it.' : urlHint"
            autocomplete="off"
        /></label>
        <label v-if="form.kind === 'jira' || form.kind === 'servicenow'" class="field"
          ><span>{{ form.kind === 'jira' ? 'Project key' : 'Table' }}</span
          ><input v-model="form.project" class="input mono" :placeholder="form.kind === 'jira' ? 'GRC' : 'incident'"
        /></label>
        <label v-if="needsSecret || form.kind === 'webhook'" class="field"
          ><span
            >{{ form.kind === 'webhook' ? 'Bearer token' : form.kind === 'jira' ? 'email:API token' : 'user:password' }}
            <span v-if="form.kind === 'webhook'" class="faint">optional</span></span
          ><input
            v-model="form.secret"
            type="password"
            class="input mono"
            autocomplete="off"
            :placeholder="form.id ? 'Saved. Leave empty to keep it.' : ''"
        /></label>
        <div class="field">
          <span>Send when</span>
          <label v-for="(label, e) in OUTBOUND_EVENTS" :key="e" class="check-row"
            ><input v-model="form.events" type="checkbox" :value="e" /><span>{{ label }}</span></label
          >
        </div>
        <p v-if="form.kind === 'jira' || form.kind === 'servicenow'" class="small faint"
          >Each event creates a new {{ form.kind === 'jira' ? 'ticket' : 'record' }}, labelled with the use case key.
          Send a test creates a real one too.</p
        >
        <div class="row"
          ><button class="btn primary" :disabled="busy === 'save'">Save</button
          ><button type="button" class="btn" @click="form = null">Cancel</button></div
        >
      </form>
    </template>
  </section>
</template>

<style scoped>
.switch-row {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.switch-row input {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
}
</style>
