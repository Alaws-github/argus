<script setup lang="ts">
// The Verifier's line on a draft: its overall view, which model checked it,
// and a button to check (again). Advisory only: it never decides an item.
import { computed, ref } from 'vue';
import type { Card } from '@gh/shared';
import { api } from '../api';
import { useApp } from '../stores/app';

const props = defineProps<{ card: Card }>();
const emit = defineEmits<{ checked: [] }>();
const app = useApp();
const busy = ref(false);
const v = computed(() => (props.card.verification as any)?.[props.card.stage] ?? null);
const counts = computed(() => {
  const items: any[] = v.value?.items ?? [];
  return { ok: items.filter((i) => i.verdict === 'supported').length, total: items.length, bad: items.filter((i) => i.verdict === 'unsupported' || i.verdict === 'contradicted').length };
});

async function check() {
  busy.value = true;
  try {
    await api(`/cards/${props.card.id}/verify`, { method: 'POST', body: {} });
    emit('checked');
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="verifier-bar" :class="{ warn: v && counts.bad, good: v && !counts.bad && counts.ok === counts.total }">
    <span class="verifier-mark" aria-hidden="true">✓?</span>
    <div class="grow">
      <template v-if="v">
        <strong>Verifier: {{ counts.ok }} of {{ counts.total }} items supported by their sources.</strong>
        {{ ' ' }}<span class="small">{{ v.summary }}</span>
        <div class="small faint">
          {{ v.runtime === 'live' ? `Checked by ${v.model}` : 'Checked by word-matching rules (no model set)' }}, {{ v.trigger === 'auto' ? 'automatically' : 'on request' }}, {{ new Date(v.at).toLocaleString() }}. Advisory: you still decide each item.
        </div>
        <div v-if="v.sameModel" class="small" style="color: var(--warn)">The same model wrote and checked this draft, so treat its verdict with extra care.</div>
      </template>
      <template v-else>
        <strong>Not checked by the Verifier yet.</strong>
        {{ ' ' }}<span class="small muted">It reads each item against the passages it cites and flags any the sources don't back up.</span>
      </template>
    </div>
    <button v-if="app.can('prepare')" class="btn sm" :disabled="busy" @click="check">{{ busy ? 'Checking…' : v ? 'Check again' : 'Check with the Verifier' }}</button>
  </div>
</template>
