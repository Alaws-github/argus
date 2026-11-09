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
import ArgusLogo from './ArgusLogo.vue';
import { renderMarkdown } from '../markdown';

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

// Starting points for an empty conversation, by what the person is looking at.
type Starter = { icon: string; title: string; sub: string; q: string };
const PAGE: Starter = { icon: 'overview', title: 'Explain this page', sub: "What's on it and what I can do here", q: "What's on this page, and what can I do here?" };
const STARTERS: Record<string, Starter[]> = {
  card: [
    { icon: 'usecases', title: 'Explain this draft', sub: 'In plain English', q: 'Explain this draft in plain English' },
    { icon: 'controls', title: 'Before I approve', sub: 'What should I check first?', q: 'What should I check before approving?' },
    { icon: 'risks', title: 'Weakest items', sub: 'Which look weakest, and why', q: 'Which items look weakest, and why?' },
  ],
  risks: [PAGE,
    { icon: 'risks', title: 'Needs attention', sub: 'Which risks to look at first', q: 'Which risks need attention first?' },
    { icon: 'controls', title: 'Uncovered risks', sub: 'High risks with no control', q: 'Which high risks have no control?' },
    { icon: 'people', title: 'Missing owners', sub: 'Risks nobody owns yet', q: 'Which risks have no owner?' },
  ],
  controls: [PAGE,
    { icon: 'tests', title: 'Untested controls', sub: 'Controls with no test yet', q: 'Which controls have no test yet?' },
    { icon: 'people', title: 'Missing owners', sub: 'Controls nobody owns yet', q: 'Which controls have no owner?' },
    { icon: 'report', title: 'Summary for a director', sub: 'The control register in brief', q: 'Summarise the control register for a director' },
  ],
  issues: [PAGE,
    { icon: 'issues', title: 'Overdue or severe', sub: 'Issues to chase first', q: 'Which issues are overdue or high severity?' },
    { icon: 'report', title: 'Board summary', sub: 'Open issues in brief', q: 'Summarise open issues for the board' },
  ],
  engagement: [PAGE,
    { icon: 'engagement', title: 'Where we stand', sub: 'This engagement at a glance', q: 'Where does this engagement stand?' },
    { icon: 'runs', title: 'Next steps', sub: 'What the team should do next', q: 'What should the team do next?' },
    { icon: 'knowledge', title: 'EU AI Act tiers', sub: 'Explained in plain English', q: 'Explain the EU AI Act risk tiers in plain English' },
  ],
};
const greeting = computed(() => {
  const h = new Date().getHours();
  const first = (app.user?.name ?? '').split(' ')[0];
  return `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}${first ? `, ${first}` : ''}.`;
});
const wide = ref(false);
const box = ref<HTMLTextAreaElement | null>(null);
// The question box grows with what you type, up to about six lines.
function grow() {
  const el = box.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
}
watch(question, () => nextTick(grow));
const title = computed(() => (a.value.kind === 'card' ? a.value.label : { risks: 'Risk register', controls: 'Controls', issues: 'Issues', engagement: 'This page' }[a.value.kind]));

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

// v1.6: what an answer drew on, and its sources grouped by kind.
const BASIS: Record<string, string> = { page: 'This page', records: 'ARGUS records', knowledge: 'Knowledge base' };
const SOURCE_KIND: Record<string, string> = { framework: 'Frameworks', control: 'Control library', methodology: 'Method guidance', upload: 'Client documents', client: 'Client documents', use_case: 'Use cases', evidence: 'Evidence' };
function sourceGroups(m: AssistantMessage) {
  const groups: Record<string, AssistantMessage['passages']> = {};
  for (const p of m.passages) (groups[SOURCE_KIND[p.kind] ?? 'Other'] ??= []).push(p);
  return Object.entries(groups);
}

