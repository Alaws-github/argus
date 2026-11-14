<script setup lang="ts">
// v1.7.3: one control, many frameworks. Shows how much of each framework in
// scope this engagement's controls cover, which references each control
// meets, and suggests a library match for the client's own controls so they
// inherit every framework's references at once. A person accepts each match.
import { computed, onMounted, ref } from 'vue';
import { FRAMEWORK_LABELS } from '@gh/shared';
import { api } from '../api';
import { useApp } from '../stores/app';
import AppIcon from './AppIcon.vue';

interface Sug {
  code: string;
  title: string;
  score: number;
  frameworks: string[];
}
interface Ctl {
  id: string;
  key: string;
  title: string;
  cardKey: string | null;
  libraryCode: string | null;
  mapped: boolean;
  refs: Record<string, string[]>;
  frameworks: number;
  suggestions: Sug[];
}
interface Fw {
  id: string;
  label: string;
  total: number;
  covered: number;
  pct: number;
  missing: string[];
}
const app = useApp();
const data = ref<{
  frameworks: Fw[];
  controls: Ctl[];
  summary: { controls: number; unmapped: number; multi: number };
} | null>(null);
const show = ref<'all' | 'unmapped'>('all');
const openFw = ref<string | null>(null);
const busy = ref('');

async function load() {
  data.value = await api(`/engagements/${await app.eid()}/harmonization`);
}
onMounted(() => load().catch((e) => app.toast(e.message, 'error')));

const rows = computed(() => (data.value?.controls ?? []).filter((c) => show.value === 'all' || !c.mapped));
async function accept(c: Ctl, code: string) {
  busy.value = c.id;
  try {
    await api(`/controls/${c.id}/map`, { method: 'POST', body: { libraryCode: code } });
    app.toast(`${c.key} mapped to ${code}. It now counts for every framework ${code} meets.`);
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busy.value = '';
  }
}
const label = (k: string) => (FRAMEWORK_LABELS as Record<string, string>)[k] ?? k;
</script>

<template>
  <div v-if="!data" class="muted">Loading…</div>
  <div v-else class="stack" style="gap: 16px">
    <p class="small muted"
      >Map each control once and it counts for every framework at the same time. Upload the client's own controls on Our
      Controls, then accept a suggested library match here: the control keeps its own wording and gains the library
      control's references to NIST AI RMF, ISO/IEC 42001, the EU AI Act, HIPAA and the rest.</p
    >

    <div class="kpi-strip">
      <div class="kpi accent"
        ><div class="kpi-top"
          ><span class="kpi-icon"><AppIcon name="controls" :size="15" /></span
          ><span class="kpi-label">Controls</span></div
        ><div class="kpi-value">{{ data.summary.controls }}</div
        ><div class="kpi-sub">In this engagement</div></div
      >
      <div class="kpi tone-ok"
        ><div class="kpi-top"
          ><span class="kpi-icon"><AppIcon name="check" :size="15" /></span
          ><span class="kpi-label">Count twice or more</span></div
        ><div class="kpi-value">{{ data.summary.multi }}</div
        ><div class="kpi-sub">Meet two or more frameworks</div></div
      >
      <div class="kpi" :class="data.summary.unmapped ? 'tone-warn' : 'tone-ok'"
        ><div class="kpi-top"
          ><span class="kpi-icon"><AppIcon name="alert" :size="15" /></span
          ><span class="kpi-label">Not mapped</span></div
        ><div class="kpi-value">{{ data.summary.unmapped }}</div
        ><div class="kpi-sub">Count for no framework yet</div></div
      >
    </div>

    <div class="fw-cover">
      <button
        v-for="f in data.frameworks"
        :key="f.id"
        type="button"
        class="card fw-tile"
        :aria-expanded="openFw === f.id"
        @click="openFw = openFw === f.id ? null : f.id"
      >
        <div class="spread"
          ><strong>{{ f.label }}</strong
          ><span class="mono small">{{ f.pct }}%</span></div
        >
        <div class="coverage-bar" role="img" :aria-label="`${f.covered} of ${f.total} requirements have a control`"
          ><span class="ok" :style="{ width: f.pct + '%' }"
        /></div>
        <span class="small faint">{{ f.covered }} of {{ f.total }} requirements have a control</span>
        <span v-if="openFw === f.id && f.missing.length" class="small muted"
          >Not covered yet: <span class="mono">{{ f.missing.join(', ') }}</span></span
        >
      </button>
    </div>

    <div class="spread">
      <h2 style="margin: 0">Controls and the frameworks they meet</h2>
      <div class="segmented">
        <button :class="{ on: show === 'all' }" @click="show = 'all'">All</button>
        <button :class="{ on: show === 'unmapped' }" @click="show = 'unmapped'"
          >Not mapped ({{ data.summary.unmapped }})</button
        >
      </div>
    </div>
    <div v-if="!rows.length" class="card empty"
      ><p>{{ show === 'unmapped' ? 'Every control is mapped.' : 'No controls yet.' }}</p></div
    >
    <div v-else class="table-wrap">
      <table class="harmonize">
        <thead
          ><tr
            ><th>Control</th><th v-for="f in data.frameworks" :key="f.id">{{ f.label }}</th></tr
          ></thead
        >
        <tbody>
          <tr v-for="c in rows" :key="c.id">
            <td>
              <span class="mono faint small">{{ c.key }}</span> {{ c.title }}
              <div class="small faint">{{
                c.libraryCode ? `Mapped to ${c.libraryCode}` : c.cardKey ? `From ${c.cardKey}` : "Client's own control"
              }}</div>
              <div v-if="!c.libraryCode && c.suggestions.length && app.can('prepare')" class="sug">
                <span class="small muted">Looks like:</span>
                <button
                  v-for="s in c.suggestions"
                  :key="s.code"
                  class="btn sm"
                  :disabled="busy === c.id"
                  :title="`${s.title}. Meets ${s.frameworks.map(label).join(', ') || 'no framework in scope'}`"
                  @click="accept(c, s.code)"
                  >{{ s.code }} {{ s.title }} <span class="faint">{{ s.score }}%</span></button
                >
              </div>
              <div v-else-if="!c.libraryCode && !c.mapped" class="small faint"
                >No close library match. Map it by hand from the Control Library.</div
              >
            </td>
            <td
              v-for="f in data.frameworks"
              :key="f.id"
              class="mono small"
              :class="{ faint: !(c.refs[f.id] ?? []).length }"
              >{{ (c.refs[f.id] ?? []).join(', ') || '·' }}</td
            >
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.fw-cover {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.fw-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  font: inherit;
  color: var(--text);
  cursor: pointer;
  padding: 14px;
}
.coverage-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--line);
  overflow: hidden;
}
.coverage-bar .ok {
  display: block;
  height: 100%;
  background: var(--ok);
}
.sug {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
}
.harmonize td:first-child {
  min-width: 280px;
}
.harmonize td {
  vertical-align: top;
}
</style>
