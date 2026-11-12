<script setup lang="ts">
// The assistant: ask about the page, use case or register you're looking at.
// It explains, checks and suggests. Each suggestion is a proposed change you
// apply or discard; applying it runs under your own name and permissions.
// Conversations are kept per person: start a new one, or find an old one and
// carry on. Each question sends the page you're on and the text on screen, so
// "what's on this page?" has an answer.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AssistantConversation, AssistantMessage, AssistantSuggestion } from '@gh/shared';
import { api, socket } from '../api';
import { keyLink } from '../lib/links';
import { useApp } from '../stores/app';
import Icon from './Icon.vue';
import ArgusLogo from './ArgusLogo.vue';
import { renderMarkdown } from '../markdown';

const app = useApp();
const route = useRoute();
const router = useRouter();
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

// v1.7: live steps while it works (sent only to the person asking), shown as
// "Working · N steps" and then folded into "Worked Ns · N steps" above the answer.
type LiveStep = { kind: 'phase' | 'step' | 'thought'; text: string };
const live = ref<{ id: string; phase: string; steps: LiveStep[]; started: number } | null>(null);
const nowTick = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
function onStep(p: { requestId: string } & LiveStep) {
  if (!live.value || p.requestId !== live.value.id) return;
  if (p.kind === 'phase') live.value.phase = p.text;
  else { live.value.steps.push({ kind: p.kind, text: p.text }); live.value.phase = p.kind === 'thought' ? 'Thinking it through' : 'Looking things up'; }
  scroll();
}
onMounted(() => socket.on('assistant:step', onStep));
onBeforeUnmount(() => { socket.off('assistant:step', onStep); if (ticker) clearInterval(ticker); });
const liveSteps = computed(() => live.value?.steps.filter((s) => s.kind === 'step').length ?? 0);
const secs = (ms?: number | null) => (ms == null ? '' : ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);
const lookups = (m: AssistantMessage) => m.trail.filter((t) => !t.startsWith('Thinking: '));
const openTrail = ref('');

// Links in answers go to ARGUS pages without closing the assistant.
const cardKeys = computed(() => new Set(app.cards.map((c) => c.key.toUpperCase())));
const md = (t: string) => renderMarkdown(t, (k) => keyLink(k, cardKeys.value));
function onLinkClick(ev: MouseEvent) {
  const a = (ev.target as HTMLElement).closest<HTMLAnchorElement>('a[data-internal]');
  if (!a || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
  ev.preventDefault();
  void router.push(a.getAttribute('href')!);
  if (window.matchMedia('(max-width: 720px)').matches) app.assistant.open = false;
}

// Thumbs up or down, and copy.
async function rate(m: AssistantMessage, v: 'up' | 'down') {
  const value = m.feedback === v ? null : v;
  try {
    await api(`/engagements/${app.engagementId}/assistant/${m.id}/feedback`, { method: 'POST', body: { value } });
    m.feedback = value;
    if (value) app.toast(value === 'up' ? 'Thanks. Marked as helpful.' : 'Thanks. Marked as not helpful, so it can be checked.');
  } catch (e: any) { app.toast(e.message, 'error'); }
}
async function copy(m: AssistantMessage) {
  try { await navigator.clipboard.writeText(m.text); app.toast('Copied'); } catch { app.toast("Couldn't copy here", 'error'); }
}

// @ to tag a record: use cases on the board, plus risks, controls and issues.
type Tag = { key: string; title: string; kind: string };
const tags = ref<Tag[]>([]);
const tagQuery = ref<string | null>(null);
const tagIndex = ref(0);
async function loadTags() {
  if (tags.value.length) return;
  const out: Tag[] = app.cards.map((c) => ({ key: c.key, title: c.title, kind: 'Use case' }));
  const get = async (path: string, kind: string, key: (x: any) => string) => {
    try { const rows = await api<any[]>(path); for (const x of (Array.isArray(rows) ? rows : (rows as any).rows ?? [])) out.push({ key: key(x), title: x.title, kind }); } catch { /* module off or no access: skip */ }
  };
  await Promise.all([
    get(`/engagements/${app.engagementId}/risks`, 'Risk', (x) => x.key ?? `R-${x.number}`),
    get(`/engagements/${app.engagementId}/controls`, 'Control', (x) => x.key ?? `C-${x.number}`),
    get(`/engagements/${app.engagementId}/issues`, 'Issue', (x) => x.key ?? `I-${x.number}`),
  ]);
  tags.value = out;
}
const tagMatches = computed(() => {
  if (tagQuery.value === null) return [];
  const q = tagQuery.value.toLowerCase();
  return tags.value.filter((t) => !q || t.key.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)).slice(0, 8);
});
function onInput() {
  const el = box.value;
  if (!el) return;
  const before = question.value.slice(0, el.selectionStart ?? question.value.length);
  const m = before.match(/(?:^|\s)@([\w-]{0,20})$/);
  if (m) { tagQuery.value = m[1]; tagIndex.value = 0; void loadTags(); } else tagQuery.value = null;
}
function pickTag(t: Tag) {
  const el = box.value!;
  const pos = el.selectionStart ?? question.value.length;
  const before = question.value.slice(0, pos).replace(/@([\w-]{0,20})$/, `@${t.key} `);
  question.value = before + question.value.slice(pos);
  tagQuery.value = null;
  void nextTick(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
}
function onKey(ev: KeyboardEvent) {
  if (tagQuery.value !== null && tagMatches.value.length) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); tagIndex.value = (tagIndex.value + 1) % tagMatches.value.length; return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); tagIndex.value = (tagIndex.value + tagMatches.value.length - 1) % tagMatches.value.length; return; }
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); pickTag(tagMatches.value[tagIndex.value]); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); tagQuery.value = null; return; }
  }
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void send(); }
}

