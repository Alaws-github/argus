<script setup lang="ts">
// Intake: take the use case forward or close it with a note.
// Part of the use case side panel (CardDrawer.vue); state and actions come from useCardDrawer.
import type { CardDrawerState } from './use-card-drawer';

const props = defineProps<{ drawer: CardDrawerState }>();
const { note, busy, act, canApprove, ownCard } = props.drawer;
</script>

<template>
  <div class="notice warn">
    <h3>Take this use case forward?</h3>
    <p class="small">Approving sends it to the Risk Classifier. Not taking it forward closes it with your note.</p>
    <textarea v-model="note" class="textarea" placeholder="Note for the record (optional)" />
    <div v-if="canApprove && !ownCard" class="row">
      <button class="btn primary" :disabled="busy" @click="act('approve')">Send to classification</button>
      <button class="btn" :disabled="busy" @click="act('reject')">Don't take forward</button>
    </div>
    <p v-else class="small faint">{{
      ownCard
        ? 'You added this use case, so someone else decides whether to take it forward.'
        : 'A reviewer or lead decides this.'
    }}</p>
  </div>
</template>
