<script setup lang="ts">
// Agent testing > Golden Dataset: use cases with known right answers, run against an agent and scored,
// with the Verifier's verdicts when asked. Part of AgentTestingPage.vue (split out in v1.7.8).
import { computed, onMounted, ref, watch } from 'vue';
import { AGENT_ROLES, RiskCategory, TIER_LABELS, type GoldenCase, type Provider } from '@gh/shared';
import { api, ago } from '../../api';
import { useApp } from '../../stores/app';
import { useProviderChoices, verifierNameOf, type AgentTestingData } from './agent-testing-data';

const props = defineProps<{ data: AgentTestingData; providers: Provider[]; reload: () => Promise<void> }>();
const app = useApp();
const { enabled, modelsFor } = useProviderChoices(() => props.providers);
const admin = computed(() => app.canRaw('manage_models'));
const RISK_CATEGORIES = RiskCategory.options;
const verifierName = computed(() => verifierNameOf(props.data, props.providers));

// ---- Golden dataset
/** The agent whose golden set is shown, and the run shown (shared with History, which can open a run). */
const agent = defineModel<'risk_classifier' | 'control_designer'>('agent', { required: true });
const cases = computed(() => (props.data.cases ?? []).filter((c) => c.agent === agent.value));
const runsFor = computed(() => (props.data.runs ?? []).filter((r) => r.agent === agent.value));
const shownRunId = defineModel<string | null>('shownRunId', { required: true });
const shown = computed(
  () => (props.data.runs ?? []).find((r) => r.id === shownRunId.value) ?? runsFor.value[0] ?? null,
);
watch(agent, () => {
  shownRunId.value = null;
  void pickAgentDefaults();
});
const runForm = ref({
  providerId: '',
  model: '',
  withVerifier: true,
  useEngagement: false,
  mode: 'agentic' as 'agentic' | 'single',
});
// Default to the model this engagement's agent uses, so the test matches real work.
async function pickAgentDefaults() {
  try {
    const agents = await api<any[]>(`/engagements/${await app.eid()}/agents`);
    const a = agents.find((x) => x.role === agent.value);
    if (a?.providerId) runForm.value = { ...runForm.value, providerId: a.providerId, model: a.model };
    else {
      const rules = props.providers.find((p) => p.type === 'rules');
      if (rules) runForm.value = { ...runForm.value, providerId: rules.id, model: rules.models[0] ?? '' };
    }
  } catch {
    /* the page still works without defaults */
  }
}
const running = computed(() => runsFor.value.some((r) => r.status === 'running'));
async function runGolden() {
  try {
    const { id } = await api<{ id: string }>('/agent-testing/runs', {
      method: 'POST',
      body: {
        agent: agent.value,
        providerId: runForm.value.providerId,
        model: runForm.value.model,
        withVerifier: runForm.value.withVerifier,
        engagementId: runForm.value.useEngagement ? app.engagementId : null,
        mode: runForm.value.mode,
      },
    });
    shownRunId.value = id;
    await props.reload();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const expectedLine = (c: GoldenCase) => {
  const e = c.expected;
  const parts: string[] = [];
  if (e.tier) parts.push(`${TIER_LABELS[e.tier]} tier`);
  if (e.oversight) parts.push(e.oversight.replace(/_/g, ' '));
  if (e.mustRisk.length) parts.push(`raises ${e.mustRisk.map((k) => k.replace('_', ' ')).join(', ')}`);
  if (e.mustNotRisk.length) parts.push(`no ${e.mustNotRisk.map((k) => k.replace('_', ' ')).join(', ')}`);
  if (e.mustControls.length) parts.push(`proposes ${e.mustControls.join(', ')}`);
  return parts.join(' · ');
};
const resultOf = (c: GoldenCase) => shown.value?.results.find((r) => r.caseId === c.id);

// Add a case
const adding = ref(false);
const blankCase = () => ({
  title: '',
  description: '',
  dataUsed: '',
  affectedPeople: '',
  autonomy: 'human_in_loop',
  vendor: '',
  businessOwner: '',
  tier: '',
  oversight: '',
  mustRisk: [] as string[],
  mustNotRisk: [] as string[],
  risks: '',
  mustControls: '',
  why: '',
});
const cform = ref(blankCase());
async function addCase() {
  const f = cform.value;
  try {
    const risks = f.risks
      .split('\n')
      .map((l) => l.split('|').map((x) => x.trim()))
      .filter((p) => p[0])
      .map(([title, category, l, i]) => ({
        title,
        category: category || 'operational',
        likelihood: Number(l) || 3,
        impact: Number(i) || 3,
      }));
    await api('/agent-testing/cases', {
      method: 'POST',
      body: {
        agent: agent.value,
        title: f.title,
        useCase: {
          description: f.description,
          dataUsed: f.dataUsed,
          affectedPeople: f.affectedPeople,
          autonomy: f.autonomy,
          vendor: f.vendor,
          businessOwner: f.businessOwner,
        },
        tier: agent.value === 'control_designer' ? f.tier || null : null,
        risks: agent.value === 'control_designer' ? risks : [],
        expected: {
          ...(agent.value === 'risk_classifier' && f.tier ? { tier: f.tier } : {}),
          ...(f.oversight ? { oversight: f.oversight } : {}),
          mustRisk: f.mustRisk,
          mustNotRisk: f.mustNotRisk,
          mustControls: f.mustControls
            .split(/[\s,]+/)
            .filter(Boolean)
            .map((x) => x.toUpperCase()),
          why: f.why,
        },
      },
    });
    adding.value = false;
    cform.value = blankCase();
    await props.reload();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function removeCase(c: GoldenCase) {
  if (!window.confirm(`Remove ${c.key} ${c.title} from the golden set?`)) return;
  await api(`/agent-testing/cases/${c.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message, 'error'));
  await props.reload();
}

onMounted(() => pickAgentDefaults());
</script>

<template>
  <div class="toolbar">
    <div class="filters">
      <button
        v-for="a in ['risk_classifier', 'control_designer'] as const"
        :key="a"
        class="filter"
        :class="{ active: agent === a }"
        @click="agent = a"
      >
        {{ AGENT_ROLES[a].name }}<span class="count">{{ data.cases.filter((c) => c.agent === a).length }}</span>
      </button>
    </div>
    <button v-if="admin" class="btn sm" @click="adding = true">Add a case</button>
  </div>

  <form v-if="admin" class="card" style="margin-bottom: 16px; gap: 10px" @submit.prevent="runGolden">
    <h2>Run the {{ AGENT_ROLES[agent].name }} over all {{ cases.length }} cases</h2>
    <p class="small muted"
      >Use the model you're thinking of switching to. Each case runs on its own, with no client material, and is scored
      against its expected answer.</p
    >
    <div class="row" style="flex-wrap: wrap">
      <select
        v-model="runForm.providerId"
        class="select"
        style="width: auto; max-width: 100%"
        aria-label="Provider"
        @change="runForm.model = modelsFor(runForm.providerId)[0] ?? ''"
      >
        <option v-for="p in enabled" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select v-model="runForm.model" class="select" style="width: auto; max-width: 100%" aria-label="Model"
        ><option v-for="m in modelsFor(runForm.providerId)" :key="m" :value="m">{{ m }}</option></select
      >
      <select
        v-model="runForm.mode"
        class="select"
        style="width: auto"
        aria-label="How the agent works"
        title="Run both on the same model to see whether looking things up is worth its cost"
      >
        <option value="agentic">Agentic (tools and self-check)</option>
        <option value="single">Single call</option>
      </select>
      <label class="row small" style="gap: 6px"
        ><input v-model="runForm.withVerifier" type="checkbox" /> Also ask the Verifier ({{ verifierName }})</label
      >
      <label
        class="row small"
        style="gap: 6px"
        title="Without this, every run is the same neutral benchmark. With it, the agent also gets this engagement's description and its instructions, as it does on real work."
        ><input v-model="runForm.useEngagement" type="checkbox" /> Run with
        {{ app.engagement?.client ?? 'this engagement' }}'s description and agent instructions</label
      >
      <button class="btn primary" :disabled="running || !runForm.model">{{
        running ? 'Running…' : 'Run the golden set'
      }}</button>
    </div>
  </form>

  <template v-if="shown">
    <div class="spread" style="margin-bottom: 8px">
      <h2
        >{{ shown.key }} · {{ shown.model }}
        <span class="small faint"
          >({{ shown.runtime === 'live' ? 'live model' : 'offline rules' }},
          {{ shown.mode === 'agentic' ? 'agentic' : 'single call' }}, rules {{ shown.rulesVersion }},
          {{ ago(shown.startedAt) }} by {{ shown.startedBy }})</span
        ></h2
      >
      <span class="badge" :class="shown.status === 'running' ? 'info' : shown.status === 'failed' ? 'danger' : 'ok'">{{
        shown.status === 'running' ? `Running ${shown.results.length} of ${cases.length}` : shown.status
      }}</span>
    </div>
    <div v-if="shown.summary && shown.status === 'done'" class="metric-grid" style="margin-bottom: 16px">
      <div class="tile"
        ><span class="label-caps">Cases passed</span
        ><span class="big">{{ shown.summary.passed }}/{{ shown.summary.cases }}</span
        ><span class="small faint">Every check right</span></div
      >
      <div class="tile"
        ><span class="label-caps">Checks passed</span
        ><span class="big">{{ shown.summary.checksPassed }}/{{ shown.summary.checks }}</span
        ><span class="small faint">Tier, risks, controls, citations</span></div
      >
      <div class="tile"
        ><span class="label-caps">Verifier</span
        ><span class="big">{{ shown.summary.supportedPct == null ? '–' : `${shown.summary.supportedPct}%` }}</span
        ><span class="small faint">Items supported by their sources</span></div
      >
      <div class="tile"
        ><span class="label-caps">Regressions</span
        ><span class="big" :style="{ color: shown.regressions.length ? 'var(--danger)' : 'var(--ok)' }">{{
          shown.regressions.length
        }}</span
        ><span class="small faint">{{
          shown.previous
            ? `Passed on ${shown.previous}, fail now${shown.regressions.length ? `: ${shown.regressions.join(', ')}` : ''}`
            : 'First run for this agent'
        }}</span></div
      >
    </div>
  </template>
  <p v-else class="small muted" style="margin-bottom: 12px">No runs yet for this agent.</p>

  <div class="table-wrap">
    <table>
      <thead
        ><tr
          ><th>Case</th><th>Expected</th><th>{{ shown ? `Result on ${shown.key}` : 'Result' }}</th
          ><th /></tr
      ></thead>
      <tbody>
        <tr
          v-for="c in cases"
          :key="c.id"
          class="case-row"
          :class="resultOf(c) ? (resultOf(c)!.pass ? 'pass' : 'fail') : ''"
        >
          <td style="min-width: 220px"
            ><span class="mono small faint">{{ c.key }}</span> {{ c.title
            }}<div class="small faint"
              >{{ c.useCase.description.slice(0, 120) }}{{ c.useCase.description.length > 120 ? '…' : '' }}</div
            ></td
          >
          <td class="small" style="min-width: 200px"
            >{{ expectedLine(c) }}<div v-if="c.expected.why" class="faint">{{ c.expected.why }}</div></td
          >
          <td class="small" style="min-width: 240px">
            <template v-if="resultOf(c)">
              <strong :style="{ color: resultOf(c)!.pass ? 'var(--ok)' : 'var(--danger)' }">{{
                resultOf(c)!.pass ? 'Pass' : 'Fail'
              }}</strong>
              <span v-if="resultOf(c)!.verdicts" class="faint">
                · Verifier {{ resultOf(c)!.verdicts!.supported }}/{{ resultOf(c)!.verdicts!.total }}</span
              >
              <div class="faint">{{ resultOf(c)!.error ?? resultOf(c)!.got }}</div>
              <div
                ><span
                  v-for="k in resultOf(c)!.checks"
                  :key="k.label"
                  class="check-mini"
                  :class="{ no: !k.pass }"
                  :title="k.detail"
                  >{{ k.pass ? '✓' : '✗' }} {{ k.label }}</span
                ></div
              >
            </template>
            <span v-else class="faint">Not run</span>
          </td>
          <td style="white-space: nowrap"
            ><span v-if="c.builtIn" class="small faint">Built in</span
            ><button v-else-if="admin" class="btn ghost sm" @click="removeCase(c)">Remove</button></td
          >
        </tr>
      </tbody>
    </table>
  </div>

  <template v-if="adding">
    <div class="backdrop" @click="adding = false" />
    <form class="modal" @submit.prevent="addCase">
      <div class="spread"
        ><h2>Add a {{ AGENT_ROLES[agent].name }} case</h2
        ><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div
      >
      <p class="small muted">Write a use case and the answer an experienced assessor would give. Keep it fictional.</p>
      <label class="field"
        ><span>Title</span><input v-model="cform.title" class="input" required minlength="3"
      /></label>
      <label class="field"
        ><span>What the AI does</span><textarea v-model="cform.description" class="textarea" required minlength="10" />
      </label>
      <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px">
        <label class="field"><span>Data used</span><input v-model="cform.dataUsed" class="input" /></label>
        <label class="field"><span>People affected</span><input v-model="cform.affectedPeople" class="input" /></label>
        <label class="field"><span>Vendor or model</span><input v-model="cform.vendor" class="input" /></label>
        <label class="field"
          ><span>Autonomy</span
          ><select v-model="cform.autonomy" class="select"
            ><option value="assistive">Assistive</option
            ><option value="human_in_loop">A person approves</option
            ><option value="autonomous">Acts on its own</option></select
          ></label
        >
      </div>
      <template v-if="agent === 'risk_classifier'">
        <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 8px">
          <label class="field"
            ><span>Expected tier</span
            ><select v-model="cform.tier" class="select"
              ><option value="">Any</option
              ><option v-for="(l, k) in TIER_LABELS" :key="k" :value="k">{{ l }}</option></select
            ></label
          >
          <label class="field"
            ><span>Expected oversight</span
            ><select v-model="cform.oversight" class="select"
              ><option value="">Any</option
              ><option value="human_in_command">Human in command</option
              ><option value="human_in_loop">Human in the loop</option
              ><option value="human_on_loop">Human on the loop</option></select
            ></label
          >
        </div>
        <fieldset class="field"
          ><span>Must raise a risk about</span
          ><div class="row" style="flex-wrap: wrap"
            ><label v-for="k in RISK_CATEGORIES" :key="k" class="small row" style="gap: 4px"
              ><input v-model="cform.mustRisk" type="checkbox" :value="k" />{{ k.replace('_', ' ') }}</label
            ></div
          ></fieldset
        >
        <fieldset class="field"
          ><span>Must not raise</span
          ><div class="row" style="flex-wrap: wrap"
            ><label v-for="k in RISK_CATEGORIES" :key="k" class="small row" style="gap: 4px"
              ><input v-model="cform.mustNotRisk" type="checkbox" :value="k" />{{ k.replace('_', ' ') }}</label
            ></div
          ></fieldset
        >
      </template>
      <template v-else>
        <label class="field"
          ><span>Tier</span
          ><select v-model="cform.tier" class="select"
            ><option v-for="(l, k) in TIER_LABELS" :key="k" :value="k">{{ l }}</option></select
          ></label
        >
        <label class="field"
          ><span>Approved risks, one per line: title | category | likelihood | impact</span
          ><textarea
            v-model="cform.risks"
            class="textarea"
            placeholder="Declines are biased | fairness | 4 | 5"
            required
          />
        </label>
        <label class="field"
          ><span>Library controls it must propose</span
          ><input v-model="cform.mustControls" class="input" placeholder="OVS-01, MOD-02" required
        /></label>
      </template>
      <label class="field"><span>Why that's the right answer</span><input v-model="cform.why" class="input" /></label>
      <div class="row"
        ><button class="btn primary">Add case</button
        ><button type="button" class="btn" @click="adding = false">Cancel</button></div
      >
    </form>
  </template>
</template>
