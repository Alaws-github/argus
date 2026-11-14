<script setup lang="ts">
// The coloured status chip on a use case card (Needs triage, Running, Needs
// your approval, Failed...).
import { computed } from 'vue';
import { STATUS_LABELS, type Card } from '@gh/shared';

const props = defineProps<{ card: Card }>();

const view = computed(() => {
  const c = props.card;
  if (c.stage === 'intake' && c.status === 'idle') return { cls: 'amber', text: 'Needs Triage' };
  if (c.stage === 'closed') return { cls: c.tier ? 'green' : '', text: c.tier ? 'Governed' : 'Not Taken Forward' };
  const cls = {
    idle: '',
    queued: 'blue',
    running: 'blue pulse',
    needs_approval: 'amber',
    changes_requested: 'amber',
    failed: 'coral',
    question: 'violet',
  }[c.status];
  return { cls, text: STATUS_LABELS[c.status] };
});
</script>

<template>
  <span class="pill" :class="[view.cls, { attention: ['amber', 'coral', 'violet'].includes(view.cls ?? '') }]"
    ><span class="dot" />{{ view.text }}</span
  >
</template>
