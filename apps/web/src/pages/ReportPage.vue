<script setup lang="ts">
// Readiness assessment (seven areas scored 1-5 with reasons) and the printable
// report, Markdown download and sign-off.
import { computed, onMounted, ref } from 'vue';
import { ISSUE_STATUS_LABELS, MATURITY, STAGE_LABELS, TIER_LABELS } from '@gh/shared';
import { api, day, downloadText, when } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const areas = ref<any[]>([]);
const report = ref<any | null>(null);
const drafts = ref<Record<string, { score: number | null; rationale: string }>>({});
const loading = ref(true);

async function load() {
  try {
    const E = await app.eid();
    [areas.value, report.value] = await Promise.all([api(`/engagements/${E}/assessment`), api(`/engagements/${E}/report`)]);
    drafts.value = Object.fromEntries(areas.value.map((a) => [a.id, { score: a.score, rationale: a.rationale }]));
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const scored = computed(() => areas.value.filter((a) => a.score).length);
const overall = computed(() => {
  const s = areas.value.filter((a) => a.score).map((a) => a.score as number);
  return s.length ? Math.round((s.reduce((x, y) => x + y, 0) / s.length) * 10) / 10 : null;
});
const dirty = (a: any) => drafts.value[a.id] && (drafts.value[a.id].score !== a.score || drafts.value[a.id].rationale !== a.rationale);

async function saveArea(a: any) {
  const d = drafts.value[a.id];
  if (!d.score) return app.toast('Pick a score from 1 to 5', 'error');
  try {
    await api(`/engagements/${await app.eid()}/assessment/${a.id}`, { method: 'PUT', body: d });
    app.toast(`${a.name} scored ${d.score}. Any sign-off is cleared until the report is signed again.`);
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
function useSuggested(a: any) {
  drafts.value[a.id] = { score: a.suggested, rationale: drafts.value[a.id].rationale || a.reasons.join('. ') + '.' };
}
async function sign() {
  if (!window.confirm('Sign off this readiness report? Your name and the time are recorded in the audit trail.')) return;
  try {
    await api(`/engagements/${await app.eid()}/report/sign`, { method: 'POST' });
    app.toast('Report signed off');
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}

const printReport = () => window.print();

function markdown() {
  const r = report.value;
  const L: string[] = [];
  L.push(`# AI governance readiness report: ${r.engagement.name}`, '');
  L.push(`Client: ${r.engagement.client}  `, `Generated: ${when(r.generatedAt)}  `, r.signedBy ? `Signed off by ${r.signedBy}, ${when(r.signedAt)}` : 'Draft: not signed off', '');
  L.push('## Readiness by area', '', `Overall maturity: ${overall.value ?? 'not scored'} of 5`, '', '| Area | Score | Maturity | Basis | Rationale |', '|---|---|---|---|---|');
  for (const a of r.areas) L.push(`| ${a.name} | ${a.score ?? '–'} | ${a.score ? MATURITY[a.score] : '–'} | ${a.basis} | ${(a.rationale || '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
  L.push('', '## Use cases in scope', '', '| Key | Use case | Tier | Stage |', '|---|---|---|---|');
  for (const u of r.useCases) L.push(`| ${u.key} | ${u.title} | ${u.tier ? TIER_LABELS[u.tier as keyof typeof TIER_LABELS] : 'Not classified'} | ${STAGE_LABELS[u.stage as keyof typeof STAGE_LABELS]} |`);
  const sums = r.useCases.filter((u: any) => u.summary);
  if (sums.length) {
    L.push('', '## Use case summaries');
    for (const u of sums) L.push('', `### ${u.key}: ${u.summary.headline}`, '', u.summary.text, '', `_Approved by ${u.summary.approvedBy}_`);
  }
  L.push('', '## Top risks', '', '| Key | Risk | Use case | Inherent | Residual | Treatment | Owner |', '|---|---|---|---|---|---|---|');
  for (const k of r.topRisks) L.push(`| ${k.key} | ${k.title} | ${k.cardKey} | ${k.inherent} | ${k.residual ?? '–'} | ${k.treatment} | ${k.owner} |`);
  L.push('', '## Controls', '', `${r.controls.total} controls: ${r.controls.operating} operating effectively, ${r.controls.failed} failed testing, ${r.controls.untested} not yet tested.`);
  L.push('', '## Evaluations', '');
  for (const s of r.evals) L.push(`- ${s.name} (${s.kind === 'red_team' ? 'red team' : 'quality'}): ${s.lastRun ? `${s.lastRun.passed}/${s.lastRun.total} passed, threshold ${s.thresholdPct}%` : 'not run'}`);
  L.push('', '## Open issues', '', '| Key | Severity | Issue | Owner | Due | Status |', '|---|---|---|---|---|---|');
  for (const i of r.openIssues) L.push(`| ${i.key} | ${i.severity} | ${i.title} | ${i.owner || '–'} | ${i.dueDate ?? '–'} | ${ISSUE_STATUS_LABELS[i.status as keyof typeof ISSUE_STATUS_LABELS]} |`);
  L.push('', '---', 'Areas follow the NIST AI RMF functions, with ISO/IEC 42001, OWASP and the Jamaica DPA 2020 where they add requirements. Scores use a five-level capability maturity scale.');
  downloadText(`readiness-report-${r.engagement.slug}.md`, L.join('\n'), 'text/markdown');
}
</script>

<template>
  <div class="page">
    <div v-if="loading" class="muted">Loading…</div>
    <template v-else-if="report">
      <div class="page-head no-print">
        <div>
          <h1>Readiness assessment and report</h1>
          <p>Score each area from 1 (initial) to 5 (optimising). The harness suggests a score from what it can see; you decide, and explain why. Someone who didn't score every area signs it off.</p>
        </div>
        <div class="row">
          <button class="btn" @click="markdown">Download Markdown</button>
          <button class="btn" @click="printReport">Print or save PDF</button>
          <button v-if="app.can('sign_off_report')" class="btn primary" :disabled="scored < areas.length" :title="scored < areas.length ? 'Score every area first' : ''" @click="sign">Sign off</button>
        </div>
      </div>

      <section class="section no-print" style="margin-bottom: 28px">
        <div class="spread"><span class="label-caps">Assessment · {{ scored }} of {{ areas.length }} scored</span><span v-if="overall" class="badge accent">Overall {{ overall }} / 5</span></div>
        <div class="grid-2">
          <div v-for="a in areas" :key="a.id" class="card">
            <div class="spread"><h2>{{ a.name }}</h2><span v-if="a.score" class="badge accent">{{ a.score }} · {{ MATURITY[a.score] }}</span></div>
            <p class="small faint">{{ a.basis }}</p>
            <div class="small">
              <span class="muted">Suggested {{ a.suggested }} ({{ MATURITY[a.suggested] }}):</span>
              <ul class="plain"><li v-for="r in a.reasons" :key="r">{{ r }}</li></ul>
            </div>
            <div class="segmented" role="radiogroup" :aria-label="`${a.name} score`">
              <button v-for="n in 5" :key="n" :class="{ on: drafts[a.id].score === n }" :disabled="!app.can('manage_engagement')" :title="MATURITY[n]" @click="drafts[a.id].score = n">{{ n }}</button>
            </div>
            <textarea v-model="drafts[a.id].rationale" class="textarea" style="min-height: 64px" :disabled="!app.can('manage_engagement')" placeholder="Why this score: what you saw, what's missing" :aria-label="`${a.name} rationale`" />
            <div v-if="app.can('manage_engagement')" class="row">
              <button class="btn sm" @click="useSuggested(a)">Use suggestion</button>
              <button class="btn sm primary" :disabled="!dirty(a)" @click="saveArea(a)">Save</button>
              <span v-if="a.assessedBy" class="small faint">{{ a.assessedBy }}, {{ day(a.assessedAt) }}</span>
            </div>
          </div>
        </div>
      </section>

      <article class="card report">
        <div class="spread">
          <div>
            <span class="label-caps">AI governance readiness report</span>
            <h1 style="margin-top: 4px">{{ report.engagement.name }}</h1>
            <p class="muted">{{ report.engagement.client }} · generated {{ when(report.generatedAt) }}</p>
          </div>
          <span class="badge" :class="report.signedBy ? 'ok' : 'warn'">{{ report.signedBy ? `Signed off by ${report.signedBy}, ${day(report.signedAt)}` : 'Draft' }}</span>
        </div>

        <h2>Readiness by area</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Area</th><th style="width: 160px">Maturity</th><th>Rationale</th></tr></thead>
            <tbody>
              <tr v-for="a in report.areas" :key="a.id">
                <td>{{ a.name }}<div class="small faint">{{ a.basis }}</div></td>
                <td>
                  <div class="maturity" :aria-label="a.score ? `${a.score} of 5` : 'Not scored'"><i v-for="n in 5" :key="n" :class="{ on: a.score && n <= a.score }" /></div>
                  <div class="small" style="margin-top: 4px">{{ a.score ? `${a.score} · ${MATURITY[a.score]}` : 'Not scored' }}</div>
                </td>
                <td class="small">{{ a.rationale || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Use cases in scope</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Key</th><th>Use case</th><th>Tier</th><th>Stage</th></tr></thead>
            <tbody>
              <tr v-for="u in report.useCases" :key="u.key">
                <td class="mono faint">{{ u.key }}</td><td>{{ u.title }}</td>
                <td><span v-if="u.tier" class="tier" :class="u.tier">{{ TIER_LABELS[u.tier as keyof typeof TIER_LABELS] }}</span><span v-else class="faint">Not classified</span></td>
                <td class="small">{{ STAGE_LABELS[u.stage as keyof typeof STAGE_LABELS] }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-if="report.useCases.some((u: any) => u.summary)">
          <h2>Use case summaries</h2>
          <div v-for="u in report.useCases.filter((x: any) => x.summary)" :key="u.key" class="stack" style="gap: 4px; margin-bottom: 12px">
            <strong><span class="mono faint">{{ u.key }}</span> {{ u.summary.headline }}</strong>
            <p v-for="(para, i) in u.summary.text.split(/\n+/)" :key="i" class="small">{{ para }}</p>
            <span class="small faint">Approved by {{ u.summary.approvedBy }}</span>
          </div>
        </template>

        <h2>Top risks</h2>
        <div v-if="!report.topRisks.length" class="small muted">No risks registered yet.</div>
        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>Key</th><th>Risk</th><th class="num">Inherent</th><th class="num">Residual</th><th>Treatment</th><th>Owner</th></tr></thead>
            <tbody>
              <tr v-for="k in report.topRisks" :key="k.key">
                <td class="mono faint">{{ k.key }}</td><td>{{ k.title }} <span class="mono faint small">{{ k.cardKey }}</span></td>
                <td class="num"><span class="score" :class="k.rating">{{ k.inherent }}</span></td>
                <td class="num">{{ k.residual ?? '—' }}</td><td class="small">{{ k.treatment }}</td><td class="small">{{ k.owner }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Controls and testing</h2>
        <div class="grid kpis">
          <div class="tile"><span class="label-caps">Controls</span><span class="big">{{ report.controls.total }}</span></div>
          <div class="tile"><span class="label-caps">Operating</span><span class="big" style="color: var(--ok)">{{ report.controls.operating }}</span></div>
          <div class="tile"><span class="label-caps">Failed</span><span class="big" style="color: var(--danger)">{{ report.controls.failed }}</span></div>
          <div class="tile"><span class="label-caps">Not tested</span><span class="big">{{ report.controls.untested }}</span></div>
        </div>

        <h2>Evaluations</h2>
        <ul class="plain">
          <li v-for="s in report.evals" :key="s.id">{{ s.name }}: {{ s.lastRun ? `${s.lastRun.passed} of ${s.lastRun.total} passed (threshold ${s.thresholdPct}%)` : 'not run' }}</li>
        </ul>

        <h2>Open issues ({{ report.openIssues.length }})</h2>
        <div v-if="!report.openIssues.length" class="small muted">None open.</div>
        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>Key</th><th>Severity</th><th>Issue</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="i in report.openIssues" :key="i.id">
                <td class="mono faint">{{ i.key }}</td><td><span class="sev" :class="i.severity">{{ i.severity }}</span></td><td>{{ i.title }}</td>
                <td class="small">{{ i.owner || '—' }}</td><td class="small" :class="{ error: i.overdue }">{{ i.dueDate ? day(i.dueDate) : '—' }}</td>
                <td class="small">{{ ISSUE_STATUS_LABELS[i.status as keyof typeof ISSUE_STATUS_LABELS] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="small faint" style="margin-top: 16px">Areas follow the NIST AI RMF functions, with ISO/IEC 42001, OWASP and the Jamaica DPA 2020 where they add requirements. Scores use a five-level capability maturity scale.</p>
      </article>
    </template>
  </div>
</template>
