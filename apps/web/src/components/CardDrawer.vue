<script setup lang="ts">
// The side panel for one use case: whatever decision it is waiting for (triage,
// classification, control design, an agent draft, a manual sign-off), its exit
// criteria, risks, controls, profile, runs and activity.
import ClientSteps from './ClientSteps.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AGENT_ROLES,
  DRAFT_STAGES,
  OVERSIGHT_LABELS,
  STAGE_LABELS,
  TIER_LABELS,
  riskRating,
  riskScore,
  type AgentQuestion,
  type AuditEntry,
  type Card,
  type Risk,
  type Run,
} from '@gh/shared';
import { api, ago, money, socket } from '../api';
import { useApp } from '../stores/app';
import StatusPill from './StatusPill.vue';
import DraftItem, { type EditField } from './DraftItem.vue';
import VerifierBar from './VerifierBar.vue';
import { draftProgress } from '../lib/drafts';

const props = defineProps<{ cardKey: string }>();
// v1.7.4: say which model drafted it in words; the offline rules aren't an AI model.
const modelWords = (m?: string | null) => (!m ? 'an agent' : /^rules/.test(m) ? 'the built-in rules (no AI model)' : m);
const emit = defineEmits<{ close: [] }>();
const app = useApp();

const card = ref<Card | null>(null);
const runs = ref<Run[]>([]);
const risks = ref<Risk[]>([]);
const activity = ref<AuditEntry[]>([]);
const controls = ref<
  {
    id: string;
    key: string;
    title: string;
    status: string;
    owner: string;
    libraryCode: string | null;
    tests: number;
    evidence: number;
  }[]
>([]);
const exit = ref<{ required: string[]; unmet: string[] }>({ required: [], unmet: [] });
const note = ref('');
const busy = ref(false);
const error = ref('');
const questions = ref<AgentQuestion[]>([]);
const answer = ref('');

async function load() {
  try {
    const d = await api(`/cards/${props.cardKey}`);
    card.value = d.card;
    runs.value = d.runs;
    risks.value = d.risks;
    activity.value = d.activity;
    controls.value = d.controls ?? [];
    exit.value = d.exitCriteria ?? { required: [], unmet: [] };
    questions.value = d.questions ?? [];
  } catch (e: any) {
    error.value = e.message;
  }
}

function onCard(c: Card) {
  if (c.key === props.cardKey) void load();
}
// v1.7: while an agent runs, its steps show live on the use case.
const liveEvents = ref<{ id: number; kind: string; text: string }[]>([]);
let liveRun = '';
async function watchRun() {
  const c = card.value;
  const runId = c?.status === 'running' ? c.latestRunId : null;
  if (!runId) {
    liveRun = '';
    liveEvents.value = [];
    return;
  }
  if (runId === liveRun) return;
  liveRun = runId;
  try {
    liveEvents.value = ((await api(`/runs/${runId}`)) as any).events.filter((e: any) => e.kind !== 'error');
  } catch {
    liveEvents.value = [];
  }
}
function onRunEvent(e: { runId: string; id: number; kind: string; text: string }) {
  if (e.runId !== liveRun || e.kind === 'error' || liveEvents.value.some((x) => x.id === e.id)) return;
  liveEvents.value.push(e);
}
watch(
  () => [card.value?.status, card.value?.latestRunId],
  () => void watchRun(),
);
const liveSteps = computed(() => liveEvents.value.filter((e) => e.kind === 'step').length);
onMounted(() => {
  void load();
  socket.on('card', onCard);
  socket.on('run:event', onRunEvent);
});
// Reload after the assistant applies a change to this card.
const onApplied = () => void load();
window.addEventListener('gh:assistant-applied', onApplied);
onBeforeUnmount(() => {
  socket.off('card', onCard);
  socket.off('run:event', onRunEvent);
  window.removeEventListener('gh:assistant-applied', onApplied);
});
watch(
  () => props.cardKey,
  () => void load(),
);

const hasAgent = computed(() => !!card.value && app.agentStages.includes(card.value.stage));
const gated = computed(() => !!card.value && !!app.engagement?.gates[card.value.stage]);
const mode = computed(() => {
  const c = card.value;
  if (!c) return 'loading';
  if (c.stage === 'closed') return 'closed';
  if (c.stage === 'intake') return 'triage';
  if (c.status === 'needs_approval') return 'review';
  if (c.status === 'question') return 'question';
  if (c.status === 'failed') return 'failed';
  if (c.status === 'running' || c.status === 'queued') return 'working';
  if (!hasAgent.value) return 'manual';
  return 'idle';
});

