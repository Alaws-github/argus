<script setup lang="ts">
// The board: one column per stage, use cases as cards, filters and search.
// Clicking a card opens the side panel (CardDrawer). Cards can be dragged one
// stage forward: the drop runs the same approve or move-on action as the
// buttons, so permissions, segregation of duties and exit criteria all apply.
import { draftProgress, draftSummary } from '../lib/drafts';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  CATEGORY_LABELS, PRIORITY_LABELS, ROUTE_LABELS, STAGES, STAGE_HINTS, STAGE_LABELS, TIER_LABELS,
  type AgentConfig, type Card, type Stage, type UseCaseCategory,
} from '@gh/shared';
import { useApp } from '../stores/app';
import { api, ago, money } from '../api';
import StatusPill from '../components/StatusPill.vue';
import CardDrawer from '../components/CardDrawer.vue';
import NewUseCase from '../components/NewUseCase.vue';

const app = useApp();
const route = useRoute();
const router = useRouter();
const show = ref<'all' | 'you' | 'running' | 'high'>('all');
const category = ref<'' | UseCaseCategory>('');
const priority = ref('');
const search = ref('');
const quickAdd = ref(false);
const agents = ref<AgentConfig[]>([]);
onMounted(async () => {
  if (!app.engagementId) await app.init();
  agents.value = await api<AgentConfig[]>(`/engagements/${app.engagementId}/agents`).catch(() => []);
});

const selected = computed(() => (typeof route.query.card === 'string' ? route.query.card : ''));
const open = (c: Card) => router.replace({ query: { card: c.key } });
const close = () => router.replace({ query: {} });

