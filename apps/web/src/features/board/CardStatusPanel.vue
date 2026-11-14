<script setup lang="ts">
// What the use case is doing when no decision is waiting: a failed run, an agent working, a stage a person does by hand, or closed.
// Part of the use case side panel (CardDrawer.vue); state and actions come from useCardDrawer.
import { STAGE_LABELS } from '@gh/shared';
import { computed } from 'vue';
import type { CardDrawerState, CardWith } from './use-card-drawer';

const props = defineProps<{ drawer: CardDrawerState }>();
const { exit, note, busy, liveEvents, liveSteps, gated, mode, act, agentName, canApprove } = props.drawer;
// The drawer shows this panel only for a loaded card.
const card = computed(() => props.drawer.card.value as CardWith);
</script>

<template>
  <div v-if="mode === 'failed'" class="notice danger">
    <h3>The last run didn't finish</h3>
    <p class="small">{{ card.statusNote }}</p>
    <div class="row">
      <button class="btn primary" :disabled="busy" @click="act('retry')">Run again</button>
      <RouterLink v-if="card.latestRunId" class="btn" :to="`/runs/${card.latestRunId}`">Open the run</RouterLink>
    </div>
  </div>

  <div v-else-if="mode === 'working'" class="notice">
    <h3>{{ card.status === 'running' ? `The ${agentName} is working on this` : `Queued for the ${agentName}` }}</h3>
    <p v-if="card.statusNote" class="small">{{ card.statusNote }}</p>
    <template v-if="card.status === 'running'">
      <div class="ap-worked live">Working · {{ liveSteps }} step{{ liveSteps === 1 ? '' : 's' }}</div>
      <ol v-if="liveEvents.length" class="ap-steps">
        <li v-for="e in liveEvents.slice(-12)" :key="e.id" :class="e.kind === 'output' ? 'thought' : 'look'">{{
          e.text.length > 280 ? `${e.text.slice(0, 280)}…` : e.text
        }}</li>
      </ol>
    </template>
    <RouterLink v-if="card.latestRunId && card.status === 'running'" :to="`/runs/${card.latestRunId}`"
      >Watch the run</RouterLink
    >
  </div>

  <div v-else-if="mode === 'manual'" class="notice" :class="gated ? 'warn' : ''">
    <h3>{{ gated ? 'You sign off this stage' : 'No agent on this stage yet' }}</h3>
    <p class="small">
      The {{ STAGE_LABELS[card.stage] }} agent isn't built yet, so a person does this step.
      {{ gated ? 'Moving it on records you as the approver.' : 'Move it on when the work is done.' }}
    </p>
    <div v-if="exit.required.length" class="small">
      <strong>Before it can move on</strong>
      <ul class="check-list" style="margin-top: 4px">
        <li v-for="r in exit.required" :key="r" :class="{ no: exit.unmet.length > 0 }">{{ r }}</li>
      </ul>
      <p v-if="exit.unmet.length" class="error" style="margin-top: 4px">Not met yet: {{ exit.unmet.join('; ') }}</p>
    </div>
    <textarea v-model="note" class="textarea" placeholder="What was done (goes in the audit trail)" />
    <div class="row" style="flex-wrap: wrap">
      <button
        class="btn primary"
        :disabled="busy || exit.unmet.length > 0 || (gated && !canApprove)"
        @click="act('advance')"
        >{{ gated ? 'Sign off and move on' : 'Mark done' }}</button
      >
      <RouterLink v-if="card.stage === 'evidence' || card.stage === 'test'" class="btn" to="/testing/tests"
        >Open testing</RouterLink
      >
      <RouterLink v-if="card.stage === 'remediate'" class="btn" to="/issues">Open issues</RouterLink>
    </div>
    <p v-if="gated && !canApprove" class="small faint">A reviewer or lead signs this stage off.</p>
  </div>

  <div v-else-if="mode === 'closed'" class="notice" :class="card.tier ? '' : 'warn'">
    <h3>{{ card.tier ? 'Governed and reported' : 'Not taken forward' }}</h3>
    <p v-if="card.statusNote" class="small">{{ card.statusNote }}</p>
  </div>
</template>
