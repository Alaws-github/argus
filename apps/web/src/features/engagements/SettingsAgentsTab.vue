<script setup lang="ts">
// Settings > AI Agents: each stage's agent (and any added ones), its model, fallback, instructions,
// how it works, tools, limits and kill switch. A new agent is a draft until "Create agent".
// Part of SettingsPage.vue (split out in v1.7.8); the page owns the agents list.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  AGENT_ROLES,
  AGENT_TOOLS,
  AGENT_TOOL_INFO,
  EFFORTS,
  ROUTE_LABELS,
  STAGES,
  STAGE_LABELS,
  type AgentConfig,
  type Provider,
  type Stage,
} from '@gh/shared';
import { useApp } from '../../stores/app';
import { api } from '../../api';

const app = useApp();
/** The engagement's agents, shared with the page (its header counts the ones switched on). */
const agents = defineModel<AgentConfig[]>('agents', { required: true });
const providers = ref<Provider[]>([]);
const selectedId = ref<string>(agents.value[0]?.id ?? '');
const saving = ref(false);

onMounted(async () => {
  providers.value = await api('/providers');
  resetAgent();
});

// ------------------------------------------------------------------- Agents
// A new agent is a draft until "Create agent": shown in the list as "Not saved yet".
const NEW = 'new';
const newStage = ref<Stage>('classify');
const agentStagesList = computed(() =>
  STAGES.filter((s) => Object.values(AGENT_ROLES).some((m) => m.stage === s && m.built)),
);
const selected = computed<AgentConfig | null>(() => {
  if (selectedId.value !== NEW) return agents.value.find((a) => a.id === selectedId.value) ?? null;
  const base = agents.value.find((a) => a.stage === newStage.value && !a.custom) ?? agents.value[0];
  return base
    ? {
        ...base,
        id: NEW,
        name: 'New agent',
        custom: true,
        enabled: true,
        route: 'all',
        instructions: '',
        summary: '',
        killedAt: null,
        killTestedAt: null,
        activeRuns: 0,
        stage: newStage.value,
      }
    : null;
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
        stage: newStage.value,
        name: draft.name,
        enabled: draft.enabled,
        route: draft.route,
        summary: draft.summary,
        providerId: draft.providerId || null,
        model: draft.model,
        effort: draft.effort,
        fallbackProviderId: fbProvider,
        fallbackModel: fbModel,
        instructions: draft.instructions,
        tools: draft.tools,
        maxCostUsd: Number(draft.maxCostUsd),
        timeoutMin: Number(draft.timeoutMin),
        concurrency: Number(draft.concurrency),
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
const baseOf = computed(() =>
  selected.value?.custom ? (agents.value.find((a) => a.stage === selected.value!.stage && !a.custom) ?? null) : null,
);
const overrides = computed(() => {
  const b = baseOf.value;
  if (!b || isNew.value) return [] as { label: string; reset: () => void }[];
  const out: { label: string; reset: () => void }[] = [];
  if (draft.providerId !== (b.providerId ?? '') || draft.model !== b.model)
    out.push({
      label: 'model',
      reset: () => {
        draft.providerId = b.providerId ?? '';
        draft.model = b.model;
      },
    });
  const bfb = b.fallbackModel ? `${b.fallbackProviderId ?? b.providerId}|${b.fallbackModel}` : '';
  if (draft.fallback !== bfb) out.push({ label: 'fallback', reset: () => (draft.fallback = bfb) });
  if (draft.instructions !== b.instructions)
    out.push({ label: 'instructions', reset: () => (draft.instructions = b.instructions) });
  if (draft.tools.join() !== b.tools.join()) out.push({ label: 'tools', reset: () => (draft.tools = [...b.tools]) });
  return out;
});
const draft = reactive({
  name: '',
  enabled: false,
  route: 'all',
  summary: '',
  providerId: '',
  model: '',
  effort: 'medium',
  fallback: '',
  instructions: '',
  tools: [] as string[],
  maxCostUsd: '1',
  timeoutMin: '10',
  concurrency: '2',
  mode: 'agentic' as 'agentic' | 'single',
  maxSteps: '8',
  selfCheck: true,
});
function resetAgent() {
  const a = selected.value;
  if (!a) return;
  Object.assign(draft, {
    name: a.name,
    enabled: a.enabled,
    route: a.route,
    summary: a.summary,
    providerId: a.providerId ?? '',
    model: a.model,
    effort: a.effort,
    fallback: a.fallbackModel ? `${a.fallbackProviderId ?? a.providerId}|${a.fallbackModel}` : '',
    instructions: a.instructions,
    tools: [...a.tools],
    maxCostUsd: String(a.maxCostUsd),
    timeoutMin: String(a.timeoutMin),
    concurrency: String(a.concurrency),
    mode: a.mode,
    maxSteps: String(a.maxSteps),
    selfCheck: a.selfCheck,
  });
}
watch(selectedId, resetAgent);

const providerOf = (id: string) => providers.value.find((p) => p.id === id);
const stageGroups = computed(() =>
  STAGES.map((s) => ({ stage: s, list: agents.value.filter((a) => a.stage === s) })).filter(
    (g) => g.list.length || (isNew.value && g.stage === newStage.value),
  ),
);
const modelOptions = computed(() => {
  const p = providerOf(draft.providerId);
  const list = p ? [...p.models] : [];
  if (draft.model && !list.includes(draft.model)) list.unshift(draft.model);
  return list;
});
// The offline rules come first: as a fallback they mean a failed model call
// still leaves a cautious draft for a person, instead of a failed card.
const fallbackOptions = computed(() =>
  providers.value
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.models
        .filter((m) => m !== 'demo-chatbot-v1')
        .map((m) => ({
          value: `${p.id}|${m}`,
          label:
            p.type === 'rules'
              ? 'Built-in rules (offline): a cautious draft instead of a failed card'
              : `${m} · ${p.name}`,
          rules: p.type === 'rules',
        })),
    )
    .filter((o) => o.value !== `${draft.providerId}|${draft.model}`)
    .sort((a, b) => Number(b.rules) - Number(a.rules)),
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
    draft.name !== a.name ||
    draft.enabled !== a.enabled ||
    draft.route !== a.route ||
    draft.summary !== a.summary ||
    draft.providerId !== (a.providerId ?? '') ||
    draft.model !== a.model ||
    draft.effort !== a.effort ||
    draft.fallback !== fb ||
    draft.instructions !== a.instructions ||
    draft.tools.join() !== a.tools.join() ||
    Number(draft.maxCostUsd) !== a.maxCostUsd ||
    Number(draft.timeoutMin) !== a.timeoutMin ||
    Number(draft.concurrency) !== a.concurrency ||
    draft.mode !== a.mode ||
    Number(draft.maxSteps) !== a.maxSteps ||
    draft.selfCheck !== a.selfCheck
  );
});
async function kill(test: boolean) {
  const a = selected.value!;
  if (
    !test &&
    !window.confirm(`Stop ${a.name} now? Running work fails safely and it stays off until someone turns it back on.`)
  )
    return;
  try {
    const r = await api(`/agents/${a.id}/kill`, { method: 'POST', body: { test } });
    app.toast(
      test
        ? 'Kill switch tested: it works. The date is recorded.'
        : `${a.name} stopped${r.stopped ? `, ${r.stopped} run${r.stopped === 1 ? '' : 's'} ended` : ''}`,
    );
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
        name: draft.name,
        enabled: draft.enabled,
        route: draft.route,
        summary: draft.summary,
        providerId: draft.providerId || null,
        model: draft.model,
        effort: draft.effort,
        fallbackProviderId: fbProvider,
        fallbackModel: fbModel,
        instructions: draft.instructions,
        tools: draft.tools,
        maxCostUsd: Number(draft.maxCostUsd),
        timeoutMin: Number(draft.timeoutMin),
        concurrency: Number(draft.concurrency),
        mode: draft.mode,
        maxSteps: Number(draft.maxSteps),
        selfCheck: draft.selfCheck,
      },
    });
    agents.value = agents.value.map((x) => (x === a ? next : x));
    resetAgent();
    app.toast(`${next.name} saved. New runs use it.`);
    void app.refreshHealth();
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
</script>