// v1.6: what an answer drew on, and its sources grouped by kind.
const BASIS: Record<string, string> = { page: 'This page', records: 'ARGUS records', knowledge: 'Knowledge base' };
const SOURCE_KIND: Record<string, string> = { framework: 'Frameworks', control: 'Control library', methodology: 'Method guidance', upload: 'Client documents', client: 'Client documents', use_case: 'Use cases', evidence: 'Evidence' };
function sourceGroups(m: AssistantMessage) {
  const groups: Record<string, AssistantMessage['passages']> = {};
  for (const p of m.passages) (groups[SOURCE_KIND[p.kind] ?? 'Other'] ??= []).push(p);
  return Object.entries(groups);
}

// v1.7.4: rename and delete your conversations; edit one of your questions.
const renaming = ref<{ id: string; title: string } | null>(null);
async function rename() {
  const r = renaming.value!;
  if (!r.title.trim()) return;
  try {
    const c = await api<AssistantConversation>(`${base()}/conversations/${r.id}`, { method: 'PATCH', body: { title: r.title.trim() } });
    if (conversation.value?.id === c.id) conversation.value = c;
    renaming.value = null;
    await loadList();
  } catch (e: any) { app.toast(e.message, 'error'); }
}
async function removeConversation(c: AssistantConversation) {
  if (!confirm(`Delete "${c.title}" and its messages? This can't be undone. The audit log keeps its own record of the questions asked.`)) return;
  try {
    await api(`${base()}/conversations/${c.id}`, { method: 'DELETE' });
    if (conversation.value?.id === c.id) newConversation();
    await loadList();
    listOpen.value = true;
    app.toast('Conversation deleted');
  } catch (e: any) { app.toast(e.message, 'error'); }
}
const editing = ref<string | null>(null); // the id of the question being edited
function editQuestion(m: AssistantMessage) {
  editing.value = m.id;
  question.value = m.text;
  nextTick(() => box.value?.focus());
}
function cancelEdit() { editing.value = null; question.value = ''; }

