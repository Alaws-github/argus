<script setup lang="ts">
// One agent run: model, cost, tokens and its step-by-step log.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { STAGE_LABELS, type Card, type Run, type RunEvent } from '@gh/shared';
import { api, duration, money, socket } from '../api';

const route = useRoute();
const run = ref<Run | null>(null);
const card = ref<Card | null>(null);
const events = ref<RunEvent[]>([]);
const error = ref('');

async function load() {
  try {
    const d = await api(`/runs/${route.params.id}`);
    run.value = d.run;
    card.value = d.card;
    events.value = d.events;
  } catch (e: any) {
    error.value = e.message;
  }
}
function onEvent(e: RunEvent) {
  if (e.runId === route.params.id) events.value.push(e);
}
function onRun(r: Run) {
  if (r.id === route.params.id) run.value = r;
}
onMounted(() => {
  void load();
  socket.on('run:event', onEvent);
  socket.on('run', onRun);
});
onBeforeUnmount(() => {
  socket.off('run:event', onEvent);
  socket.off('run', onRun);
});
watch(() => route.params.id, () => void load());

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

<template>
  <div class="page">
    <p class="small faint"><RouterLink to="/runs">Runs</RouterLink> / R-{{ run?.number }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="run">
      <div class="page-head">
        <div>
          <div class="row">
            <h1>R-{{ run.number }} · {{ run.agent }} on {{ run.cardKey }}</h1>
            <span class="pill" :class="{ succeeded: 'green', failed: 'coral', running: 'blue pulse' }[run.status]"><span class="dot" />{{ run.status }}</span>
          </div>
          <p class="small">
            <span class="mono">{{ run.cardKey }}</span> · {{ STAGE_LABELS[run.stage] }} · <span class="mono">{{ run.model }}</span> ({{ run.runtime }}) ·
            took {{ duration(run.startedAt, run.endedAt) || '…' }} · tokens {{ (run.tokensIn + run.tokensOut).toLocaleString() }} · cost {{ money(run.costUsd) }}
          </p>
        </div>
        <RouterLink class="btn" :to="{ path: '/', query: { card: run.cardKey } }">Open use case</RouterLink>
      </div>

      <div class="steps" role="log">
        <div v-for="e in events" :key="e.id" class="step" :class="e.kind">
          <span>{{ e.kind === 'error' ? '✕' : e.kind === 'output' ? '→' : '✓' }}</span>
          <span>{{ e.text }}</span>
          <span class="t">{{ time(e.at) }}</span>
        </div>
        <div v-if="!events.length" class="faint">No steps recorded yet.</div>
      </div>
      <p v-if="run.error" class="error" style="margin-top: 12px">{{ run.error }}</p>
      <p v-if="card?.classification && run.status === 'succeeded'" class="small muted" style="margin-top: 12px">
        The full output is on the use case. A person approves it there before anything enters the register.
      </p>
    </template>
  </div>
</template>