async function send(text?: string) {
  const q = (text ?? question.value).trim();
  if (q.length < 2 || busy.value) return;
  busy.value = true;
  question.value = '';
  messages.value.push({ id: 'pending', role: 'user', text: q, citations: [], passages: [], suggestions: [], dropped: [], model: null, runtime: null, basis: [], trail: [], author: app.user?.name ?? '', at: new Date().toISOString() });
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
    <aside class="assistant-panel" :class="{ wide }" role="dialog" aria-label="Assistant" @keydown.esc="listOpen ? (listOpen = false) : (app.assistant.open = false)">
      <header class="ap-head">
        <button class="conv-pick" :aria-expanded="listOpen" aria-haspopup="true" title="Your conversations" @click="toggleList">
          <span class="conv-title">{{ conversation?.title ?? 'New conversation' }}</span><Icon name="chevron" :size="15" />
        </button>
        <div class="ap-tools">
          <button class="ap-icon" title="New conversation" aria-label="New conversation" @click="newConversation"><Icon name="plus" :size="17" /></button>
          <button class="ap-icon hide-phone" :title="wide ? 'Make narrower' : 'Make wider'" :aria-label="wide ? 'Make narrower' : 'Make wider'" @click="wide = !wide"><Icon :name="wide ? 'collapse' : 'expand'" :size="16" /></button>
          <button class="ap-icon" title="Close" aria-label="Close the assistant" @click="app.assistant.open = false"><Icon name="close" :size="17" /></button>
        </div>
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

      <div ref="list" class="ap-list">
        <div v-if="!messages.length" class="ap-empty">
          <ArgusLogo class="ap-logo" />
          <h2>{{ greeting }}</h2>
          <p class="muted">What are we doing today?</p>
          <div class="ap-starters">
            <button v-for="st in STARTERS[a.kind]" :key="st.title" class="ap-starter" :disabled="!app.can('prepare')" @click="send(st.q)">
              <span class="ap-starter-icon"><Icon :name="st.icon" :size="16" /></span>
              <span><strong>{{ st.title }}</strong><span class="small faint">{{ st.sub }}</span></span>
            </button>
          </div>
          <p class="small faint ap-note">I see the page you're on, the records and the knowledge base. Anything I suggest changes nothing until you apply it, under your own name.</p>
        </div>

        <template v-for="m in messages" :key="m.id">
          <div v-if="m.role === 'user'" class="ap-me">{{ m.text }}</div>
          <div v-else class="ap-ai">
            <div class="ap-who">Assistant</div>
            <div class="ap-md" v-html="renderMarkdown(m.text)" />
            <div v-if="m.basis?.length" class="ap-basis small"><span class="faint">Based on</span><span v-for="b in m.basis" :key="b" class="basis-chip">{{ BASIS[b] }}</span></div>
            <div v-for="[label, ps] in sourceGroups(m)" :key="label" class="ap-sources">
              <span class="small faint">{{ label }}</span>
              <button v-for="p in ps" :key="p.id" class="source-chip" :class="{ on: openSource === m.id + p.id }" @click="openSource = openSource === m.id + p.id ? '' : m.id + p.id">{{ p.id }} · {{ p.title.slice(0, 40) }}</button>
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
            <details v-if="m.trail?.length" class="small faint"><summary>How I got here ({{ m.trail.length }} look-up{{ m.trail.length === 1 ? '' : 's' }})</summary><ol class="plain ap-trail"><li v-for="(t, i) in m.trail" :key="i">{{ t }}</li></ol></details>
            <details v-if="m.dropped.length" class="small faint"><summary>{{ m.dropped.length }} thing{{ m.dropped.length === 1 ? '' : 's' }} the harness removed</summary><ul class="plain"><li v-for="d in m.dropped" :key="d">{{ d }}</li></ul></details>
            <div class="ap-meta">{{ m.runtime === 'live' ? m.model : 'Offline assistant' }}</div>
          </div>
        </template>
        <div v-if="busy" class="ap-thinking" role="status"><ArgusLogo class="ap-thinking-logo" /><span>Thinking</span><span class="ap-dots"><i /><i /><i /></span></div>
      </div>

      <form class="ap-compose" @submit.prevent="send()">
        <div class="ap-box">
          <textarea ref="box" v-model="question" rows="1" :placeholder="app.can('prepare') ? 'Ask about this page, a record or a standard' : 'Viewers can read but not ask'" :disabled="!app.can('prepare')" aria-label="Your question" @keydown.enter.exact.prevent="send()" />
          <div class="ap-box-foot">
            <span class="ap-context small" :title="`About: ${title}`"><Icon name="assistant" :size="13" />{{ title }} · {{ model ?? 'offline' }}</span>
            <button class="ap-send" :disabled="busy || !app.can('prepare') || question.trim().length < 2" :aria-label="busy ? 'Waiting for the answer' : 'Send'" :title="busy ? 'Waiting for the answer' : 'Send (Enter)'">
              <span v-if="busy" class="ap-spin" /><Icon v-else name="send" :size="16" />
            </button>
          </div>
        </div>
        <p class="ap-hint small faint">Enter to send, Shift+Enter for a new line</p>
      </form>
    </aside>
  </template>
</template>
