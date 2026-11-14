<script setup lang="ts">
// v1.7.4: every requirement of each framework in scope, so "fully met" means
// what it says: each requirement is proven by a control (in place, tested,
// passing, evidenced) or marked not applicable with a reason. Gaps can be
// closed here by mapping one of the engagement's controls to the requirement.
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { useApp } from '../stores/app';
import AppIcon from './AppIcon.vue';

type Status = 'proven' | 'in_progress' | 'gap' | 'not_applicable';
interface Row {
  id: string;
  title: string;
  group: string;
  status: Status;
  next: string;
  controls: { id: string; key: string; title: string; cardKey: string | null; proven: boolean }[];
  library: { code: string; title: string }[];
  scoping: { applicable: boolean; reason: string; by: string } | null;
}
interface Fw {
  id: string;
  label: string;
  inScope: boolean;
  total: number;
  proven: number;
  inProgress: number;
  gap: number;
  notApplicable: number;
  fullyMet: boolean;
  rows: Row[];
}
const app = useApp();
const data = ref<{ frameworks: Fw[]; controls: { id: string; key: string; title: string }[] } | null>(null);
const pick = ref('');
const show = ref<'all' | Status>('all');
const q = ref('');
const acting = ref<{ id: string; kind: 'map' | 'na'; controlId: string; reason: string } | null>(null);
const busy = ref(false);

async function load() {
  data.value = await api(`/engagements/${await app.eid()}/requirements`);
  if (!pick.value || !data.value!.frameworks.some((f) => f.id === pick.value))
    pick.value = data.value!.frameworks[0]?.id ?? '';
}
onMounted(() => load().catch((e) => app.toast(e.message, 'error')));

const fw = computed(() => data.value?.frameworks.find((f) => f.id === pick.value) ?? null);
const rows = computed(() =>
  (fw.value?.rows ?? []).filter(
    (r) =>
      (show.value === 'all' || r.status === show.value) &&
      (!q.value || `${r.id} ${r.title}`.toLowerCase().includes(q.value.toLowerCase())),
  ),
);
const groups = computed(() =>
  [...new Set(rows.value.map((r) => r.group))].map((g) => ({ g, rows: rows.value.filter((r) => r.group === g) })),
);
const STATUS: Record<Status, [string, string]> = {
  proven: ['Proven', 'ok'],
  in_progress: ['In progress', 'warn'],
  gap: ['Gap', 'danger'],
  not_applicable: ['Not applicable', ''],
};
const left = computed(() => (fw.value ? fw.value.total - fw.value.proven - fw.value.notApplicable : 0));

