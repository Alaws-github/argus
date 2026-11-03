<script setup lang="ts">
// The board: one column per stage, use cases as cards, filters and search.
// Clicking a card opens the side panel (CardDrawer).
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { STAGES, STAGE_HINTS, STAGE_LABELS, TIER_LABELS, type Card, type Stage } from '@gh/shared';
import { useApp } from '../stores/app';
import { api, ago, money } from '../api';
import StatusPill from '../components/StatusPill.vue';
import CardDrawer from '../components/CardDrawer.vue';

const app = useApp();
const route = useRoute();
const router = useRouter();
const filter = ref<'all' | 'you' | 'running' | 'high'>('all');
const search = ref('');

const selected = computed(() => (typeof route.query.card === 'string' ? route.query.card : ''));
const open = (c: Card) => router.replace({ query: { card: c.key } });
const close = () => router.replace({ query: {} });

const isYou = (c: Card) => c.status === 'needs_approval' || c.status === 'failed' || (c.stage === 'intake' && c.status === 'idle');
const visible = computed(() =>
  app.cards.filter((c) => {
    if (filter.value === 'you' && !isYou(c)) return false;
    if (filter.value === 'running' && !['running', 'queued'].includes(c.status)) return false;
    if (filter.value === 'high' && !['high', 'prohibited'].includes(c.tier ?? '')) return false;
    const q = search.value.trim().toLowerCase();
    return !q || c.title.toLowerCase().includes(q) || c.key.toLowerCase().includes(q);
  }),
);
const byStage = (s: Stage) => visible.value.filter((c) => c.stage === s);
const stageCost = (s: Stage) => app.cards.filter((c) => c.stage === s).reduce((a, c) => a + c.costUsd, 0);
const counts = computed(() => ({
  all: app.cards.length,
  you: app.cards.filter(isYou).length,
  running: app.cards.filter((c) => ['running', 'queued'].includes(c.status)).length,
  high: app.cards.filter((c) => ['high', 'prohibited'].includes(c.tier ?? '')).length,
}));

async function toggleAuto() {
  const next = !app.autoStart;
  try {
    await api('/settings', { method: 'PUT', body: { autoStart: next } });
    app.autoStart = next;
    app.toast(next ? 'Agents start on their own' : 'Agents paused: queued cards wait');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
</script>

<template>
  <div class="page" style="max-width: none; padding-left: 0; padding-right: 0">
    <div style="padding: 0 20px">
      <div class="page-head">
        <div>
          <h1>Board</h1>
          <p class="small">{{ app.cards.length }} use cases · {{ counts.you }} need you · {{ app.slots.busy }} agents running</p>
        </div>
      </div>
      <div class="toolbar">
        <div class="filters">
          <button v-for="f in (['all', 'you', 'running', 'high'] as const)" :key="f" class="filter" :class="{ active: filter === f }" @click="filter = f">
            {{ { all: 'All', you: 'Needs you', running: 'Running', high: 'High risk' }[f] }}<span class="count">{{ counts[f] }}</span>
          </button>
          <input v-model="search" class="input" style="width: 200px; padding: 4px 10px" placeholder="Search use cases" aria-label="Search use cases" />
        </div>
        <div class="row small muted">
          <span>{{ app.slots.busy }} of {{ app.slots.limit }} agent slots busy</span>
          <button class="switch" :class="{ on: app.autoStart }" role="switch" :aria-checked="app.autoStart" @click="toggleAuto">
            <span class="track" />Agents start on their own
          </button>
        </div>
      </div>
    </div>

    <div class="columns-scroll">
      <div class="columns">
        <section v-for="s in STAGES" :key="s" class="column" :aria-label="STAGE_LABELS[s]">
          <div class="col-head">
            <div class="spread">
              <h3>{{ STAGE_LABELS[s] }}<span class="col-count">{{ byStage(s).length }}</span></h3>
              <span class="row">
                <span v-if="stageCost(s) > 0" class="faint small">{{ money(stageCost(s)) }}</span>
                <span v-if="app.engagement?.gates[s]" class="badge warn">You approve</span>
              </span>
            </div>
            <span class="small faint">{{ STAGE_HINTS[s] }}</span>
          </div>
          <button v-for="c in byStage(s)" :key="c.id" class="board-card" :class="{ selected: selected === c.key }" @click="open(c)">
            <span class="spread small">
              <span class="row"><span class="mono faint">{{ c.key }}</span><span v-if="c.tier" class="tier" :class="c.tier">{{ TIER_LABELS[c.tier] }}</span></span>
              <span v-if="c.costUsd > 0" class="faint">{{ money(c.costUsd) }}</span>
            </span>
            <span class="title">{{ c.title }}</span>
            <span class="spread small">
              <StatusPill :card="c" />
              <span class="faint">{{ ago(c.stageEnteredAt) }}</span>
            </span>
          </button>
          <div v-if="!byStage(s).length" class="empty-col">No use cases</div>
        </section>
      </div>
    </div>

    <CardDrawer v-if="selected" :card-key="selected" @close="close" />
  </div>
</template>
