<script setup lang="ts">
// The assistant: ask about the use case or register you're looking at. It
// explains, checks and suggests. Each suggestion is a proposed change you
// apply or discard; applying it runs under your own name and permissions.
import { computed, nextTick, ref, watch } from 'vue';
import type { AssistantMessage, AssistantSuggestion } from '@gh/shared';
import { api } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const messages = ref<AssistantMessage[]>([]);
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
  engagement: ['Where does this engagement stand?', 'What should the team do next?', 'Explain the EU AI Act tiers in plain English'],
};
const title = computed(() => (a.value.kind === 'card' ? a.value.label : { risks: 'Risk register', controls: 'Controls', issues: 'Issues', engagement: app.engagement?.name ?? 'This engagement' }[a.value.kind]));

async function load() {
  if (!a.value.open || !app.engagementId) return;
  const r = await api(`/engagements/${app.engagementId}/assistant?kind=${a.value.kind}&contextId=${encodeURIComponent(a.value.contextId)}`).catch(() => null);
  messages.value = r?.messages ?? [];
  model.value = r?.model ?? null;
  scroll();
}
watch(() => [a.value.open, a.value.kind, a.value.contextId, app.engagementId], load, { immediate: true });
const scroll = () => nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight }));

async function send(text?: string) {
  const q = (text ?? question.value).trim();
  if (q.length < 2 || busy.value) return;
  busy.value = true;
  question.value = '';
  messages.value.push({ id: 'pending', role: 'user', text: q, citations: [], passages: [], suggestions: [], dropped: [], model: null, runtime: null, author: app.user?.name ?? '', at: new Date().toISOString() });
  scroll();
  try {
    await api(`/engagements/${app.engagementId}/assistant`, { method: 'POST', body: { kind: a.value.kind, contextId: a.value.contextId, question: q } });
    await load();
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
  await load();
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
        <div class="grow">
          <strong>Assistant</strong>
          <div class="small faint">About: {{ title }} · {{ model ?? 'offline (no model set)' }}</div>
        </div>
        <button class="btn ghost sm" aria-label="Close the assistant" @click="app.assistant.open = false">✕</button>
      </header>

      <div ref="list" class="assistant-list">
        <div v-if="!messages.length" class="stack" style="gap: 8px">
          <p class="small muted">Ask about {{ a.kind === 'card' ? 'this use case' : 'this page' }}. Answers draw on the record and the knowledge base. Anything the assistant suggests changes nothing until you apply it, under your own name.</p>
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