async function apply(r: Row) {
  const a = acting.value!;
  busy.value = true;
  try {
    const out =
      a.kind === 'map'
        ? await api(`/controls/${a.controlId}/refs`, { method: 'POST', body: { framework: fw.value!.id, ref: r.id } })
        : await api(`/engagements/${app.engagementId}/requirements/${fw.value!.id}`, {
            method: 'PUT',
            body: { ref: r.id, applicable: false, reason: a.reason },
          });
    Object.assign(fw.value!, (out as any).frameworks[0]);
    app.toast(a.kind === 'map' ? `${r.id} mapped` : `${r.id} marked not applicable`);
    acting.value = null;
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}
async function applicable(r: Row) {
  try {
    const out: any = await api(`/engagements/${app.engagementId}/requirements/${fw.value!.id}`, {
      method: 'PUT',
      body: { ref: r.id, applicable: true },
    });
    Object.assign(fw.value!, out.frameworks[0]);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
</script>

<template>
  <div v-if="!data" class="muted">Loading…</div>
  <div v-else-if="!data.frameworks.length" class="card empty"
    ><p>No framework in scope. Choose them under Settings > General.</p></div
  >
  <div v-else class="stack" style="gap: 16px">
    <p class="small muted"
      >Every requirement of each framework in scope, by its official number. A framework is
      <strong>fully met</strong> only when each requirement is <strong>proven</strong> (a control is in place, tested
      with a passing result and evidenced, and nothing failed) or <strong>not applicable</strong> with a reason. Titles
      are ARGUS's own short wording; read the official text for the detail.</p
    >

    <div class="segmented fw-pick" role="tablist" aria-label="Framework">
      <button v-for="f in data.frameworks" :key="f.id" type="button" :class="{ on: pick === f.id }" @click="pick = f.id"
        >{{ f.label }}
        <span class="faint small">{{ f.fullyMet ? '✓' : `${f.proven + f.notApplicable}/${f.total}` }}</span></button
      >
    </div>

    <template v-if="fw">
      <div class="kpi-strip">
        <div class="kpi" :class="fw.fullyMet ? 'tone-ok accent' : 'accent'"
          ><div class="kpi-top"
            ><span class="kpi-icon"><AppIcon :name="fw.fullyMet ? 'check' : 'controls'" :size="15" /></span
            ><span class="kpi-label">{{ fw.label }}</span></div
          ><div class="kpi-value">{{ fw.proven + fw.notApplicable }} / {{ fw.total }}</div
          ><div class="kpi-sub">{{
            fw.fullyMet ? 'Fully met' : `${left} requirement${left === 1 ? '' : 's'} still to meet`
          }}</div></div
        >
        <button class="kpi tone-ok" type="button" @click="show = show === 'proven' ? 'all' : 'proven'"
          ><div class="kpi-top"><span class="kpi-label">Proven</span></div
          ><div class="kpi-value">{{ fw.proven }}</div
          ><div class="kpi-sub">Tested, passing, evidenced</div></button
        >
        <button
          class="kpi"
          :class="fw.inProgress ? 'tone-warn' : ''"
          type="button"
          @click="show = show === 'in_progress' ? 'all' : 'in_progress'"
          ><div class="kpi-top"><span class="kpi-label">In progress</span></div
          ><div class="kpi-value">{{ fw.inProgress }}</div
          ><div class="kpi-sub">A control, not yet proven</div></button
        >
        <button
          class="kpi"
          :class="fw.gap ? 'tone-danger' : 'tone-ok'"
          type="button"
          @click="show = show === 'gap' ? 'all' : 'gap'"
          ><div class="kpi-top"><span class="kpi-label">Gaps</span></div
          ><div class="kpi-value">{{ fw.gap }}</div
          ><div class="kpi-sub">No control meets it yet</div></button
        >
        <button class="kpi" type="button" @click="show = show === 'not_applicable' ? 'all' : 'not_applicable'"
          ><div class="kpi-top"><span class="kpi-label">Not applicable</span></div
          ><div class="kpi-value">{{ fw.notApplicable }}</div
          ><div class="kpi-sub">With a reason</div></button
        >
      </div>

      <div class="row">
        <input
          v-model="q"
          class="input"
          style="max-width: 280px"
          placeholder="Find a requirement"
          aria-label="Find a requirement"
        />
        <span v-if="show !== 'all'" class="small"
          >Showing {{ STATUS[show][0].toLowerCase() }} only.
          <button class="linklike" @click="show = 'all'">Show all</button></span
        >
      </div>

      <section v-for="grp in groups" :key="grp.g" class="card req-group">
        <h2>{{ grp.g }}</h2>
        <div v-for="r in grp.rows" :key="r.id" class="req-row">
          <span class="mono small req-id">{{ r.id }}</span>
          <div class="req-body">
            <div class="spread"
              ><span>{{ r.title }}</span
              ><span class="badge" :class="STATUS[r.status][1]">{{ STATUS[r.status][0] }}</span></div
            >
            <div v-if="r.controls.length" class="small"
              >Met by
              <template v-for="(c, i) in r.controls" :key="c.id"
                ><span v-if="i">, </span><span class="mono">{{ c.key }}</span> {{ c.title
                }}<span v-if="c.proven" class="faint"> (proven)</span></template
              ></div
            >
            <div v-if="r.status === 'not_applicable'" class="small muted"
              >Not applicable: {{ r.scoping?.reason }} <span class="faint">({{ r.scoping?.by }})</span>
              <button v-if="app.can('manage_engagement')" class="linklike" @click="applicable(r)"
                >It applies</button
              ></div
            >
            <div v-else-if="r.next" class="small muted"
              >{{ r.next }}.<template v-if="r.status === 'gap' && r.library.length">
                The library control{{ r.library.length === 1 ? '' : 's' }}
                <span class="mono">{{ r.library.map((l) => l.code).join(', ') }}</span> meet{{
                  r.library.length === 1 ? 's' : ''
                }}
                it: add {{ r.library.length === 1 ? 'it' : 'one' }} to a use case, or map your own control.</template
              ><template v-else-if="r.status === 'gap'">
                No library control covers it; map one of your controls to it.</template
              ></div
            >
            <div
              v-if="r.status !== 'not_applicable' && (app.can('prepare') || app.can('manage_engagement'))"
              class="row small"
            >
              <button
                v-if="app.can('prepare') && data.controls.length"
                class="linklike"
                @click="acting = { id: r.id, kind: 'map', controlId: '', reason: '' }"
                >Map a control</button
              >
              <button
                v-if="app.can('manage_engagement') && r.status !== 'proven'"
                class="linklike"
                @click="acting = { id: r.id, kind: 'na', controlId: '', reason: '' }"
                >Not applicable</button
              >
            </div>
            <form v-if="acting?.id === r.id" class="row act" @submit.prevent="apply(r)">
              <select
                v-if="acting.kind === 'map'"
                v-model="acting.controlId"
                class="select sm"
                required
                aria-label="Control that meets it"
                ><option value="" disabled>Pick a control</option
                ><option v-for="c in data.controls" :key="c.id" :value="c.id">{{ c.key }} {{ c.title }}</option></select
              >
              <input
                v-else
                v-model="acting.reason"
                class="input"
                minlength="10"
                required
                placeholder="Why it doesn't apply to this client (an auditor will read this)"
                aria-label="Reason"
              />
              <button class="btn primary sm" :disabled="busy">{{
                acting.kind === 'map' ? 'Map' : 'Mark not applicable'
              }}</button>
              <button type="button" class="btn ghost sm" @click="acting = null">Cancel</button>
            </form>
          </div>
        </div>
      </section>
      <div v-if="!groups.length" class="card empty"><p>Nothing matches.</p></div>
    </template>
  </div>
</template>

<style scoped>
.fw-pick {
  flex-wrap: wrap;
}
.kpi-strip button.kpi {
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.req-group {
  gap: 0;
}
.req-row {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--line);
}
.req-row:first-of-type {
  border-top: 0;
}
.req-id {
  flex: none;
  width: 112px;
  color: var(--muted);
  padding-top: 2px;
}
.req-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.act {
  flex-wrap: wrap;
}
.act .input {
  flex: 1;
  min-width: 220px;
}
@media (max-width: 600px) {
  .req-row {
    flex-direction: column;
    gap: 4px;
  }
  .req-id {
    width: auto;
  }
}
</style>
