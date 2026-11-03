<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { TEST_STATUS_LABELS, type ControlTest, type EngagementControl, type Evidence } from '@gh/shared';
import { api, csv, downloadText, when } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const route = useRoute();
const tab = computed(() => route.params.tab as 'tests' | 'evidence');

const tests = ref<ControlTest[]>([]);
const evidence = ref<Evidence[]>([]);
const controls = ref<EngagementControl[]>([]);
const verified = ref<Record<string, { ok: boolean; message: string }>>({});
const loading = ref(true);

async function load() {
  const E = await app.eid();
  try {
    [tests.value, evidence.value, controls.value] = await Promise.all([api(`/engagements/${E}/tests`), api(`/engagements/${E}/evidence`), api(`/engagements/${E}/controls`)]);
    if (selected.value) selected.value = tests.value.find((t) => t.id === selected.value!.id) ?? null;
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// ------------------------------------------------------------------- tests
const status = ref<'all' | 'open' | 'review' | 'failed'>('all');
const controlKey = ref((route.query.control as string) || '');
watch(() => route.query.control, (v) => (controlKey.value = (v as string) || ''));
const isOpen = (t: ControlTest) => !['passed', 'failed'].includes(t.status);
const needsReview = (t: ControlTest) => !isOpen(t) && !t.reviewedBy;
const shown = computed(() =>
  tests.value.filter(
    (t) =>
      (!controlKey.value || t.controlKey === controlKey.value) &&
      (status.value === 'all' || (status.value === 'open' ? isOpen(t) : status.value === 'review' ? needsReview(t) : t.status === 'failed')),
  ),
);
const pill: Record<string, string> = { not_started: '', in_progress: 'blue', passed: 'green', failed: 'coral', blocked: 'amber' };

const selected = ref<ControlTest | null>(null);
const draft = ref({ procedure: '', population: '', sampleSize: null as number | null, expected: '', actual: '', exceptions: 0 });
// Set when the preparer starts from the Control Tester's draft; recorded in the audit trail.
const fromDraft = ref(false);
function useDraft() {
  const d = selected.value!.draft!;
  draft.value.actual = d.actual;
  draft.value.exceptions = d.exceptions;
  fromDraft.value = true;
  app.toast('Draft copied in. Check it against the evidence before you conclude.');
}
const PROPOSED: Record<string, string> = { pass: 'Pass', fail: 'Fail', cannot_assess: "Can't assess" };
const busy = ref(false);
const err = ref('');
function select(t: ControlTest) {
  selected.value = t;
  fromDraft.value = false;
  err.value = '';
  draft.value = { procedure: t.procedure, population: t.population, sampleSize: t.sampleSize, expected: t.expected, actual: t.actual, exceptions: t.exceptions };
}
async function save(conclude?: 'passed' | 'failed' | 'in_progress') {
  if (!selected.value) return;
  err.value = '';
  busy.value = true;
  try {
    const body: any = selected.value.reviewedBy ? {} : { ...draft.value };
    if (conclude) body.status = conclude;
    if (conclude === 'passed') body.exceptions = draft.value.exceptions || 0;
    if ((conclude === 'passed' || conclude === 'failed') && fromDraft.value) body.fromDraft = true;
    selected.value = await api(`/tests/${selected.value.id}`, { method: 'PATCH', body });
    app.toast(conclude && conclude !== 'in_progress' ? `${selected.value!.key} ${conclude}. Someone else now reviews it.` : 'Saved');
    await load();
  } catch (e: any) {
    err.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function review() {
  if (!selected.value) return;
  err.value = '';
  try {
    selected.value = await api(`/tests/${selected.value.id}/review`, { method: 'POST', body: {} });
    app.toast(`${selected.value!.key} reviewed`);
    await load();
  } catch (e: any) {
    err.value = e.message;
  }
}
async function raiseIssue() {
  const t = selected.value!;
  const title = window.prompt('Issue title', `${t.controlTitle}: ${t.exceptions} exception${t.exceptions === 1 ? '' : 's'} in testing`);
  if (!title) return;
  try {
    const i = await api(`/engagements/${await app.eid()}/issues`, {
      method: 'POST',
      body: { title, description: t.actual, severity: 'high', controlId: t.controlId, testId: t.id },
    });
    app.toast(`${i.key} raised. Track it on the Issues page.`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}

const adding = ref(false);
const form = ref({ controlId: '', kind: 'operating', title: '', procedure: '', population: '', sampleSize: null as number | null, expected: '' });
async function addTest() {
  try {
    const t = await api(`/engagements/${await app.eid()}/tests`, { method: 'POST', body: form.value });
    adding.value = false;
    form.value = { controlId: '', kind: 'operating', title: '', procedure: '', population: '', sampleSize: null, expected: '' };
    await load();
    select(tests.value.find((x) => x.id === t.id)!);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
function retest() {
  const t = selected.value!;
  form.value = { controlId: t.controlId, kind: 'retest', title: `Retest: ${t.title}`, procedure: t.procedure, population: '', sampleSize: t.sampleSize, expected: t.expected };
  adding.value = true;
}

// ---------------------------------------------------------------- evidence
const evForm = ref({ kind: 'file' as 'file' | 'link' | 'note', title: '', url: '', note: '', source: '' });
const fileInput = ref<HTMLInputElement | null>(null);
const evFor = computed(() => evidence.value.filter((e) => e.testId === selected.value?.id));
async function addEvidence() {
  const t = selected.value!;
  const body: any = { engagementId: await app.eid(), testId: t.id, controlId: t.controlId, title: evForm.value.title, kind: evForm.value.kind, source: evForm.value.source };
  if (evForm.value.kind === 'file') {
    const f = fileInput.value?.files?.[0];
    if (!f) return app.toast('Choose a file', 'error');
    if (f.size > 10 * 1024 * 1024) return app.toast('Files up to 10 MB', 'error');
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    Object.assign(body, { filename: f.name, mime: f.type || 'application/octet-stream', dataBase64: btoa(bin) });
    if (!body.title) body.title = f.name;
  } else if (evForm.value.kind === 'link') body.url = evForm.value.url;
  else body.note = evForm.value.note;
  try {
    const e = await api<Evidence>('/evidence', { method: 'POST', body });
    app.toast(`${e.key} stored, sha256 ${e.sha256.slice(0, 10)}…`);
    evForm.value = { kind: evForm.value.kind, title: '', url: '', note: '', source: '' };
    if (fileInput.value) fileInput.value.value = '';
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function verify(e: Evidence) {
  try {
    verified.value[e.id] = await api(`/evidence/${e.id}/verify`);
  } catch (x: any) {
    app.toast(x.message, 'error');
  }
}
const evTarget = (e: Evidence) => {
  const t = tests.value.find((x) => x.id === e.testId);
  const c = controls.value.find((x) => x.id === e.controlId);
  return [c?.key, t?.key].filter(Boolean).join(' · ') || '—';
};
function exportTests() {
  downloadText(
    `tests-${app.engagement?.slug}.csv`,
    csv([
      ['Key', 'Control', 'Kind', 'Test', 'Population', 'Sample', 'Expected', 'Actual', 'Exceptions', 'Status', 'Prepared by', 'Reviewed by', 'Evidence'],
      ...tests.value.map((t) => [t.key, `${t.controlKey} ${t.controlTitle}`, t.kind, t.title, t.population, t.sampleSize, t.expected, t.actual, t.exceptions, t.status, t.preparedBy, t.reviewedBy, t.evidence]),
    ]),
    'text/csv',
  );
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Testing</h1>
        <p>Test each control the way you'd test software: a procedure, a sample, an expected and an actual result. Whoever prepares a test can't review it.</p>
      </div>
    </div>
    <nav class="tabs">
      <RouterLink to="/testing/tests" :class="{ active: tab === 'tests' }">Tests</RouterLink>
      <RouterLink to="/testing/evidence" :class="{ active: tab === 'evidence' }">Evidence vault</RouterLink>
    </nav>
    <div v-if="loading" class="muted">Loading…</div>

    <template v-else-if="tab === 'tests'">
      <div class="toolbar">
        <div class="filters">
          <button class="filter" :class="{ active: status === 'all' }" @click="status = 'all'">All<span class="count">{{ tests.length }}</span></button>
          <button class="filter" :class="{ active: status === 'open' }" @click="status = 'open'">To do<span class="count">{{ tests.filter(isOpen).length }}</span></button>
          <button class="filter" :class="{ active: status === 'review' }" @click="status = 'review'">Needs review<span class="count">{{ tests.filter(needsReview).length }}</span></button>
          <button class="filter" :class="{ active: status === 'failed' }" @click="status = 'failed'">Failed<span class="count">{{ tests.filter((t) => t.status === 'failed').length }}</span></button>
          <button v-if="controlKey" class="filter active" @click="controlKey = ''">{{ controlKey }} ✕</button>
        </div>
        <div class="row">
          <button class="btn" :disabled="!tests.length" @click="exportTests">Download CSV</button>
          <button v-if="app.can('prepare')" class="btn primary" :disabled="!controls.length" @click="adding = true">Add test</button>
        </div>
      </div>
      <div v-if="!tests.length" class="card empty">
        <h2>No tests yet</h2>
        <p>Approving a control design creates a draft test for each control. You can add your own too.</p>
      </div>
      <div v-else-if="!shown.length" class="card empty"><h2>Nothing in this view</h2><p>Try another filter.</p></div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Key</th><th>Test</th><th>Control</th><th>Status</th><th>Prepared</th><th>Reviewed</th><th class="num">Evidence</th></tr></thead>
          <tbody>
            <tr v-for="t in shown" :key="t.id" style="cursor: pointer" :class="{ selected: selected?.id === t.id }" @click="select(t)">
              <td class="mono faint">{{ t.key }}</td>
              <td style="min-width: 240px">{{ t.title }}<div class="small faint">{{ t.kind }}<template v-if="t.sampleSize"> · sample {{ t.sampleSize }}</template></div></td>
              <td class="small"><span class="mono">{{ t.controlKey }}</span> {{ t.controlTitle }}</td>
              <td><span class="pill" :class="pill[t.status]"><span class="dot" />{{ TEST_STATUS_LABELS[t.status] }}</span><span v-if="t.draft && !['passed', 'failed'].includes(t.status)" class="badge accent" style="margin-left: 4px" title="The Control Tester drafted a result">Draft</span></td>
              <td class="small">{{ t.preparedBy ?? '—' }}</td>
              <td class="small"><span v-if="t.reviewedBy">{{ t.reviewedBy }}</span><span v-else-if="needsReview(t)" class="badge warn">Waiting</span><span v-else class="faint">—</span></td>
              <td class="num">{{ t.evidence }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <p class="small muted" style="margin-bottom: 12px">Each item is fingerprinted with SHA-256 when it's collected. Verify recomputes the hash from what's stored, so you can show it hasn't changed since.</p>
      <div v-if="!evidence.length" class="card empty"><h2>No evidence yet</h2><p>Attach evidence from a test, or it arrives automatically from evaluation runs.</p></div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Key</th><th>Evidence</th><th>For</th><th>SHA-256</th><th>Collected</th><th /></tr></thead>
          <tbody>
            <tr v-for="e in evidence" :key="e.id">
              <td class="mono faint">{{ e.key }}</td>
              <td style="min-width: 220px">
                {{ e.title }}
                <div class="small faint">{{ e.kind }}<template v-if="e.filename"> · {{ e.filename }}</template><template v-if="e.source"> · {{ e.source }}</template></div>
                <a v-if="e.url" :href="e.url" target="_blank" rel="noopener" class="small">{{ e.url }}</a>
              </td>
              <td class="small mono">{{ evTarget(e) }}</td>
              <td class="mono small" :title="e.sha256">{{ e.sha256.slice(0, 12) }}…</td>
              <td class="small">{{ e.collectedBy }}<div class="faint">{{ when(e.collectedAt) }}</div></td>
              <td>
                <div class="row">
                  <a v-if="e.kind === 'file' || e.kind === 'run'" class="btn sm" :href="`/api/evidence/${e.id}/download`">Download</a>
                  <button class="btn sm" @click="verify(e)">Verify</button>
                </div>
                <div v-if="verified[e.id]" class="small" :class="verified[e.id].ok ? '' : 'error'" :style="verified[e.id].ok ? 'color: var(--ok)' : ''">{{ verified[e.id].message }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Test panel -->
    <template v-if="selected && tab === 'tests'">
      <div class="backdrop" @click="selected = null" />
      <aside class="panel" role="dialog" :aria-label="selected.title">
        <div class="spread">
          <div class="row"><span class="mono faint">{{ selected.key }}</span><span class="pill" :class="pill[selected.status]"><span class="dot" />{{ TEST_STATUS_LABELS[selected.status] }}</span></div>
          <button class="btn ghost sm" aria-label="Close" @click="selected = null">✕</button>
        </div>
        <div>
          <h1 style="font-size: 19px">{{ selected.title }}</h1>
          <p class="small muted" style="margin-top: 4px"><span class="mono">{{ selected.controlKey }}</span> {{ selected.controlTitle }} · {{ selected.kind }} test</p>
        </div>

        <div v-if="needsReview(selected)" class="notice warn">
          <h3>Waiting for review</h3>
          <p class="small">Prepared by {{ selected.preparedBy }}. A reviewer who didn't prepare it signs it off.</p>
          <div v-if="app.can('approve') && selected.preparedBy !== app.user?.name"><button class="btn primary" @click="review">Review and sign off</button></div>
          <p v-else-if="selected.preparedBy === app.user?.name" class="small faint">You prepared this, so someone else reviews it.</p>
        </div>
        <div v-else-if="selected.reviewedBy" class="notice" :class="selected.status === 'failed' ? 'danger' : ''">
          <h3>{{ selected.status === 'failed' ? 'Failed and reviewed' : 'Passed and reviewed' }}</h3>
          <p class="small">Prepared by {{ selected.preparedBy }}, reviewed by {{ selected.reviewedBy }} {{ when(selected.reviewedAt) }}. The result is locked.</p>
          <div class="row">
            <button v-if="selected.status === 'failed' && app.can('prepare')" class="btn" @click="raiseIssue">Raise an issue</button>
            <button v-if="selected.status === 'failed' && app.can('prepare')" class="btn" @click="retest">Add a retest</button>
          </div>
        </div>

        <div v-if="selected.draft && !selected.reviewedBy && !['passed', 'failed'].includes(selected.status)" class="notice">
          <div class="spread">
            <h3>Control Tester's draft</h3>
            <span class="pill" :class="{ pass: 'green', fail: 'coral', cannot_assess: '' }[selected.draft.proposed]">{{ PROPOSED[selected.draft.proposed] }}</span>
          </div>
          <p class="small faint">Drafted by an agent on {{ selected.draft.model }}. It isn't a result: you decide, and you're recorded as the preparer.</p>
          <p v-if="selected.draft.actual" class="small"><strong>Actual:</strong> {{ selected.draft.actual }}</p>
          <p class="small"><strong>Exceptions:</strong> {{ selected.draft.exceptions }} · <strong>Relied on:</strong> <span class="mono">{{ selected.draft.evidenceKeys.join(' ') || 'nothing' }}</span></p>
          <p class="small muted">{{ selected.draft.reasoning }}</p>
          <div v-if="app.can('prepare') && selected.draft.actual"><button class="btn sm" @click="useDraft">Start from this draft</button></div>
        </div>
        <p v-else-if="selected.draft?.used" class="small faint">The preparer started from the Control Tester's draft ({{ PROPOSED[selected.draft.proposed] }}). That's in the audit trail.</p>

        <section class="section">
          <span class="label-caps">Test design</span>
          <label class="field"><span>Procedure</span><textarea v-model="draft.procedure" class="textarea" :disabled="!!selected.reviewedBy" /></label>
          <div class="split">
            <label class="field"><span>Population</span><input v-model="draft.population" class="input" :disabled="!!selected.reviewedBy" placeholder="e.g. All declines, Oct 2026" /></label>
            <label class="field"><span>Sample size</span><input v-model.number="draft.sampleSize" type="number" min="0" class="input" :disabled="!!selected.reviewedBy" /></label>
          </div>
          <label class="field"><span>Expected result</span><input v-model="draft.expected" class="input" :disabled="!!selected.reviewedBy" /></label>
        </section>
        <section class="section">
          <span class="label-caps">Result</span>
          <label class="field"><span>Actual result</span><textarea v-model="draft.actual" class="textarea" :disabled="!!selected.reviewedBy" placeholder="What you found" /></label>
          <label class="field"><span>Exceptions found</span><input v-model.number="draft.exceptions" type="number" min="0" class="input" style="max-width: 120px" :disabled="!!selected.reviewedBy" /></label>
          <p v-if="err" class="error">{{ err }}</p>
          <div v-if="!selected.reviewedBy && app.can('prepare')" class="row" style="flex-wrap: wrap">
            <button class="btn" :disabled="busy" @click="save()">Save</button>
            <button class="btn primary" :disabled="busy || draft.exceptions > 0" :title="draft.exceptions > 0 ? 'A test with exceptions can\'t pass' : ''" @click="save('passed')">Conclude: passed</button>
            <button class="btn danger" :disabled="busy" @click="save('failed')">Conclude: failed</button>
          </div>
        </section>

        <section class="section">
          <span class="label-caps">Evidence ({{ evFor.length }})</span>
          <div v-for="e in evFor" :key="e.id" class="spread small">
            <span><span class="mono faint">{{ e.key }}</span> {{ e.title }}</span>
            <span class="mono faint" :title="e.sha256">{{ e.sha256.slice(0, 10) }}…</span>
          </div>
          <form v-if="app.can('prepare')" class="stack" style="gap: 8px" @submit.prevent="addEvidence">
            <div class="segmented">
              <button type="button" :class="{ on: evForm.kind === 'file' }" @click="evForm.kind = 'file'">File</button>
              <button type="button" :class="{ on: evForm.kind === 'link' }" @click="evForm.kind = 'link'">Link</button>
              <button type="button" :class="{ on: evForm.kind === 'note' }" @click="evForm.kind = 'note'">Note</button>
            </div>
            <input v-if="evForm.kind === 'file'" ref="fileInput" type="file" class="input" aria-label="Evidence file" />
            <input v-if="evForm.kind === 'link'" v-model="evForm.url" type="url" class="input" placeholder="https://…" aria-label="Evidence link" />
            <textarea v-if="evForm.kind === 'note'" v-model="evForm.note" class="textarea" placeholder="Walkthrough notes, inquiry responses…" aria-label="Evidence note" />
            <input v-model="evForm.title" class="input" :placeholder="evForm.kind === 'file' ? 'Title (defaults to the file name)' : 'Title'" aria-label="Evidence title" />
            <input v-model="evForm.source" class="input" placeholder="Source, e.g. Loan system export, J. Brown" aria-label="Evidence source" />
            <div><button class="btn">Attach evidence</button></div>
          </form>
        </section>
      </aside>
    </template>

    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="addTest">
        <div class="spread"><h2>Add a test</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div>
        <label class="field"><span>Control</span>
          <select v-model="form.controlId" class="select" required><option value="" disabled>Choose a control</option><option v-for="c in controls" :key="c.id" :value="c.id">{{ c.key }} {{ c.cardKey ? `(${c.cardKey})` : '' }} {{ c.title }}</option></select>
        </label>
        <div class="split">
          <label class="field"><span>Kind</span><select v-model="form.kind" class="select"><option value="design">Design</option><option value="operating">Operating effectiveness</option><option value="automated">Automated</option><option value="retest">Retest</option></select></label>
          <label class="field"><span>Sample size</span><input v-model.number="form.sampleSize" type="number" min="0" class="input" /></label>
        </div>
        <label class="field"><span>Title</span><input v-model="form.title" class="input" required minlength="3" /></label>
        <label class="field"><span>Procedure</span><textarea v-model="form.procedure" class="textarea" /></label>
        <label class="field"><span>Population</span><input v-model="form.population" class="input" /></label>
        <label class="field"><span>Expected result</span><input v-model="form.expected" class="input" /></label>
        <div class="row"><button class="btn primary">Add test</button><button type="button" class="btn" @click="adding = false">Cancel</button></div>
      </form>
    </template>
  </div>
</template>
