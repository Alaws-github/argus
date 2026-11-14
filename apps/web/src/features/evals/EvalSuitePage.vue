<script setup lang="ts">
// One evaluation suite: its cases, its runs, each answer and whether it passed,
// and raising issues from the failures.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { CHECK_LABELS, CHECKS, SEVERITIES, type EvalCase, type EvalResult, type EvalSuite } from '@gh/shared';
import { api, money, socket, when } from '../../api';
import { useApp } from '../../stores/app';

const app = useApp();
const route = useRoute();
const suite = ref<EvalSuite | null>(null);
const cases = ref<EvalCase[]>([]);
const runs = ref<any[]>([]);
const run = ref<any | null>(null);
const err = ref('');

async function load() {
  try {
    const d = await api(`/evals/${route.params.id}`);
    suite.value = d.suite;
    cases.value = d.cases;
    runs.value = d.runs;
    const id = run.value?.id ?? d.runs[0]?.id;
    if (id) run.value = await api(`/eval-runs/${id}`);
  } catch (e: any) {
    err.value = e.message;
  }
}
const onEval = async (e: { runId: string; finished?: boolean }) => {
  if (!runs.value.some((r) => r.id === e.runId) && run.value?.id !== e.runId) return;
  if (e.finished) return load();
  run.value = await api(`/eval-runs/${e.runId}`);
};
onMounted(() => {
  void load();
  socket.on('eval', onEval);
});
onBeforeUnmount(() => socket.off('eval', onEval));