const catOf = (c: Card): UseCaseCategory => ((c.useCase as any).category ?? 'other') as UseCaseCategory;
const prioOf = (c: Card): string => (c.useCase as any).priority ?? 'p2';
const isYou = (c: Card) => c.status === 'needs_approval' || c.status === 'failed' || (c.stage === 'intake' && c.status === 'idle');
const visible = computed(() =>
  app.cards.filter((c) => {
    if (show.value === 'you' && !isYou(c)) return false;
    if (show.value === 'running' && !['running', 'queued'].includes(c.status)) return false;
    if (show.value === 'high' && !['high', 'prohibited'].includes(c.tier ?? '')) return false;
    if (category.value && catOf(c) !== category.value) return false;
    if (priority.value && prioOf(c) !== priority.value) return false;
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

// Who works each column, and where a person steps in.
const gateOf = (s: Stage) => (s === 'intake' ? 'You triage' : s === 'closed' ? '' : app.engagement?.gates[s] ? (s === 'validate' ? 'You sign off' : 'You approve') : '');
const ownerOf = (s: Stage) => {
  const on = agents.value.filter((a) => a.stage === s && a.enabled && a.built);
  if (s === 'intake') return on.length ? `${on[0].name} drafts the brief · you add it` : 'You add use cases';
  if (!on.length) return STAGE_HINTS[s].includes('·') ? 'A person · the agent is off' : STAGE_HINTS[s];
  return on.map((a) => (a.route === 'all' ? a.name : `${a.name} (${ROUTE_LABELS[a.route].replace(/ only$/, '').toLowerCase()})`)).join(', ');
};

// Small line icons for the kind of AI, drawn inline so they take the text colour.
const ICONS: Record<UseCaseCategory, string> = {
  decision: 'M12 3v18M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0zM8 21h8',
  chatbot: 'M4 5h16v11H9l-5 4z',
  agent: 'M12 3v3M6 8h12v11H6zM9.5 13h.01M14.5 13h.01M3 13h3M18 13h3',
  generative: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  analytics: 'M5 20V11M12 20V5M19 20v-6',
  other: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
};

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

// ---------------------------------------------------------------- drag and drop
const dragging = ref<Card | null>(null);
const over = ref<Stage | ''>('');
const canDrag = computed(() => app.can('prepare') && !app.engagement?.archivedAt);
const nextOf = (s: Stage) => STAGES[STAGES.indexOf(s) + 1];
const dropOk = (s: Stage) => !!dragging.value && nextOf(dragging.value.stage) === s;
function onDragStart(e: DragEvent, c: Card) {
  dragging.value = c;
  e.dataTransfer?.setData('text/plain', c.key);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDragEnd() {
  dragging.value = null;
  over.value = '';
}
async function onDrop(s: Stage) {
  const c = dragging.value;
  onDragEnd();
  if (!c || c.stage === s) return;
  if (STAGES.indexOf(s) < STAGES.indexOf(c.stage)) return app.toast(`To send ${c.key} back, open it and use Request changes, so the reason is recorded.`, 'error');
  if (nextOf(c.stage) !== s) return app.toast(`${c.key} moves one stage at a time, so each gate gets its decision. Drop it on ${STAGE_LABELS[nextOf(c.stage)]}.`, 'error');
  if (c.status === 'running' || c.status === 'queued') return app.toast(`${c.key} is with an agent right now. Wait for its draft.`, 'error');
  const waiting = (c.stage === 'intake' && c.status === 'idle') || c.status === 'needs_approval';
  try {
    await api(`/cards/${c.id}/actions`, { method: 'POST', body: { action: waiting ? 'approve' : 'advance' } });
    app.toast(`${c.key} moved to ${STAGE_LABELS[s]}`);
  } catch (e: any) {
    app.toast(`${c.key} stays in ${STAGE_LABELS[c.stage]}: ${e.message}`, 'error');
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
          <label class="select-pill"><span>Show</span>
            <select v-model="show" class="select sm" aria-label="Show">
              <option value="all">All cards ({{ counts.all }})</option>
              <option value="you">Needs you ({{ counts.you }})</option>
              <option value="running">Running ({{ counts.running }})</option>
              <option value="high">High risk ({{ counts.high }})</option>
            </select>
          </label>
          <label class="select-pill"><span>Kind</span>
            <select v-model="category" class="select sm" aria-label="Kind of AI">
              <option value="">Any</option>
              <option v-for="(l, k) in CATEGORY_LABELS" :key="k" :value="k">{{ l }}</option>
            </select>
          </label>
          <label class="select-pill"><span>Priority</span>
            <select v-model="priority" class="select sm" aria-label="Priority">
              <option value="">Any</option>
              <option v-for="(l, k) in PRIORITY_LABELS" :key="k" :value="k">{{ l }}</option>
            </select>
          </label>
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
        <section
          v-for="s in STAGES" :key="s" class="column" :class="{ 'drop-ok': dropOk(s), 'drop-over': over === s && dropOk(s) }" :aria-label="STAGE_LABELS[s]"
          @dragover.prevent="over = s" @dragleave="over === s && (over = '')" @drop.prevent="onDrop(s)"
        >
          <div class="col-head">
            <div class="spread">
              <h3>{{ STAGE_LABELS[s] }}<span class="col-count">{{ byStage(s).length }}</span></h3>
              <span class="row" style="gap: 6px">
                <span v-if="stageCost(s) > 0" class="col-cost"><i />{{ money(stageCost(s)) }}</span>
                <span v-if="gateOf(s)" class="badge warn">{{ gateOf(s) }}</span>
              </span>
            </div>
            <span class="small faint col-owner" :title="ownerOf(s)">{{ ownerOf(s) }}</span>
          </div>
          <template v-if="s === 'intake' && app.can('prepare')">
            <button class="quick-add" @click="quickAdd = true">+ Quick add</button>
          </template>
          <button
            v-for="c in byStage(s)" :key="c.id" class="board-card" :class="{ selected: selected === c.key, dragging: dragging?.id === c.id }"
            :draggable="canDrag" @dragstart="onDragStart($event, c)" @dragend="onDragEnd" @click="open(c)"
          >
            <span class="card-top small">
              <span class="category" :class="catOf(c)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ICONS[catOf(c)]" /></svg>
                {{ CATEGORY_LABELS[catOf(c)] }}
              </span>
              <span class="mono faint">{{ c.key }}</span>
              <span class="end">
                <span v-if="c.costUsd > 0" class="mono faint">{{ money(c.costUsd) }}</span>
                <span class="prio" :class="prioOf(c)">{{ prioOf(c).toUpperCase() }}</span>
              </span>
            </span>
            <span class="title">{{ c.title }}</span>
            <span v-if="draftSummary(c)" class="ai-line" :title="'An AI agent drafted this. A person decides.'">
              <span class="ai-dot">AI</span><span class="grow">{{ draftSummary(c) }}</span>
              <span v-if="draftProgress(c).total" class="faint">{{ draftProgress(c).decided }}/{{ draftProgress(c).total }}</span>
            </span>
            <span class="card-bottom small">
              <StatusPill :card="c" />
              <span v-if="c.tier" class="tier" :class="c.tier">{{ TIER_LABELS[c.tier] }}</span>
              <span class="faint end">{{ c.stage === 'intake' ? 'Added' : 'Here' }} {{ ago(c.stageEnteredAt) }} ago</span>
            </span>
          </button>
          <div v-if="!byStage(s).length" class="empty-col">{{ dropOk(s) ? 'Drop here' : 'No use cases' }}</div>
        </section>
      </div>
    </div>

    <NewUseCase v-if="quickAdd" @close="quickAdd = false" />
    <CardDrawer v-if="selected" :card-key="selected" @close="close" />
  </div>
</template>
