<script setup lang="ts">
// Agent testing > Retrieval: how well the knowledge base finds the right passage for a fixed set of
// questions (recall and MRR, by keyword and by meaning). Part of AgentTestingPage.vue (split out in v1.7.8).
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import { useApp } from '../../stores/app';
import { pctOf } from './agent-testing-data';

const app = useApp();
// Retrieval (v1.6): how well the knowledge base finds the right passage.
interface RetrievalScore {
  mode: 'keyword' | 'hybrid';
  recall5: number;
  recall10: number;
  mrr: number;
  perKind: Record<string, { recall5: number; n: number }>;
  misses: { query: string; expect: string[]; got: string[] }[];
}
const retrieval = ref<{ cases: number; embedModel: string | null; scores: RetrievalScore[] } | null>(null);
const retrieving = ref(false);
async function runRetrieval() {
  retrieving.value = true;
  try {
    retrieval.value = await api('/agent-testing/retrieval');
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    retrieving.value = false;
  }
}
// Measured the first time the tab opens.
onMounted(() => runRetrieval());
</script>

<template>
  <div class="card" style="margin-bottom: 16px; gap: 8px">
    <div class="spread">
      <h2>Does the knowledge base find the right passage?</h2>
      <button class="btn sm" :disabled="retrieving" @click="runRetrieval">{{
        retrieving ? 'Checking…' : 'Check again'
      }}</button>
    </div>
    <p class="small muted"
      >{{ retrieval?.cases ?? 'A fixed set of' }} questions worded the way a person or an agent would ask them, each
      with the passages a good answer needs. Recall at 5 is how often a right passage is in the top five results; MRR is
      how high the first right one comes (1 is always first). It reads the shared passages only and changes nothing.
      {{
        retrieval?.embedModel
          ? `Meaning search uses ${retrieval.embedModel}; switch the embedding model on Knowledge Base to compare.`
          : 'Set an embedding model on Knowledge Base to see what meaning search adds.'
      }}</p
    >
  </div>
  <div v-if="!retrieval" class="muted">{{ retrieving ? 'Checking…' : 'Not checked yet.' }}</div>
  <template v-else>
    <div v-for="s in retrieval.scores" :key="s.mode" style="margin-bottom: 18px">
      <h3 style="margin-bottom: 8px">{{ s.mode === 'keyword' ? 'Keyword search' : 'Keyword and meaning search' }}</h3>
      <div class="metric-grid" style="margin-bottom: 10px">
        <div class="tile"
          ><span class="label-caps">Recall at 5</span><span class="big">{{ pctOf(s.recall5) }}</span
          ><span class="small faint">Right passage in the top 5</span></div
        >
        <div class="tile"
          ><span class="label-caps">Recall at 10</span><span class="big">{{ pctOf(s.recall10) }}</span
          ><span class="small faint">Right passage in the top 10</span></div
        >
        <div class="tile"
          ><span class="label-caps">MRR</span><span class="big">{{ s.mrr.toFixed(2) }}</span
          ><span class="small faint">1.00 means always first</span></div
        >
        <div v-for="(k, kind) in s.perKind" :key="kind" class="tile"
          ><span class="label-caps">{{
            ({ framework: 'Frameworks', control: 'Controls', methodology: 'Method' } as any)[kind] ?? kind
          }}</span
          ><span class="big">{{ pctOf(k.recall5) }}</span
          ><span class="small faint">Recall at 5 over {{ k.n }} questions</span></div
        >
      </div>
      <details v-if="s.misses.length" class="small"
        ><summary>{{ s.misses.length }} question{{ s.misses.length === 1 ? '' : 's' }} it missed</summary>
        <ul class="plain"
          ><li v-for="m in s.misses" :key="m.query" style="margin-top: 6px"
            >“{{ m.query }}”
            <span class="faint">wanted {{ m.expect.join(' or ') }}; found {{ m.got.join(', ') || 'nothing' }}</span></li
          ></ul
        >
      </details>
    </div>
  </template>
</template>
