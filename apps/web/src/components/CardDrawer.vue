<script setup lang="ts">
// The side panel for one use case: whatever decision it is waiting for (triage,
// classification, control design, an agent draft, a manual sign-off), its exit
// criteria, risks, controls, profile, runs and activity.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AGENT_ROLES, DRAFT_STAGES, OVERSIGHT_LABELS, STAGE_LABELS, TIER_LABELS, riskRating, riskScore,
  type AuditEntry, type Card, type Risk, type Run,
} from '@gh/shared';
import { api, ago, money, socket } from '../api';
import { useApp } from '../stores/app';
import StatusPill from './StatusPill.vue';

const props = defineProps<{ cardKey: string }>();
const emit = defineEmits<{ close: [] }>();
const app = useApp();

const card = ref<Card | null>(null);
const runs = ref<Run[]>([]);
const risks = ref<Risk[]>([]);
const activity = ref<AuditEntry[]>([]);
const controls = ref<{ id: string; key: string; title: string; status: string; owner: string; libraryCode: string | null; tests: number; evidence: number }[]>([]);
const exit = ref<{ required: string[]; unmet: string[] }>({ required: [], unmet: [] });
const note = ref('');
const busy = ref(false);
const error = ref('');

async function load() {
  try {
    const d = await api(`/cards/${props.cardKey}`);
    card.value = d.card;
    runs.value = d.runs;
    risks.value = d.risks;
    activity.value = d.activity;
    controls.value = d.controls ?? [];
    exit.value = d.exitCriteria ?? { required: [], unmet: [] };
  } catch (e: any) {
    error.value = e.message;
  }
}

function onCard(c: Card) {
  if (c.key === props.cardKey) void load();
}
onMounted(() => {
  void load();
  socket.on('card', onCard);
});
onBeforeUnmount(() => socket.off('card', onCard));
watch(() => props.cardKey, () => void load());

const hasAgent = computed(() => !!card.value && app.agentStages.includes(card.value.stage));
const gated = computed(() => !!card.value && !!app.engagement?.gates[card.value.stage]);
const mode = computed(() => {
  const c = card.value;
  if (!c) return 'loading';
  if (c.stage === 'closed') return 'closed';
  if (c.stage === 'intake') return 'triage';
  if (c.status === 'needs_approval') return 'review';
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
    await api(`/cards/${card.value!.id}/actions`, { method: 'POST', body: { action, note: note.value.trim() || undefined } });
    note.value = '';
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

const agentName = computed(() => Object.values(AGENT_ROLES).find((a) => a.stage === card.value?.stage)?.name ?? 'agent');
const drafting = computed(() => !!card.value && DRAFT_STAGES.includes(card.value.stage) && mode.value === 'review');
const draft = computed<any>(() => (card.value ? (card.value.drafts as any)?.[card.value.stage] : null));
const DRAFT_TITLES: Record<string, string> = { evidence: 'Evidence request list', test: 'Draft test results', validate: 'Challenges before sign-off', report: 'Draft board summary' };
const statusPill: Record<string, string> = { received: 'green', partial: 'amber', missing: 'coral' };
const canApprove = computed(() => app.can('approve'));
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
    'gate.blocked': 'Blocked by exit criteria',
  })[a] ?? a;
</script>

