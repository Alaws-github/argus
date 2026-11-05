<script setup lang="ts">
// The assistant: ask about the page, use case or register you're looking at.
// It explains, checks and suggests. Each suggestion is a proposed change you
// apply or discard; applying it runs under your own name and permissions.
// Conversations are kept per person: start a new one, or find an old one and
// carry on. Each question sends the page you're on and the text on screen, so
// "what's on this page?" has an answer.
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { AssistantConversation, AssistantMessage, AssistantSuggestion } from '@gh/shared';
import { api } from '../api';
import { useApp } from '../stores/app';
import Icon from './Icon.vue';

const app = useApp();
const route = useRoute();
const messages = ref<AssistantMessage[]>([]);
const conversation = ref<AssistantConversation | null>(null);
const fresh = ref(false);
const listOpen = ref(false);
const convs = ref<AssistantConversation[]>([]);
const search = ref('');
const searchBox = ref<HTMLInputElement | null>(null);
const model = ref<string | null>(null);
const question = ref('');
const busy = ref(false);
const openSource = ref('');
const list = ref<HTMLElement | null>(null);
const a = computed(() => app.assistant);

const STARTERS: Record<string, string[]> = {
  card: ['Explain this draft in plain English', 'What should I check before approving?', 'Which items look weakest, and why?'],
  risks: ['Which risks need attention first?', 'Which high risks have no control?', 'Which risks have no owner?'],
  controls: ['Which controls have no test yet?', 'Which controls have no owner?', 'Summarise the control register for a director'],
  issues: ['Which issues are overdue or high severity?', 'Summarise open issues for the board'],
  engagement: ['What is on this page, and what can I do here?', 'Where does this engagement stand?', 'What should the team do next?'],
};
const title = computed(() => (a.value.kind === 'card' ? a.value.label : { risks: 'Risk register', controls: 'Controls', issues: 'Issues', engagement: app.engagement?.name ?? 'This engagement' }[a.value.kind]));

const base = () => `/engagements/${app.engagementId}/assistant`;
// Opening the panel picks up your latest conversation about this record or page.
async function load() {
  if (!a.value.open || !app.engagementId) return;
  listOpen.value = false;
  const r = await api(`${base()}?kind=${a.value.kind}&contextId=${encodeURIComponent(a.value.contextId)}`).catch(() => null);
  conversation.value = r?.conversation ?? null;
  messages.value = r?.messages ?? [];
  model.value = r?.model ?? null;
  fresh.value = !conversation.value;
  scroll();
}
watch(() => [a.value.open, a.value.kind, a.value.contextId, app.engagementId], load, { immediate: true });

async function openConversation(id: string) {
  const r = await api(`${base()}/conversations/${id}`).catch((e) => (app.toast(e.message, 'error'), null));
  if (!r) return;
  conversation.value = r.conversation;
  messages.value = r.messages;
  model.value = r.model;
  fresh.value = false;
  listOpen.value = false;
  scroll();
}
function newConversation() {
  conversation.value = null;
  messages.value = [];
  fresh.value = true;
  listOpen.value = false;
}
let timer: ReturnType<typeof setTimeout> | undefined;
async function loadList() {
  convs.value = (await api(`${base()}/conversations${search.value.trim() ? `?q=${encodeURIComponent(search.value.trim())}` : ''}`).catch(() => [])) ?? [];
}
watch(search, () => { clearTimeout(timer); timer = setTimeout(loadList, 250); });
async function toggleList() {
  listOpen.value = !listOpen.value;
  if (listOpen.value) {
    search.value = '';
    await loadList();
    nextTick(() => searchBox.value?.focus());
  }
}
const groups = computed(() => {
  const today = new Date().toDateString();
  const out: { label: string; items: AssistantConversation[] }[] = [{ label: 'Today', items: [] }, { label: 'Earlier', items: [] }];
  for (const c of convs.value) out[new Date(c.updatedAt).toDateString() === today ? 0 : 1].items.push(c);
  return out.filter((g) => g.items.length);
});
function ago(at: string) {
  const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The text on screen, without the top bar, menus and this panel. An open use
// case panel comes first, since that is what the person is looking at.
function snapshot(): string {
  const parts: string[] = [];
  const drawer = document.querySelector<HTMLElement>('aside.panel[role="dialog"]');
  if (drawer) parts.push(drawer.innerText);
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('#app > *'))) {
    if (el.matches('header, .assistant-panel, .assistant-backdrop, .toast-host')) continue;
    parts.push(drawer && el.contains(drawer) ? (el.innerText || '').replace(drawer.innerText, '') : el.innerText);
  }
  return parts.join('\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').slice(0, 8000);
}
const scroll = () => nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight }));

