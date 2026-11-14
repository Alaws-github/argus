<script setup lang="ts">
// Assess risk: the Risk Classifier's tier, oversight and starting risks, decided item by item.
// Part of the use case side panel (CardDrawer.vue); state and actions come from useCardDrawer.
import { TIER_LABELS, OVERSIGHT_LABELS } from '@gh/shared';
import DraftItem from './DraftItem.vue';
import VerifierBar from './VerifierBar.vue';
import { computed } from 'vue';
import type { CardDrawerState, CardWith } from './use-card-drawer';

const props = defineProps<{ drawer: CardDrawerState }>();
const {
  modelWords,
  note,
  busy,
  load,
  act,
  canApprove,
  progress,
  decisionsHere,
  lastModel,
  passagesHere,
  decide,
  RISK_FIELDS,
  TIER_FIELDS,
  verdictOf,
  editedOr,
} = props.drawer;
// The drawer shows this panel only for a loaded card with its classification.
const card = computed(() => props.drawer.card.value as CardWith<'classification'>);
</script>

<template>
  <div class="ai-draft">
    <div class="ai-draft-head">
      <span class="ai-mark">AI</span>
      <div class="grow">
        <h3
          >The Risk Classifier proposes: {{ TIER_LABELS[card.classification.tier] }} risk,
          {{ card.classification.risks.length }} starting risks</h3
        >
        <p class="small muted"
          >Drafted by {{ modelWords(lastModel) }} from the use case profile and {{ passagesHere.length }} passages from
          the knowledge base (frameworks, library controls, ARGUS's method and the client's documents).</p
        >
      </div>
    </div>
    <div class="decide-box">
      <strong>What you decide:</strong> is the tier right, and which risks belong in the register? Accept, edit or
      reject each one. Only what you keep is added, owned by {{ card.useCase.businessOwner || 'the business owner' }}.
    </div>
    <div class="stack" style="gap: 4px">
      <div class="spread small"
        ><span>{{ progress.decided }} of {{ progress.total }} decided</span
        ><button v-if="canApprove && progress.decided < progress.total" class="btn sm ghost" @click="decide(null)"
          >Accept the rest</button
        ></div
      >
      <div class="progress"
        ><i :style="{ width: `${progress.total ? (progress.decided / progress.total) * 100 : 0}%` }"
      /></div>
    </div>
    <VerifierBar :card="card" @checked="load" />

    <span class="label-caps">Tier and oversight</span>
    <DraftItem
      :title="`${TIER_LABELS[editedOr('tier', { tier: card.classification.tier }).tier as keyof typeof TIER_LABELS]} risk · ${OVERSIGHT_LABELS[editedOr('tier', { oversight: card.classification.oversight }).oversight as keyof typeof OVERSIGHT_LABELS]}`"
      :meta="card.classification.factors.join(' · ')"
      :why="`${card.classification.tierRationale} ${card.classification.oversightRationale}`"
      :sources="card.classification.tierSources"
      :passages="passagesHere"
      :decision="decisionsHere.tier"
      :can-decide="canApprove"
      :fields="TIER_FIELDS"
      :values="{ tier: card.classification.tier, oversight: card.classification.oversight }"
      no-reject
      :verdict="verdictOf('tier')"
      @decide="(d, e, r) => decide('tier', d, e, r)"
    />
    <span class="label-caps">Risks for the register</span>
    <DraftItem
      v-for="(r, i) in card.classification.risks"
      :key="i"
      :title="String(editedOr(`risk:${i}`, r).title)"
      :meta="`${r.category.replace('_', ' ')} · likelihood ${editedOr(`risk:${i}`, r).likelihood} × impact ${editedOr(`risk:${i}`, r).impact} = ${Number(editedOr(`risk:${i}`, r).likelihood) * Number(editedOr(`risk:${i}`, r).impact)}`"
      :why="r.rationale"
      :sources="r.sources"
      :passages="passagesHere"
      :decision="decisionsHere[`risk:${i}`]"
      :can-decide="canApprove"
      :fields="RISK_FIELDS"
      :values="{ title: r.title, likelihood: r.likelihood, impact: r.impact }"
      :verdict="verdictOf(`risk:${i}`)"
      @decide="(d, e, rs) => decide(`risk:${i}`, d, e, rs)"
    />
    <div v-if="card.classification.openQuestions.length" class="small"
      ><strong>Questions for the business owner</strong
      ><ul class="plain"
        ><li v-for="q in card.classification.openQuestions" :key="q">{{ q }}</li></ul
      ></div
    >

    <textarea
      v-model="note"
      class="textarea"
      style="min-height: 60px"
      placeholder="Note for the record, or what the Risk Classifier should reconsider (needed to run it again)"
    />
    <div v-if="canApprove" class="row" style="flex-wrap: wrap">
      <button
        class="btn primary"
        :disabled="busy || progress.decided < progress.total"
        :title="progress.decided < progress.total ? 'Decide each item first' : ''"
        @click="act('approve')"
        >Approve and add to the register</button
      >
      <button class="btn" :disabled="busy" @click="act('request_changes', true)">Run it again</button>
    </div>
    <p v-else class="small faint">A reviewer or lead decides on this draft.</p>
  </div>
</template>
