<script setup lang="ts">
// Agent testing: regression tests for the AI agents themselves. A golden set
// of use cases with known right answers, and the Verifier (an AI that checks
// drafts against their sources), itself measured against people's judgement.
// Each tab is its own component (v1.7.8); the page loads the shared data and
// refreshes it while a golden run reports each case.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { GoldenRun, Provider } from '@gh/shared';
import { api, socket } from '../../api';
import { useApp } from '../../stores/app';
import type { AgentTestingData } from './agent-testing-data';
import AgentGoldenTab from './AgentGoldenTab.vue';
import AgentVerifierTab from './AgentVerifierTab.vue';
import AgentRetrievalTab from './AgentRetrievalTab.vue';
import AgentHistoryTab from './AgentHistoryTab.vue';

const app = useApp();
const route = useRoute();
const tab = computed(() => String(route.params.tab || 'golden'));
const data = ref<AgentTestingData | null>(null);
const providers = ref<Provider[]>([]);
const loading = ref(true);
// Shared by Golden Dataset and History: History opens a run on the Golden Dataset tab.
const agent = ref<'risk_classifier' | 'control_designer'>('risk_classifier');
const shownRunId = ref<string | null>(null);
function openRun(r: GoldenRun) {
  agent.value = r.agent;
  shownRunId.value = r.id;
}

async function load() {
  try {
    [data.value, providers.value] = await Promise.all([
      api<AgentTestingData>('/agent-testing'),
      api<Provider[]>('/providers'),
    ]);
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
});
onBeforeUnmount(() => socket.off('golden', onGolden));
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Agent testing</h1>
        <p
          >Test the AI agents the way you'd regression-test software. The golden set is use cases with known right
          answers. The Verifier is an AI that checks each draft against the passages it cites, and it is itself measured
          against people's judgement before anyone relies on it.</p
        >
      </div>
    </div>
    <nav class="tabs">
      <RouterLink to="/agent-testing/golden" :class="{ active: tab === 'golden' }">Golden Dataset</RouterLink>
      <RouterLink to="/agent-testing/verifier" :class="{ active: tab === 'verifier' }">Verifier</RouterLink>
      <RouterLink to="/agent-testing/retrieval" :class="{ active: tab === 'retrieval' }">Retrieval</RouterLink>
      <RouterLink to="/agent-testing/history" :class="{ active: tab === 'history' }">History</RouterLink>
    </nav>
    <div v-if="loading || !data" class="muted">Loading…</div>

    <!-- Golden dataset -->
    <KeepAlive v-else>
      <AgentGoldenTab
        v-if="tab === 'golden'"
        v-model:agent="agent"
        v-model:shown-run-id="shownRunId"
        :data="data"
        :providers="providers"
        :reload="load"
      />
      <AgentRetrievalTab v-else-if="tab === 'retrieval'" />
      <AgentVerifierTab v-else-if="tab === 'verifier'" :data="data" :providers="providers" :reload="load" />
      <AgentHistoryTab v-else :data="data" :providers="providers" @open-run="openRun" />
    </KeepAlive>
  </div>
</template>