async function send(text?: string) {
  const q = (text ?? question.value).trim();
  if (q.length < 2 || busy.value) return;
  busy.value = true;
  question.value = '';
  messages.value.push({ id: 'pending', role: 'user', text: q, citations: [], passages: [], suggestions: [], dropped: [], model: null, runtime: null, author: app.user?.name ?? '', at: new Date().toISOString() });
  scroll();
  try {
    const page = { path: route.fullPath, snapshot: snapshot() };
    const [, reply] = await api(base(), { method: 'POST', body: { kind: a.value.kind, contextId: a.value.contextId, question: q, page, ...(conversation.value ? { conversationId: conversation.value.id } : { newConversation: true }) } });
    await openConversation(reply.conversationId);
  } catch (e: any) {
    messages.value = messages.value.filter((m) => m.id !== 'pending');
    question.value = q;
    app.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

async function act(m: AssistantMessage, s: AssistantSuggestion, what: 'apply' | 'discard') {
  try {
    await api(`/engagements/${app.engagementId}/assistant/${m.id}/suggestions/${s.id}/${what}`, { method: 'POST', body: {} });
    app.toast(what === 'apply' ? `Applied: ${s.title}` : 'Discarded');
    window.dispatchEvent(new CustomEvent('gh:assistant-applied'));
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
  if (conversation.value) await openConversation(conversation.value.id);
  else await load();
}

const KIND: Record<string, string> = { decide_item: 'Decision on a draft item', update_risk: 'Change a risk', update_control: 'Change a control', raise_issue: 'Raise an issue', rerun_agent: 'Send back to the agent' };
function detail(s: any): string {
  switch (s.kind) {
    case 'decide_item': return `${s.decision} ${s.item}${s.edit ? `: ${Object.entries(s.edit).map(([k, v]) => `${k} → ${v}`).join(', ')}` : ''}${s.reason ? `. Reason: ${s.reason}` : ''}`;
    case 'update_risk': return ['owner', 'treatment', 'likelihood', 'impact', 'residual_likelihood', 'residual_impact'].filter((k) => s[k] !== undefined).map((k) => `${k.replace('_', ' ')} → ${s[k]}`).join(', ');
    case 'update_control': return [s.newTitle && `title → ${s.newTitle}`, s.owner && `owner → ${s.owner}`, s.objective && `objective → ${s.objective}`].filter(Boolean).join(', ');
    case 'raise_issue': return `${s.severity}: ${s.issueTitle}${s.description ? `. ${s.description}` : ''}`;
    case 'rerun_agent': return `Note to the agent: ${s.note}`;
  }
  return '';
}
const STATUS: Record<string, string> = { applied: 'Applied', discarded: 'Discarded', failed: 'Refused' };
</script>

<template>
  <template v-if="a.open">
    <div class="assistant-backdrop" @click="app.assistant.open = false" />
    <aside class="assistant-panel" role="dialog" aria-label="Assistant">
      <header class="assistant-head">
        <span class="ai-mark">AI</span>
        <div class="grow" style="min-width: 0">
          <button class="conv-pick" :aria-expanded="listOpen" aria-haspopup="true" title="Your conversations" @click="toggleList">
            <strong class="conv-title">{{ conversation?.title ?? 'New conversation' }}</strong><Icon name="chevron" :size="14" />
          </button>
          <div class="small faint">About: {{ title }} · {{ model ?? 'offline (no model set)' }}</div>
        </div>
        <button class="btn ghost sm icon-btn" title="New conversation" aria-label="New conversation" @click="newConversation"><Icon name="plus" /></button>
        <button class="btn ghost sm icon-btn" aria-label="Close the assistant" @click="app.assistant.open = false">✕</button>
        <div v-if="listOpen" class="menu conv-menu" role="menu">
          <input ref="searchBox" v-model="search" class="input" type="search" placeholder="Search conversations" aria-label="Search conversations" />
          <div class="conv-scroll">
            <template v-for="g in groups" :key="g.label">
              <div class="label-caps menu-label">{{ g.label }}</div>
              <button v-for="c in g.items" :key="c.id" role="menuitem" class="conv-item" :class="{ on: c.id === conversation?.id }" @click="openConversation(c.id)">
                <span class="conv-row"><span class="conv-name">{{ c.title }}</span><span class="small faint">{{ ago(c.updatedAt) }}</span></span>
                <span v-if="c.match" class="small faint conv-match">{{ c.match }}</span>
              </button>
            </template>
            <p v-if="!convs.length" class="small faint" style="padding: 6px 8px">{{ search ? 'No conversation matches.' : 'No conversations yet.' }}</p>
          </div>
          <button class="btn sm conv-new" @click="newConversation"><Icon name="plus" />New conversation</button>
        </div>
      </header>

      <div ref="list" class="assistant-list">
        <div v-if="!messages.length" class="stack" style="gap: 8px">
          <p class="small muted">Ask about {{ a.kind === 'card' ? 'this use case' : 'this page' }}. The assistant sees the page you're on. Answers draw on the record and the knowledge base. Anything the assistant suggests changes nothing until you apply it, under your own name.</p>
          <button v-for="s in STARTERS[a.kind]" :key="s" class="btn sm starter" @click="send(s)">{{ s }}</button>
        </div>
        <div v-for="m in messages" :key="m.id" class="msg" :class="m.role === 'user' ? 'me' : 'ai'">
          <div class="msg-text">{{ m.text }}</div>
          <template v-if="m.role === 'assistant'">
            <div v-if="m.passages.length" class="row" style="flex-wrap: wrap; gap: 4px">
              <button v-for="p in m.passages" :key="p.id" class="source-chip" :class="{ on: openSource === m.id + p.id }" @click="openSource = openSource === m.id + p.id ? '' : m.id + p.id">{{ p.id }} · {{ p.title.slice(0, 40) }}</button>
            </div>
            <template v-for="p in m.passages" :key="'q' + p.id"><blockquote v-if="openSource === m.id + p.id" class="passage small">{{ p.text }}</blockquote></template>
            <div v-for="s in m.suggestions" :key="s.id" class="suggestion" :class="s.status">
              <div class="spread"><span class="label-caps">{{ KIND[s.kind] }}</span><span v-if="s.status !== 'open'" class="small faint">{{ STATUS[s.status] }}{{ s.by ? ` by ${s.by}` : '' }}</span></div>
              <strong class="small">{{ s.title }}</strong>
              <div class="small">{{ detail(s) }}</div>
              <div v-if="s.why" class="small faint">{{ s.why }}</div>
              <div v-if="s.status === 'failed'" class="small error">{{ s.error }}</div>
              <div v-if="s.status === 'open' || s.status === 'failed'" class="row">
                <button class="btn sm primary" @click="act(m, s, 'apply')">Apply</button>
                <button class="btn sm ghost" @click="act(m, s, 'discard')">Discard</button>
              </div>
            </div>
            <details v-if="m.dropped.length" class="small faint"><summary>{{ m.dropped.length }} thing{{ m.dropped.length === 1 ? '' : 's' }} the harness removed</summary><ul class="plain"><li v-for="d in m.dropped" :key="d">{{ d }}</li></ul></details>
            <div class="small faint">{{ m.runtime === 'live' ? m.model : 'Offline assistant' }}</div>
          </template>
        </div>
        <div v-if="busy" class="msg ai"><span class="small faint">Thinking…</span></div>
      </div>

      <form class="assistant-ask" @submit.prevent="send()">
        <textarea v-model="question" class="textarea" rows="2" :placeholder="app.can('prepare') ? 'Ask a question' : 'Viewers can read but not ask'" :disabled="!app.can('prepare')" aria-label="Your question" @keydown.enter.exact.prevent="send()" />
        <button class="btn primary" :disabled="busy || !app.can('prepare') || question.trim().length < 2">Ask</button>
      </form>
    </aside>
  </template>
</template>
