<script setup lang="ts">
// Overview: the engagement at a glance (coverage, high risks, what needs you,
// spend, recent runs).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { PHASES, PHASE_LABELS, PHASE_OF, STAGES, STAGE_LABELS, TIER_LABELS, type Phase, type RiskTier, type Run } from '@gh/shared';
import { useApp } from '../stores/app';
import { api, ago, money, socket } from '../api';
import StackedBars from '../components/StackedBars.vue';

const app = useApp();
const o = ref<any>(null);
const runs = ref<Run[]>([]);

// Activity charts: a range, what to count, and how to split it.
const days = ref<7 | 30 | 90 | 365>(30);
const metric = ref<'runs' | 'cost'>('runs');
const by = ref<'stage' | 'agent' | 'model'>('stage');
const asTable = ref(false);
const act = ref<any>(null);
async function loadActivity() {
  act.value = await api(`/engagements/${app.engagementId}/activity?days=${days.value}`);
}
const shown = computed<Record<string, number[]>>(() => {
  const src = act.value?.[metric.value]?.[by.value] ?? {};
  if (by.value !== 'stage') return src;
  return Object.fromEntries(Object.entries(src).map(([k, v]) => [STAGE_LABELS[k as keyof typeof STAGE_LABELS] ?? k, v as number[]]));
});
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const fmtMetric = (n: number) => (metric.value === 'cost' ? money(n) : String(Math.round(n)));
const decided = computed(() => {
  const d = act.value?.decisions ?? { accepted: 0, edited: 0, rejected: 0 };
  return { ...d, total: d.accepted + d.edited + d.rejected };
});

async function load() {
  if (!app.engagementId) await app.init();
  o.value = await api(`/engagements/${app.engagementId}/overview`);
  runs.value = (await api<Run[]>('/runs')).slice(0, 8);
  await loadActivity();
}
onMounted(() => {
  void load();
  socket.on('card', load);
});
onBeforeUnmount(() => socket.off('card', load));

