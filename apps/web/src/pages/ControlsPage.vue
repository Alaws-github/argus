<script setup lang="ts">
// Controls, five tabs: standards in plain English (coverage per framework), the register (controls per use case), the library
// (reusable controls mapped to standards), the Statement of Applicability, and
// the traceability matrix from obligation to evidence.
import { computed, onMounted, ref, watch } from 'vue';
import ControlUpload from '../components/ControlUpload.vue';
import Icon from '../components/Icon.vue';
import { useRoute } from 'vue-router';
import {
  CONTROL_DOMAINS, DOMAIN_LABELS, FRAMEWORK_LABELS,
  type EngagementControl, type FrameworkRefs, type LibraryControl, type Risk,
} from '@gh/shared';
import { api, csv, day, downloadText } from '../api';
import { useApp } from '../stores/app';
import StandardsTab from '../components/StandardsTab.vue';

const app = useApp();
const route = useRoute();
const tab = computed(() => route.params.tab as 'standards' | 'register' | 'library' | 'soa' | 'traceability');

const controls = ref<EngagementControl[]>([]);
const library = ref<LibraryControl[]>([]);
const soa = ref<(LibraryControl & { applicable: boolean | null; justification: string; decidedBy: string | null; decidedAt: string | null; inUse: number })[]>([]);
const trace = ref<any[]>([]);
const risks = ref<Risk[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  const E = await app.eid();
  try {
    if (tab.value === 'register') {
      [controls.value, risks.value, library.value] = await Promise.all([api(`/engagements/${E}/controls`), api(`/engagements/${E}/risks`), api('/library')]);
    } else if (tab.value === 'library') library.value = await api('/library');
    else if (tab.value === 'soa') {
      soa.value = await api(`/engagements/${E}/soa`);
      drafts.value = Object.fromEntries(soa.value.map((s) => [s.id, { applicable: s.applicable, justification: s.justification }]));
    } else trace.value = await api(`/engagements/${E}/traceability`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(tab, load);

const refsOf = (r: FrameworkRefs) => Object.entries(r ?? {}).flatMap(([k, v]) => (v as string[]).map((x) => `${FRAMEWORK_LABELS[k as keyof FrameworkRefs]} ${x}`));

// ---------------------------------------------------------------- register
const cardFilter = ref('');
const cardKeys = computed(() => [...new Set(controls.value.map((c) => c.cardKey).filter(Boolean))] as string[]);
const shownControls = computed(() => controls.value.filter((c) => !cardFilter.value || c.cardKey === cardFilter.value));
const statusPill: Record<string, string> = { proposed: '', designed: 'blue', operating: 'green', failed: 'coral' };

async function setOwner(c: EngagementControl, owner: string) {
  try {
    Object.assign(c, await api(`/controls/${c.id}`, { method: 'PATCH', body: { owner } }));
    app.toast(`${c.key} owner set`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}

const adding = ref(false);
const uploading = ref(false);
const form = ref({ title: '', objective: '', type: 'preventive', frequency: 'per change', owner: '', libraryId: '', cardId: '', riskIds: [] as string[] });
const formError = ref('');
const cardsForForm = computed(() => app.cards.filter((c) => c.tier));
const risksForCard = computed(() => risks.value.filter((r) => r.cardId === form.value.cardId));
function pickLibrary() {
  const l = library.value.find((x) => x.id === form.value.libraryId);
  if (l) Object.assign(form.value, { title: l.title, objective: l.objective, type: l.type, frequency: l.frequency });
}
async function addControl() {
  formError.value = '';
  try {
    const E = await app.eid();
    await api(`/engagements/${E}/controls`, {
      method: 'POST',
      body: { ...form.value, libraryId: form.value.libraryId || null, cardId: form.value.cardId || null, status: 'designed' },
    });
    adding.value = false;
    form.value = { title: '', objective: '', type: 'preventive', frequency: 'per change', owner: '', libraryId: '', cardId: '', riskIds: [] };
    await load();
  } catch (e: any) {
    formError.value = e.message;
  }
}

function exportRegister() {
  downloadText(
    `control-register-${app.engagement?.slug}.csv`,
    csv([
      ['Key', 'Control', 'Use case', 'Library', 'Type', 'Frequency', 'Owner', 'Status', 'Risks', 'Tests passed', 'Tests failed', 'Tests total', 'Evidence', 'Open issues'],
      ...controls.value.map((c) => [c.key, c.title, c.cardKey, c.libraryCode, c.type, c.frequency, c.owner, c.status, c.riskKeys.join(' '), c.tests.passed, c.tests.failed, c.tests.total, c.evidence, c.openIssues]),
    ]),
    'text/csv',
  );
}

// ----------------------------------------------------------------- library
const domain = ref('');
const open = ref<string | null>(null);
const shownLibrary = computed(() => library.value.filter((l) => !domain.value || l.domain === domain.value));

// ----------------------------------------------------------------------- SoA
const drafts = ref<Record<string, { applicable: boolean | null; justification: string }>>({});
const soaFilter = ref<'all' | 'undecided' | 'excluded'>('all');
const shownSoa = computed(() =>
  soa.value.filter((s) => soaFilter.value === 'all' || (soaFilter.value === 'undecided' ? s.applicable === null : s.applicable === false)),
);
const dirty = (s: (typeof soa.value)[number]) => drafts.value[s.id] && (drafts.value[s.id].applicable !== s.applicable || drafts.value[s.id].justification !== s.justification);
async function saveSoa(s: (typeof soa.value)[number]) {
  const d = drafts.value[s.id];
  if (d.applicable === null) return app.toast('Choose applicable or not applicable', 'error');
  try {
    await api(`/engagements/${await app.eid()}/soa/${s.id}`, { method: 'PUT', body: { applicable: d.applicable, justification: d.justification } });
    Object.assign(s, { applicable: d.applicable, justification: d.justification, decidedBy: app.user?.name, decidedAt: new Date().toISOString() });
    app.toast(`${s.code} decided`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
function exportSoa() {
  downloadText(
    `statement-of-applicability-${app.engagement?.slug}.csv`,
    csv([
      ['Code', 'Control', 'Domain', 'Applicable', 'Justification', 'Decided by', 'Decided on', 'Controls in use', 'References'],
      ...soa.value.map((s) => [s.code, s.title, DOMAIN_LABELS[s.domain], s.applicable === null ? 'Undecided' : s.applicable ? 'Yes' : 'No', s.justification, s.decidedBy, day(s.decidedAt), s.inUse, refsOf(s.refs).join('; ')]),
    ]),
    'text/csv',
  );
}

// -------------------------------------------------------------- traceability
const traceFilter = ref<'all' | 'gap' | 'partial' | 'covered'>('all');
const shownTrace = computed(() => trace.value.filter((t) => traceFilter.value === 'all' || t.status === traceFilter.value));
const traceCount = (s: string) => trace.value.filter((t) => t.status === s).length;
const tracePill: Record<string, string> = { covered: 'green', partial: 'amber', gap: 'coral', excluded: '' };
function exportTrace() {
  const rows: unknown[][] = [['Source', 'Ref', 'Obligation', 'Status', 'Library control', 'Engagement control', 'Use case', 'Control status', 'Tests passed', 'Tests failed', 'Evidence', 'Gap']];
  for (const t of trace.value)
    for (const l of t.links) {
      if (!l.controls.length) rows.push([t.source, t.ref, t.title, t.status, l.code, '', '', '', '', '', '', l.excluded ? `Excluded: ${l.justification}` : l.gap]);
      for (const c of l.controls) rows.push([t.source, t.ref, t.title, t.status, l.code, c.key, c.cardKey, c.status, c.tests.passed, c.tests.failed, c.evidence, l.gap ?? '']);
    }
  downloadText(`traceability-${app.engagement?.slug}.csv`, csv(rows), 'text/csv');
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Standards and controls</h1>
        <p>What the laws and frameworks ask for, the controls that meet them, and how far this engagement can prove it. Start with Standards for the plain-English picture.</p>
      </div>
    </div>
    <nav class="tabs">
      <RouterLink to="/controls/standards" :class="{ active: tab === 'standards' }">Standards</RouterLink>
      <RouterLink to="/controls/register" :class="{ active: tab === 'register' }">Our Controls</RouterLink>
      <RouterLink to="/controls/library" :class="{ active: tab === 'library' }">Control Library</RouterLink>
      <RouterLink v-if="app.mod('soa') || tab === 'soa'" to="/controls/soa" :class="{ active: tab === 'soa' }">What Applies</RouterLink>
      <RouterLink v-if="app.mod('soa') || tab === 'traceability'" to="/controls/traceability" :class="{ active: tab === 'traceability' }">Traceability</RouterLink>
    </nav>

    <div v-if="loading" class="muted">Loading…</div>

    <!-- Register -->
    <StandardsTab v-else-if="tab === 'standards'" :rows="trace" />

    <template v-else-if="tab === 'register'">
      <div class="toolbar">
        <div class="filters">
          <button class="filter" :class="{ active: !cardFilter }" @click="cardFilter = ''">All<span class="count">{{ controls.length }}</span></button>
          <button v-for="k in cardKeys" :key="k" class="filter" :class="{ active: cardFilter === k }" @click="cardFilter = k">{{ k }}<span class="count">{{ controls.filter((c) => c.cardKey === k).length }}</span></button>
        </div>
        <div class="row">
          <button class="btn" :disabled="!controls.length" @click="exportRegister">Download CSV</button>
          <button v-if="app.can('prepare')" class="btn" @click="uploading = true"><Icon name="upload" />Upload Controls</button>
          <button v-if="app.can('prepare')" class="btn primary" @click="adding = true"><Icon name="plus" />Add Control</button>
        </div>
      </div>
      <div v-if="!controls.length" class="card empty">
        <h2>No controls yet</h2>
        <p>The Control Designer proposes controls once a use case's classification is approved. You can also add them by hand.</p>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Key</th><th>Control</th><th>Use case</th><th>Treats</th><th>Owner</th><th>Status</th><th class="num">Tests</th><th class="num">Evidence</th><th class="num">Issues</th></tr></thead>
          <tbody>
            <tr v-for="c in shownControls" :key="c.id">
              <td class="mono faint">{{ c.key }}</td>
              <td style="min-width: 260px">
                <span v-if="c.libraryCode" class="code">{{ c.libraryCode }} </span>{{ c.title }}
                <div class="small faint">{{ c.type }} · {{ c.frequency }}</div>
              </td>
              <td><RouterLink v-if="c.cardKey" class="mono" :to="{ path: '/', query: { card: c.cardKey } }">{{ c.cardKey }}</RouterLink><span v-else class="faint">All</span></td>
              <td class="small mono">{{ c.riskKeys.join(' ') || '—' }}</td>
              <td><input class="input" style="min-width: 160px; padding: 4px 8px" :value="c.owner" :disabled="!app.can('prepare')" :aria-label="`${c.key} owner`" @change="setOwner(c, ($event.target as HTMLInputElement).value)" /></td>
              <td><span class="pill" :class="statusPill[c.status]"><span class="dot" />{{ c.status }}</span></td>
              <td class="num small"><RouterLink :to="{ path: '/testing/tests', query: { control: c.key } }">{{ c.tests.passed }}✓ {{ c.tests.failed }}✕ / {{ c.tests.total }}</RouterLink></td>
              <td class="num">{{ c.evidence }}</td>
              <td class="num"><span :class="{ error: c.openIssues }">{{ c.openIssues }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Library -->
    <template v-else-if="tab === 'library'">
      <div class="toolbar">
        <div class="filters">
          <button class="filter" :class="{ active: !domain }" @click="domain = ''">All<span class="count">{{ library.length }}</span></button>
          <template v-for="d in CONTROL_DOMAINS" :key="d">
            <button v-if="library.some((l) => l.domain === d)" class="filter" :class="{ active: domain === d }" @click="domain = d">{{ DOMAIN_LABELS[d] }}</button>
          </template>
        </div>
      </div>
      <p class="small muted" style="margin-bottom: 12px">Reusable controls, each mapped to public standards. The Control Designer picks from here; your Statement of Applicability says which apply to this engagement.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Control</th><th>Type</th><th>Frequency</th><th>Maps to</th></tr></thead>
          <tbody>
            <template v-for="l in shownLibrary" :key="l.id">
              <tr style="cursor: pointer" @click="open = open === l.id ? null : l.id">
                <td class="code">{{ l.code }}</td>
                <td style="min-width: 240px">{{ l.title }}<div class="small faint">{{ DOMAIN_LABELS[l.domain] }}</div></td>
                <td class="small">{{ l.type }}</td>
                <td class="small">{{ l.frequency }}</td>
                <td><span class="mini"><span v-for="r in refsOf(l.refs)" :key="r" class="chip">{{ r }}</span></span></td>
              </tr>
              <tr v-if="open === l.id">
                <td />
                <td colspan="4">
                  <dl class="kv">
                    <dt>Objective</dt><dd>{{ l.objective }}</dd>
                    <dt>Test procedure</dt><dd>{{ l.testProcedure }}</dd>
                    <dt>Evidence expected</dt><dd>{{ l.evidenceExpected }}</dd>
                    <dt>Treats</dt><dd>{{ l.riskCategories.map((c) => c.replace('_', ' ')).join(', ') }}</dd>
                  </dl>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>

    <!-- SoA -->
    <template v-else-if="tab === 'soa'">
      <div class="toolbar">
        <div class="filters">
          <button class="filter" :class="{ active: soaFilter === 'all' }" @click="soaFilter = 'all'">All<span class="count">{{ soa.length }}</span></button>
          <button class="filter" :class="{ active: soaFilter === 'undecided' }" @click="soaFilter = 'undecided'">Undecided<span class="count">{{ soa.filter((s) => s.applicable === null).length }}</span></button>
          <button class="filter" :class="{ active: soaFilter === 'excluded' }" @click="soaFilter = 'excluded'">Not applicable<span class="count">{{ soa.filter((s) => s.applicable === false).length }}</span></button>
        </div>
        <button class="btn" @click="exportSoa">Download CSV</button>
      </div>
      <p class="small muted" style="margin-bottom: 12px">ISO/IEC 42001 asks for a Statement of Applicability: every Annex A control, whether it applies, and why. Exclusions need a reason an auditor would accept.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Control</th><th>Applies</th><th>Justification</th><th>Decided</th><th class="num">In use</th><th /></tr></thead>
          <tbody>
            <tr v-for="s in shownSoa" :key="s.id">
              <td class="code">{{ s.code }}</td>
              <td style="min-width: 220px">{{ s.title }}</td>
              <td>
                <div class="segmented">
                  <button :class="{ on: drafts[s.id].applicable === true }" :disabled="!app.can('manage_engagement')" @click="drafts[s.id].applicable = true">Yes</button>
                  <button :class="{ on: drafts[s.id].applicable === false }" :disabled="!app.can('manage_engagement')" @click="drafts[s.id].applicable = false">No</button>
                </div>
              </td>
              <td style="min-width: 260px"><input v-model="drafts[s.id].justification" class="input" style="padding: 4px 8px" :disabled="!app.can('manage_engagement')" :aria-label="`${s.code} justification`" placeholder="Why it does or doesn't apply" /></td>
              <td class="small faint">{{ s.decidedBy ? `${s.decidedBy}, ${day(s.decidedAt)}` : '—' }}</td>
              <td class="num">{{ s.inUse }}</td>
              <td><button v-if="dirty(s)" class="btn sm primary" @click="saveSoa(s)">Save</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Traceability -->
    <template v-else>
      <div class="toolbar">
        <div class="filters">
          <button class="filter" :class="{ active: traceFilter === 'all' }" @click="traceFilter = 'all'">All<span class="count">{{ trace.length }}</span></button>
          <button class="filter" :class="{ active: traceFilter === 'gap' }" @click="traceFilter = 'gap'">Gap<span class="count">{{ traceCount('gap') }}</span></button>
          <button class="filter" :class="{ active: traceFilter === 'partial' }" @click="traceFilter = 'partial'">Partial<span class="count">{{ traceCount('partial') }}</span></button>
          <button class="filter" :class="{ active: traceFilter === 'covered' }" @click="traceFilter = 'covered'">Covered<span class="count">{{ traceCount('covered') }}</span></button>
        </div>
        <button class="btn" @click="exportTrace">Download CSV</button>
      </div>
      <p class="small muted" style="margin-bottom: 12px">A requirements traceability matrix: each obligation, the library controls that meet it, and the controls in place with their tests and evidence. Covered means a control exists, has a test and evidence, and nothing failed.</p>
      <div class="table-wrap trace">
        <div class="h">Obligation</div><div class="h">Library control</div><div class="h">In place</div>
        <template v-for="t in shownTrace" :key="t.id">
          <template v-for="(l, n) in t.links" :key="l.code">
            <div :style="n ? 'border-bottom-color: transparent' : ''">
              <template v-if="!n">
                <div class="row"><span class="pill" :class="tracePill[t.status]"><span class="dot" />{{ t.status }}</span><span class="small faint">{{ t.source }} {{ t.ref }}</span></div>
                <div style="margin-top: 4px; font-weight: 600">{{ t.title }}</div>
                <div class="small faint">{{ t.summary }}</div>
              </template>
            </div>
            <div><span class="code">{{ l.code }}</span> {{ l.title }}</div>
            <div class="small">
              <div v-if="l.excluded" class="faint">Not applicable: {{ l.justification }}</div>
              <div v-for="c in l.controls" :key="c.id" class="row" style="flex-wrap: wrap">
                <span class="mono">{{ c.key }}</span><span class="mono faint">{{ c.cardKey }}</span>
                <span class="pill" :class="statusPill[c.status]">{{ c.status }}</span>
                <span class="faint">{{ c.tests.passed }}✓ {{ c.tests.failed }}✕ · {{ c.evidence }} evidence</span>
              </div>
              <div v-if="l.gap" class="error">{{ l.gap }}</div>
            </div>
          </template>
        </template>
      </div>
    </template>

    <ControlUpload v-if="uploading" @close="uploading = false" @done="uploading = false; load()" />
    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="addControl">
        <div class="spread"><h2>Add a control</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div>
        <label class="field"><span>Start from the library (optional)</span>
          <select v-model="form.libraryId" class="select" @change="pickLibrary"><option value="">A control of your own</option><option v-for="l in library" :key="l.id" :value="l.id">{{ l.code }} {{ l.title }}</option></select>
        </label>
        <label class="field"><span>Title</span><input v-model="form.title" class="input" required minlength="3" /></label>
        <label class="field"><span>Objective</span><textarea v-model="form.objective" class="textarea" /></label>
        <div class="split">
          <label class="field"><span>Type</span><select v-model="form.type" class="select"><option>preventive</option><option>detective</option><option>corrective</option></select></label>
          <label class="field"><span>Frequency</span><input v-model="form.frequency" class="input" /></label>
        </div>
        <label class="field"><span>Owner</span><input v-model="form.owner" class="input" placeholder="A role, e.g. Head of IT Security" /></label>
        <label class="field"><span>Use case</span>
          <select v-model="form.cardId" class="select"><option value="">Applies to the whole engagement</option><option v-for="c in cardsForForm" :key="c.id" :value="c.id">{{ c.key }} {{ c.title }}</option></select>
        </label>
        <div v-if="risksForCard.length" class="field"><span>Risks it treats</span>
          <label v-for="r in risksForCard" :key="r.id" class="check-row"><input v-model="form.riskIds" type="checkbox" :value="r.id" />{{ r.key }} {{ r.title }}</label>
        </div>
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="row"><button class="btn primary">Add control</button><button type="button" class="btn" @click="adding = false">Cancel</button></div>
      </form>
    </template>
  </div>
</template>
