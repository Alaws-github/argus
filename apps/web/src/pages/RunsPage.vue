<script setup lang="ts">
// Every agent run in the engagement.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import KpiStrip from '../components/KpiStrip.vue';
import { STAGE_LABELS, type Run } from '@gh/shared';
import { api, ago, duration, money, socket } from '../api';

const runs = ref<Run[]>([]);
const load = async () => (runs.value = await api('/runs'));
onMounted(() => {
  void load();
  socket.on('run', load);
});
onBeforeUnmount(() => socket.off('run', load));
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Runs</h1>
        <p>Every agent session: what it did, what it cost and how it ended. {{ runs.length }} shown, {{ money(runs.reduce((a, r) => a + r.costUsd, 0)) }} in all.</p>
      </div>
    </div>
    <KpiStrip page="runs" />
    <div v-if="!runs.length" class="card empty"><h2>No runs yet</h2><p>Runs appear when an agent picks up a use case.</p></div>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Run</th><th>Use case</th><th>Stage</th><th>Agent</th><th>Model</th><th>Status</th><th>Started</th><th>Took</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id">
            <td><RouterLink :to="`/runs/${r.id}`" class="mono">R-{{ r.number }}</RouterLink></td>
            <td><RouterLink :to="{ path: '/', query: { card: r.cardKey } }" class="mono">{{ r.cardKey }}</RouterLink></td>
            <td>{{ STAGE_LABELS[r.stage] }}</td>
            <td>{{ r.agent }}</td>
            <td class="mono">{{ r.model }}</td>
            <td><span class="pill" :class="{ succeeded: 'green', failed: 'coral', running: 'blue pulse', waiting: 'amber' }[r.status]"><span class="dot" />{{ r.status }}</span></td>
            <td class="faint">{{ ago(r.startedAt) }}</td>
            <td class="faint">{{ duration(r.startedAt, r.endedAt) }}</td>
            <td class="num mono">{{ (r.tokensIn + r.tokensOut).toLocaleString() }}</td>
            <td class="num">{{ money(r.costUsd) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