const tiers: RiskTier[] = ['prohibited', 'high', 'limited', 'minimal'];
const capPct = computed(() => (o.value?.month.capUsd ? Math.min(100, (o.value.month.spendUsd / Math.max(o.value.month.capUsd, 0.01)) * 100) : 0));
const byPhase = (p: Phase) => STAGES.filter((s) => PHASE_OF[s] === p).reduce((a, s) => a + (o.value?.byStage[s] ?? 0), 0);
const maxStage = computed(() => Math.max(1, ...PHASES.map(byPhase)));
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Overview</h1>
        <p>{{ app.engagement?.name }}: governance coverage, open risk and what the agents cost. Framework: {{ app.engagement?.framework }}.</p>
      </div>
    </div>

    <div v-if="o" class="stack">
      <div class="grid kpis">
        <div class="tile hero">
          <span class="label-caps">Classification coverage</span>
          <span class="big">{{ o.coveragePct }}%</span>
          <span class="small muted">{{ o.classified }} of {{ o.useCases }} use cases have an approved tier</span>
          <div class="meter"><i :style="{ width: `${o.coveragePct}%` }" /></div>
        </div>
        <div class="tile">
          <span class="label-caps">Open high risks</span>
          <span class="big" :style="{ color: o.risks.openHigh ? 'var(--danger)' : undefined }">{{ o.risks.openHigh }}</span>
          <span class="small muted">{{ o.risks.open }} open of {{ o.risks.total }} in the register. <RouterLink to="/risks">Register</RouterLink></span>
        </div>
        <div class="tile">
          <span class="label-caps">Needs you</span>
          <span class="big">{{ o.needsYou }}</span>
          <span class="small"><RouterLink v-for="c in app.needsYou.slice(0, 4)" :key="c.id" :to="{ path: '/', query: { card: c.key } }" style="display: block">{{ c.key }} {{ c.title }}</RouterLink></span>
        </div>
        <div class="tile">
          <span class="label-caps">This month</span>
          <span class="big">{{ money(o.month.spendUsd) }}</span>
          <span class="small muted">{{ o.month.capUsd == null ? 'No monthly cap. ' : `${Math.round(capPct)}% of the ${money(o.month.capUsd)} cap. ` }}<RouterLink to="/models">Models &amp; keys</RouterLink></span>
          <div class="meter"><i :style="{ width: `${capPct}%`, background: capPct >= 100 ? 'var(--danger)' : capPct >= o.month.warnAtPct ? 'var(--warn)' : undefined }" /></div>
        </div>
        <div class="tile">
          <span class="label-caps">Agent runs</span>
          <span class="big">{{ o.runs.total }}</span>
          <span class="small muted">{{ o.runs.succeededPct }}% of finished runs succeeded</span>
        </div>
        <div class="tile">
          <span class="label-caps">Mode</span>
          <span class="big" style="font-size: 20px">{{ app.health.runtime === 'live' ? 'Live' : 'Dry run' }}</span>
          <span class="small muted">{{ app.health.runtime === 'live' ? app.health.model : 'Agents use the offline rules. Pick a model in Settings > Agents.' }}</span>
        </div>
      </div>

      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))">
        <div class="card">
          <h2>Use cases by risk tier</h2>
          <div v-for="t in tiers" :key="t" class="spread small">
            <span class="tier" :class="t" style="min-width: 86px; text-align: center">{{ TIER_LABELS[t] }}</span>
            <div class="meter grow"><i :style="{ width: `${o.useCases ? (o.tiers[t] / o.useCases) * 100 : 0}%`, background: `var(--${t === 'minimal' ? 'ok' : t === 'limited' ? 'warn' : 'danger'})` }" /></div>
            <span class="num" style="min-width: 24px">{{ o.tiers[t] }}</span>
          </div>
          <p class="small faint">Untiered use cases are still in Intake or Classify.</p>
        </div>
        <div class="card">
          <h2>Flow of work</h2>
          <div v-for="s in PHASES" :key="s" class="spread small">
            <span style="min-width: 120px">{{ PHASE_LABELS[s] }}</span>
            <div class="meter grow"><i :style="{ width: `${(byPhase(s) / maxStage) * 100}%`, background: 'var(--series-1)' }" /></div>
            <span class="num" style="min-width: 24px">{{ byPhase(s) }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="spread" style="flex-wrap: wrap; gap: 10px">
          <h2>Agent activity</h2>
          <div class="row" style="flex-wrap: wrap; gap: 8px">
            <div class="segmented" role="radiogroup" aria-label="Period">
              <button v-for="d in ([7, 30, 90, 365] as const)" :key="d" role="radio" :aria-checked="days === d" :class="{ on: days === d }" @click="days = d; loadActivity()">{{ d === 365 ? '12 months' : `${d} days` }}</button>
            </div>
            <label class="select-pill"><span>Show</span><select v-model="metric" class="select sm"><option value="runs">Runs</option><option value="cost">Cost</option></select></label>
            <label class="select-pill"><span>By</span><select v-model="by" class="select sm"><option value="stage">Stage</option><option value="agent">Agent</option><option value="model">Model</option></select></label>
            <button class="btn sm ghost" @click="asTable = !asTable">{{ asTable ? 'View as chart' : 'View as table' }}</button>
          </div>
        </div>
        <template v-if="act">
          <p class="small muted">{{ fmtMetric(Object.values(shown).reduce((a, v) => a + sum(v), 0)) }} {{ metric === 'runs' ? 'agent runs' : 'billed AI cost from agent runs' }} in the last {{ days === 365 ? '12 months' : `${days} days` }}<template v-if="metric === 'cost'">. Offline rules cost nothing, so a dry-run engagement shows $0</template>.</p>
          <StackedBars v-if="!asTable" :days="act.days" :series="shown" :format="fmtMetric" />
          <div v-else class="table-wrap">
            <table>
              <thead><tr><th>{{ { stage: 'Stage', agent: 'Agent', model: 'Model' }[by] }}</th><th class="num">{{ metric === 'runs' ? 'Runs' : 'Cost' }}</th></tr></thead>
              <tbody>
                <tr v-for="(v, k) in shown" :key="k"><td>{{ k }}</td><td class="num">{{ fmtMetric(sum(v)) }}</td></tr>
                <tr v-if="!Object.keys(shown).length"><td colspan="2" class="faint">Nothing in this period</td></tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>

      <div v-if="act" class="grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))">
        <div class="card">
          <h2>Run outcomes</h2>
          <p class="small muted">{{ sum(act.outcomes.succeeded) }} succeeded, {{ sum(act.outcomes.failed) }} failed. A failed run hands the card to a person.</p>
          <StackedBars :days="act.days" :series="{ Succeeded: act.outcomes.succeeded, Failed: act.outcomes.failed }" />
        </div>
        <div class="card">
          <h2>How people decided the agents' drafts</h2>
          <p class="small muted">Every item an agent drafts gets a person's decision. Many edits or rejections are a sign to check the agent on the golden dataset.</p>
          <template v-if="decided.total">
            <div class="hbar" role="img" :aria-label="`${decided.accepted} accepted, ${decided.edited} edited, ${decided.rejected} rejected`">
              <span :style="{ width: `${(decided.accepted / decided.total) * 100}%`, background: 'var(--series-1)' }" />
              <span :style="{ width: `${(decided.edited / decided.total) * 100}%`, background: 'var(--series-2)' }" />
              <span :style="{ width: `${(decided.rejected / decided.total) * 100}%`, background: 'var(--series-3)' }" />
            </div>
            <div class="legend" style="margin-top: 8px">
              <span><i style="background: var(--series-1)" />Accepted {{ decided.accepted }}</span>
              <span><i style="background: var(--series-2)" />Edited {{ decided.edited }}</span>
              <span><i style="background: var(--series-3)" />Rejected {{ decided.rejected }}</span>
            </div>
          </template>
          <p v-else class="small faint">No draft items decided in this period.</p>
          <p class="small muted" style="margin-top: 12px">Use cases: {{ sum(act.flow.added) }} added, {{ sum(act.flow.closed) }} closed in this period.</p>
        </div>
      </div>

      <div class="card">
        <div class="spread"><h2>Last runs</h2><RouterLink to="/runs" class="small">All runs</RouterLink></div>
        <div v-if="!runs.length" class="muted small">No agent has run yet. Send a use case from Intake to classification.</div>
        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>Run</th><th>Use case</th><th>Agent</th><th>Status</th><th>Started</th><th class="num">Cost</th></tr></thead>
            <tbody>
              <tr v-for="r in runs" :key="r.id">
                <td><RouterLink :to="`/runs/${r.id}`" class="mono">R-{{ r.number }}</RouterLink></td>
                <td class="mono">{{ r.cardKey }}</td>
                <td>{{ r.agent }}</td>
                <td><span class="pill" :class="{ succeeded: 'green', failed: 'coral', running: 'blue pulse', waiting: 'amber' }[r.status]"><span class="dot" />{{ r.status }}</span></td>
                <td class="faint">{{ ago(r.startedAt) }}</td>
                <td class="num">{{ money(r.costUsd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <p v-else class="muted">Loading…</p>
  </div>
</template>
