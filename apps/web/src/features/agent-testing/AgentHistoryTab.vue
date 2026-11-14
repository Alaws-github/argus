<script setup lang="ts">
// Agent testing > History: past golden runs and Verifier measurements. A run's key opens it on the
// Golden Dataset tab. Part of AgentTestingPage.vue (split out in v1.7.8).
import { AGENT_ROLES } from '@gh/shared';
import { ago } from '../../api';
import { pct } from './agent-testing-data';
import type { GoldenRun, Provider } from '@gh/shared';
import type { AgentTestingData } from './agent-testing-data';

defineProps<{ data: AgentTestingData; providers: Provider[] }>();
const emit = defineEmits<{ openRun: [run: GoldenRun] }>();
</script>

<template>
  <h2 style="margin-bottom: 8px">Golden runs</h2>
  <div class="table-wrap" style="margin-bottom: 20px">
    <table>
      <thead
        ><tr
          ><th>Run</th><th>Agent</th><th>Model</th><th class="num">Passed</th><th>Regressions</th><th>By</th
          ><th>When</th></tr
        ></thead
      >
      <tbody>
        <tr v-for="r in data.runs" :key="r.id">
          <td class="mono"
            ><RouterLink to="/agent-testing/golden" @click="emit('openRun', r)">{{ r.key }}</RouterLink></td
          >
          <td class="small">{{ AGENT_ROLES[r.agent].name }}</td>
          <td class="small"
            >{{ r.model
            }}<span class="faint">
              · {{ r.mode === 'agentic' ? 'agentic' : 'single call' }} · rules {{ r.rulesVersion }}</span
            ></td
          >
          <td class="num">{{ r.summary ? `${r.summary.passed}/${r.summary.cases}` : r.status }}</td>
          <td class="small" :style="{ color: r.regressions.length ? 'var(--danger)' : '' }">{{
            r.regressions.join(', ') || 'None'
          }}</td>
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
      <thead
        ><tr
          ><th>Measurement</th><th>Verifier</th><th class="num">Examples</th><th class="num">Agreement</th
          ><th class="num">Kappa</th><th class="num">False passes</th><th>Result</th><th>When</th></tr
        ></thead
      >
      <tbody>
        <tr v-for="c in data.calibrations" :key="c.id">
          <td class="mono">{{ c.key }}</td><td class="small">{{ c.runtime === 'live' ? c.model : 'Offline rules' }}</td
          ><td class="num">{{ c.labels }}</td> <td class="num">{{ pct(c.agree) }}</td><td class="num">{{
            c.kappa.toFixed(2)
          }}</td
          ><td class="num">{{ pct(c.falsePassRate) }}</td>
          <td
            ><span class="badge" :class="c.trusted ? 'ok' : 'danger'">{{
              c.trusted ? 'Trusted' : 'Not trusted'
            }}</span></td
          ><td class="small faint">{{ ago(c.at) }}</td>
        </tr>
        <tr v-if="!data.calibrations.length"><td colspan="8" class="muted">Not measured yet.</td></tr>
      </tbody>
    </table>
  </div>
</template>
