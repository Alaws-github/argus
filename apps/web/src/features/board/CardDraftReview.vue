<script setup lang="ts">
// A drafting agent's draft (evidence, test, validate or report stage), decided item by item.
// Part of the use case side panel (CardDrawer.vue); state and actions come from useCardDrawer.
import DraftItem from './DraftItem.vue';
import { computed } from 'vue';
import type { CardDrawerState, CardWith } from './use-card-drawer';

const props = defineProps<{ drawer: CardDrawerState }>();
const {
  modelWords,
  exit,
  note,
  busy,
  act,
  agentName,
  draft,
  DRAFT_ASK,
  DRAFT_HEADLINE,
  canApprove,
  progress,
  decisionsHere,
  passagesHere,
  decide,
  SUMMARY_FIELDS,
  editedOr,
} = props.drawer;
// The drawer shows this panel only for a loaded card.
const card = computed(() => props.drawer.card.value as CardWith);
</script>

<template>
  <div class="ai-draft">
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
        >Accept means you agree and it has been dealt with; reject means it doesn't apply, with your reason. The Review
        assistant isn't a second-line review; you are.</p
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
</template>
