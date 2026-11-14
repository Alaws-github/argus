<script setup lang="ts">
// Plan a use case: where every use case starts. By default the Use Case
// Planner (an agent) talks it through and drafts the brief; the person edits
// the brief and adds it to Intake under their own name. "Fill it in myself"
// skips the chat. Drafts are kept, like GoldenEye's plan drafts.
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CATEGORY_LABELS, PLAN_FIELDS, PRIORITY_LABELS, type Plan, type PlanBrief } from '@gh/shared';
import { useApp } from '../../stores/app';
import { api, ago } from '../../api';
import { renderMarkdown } from '../../lib/markdown';

const app = useApp();
const route = useRoute();
const router = useRouter();
const plans = ref<Plan[]>([]);
const planner = ref<{ on: boolean; name?: string; model?: string; runtime?: 'rules' | 'live' }>({ on: false });
const plan = ref<Plan | null>(null);
const text = ref('');
const sending = ref(false);
const adding = ref(false);
const chatEl = ref<HTMLElement | null>(null);
const brief = reactive<PlanBrief>({
  title: '',
  businessOwner: '',
  description: '',
  dataUsed: '',
  affectedPeople: '',
  autonomy: 'human_in_loop',
  vendor: '',
  category: 'other',
  priority: 'p2',
});

const AUTONOMY = {
  assistive: 'Assistive: a person does the work',
  human_in_loop: 'A person approves each output',
  human_on_loop: 'Acts, a person monitors',
  autonomous: 'Fully autonomous',
} as const;

async function loadList() {
  const r = await api<{ plans: Plan[]; planner: typeof planner.value }>(`/engagements/${app.engagementId}/plans`);
  plans.value = r.plans;
  planner.value = r.planner;
}
function show(p: Plan) {
  plan.value = p;
  Object.assign(brief, p.brief);
  const i = plans.value.findIndex((x) => x.id === p.id);
  if (i >= 0) plans.value.splice(i, 1, p);
  else plans.value.unshift(p);
  void nextTick(() => chatEl.value?.scrollTo({ top: chatEl.value.scrollHeight }));
}
async function newPlan(mode: 'ai' | 'manual' = 'ai') {
  const p = await api<Plan>(`/engagements/${app.engagementId}/plans`, { method: 'POST', body: { mode } });
  show(p);
  router.replace(`/plan/${p.id}`);
}
async function open(id: string) {
  show(await api<Plan>(`/plans/${id}`));
  if (route.params.id !== id) router.replace(`/plan/${id}`);
}

onMounted(async () => {
  if (!app.engagementId) await app.init();
  await loadList();
  if (route.params.id) await open(String(route.params.id)).catch(() => newPlan());
  else if (route.query.new) await newPlan();
  else {
    const draft = plans.value.find((p) => p.status === 'draft');
    if (draft) await open(draft.id);
    else await newPlan();
  }
});
watch(
  () => route.query.new,
  (n) => n && void newPlan(),
);

const editable = computed(() => plan.value?.status === 'draft' && plan.value.createdBy === app.user?.name);
const aiMode = computed(() => plan.value?.mode === 'ai' && planner.value.on);
const drafted = (k: string) =>
  aiMode.value &&
  plan.value &&
  !plan.value.edited.includes(k) &&
  String((plan.value.brief as any)[k] ?? '').trim() !== '' &&
  plan.value.messages.some((m) => m.role === 'user');
const missing = computed(() =>
  PLAN_FIELDS.filter((f) => f.required && !String((brief as any)[f.key] ?? '').trim()).map((f) => f.label),
);

