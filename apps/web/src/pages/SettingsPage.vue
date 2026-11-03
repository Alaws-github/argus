<script setup lang="ts">
// Engagement settings. Engagements on the left (like projects), five tabs on
// the right: General (details, pause, archive or delete), Workflow & gates,
// Integrations (evidence connectors), Agents (add, route, model, limits,
// instructions, kill switch) and Access. Workspace-wide settings live under
// Workspace settings instead.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AGENT_ROLES, AGENT_TOOLS, AGENT_TOOL_INFO, EFFORTS, ROUTE_LABELS, STAGES, STAGE_LABELS,
  type AgentConfig, type Provider, type Stage,
  type Engagement,
} from '@gh/shared';
import { useApp } from '../stores/app';
import EngagementAccess from '../components/EngagementAccess.vue';
import ConnectorsTab from '../components/ConnectorsTab.vue';
import { api } from '../api';

const app = useApp();
const route = useRoute();
const router = useRouter();
const TABS = { general: 'General', workflow: 'Workflow & gates', integrations: 'Integrations', agents: 'Agents', access: 'Access' } as const;
const tab = computed(() => (String(route.params.tab) in TABS ? String(route.params.tab) : 'general'));
async function openEngagement(id: string) {
  if (id === app.engagementId) return;
  await app.switchEngagement(id);
}

const providers = ref<Provider[]>([]);
const agents = ref<AgentConfig[]>([]);
const selectedId = ref<string>('');
const saving = ref(false);

onMounted(async () => {
  if (!app.engagementId) await app.init();
  await loadAll();
});

const controls = ref<any[]>([]);
async function loadAll() {
  providers.value = await api('/providers');
  controls.value = await api(`/engagements/${app.engagementId}/controls`).catch(() => []);
  agents.value = await api(`/engagements/${app.engagementId}/agents`);
  if (!selectedId.value && agents.value[0]) selectedId.value = agents.value[0].id;
  resetGeneral();
  resetAgent();
}

