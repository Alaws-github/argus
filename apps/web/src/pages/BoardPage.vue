<script setup lang="ts">
// The board: one column per stage, use cases as cards, filters and search.
// Clicking a card opens the side panel (CardDrawer). Cards can be dragged one
// stage forward: the drop runs the same approve or move-on action as the
// buttons, so permissions, segregation of duties and exit criteria all apply.
import { draftProgress, draftSummary } from '../lib/drafts';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  CATEGORY_LABELS, PHASES, PHASE_HINTS, PHASE_LABELS, PHASE_OF, PRIORITY_LABELS, ROUTE_LABELS, STAGES, STAGE_LABELS, STEP_LABELS, TIER_LABELS,
  type AgentConfig, type Card, type Phase, type Stage, type UseCaseCategory,
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
// Five columns: each phase groups one or more of the engine's stages.
const stagesOf = (p: Phase) => STAGES.filter((s) => PHASE_OF[s] === p);
const byPhase = (p: Phase) => visible.value.filter((c) => PHASE_OF[c.stage] === p).sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
const phaseCost = (p: Phase) => app.cards.filter((c) => PHASE_OF[c.stage] === p).reduce((a, c) => a + c.costUsd, 0);
const counts = computed(() => ({
  all: app.cards.length,
  you: app.cards.filter(isYou).length,
  running: app.cards.filter((c) => ['running', 'queued'].includes(c.status)).length,
  high: app.cards.filter((c) => ['high', 'prohibited'].includes(c.tier ?? '')).length,
}));

// Who works each column, and where a person steps in.
const gateOf = (p: Phase) => (p === 'intake' ? 'You Triage' : p === 'closed' ? '' : stagesOf(p).some((s) => app.engagement?.gates[s]) ? 'You Decide' : '');
const ownerOf = (p: Phase) => {
  const on = agents.value.filter((a) => PHASE_OF[a.stage] === p && a.enabled && a.built);
  if (p === 'closed') return PHASE_HINTS.closed;
  if (!on.length) return 'A person does this step; its AI agent is off';
  if (!app.mod('advanced_ai')) return PHASE_HINTS[p];
  return 'AI: ' + on.map((a) => (a.route === 'all' ? a.name : `${a.name} (${ROUTE_LABELS[a.route].replace(/ only$/, '').toLowerCase()})`)).join(', ');
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
const over = ref<Phase | ''>('');
const canDrag = computed(() => app.can('prepare') && !app.engagement?.archivedAt);
const nextOf = (s: Stage) => STAGES[STAGES.indexOf(s) + 1];
const dropOk = (p: Phase) => !!dragging.value && dragging.value.stage !== 'closed' && PHASE_OF[nextOf(dragging.value.stage)] === p;
function onDragStart(e: DragEvent, c: Card) {
  dragging.value = c;
  e.dataTransfer?.setData('text/plain', c.key);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDragEnd() {
  dragging.value = null;
  over.value = '';
}
async function onDrop(p: Phase) {
  const c = dragging.value;
  onDragEnd();
  if (!c || c.stage === 'closed') return;
  const next = nextOf(c.stage);
  if (PHASE_OF[next] !== p) {
    if (PHASES.indexOf(p) < PHASES.indexOf(PHASE_OF[c.stage])) return app.toast(`To send ${c.key} back, open it and use Request changes, so the reason is recorded.`, 'error');
    if (p === PHASE_OF[c.stage]) return;
    return app.toast(`${c.key} moves one step at a time, so each decision gets made. Its next step is ${STAGE_LABELS[next]}, in ${PHASE_LABELS[PHASE_OF[next]]}.`, 'error');
  }
  if (c.status === 'running' || c.status === 'queued') return app.toast(`${c.key} is with an AI agent right now. Wait for its draft.`, 'error');
  const waiting = (c.stage === 'intake' && c.status === 'idle') || c.status === 'needs_approval';
  try {
    await api(`/cards/${c.id}/actions`, { method: 'POST', body: { action: waiting ? 'approve' : 'advance' } });
    app.toast(`${c.key} moved to ${STAGE_LABELS[next]}`);
  } catch (e: any) {
    app.toast(`${c.key} stays at ${STAGE_LABELS[c.stage]}: ${e.message}`, 'error');
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
          v-for="s in PHASES" :key="s" class="column" :class="{ 'drop-ok': dropOk(s), 'drop-over': over === s && dropOk(s) }" :aria-label="PHASE_LABELS[s]"
          @dragover.prevent="over = s" @dragleave="over === s && (over = '')" @drop.prevent="onDrop(s)"
        >
          <div class="col-head">
            <div class="spread">
              <h3>{{ PHASE_LABELS[s] }}<span class="col-count">{{ byPhase(s).length }}</span></h3>
              <span class="row" style="gap: 6px">
                <span v-if="phaseCost(s) > 0" class="col-cost"><i />{{ money(phaseCost(s)) }}</span>
                <span v-if="gateOf(s)" class="badge warn">{{ gateOf(s) }}</span>
              </span>
            </div>
            <span class="small faint col-owner" :title="ownerOf(s)">{{ ownerOf(s) }}</span>
          </div>
          <template v-if="s === 'intake' && app.can('prepare')">
            <button class="quick-add" @click="quickAdd = true">+ Quick Add</button>
          </template>
          <button
            v-for="c in byPhase(s)" :key="c.id" class="board-card" :class="{ selected: selected === c.key, dragging: dragging?.id === c.id }"
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
            <span v-if="STEP_LABELS[c.stage] && stagesOf(s).length > 1" class="step-chip small">{{ STEP_LABELS[c.stage] }}</span>
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
          <div v-if="!byPhase(s).length" class="empty-col">{{ dropOk(s) ? 'Drop here' : 'No use cases' }}</div>
        </section>
      </div>
    </div>

    <NewUseCase v-if="quickAdd" @close="quickAdd = false" />
    <CardDrawer v-if="selected" :card-key="selected" @close="close" />
  </div>
</template>
