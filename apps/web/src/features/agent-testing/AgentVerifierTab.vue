<script setup lang="ts">
// Agent testing > Verifier: which model checks drafts, live checks, and how far it agrees with people's
// labelled judgements (measured before anyone relies on it). Part of AgentTestingPage.vue (split out in v1.7.8).
import { computed, ref, watch } from 'vue';
import { VERDICT_LABELS, type JudgeLabel, type Provider } from '@gh/shared';
import { useUnsaved } from '../../lib/unsaved';
import { api, ago } from '../../api';
import { useApp } from '../../stores/app';
import { pct, useProviderChoices, type AgentTestingData } from './agent-testing-data';
import { LABEL_ORIGIN as ORIGIN } from './agent-testing-data';

const props = defineProps<{ data: AgentTestingData; providers: Provider[]; reload: () => Promise<void> }>();
const app = useApp();
const { enabled, modelsFor } = useProviderChoices(() => props.providers);
const admin = computed(() => app.canRaw('manage_models'));

// ---- Verifier
const vform = ref({ providerId: '', model: '', live: false });
const vu = useUnsaved(vform);
async function saveVerifier() {
  try {
    await api('/settings', {
      method: 'PUT',
      body: {
        verifierProviderId: vform.value.providerId || null,
        verifierModel: vform.value.providerId ? vform.value.model : '',
        verifierLive: vform.value.live,
      },
    });
    app.toast('Verifier settings saved');
    await props.reload();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const cal = computed(() => props.data.calibrations[0] ?? null);
const measuring = ref(false);
async function measure() {
  measuring.value = true;
  try {
    await api('/agent-testing/calibrate', { method: 'POST', body: {} });
    await props.reload();
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    measuring.value = false;
  }
}
async function importLabels() {
  try {
    const r = await api<{ added: number }>('/agent-testing/labels/import', { method: 'POST', body: {} });
    app.toast(r.added ? `Added ${r.added} examples from reviewers' decisions` : 'No new decisions to add');
    await props.reload();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const labelling = ref(false);
const lform = ref({ kind: 'risk', claim: '', sources: '', human: 'bad', note: '' });
async function addLabel() {
  try {
    await api('/agent-testing/labels', {
      method: 'POST',
      body: {
        ...lform.value,
        sources: lform.value.sources
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((s) => (s.toUpperCase().startsWith('K-') ? s.toUpperCase() : `K-${s}`)),
      },
    });
    labelling.value = false;
    lform.value = { kind: 'risk', claim: '', sources: '', human: 'bad', note: '' };
    await props.reload();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function removeLabel(l: JudgeLabel) {
  await api(`/agent-testing/labels/${l.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message, 'error'));
  await props.reload();
}
// The form follows the saved settings each time the page data reloads.
watch(
  () => props.data.verifier,
  (v) => {
    vform.value = { providerId: v.providerId ?? '', model: v.model, live: v.live };
    vu.mark();
  },
  { immediate: true },
);
</script>

<template>
  <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 16px">
    <form class="card" style="gap: 10px" @submit.prevent="saveVerifier">
      <h2>How the Verifier checks</h2>
      <p class="small muted"
        >It reads each tier, risk or control in a draft against the passages it cites, and says whether they back it up.
        A "supported" verdict must quote a cited passage word for word; the harness checks the quote, so the Verifier
        can't invent support. It never accepts, rejects or approves anything.</p
      >
      <label class="field"
        ><span>Model</span>
        <select
          v-model="vform.providerId"
          class="select"
          :disabled="!admin"
          @change="vform.model = modelsFor(vform.providerId)[0] ?? ''"
        >
          <option value="">Offline rules (word matching, free)</option>
          <option v-for="p in enabled.filter((x) => x.type !== 'rules')" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label v-if="vform.providerId" class="field"
        ><span>Model name</span
        ><select v-model="vform.model" class="select" :disabled="!admin"
          ><option v-for="m in modelsFor(vform.providerId)" :key="m" :value="m">{{ m }}</option></select
        ></label
      >
      <p class="small faint"
        >Pick a different model, ideally from a different company, from the one that drafts. A model tends to approve
        its own work.</p
      >
      <button
        type="button"
        class="switch"
        :class="{ on: vform.live }"
        role="switch"
        :aria-checked="vform.live"
        :disabled="!admin"
        @click="vform.live = !vform.live"
      >
        <span class="track" /><span>Check every new classification and control design automatically</span>
      </button>
      <p class="small faint"
        >Off by default. When off, anyone preparing work can ask for a check from the use case panel. Billed checks
        count towards the monthly spend cap.</p
      >
      <button v-if="admin" class="btn primary" style="align-self: flex-start" :disabled="!vu.dirty.value">Save</button>
    </form>

    <div class="card" style="gap: 10px">
      <div class="spread"
        ><h2>Can you trust it?</h2
        ><button v-if="admin" class="btn sm" :disabled="measuring" @click="measure">{{
          measuring ? 'Measuring…' : 'Measure the Verifier'
        }}</button></div
      >
      <p class="small muted"
        >It is measured on {{ data.labels.length }} claims people already judged good or bad. The bar: at least
        {{ data.trust.minLabels }} examples, agreement beyond chance (kappa) of {{ data.trust.kappa }} or more, and no
        more than {{ pct(data.trust.falsePass) }} of bad claims passed.</p
      >
      <template v-if="cal">
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <span class="badge" :class="cal.trusted ? 'ok' : 'danger'">{{
            cal.trusted ? 'Trusted for advisory use' : 'Not trusted yet'
          }}</span>
          <span class="small faint"
            >{{ cal.key }} · {{ cal.runtime === 'live' ? cal.model : 'offline rules' }} · {{ ago(cal.at) }}</span
          >
        </div>
        <div class="metric-grid">
          <div class="tile"
            ><span class="label-caps">Agreement</span><span class="big">{{ pct(cal.agree) }}</span></div
          >
          <div class="tile"
            ><span class="label-caps">Kappa</span><span class="big">{{ cal.kappa.toFixed(2) }}</span
            ><span class="small faint">0 is chance, 1 is perfect</span></div
          >
          <div class="tile"
            ><span class="label-caps">False passes</span
            ><span
              class="big"
              :style="{ color: cal.falsePassRate > data.trust.falsePass ? 'var(--danger)' : 'var(--ok)' }"
              >{{ pct(cal.falsePassRate) }}</span
            ><span class="small faint">Bad claims it called supported</span></div
          >
        </div>
        <div style="overflow-x: auto"
          ><table class="matrix" aria-label="Verifier against people">
            <thead
              ><tr><th /><th>Person: good</th><th>Person: bad</th></tr></thead
            >
            <tbody>
              <tr
                ><th>Verifier: supported</th><td class="hit">{{ cal.matrix.goodGood }}</td
                ><td class="danger">{{ cal.matrix.goodBad }}</td></tr
              >
              <tr
                ><th>Verifier: not supported</th><td>{{ cal.matrix.badGood }}</td
                ><td class="hit">{{ cal.matrix.badBad }}</td></tr
              >
            </tbody>
          </table></div
        >
      </template>
      <p v-else class="small muted">Not measured yet.</p>
    </div>
  </div>

  <div v-if="cal?.disagreements.length" class="card" style="margin-bottom: 16px; gap: 8px">
    <h2>Where it disagreed with people</h2>
    <div
      v-for="d in cal.disagreements"
      :key="d.label"
      class="draft-item"
      :class="d.human === 'bad' ? 'reject' : ''"
      style="opacity: 1"
    >
      <div class="small"
        ><span class="mono faint">{{ d.label }}</span> {{ d.claim }}</div
      >
      <div class="small"
        >Person: <strong>{{ d.human }}</strong> · Verifier: <strong>{{ VERDICT_LABELS[d.judge] }}</strong></div
      >
      <div class="small faint">{{ d.reason }}</div>
    </div>
  </div>

  <div class="toolbar">
    <h2>Labelled examples</h2>
    <div v-if="admin" class="row"
      ><button class="btn sm" @click="importLabels">Add from reviewers' decisions</button
      ><button class="btn sm" @click="labelling = true">Add an example</button></div
    >
  </div>
  <div class="table-wrap">
    <table>
      <thead
        ><tr><th>Claim</th><th>Sources</th><th>Person</th><th>Where from</th><th /></tr
      ></thead>
      <tbody>
        <tr v-for="l in data.labels" :key="l.id">
          <td style="min-width: 280px" class="small"
            ><span class="mono faint">{{ l.key }}</span> {{ l.claim
            }}<div v-if="l.note" class="faint">{{ l.note }}</div></td
          >
          <td class="small">{{ l.passages.map((p) => p.title).join('; ') || 'None' }}</td>
          <td
            ><span class="badge" :class="l.human === 'good' ? 'ok' : 'danger'">{{ l.human }}</span></td
          >
          <td class="small faint">{{ ORIGIN[l.origin] }}</td>
          <td
            ><button v-if="admin && l.origin !== 'built_in'" class="btn ghost sm" @click="removeLabel(l)"
              >Remove</button
            ></td
          >
        </tr>
      </tbody>
    </table>
  </div>

  <template v-if="labelling">
    <div class="backdrop" @click="labelling = false" />
    <form class="modal" @submit.prevent="addLabel">
      <div class="spread"
        ><h2>Add a labelled example</h2
        ><button type="button" class="btn ghost sm" aria-label="Close" @click="labelling = false">✕</button></div
      >
      <p class="small muted"
        >A claim an agent might make, the passages it cites (find their K-numbers on the Knowledge base page), and your
        judgement.</p
      >
      <label class="field"
        ><span>Kind</span
        ><select v-model="lform.kind" class="select"
          ><option value="risk">Risk</option
          ><option value="control">Control</option
          ><option value="tier">Tier</option></select
        ></label
      >
      <label class="field"
        ><span>Claim</span><textarea v-model="lform.claim" class="textarea" required minlength="5" />
      </label>
      <label class="field"
        ><span>Cited passages</span><input v-model="lform.sources" class="input" placeholder="K-12, K-40"
      /></label>
      <label class="field"
        ><span>Do the passages back the claim?</span
        ><select v-model="lform.human" class="select"
          ><option value="good">Yes: good</option
          ><option value="bad">No: bad</option></select
        ></label
      >
      <label class="field"><span>Why</span><input v-model="lform.note" class="input" /></label>
      <div class="row"
        ><button class="btn primary">Add example</button
        ><button type="button" class="btn" @click="labelling = false">Cancel</button></div
      >
    </form>
  </template>
</template>
