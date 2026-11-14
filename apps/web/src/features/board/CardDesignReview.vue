<script setup lang="ts">
// Controls: the Control Designer's proposed controls, decided item by item.
// Part of the use case side panel (CardDrawer.vue); state and actions come from useCardDrawer.
import DraftItem from './DraftItem.vue';
import VerifierBar from './VerifierBar.vue';
import { computed } from 'vue';
import type { CardDrawerState, CardWith } from './use-card-drawer';

const props = defineProps<{ drawer: CardDrawerState }>();
const {
  modelWords,
  exit,
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
  CONTROL_FIELDS,
  verdictOf,
  editedOr,
} = props.drawer;
// The drawer shows this panel only for a loaded card with its design.
const card = computed(() => props.drawer.card.value as CardWith<'design'>);
</script>

<template>
  <div class="ai-draft">
    <div class="ai-draft-head">
      <span class="ai-mark">AI</span>
      <div class="grow">
        <h3>The Control Designer proposes {{ card.design.controls.length }} controls</h3>
        <p class="small muted"
          >Drafted by {{ modelWords(lastModel) }} from the approved risks, the control library and
          {{ passagesHere.length }} passages from the knowledge base.</p
        >
      </div>
    </div>
    <div class="decide-box">
      <strong>What you decide:</strong> which controls should be in place for this use case. Each one you keep goes into
      the control register with a draft test, linked to the risks it treats. Every risk scoring 12 or more must keep at
      least one control.
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
    <DraftItem
      v-for="(c, i) in card.design.controls"
      :key="i"
      :title="`${c.libraryCode ? c.libraryCode + ' · ' : ''}${editedOr(`control:${i}`, c).title}`"
      :meta="`Owner: ${editedOr(`control:${i}`, c).owner} · treats ${c.riskTitles.join('; ')}`"
      :why="String(editedOr(`control:${i}`, c).objective)"
      :sources="c.sources"
      :passages="passagesHere"
      :decision="decisionsHere[`control:${i}`]"
      :can-decide="canApprove"
      :fields="CONTROL_FIELDS"
      :values="{ title: c.title, owner: c.owner, objective: c.objective }"
      :verdict="verdictOf(`control:${i}`)"
      @decide="(d, e, r) => decide(`control:${i}`, d, e, r)"
    />
    <div v-if="card.design.gaps.length" class="small"
      ><strong>Gaps the agent noted</strong
      ><ul class="plain"
        ><li v-for="g in card.design.gaps" :key="g">{{ g }}</li></ul
      ></div
    >
    <p v-if="exit.unmet.length" class="error small">{{ exit.unmet.join('; ') }}</p>
    <textarea
      v-model="note"
      class="textarea"
      style="min-height: 60px"
      placeholder="Note for the record, or what the Control Designer should reconsider (needed to run it again)"
    />
    <div v-if="canApprove" class="row" style="flex-wrap: wrap">
      <button
        class="btn primary"
        :disabled="busy || progress.decided < progress.total || exit.unmet.length > 0"
        @click="act('approve')"
        >Approve and create the controls</button
      >
      <button class="btn" :disabled="busy" @click="act('request_changes', true)">Run it again</button>
    </div>
    <p v-else class="small faint">A reviewer or lead decides on this draft.</p>
  </div>
</template>
