<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { STAGES, STAGE_LABELS, TIER_LABELS, type RiskTier, type Run } from '@gh/shared';
import { useApp } from '../stores/app';
import { api, ago, money, socket } from '../api';

const app = useApp();
const o = ref<any>(null);
const runs = ref<Run[]>([]);

async function load() {
  if (!app.engagementId) await app.init();
  o.value = await api(`/engagements/${app.engagementId}/overview`);
  runs.value = (await api<Run[]>('/runs')).slice(0, 8);
}
onMounted(() => {
  void load();
  socket.on('card', load);
});
onBeforeUnmount(() => socket.off('card', load));

const tiers: RiskTier[] = ['prohibited', 'high', 'limited', 'minimal'];
const capPct = computed(() => (o.value?.month.capUsd ? Math.min(100, (o.value.month.spendUsd / Math.max(o.value.month.capUsd, 0.01)) * 100) : 0));
const maxStage = computed(() => Math.max(1, ...STAGES.map((s) => o.value?.byStage[s] ?? 0)));
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
        <div class="tile">
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
          <div v-for="s in STAGES" :key="s" class="spread small">
            <span style="min-width: 120px">{{ STAGE_LABELS[s] }}</span>
            <div class="meter grow"><i :style="{ width: `${(o.byStage[s] / maxStage) * 100}%`, background: 'var(--series-1)' }" /></div>
            <span class="num" style="min-width: 24px">{{ o.byStage[s] }}</span>
          </div>
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
                <td><span class="pill" :class="{ succeeded: 'green', failed: 'coral', running: 'blue pulse' }[r.status]"><span class="dot" />{{ r.status }}</span></td>
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
