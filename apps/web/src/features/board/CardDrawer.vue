<script setup lang="ts">
// The side panel for one use case: whatever decision it is waiting for (triage,
// classification, control design, an agent draft, a manual sign-off), its exit
// criteria, risks, controls, profile, runs and activity. v1.7.8: the state and
// actions are in useCardDrawer; each panel is its own component.
import { STAGE_LABELS, TIER_LABELS } from '@gh/shared';
import { ago, money } from '../../api';
import { useApp } from '../../stores/app';
import StatusPill from '../../components/StatusPill.vue';
import { useCardDrawer } from './use-card-drawer';
import CardTriagePanel from './CardTriagePanel.vue';
import CardClassifyReview from './CardClassifyReview.vue';
import CardDraftReview from './CardDraftReview.vue';
import CardDesignReview from './CardDesignReview.vue';
import CardQuestionPanel from './CardQuestionPanel.vue';
import CardStatusPanel from './CardStatusPanel.vue';
import CardRecord from './CardRecord.vue';

const props = defineProps<{ cardKey: string }>();
const emit = defineEmits<{ close: [] }>();
const app = useApp();
const d = useCardDrawer(() => props.cardKey);
const { card, error, mode, drafting, draft, openQuestion } = d;
</script>

<template>
  <div class="backdrop" @click="emit('close')" />
  <aside
    class="panel"
    role="dialog"
    :aria-label="card ? `${card.key} ${card.title}` : 'Use case'"
    @keydown.esc="emit('close')"
  >
    <div v-if="!card" class="muted">{{ error || 'Loading…' }}</div>
    <template v-else>
      <div class="spread">
        <div class="row">
          <span class="mono faint">{{ card.key }}</span>
          <span v-if="card.tier" class="tier" :class="card.tier">{{ TIER_LABELS[card.tier] }}</span>
          <StatusPill :card="card" />
        </div>
        <div class="row" style="gap: 6px">
          <button
            class="btn sm ask-ai"
            title="Ask the assistant about this use case"
            @click="app.openAssistant('card', card.id, `${card.key} ${card.title}`)"
            ><span class="ai-mark" style="font-size: 10px; padding: 1px 4px">AI</span>Ask about this</button
          >
          <button class="btn ghost sm" aria-label="Close" @click="emit('close')">✕</button>
        </div>
      </div>
      <div>
        <h1 style="font-size: 19px">{{ card.title }}</h1>
        <p class="small muted" style="margin-top: 4px">
          Stage {{ STAGE_LABELS[card.stage] }} · {{ ago(card.stageEnteredAt) }} here · AI spend
          {{ money(card.costUsd) }}
        </p>
      </div>

      <!-- Gate panels -->
      <CardTriagePanel v-if="mode === 'triage'" :drawer="d" />
      <CardClassifyReview
        v-else-if="mode === 'review' && card.stage === 'classify' && card.classification"
        :drawer="d"
      />
      <CardDraftReview v-else-if="drafting && draft" :drawer="d" />
      <CardDesignReview v-else-if="mode === 'review' && card.stage === 'design' && card.design" :drawer="d" />
      <CardQuestionPanel v-else-if="mode === 'question' && openQuestion" :drawer="d" />
      <CardStatusPanel v-else :drawer="d" />
      <p v-if="error" class="error">{{ error }}</p>

      <CardRecord :drawer="d" />
    </template>
  </aside>
</template>
