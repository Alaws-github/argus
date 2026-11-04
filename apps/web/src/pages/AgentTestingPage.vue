<script setup lang="ts">
// Agent testing: regression tests for the AI agents themselves. A golden set
// of use cases with known right answers, and the Verifier (an AI that checks
// drafts against their sources), itself measured against people's judgement.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { AGENT_ROLES, RiskCategory, TIER_LABELS, VERDICT_LABELS, type Calibration, type GoldenCase, type GoldenRun, type JudgeLabel, type Provider } from '@gh/shared';
import { api, ago, socket } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const route = useRoute();
const tab = computed(() => String(route.params.tab || 'golden'));

interface Data {
  cases: GoldenCase[];
  runs: GoldenRun[];
  labels: JudgeLabel[];
  calibrations: Calibration[];
  verifier: { providerId: string | null; model: string; live: boolean; rulesVersion: string };
  trust: { kappa: number; falsePass: number; minLabels: number };
}
const data = ref<Data | null>(null);
const providers = ref<Provider[]>([]);
const loading = ref(true);
const admin = computed(() => app.canRaw('manage_models'));

async function load() {
  try {
    [data.value, providers.value] = await Promise.all([api<Data>('/agent-testing'), api<Provider[]>('/providers')]);
    vform.value = { providerId: data.value.verifier.providerId ?? '', model: data.value.verifier.model, live: data.value.verifier.live };
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
// Refresh while a golden run is going (the server announces each case).
let timer: any = null;
const onGolden = () => {
  clearTimeout(timer);
  timer = setTimeout(load, 300);
};
onMounted(async () => {
  await load();
  socket.on('golden', onGolden);
  await pickAgentDefaults();
});
onBeforeUnmount(() => socket.off('golden', onGolden));

const enabled = computed(() => providers.value.filter((p) => p.enabled));
const RISK_CATEGORIES = RiskCategory.options;
const modelsFor = (id: string) => providers.value.find((p) => p.id === id)?.models ?? [];
const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);

// ---- Golden dataset
const agent = ref<'risk_classifier' | 'control_designer'>('risk_classifier');
const cases = computed(() => (data.value?.cases ?? []).filter((c) => c.agent === agent.value));
const runsFor = computed(() => (data.value?.runs ?? []).filter((r) => r.agent === agent.value));
const shownRunId = ref<string | null>(null);
const shown = computed(() => (data.value?.runs ?? []).find((r) => r.id === shownRunId.value) ?? runsFor.value[0] ?? null);
watch(agent, () => {
  shownRunId.value = null;
  void pickAgentDefaults();
});
const runForm = ref({ providerId: '', model: '', withVerifier: true });
// Default to the model this engagement's agent uses, so the test matches real work.
async function pickAgentDefaults() {
  try {
    const agents = await api<any[]>(`/engagements/${await app.eid()}/agents`);
    const a = agents.find((x) => x.role === agent.value);
    if (a?.providerId) runForm.value = { ...runForm.value, providerId: a.providerId, model: a.model };
    else {
      const rules = providers.value.find((p) => p.type === 'rules');
      if (rules) runForm.value = { ...runForm.value, providerId: rules.id, model: rules.models[0] ?? '' };
    }
  } catch {
    /* the page still works without defaults */
  }
}
const running = computed(() => runsFor.value.some((r) => r.status === 'running'));
async function runGolden() {
  try {
    const { id } = await api<{ id: string }>('/agent-testing/runs', { method: 'POST', body: { agent: agent.value, ...runForm.value } });
    shownRunId.value = id;
    await load();
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
  title: '', description: '', dataUsed: '', affectedPeople: '', autonomy: 'human_in_loop', vendor: '', businessOwner: '',
  tier: '', oversight: '', mustRisk: [] as string[], mustNotRisk: [] as string[], risks: '', mustControls: '', why: '',
});
const cform = ref(blankCase());
async function addCase() {
  const f = cform.value;
  try {
    const risks = f.risks.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0]).map(([title, category, l, i]) => ({ title, category: category || 'operational', likelihood: Number(l) || 3, impact: Number(i) || 3 }));
    await api('/agent-testing/cases', {
      method: 'POST',
      body: {
        agent: agent.value, title: f.title,
        useCase: { description: f.description, dataUsed: f.dataUsed, affectedPeople: f.affectedPeople, autonomy: f.autonomy, vendor: f.vendor, businessOwner: f.businessOwner },
        tier: agent.value === 'control_designer' ? f.tier || null : null,
        risks: agent.value === 'control_designer' ? risks : [],
        expected: {
          ...(agent.value === 'risk_classifier' && f.tier ? { tier: f.tier } : {}),
          ...(f.oversight ? { oversight: f.oversight } : {}),
          mustRisk: f.mustRisk, mustNotRisk: f.mustNotRisk,
          mustControls: f.mustControls.split(/[\s,]+/).filter(Boolean).map((x) => x.toUpperCase()), why: f.why,
        },
      },
    });
    adding.value = false;
    cform.value = blankCase();
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function removeCase(c: GoldenCase) {
  if (!window.confirm(`Remove ${c.key} ${c.title} from the golden set?`)) return;
  await api(`/agent-testing/cases/${c.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message, 'error'));
  await load();
}

// ---- Verifier
const vform = ref({ providerId: '', model: '', live: false });
async function saveVerifier() {
  try {
    await api('/settings', { method: 'PUT', body: { verifierProviderId: vform.value.providerId || null, verifierModel: vform.value.providerId ? vform.value.model : '', verifierLive: vform.value.live } });
    app.toast('Verifier settings saved');
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const cal = computed(() => data.value?.calibrations[0] ?? null);
const measuring = ref(false);
async function measure() {
  measuring.value = true;
  try {
    await api('/agent-testing/calibrate', { method: 'POST', body: {} });
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    measuring.value = false;
  }
}
async function importLabels() {
  try {
    const r = await api<{ added: number }>('/agent-testing/labels/import', { method: 'POST', body: {} });
    app.toast(r.added ? `Added ${r.added} examples from reviewers' decisions` : 'No new decisions to add');
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const labelling = ref(false);
const lform = ref({ kind: 'risk', claim: '', sources: '', human: 'bad', note: '' });
async function addLabel() {
  try {
    await api('/agent-testing/labels', { method: 'POST', body: { ...lform.value, sources: lform.value.sources.split(/[\s,]+/).filter(Boolean).map((s) => (s.toUpperCase().startsWith('K-') ? s.toUpperCase() : `K-${s}`)) } });
    labelling.value = false;
    lform.value = { kind: 'risk', claim: '', sources: '', human: 'bad', note: '' };
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function removeLabel(l: JudgeLabel) {
  await api(`/agent-testing/labels/${l.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message, 'error'));
  await load();
}
const ORIGIN: Record<string, string> = { built_in: 'Built in', manual: 'Added by hand', decision: "From a reviewer's decision" };
const verifierName = computed(() => {
  const v = data.value?.verifier;
  if (!v?.providerId || !v.model) return 'the offline rules';
  return `${v.model} on ${providers.value.find((p) => p.id === v.providerId)?.name ?? 'a provider'}`;
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Agent testing</h1>
        <p>Test the AI agents the way you'd regression-test software. The golden set is use cases with known right answers. The Verifier is an AI that checks each draft against the passages it cites, and it is itself measured against people's judgement before anyone relies on it.</p>
      </div>
    </div>
    <nav class="tabs">
      <RouterLink to="/agent-testing/golden" :class="{ active: tab === 'golden' }">Golden Dataset</RouterLink>
      <RouterLink to="/agent-testing/verifier" :class="{ active: tab === 'verifier' }">Verifier</RouterLink>
      <RouterLink to="/agent-testing/history" :class="{ active: tab === 'history' }">History</RouterLink>
    </nav>
    <div v-if="loading || !data" class="muted">Loading…</div>

    <!-- Golden dataset -->
    <template v-else-if="tab === 'golden'">
      <div class="toolbar">
        <div class="filters">
          <button v-for="a in (['risk_classifier', 'control_designer'] as const)" :key="a" class="filter" :class="{ active: agent === a }" @click="agent = a">
            {{ AGENT_ROLES[a].name }}<span class="count">{{ data.cases.filter((c) => c.agent === a).length }}</span>
          </button>
        </div>
        <button v-if="admin" class="btn sm" @click="adding = true">Add a case</button>
      </div>

      <form v-if="admin" class="card" style="margin-bottom: 16px; gap: 10px" @submit.prevent="runGolden">
        <h2>Run the {{ AGENT_ROLES[agent].name }} over all {{ cases.length }} cases</h2>
        <p class="small muted">Use the model you're thinking of switching to. Each case runs on its own, with no client material, and is scored against its expected answer.</p>
        <div class="row" style="flex-wrap: wrap">
          <select v-model="runForm.providerId" class="select" style="width: auto; max-width: 100%" aria-label="Provider" @change="runForm.model = modelsFor(runForm.providerId)[0] ?? ''">
            <option v-for="p in enabled" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <select v-model="runForm.model" class="select" style="width: auto; max-width: 100%" aria-label="Model"><option v-for="m in modelsFor(runForm.providerId)" :key="m" :value="m">{{ m }}</option></select>
          <label class="row small" style="gap: 6px"><input v-model="runForm.withVerifier" type="checkbox" /> Also ask the Verifier ({{ verifierName }})</label>
          <button class="btn primary" :disabled="running || !runForm.model">{{ running ? 'Running…' : 'Run the golden set' }}</button>
        </div>
      </form>

      <template v-if="shown">
        <div class="spread" style="margin-bottom: 8px">
          <h2>{{ shown.key }} · {{ shown.model }} <span class="small faint">({{ shown.runtime === 'live' ? 'live model' : 'offline rules' }}, rules {{ shown.rulesVersion }}, {{ ago(shown.startedAt) }} by {{ shown.startedBy }})</span></h2>
          <span class="badge" :class="shown.status === 'running' ? 'info' : shown.status === 'failed' ? 'danger' : 'ok'">{{ shown.status === 'running' ? `Running ${shown.results.length} of ${cases.length}` : shown.status }}</span>
        </div>
        <div v-if="shown.summary && shown.status === 'done'" class="metric-grid" style="margin-bottom: 16px">
          <div class="tile"><span class="label-caps">Cases passed</span><span class="big">{{ shown.summary.passed }}/{{ shown.summary.cases }}</span><span class="small faint">Every check right</span></div>
          <div class="tile"><span class="label-caps">Checks passed</span><span class="big">{{ shown.summary.checksPassed }}/{{ shown.summary.checks }}</span><span class="small faint">Tier, risks, controls, citations</span></div>
          <div class="tile"><span class="label-caps">Verifier</span><span class="big">{{ shown.summary.supportedPct == null ? '–' : `${shown.summary.supportedPct}%` }}</span><span class="small faint">Items supported by their sources</span></div>
          <div class="tile"><span class="label-caps">Regressions</span><span class="big" :style="{ color: shown.regressions.length ? 'var(--danger)' : 'var(--ok)' }">{{ shown.regressions.length }}</span><span class="small faint">{{ shown.previous ? `Passed on ${shown.previous}, fail now${shown.regressions.length ? `: ${shown.regressions.join(', ')}` : ''}` : 'First run for this agent' }}</span></div>
        </div>
      </template>
      <p v-else class="small muted" style="margin-bottom: 12px">No runs yet for this agent.</p>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Case</th><th>Expected</th><th>{{ shown ? `Result on ${shown.key}` : 'Result' }}</th><th /></tr></thead>
          <tbody>
            <tr v-for="c in cases" :key="c.id" class="case-row" :class="resultOf(c) ? (resultOf(c)!.pass ? 'pass' : 'fail') : ''">
              <td style="min-width: 220px"><span class="mono small faint">{{ c.key }}</span> {{ c.title }}<div class="small faint">{{ c.useCase.description.slice(0, 120) }}{{ c.useCase.description.length > 120 ? '…' : '' }}</div></td>
              <td class="small" style="min-width: 200px">{{ expectedLine(c) }}<div v-if="c.expected.why" class="faint">{{ c.expected.why }}</div></td>
              <td class="small" style="min-width: 240px">
                <template v-if="resultOf(c)">
                  <strong :style="{ color: resultOf(c)!.pass ? 'var(--ok)' : 'var(--danger)' }">{{ resultOf(c)!.pass ? 'Pass' : 'Fail' }}</strong>
                  <span v-if="resultOf(c)!.verdicts" class="faint"> · Verifier {{ resultOf(c)!.verdicts!.supported }}/{{ resultOf(c)!.verdicts!.total }}</span>
                  <div class="faint">{{ resultOf(c)!.error ?? resultOf(c)!.got }}</div>
                  <div><span v-for="k in resultOf(c)!.checks" :key="k.label" class="check-mini" :class="{ no: !k.pass }" :title="k.detail">{{ k.pass ? '✓' : '✗' }} {{ k.label }}</span></div>
                </template>
                <span v-else class="faint">Not run</span>
              </td>
              <td style="white-space: nowrap"><span v-if="c.builtIn" class="small faint">Built in</span><button v-else-if="admin" class="btn ghost sm" @click="removeCase(c)">Remove</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Verifier -->
    <template v-else-if="tab === 'verifier'">
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 16px">
        <form class="card" style="gap: 10px" @submit.prevent="saveVerifier">
          <h2>How the Verifier checks</h2>
          <p class="small muted">It reads each tier, risk or control in a draft against the passages it cites, and says whether they back it up. A "supported" verdict must quote a cited passage word for word; the harness checks the quote, so the Verifier can't invent support. It never accepts, rejects or approves anything.</p>
          <label class="field"><span>Model</span>
            <select v-model="vform.providerId" class="select" :disabled="!admin" @change="vform.model = modelsFor(vform.providerId)[0] ?? ''">
              <option value="">Offline rules (word matching, free)</option>
              <option v-for="p in enabled.filter((x) => x.type !== 'rules')" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label v-if="vform.providerId" class="field"><span>Model name</span><select v-model="vform.model" class="select" :disabled="!admin"><option v-for="m in modelsFor(vform.providerId)" :key="m" :value="m">{{ m }}</option></select></label>
          <p class="small faint">Pick a different model, ideally from a different company, from the one that drafts. A model tends to approve its own work.</p>
          <button type="button" class="switch" :class="{ on: vform.live }" role="switch" :aria-checked="vform.live" :disabled="!admin" @click="vform.live = !vform.live">
            <span class="track" /><span>Check every new classification and control design automatically</span>
          </button>
          <p class="small faint">Off by default. When off, anyone preparing work can ask for a check from the use case panel. Billed checks count towards the monthly spend cap.</p>
          <button v-if="admin" class="btn primary" style="align-self: flex-start">Save</button>
        </form>

        <div class="card" style="gap: 10px">
          <div class="spread"><h2>Can you trust it?</h2><button v-if="admin" class="btn sm" :disabled="measuring" @click="measure">{{ measuring ? 'Measuring…' : 'Measure the Verifier' }}</button></div>
          <p class="small muted">It is measured on {{ data.labels.length }} claims people already judged good or bad. The bar: at least {{ data.trust.minLabels }} examples, agreement beyond chance (kappa) of {{ data.trust.kappa }} or more, and no more than {{ pct(data.trust.falsePass) }} of bad claims passed.</p>
          <template v-if="cal">
            <div class="row" style="gap: 8px; flex-wrap: wrap">
              <span class="badge" :class="cal.trusted ? 'ok' : 'danger'">{{ cal.trusted ? 'Trusted for advisory use' : 'Not trusted yet' }}</span>
              <span class="small faint">{{ cal.key }} · {{ cal.runtime === 'live' ? cal.model : 'offline rules' }} · {{ ago(cal.at) }}</span>
            </div>
            <div class="metric-grid">
              <div class="tile"><span class="label-caps">Agreement</span><span class="big">{{ pct(cal.agree) }}</span></div>
              <div class="tile"><span class="label-caps">Kappa</span><span class="big">{{ cal.kappa.toFixed(2) }}</span><span class="small faint">0 is chance, 1 is perfect</span></div>
              <div class="tile"><span class="label-caps">False passes</span><span class="big" :style="{ color: cal.falsePassRate > data.trust.falsePass ? 'var(--danger)' : 'var(--ok)' }">{{ pct(cal.falsePassRate) }}</span><span class="small faint">Bad claims it called supported</span></div>
            </div>
            <div style="overflow-x: auto"><table class="matrix" aria-label="Verifier against people">
              <thead><tr><th /><th>Person: good</th><th>Person: bad</th></tr></thead>
              <tbody>
                <tr><th>Verifier: supported</th><td class="hit">{{ cal.matrix.goodGood }}</td><td class="danger">{{ cal.matrix.goodBad }}</td></tr>
                <tr><th>Verifier: not supported</th><td>{{ cal.matrix.badGood }}</td><td class="hit">{{ cal.matrix.badBad }}</td></tr>
              </tbody>
            </table></div>
          </template>
          <p v-else class="small muted">Not measured yet.</p>
        </div>
      </div>

      <div v-if="cal?.disagreements.length" class="card" style="margin-bottom: 16px; gap: 8px">
        <h2>Where it disagreed with people</h2>
        <div v-for="d in cal.disagreements" :key="d.label" class="draft-item" :class="d.human === 'bad' ? 'reject' : ''" style="opacity: 1">
          <div class="small"><span class="mono faint">{{ d.label }}</span> {{ d.claim }}</div>
          <div class="small">Person: <strong>{{ d.human }}</strong> · Verifier: <strong>{{ VERDICT_LABELS[d.judge] }}</strong></div>
          <div class="small faint">{{ d.reason }}</div>
        </div>
      </div>

      <div class="toolbar">
        <h2>Labelled examples</h2>
        <div v-if="admin" class="row"><button class="btn sm" @click="importLabels">Add from reviewers' decisions</button><button class="btn sm" @click="labelling = true">Add an example</button></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Claim</th><th>Sources</th><th>Person</th><th>Where from</th><th /></tr></thead>
          <tbody>
            <tr v-for="l in data.labels" :key="l.id">
              <td style="min-width: 280px" class="small"><span class="mono faint">{{ l.key }}</span> {{ l.claim }}<div v-if="l.note" class="faint">{{ l.note }}</div></td>
              <td class="small">{{ l.passages.map((p) => p.title).join('; ') || 'None' }}</td>
              <td><span class="badge" :class="l.human === 'good' ? 'ok' : 'danger'">{{ l.human }}</span></td>
              <td class="small faint">{{ ORIGIN[l.origin] }}</td>
              <td><button v-if="admin && l.origin !== 'built_in'" class="btn ghost sm" @click="removeLabel(l)">Remove</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- History -->
    <template v-else>
      <h2 style="margin-bottom: 8px">Golden runs</h2>
      <div class="table-wrap" style="margin-bottom: 20px">
        <table>
          <thead><tr><th>Run</th><th>Agent</th><th>Model</th><th class="num">Passed</th><th>Regressions</th><th>By</th><th>When</th></tr></thead>
          <tbody>
            <tr v-for="r in data.runs" :key="r.id">
              <td class="mono"><RouterLink to="/agent-testing/golden" @click="agent = r.agent; shownRunId = r.id">{{ r.key }}</RouterLink></td>
              <td class="small">{{ AGENT_ROLES[r.agent].name }}</td>
              <td class="small">{{ r.model }}<span class="faint"> · rules {{ r.rulesVersion }}</span></td>
              <td class="num">{{ r.summary ? `${r.summary.passed}/${r.summary.cases}` : r.status }}</td>
              <td class="small" :style="{ color: r.regressions.length ? 'var(--danger)' : '' }">{{ r.regressions.join(', ') || 'None' }}</td>
              <td class="small">{{ r.startedBy }}</td>
              <td class="small faint">{{ ago(r.startedAt) }}</td>
            </tr>
            <tr v-if="!data.runs.length"><td colspan="7" class="muted">No runs yet.</td></tr>
          </tbody>
        </table>
      </div>
      <h2 style="margin-bottom: 8px">Verifier measurements</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Measurement</th><th>Verifier</th><th class="num">Examples</th><th class="num">Agreement</th><th class="num">Kappa</th><th class="num">False passes</th><th>Result</th><th>When</th></tr></thead>
          <tbody>
            <tr v-for="c in data.calibrations" :key="c.id">
              <td class="mono">{{ c.key }}</td><td class="small">{{ c.runtime === 'live' ? c.model : 'Offline rules' }}</td><td class="num">{{ c.labels }}</td>
              <td class="num">{{ pct(c.agree) }}</td><td class="num">{{ c.kappa.toFixed(2) }}</td><td class="num">{{ pct(c.falsePassRate) }}</td>
              <td><span class="badge" :class="c.trusted ? 'ok' : 'danger'">{{ c.trusted ? 'Trusted' : 'Not trusted' }}</span></td><td class="small faint">{{ ago(c.at) }}</td>
            </tr>
            <tr v-if="!data.calibrations.length"><td colspan="8" class="muted">Not measured yet.</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Add a golden case -->
    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="addCase">
        <div class="spread"><h2>Add a {{ AGENT_ROLES[agent].name }} case</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div>
        <p class="small muted">Write a use case and the answer an experienced assessor would give. Keep it fictional.</p>
        <label class="field"><span>Title</span><input v-model="cform.title" class="input" required minlength="3" /></label>
        <label class="field"><span>What the AI does</span><textarea v-model="cform.description" class="textarea" required minlength="10" /></label>
        <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px">
          <label class="field"><span>Data used</span><input v-model="cform.dataUsed" class="input" /></label>
          <label class="field"><span>People affected</span><input v-model="cform.affectedPeople" class="input" /></label>
          <label class="field"><span>Vendor or model</span><input v-model="cform.vendor" class="input" /></label>
          <label class="field"><span>Autonomy</span><select v-model="cform.autonomy" class="select"><option value="assistive">Assistive</option><option value="human_in_loop">A person approves</option><option value="autonomous">Acts on its own</option></select></label>
        </div>
        <template v-if="agent === 'risk_classifier'">
          <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 8px">
            <label class="field"><span>Expected tier</span><select v-model="cform.tier" class="select"><option value="">Any</option><option v-for="(l, k) in TIER_LABELS" :key="k" :value="k">{{ l }}</option></select></label>
            <label class="field"><span>Expected oversight</span><select v-model="cform.oversight" class="select"><option value="">Any</option><option value="human_in_command">Human in command</option><option value="human_in_loop">Human in the loop</option><option value="human_on_loop">Human on the loop</option></select></label>
          </div>
          <fieldset class="field"><span>Must raise a risk about</span><div class="row" style="flex-wrap: wrap"><label v-for="k in RISK_CATEGORIES" :key="k" class="small row" style="gap: 4px"><input v-model="cform.mustRisk" type="checkbox" :value="k" />{{ k.replace('_', ' ') }}</label></div></fieldset>
          <fieldset class="field"><span>Must not raise</span><div class="row" style="flex-wrap: wrap"><label v-for="k in RISK_CATEGORIES" :key="k" class="small row" style="gap: 4px"><input v-model="cform.mustNotRisk" type="checkbox" :value="k" />{{ k.replace('_', ' ') }}</label></div></fieldset>
        </template>
        <template v-else>
          <label class="field"><span>Tier</span><select v-model="cform.tier" class="select"><option v-for="(l, k) in TIER_LABELS" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field"><span>Approved risks, one per line: title | category | likelihood | impact</span><textarea v-model="cform.risks" class="textarea" placeholder="Declines are biased | fairness | 4 | 5" required /></label>
          <label class="field"><span>Library controls it must propose</span><input v-model="cform.mustControls" class="input" placeholder="OVS-01, MOD-02" required /></label>
        </template>
        <label class="field"><span>Why that's the right answer</span><input v-model="cform.why" class="input" /></label>
        <div class="row"><button class="btn primary">Add case</button><button type="button" class="btn" @click="adding = false">Cancel</button></div>
      </form>
    </template>

    <!-- Add a labelled example -->
    <template v-if="labelling">
      <div class="backdrop" @click="labelling = false" />
      <form class="modal" @submit.prevent="addLabel">
        <div class="spread"><h2>Add a labelled example</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="labelling = false">✕</button></div>
        <p class="small muted">A claim an agent might make, the passages it cites (find their K-numbers on the Knowledge base page), and your judgement.</p>
        <label class="field"><span>Kind</span><select v-model="lform.kind" class="select"><option value="risk">Risk</option><option value="control">Control</option><option value="tier">Tier</option></select></label>
        <label class="field"><span>Claim</span><textarea v-model="lform.claim" class="textarea" required minlength="5" /></label>
        <label class="field"><span>Cited passages</span><input v-model="lform.sources" class="input" placeholder="K-12, K-40" /></label>
        <label class="field"><span>Do the passages back the claim?</span><select v-model="lform.human" class="select"><option value="good">Yes: good</option><option value="bad">No: bad</option></select></label>
        <label class="field"><span>Why</span><input v-model="lform.note" class="input" /></label>
        <div class="row"><button class="btn primary">Add example</button><button type="button" class="btn" @click="labelling = false">Cancel</button></div>
      </form>
    </template>
  </div>
</template>
