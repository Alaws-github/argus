// Everything the use case side panel knows and does (v1.7.8: moved out of CardDrawer.vue so each panel
// is its own small component). It loads the card with its runs, risks, controls, questions and activity,
// keeps it live (socket updates and the running agent's steps), and holds the person's actions: gate
// actions, answering an agent's question and item-by-item decisions on a draft (rule 12).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AGENT_ROLES,
  DRAFT_STAGES,
  OVERSIGHT_LABELS,
  TIER_LABELS,
  type AgentQuestion,
  type AuditEntry,
  type Card,
  type Risk,
  type Run,
} from '@gh/shared';
import { api, socket } from '../../api';
import { useApp } from '../../stores/app';
import type { EditField } from './DraftItem.vue';
import { draftProgress } from './drafts';

/** The panel's state and actions for the use case with this key. */
export function useCardDrawer(cardKey: () => string) {
  const app = useApp();
  // v1.7.4: say which model drafted it in words; the offline rules aren't an AI model.
  const modelWords = (m?: string | null) =>
    !m ? 'an agent' : /^rules/.test(m) ? 'the built-in rules (no AI model)' : m;

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
      const d = await api(`/cards/${cardKey()}`);
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
    if (c.key === cardKey()) void load();
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
    () => cardKey(),
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

  return {
    modelWords,
    card,
    runs,
    risks,
    activity,
    controls,
    exit,
    note,
    busy,
    error,
    questions,
    answer,
    load,
    onCard,
    liveEvents,
    watchRun,
    onRunEvent,
    liveSteps,
    onApplied,
    hasAgent,
    gated,
    mode,
    act,
    openQuestion,
    pastQuestions,
    ASKED_OF,
    reply,
    agentName,
    drafting,
    draft,
    DRAFT_ASK,
    DRAFT_HEADLINE,
    canApprove,
    progress,
    decisionsHere,
    lastModel,
    passagesHere,
    decide,
    LEVELS,
    RISK_FIELDS,
    TIER_FIELDS,
    CONTROL_FIELDS,
    SUMMARY_FIELDS,
    verdictOf,
    editedOr,
    ownCard,
    autonomyLabel,
    actionLabel,
  };
}

/** A card with these fields known to be set: a panel shown only when they are says so with this type. */
export type CardWith<K extends keyof Card = never> = Card & { [P in K]-?: NonNullable<Card[P]> };

/** What every panel component receives. */
export type CardDrawerState = ReturnType<typeof useCardDrawer>;
