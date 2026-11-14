<script setup lang="ts">
// An agent's question for a person (rule 27): answer it or skip it.
// Part of the use case side panel (CardDrawer.vue); state and actions come from useCardDrawer.
import { useApp } from '../../stores/app';
import { computed } from 'vue';
import type { CardDrawerState } from './use-card-drawer';

const props = defineProps<{ drawer: CardDrawerState }>();
const app = useApp();
const { busy, answer, ASKED_OF, reply } = props.drawer;
// The drawer shows this panel only while an agent's question is open.
const openQuestion = computed(() => props.drawer.openQuestion.value!);
</script>

<template>
  <div class="notice question-box">
    <span class="label-caps row" style="gap: 8px"
      ><span class="seg-ai">AI</span>{{ openQuestion.agent }} has a question</span
    >
    <h3 style="margin-top: 6px">{{ openQuestion.question }}</h3>
    <p v-if="openQuestion.why" class="small muted"
      >Why it asks: {{ openQuestion.why
      }}<span v-if="ASKED_OF[openQuestion.askedTo]"> · best answered by {{ ASKED_OF[openQuestion.askedTo] }}</span></p
    >
    <template v-if="app.can('prepare')">
      <textarea
        v-model="answer"
        class="textarea"
        rows="3"
        placeholder="Your answer. The agent uses it in its draft; it doesn't decide anything."
        aria-label="Your answer"
      />
      <div class="row">
        <button class="btn primary" :disabled="busy || !answer.trim()" @click="reply('answer')">Send answer</button>
        <button
          class="btn"
          :disabled="busy"
          title="The agent carries on without it and notes what it assumed"
          @click="reply('skip')"
          >Skip question</button
        >
      </div>
    </template>
    <p v-else class="small faint">Someone who can prepare work answers this.</p>
  </div>
</template>