async function send(text?: string) {
  const q = (text ?? question.value).trim();
  if (q.length < 2 || busy.value) return;
  busy.value = true;
  question.value = '';
  tagQuery.value = null;
  const replaceFrom = editing.value && conversation.value ? editing.value : undefined;
  editing.value = null;
  const kept = replaceFrom ? messages.value.slice(0, messages.value.findIndex((m) => m.id === replaceFrom)) : null;
  const before = [...messages.value];
  if (kept) messages.value = kept;
  messages.value.push({ id: 'pending', role: 'user', text: q, citations: [], passages: [], suggestions: [], dropped: [], model: null, runtime: null, basis: [], trail: [], author: app.user?.name ?? '', at: new Date().toISOString() });
  const requestId = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  live.value = { id: requestId, phase: 'Getting started', steps: [], started: Date.now() };
  ticker = setInterval(() => (nowTick.value = Date.now()), 500);
  scroll();
  try {
    const page = { path: route.fullPath, snapshot: snapshot() };
    const [, reply] = await api(base(), { method: 'POST', body: { kind: a.value.kind, contextId: a.value.contextId, question: q, page, requestId, ...(replaceFrom ? { replaceFrom } : {}), ...(conversation.value ? { conversationId: conversation.value.id } : { newConversation: true }) } });
    await openConversation(reply.conversationId);
  } catch (e: any) {
    messages.value = replaceFrom ? before : messages.value.filter((m) => m.id !== 'pending');
    question.value = q;
    if (replaceFrom) editing.value = replaceFrom;
    app.toast(e.message, 'error');
  } finally {
    busy.value = false;
    live.value = null;
    if (ticker) { clearInterval(ticker); ticker = null; }
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
              <form v-for="c in g.items.filter((x) => renaming?.id === x.id)" :key="'r' + c.id" class="conv-rename" @submit.prevent="rename">
                <input v-model="renaming!.title" class="input" maxlength="120" aria-label="Conversation name" @keydown.esc.stop="renaming = null" />
                <button class="btn primary sm">Save</button><button type="button" class="btn ghost sm" @click="renaming = null">Cancel</button>
              </form>
              <div v-for="c in g.items.filter((x) => renaming?.id !== x.id)" :key="c.id" class="conv-line">
                <button role="menuitem" class="conv-item" :class="{ on: c.id === conversation?.id }" @click="openConversation(c.id)">
                  <span class="conv-row"><span class="conv-name">{{ c.title }}</span><span class="small faint">{{ ago(c.updatedAt) }}</span></span>
                  <span v-if="c.match" class="small faint conv-match">{{ c.match }}</span>
                </button>
                <span class="conv-actions">
                  <button type="button" class="ap-icon" title="Rename" :aria-label="`Rename ${c.title}`" @click.stop="renaming = { id: c.id, title: c.title }"><Icon name="edit" :size="14" /></button>
                  <button type="button" class="ap-icon" title="Delete" :aria-label="`Delete ${c.title}`" @click.stop="removeConversation(c)"><Icon name="trash" :size="14" /></button>
                </span>
              </div>
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
          <div v-if="m.role === 'user'" class="ap-me-wrap" :class="{ editing: editing === m.id }">
            <div class="ap-me">{{ m.text }}</div>
            <button v-if="m.id !== 'pending' && !busy && app.can('prepare')" type="button" class="ap-edit" title="Edit this question" aria-label="Edit this question" @click="editQuestion(m)"><Icon name="edit" :size="13" /></button>
          </div>
          <template v-else>
          <button v-if="m.trail?.length" type="button" class="ap-worked" :aria-expanded="openTrail === m.id" @click="openTrail = openTrail === m.id ? '' : m.id">
            Worked{{ m.workedMs ? ` ${secs(m.workedMs)}` : '' }} · {{ lookups(m).length }} step{{ lookups(m).length === 1 ? '' : 's' }}<Icon name="chevron" :size="13" :class="{ flip: openTrail === m.id }" />
          </button>
          <ol v-if="openTrail === m.id" class="ap-steps">
            <li v-for="(t, i) in m.trail" :key="i" :class="t.startsWith('Thinking: ') ? 'thought' : 'look'">{{ t.startsWith('Thinking: ') ? t.slice(10) : t }}</li>
          </ol>
          <div class="ap-ai">
            <div class="ap-who">Agent</div>
            <div class="ap-md" @click="onLinkClick" v-html="md(m.text)" />
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
            <details v-if="m.dropped.length" class="small faint"><summary>{{ m.dropped.length }} thing{{ m.dropped.length === 1 ? '' : 's' }} the harness removed</summary><ul class="plain"><li v-for="d in m.dropped" :key="d">{{ d }}</li></ul></details>
            <div class="ap-foot">
              <button type="button" class="ap-icon sm" :class="{ on: m.feedback === 'up' }" title="Helpful" aria-label="Helpful" :aria-pressed="m.feedback === 'up'" @click="rate(m, 'up')"><Icon name="thumbup" :size="14" /></button>
              <button type="button" class="ap-icon sm" :class="{ on: m.feedback === 'down' }" title="Not helpful" aria-label="Not helpful" :aria-pressed="m.feedback === 'down'" @click="rate(m, 'down')"><Icon name="thumbdown" :size="14" /></button>
              <button type="button" class="ap-icon sm" title="Copy the answer" aria-label="Copy the answer" @click="copy(m)"><Icon name="copy" :size="14" /></button>
              <span class="ap-meta">{{ m.runtime === 'live' ? m.model : 'Offline assistant' }}</span>
            </div>
          </div>
          </template>
        </template>
        <div v-if="busy && live" class="ap-live" role="status" aria-live="polite">
          <div class="ap-worked live">Working · {{ liveSteps }} step{{ liveSteps === 1 ? '' : 's' }} · {{ secs(nowTick - live.started) }}</div>
          <ol v-if="live.steps.length" class="ap-steps">
            <li v-for="(t, i) in live.steps" :key="i" :class="t.kind === 'thought' ? 'thought' : 'look'">{{ t.text }}</li>
          </ol>
          <div class="ap-phase"><ArgusLogo class="ap-thinking-logo" /><span>{{ live.phase }}</span><span class="ap-dots"><i /><i /><i /></span></div>
        </div>
      </div>

      <div v-if="editing" class="ap-editing small"><span>Editing your question. Sending replaces it and every answer after it.</span><button type="button" class="linklike" @click="cancelEdit">Cancel</button></div>
      <form class="ap-compose" @submit.prevent="send()">
        <div class="ap-box">
          <ul v-if="tagQuery !== null && tagMatches.length" class="ap-tags" role="listbox" aria-label="Tag a record">
            <li class="ap-tags-head">Tag a record</li>
            <li v-for="(t, i) in tagMatches" :key="t.key" role="option" :aria-selected="i === tagIndex" :class="{ on: i === tagIndex }" @mousedown.prevent="pickTag(t)">
              <span class="mono">{{ t.key }}</span><span class="grow">{{ t.title }}</span><span class="faint small">{{ t.kind }}</span>
            </li>
            <li class="ap-tags-foot faint">↑ ↓ to move · Enter to choose · Esc to close</li>
          </ul>
          <textarea ref="box" v-model="question" rows="1" :placeholder="app.can('prepare') ? 'Ask about this page, or type @ to tag a use case, risk or control' : 'Viewers can read but not ask'" :disabled="!app.can('prepare')" aria-label="Your question" @keydown="onKey" @input="onInput" @click="onInput" />
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
<style scoped>
.conv-line { display: flex; align-items: stretch; gap: 2px; }
.conv-line .conv-item { flex: 1; min-width: 0; }
.conv-actions { display: flex; align-items: center; opacity: 0.55; }
.conv-line:hover .conv-actions, .conv-line:focus-within .conv-actions { opacity: 1; }
.conv-rename { display: flex; gap: 6px; padding: 4px 6px; }
.conv-rename .input { flex: 1; min-width: 0; }
.ap-editing { display: flex; justify-content: space-between; gap: 8px; padding: 6px 14px; color: var(--accent-text); border-top: 1px solid var(--line); }
.ap-me-wrap { align-self: flex-end; max-width: 85%; display: flex; align-items: flex-start; gap: 4px; flex-direction: row-reverse; }
.ap-me-wrap .ap-me { max-width: 100%; }
.ap-me-wrap.editing .ap-me { outline: 2px solid var(--accent-line); }
.ap-edit { opacity: 0; background: none; border: 0; color: var(--faint); cursor: pointer; padding: 6px; border-radius: 8px; }
.ap-me-wrap:hover .ap-edit, .ap-edit:focus-visible { opacity: 1; }
@media (hover: none) { .ap-edit { opacity: 0.7; } .conv-actions { opacity: 1; } }
</style>
