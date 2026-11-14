<script setup lang="ts">
// Settings > Approval gates: for each stage, which agent drafts and whether a named person acts
// before the use case moves on. Part of SettingsPage.vue (split out in v1.7.8).
import { ROUTE_LABELS, STAGES, STAGE_LABELS, type AgentConfig, type Stage } from '@gh/shared';
import { useApp } from '../../stores/app';
import { api } from '../../api';

const props = defineProps<{ agents: AgentConfig[] }>();
const app = useApp();

// ----------------------------------------------------------------- Workflow
const youDo: Partial<Record<Stage, string>> = {
  intake: 'Take each new use case forward, or close it with a note',
  classify: 'Approve the tier, oversight model and starting risks, or send it back',
  design: 'Approve the controls for each risk',
  evidence: 'Check the evidence pack is complete',
  test: 'Review failed tests',
  remediate: 'Confirm the fix with the control owner',
  validate: 'Second-line sign-off before the report',
  report: 'Approve the board summary',
};
const agentFor = (s: Stage) => props.agents.find((a) => a.stage === s);
async function toggleGate(s: Stage) {
  if (s === 'intake' || s === 'closed') return;
  try {
    await api(`/engagements/${app.engagementId}`, {
      method: 'PATCH',
      body: { gates: { [s]: !app.engagement?.gates[s] } },
    });
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
</script>

<template>
  <section class="card">
    <div class="spread"
      ><h2>Approval gates</h2><RouterLink to="/settings/agents" class="small">Edit the AI Agents</RouterLink></div
    >
    <p class="small muted"
      >A gate means a named person acts before the use case leaves the stage. The agent drafts; it never approves.</p
    >
    <div class="table-wrap workflow-table">
      <table>
        <thead
          ><tr><th>Stage</th><th>AI Agent</th><th>Status</th><th>A Person Decides</th><th>What You Do</th></tr></thead
        >
        <tbody>
          <template v-for="s in STAGES.filter((x) => x !== 'closed')" :key="s">
            <tr
              v-for="(a, i) in agentFor(s) ? agents.filter((x) => x.stage === s) : [null]"
              :key="a?.id ?? s"
              :class="{ 'wf-cont': i > 0 }"
            >
              <td data-label="Stage"
                ><strong v-if="i === 0">{{ STAGE_LABELS[s] }}</strong></td
              >
              <td data-label="AI Agent">
                <template v-if="a"
                  >{{ a.name
                  }}<span v-if="a.route !== 'all'" class="small faint" style="display: block">{{
                    ROUTE_LABELS[a.route]
                  }}</span></template
                >
                <span v-else class="faint">A person</span>
              </td>
              <td data-label="Status"
                ><span v-if="a" class="badge" :class="a.enabled ? 'ok' : ''">{{
                  a.enabled ? 'On' : a.built ? 'Off' : 'Not Built Yet'
                }}</span
                ><span v-else class="faint">—</span></td
              >
              <td data-label="A Person Decides">
                <template v-if="i === 0">
                  <span v-if="s === 'intake'" class="badge warn">Always</span>
                  <button
                    v-else
                    class="switch"
                    :class="{ on: app.engagement?.gates[s] }"
                    role="switch"
                    :aria-checked="!!app.engagement?.gates[s]"
                    @click="toggleGate(s)"
                  >
                    <span class="track" />{{ app.engagement?.gates[s] ? 'You Act' : 'Automatic' }}
                  </button>
                </template>
              </td>
              <td data-label="What You Do" class="small muted"
                ><template v-if="i === 0">{{
                  app.engagement?.gates[s] || s === 'intake' ? youDo[s] : '—'
                }}</template></td
              >
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>