async function act(action: string, requireNote = false) {
  error.value = '';
  if (requireNote && !note.value.trim()) {
    error.value = 'Say what to change, so the agent can address it.';
    return;
  }
  busy.value = true;
  try {
    await api(`/cards/${card.value!.id}/actions`, {
      method: 'POST',
      body: { action, note: note.value.trim() || undefined },
    });
    note.value = '';
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

// An agent's question (v1.6): answered or skipped by anyone who can prepare work.
const openQuestion = computed(() => questions.value.find((q) => q.status === 'open') ?? null);
const pastQuestions = computed(() => questions.value.filter((q) => q.status !== 'open'));
const ASKED_OF: Record<string, string> = {
  business_owner: 'the business owner',
  reviewer: 'a reviewer',
  preparer: 'a preparer',
};
async function reply(verb: 'answer' | 'skip') {
  const q = openQuestion.value;
  if (!q) return;
  error.value = '';
  if (verb === 'answer' && !answer.value.trim()) {
    error.value = 'Write an answer, or skip the question.';
    return;
  }
  busy.value = true;
  try {
    await api(`/cards/${card.value!.id}/questions/${q.id}/${verb}`, {
      method: 'POST',
      body: verb === 'answer' ? { answer: answer.value.trim() } : {},
    });
    answer.value = '';
    app.toast(
      verb === 'answer'
        ? 'Answer sent. The agent picks the work up again.'
        : 'Skipped. The agent carries on with what it has.',
    );
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

const agentName = computed(
  () => Object.values(AGENT_ROLES).find((a) => a.stage === card.value?.stage)?.name ?? 'agent',
);
const drafting = computed(() => !!card.value && DRAFT_STAGES.includes(card.value.stage) && mode.value === 'review');
const draft = computed<any>(() => (card.value ? (card.value.drafts as any)?.[card.value.stage] : null));
const DRAFT_ASK: Record<string, string> = {
  evidence:
    'collect what is still missing from the client, then move on. The list is a guide; the checks before it can move on decide when every control has evidence.',
  test: 'nothing here directly. A preparer concludes each test on the Testing page, starting from the draft if it holds up; someone else reviews it.',
  validate:
    'weigh each challenge. Accept it if you agree and it has been dealt with; reject it if it does not apply, saying why. Then sign off.',
  report:
    'whether this summary is right for the board. Edit it if needed; only a summary you approve goes into the readiness report.',
};
const DRAFT_HEADLINE = computed(() => {
  const c = card.value;
  const d: any = draft.value;
  if (!c || !d) return '';
  if (c.stage === 'evidence')
    return `The Evidence Collector lists ${d.requests.length} items to collect, ${d.requests.filter((r: any) => r.status !== 'received').length} still needed`;
  if (c.stage === 'test') return `The Control Tester drafted results for ${d.count} tests`;
  if (c.stage === 'validate')
    return `The Review assistant raises ${d.challenges.length} challenges, ${d.challenges.filter((x: any) => x.severity === 'high').length} high`;
  return 'The Report Writer drafted the board summary';
});
const canApprove = computed(() => app.can('approve'));
const progress = computed(() => (card.value ? draftProgress(card.value) : { total: 0, decided: 0 }));
const decisionsHere = computed<Record<string, any>>(() => (card.value?.decisions as any)?.[card.value!.stage] ?? {});
const lastModel = computed(
  () => runs.value.find((r) => r.stage === card.value?.stage)?.model ?? draft.value?.model ?? '',
);
const passagesHere = computed<any[]>(() => {
  const c = card.value;
  if (!c) return [];
  if (c.stage === 'classify') return c.classification?.sourcePassages ?? [];
  if (c.stage === 'design') return c.design?.sourcePassages ?? [];
  return (c.drafts as any)?.[c.stage]?.sourcePassages ?? [];
});

// A reviewer's decision on one item of the draft, or "accept the rest".
async function decide(
  item: string | null,
  decision?: 'accept' | 'edit' | 'reject',
  edit?: Record<string, unknown>,
  reason?: string,
) {
  error.value = '';
  try {
    await api(`/cards/${card.value!.id}/decisions`, {
      method: 'POST',
      body: item ? { item, decision, edit, reason } : { rest: 'accept' },
    });
    await load();
  } catch (e: any) {
    error.value = e.message;
  }
}

const LEVELS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
const RISK_FIELDS: EditField[] = [
  { key: 'title', label: 'Risk', type: 'text' },
  { key: 'likelihood', label: 'Likelihood (1-5)', type: 'select', options: LEVELS },
  { key: 'impact', label: 'Impact (1-5)', type: 'select', options: LEVELS },
];
const TIER_FIELDS: EditField[] = [
  {
    key: 'tier',
    label: 'Tier',
    type: 'select',
    options: Object.entries(TIER_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    key: 'oversight',
    label: 'Oversight',
    type: 'select',
    options: Object.entries(OVERSIGHT_LABELS).map(([value, label]) => ({ value, label })),
  },
];
const CONTROL_FIELDS: EditField[] = [
  { key: 'title', label: 'Control', type: 'text' },
  { key: 'owner', label: 'Owner', type: 'text' },
  { key: 'objective', label: 'Objective', type: 'textarea' },
];
const SUMMARY_FIELDS: EditField[] = [
  { key: 'headline', label: 'Headline', type: 'text' },
  { key: 'summary', label: 'Summary', type: 'textarea' },
];
// The Verifier's verdict on one item of the current draft, if it has checked it.
const verdictOf = (item: string) =>
  (card.value?.verification as any)?.[card.value!.stage]?.items.find((v: any) => v.item === item);
const editedOr = (item: string, base: Record<string, unknown>) => ({
  ...base,
  ...(decisionsHere.value[item]?.edit ?? {}),
});
const ownCard = computed(() => !!card.value?.createdBy && card.value.createdBy === app.user?.name);

const autonomyLabel: Record<string, string> = {
  assistive: 'Assistive',
  human_in_loop: 'A person approves each output',
  human_on_loop: 'Acts, a person monitors',
  autonomous: 'Fully autonomous',
};
const actionLabel = (a: string) =>
  ({
    'card.created': 'Added',
    'gate.approved': 'Approved',
    'gate.changes_requested': 'Requested changes',
    'card.moved': 'Moved on',
    'card.rejected': 'Not taken forward',
    'run.started': 'Run started',
    'run.succeeded': 'Run succeeded',
    'run.failed': 'Run failed',
    'run.retried': 'Retried',
    'agent.asked': 'Agent asked a question',
    'agent.answered': 'Answered the agent',
    'agent.question_skipped': "Skipped the agent's question",
    'gate.blocked': 'Stopped: something was missing',
  })[a] ?? a;
</script>

<template>
  <div class="backdrop" @click="emit('close')" />
  <aside
    class="panel"
    role="dialog"
    :aria-label="card ? `${card.key} ${card.title}` : 'Use case'"
    @keydown.esc="emit('close')"
  >
    <div v-if="!card" class="muted">{{ error || 'Loading…' }}</div>
    <template v-else>
      <div class="spread">
        <div class="row">
          <span class="mono faint">{{ card.key }}</span>
          <span v-if="card.tier" class="tier" :class="card.tier">{{ TIER_LABELS[card.tier] }}</span>
          <StatusPill :card="card" />
        </div>
        <div class="row" style="gap: 6px">
          <button
            class="btn sm ask-ai"
            title="Ask the assistant about this use case"
            @click="app.openAssistant('card', card.id, `${card.key} ${card.title}`)"
            ><span class="ai-mark" style="font-size: 10px; padding: 1px 4px">AI</span>Ask about this</button
          >
          <button class="btn ghost sm" aria-label="Close" @click="emit('close')">✕</button>
        </div>
      </div>
      <div>
        <h1 style="font-size: 19px">{{ card.title }}</h1>
        <p class="small muted" style="margin-top: 4px">
          Stage {{ STAGE_LABELS[card.stage] }} · {{ ago(card.stageEnteredAt) }} here · AI spend
          {{ money(card.costUsd) }}
        </p>
      </div>

      <!-- Gate panels -->
      <div v-if="mode === 'triage'" class="notice warn">
        <h3>Take this use case forward?</h3>
        <p class="small">Approving sends it to the Risk Classifier. Not taking it forward closes it with your note.</p>
        <textarea v-model="note" class="textarea" placeholder="Note for the record (optional)" />
        <div v-if="canApprove && !ownCard" class="row">
          <button class="btn primary" :disabled="busy" @click="act('approve')">Send to classification</button>
          <button class="btn" :disabled="busy" @click="act('reject')">Don't take forward</button>
        </div>
        <p v-else class="small faint">{{
          ownCard
            ? 'You added this use case, so someone else decides whether to take it forward.'
            : 'A reviewer or lead decides this.'
        }}</p>
      </div>

      <div v-else-if="mode === 'review' && card.stage === 'classify' && card.classification" class="ai-draft">
        <div class="ai-draft-head">
          <span class="ai-mark">AI</span>
          <div class="grow">
            <h3
              >The Risk Classifier proposes: {{ TIER_LABELS[card.classification.tier] }} risk,
              {{ card.classification.risks.length }} starting risks</h3
            >
            <p class="small muted"
              >Drafted by {{ modelWords(lastModel) }} from the use case profile and {{ passagesHere.length }} passages
              from the knowledge base (frameworks, library controls, ARGUS's method and the client's documents).</p
            >
          </div>
        </div>
        <div class="decide-box">
          <strong>What you decide:</strong> is the tier right, and which risks belong in the register? Accept, edit or
          reject each one. Only what you keep is added, owned by
          {{ card.useCase.businessOwner || 'the business owner' }}.
        </div>
        <div class="stack" style="gap: 4px">
          <div class="spread small"
            ><span>{{ progress.decided }} of {{ progress.total }} decided</span
            ><button v-if="canApprove && progress.decided < progress.total" class="btn sm ghost" @click="decide(null)"
              >Accept the rest</button
            ></div
          >
          <div class="progress"
            ><i :style="{ width: `${progress.total ? (progress.decided / progress.total) * 100 : 0}%` }"
          /></div>
        </div>
        <VerifierBar :card="card" @checked="load" />

        <span class="label-caps">Tier and oversight</span>
        <DraftItem
          :title="`${TIER_LABELS[editedOr('tier', { tier: card.classification.tier }).tier as keyof typeof TIER_LABELS]} risk · ${OVERSIGHT_LABELS[editedOr('tier', { oversight: card.classification.oversight }).oversight as keyof typeof OVERSIGHT_LABELS]}`"
          :meta="card.classification.factors.join(' · ')"
          :why="`${card.classification.tierRationale} ${card.classification.oversightRationale}`"
          :sources="card.classification.tierSources"
          :passages="passagesHere"
          :decision="decisionsHere.tier"
          :can-decide="canApprove"
          :fields="TIER_FIELDS"
          :values="{ tier: card.classification.tier, oversight: card.classification.oversight }"
          no-reject
          :verdict="verdictOf('tier')"
          @decide="(d, e, r) => decide('tier', d, e, r)"
        />
        <span class="label-caps">Risks for the register</span>
        <DraftItem
          v-for="(r, i) in card.classification.risks"
          :key="i"
          :title="String(editedOr(`risk:${i}`, r).title)"
          :meta="`${r.category.replace('_', ' ')} · likelihood ${editedOr(`risk:${i}`, r).likelihood} × impact ${editedOr(`risk:${i}`, r).impact} = ${Number(editedOr(`risk:${i}`, r).likelihood) * Number(editedOr(`risk:${i}`, r).impact)}`"
          :why="r.rationale"
          :sources="r.sources"
          :passages="passagesHere"
          :decision="decisionsHere[`risk:${i}`]"
          :can-decide="canApprove"
          :fields="RISK_FIELDS"
          :values="{ title: r.title, likelihood: r.likelihood, impact: r.impact }"
          :verdict="verdictOf(`risk:${i}`)"
          @decide="(d, e, rs) => decide(`risk:${i}`, d, e, rs)"
        />
        <div v-if="card.classification.openQuestions.length" class="small"
          ><strong>Questions for the business owner</strong
          ><ul class="plain"
            ><li v-for="q in card.classification.openQuestions" :key="q">{{ q }}</li></ul
          ></div
        >

        <textarea
          v-model="note"
          class="textarea"
          style="min-height: 60px"
          placeholder="Note for the record, or what the Risk Classifier should reconsider (needed to run it again)"
        />
        <div v-if="canApprove" class="row" style="flex-wrap: wrap">
          <button
            class="btn primary"
            :disabled="busy || progress.decided < progress.total"
            :title="progress.decided < progress.total ? 'Decide each item first' : ''"
            @click="act('approve')"
            >Approve and add to the register</button
          >
          <button class="btn" :disabled="busy" @click="act('request_changes', true)">Run it again</button>
        </div>
        <p v-else class="small faint">A reviewer or lead decides on this draft.</p>
      </div>

      <div v-else-if="drafting && draft" class="ai-draft">
        <div class="ai-draft-head">
          <span class="ai-mark">AI</span>
          <div class="grow">
            <h3>{{ DRAFT_HEADLINE }}</h3>
            <p class="small muted"
              >Drafted by the {{ agentName }} using {{ modelWords(draft.model)
              }}{{ passagesHere.length ? ` with ${passagesHere.length} knowledge-base passages` : '' }}.</p
            >
          </div>
        </div>
        <div class="decide-box"><strong>What you decide:</strong> {{ DRAFT_ASK[card.stage] }}</div>

        <template v-if="card.stage === 'evidence'">
          <p class="small">{{ draft.summary }}</p>
          <DraftItem
            v-for="(r, i) in draft.requests"
            :key="i"
            :title="`${r.controlKey} · ${r.item}`"
            :meta="`Ask ${r.askFrom} · ${r.status}${r.evidenceKeys.length ? ` · matched ${r.evidenceKeys.join(', ')}` : ''}`"
            :why="`${r.why}${r.note ? ` ${r.note}` : ''}`"
            :sources="r.sources"
            :passages="passagesHere"
            :can-decide="false"
          />
          <RouterLink class="btn sm" to="/testing/evidence" style="align-self: flex-start"
            >Open the evidence vault</RouterLink
          >
        </template>

        <template v-else-if="card.stage === 'test'">
          <p class="small">{{ draft.summary }}</p>
          <div class="row" style="flex-wrap: wrap">
            <span class="badge ok">{{ draft.proposed.pass }} pass</span
            ><span class="badge danger">{{ draft.proposed.fail }} fail</span
            ><span class="badge">{{ draft.proposed.cannot_assess }} can't assess</span>
          </div>
          <p class="small"
            >Each draft sits on its test. A preparer concludes each test, starting from the draft if it holds up, and
            someone else reviews it.</p
          >
          <RouterLink class="btn sm" to="/testing/tests" style="align-self: flex-start">Conclude the tests</RouterLink>
        </template>

        <template v-else-if="card.stage === 'validate'">
          <div class="row"
            ><span class="badge" :class="draft.readiness === 'ready' ? 'ok' : 'danger'">{{
              draft.readiness === 'ready' ? 'Looks ready' : 'Not ready'
            }}</span
            ><span class="small">{{ draft.summary }}</span></div
          >
          <div class="stack" style="gap: 4px">
            <div class="spread small"
              ><span>{{ progress.decided }} of {{ progress.total }} weighed</span
              ><button v-if="canApprove && progress.decided < progress.total" class="btn sm ghost" @click="decide(null)"
                >Accept the rest</button
              ></div
            >
            <div class="progress"
              ><i :style="{ width: `${progress.total ? (progress.decided / progress.total) * 100 : 0}%` }"
            /></div>
          </div>
          <DraftItem
            v-for="(c, i) in draft.challenges"
            :key="i"
            :title="c.finding"
            :meta="`${c.severity} · ${c.area}${c.ref ? ` · ${c.ref}` : ''}`"
            :decision="decisionsHere[`challenge:${i}`]"
            :can-decide="canApprove"
            @decide="(d, e, r) => decide(`challenge:${i}`, d, e, r)"
          />
          <p class="small faint"
            >Accept means you agree and it has been dealt with; reject means it doesn't apply, with your reason. The
            Review assistant isn't a second-line review; you are.</p
          >
        </template>

        <template v-else-if="card.stage === 'report'">
          <DraftItem
            :title="String(editedOr('summary', draft).headline)"
            meta="Board summary"
            :why="String(editedOr('summary', draft).summary)"
            :sources="['data']"
            :passages="[
              {
                id: 'data',
                title: 'Figures from the harness',
                kind: 'client',
                ref: '',
                text: 'Every number in this summary was checked against the harness\'s own records before you saw it.',
                score: 1,
              },
            ]"
            :decision="decisionsHere.summary"
            :can-decide="canApprove"
            :fields="SUMMARY_FIELDS"
            :values="{ headline: draft.headline, summary: draft.summary }"
            no-reject
            @decide="(d, e, r) => decide('summary', d, e, r)"
          />
          <div v-if="draft.keyFigures.length" class="row" style="flex-wrap: wrap"
            ><span v-for="k in draft.keyFigures" :key="k.label" class="badge">{{ k.label }}: {{ k.value }}</span></div
          >
          <div v-if="draft.recommendations.length" class="small"
            ><strong>Recommendations</strong
            ><ul class="plain"
              ><li v-for="r in draft.recommendations" :key="r">{{ r }}</li></ul
            ></div
          >
          <div v-if="draft.decisionsNeeded.length" class="small"
            ><strong>Decisions for the board</strong
            ><ul class="plain"
              ><li v-for="r in draft.decisionsNeeded" :key="r">{{ r }}</li></ul
            ></div
          >
        </template>

        <div v-if="exit.required.length" class="small">
          <strong>Before it can move on</strong>
          <ul class="check-list" style="margin-top: 4px"
            ><li v-for="r in exit.required" :key="r" :class="{ no: exit.unmet.length > 0 }">{{ r }}</li></ul
          >
          <p v-if="exit.unmet.length" class="error" style="margin-top: 4px">Not met yet: {{ exit.unmet.join('; ') }}</p>
        </div>
        <textarea
          v-model="note"
          class="textarea"
          style="min-height: 60px"
          :placeholder="`Note for the record, or what the ${agentName} should look at again (needed to run it again)`"
        />
        <div v-if="canApprove" class="row" style="flex-wrap: wrap">
          <button
            class="btn primary"
            :disabled="busy || exit.unmet.length > 0 || progress.decided < progress.total"
            @click="act('approve')"
            >{{
              card.stage === 'validate' ? 'Sign off' : card.stage === 'report' ? 'Approve the summary' : 'Move on'
            }}</button
          >
          <button class="btn" :disabled="busy" @click="act('request_changes', true)">Run it again</button>
        </div>
        <p v-else class="small faint">A reviewer or lead moves this on.</p>
      </div>

      <div v-else-if="mode === 'review' && card.stage === 'design' && card.design" class="ai-draft">
        <div class="ai-draft-head">
          <span class="ai-mark">AI</span>
          <div class="grow">
            <h3>The Control Designer proposes {{ card.design.controls.length }} controls</h3>
            <p class="small muted"
              >Drafted by {{ modelWords(lastModel) }} from the approved risks, the control library and
              {{ passagesHere.length }} passages from the knowledge base.</p
            >
          </div>
        </div>
        <div class="decide-box">
          <strong>What you decide:</strong> which controls should be in place for this use case. Each one you keep goes
          into the control register with a draft test, linked to the risks it treats. Every risk scoring 12 or more must
          keep at least one control.
        </div>
        <div class="stack" style="gap: 4px">
          <div class="spread small"
            ><span>{{ progress.decided }} of {{ progress.total }} decided</span
            ><button v-if="canApprove && progress.decided < progress.total" class="btn sm ghost" @click="decide(null)"
              >Accept the rest</button
            ></div
          >
          <div class="progress"
            ><i :style="{ width: `${progress.total ? (progress.decided / progress.total) * 100 : 0}%` }"
          /></div>
        </div>
        <VerifierBar :card="card" @checked="load" />
        <DraftItem
          v-for="(c, i) in card.design.controls"
          :key="i"
          :title="`${c.libraryCode ? c.libraryCode + ' · ' : ''}${editedOr(`control:${i}`, c).title}`"
          :meta="`Owner: ${editedOr(`control:${i}`, c).owner} · treats ${c.riskTitles.join('; ')}`"
          :why="String(editedOr(`control:${i}`, c).objective)"
          :sources="c.sources"
          :passages="passagesHere"
          :decision="decisionsHere[`control:${i}`]"
          :can-decide="canApprove"
          :fields="CONTROL_FIELDS"
          :values="{ title: c.title, owner: c.owner, objective: c.objective }"
          :verdict="verdictOf(`control:${i}`)"
          @decide="(d, e, r) => decide(`control:${i}`, d, e, r)"
        />
        <div v-if="card.design.gaps.length" class="small"
          ><strong>Gaps the agent noted</strong
          ><ul class="plain"
            ><li v-for="g in card.design.gaps" :key="g">{{ g }}</li></ul
          ></div
        >
        <p v-if="exit.unmet.length" class="error small">{{ exit.unmet.join('; ') }}</p>
        <textarea
          v-model="note"
          class="textarea"
          style="min-height: 60px"
          placeholder="Note for the record, or what the Control Designer should reconsider (needed to run it again)"
        />
        <div v-if="canApprove" class="row" style="flex-wrap: wrap">
          <button
            class="btn primary"
            :disabled="busy || progress.decided < progress.total || exit.unmet.length > 0"
            @click="act('approve')"
            >Approve and create the controls</button
          >
          <button class="btn" :disabled="busy" @click="act('request_changes', true)">Run it again</button>
        </div>
        <p v-else class="small faint">A reviewer or lead decides on this draft.</p>
      </div>

      <div v-else-if="mode === 'question' && openQuestion" class="notice question-box">
        <span class="label-caps row" style="gap: 8px"
          ><span class="seg-ai">AI</span>{{ openQuestion.agent }} has a question</span
        >
        <h3 style="margin-top: 6px">{{ openQuestion.question }}</h3>
        <p v-if="openQuestion.why" class="small muted"
          >Why it asks: {{ openQuestion.why
          }}<span v-if="ASKED_OF[openQuestion.askedTo]">
            · best answered by {{ ASKED_OF[openQuestion.askedTo] }}</span
          ></p
        >
        <template v-if="app.can('prepare')">
          <textarea
            v-model="answer"
            class="textarea"
            rows="3"
            placeholder="Your answer. The agent uses it in its draft; it doesn't decide anything."
            aria-label="Your answer"
          />
          <div class="row">
            <button class="btn primary" :disabled="busy || !answer.trim()" @click="reply('answer')">Send answer</button>
            <button
              class="btn"
              :disabled="busy"
              title="The agent carries on without it and notes what it assumed"
              @click="reply('skip')"
              >Skip question</button
            >
          </div>
        </template>
        <p v-else class="small faint">Someone who can prepare work answers this.</p>
      </div>

      <div v-else-if="mode === 'failed'" class="notice danger">
        <h3>The last run didn't finish</h3>
        <p class="small">{{ card.statusNote }}</p>
        <div class="row">
          <button class="btn primary" :disabled="busy" @click="act('retry')">Run again</button>
          <RouterLink v-if="card.latestRunId" class="btn" :to="`/runs/${card.latestRunId}`">Open the run</RouterLink>
        </div>
      </div>

      <div v-else-if="mode === 'working'" class="notice">
        <h3>{{ card.status === 'running' ? `The ${agentName} is working on this` : `Queued for the ${agentName}` }}</h3>
        <p v-if="card.statusNote" class="small">{{ card.statusNote }}</p>
        <template v-if="card.status === 'running'">
          <div class="ap-worked live">Working · {{ liveSteps }} step{{ liveSteps === 1 ? '' : 's' }}</div>
          <ol v-if="liveEvents.length" class="ap-steps">
            <li v-for="e in liveEvents.slice(-12)" :key="e.id" :class="e.kind === 'output' ? 'thought' : 'look'">{{
              e.text.length > 280 ? `${e.text.slice(0, 280)}…` : e.text
            }}</li>
          </ol>
        </template>
        <RouterLink v-if="card.latestRunId && card.status === 'running'" :to="`/runs/${card.latestRunId}`"
          >Watch the run</RouterLink
        >
      </div>

      <div v-else-if="mode === 'manual'" class="notice" :class="gated ? 'warn' : ''">
        <h3>{{ gated ? 'You sign off this stage' : 'No agent on this stage yet' }}</h3>
        <p class="small">
          The {{ STAGE_LABELS[card.stage] }} agent isn't built yet, so a person does this step.
          {{ gated ? 'Moving it on records you as the approver.' : 'Move it on when the work is done.' }}
        </p>
        <div v-if="exit.required.length" class="small">
          <strong>Before it can move on</strong>
          <ul class="check-list" style="margin-top: 4px">
            <li v-for="r in exit.required" :key="r" :class="{ no: exit.unmet.length > 0 }">{{ r }}</li>
          </ul>
          <p v-if="exit.unmet.length" class="error" style="margin-top: 4px">Not met yet: {{ exit.unmet.join('; ') }}</p>
        </div>
        <textarea v-model="note" class="textarea" placeholder="What was done (goes in the audit trail)" />
        <div class="row" style="flex-wrap: wrap">
          <button
            class="btn primary"
            :disabled="busy || exit.unmet.length > 0 || (gated && !canApprove)"
            @click="act('advance')"
            >{{ gated ? 'Sign off and move on' : 'Mark done' }}</button
          >
          <RouterLink v-if="card.stage === 'evidence' || card.stage === 'test'" class="btn" to="/testing/tests"
            >Open testing</RouterLink
          >
          <RouterLink v-if="card.stage === 'remediate'" class="btn" to="/issues">Open issues</RouterLink>
        </div>
        <p v-if="gated && !canApprove" class="small faint">A reviewer or lead signs this stage off.</p>
      </div>

      <div v-else-if="mode === 'closed'" class="notice" :class="card.tier ? '' : 'warn'">
        <h3>{{ card.tier ? 'Governed and reported' : 'Not taken forward' }}</h3>
        <p v-if="card.statusNote" class="small">{{ card.statusNote }}</p>
      </div>
      <p v-if="error" class="error">{{ error }}</p>

      <!-- Classification detail -->
      <section v-if="card.classification" class="section">
        <span class="label-caps">Classification</span>
        <dl class="kv">
          <dt>What drove the tier</dt>
          <dd
            ><ul class="plain"
              ><li v-for="f in card.classification.factors" :key="f">{{ f }}</li></ul
            ></dd
          >
          <dt>Oversight</dt>
          <dd>{{ OVERSIGHT_LABELS[card.classification.oversight] }}</dd>
          <dt v-if="card.classification.openQuestions.length">Ask the owner</dt>
          <dd v-if="card.classification.openQuestions.length"
            ><ul class="plain"
              ><li v-for="q in card.classification.openQuestions" :key="q">{{ q }}</li></ul
            ></dd
          >
          <dt>Framework</dt>
          <dd class="row" style="flex-wrap: wrap"
            ><span v-for="f in card.classification.frameworkRefs" :key="f" class="chip">{{ f }}</span></dd
          >
        </dl>
      </section>

      <section v-if="risks.length || card.classification" class="section">
        <span class="label-caps">{{ risks.length ? 'Risks in the register' : 'Proposed risks' }}</span>
        <div class="table-wrap">
          <table>
            <thead
              ><tr><th>Risk</th><th>Category</th><th class="num">L×I</th></tr></thead
            >
            <tbody>
              <tr v-for="r in risks.length ? risks : card.classification!.risks" :key="r.title">
                <td>
                  <span v-if="'key' in r" class="mono faint">{{ r.key }} </span>{{ r.title }}
                  <div class="small faint">{{ r.rationale }}</div>
                </td>
                <td class="small">{{ r.category.replace('_', ' ') }}</td>
                <td class="num"
                  ><span class="score" :class="riskRating(riskScore(r.likelihood, r.impact))">{{
                    riskScore(r.likelihood, r.impact)
                  }}</span></td
                >
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="card.drafts?.report?.approvedBy" class="section">
        <span class="label-caps">Board summary · approved by {{ card.drafts.report.approvedBy }}</span>
        <strong>{{ card.drafts.report.headline }}</strong>
        <p v-for="(para, i) in card.drafts.report.summary.split(/\n+/)" :key="i" class="small">{{ para }}</p>
      </section>

      <section v-if="controls.length" class="section">
        <div class="spread"
          ><span class="label-caps">Controls ({{ controls.length }})</span
          ><RouterLink class="small" to="/controls/register">Control register</RouterLink></div
        >
        <div v-for="c in controls" :key="c.id" class="spread small">
          <span
            ><span class="mono faint">{{ c.key }}</span>
            <span v-if="c.libraryCode" class="code">{{ c.libraryCode }}</span> {{ c.title }}</span
          >
          <span class="row"
            ><span class="faint">{{ c.tests }} test{{ c.tests === 1 ? '' : 's' }} · {{ c.evidence }} evidence</span
            ><span class="pill" :class="{ operating: 'green', failed: 'coral', designed: 'blue' }[c.status]">{{
              c.status
            }}</span></span
          >
        </div>
      </section>

      <ClientSteps :card-key="card.key" />

      <section class="section">
        <span class="label-caps">Use case profile</span>
        <dl class="kv">
          <dt>Business owner</dt><dd>{{ card.useCase.businessOwner || '—' }}</dd> <dt>What it does</dt
          ><dd>{{ card.useCase.description || '—' }}</dd> <dt>Data used</dt><dd>{{ card.useCase.dataUsed || '—' }}</dd>
          <dt>People affected</dt><dd>{{ card.useCase.affectedPeople || '—' }}</dd> <dt>Autonomy</dt
          ><dd>{{ autonomyLabel[card.useCase.autonomy] }}</dd> <dt>Vendor or model</dt
          ><dd>{{ card.useCase.vendor || '—' }}</dd>
        </dl>
      </section>

      <section v-if="pastQuestions.length" class="section">
        <span class="label-caps">Questions the agents asked</span>
        <div v-for="q in pastQuestions" :key="q.id" class="qa small">
          <div
            ><strong>{{ q.agent }}:</strong> {{ q.question }}</div
          >
          <div v-if="q.status === 'answered'" class="muted">{{ q.answeredBy }}: {{ q.answer }}</div>
          <div v-else class="faint">Skipped by {{ q.answeredBy }}</div>
        </div>
      </section>

      <section v-if="runs.length" class="section">
        <span class="label-caps">Runs</span>
        <div v-for="r in runs" :key="r.id" class="spread small">
          <RouterLink :to="`/runs/${r.id}`" class="mono">R-{{ r.number }}</RouterLink>
          <span class="muted grow"
            >{{ r.agent }} · {{ r.model
            }}<span v-if="r.mode === 'agentic' && r.steps">
              · {{ r.steps }} step{{ r.steps === 1 ? '' : 's' }}</span
            ></span
          >
          <span
            class="pill"
            :class="{ succeeded: 'green', failed: 'coral', running: 'blue pulse', waiting: 'amber' }[r.status]"
            ><span class="dot" />{{ r.status }}</span
          >
          <span class="faint">{{ ago(r.startedAt) }}</span>
        </div>
      </section>

      <section v-if="activity.length" class="section">
        <span class="label-caps">Activity</span>
        <div v-for="a in activity" :key="a.id" class="small row" style="align-items: flex-start">
          <span class="faint" style="min-width: 36px">{{ ago(a.at) }}</span>
          <span
            ><strong>{{ a.actor }}</strong> · {{ actionLabel(a.action)
            }}<span v-if="a.detail?.note" class="muted">: “{{ a.detail.note }}”</span></span
          >
        </div>
      </section>
    </template>
  </aside>
</template>