<template>
  <section class="stack">
    <div class="spread" style="align-items: flex-start">
      <p class="small muted" style="max-width: 640px; margin: 0"
        >The AI drafts each step; a person decides. Each agent does one step's work, on the model you choose; its
        instructions are added after the harness's own rules for that job.<template v-if="app.mod('advanced_ai')">
          Add a second agent to a step and route cards between them by kind, priority or tier; a card goes to the most
          specific agent that takes it.</template
        ><template v-else>
          To add more agents and route cards between them, switch on Advanced AI settings under General.</template
        ></p
      >
      <button
        v-if="app.can('manage_agents') && app.mod('advanced_ai')"
        class="btn primary"
        :disabled="isNew"
        @click="startNew"
        >+ New agent</button
      >
    </div>
    <div class="two-pane">
      <aside class="pane-list">
        <template v-for="g in stageGroups" :key="g.stage">
          <span class="label-caps" style="margin-top: 8px">
            {{ STAGE_LABELS[g.stage] }}
            <span
              v-if="app.engagement?.gates[g.stage] || g.stage === 'intake'"
              class="badge warn"
              style="padding: 0 6px; font-size: 10px"
              >{{ g.stage === 'intake' ? 'You triage' : 'You approve' }}</span
            >
          </span>
          <button
            v-for="a in g.list"
            :key="a.id"
            class="agent-item"
            :class="{ selected: a.id === selectedId }"
            @click="selectedId = a.id"
          >
            <span class="agent-mark">{{ initials(a.name) }}</span>
            <span class="grow" style="text-align: left">
              <strong>{{ a.name }}</strong>
              <span class="mono small faint">{{ a.route !== 'all' ? ROUTE_LABELS[a.route] : a.model }}</span>
            </span>
            <span class="small" :style="{ color: a.enabled ? 'var(--ok)' : 'var(--faint)' }">{{
              a.enabled ? 'On' : a.built ? 'Off' : 'Soon'
            }}</span>
          </button>
          <button v-if="isNew && g.stage === newStage" class="agent-item selected">
            <span class="agent-mark">{{ initials(draft.name || 'New agent') }}</span>
            <span class="grow" style="text-align: left"
              ><strong>{{ draft.name || 'New agent' }}</strong
              ><span class="small faint">New</span></span
            >
            <span class="small" style="color: var(--warn)">Not saved yet</span>
          </button>
        </template>
      </aside>

      <div v-if="selected" class="card">
        <div class="spread">
          <div class="row" style="min-width: 0"
            ><span class="agent-mark">{{ initials(isNew ? draft.name || 'New agent' : selected.name) }}</span
            ><h2 class="clip">{{ isNew ? draft.name || 'New agent' : selected.name }}</h2>
            <span v-if="isNew" class="badge warn">Not saved yet</span
            ><span v-else-if="selected.custom" class="badge">Added</span></div
          >
          <label class="switch" :class="{ on: draft.enabled }" :title="selected.built ? '' : 'Not built yet'">
            <input v-model="draft.enabled" type="checkbox" class="sr-only" :disabled="!selected.built" /><span
              class="track"
            />{{ draft.enabled ? 'Enabled' : 'Off' }}
          </label>
        </div>
        <div v-if="!selected.built" class="notice warn small">
          {{ AGENT_ROLES[selected.role].name }} isn't built yet, so a person does this stage for now. You can set its
          model and limits ahead of time.
        </div>

        <div class="grid" style="grid-template-columns: 1fr 1fr">
          <label class="field"><span>Name</span><input v-model="draft.name" class="input" /></label>
          <label class="field">
            <span>Stage</span>
            <select v-if="isNew" v-model="newStage" class="select"
              ><option v-for="s in agentStagesList" :key="s" :value="s"
                >{{ STAGE_LABELS[s] }} · {{ Object.values(AGENT_ROLES).find((m) => m.stage === s)!.name }}'s job</option
              ></select
            >
            <input v-else class="input" :value="STAGE_LABELS[selected.stage]" disabled />
          </label>
          <label v-if="app.mod('advanced_ai') || draft.route !== 'all'" class="field">
            <span>Takes cards</span>
            <select v-model="draft.route" class="select"
              ><option v-for="(l, k) in ROUTE_LABELS" :key="k" :value="k">{{ l }}</option></select
            >
          </label>
          <label class="field"
            ><span>What it does <span class="faint">optional</span></span
            ><input v-model="draft.summary" class="input"
          /></label>
        </div>

        <div class="spread"><h3>Model</h3><RouterLink to="/models" class="small">Manage providers</RouterLink></div>
        <div class="grid" style="grid-template-columns: 1fr 1fr">
          <label class="field">
            <span>Provider</span>
            <select v-model="draft.providerId" class="select" @change="onProviderChange">
              <option v-for="p in providers" :key="p.id" :value="p.id" :disabled="!p.enabled"
                >{{ p.name }}{{ p.name === p.service ? '' : ` · ${p.service}` }}{{ p.enabled ? '' : ' (off)' }}</option
              >
            </select>
          </label>
          <label class="field">
            <span>Model</span>
            <select v-model="draft.model" class="select mono"
              ><option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option></select
            >
          </label>
          <label class="field">
            <span>Effort</span>
            <select v-model="draft.effort" class="select"
              ><option v-for="e in EFFORTS" :key="e" :value="e">{{ e }}</option></select
            >
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
        <p v-if="providerOf(draft.providerId)?.type === 'rules'" class="small faint"
          >The built-in rules run offline and cost nothing. Pick a model provider for real classifications.</p
        >

        <label class="field">
          <span>Instructions <span class="faint">added after the harness's own rules</span></span>
          <textarea
            v-model="draft.instructions"
            class="textarea mono"
            style="min-height: 120px"
            placeholder="What this agent should always do on this engagement. For example: cite Bank of Jamaica guidance where it applies."
          />
        </label>

        <div class="field">
          <span>How it works</span>
          <div class="segmented" role="group" aria-label="How the agent works" style="align-self: flex-start">
            <button type="button" :class="{ on: draft.mode === 'agentic' }" @click="draft.mode = 'agentic'"
              >Agentic</button
            >
            <button type="button" :class="{ on: draft.mode === 'single' }" @click="draft.mode = 'single'"
              >Single call</button
            >
          </div>
          <span class="hint">{{
            draft.mode === 'agentic'
              ? 'It looks things up with the tools below as often as it needs, can ask a person, and checks its own draft before handing it in. Every step is in the run log.'
              : "One call with a fixed brief, as before v1.6. Cheaper and predictable, but it can't look anything up or ask."
          }}</span>
          <div
            v-if="draft.mode === 'agentic'"
            class="grid"
            style="grid-template-columns: repeat(2, 1fr); align-items: end"
          >
            <label class="field"
              ><span class="small muted">Most steps per run (2 to 20)</span
              ><input v-model="draft.maxSteps" class="input" inputmode="numeric"
            /></label>
            <label class="check-row"
              ><input v-model="draft.selfCheck" type="checkbox" /><span
                ><strong>Self-check</strong
                ><span class="muted small hint-inline">Reviews its own draft once against its rubric</span></span
              ></label
            >
          </div>
          <span v-if="providerOf(draft.providerId)?.type === 'rules'" class="hint"
            >The offline rules always run as one call.</span
          >
        </div>

        <div class="field">
          <span>Tools it may use</span>
          <label v-for="t in AGENT_TOOLS" :key="t" class="check-row">
            <input v-model="draft.tools" type="checkbox" :value="t" :disabled="t === 'read_profile'" />
            <span
              ><strong>{{ AGENT_TOOL_INFO[t].label }}</strong
              ><span class="muted small hint-inline">{{ AGENT_TOOL_INFO[t].hint }}</span></span
            >
          </label>
          <label class="check-row"
            ><input type="checkbox" disabled /><span
              ><strong>Approve or sign off</strong
              ><span class="muted small hint-inline">Never. A named person approves at every gate.</span></span
            ></label
          >
        </div>

        <div class="field">
          <span>Limits per run</span>
          <div class="grid" style="grid-template-columns: repeat(3, 1fr)">
            <label class="field"
              ><span class="small muted">Max spend ($)</span
              ><input v-model="draft.maxCostUsd" class="input" inputmode="decimal"
            /></label>
            <label class="field"
              ><span class="small muted">Timeout (min)</span
              ><input v-model="draft.timeoutMin" class="input" inputmode="numeric"
            /></label>
            <label class="field"
              ><span class="small muted">Runs at once</span
              ><input v-model="draft.concurrency" class="input" inputmode="numeric"
            /></label>
          </div>
          <span class="hint"
            >A run that passes its timeout fails and the use case shows Needs you. A run that costs more than its max
            spend is flagged in its steps.</span
          >
        </div>

        <div v-if="!isNew" class="field">
          <span>Kill switch</span>
          <div class="notice" :class="selected.killedAt ? 'danger' : ''" style="padding: 12px">
            <p class="small">
              <template v-if="selected.killedAt"
                >Switched off by the kill switch {{ new Date(selected.killedAt).toLocaleString() }}. Turn it back on
                above when it's safe.</template
              >
              <template v-else
                >Stops this agent at once: running work fails safely, queued work waits for a person. Testing it
                switches the agent off and back on, and records the date.</template
              >
            </p>
            <p class="small faint">
              Last tested:
              {{ selected.killTestedAt ? new Date(selected.killTestedAt).toLocaleDateString() : 'never' }}
              <template v-if="selected.rulesVersion">
                · Rules version <span class="mono">{{ selected.rulesVersion }}</span>, stamped on every run</template
              >
            </p>
            <div v-if="app.can('manage_agents')" class="row">
              <button class="btn sm" @click="kill(true)">Test the kill switch</button>
              <button v-if="selected.enabled" class="btn sm danger" @click="kill(false)">Stop this agent now</button>
            </div>
          </div>
        </div>

        <p v-if="overrides.length" class="small faint">
          Set here, not taken from {{ baseOf?.name }}:
          <template v-for="(o, i) in overrides" :key="o.label"
            >{{ i ? ' / ' : '' }}{{ o.label }} <button class="link-btn" @click="o.reset()">Reset</button></template
          >
          <template v-if="overrides.length > 1">
            / <button class="link-btn" @click="overrides.forEach((o) => o.reset())">Reset all</button></template
          >
        </p>

        <div class="row" style="flex-wrap: wrap">
          <template v-if="isNew">
            <button class="btn primary" :disabled="saving || draft.name.trim().length < 2" @click="createAgent"
              >Create agent</button
            >
            <button class="btn ghost" @click="selectedId = agents[0]?.id ?? ''">Discard</button>
          </template>
          <template v-else>
            <button class="btn primary" :disabled="!agentDirty || saving" @click="saveAgent">Save agent</button>
            <button v-if="agentDirty" class="btn ghost" @click="resetAgent">Discard</button>
            <span class="grow" />
            <button v-if="app.can('manage_agents') && app.mod('advanced_ai')" class="btn sm" @click="duplicateAgent"
              >Duplicate</button
            >
            <button v-if="app.can('manage_agents') && selected.custom" class="btn sm danger" @click="deleteAgent"
              >Delete agent</button
            >
          </template>
        </div>
      </div>
    </div>
  </section>

  <div v-if="agentDirty && !isNew" class="save-bar">
    <span>You have unsaved changes</span>
    <button class="btn ghost sm" @click="resetAgent()">Discard</button>
    <button class="btn primary sm" :disabled="saving" @click="saveAgent()">Save changes</button>
  </div>
</template>