async function send() {
  const t = text.value.trim();
  if (!t || !plan.value || sending.value) return;
  sending.value = true;
  // Show the person's message at once; the Planner's reply follows.
  plan.value.messages.push({ role: 'user', text: t, at: new Date().toISOString(), author: app.user!.name });
  text.value = '';
  void nextTick(() => chatEl.value?.scrollTo({ top: chatEl.value.scrollHeight }));
  try {
    show(await api<Plan>(`/plans/${plan.value.id}/messages`, { method: 'POST', body: { text: t } }));
  } catch (e: any) {
    app.toast(e.message, 'error');
    show(await api<Plan>(`/plans/${plan.value.id}`));
  } finally {
    sending.value = false;
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
}

// Save one field when the person leaves it; it becomes theirs.
async function saveField(k: keyof PlanBrief) {
  if (!plan.value || !editable.value || (plan.value.brief as any)[k] === (brief as any)[k]) return;
  try {
    show(await api<Plan>(`/plans/${plan.value.id}`, { method: 'PATCH', body: { brief: { [k]: brief[k] } } }));
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function setMode(mode: 'ai' | 'manual') {
  if (!plan.value || plan.value.mode === mode) return;
  if (mode === 'ai' && !planner.value.on)
    return app.toast(
      'The Use Case Planner is switched off for this engagement. A lead can turn it on in Settings > Agents.',
      'error',
    );
  show(await api<Plan>(`/plans/${plan.value.id}`, { method: 'PATCH', body: { mode } }));
}
async function addToIntake() {
  if (!plan.value) return;
  adding.value = true;
  try {
    const r = await api<{ plan: Plan; card: { key: string } }>(`/plans/${plan.value.id}/add`, { method: 'POST' });
    show(r.plan);
    app.toast(`${r.card.key} added to Intake. Someone else takes it forward.`);
    router.push({ path: '/', query: { card: r.card.key } });
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    adding.value = false;
  }
}
async function remove() {
  if (!plan.value || !window.confirm('Delete this draft?')) return;
  await api(`/plans/${plan.value.id}`, { method: 'DELETE' });
  plans.value = plans.value.filter((p) => p.id !== plan.value!.id);
  const next = plans.value.find((p) => p.status === 'draft');
  if (next) await open(next.id);
  else await newPlan();
}
const label = (p: Plan) =>
  p.brief.title || (p.messages.find((m) => m.role === 'user')?.text.slice(0, 40) ?? 'New plan');
</script>

<template>
  <div class="page plan-page">
    <div class="page-head">
      <div>
        <h1>Add a use case</h1>
        <p v-if="aiMode"
          >Talk it through with the {{ planner.name ?? 'Use Case Planner' }}. It asks a few questions and drafts a brief
          you can edit; then you add it to Intake.</p
        >
        <p v-else>Fill in the brief yourself, then add it to Intake.</p>
      </div>
      <div class="segmented" role="radiogroup" aria-label="How to fill the brief">
        <button
          role="radio"
          :aria-checked="plan?.mode === 'ai'"
          :class="{ on: plan?.mode === 'ai' && planner.on }"
          :disabled="!editable"
          @click="setMode('ai')"
          ><span class="seg-ai">AI</span>Plan with AI</button
        >
        <button
          role="radio"
          :aria-checked="plan?.mode === 'manual'"
          :class="{ on: plan?.mode === 'manual' || !planner.on }"
          :disabled="!editable"
          @click="setMode('manual')"
          >Fill it in myself</button
        >
      </div>
    </div>

    <div class="plan-grid" :class="{ manual: !aiMode }">
      <aside class="plan-drafts">
        <div class="spread"
          ><span class="label-caps">Drafts</span><button class="btn sm" @click="newPlan()">+ New plan</button></div
        >
        <button
          v-for="p in plans"
          :key="p.id"
          class="draft-item"
          :class="{ selected: p.id === plan?.id }"
          @click="open(p.id)"
        >
          <span class="clip" style="display: block">{{ label(p) }}</span>
          <span class="small faint">{{
            p.status === 'added' ? `Added as ${p.cardKey ?? 'a card'}` : `Draft · ${ago(p.updatedAt)} ago`
          }}</span>
        </button>
      </aside>

      <section v-if="aiMode && plan" class="card plan-chat">
        <div class="spread">
          <div class="row"
            ><span class="agent-mark">UP</span
            ><div
              ><strong>{{ planner.name }}</strong
              ><span class="small faint mono" style="display: block">{{
                planner.runtime === 'live' ? planner.model : 'offline rules'
              }}</span></div
            ></div
          >
          <span
            v-if="planner.runtime !== 'live'"
            class="badge warn"
            title="Pick a model for the Use Case Planner in Settings > Agents"
            >Offline</span
          >
        </div>
        <div ref="chatEl" class="chat-log" aria-live="polite">
          <div v-for="(m, i) in plan.messages" :key="i" class="msg" :class="m.role === 'planner' ? 'ai' : 'me'">
            <span class="small faint">{{ m.role === 'planner' ? m.author : 'You' }}</span>
            <div class="ap-md plan-md" v-html="renderMarkdown(m.text)" />
          </div>
          <div v-if="sending" class="msg ai"
            ><span class="small faint">{{ planner.name }}</span
            ><p class="pulse">Thinking…</p></div
          >
        </div>
        <form v-if="editable" class="chat-input" @submit.prevent="send">
          <textarea
            v-model="text"
            class="textarea"
            rows="2"
            :placeholder="
              plan.messages.some((m) => m.role === 'user')
                ? 'Answer, or ask for a change'
                : 'Describe the use case: what it does and who it affects'
            "
            :disabled="sending"
            @keydown="onKey"
          />
          <button class="btn primary" :disabled="sending || !text.trim()">Send</button>
        </form>
        <p v-else class="small faint">This plan is on the board as {{ plan.cardKey }}.</p>
      </section>

      <section v-if="plan" class="card plan-brief">
        <div class="spread">
          <h2>Brief</h2>
          <span class="small faint">{{
            editable
              ? 'Saved'
              : plan.status === 'added'
                ? `On the board as ${plan.cardKey}`
                : `${plan.createdBy}'s draft`
          }}</span>
        </div>
        <fieldset class="bare stack" style="gap: 10px" :disabled="!editable">
          <label class="field"
            ><span>Name <span v-if="drafted('title')" class="ai-tag">AI</span></span
            ><input
              v-model="brief.title"
              class="input"
              placeholder="Loan pre-approval scoring"
              @blur="saveField('title')"
          /></label>
          <label class="field"
            ><span>What it does <span v-if="drafted('description')" class="ai-tag">AI</span></span
            ><textarea
              v-model="brief.description"
              class="textarea"
              rows="3"
              placeholder="What the AI does, who acts on its output, how often"
              @blur="saveField('description')"
            />
          </label>
          <label class="field"
            ><span>Business owner <span v-if="drafted('businessOwner')" class="ai-tag">AI</span></span
            ><input
              v-model="brief.businessOwner"
              class="input"
              placeholder="Head of Retail Credit"
              @blur="saveField('businessOwner')"
          /></label>
          <label class="field"
            ><span>Data it uses <span v-if="drafted('dataUsed')" class="ai-tag">AI</span></span
            ><textarea
              v-model="brief.dataUsed"
              class="textarea"
              rows="2"
              placeholder="Every data source. Say if any of it identifies a person."
              @blur="saveField('dataUsed')"
            />
          </label>
          <label class="field"
            ><span>People affected <span v-if="drafted('affectedPeople')" class="ai-tag">AI</span></span
            ><input
              v-model="brief.affectedPeople"
              class="input"
              placeholder="Who sees its output or is decided about"
              @blur="saveField('affectedPeople')"
          /></label>
          <label class="field">
            <span>Autonomy <span v-if="drafted('autonomy')" class="ai-tag">AI</span></span>
            <select v-model="brief.autonomy" class="select" @change="saveField('autonomy')"
              ><option v-for="(l, k) in AUTONOMY" :key="k" :value="k">{{ l }}</option></select
            >
          </label>
          <div class="grid" style="grid-template-columns: 1fr 1fr">
            <label class="field">
              <span
                >Kind of AI
                <span v-if="drafted('category') && brief.category !== 'other'" class="ai-tag">AI</span></span
              >
              <select v-model="brief.category" class="select" @change="saveField('category')"
                ><option v-for="(l, k) in CATEGORY_LABELS" :key="k" :value="k">{{ l }}</option></select
              >
            </label>
            <label class="field"
              ><span>Vendor or model <span v-if="drafted('vendor')" class="ai-tag">AI</span></span
              ><input
                v-model="brief.vendor"
                class="input"
                placeholder="In-house, or the vendor"
                @blur="saveField('vendor')"
            /></label>
          </div>
          <div class="field">
            <span>Priority</span>
            <div class="segmented" role="radiogroup" aria-label="Priority">
              <button
                v-for="(l, k) in PRIORITY_LABELS"
                :key="k"
                type="button"
                role="radio"
                :aria-checked="brief.priority === k"
                :class="{ on: brief.priority === k }"
                @click="
                  brief.priority = k;
                  saveField('priority');
                "
                >{{ l }}</button
              >
            </div>
          </div>
        </fieldset>
        <details class="small">
          <summary>What the agents receive</summary>
          <p class="muted"
            >After a reviewer or lead takes it forward from Intake, the Risk Classifier reads this brief, the engagement
            description and the knowledge-base passages that match it, and drafts a risk tier and starting risks for a
            person to decide.</p
          >
        </details>
        <p v-if="editable && missing.length" class="small" style="color: var(--warn)"
          >Still needed: {{ missing.join(', ') }}</p
        >
        <div v-if="editable" class="row" style="flex-wrap: wrap">
          <button class="btn primary" :disabled="adding || missing.length > 0" @click="addToIntake">{{
            adding ? 'Adding…' : 'Add to Intake'
          }}</button>
          <span class="grow" />
          <button class="btn ghost danger" @click="remove">Delete draft</button>
        </div>
        <p v-if="editable" class="small faint"
          >It goes to Intake under your name. Someone else decides whether it goes forward.</p
        >
      </section>
    </div>
  </div>
</template>