// ------------------------------------------------------------------ General
const general = reactive({ name: '', client: '', prefix: '', framework: '', about: '', paused: false });
function resetGeneral() {
  const e = app.engagement;
  if (e) Object.assign(general, { name: e.name, client: e.client, prefix: e.prefix, framework: e.framework, about: e.about, paused: e.paused });
}
const generalDirty = computed(() => {
  const e = app.engagement;
  return !!e && (['name', 'client', 'prefix', 'framework', 'about', 'paused'] as const).some((k) => general[k] !== e[k]);
});
const archiveReason = ref('');
const confirmName = ref('');
const busyArchive = ref(false);
async function archive() {
  if (!window.confirm(`Archive ${app.engagement?.name}? It becomes read-only until someone restores it.`)) return;
  busyArchive.value = true;
  try {
    const e = await api<Engagement>(`/engagements/${app.engagementId}/archive`, { method: 'POST', body: { reason: archiveReason.value } });
    Object.assign(app.engagement!, e);
    app.toast(`${e.name} archived`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busyArchive.value = false;
  }
}
async function restore() {
  busyArchive.value = true;
  try {
    const e = await api<Engagement>(`/engagements/${app.engagementId}/restore`, { method: 'POST' });
    Object.assign(app.engagement!, e);
    app.toast(`${e.name} restored`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busyArchive.value = false;
  }
}
async function remove() {
  // Capture the id first: the server's broadcast can switch engagements before this request returns.
  const gone = app.engagementId;
  const name = app.engagement!.name;
  busyArchive.value = true;
  try {
    const r = await api(`/engagements/${gone}`, { method: 'DELETE', body: { confirm: confirmName.value } });
    app.engagements = app.engagements.filter((e) => e.id !== gone);
    if (app.engagementId === gone) await app.switchEngagement(app.active[0]?.id ?? '');
    app.toast(`${name} deleted: ${r.removed.cards} use cases, ${r.removed.evidence} evidence items. The audit log keeps the record.`);
    router.push('/');
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busyArchive.value = false;
  }
}

async function saveGeneral() {
  saving.value = true;
  try {
    await api(`/engagements/${app.engagementId}`, { method: 'PATCH', body: { ...general } });
    app.toast('Engagement settings saved');
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

// ----------------------------------------------------------------- Workflow
const youDo: Partial<Record<Stage, string>> = {
  intake: 'Take each new use case forward, or close it with a note',
  classify: 'Approve the tier, oversight model and starting risks, or send it back',
  design: 'Approve the controls for each risk',
  evidence: 'Check the evidence pack is complete',
  test: 'Review failed tests',
  remediate: 'Confirm the fix with the control owner',
  validate: 'Second-line sign-off before the report',
  report: 'Approve the board summary',
};
const agentFor = (s: Stage) => agents.value.find((a) => a.stage === s);
async function toggleGate(s: Stage) {
  if (s === 'intake' || s === 'closed') return;
  try {
    await api(`/engagements/${app.engagementId}`, { method: 'PATCH', body: { gates: { [s]: !app.engagement?.gates[s] } } });
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}

// ------------------------------------------------------------------- Agents
// A new agent is a draft until "Create agent": shown in the list as "Not saved yet".
const NEW = 'new';
const newStage = ref<Stage>('classify');
const agentStagesList = computed(() => STAGES.filter((s) => Object.values(AGENT_ROLES).some((m) => m.stage === s && m.built)));
const selected = computed<AgentConfig | null>(() => {
  if (selectedId.value !== NEW) return agents.value.find((a) => a.id === selectedId.value) ?? null;
  const base = agents.value.find((a) => a.stage === newStage.value && !a.custom) ?? agents.value[0];
  return base ? { ...base, id: NEW, name: 'New agent', custom: true, enabled: true, route: 'all', instructions: '', summary: '', killedAt: null, killTestedAt: null, activeRuns: 0, stage: newStage.value } : null;
});
const isNew = computed(() => selectedId.value === NEW);
function startNew() {
  newStage.value = (agents.value.find((a) => a.id === selectedId.value)?.stage as Stage) ?? 'classify';
  if (newStage.value === 'intake' || !agentStagesList.value.includes(newStage.value)) newStage.value = 'classify';
  selectedId.value = NEW;
}
watch(newStage, () => {
  if (!isNew.value) return;
  const name = draft.name;
  resetAgent();
  draft.name = name;
});
async function createAgent() {
  const [fbProvider, fbModel] = draft.fallback ? draft.fallback.split('|') : [null, null];
  saving.value = true;
  try {
    const a = await api<AgentConfig>(`/engagements/${app.engagementId}/agents`, {
      method: 'POST',
      body: {
        stage: newStage.value, name: draft.name, enabled: draft.enabled, route: draft.route, summary: draft.summary,
        providerId: draft.providerId || null, model: draft.model, effort: draft.effort,
        fallbackProviderId: fbProvider, fallbackModel: fbModel, instructions: draft.instructions, tools: draft.tools,
        maxCostUsd: Number(draft.maxCostUsd), timeoutMin: Number(draft.timeoutMin), concurrency: Number(draft.concurrency),
      },
    });
    agents.value = await api(`/engagements/${app.engagementId}/agents`);
    selectedId.value = a.id;
    app.toast(`${a.name} created. It takes ${ROUTE_LABELS[a.route].toLowerCase()} on ${STAGE_LABELS[a.stage]}.`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}
async function duplicateAgent() {
  try {
    const a = await api<AgentConfig>(`/agents/${selected.value!.id}/duplicate`, { method: 'POST' });
    agents.value = await api(`/engagements/${app.engagementId}/agents`);
    selectedId.value = a.id;
    app.toast(`${a.name} created, switched off. Change what it takes, then turn it on.`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function deleteAgent() {
  const a = selected.value!;
  if (!window.confirm(`Delete ${a.name}? Its past runs stay in the record.`)) return;
  try {
    await api(`/agents/${a.id}`, { method: 'DELETE' });
    agents.value = await api(`/engagements/${app.engagementId}/agents`);
    selectedId.value = agents.value.find((x) => x.stage === a.stage)?.id ?? agents.value[0]?.id ?? '';
    app.toast(`${a.name} deleted`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
// What differs from the stage's built-in agent, so a lead can see and reset it.
const baseOf = computed(() => (selected.value?.custom ? agents.value.find((a) => a.stage === selected.value!.stage && !a.custom) ?? null : null));
const overrides = computed(() => {
  const b = baseOf.value;
  if (!b || isNew.value) return [] as { label: string; reset: () => void }[];
  const out: { label: string; reset: () => void }[] = [];
  if (draft.providerId !== (b.providerId ?? '') || draft.model !== b.model) out.push({ label: 'model', reset: () => { draft.providerId = b.providerId ?? ''; draft.model = b.model; } });
  const bfb = b.fallbackModel ? `${b.fallbackProviderId ?? b.providerId}|${b.fallbackModel}` : '';
  if (draft.fallback !== bfb) out.push({ label: 'fallback', reset: () => (draft.fallback = bfb) });
  if (draft.instructions !== b.instructions) out.push({ label: 'instructions', reset: () => (draft.instructions = b.instructions) });
  if (draft.tools.join() !== b.tools.join()) out.push({ label: 'tools', reset: () => (draft.tools = [...b.tools]) });
  return out;
});
const draft = reactive({
  name: '', enabled: false, route: 'all', summary: '', providerId: '', model: '', effort: 'medium',
  fallback: '', instructions: '', tools: [] as string[], maxCostUsd: '1', timeoutMin: '10', concurrency: '2',
});
function resetAgent() {
  const a = selected.value;
  if (!a) return;
  Object.assign(draft, {
    name: a.name, enabled: a.enabled, route: a.route, summary: a.summary, providerId: a.providerId ?? '', model: a.model,
    effort: a.effort, fallback: a.fallbackModel ? `${a.fallbackProviderId ?? a.providerId}|${a.fallbackModel}` : '',
    instructions: a.instructions, tools: [...a.tools], maxCostUsd: String(a.maxCostUsd), timeoutMin: String(a.timeoutMin), concurrency: String(a.concurrency),
  });
}
watch(selectedId, resetAgent);

const providerOf = (id: string) => providers.value.find((p) => p.id === id);
const stageGroups = computed(() => STAGES.map((s) => ({ stage: s, list: agents.value.filter((a) => a.stage === s) })).filter((g) => g.list.length || (isNew.value && g.stage === newStage.value)));
const modelOptions = computed(() => {
  const p = providerOf(draft.providerId);
  const list = p ? [...p.models] : [];
  if (draft.model && !list.includes(draft.model)) list.unshift(draft.model);
  return list;
});
const fallbackOptions = computed(() =>
  providers.value
    .filter((p) => p.enabled)
    .flatMap((p) => p.models.map((m) => ({ value: `${p.id}|${m}`, label: `${m} · ${p.name}` })))
    .filter((o) => o.value !== `${draft.providerId}|${draft.model}`),
);
function onProviderChange() {
  const p = providerOf(draft.providerId);
  if (p && !p.models.includes(draft.model)) draft.model = p.models[0] ?? '';
}
const agentDirty = computed(() => {
  const a = selected.value;
  if (!a) return false;
  if (isNew.value) return true;
  const fb = a.fallbackModel ? `${a.fallbackProviderId ?? a.providerId}|${a.fallbackModel}` : '';
  return (
    draft.name !== a.name || draft.enabled !== a.enabled || draft.route !== a.route || draft.summary !== a.summary ||
    draft.providerId !== (a.providerId ?? '') || draft.model !== a.model || draft.effort !== a.effort || draft.fallback !== fb ||
    draft.instructions !== a.instructions || draft.tools.join() !== a.tools.join() || Number(draft.maxCostUsd) !== a.maxCostUsd ||
    Number(draft.timeoutMin) !== a.timeoutMin || Number(draft.concurrency) !== a.concurrency
  );
});
async function kill(test: boolean) {
  const a = selected.value!;
  if (!test && !window.confirm(`Stop ${a.name} now? Running work fails safely and it stays off until someone turns it back on.`)) return;
  try {
    const r = await api(`/agents/${a.id}/kill`, { method: 'POST', body: { test } });
    app.toast(test ? 'Kill switch tested: it works. The date is recorded.' : `${a.name} stopped${r.stopped ? `, ${r.stopped} run${r.stopped === 1 ? '' : 's'} ended` : ''}`);
    agents.value = await api(`/engagements/${app.engagementId}/agents`);
    resetAgent();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}

async function saveAgent() {
  const a = selected.value;
  if (!a) return;
  const [fbProvider, fbModel] = draft.fallback ? draft.fallback.split('|') : [null, null];
  saving.value = true;
  try {
    const next = await api<AgentConfig>(`/agents/${a.id}`, {
      method: 'PATCH',
      body: {
        name: draft.name, enabled: draft.enabled, route: draft.route, summary: draft.summary,
        providerId: draft.providerId || null, model: draft.model, effort: draft.effort,
        fallbackProviderId: fbProvider, fallbackModel: fbModel, instructions: draft.instructions, tools: draft.tools,
        maxCostUsd: Number(draft.maxCostUsd), timeoutMin: Number(draft.timeoutMin), concurrency: Number(draft.concurrency),
      },
    });
    agents.value.splice(agents.value.indexOf(a), 1, next);
    resetAgent();
    app.toast(`${next.name} saved. New runs use it.`);
    void app.refreshHealth();
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
</script>

<template>
  <div class="page settings-layout">
    <aside class="eng-list" aria-label="Engagements">
      <span class="label-caps">Engagements</span>
      <button v-for="e in app.active" :key="e.id" class="eng-item" :class="{ selected: e.id === app.engagementId }" @click="openEngagement(e.id)">
        <span class="swatch" :style="{ background: e.color }">{{ e.prefix[0] }}</span>
        <span class="grow clip"><span class="clip" style="display: block">{{ e.name }}</span><span class="small faint clip" style="display: block">{{ e.client }}</span></span>
      </button>
      <template v-if="app.archived.length">
        <span class="label-caps" style="margin-top: 10px">Archived</span>
        <button v-for="e in app.archived" :key="e.id" class="eng-item" :class="{ selected: e.id === app.engagementId }" style="opacity: 0.75" @click="openEngagement(e.id)">
          <span class="swatch" :style="{ background: e.color, filter: 'grayscale(1)' }">{{ e.prefix[0] }}</span>
          <span class="grow clip">{{ e.name }}</span>
        </button>
      </template>
      <RouterLink v-if="app.canRaw('manage_engagement')" to="/engagements/new" class="btn sm" style="margin-top: 8px">+ Add engagement</RouterLink>
      <RouterLink v-if="app.canRaw('manage_models') || app.canRaw('manage_users')" to="/workspace" class="small faint-link" style="margin-top: 14px">Workspace settings →</RouterLink>
    </aside>
    <div class="settings-main">
    <div class="page-head">
      <div>
        <h1>{{ app.engagement?.name }}</h1>
        <p>Settings for this engagement. Changes apply to new runs; runs in progress keep the settings they started with.</p>
      </div>
      <span class="badge" :class="app.engagement?.archivedAt ? 'warn' : app.engagement?.paused ? 'warn' : 'ok'">{{ app.engagement?.archivedAt ? 'Archived' : app.engagement?.paused ? 'Paused' : 'Active' }} · {{ agents.filter((a) => a.enabled).length }} agent{{ agents.filter((a) => a.enabled).length === 1 ? '' : 's' }} on</span>
    </div>

    <nav class="tabs" aria-label="Settings sections">
      <RouterLink v-for="(label, t) in TABS" :key="t" :to="`/settings/${t}`" :class="{ active: tab === t }">{{ label }}</RouterLink>
    </nav>

    <!-- General -->
    <section v-if="tab === 'general'" class="card">
      <fieldset class="bare" :disabled="!!app.engagement?.archivedAt || !app.can('manage_engagement')">
      <h2>General</h2>
      <div class="grid" style="grid-template-columns: 1fr 1fr">
        <label class="field"><span>Engagement name</span><input v-model="general.name" class="input" /></label>
        <label class="field"><span>Client</span><input v-model="general.client" class="input" /></label>
        <label class="field"><span>Card prefix</span><input v-model="general.prefix" class="input mono" /><span class="hint">New use cases get keys like {{ general.prefix || 'AI' }}-12. Existing keys don't change.</span></label>
        <label class="field"><span>Frameworks</span><input v-model="general.framework" class="input" /><span class="hint">Shown on Overview and in reports.</span></label>
      </div>
      <label class="field">
        <span>What the engagement is</span>
        <textarea v-model="general.about" class="textarea" style="min-height: 110px" />
        <span class="hint">Every agent reads this with each use case: the client's sector, regulators and anything that changes how risk is judged.</span>
      </label>
      <label class="switch" :class="{ on: general.paused }">
        <input v-model="general.paused" type="checkbox" class="sr-only" /><span class="track" />
        <span><strong style="color: var(--text)">Pause this engagement</strong> No new runs start. Use cases stay where they are.</span>
      </label>
      <div class="row">
        <button class="btn primary" :disabled="!generalDirty || saving" @click="saveGeneral">Save changes</button>
        <button v-if="generalDirty" class="btn ghost" @click="resetGeneral">Discard</button>
      </div>
      </fieldset>
    </section>

    <EngagementAccess v-if="tab === 'access'" />
    <template v-if="tab === 'integrations'">
      <p class="small muted">Evidence connectors pull reports and exports from the client's systems into the evidence vault on a schedule. Preparers can also run them from Testing &gt; Connectors.</p>
      <ConnectorsTab :controls="controls" />
    </template>

    <section v-if="tab === 'general' && app.canRaw('manage_engagement')" class="card danger-zone">
      <h2>Archive or delete</h2>
      <template v-if="!app.engagement?.archivedAt">
        <p class="small muted">Archiving makes this engagement read-only and moves it to the bottom of the switcher. Nothing is removed: use cases, evidence, tests, issues and the audit trail all stay, and a lead can restore it at any time.</p>
        <label class="field"><span>Reason <span class="faint">optional, goes in the audit log</span></span><input v-model="archiveReason" class="input" placeholder="e.g. Engagement complete, report delivered 30 Oct" /></label>
        <div><button class="btn danger" :disabled="busyArchive" @click="archive">Archive this engagement</button></div>
      </template>
      <template v-else>
        <p class="small">Archived {{ new Date(app.engagement.archivedAt).toLocaleString() }} by {{ app.engagement.archivedBy }}<template v-if="app.engagement.archiveReason">: {{ app.engagement.archiveReason }}</template>.</p>
        <div class="row" style="flex-wrap: wrap">
          <button class="btn" :disabled="busyArchive" @click="restore">Restore</button>
          <a class="btn" :href="`/api/engagements/${app.engagementId}/export`">Download the full record (JSON)</a>
        </div>
        <template v-if="app.canRaw('manage_users')">
          <div class="notice danger" style="margin-top: 6px">
            <h3>Delete permanently</h3>
            <p class="small">Removes every use case, risk, control, test, piece of evidence, issue, evaluation and run in this engagement. It can't be undone. The audit log keeps every entry about it, and records who deleted it and what was removed. Download the record first if the client or a regulator may ask for it.</p>
            <label class="field"><span>Type <strong>{{ app.engagement.name }}</strong> to confirm</span><input v-model="confirmName" class="input" autocomplete="off" /></label>
            <div><button class="btn danger" :disabled="confirmName.trim() !== app.engagement.name || busyArchive" @click="remove">Delete this engagement</button></div>
          </div>
        </template>
        <p v-else class="small faint">Only an admin can delete an engagement.</p>
      </template>
    </section>

    <!-- Workflow & gates -->
    <section v-else-if="tab === 'workflow'" class="card">
      <div class="spread"><h2>Workflow &amp; gates</h2><RouterLink to="/settings/agents" class="small">Edit agents</RouterLink></div>
      <p class="small muted">A gate means a named person acts before the use case leaves the stage. The agent drafts; it never approves.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Stage</th><th>Agent</th><th>Gate</th><th>What you do</th></tr></thead>
          <tbody>
            <tr v-for="s in STAGES.filter((x) => x !== 'closed')" :key="s">
              <td><strong>{{ STAGE_LABELS[s] }}</strong></td>
              <td>
                <template v-if="agentFor(s)">
                  <span v-for="a in agents.filter((x) => x.stage === s)" :key="a.id" style="display: block">
                    {{ a.name }}
                    <span class="badge" :class="a.enabled ? 'ok' : ''" style="margin-left: 4px">{{ a.enabled ? 'On' : a.built ? 'Off' : 'Not built yet' }}</span>
                    <span v-if="a.route !== 'all'" class="small faint"> · {{ ROUTE_LABELS[a.route].toLowerCase() }}</span>
                  </span>
                </template>
                <span v-else class="faint">A person</span>
              </td>
              <td>
                <span v-if="s === 'intake'" class="badge warn">Always</span>
                <button v-else class="switch" :class="{ on: app.engagement?.gates[s] }" role="switch" :aria-checked="!!app.engagement?.gates[s]" @click="toggleGate(s)">
                  <span class="track" />{{ app.engagement?.gates[s] ? 'You act' : 'Automatic' }}
                </button>
              </td>
              <td class="small muted">{{ app.engagement?.gates[s] ? youDo[s] : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Agents -->
    <section v-else-if="tab === 'agents'" class="stack">
      <div class="spread" style="align-items: flex-start">
        <p class="small muted" style="max-width: 640px; margin: 0">Each agent owns one stage. Add a second agent to a stage and route cards between them by kind, priority or tier; a card goes to the most specific agent that takes it. Instructions are added after the harness's own rules for that job.</p>
        <button v-if="app.can('manage_agents')" class="btn primary" :disabled="isNew" @click="startNew">+ New agent</button>
      </div>
    <div class="two-pane">
      <aside class="pane-list">
        <template v-for="g in stageGroups" :key="g.stage">
          <span class="label-caps" style="margin-top: 8px">
            {{ STAGE_LABELS[g.stage] }} <span v-if="app.engagement?.gates[g.stage] || g.stage === 'intake'" class="badge warn" style="padding: 0 6px; font-size: 10px">{{ g.stage === 'intake' ? 'You triage' : 'You approve' }}</span>
          </span>
          <button v-for="a in g.list" :key="a.id" class="agent-item" :class="{ selected: a.id === selectedId }" @click="selectedId = a.id">
            <span class="agent-mark">{{ initials(a.name) }}</span>
            <span class="grow" style="text-align: left">
              <strong>{{ a.name }}</strong>
              <span class="mono small faint">{{ a.route !== 'all' ? ROUTE_LABELS[a.route] : a.model }}</span>
            </span>
            <span class="small" :style="{ color: a.enabled ? 'var(--ok)' : 'var(--faint)' }">{{ a.enabled ? 'On' : a.built ? 'Off' : 'Soon' }}</span>
          </button>
          <button v-if="isNew && g.stage === newStage" class="agent-item selected">
            <span class="agent-mark">{{ initials(draft.name || 'New agent') }}</span>
            <span class="grow" style="text-align: left"><strong>{{ draft.name || 'New agent' }}</strong><span class="small faint">New</span></span>
            <span class="small" style="color: var(--warn)">Not saved yet</span>
          </button>
        </template>
      </aside>

      <div v-if="selected" class="card">
        <div class="spread">
          <div class="row" style="min-width: 0"><span class="agent-mark">{{ initials(isNew ? draft.name || 'New agent' : selected.name) }}</span><h2 class="clip">{{ isNew ? draft.name || 'New agent' : selected.name }}</h2>
            <span v-if="isNew" class="badge warn">Not saved yet</span><span v-else-if="selected.custom" class="badge">Added</span></div>
          <label class="switch" :class="{ on: draft.enabled }" :title="selected.built ? '' : 'Not built yet'">
            <input v-model="draft.enabled" type="checkbox" class="sr-only" :disabled="!selected.built" /><span class="track" />{{ draft.enabled ? 'Enabled' : 'Off' }}
          </label>
        </div>
        <div v-if="!selected.built" class="notice warn small">
          {{ AGENT_ROLES[selected.role].name }} isn't built yet, so a person does this stage for now. You can set its model and limits ahead of time.
        </div>

        <div class="grid" style="grid-template-columns: 1fr 1fr">
          <label class="field"><span>Name</span><input v-model="draft.name" class="input" /></label>
          <label class="field">
            <span>Stage</span>
            <select v-if="isNew" v-model="newStage" class="select"><option v-for="s in agentStagesList" :key="s" :value="s">{{ STAGE_LABELS[s] }} · {{ Object.values(AGENT_ROLES).find((m) => m.stage === s)!.name }}'s job</option></select>
            <input v-else class="input" :value="STAGE_LABELS[selected.stage]" disabled />
          </label>
          <label class="field">
            <span>Takes cards</span>
            <select v-model="draft.route" class="select"><option v-for="(l, k) in ROUTE_LABELS" :key="k" :value="k">{{ l }}</option></select>
          </label>
          <label class="field"><span>What it does <span class="faint">optional</span></span><input v-model="draft.summary" class="input" /></label>
        </div>

        <div class="spread"><h3>Model</h3><RouterLink to="/models" class="small">Manage providers</RouterLink></div>
        <div class="grid" style="grid-template-columns: 1fr 1fr">
          <label class="field">
            <span>Provider</span>
            <select v-model="draft.providerId" class="select" @change="onProviderChange">
              <option v-for="p in providers" :key="p.id" :value="p.id" :disabled="!p.enabled">{{ p.name }}{{ p.name === p.service ? '' : ` · ${p.service}` }}{{ p.enabled ? '' : ' (off)' }}</option>
            </select>
          </label>
          <label class="field">
            <span>Model</span>
            <select v-model="draft.model" class="select mono"><option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option></select>
          </label>
          <label class="field">
            <span>Effort</span>
            <select v-model="draft.effort" class="select"><option v-for="e in EFFORTS" :key="e" :value="e">{{ e }}</option></select>
            <span class="hint">Sets how much room the model has to answer, from 2k to 16k output tokens.</span>
          </label>
          <label class="field">
            <span>If it fails or its provider is off</span>
            <select v-model="draft.fallback" class="select">
              <option value="">No fallback, ask me</option>
              <option v-for="o in fallbackOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
        </div>
        <p v-if="providerOf(draft.providerId)?.type === 'rules'" class="small faint">The built-in rules run offline and cost nothing. Pick a model provider for real classifications.</p>

        <label class="field">
          <span>Instructions <span class="faint">added after the harness's own rules</span></span>
          <textarea v-model="draft.instructions" class="textarea mono" style="min-height: 120px" placeholder="What this agent should always do on this engagement. For example: cite Bank of Jamaica guidance where it applies." />
        </label>

        <div class="field">
          <span>Tools it may use</span>
          <label v-for="t in AGENT_TOOLS" :key="t" class="check-row">
            <input v-model="draft.tools" type="checkbox" :value="t" :disabled="t === 'read_profile'" />
            <span><strong>{{ AGENT_TOOL_INFO[t].label }}</strong><span class="muted small hint-inline">{{ AGENT_TOOL_INFO[t].hint }}</span></span>
          </label>
          <label class="check-row"><input type="checkbox" disabled /><span><strong>Approve or sign off</strong><span class="muted small hint-inline">Never. A named person approves at every gate.</span></span></label>
        </div>

        <div class="field">
          <span>Limits per run</span>
          <div class="grid" style="grid-template-columns: repeat(3, 1fr)">
            <label class="field"><span class="small muted">Max spend ($)</span><input v-model="draft.maxCostUsd" class="input" inputmode="decimal" /></label>
            <label class="field"><span class="small muted">Timeout (min)</span><input v-model="draft.timeoutMin" class="input" inputmode="numeric" /></label>
            <label class="field"><span class="small muted">Runs at once</span><input v-model="draft.concurrency" class="input" inputmode="numeric" /></label>
          </div>
          <span class="hint">A run that passes its timeout fails and the use case shows Needs you. A run that costs more than its max spend is flagged in its steps.</span>
        </div>

        <div v-if="!isNew" class="field">
          <span>Kill switch</span>
          <div class="notice" :class="selected.killedAt ? 'danger' : ''" style="padding: 12px">
            <p class="small">
              <template v-if="selected.killedAt">Switched off by the kill switch {{ new Date(selected.killedAt).toLocaleString() }}. Turn it back on above when it's safe.</template>
              <template v-else>Stops this agent at once: running work fails safely, queued work waits for a person. Testing it switches the agent off and back on, and records the date.</template>
            </p>
            <p class="small faint">
              Last tested: {{ selected.killTestedAt ? new Date(selected.killTestedAt).toLocaleDateString() : 'never' }}
              <template v-if="selected.rulesVersion"> · Rules version <span class="mono">{{ selected.rulesVersion }}</span>, stamped on every run</template>
            </p>
            <div v-if="app.can('manage_agents')" class="row">
              <button class="btn sm" @click="kill(true)">Test the kill switch</button>
              <button v-if="selected.enabled" class="btn sm danger" @click="kill(false)">Stop this agent now</button>
            </div>
          </div>
        </div>

        <p v-if="overrides.length" class="small faint">
          Set here, not taken from {{ baseOf?.name }}:
          <template v-for="(o, i) in overrides" :key="o.label">{{ i ? ' / ' : '' }}{{ o.label }} <button class="link-btn" @click="o.reset()">Reset</button></template>
          <template v-if="overrides.length > 1"> / <button class="link-btn" @click="overrides.forEach((o) => o.reset())">Reset all</button></template>
        </p>

        <div class="row" style="flex-wrap: wrap">
          <template v-if="isNew">
            <button class="btn primary" :disabled="saving || draft.name.trim().length < 2" @click="createAgent">Create agent</button>
            <button class="btn ghost" @click="selectedId = agents[0]?.id ?? ''">Discard</button>
          </template>
          <template v-else>
            <button class="btn primary" :disabled="!agentDirty || saving" @click="saveAgent">Save agent</button>
            <button v-if="agentDirty" class="btn ghost" @click="resetAgent">Discard</button>
            <span class="grow" />
            <button v-if="app.can('manage_agents') && selected.role !== 'use_case_planner' || app.can('manage_agents') && selected.custom" class="btn sm" @click="duplicateAgent">Duplicate</button>
            <button v-if="app.can('manage_agents') && selected.custom" class="btn sm danger" @click="deleteAgent">Delete agent</button>
          </template>
        </div>
      </div>
    </div>
    </section>

    <div v-if="(tab === 'general' && generalDirty) || (tab === 'agents' && agentDirty && !isNew)" class="save-bar">
      <span>You have unsaved changes</span>
      <button class="btn ghost sm" @click="tab === 'general' ? resetGeneral() : resetAgent()">Discard</button>
      <button class="btn primary sm" :disabled="saving" @click="tab === 'general' ? saveGeneral() : saveAgent()">Save changes</button>
    </div>
    </div>
  </div>
</template>
