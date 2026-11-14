<script setup lang="ts">
// The use case's record below the decision: classification, risks, the approved report, controls, profile, the agent's past questions, runs and activity.
// Part of the use case side panel (CardDrawer.vue); state and actions come from useCardDrawer.
import { OVERSIGHT_LABELS, riskRating, riskScore } from '@gh/shared';
import { ago } from '../../api';
import ClientSteps from '../integrations/ClientSteps.vue';
import { computed } from 'vue';
import type { CardDrawerState, CardWith } from './use-card-drawer';

const props = defineProps<{ drawer: CardDrawerState }>();
const { runs, risks, activity, controls, pastQuestions, autonomyLabel, actionLabel } = props.drawer;
// The drawer shows this panel only for a loaded card.
const card = computed(() => props.drawer.card.value as CardWith);
</script>

<template>
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
        ><span class="mono faint">{{ c.key }}</span> <span v-if="c.libraryCode" class="code">{{ c.libraryCode }}</span>
        {{ c.title }}</span
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
        }}<span v-if="r.mode === 'agentic' && r.steps"> · {{ r.steps }} step{{ r.steps === 1 ? '' : 's' }}</span></span
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