<template>
  <div class="backdrop" @click="emit('close')" />
  <aside class="panel" role="dialog" :aria-label="card ? `${card.key} ${card.title}` : 'Use case'" @keydown.esc="emit('close')">
    <div v-if="!card" class="muted">{{ error || 'Loading…' }}</div>
    <template v-else>
      <div class="spread">
        <div class="row">
          <span class="mono faint">{{ card.key }}</span>
          <span v-if="card.tier" class="tier" :class="card.tier">{{ TIER_LABELS[card.tier] }}</span>
          <StatusPill :card="card" />
        </div>
        <button class="btn ghost sm" aria-label="Close" @click="emit('close')">✕</button>
      </div>
      <div>
        <h1 style="font-size: 19px">{{ card.title }}</h1>
        <p class="small muted" style="margin-top: 4px">
          Stage {{ STAGE_LABELS[card.stage] }} · {{ ago(card.stageEnteredAt) }} here · AI spend {{ money(card.costUsd) }}
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
        <p v-else class="small faint">{{ ownCard ? 'You added this use case, so someone else decides whether to take it forward.' : 'A reviewer or lead decides this.' }}</p>
      </div>

      <div v-else-if="mode === 'review' && card.stage === 'classify' && card.classification" class="notice">
        <div class="spread">
          <h3>Review the proposed classification</h3>
          <span class="tier" :class="card.classification.tier">{{ TIER_LABELS[card.classification.tier] }} risk</span>
        </div>
        <p class="small">{{ card.classification.tierRationale }}</p>
        <p class="small"><strong>{{ OVERSIGHT_LABELS[card.classification.oversight] }}.</strong> {{ card.classification.oversightRationale }}</p>
        <p class="small muted">Approving adds the {{ card.classification.risks.length }} risks below to the risk register, owned by the business owner.</p>
        <textarea v-model="note" class="textarea" placeholder="Note to the Risk Classifier (needed to request changes)" />
        <div v-if="canApprove" class="row">
          <button class="btn primary" :disabled="busy" @click="act('approve')">Approve classification</button>
          <button class="btn" :disabled="busy" @click="act('request_changes', true)">Request changes</button>
        </div>
        <p v-else class="small faint">A reviewer or lead approves this.</p>
      </div>

      <div v-else-if="drafting && draft" class="notice">
        <div class="spread">
          <h3>{{ DRAFT_TITLES[card.stage] }}</h3>
          <span class="badge">Drafted by {{ agentName }} · {{ draft.model }}</span>
        </div>
        <p class="small muted">An agent's draft. It doesn't conclude, review or approve anything; a named person decides.</p>

        <template v-if="card.stage === 'evidence'">
          <p class="small">{{ draft.summary }}</p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Control</th><th>Ask for</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in draft.requests" :key="i">
                  <td class="mono small">{{ r.controlKey }}</td>
                  <td class="small">{{ r.item }}<div class="faint">From {{ r.askFrom }}. {{ r.why }}</div><div v-if="r.note" class="faint">{{ r.note }}</div></td>
                  <td><span class="pill" :class="statusPill[r.status]">{{ r.status }}</span><div class="mono small faint">{{ r.evidenceKeys.join(' ') }}</div></td>
                </tr>
              </tbody>
            </table>
          </div>
          <RouterLink class="small" to="/testing/evidence">Open the evidence vault</RouterLink>
        </template>

        <template v-else-if="card.stage === 'test'">
          <p class="small">{{ draft.summary }}</p>
          <div class="row" style="flex-wrap: wrap">
            <span class="badge ok">{{ draft.proposed.pass }} pass</span><span class="badge danger">{{ draft.proposed.fail }} fail</span><span class="badge">{{ draft.proposed.cannot_assess }} can't assess</span>
          </div>
          <p class="small">Each draft sits on its test. A preparer concludes each test, starting from the draft if it holds up, and someone else reviews it.</p>
          <RouterLink class="btn sm" to="/testing/tests" style="align-self: flex-start">Conclude the tests</RouterLink>
        </template>

        <template v-else-if="card.stage === 'validate'">
          <div class="row"><span class="badge" :class="draft.readiness === 'ready' ? 'ok' : 'danger'">{{ draft.readiness === 'ready' ? 'Looks ready' : 'Not ready' }}</span><span class="small">{{ draft.summary }}</span></div>
          <ul class="plain small" style="max-height: 280px; overflow: auto">
            <li v-for="(c, i) in draft.challenges" :key="i"><span class="sev" :class="c.severity">{{ c.severity }}</span> {{ c.finding }}</li>
          </ul>
          <p class="small faint">The Review assistant isn't a second-line review. You sign off as the reviewer, having weighed these.</p>
        </template>

        <template v-else-if="card.stage === 'report'">
          <strong>{{ draft.headline }}</strong>
          <p v-for="(para, i) in draft.summary.split(/\n+/)" :key="i" class="small">{{ para }}</p>
          <div v-if="draft.keyFigures.length" class="row" style="flex-wrap: wrap"><span v-for="k in draft.keyFigures" :key="k.label" class="badge">{{ k.label }}: {{ k.value }}</span></div>
          <div v-if="draft.recommendations.length" class="small"><strong>Recommendations</strong><ul class="plain"><li v-for="r in draft.recommendations" :key="r">{{ r }}</li></ul></div>
          <div v-if="draft.decisionsNeeded.length" class="small"><strong>Decisions for the board</strong><ul class="plain"><li v-for="r in draft.decisionsNeeded" :key="r">{{ r }}</li></ul></div>
          <p class="small faint">Every figure was checked against the harness's data before you saw it.</p>
        </template>

        <div v-if="exit.required.length" class="small">
          <strong>Exit criteria</strong>
          <ul class="check-list" style="margin-top: 4px"><li v-for="r in exit.required" :key="r" :class="{ no: exit.unmet.length > 0 }">{{ r }}</li></ul>
          <p v-if="exit.unmet.length" class="error" style="margin-top: 4px">Not met yet: {{ exit.unmet.join('; ') }}</p>
        </div>
        <textarea v-model="note" class="textarea" :placeholder="`Note for the record, or what the ${agentName} should look at again (needed to run it again)`" />
        <div v-if="canApprove" class="row" style="flex-wrap: wrap">
          <button class="btn primary" :disabled="busy || exit.unmet.length > 0" @click="act('approve')">{{ card.stage === 'validate' ? 'Sign off' : card.stage === 'report' ? 'Approve the summary' : 'Move on' }}</button>
          <button class="btn" :disabled="busy" @click="act('request_changes', true)">Run it again</button>
        </div>
        <p v-else class="small faint">A reviewer or lead moves this on.</p>
      </div>

      <div v-else-if="mode === 'review' && card.stage === 'design' && card.design" class="notice">
        <h3>Review the proposed controls</h3>
        <p class="small">The Control Designer proposes {{ card.design.controls.length }} controls from the library. Approving adds them to the control register with a draft test each, linked to the risks they treat.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Control</th><th>Treats</th></tr></thead>
            <tbody>
              <tr v-for="c in card.design.controls" :key="c.title">
                <td>
                  <span v-if="c.libraryCode" class="code">{{ c.libraryCode }} </span><strong>{{ c.title }}</strong>
                  <div class="small muted">{{ c.objective }}</div>
                  <div class="small faint">Owner: {{ c.owner }}</div>
                  <details class="small"><summary class="faint" style="cursor: pointer">Test approach</summary>{{ c.testApproach }}</details>
                </td>
                <td class="small">{{ c.riskTitles.join('; ') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="card.design.gaps.length" class="small"><strong>Gaps noted</strong><ul class="plain"><li v-for="g in card.design.gaps" :key="g">{{ g }}</li></ul></div>
        <textarea v-model="note" class="textarea" placeholder="Note to the Control Designer (needed to request changes)" />
        <div v-if="canApprove" class="row">
          <button class="btn primary" :disabled="busy" @click="act('approve')">Approve controls</button>
          <button class="btn" :disabled="busy" @click="act('request_changes', true)">Request changes</button>
        </div>
        <p v-else class="small faint">A reviewer or lead approves this.</p>
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
        <RouterLink v-if="card.latestRunId && card.status === 'running'" :to="`/runs/${card.latestRunId}`">Watch the run</RouterLink>
      </div>

      <div v-else-if="mode === 'manual'" class="notice" :class="gated ? 'warn' : ''">
        <h3>{{ gated ? 'You sign off this stage' : 'No agent on this stage yet' }}</h3>
        <p class="small">
          The {{ STAGE_LABELS[card.stage] }} agent isn't built yet, so a person does this step.
          {{ gated ? 'Moving it on records you as the approver.' : 'Move it on when the work is done.' }}
        </p>
        <div v-if="exit.required.length" class="small">
          <strong>Exit criteria</strong>
          <ul class="check-list" style="margin-top: 4px">
            <li v-for="r in exit.required" :key="r" :class="{ no: exit.unmet.length > 0 }">{{ r }}</li>
          </ul>
          <p v-if="exit.unmet.length" class="error" style="margin-top: 4px">Not met yet: {{ exit.unmet.join('; ') }}</p>
        </div>
        <textarea v-model="note" class="textarea" placeholder="What was done (goes in the audit trail)" />
        <div class="row" style="flex-wrap: wrap">
          <button class="btn primary" :disabled="busy || exit.unmet.length > 0 || (gated && !canApprove)" @click="act('advance')">{{ gated ? 'Sign off and move on' : 'Mark done' }}</button>
          <RouterLink v-if="card.stage === 'evidence' || card.stage === 'test'" class="btn" to="/testing/tests">Open testing</RouterLink>
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
          <dd><ul class="plain"><li v-for="f in card.classification.factors" :key="f">{{ f }}</li></ul></dd>
          <dt>Oversight</dt>
          <dd>{{ OVERSIGHT_LABELS[card.classification.oversight] }}</dd>
          <dt v-if="card.classification.openQuestions.length">Ask the owner</dt>
          <dd v-if="card.classification.openQuestions.length"><ul class="plain"><li v-for="q in card.classification.openQuestions" :key="q">{{ q }}</li></ul></dd>
          <dt>Framework</dt>
          <dd class="row" style="flex-wrap: wrap"><span v-for="f in card.classification.frameworkRefs" :key="f" class="chip">{{ f }}</span></dd>
        </dl>
      </section>

      <section v-if="risks.length || card.classification" class="section">
        <span class="label-caps">{{ risks.length ? 'Risks in the register' : 'Proposed risks' }}</span>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Risk</th><th>Category</th><th class="num">L×I</th></tr></thead>
            <tbody>
              <tr v-for="r in risks.length ? risks : card.classification!.risks" :key="r.title">
                <td>
                  <span v-if="'key' in r" class="mono faint">{{ r.key }} </span>{{ r.title }}
                  <div class="small faint">{{ r.rationale }}</div>
                </td>
                <td class="small">{{ r.category.replace('_', ' ') }}</td>
                <td class="num"><span class="score" :class="riskRating(riskScore(r.likelihood, r.impact))">{{ riskScore(r.likelihood, r.impact) }}</span></td>
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
        <div class="spread"><span class="label-caps">Controls ({{ controls.length }})</span><RouterLink class="small" to="/controls/register">Control register</RouterLink></div>
        <div v-for="c in controls" :key="c.id" class="spread small">
          <span><span class="mono faint">{{ c.key }}</span> <span v-if="c.libraryCode" class="code">{{ c.libraryCode }}</span> {{ c.title }}</span>
          <span class="row"><span class="faint">{{ c.tests }} test{{ c.tests === 1 ? '' : 's' }} · {{ c.evidence }} evidence</span><span class="pill" :class="{ operating: 'green', failed: 'coral', designed: 'blue' }[c.status]">{{ c.status }}</span></span>
        </div>
      </section>

      <section class="section">
        <span class="label-caps">Use case profile</span>
        <dl class="kv">
          <dt>Business owner</dt><dd>{{ card.useCase.businessOwner || '—' }}</dd>
          <dt>What it does</dt><dd>{{ card.useCase.description || '—' }}</dd>
          <dt>Data used</dt><dd>{{ card.useCase.dataUsed || '—' }}</dd>
          <dt>People affected</dt><dd>{{ card.useCase.affectedPeople || '—' }}</dd>
          <dt>Autonomy</dt><dd>{{ autonomyLabel[card.useCase.autonomy] }}</dd>
          <dt>Vendor or model</dt><dd>{{ card.useCase.vendor || '—' }}</dd>
        </dl>
      </section>

      <section v-if="runs.length" class="section">
        <span class="label-caps">Runs</span>
        <div v-for="r in runs" :key="r.id" class="spread small">
          <RouterLink :to="`/runs/${r.id}`" class="mono">R-{{ r.number }}</RouterLink>
          <span class="muted grow">{{ r.agent }} · {{ r.model }}</span>
          <span class="pill" :class="{ succeeded: 'green', failed: 'coral', running: 'blue pulse' }[r.status]"><span class="dot" />{{ r.status }}</span>
          <span class="faint">{{ ago(r.startedAt) }}</span>
        </div>
      </section>

      <section v-if="activity.length" class="section">
        <span class="label-caps">Activity</span>
        <div v-for="a in activity" :key="a.id" class="small row" style="align-items: flex-start">
          <span class="faint" style="min-width: 36px">{{ ago(a.at) }}</span>
          <span><strong>{{ a.actor }}</strong> · {{ actionLabel(a.action) }}<span v-if="a.detail?.note" class="muted">: “{{ a.detail.note }}”</span></span>
        </div>
      </section>
    </template>
  </aside>
</template>
