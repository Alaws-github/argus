<script setup lang="ts">
// Evaluations and red teaming: the suites that test AI systems themselves, with
// their last result against a pass threshold.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import KpiStrip from '../components/KpiStrip.vue';
import { useRouter } from 'vue-router';
import type { EvalSuite, InventoryItem, MonitorAlert, MonitorSchedule, Provider } from '@gh/shared';
import { api, ago, socket } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const router = useRouter();
const suites = ref<EvalSuite[]>([]);
const providers = ref<Provider[]>([]);
const inventory = ref<InventoryItem[]>([]);
const loading = ref(true);
const alerts = ref<MonitorAlert[]>([]);

async function load() {
  try {
    const E = await app.eid();
    [suites.value, providers.value, inventory.value, alerts.value] = await Promise.all([
      api(`/engagements/${E}/evals`),
      api('/providers'),
      api(`/engagements/${E}/inventory`),
      api(`/engagements/${E}/alerts`),
    ]);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
const onEval = (e: { finished?: boolean }) => e.finished && void load();
const onAlert = () => void load();
onMounted(() => {
  void load();
  socket.on('eval', onEval);
  socket.on('alert', onAlert);
});
onBeforeUnmount(() => {
  socket.off('eval', onEval);
  socket.off('alert', onAlert);
});

// Monitoring: schedules, the trend line and alerts.
async function setSchedule(s: EvalSuite, schedule: MonitorSchedule) {
  try {
    Object.assign(s, await api(`/evals/${s.id}/schedule`, { method: 'PATCH', body: { schedule } }));
    app.toast(schedule === 'off' ? `${s.name} is no longer scheduled` : `${s.name} runs ${schedule}, starting now`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const spark = (t: number[]) =>
  t.length < 2 ? '' : t.map((v, i) => `${(i / (t.length - 1)) * 100},${30 - (v / 100) * 28}`).join(' ');
const openAlerts = computed(() => alerts.value.filter((a) => a.status === 'open'));
const ackNote = ref<Record<string, string>>({});
async function ack(a: MonitorAlert) {
  try {
    await api(`/alerts/${a.id}/acknowledge`, { method: 'POST', body: { note: ackNote.value[a.id] ?? '' } });
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function toIssue(a: MonitorAlert) {
  try {
    const r = await api(`/alerts/${a.id}/issue`, { method: 'POST', body: {} });
    app.toast(`Raised ${r.issueKey}`);
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const ALERT_KIND: Record<string, string> = {
  below_threshold: 'Below threshold',
  drift: 'Drift',
  run_failed: 'Run failed',
};

const adding = ref(false);
const form = ref({
  name: '',
  kind: 'red_team' as 'red_team' | 'quality',
  template: 'red_team',
  inventoryId: '',
  providerId: '',
  model: '',
  systemPrompt: '',
  thresholdPct: 100,
  judgeProviderId: '',
  judgeModel: '',
});
const enabledProviders = computed(() => providers.value.filter((p) => p.enabled));
const modelsFor = (id: string) => providers.value.find((p) => p.id === id)?.models ?? [];
function startAdd() {
  const rules = providers.value.find((p) => p.type === 'rules');
  form.value = {
    name: '',
    kind: 'red_team',
    template: 'red_team',
    inventoryId: '',
    providerId: rules?.id ?? '',
    model: rules ? 'demo-chatbot-v1' : '',
    systemPrompt: '',
    thresholdPct: 100,
    judgeProviderId: '',
    judgeModel: '',
  };
  adding.value = true;
}
function kindChanged() {
  form.value.template = form.value.kind;
  form.value.thresholdPct = form.value.kind === 'red_team' ? 100 : 90;
}
async function add() {
  try {
    const s = await api<EvalSuite>(`/engagements/${await app.eid()}/evals`, {
      method: 'POST',
      body: {
        ...form.value,
        inventoryId: form.value.inventoryId || null,
        judgeProviderId: form.value.judgeProviderId || null,
        judgeModel: form.value.judgeModel || null,
      },
    });
    adding.value = false;
    router.push(`/evals/${s.id}`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function run(s: EvalSuite) {
  try {
    await api(`/evals/${s.id}/run`, { method: 'POST' });
    router.push(`/evals/${s.id}`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Evaluations and red teaming</h1>
        <p
          >Test the AI systems themselves. Quality suites check answers; red-team suites attack them using the OWASP Top
          10 for LLM applications. Every run is stored as hashed evidence against the controls it tests.</p
        >
      </div>
      <button v-if="app.can('prepare')" class="btn primary" @click="startAdd">New suite</button>
    </div>
    <KpiStrip page="evals" />
    <div v-if="openAlerts.length" class="card alert-card" style="margin-bottom: 16px; gap: 8px">
      <h2
        >Monitoring alerts <span class="count">{{ openAlerts.length }}</span></h2
      >
      <div v-for="a in openAlerts" :key="a.id" class="alert-row">
        <div class="grow"
          ><span class="mono faint small">{{ a.key }}</span>
          <span class="badge" :class="a.kind === 'drift' ? 'warn' : 'danger'">{{ ALERT_KIND[a.kind] }}</span>
          <span class="small">{{ a.message }}</span><div class="small faint"
            >{{ ago(a.createdAt) }} ago<template v-if="a.issueKey"> · tracked as {{ a.issueKey }}</template></div
          ></div
        >
        <div class="row" style="flex-wrap: wrap">
          <button v-if="!a.issueKey && app.can('prepare')" class="btn sm" @click="toIssue(a)">Raise an issue</button>
          <template v-if="app.can('approve')"
            ><input
              v-model="ackNote[a.id]"
              class="input"
              style="width: 220px"
              placeholder="What was done, or why it's acceptable"
            /><button class="btn sm" @click="ack(a)">Acknowledge</button></template
          >
        </div>
      </div>
    </div>
    <div v-if="loading" class="muted">Loading…</div>
    <div v-else-if="!suites.length" class="card empty"
      ><h2>No suites yet</h2><p>Start from the red-team or quality template, then add cases of your own.</p></div
    >
    <div v-else class="grid-2">
      <div v-for="s in suites" :key="s.id" class="card">
        <div class="spread">
          <div class="row"
            ><span class="mono faint">{{ s.key }}</span
            ><span class="pill" :class="s.kind === 'red_team' ? 'coral' : 'blue'">{{
              s.kind === 'red_team' ? 'Red team' : 'Quality'
            }}</span></div
          >
          <span
            v-if="s.lastRun"
            class="badge"
            :class="s.lastRun.status !== 'completed' ? 'info' : s.lastRun.passPct >= s.thresholdPct ? 'ok' : 'danger'"
          >
            {{ s.lastRun.status === 'running' ? 'Running' : `${s.lastRun.passed}/${s.lastRun.total} passed` }}
          </span>
          <span v-else class="badge">Not run</span>
        </div>
        <div>
          <RouterLink :to="`/evals/${s.id}`"
            ><h2>{{ s.name }}</h2></RouterLink
          >
          <p class="small muted" style="margin-top: 4px">
            {{ s.cases }} cases · target {{ s.model }} on {{ s.providerName
            }}<template v-if="s.inventoryName"> · tests {{ s.inventoryName }}</template>
          </p>
        </div>
        <div v-if="s.lastRun" class="stack" style="gap: 6px">
          <div class="meter"
            ><i
              :style="{
                width: `${s.lastRun.passPct}%`,
                background: s.lastRun.passPct >= s.thresholdPct ? 'var(--ok)' : 'var(--danger)',
              }"
          /></div>
          <span class="small faint"
            >{{ s.lastRun.passPct }}% against a {{ s.thresholdPct }}% threshold · {{ ago(s.lastRun.at) }} ago</span
          >
        </div>
        <div v-if="s.trend.length > 1" class="trend" :title="`Last ${s.trend.length} runs: ${s.trend.join('%, ')}%`">
          <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
            <line
              x1="0"
              x2="100"
              :y1="30 - (s.thresholdPct / 100) * 28"
              :y2="30 - (s.thresholdPct / 100) * 28"
              class="th"
            />
            <polyline :points="spark(s.trend)" />
          </svg>
          <span class="small faint">Last {{ s.trend.length }} runs</span>
        </div>
        <label class="row small" style="gap: 6px">
          <span class="faint">Monitoring</span>
          <select
            class="select"
            style="width: auto; padding: 3px 8px"
            :value="s.schedule"
            :disabled="!app.can('manage_engagement')"
            :aria-label="`How often ${s.name} runs by itself`"
            @change="setSchedule(s, ($event.target as HTMLSelectElement).value as MonitorSchedule)"
          >
            <option value="off">Off</option
            ><option value="daily">Daily</option
            ><option value="weekly">Weekly</option>
          </select>
          <span v-if="s.schedule !== 'off' && s.nextRunAt" class="faint"
            >next {{ new Date(s.nextRunAt).toLocaleString() }}</span
          >
        </label>
        <div class="row">
          <button
            v-if="app.can('prepare')"
            class="btn sm primary"
            :disabled="s.lastRun?.status === 'running'"
            @click="run(s)"
            >Run</button
          >
          <RouterLink class="btn sm" :to="`/evals/${s.id}`">Open</RouterLink>
        </div>
      </div>
    </div>

    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="add">
        <div class="spread"
          ><h2>New evaluation suite</h2
          ><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div
        >
        <div class="segmented">
          <button
            type="button"
            :class="{ on: form.kind === 'red_team' }"
            @click="
              form.kind = 'red_team';
              kindChanged();
            "
            >Red team</button
          >
          <button
            type="button"
            :class="{ on: form.kind === 'quality' }"
            @click="
              form.kind = 'quality';
              kindChanged();
            "
            >Quality</button
          >
        </div>
        <label class="field"
          ><span>Name</span
          ><input v-model="form.name" class="input" required minlength="2" placeholder="e.g. HR assistant red team"
        /></label>
        <label class="field"
          ><span>System under test</span>
          <select v-model="form.inventoryId" class="select"
            ><option value="">Not linked</option
            ><option v-for="i in inventory" :key="i.id" :value="i.id">{{ i.key }} {{ i.name }}</option></select
          >
          <span class="hint"
            >Linking it means failed cases raise issues against that system's use case, and runs are filed as evidence
            on its controls.</span
          >
        </label>
        <div class="split">
          <label class="field"
            ><span>Provider</span
            ><select v-model="form.providerId" class="select" required
              ><option v-for="p in enabledProviders" :key="p.id" :value="p.id">{{ p.name }}</option></select
            ></label
          >
          <label class="field"
            ><span>Model</span>
            <input v-model="form.model" class="input" list="suite-models" required />
            <datalist id="suite-models"
              ><option v-for="m in modelsFor(form.providerId)" :key="m" :value="m"
            /></datalist>
          </label>
        </div>
        <p class="hint"
          >The built-in rules provider includes demo-chatbot-v1, a deliberately imperfect bank chatbot, so you can try
          this offline.</p
        >
        <label class="field"
          ><span>System prompt the target runs with</span><textarea v-model="form.systemPrompt" class="textarea" />
        </label>
        <div class="split">
          <label class="field"
            ><span>Starting cases</span
            ><select v-model="form.template" class="select"
              ><option value="red_team">Red-team template (8)</option
              ><option value="quality">Quality template (5)</option
              ><option value="none">None</option></select
            ></label
          >
          <label class="field"
            ><span>Pass threshold %</span
            ><input v-model.number="form.thresholdPct" type="number" min="0" max="100" class="input"
          /></label>
        </div>
        <div class="split">
          <label class="field"
            ><span>Judge provider (optional)</span
            ><select v-model="form.judgeProviderId" class="select"
              ><option value="">None</option
              ><option v-for="p in enabledProviders.filter((x) => x.type !== 'rules')" :key="p.id" :value="p.id">{{
                p.name
              }}</option></select
            ></label
          >
          <label class="field"
            ><span>Judge model</span><input v-model="form.judgeModel" class="input" :disabled="!form.judgeProviderId"
          /></label>
        </div>
        <div class="row"
          ><button class="btn primary">Create suite</button
          ><button type="button" class="btn" @click="adding = false">Cancel</button></div
        >
      </form>
    </template>
  </div>
</template>