async function start() {
  try {
    const r = await api(`/evals/${suite.value!.id}/run`, { method: 'POST' });
    run.value = { id: r.runId, status: 'running', results: [], passed: 0, total: cases.value.length };
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function pick(id: string) {
  run.value = await api(`/eval-runs/${id}`);
}
async function raise() {
  try {
    const r = await api(`/eval-runs/${run.value.id}/issues`, { method: 'POST' });
    app.toast(
      r.created
        ? `${r.created} issue${r.created === 1 ? '' : 's'} raised. See Issues.`
        : 'Every failed case already has an issue',
    );
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const failed = computed<EvalResult[]>(() => (run.value?.results ?? []).filter((r: EvalResult) => !r.passed));
const byCategory = computed(() => {
  const m = new Map<string, { passed: number; total: number }>();
  for (const r of (run.value?.results ?? []) as EvalResult[]) {
    const e = m.get(r.category) ?? { passed: 0, total: 0 };
    e.total++;
    if (r.passed) e.passed++;
    m.set(r.category, e);
  }
  return [...m.entries()];
});

const adding = ref(false);
const form = ref({
  name: '',
  category: 'injection',
  ref: '',
  input: '',
  check: 'refuses',
  expected: '',
  severity: 'high',
});
async function addCase() {
  try {
    await api(`/evals/${suite.value!.id}/cases`, { method: 'POST', body: form.value });
    adding.value = false;
    form.value = {
      name: '',
      category: form.value.category,
      ref: '',
      input: '',
      check: 'refuses',
      expected: '',
      severity: 'high',
    };
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function remove(c: EvalCase) {
  if (!window.confirm(`Remove the case "${c.name}"? Past runs keep their results.`)) return;
  await api(`/eval-cases/${c.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message, 'error'));
  await load();
}
</script>

<template>
  <div class="page">
    <p v-if="err" class="error">{{ err }}</p>
    <template v-if="suite">
      <div class="page-head">
        <div>
          <div class="row small"
            ><RouterLink to="/evals">Evaluations</RouterLink><span class="faint">/ {{ suite.key }}</span></div
          >
          <h1 style="margin-top: 4px">{{ suite.name }}</h1>
          <p
            >Target {{ suite.model }} on {{ suite.providerName
            }}<template v-if="suite.inventoryName"> · tests {{ suite.inventoryName }}</template> · pass threshold
            {{ suite.thresholdPct }}%</p
          >
        </div>
        <button
          v-if="app.can('prepare')"
          class="btn primary"
          :disabled="run?.status === 'running' || !cases.length"
          @click="start"
          >{{ run?.status === 'running' ? 'Running…' : 'Run suite' }}</button
        >
      </div>

      <div v-if="run" class="card" style="margin-bottom: 16px">
        <div class="spread">
          <div>
            <h2>
              {{
                run.status === 'running'
                  ? `Running: ${run.results.length} of ${run.total}`
                  : run.status === 'failed'
                    ? 'Run failed'
                    : `${run.passed} of ${run.total} passed (${run.passPct}%)`
              }}
            </h2>
            <p class="small muted"
              >Run by {{ run.runBy }} · {{ when(run.startedAt)
              }}<template v-if="run.costUsd"> · {{ money(run.costUsd) }}</template></p
            >
          </div>
          <span v-if="run.status === 'completed'" class="badge" :class="run.meetsThreshold ? 'ok' : 'danger'">{{
            run.meetsThreshold ? 'Meets threshold' : 'Below threshold'
          }}</span>
        </div>
        <p v-if="run.error" class="error">{{ run.error }}</p>
        <div v-if="byCategory.length" class="row" style="flex-wrap: wrap">
          <span v-for="[cat, x] in byCategory" :key="cat" class="badge" :class="x.passed === x.total ? 'ok' : 'danger'"
            >{{ cat }} {{ x.passed }}/{{ x.total }}</span
          >
        </div>
        <div v-if="run.status === 'completed' && failed.length && app.can('prepare')" class="row">
          <button class="btn" @click="raise"
            >Raise {{ failed.length }} issue{{ failed.length === 1 ? '' : 's' }} from failed cases</button
          >
          <span class="small faint">The run is already filed as hashed evidence in the vault.</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead
              ><tr><th>Case</th><th>Result</th><th>Answer</th></tr></thead
            >
            <tbody>
              <tr v-for="r in run.results as EvalResult[]" :key="r.caseId">
                <td style="min-width: 200px">
                  {{ r.caseName }}
                  <div class="small faint"
                    >{{ r.category }}<template v-if="r.ref"> · {{ r.ref }}</template></div
                  >
                  <span class="sev" :class="r.severity">{{ r.severity }}</span>
                </td>
                <td style="min-width: 160px"
                  ><span class="pill" :class="r.passed ? 'green' : 'coral'"
                    ><span class="dot" />{{ r.passed ? 'Passed' : 'Failed' }}</span
                  ><div class="small faint" style="margin-top: 4px">{{ r.reason }}</div></td
                >
                <td style="min-width: 280px"
                  ><div class="small faint">{{ r.input }}</div
                  ><div class="out" style="margin-top: 4px">{{ r.output || '(no answer)' }}</div></td
                >
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="split" style="align-items: start">
        <section class="section">
          <div class="spread"
            ><span class="label-caps">Cases ({{ cases.length }})</span
            ><button v-if="app.can('prepare')" class="btn sm" @click="adding = true">Add case</button></div
          >
          <div class="table-wrap">
            <table>
              <thead
                ><tr><th>Case</th><th>Check</th><th /></tr
              ></thead>
              <tbody>
                <tr v-for="c in cases" :key="c.id">
                  <td
                    >{{ c.name
                    }}<div class="small faint"
                      >{{ c.category }}<template v-if="c.ref"> · {{ c.ref }}</template> · {{ c.severity }}</div
                    ></td
                  >
                  <td class="small"
                    >{{ CHECK_LABELS[c.check]
                    }}<span v-if="c.expected" class="mono" style="margin-left: 4px">{{ c.expected }}</span></td
                  >
                  <td
                    ><button
                      v-if="app.can('prepare')"
                      class="btn ghost sm"
                      :aria-label="`Remove ${c.name}`"
                      @click="remove(c)"
                      >✕</button
                    ></td
                  >
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section class="section">
          <span class="label-caps">Runs</span>
          <div v-if="!runs.length" class="small muted">Not run yet.</div>
          <button
            v-for="r in runs"
            :key="r.id"
            class="agent-item"
            :class="{ selected: run?.id === r.id }"
            @click="pick(r.id)"
          >
            <span class="grow" style="text-align: left"
              >{{ when(r.startedAt) }}<div class="small faint">{{ r.runBy }} · {{ r.model }}</div></span
            >
            <span class="badge" :class="r.status === 'running' ? 'info' : r.status === 'failed' ? 'danger' : ''">{{
              r.status === 'completed' ? `${r.passed}/${r.total}` : r.status
            }}</span>
          </button>
          <details v-if="suite.systemPrompt" class="small"
            ><summary class="faint" style="cursor: pointer">System prompt</summary
            ><div class="out">{{ suite.systemPrompt }}</div></details
          >
        </section>
      </div>
    </template>

    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="addCase">
        <div class="spread"
          ><h2>Add a case</h2
          ><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div
        >
        <label class="field"><span>Name</span><input v-model="form.name" class="input" required minlength="2" /></label>
        <label class="field"
          ><span>Input sent to the target</span><textarea v-model="form.input" class="textarea" required />
        </label>
        <div class="split">
          <label class="field"
            ><span>Check</span
            ><select v-model="form.check" class="select"
              ><option v-for="c in CHECKS" :key="c" :value="c">{{ CHECK_LABELS[c] }}</option></select
            ></label
          >
          <label class="field"
            ><span>{{
              form.check === 'judge'
                ? 'Criterion for the judge'
                : form.check === 'max_length'
                  ? 'Characters'
                  : 'Expected'
            }}</span
            ><input v-model="form.expected" class="input" :disabled="form.check === 'refuses'"
          /></label>
        </div>
        <div class="split">
          <label class="field"><span>Category</span><input v-model="form.category" class="input" /></label>
          <label class="field"
            ><span>Reference</span><input v-model="form.ref" class="input" placeholder="e.g. LLM01"
          /></label>
        </div>
        <label class="field"
          ><span>Severity if it fails</span
          ><select v-model="form.severity" class="select"
            ><option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option></select
          ></label
        >
        <div class="row"
          ><button class="btn primary">Add case</button
          ><button type="button" class="btn" @click="adding = false">Cancel</button></div
        >
      </form>
    </template>
  </div>
</template>
