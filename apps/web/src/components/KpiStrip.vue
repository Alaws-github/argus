<script setup lang="ts">
// The row of KPI tiles at the top of a page (v1.7 dashboard look). Every page
// reads the same numbers from GET /engagements/:id/kpis; this file decides
// which tiles a page shows. The first tile is the accent tile. Each tile links
// to where the number comes from.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, money, socket } from '../api';
import { useApp } from '../stores/app';
import Icon from './Icon.vue';

const props = defineProps<{ page: string }>();
const app = useApp();
const k = ref<any>(null);

// One request shared by every strip on screen, refreshed at most every few seconds.
let timer: ReturnType<typeof setTimeout> | null = null;
async function load() {
  if (!app.engagementId) return;
  try { k.value = await api(`/engagements/${app.engagementId}/kpis`); } catch { /* the tiles are a summary; the page still works without them */ }
}
const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 1500); };
onMounted(() => { void load(); socket.on('card', soon); socket.on('audit', soon); });
onBeforeUnmount(() => { socket.off('card', soon); socket.off('audit', soon); if (timer) clearTimeout(timer); });
watch(() => app.engagementId, () => void load());

type Tile = { label: string; value: string | number; sub?: string; icon: string; to?: string; tone?: 'ok' | 'warn' | 'danger' | '' };
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const tiles = computed<Tile[]>(() => {
  const x = k.value;
  if (!x) return [];
  const { cards: c, risks: r, controls: co, tests: t, evidence: ev, issues: i, incidents: inc, inventory: inv, evals: e, kb, runs: ru, audit: au, questions: q } = x;
  const P: Record<string, Tile[]> = {
    board: [
      { label: 'Use cases', value: c.total, sub: `${c.added_30d} added in 30 days`, icon: 'usecases' },
      { label: 'Need you', value: c.needs_you, sub: q.open ? `${s(q.open, 'question')} from agents` : 'Approvals, triage and failed runs', icon: 'bell', tone: c.needs_you ? 'warn' : 'ok' },
      { label: 'Agents working', value: c.working, sub: ru.running ? s(ru.running, 'run') + ' live' : 'None right now', icon: 'runs', to: '/runs' },
      { label: 'High risk tier', value: c.high_tier, sub: `${c.tiered} of ${c.total} tiered`, icon: 'risks', tone: c.high_tier ? 'danger' : '' , to: '/risks' },
      { label: 'Governed', value: c.closed, sub: pct(c.closed, c.total) + ' of use cases', icon: 'controls', tone: 'ok' },
    ],
    risks: [
      { label: 'Open risks', value: r.open, sub: r.avg_score ? `Average score ${r.avg_score}` : 'Nothing open', icon: 'risks' },
      { label: 'High (12+)', value: r.high, sub: pct(r.high, r.open) + ' of open risks', icon: 'alert', tone: r.high ? 'danger' : 'ok' },
      { label: 'Above appetite', value: r.above_appetite, sub: 'Not yet accepted', icon: 'bell', tone: r.above_appetite ? 'warn' : 'ok' },
      { label: 'No control', value: r.no_control, sub: 'Risks nothing treats yet', icon: 'controls', tone: r.no_control ? 'warn' : 'ok', to: '/controls/register' },
      { label: 'No owner', value: r.no_owner, sub: 'Risks nobody owns', icon: 'people', tone: r.no_owner ? 'warn' : 'ok' },
    ],
    controls: [
      { label: 'Controls', value: co.total, sub: `${co.operating} operating`, icon: 'controls' },
      { label: 'Operating', value: pct(co.operating, co.total), sub: s(co.operating, 'control'), icon: 'check', tone: 'ok' },
      { label: 'Untested', value: co.untested, sub: 'No test yet', icon: 'tests', tone: co.untested ? 'warn' : 'ok', to: '/testing/tests' },
      { label: 'Failed', value: co.failed, sub: 'Need remediation', icon: 'alert', tone: co.failed ? 'danger' : 'ok', to: '/issues' },
      { label: 'No owner', value: co.no_owner, sub: 'Controls nobody owns', icon: 'people', tone: co.no_owner ? 'warn' : 'ok' },
    ],
    testing: [
      { label: 'Tests', value: t.total, sub: `${t.open} still open`, icon: 'tests' },
      { label: 'Passed', value: pct(t.passed, t.passed + t.failed), sub: `${t.passed} of ${t.passed + t.failed} concluded`, icon: 'check', tone: 'ok' },
      { label: 'Failed', value: t.failed, sub: 'Each needs an issue', icon: 'alert', tone: t.failed ? 'danger' : 'ok', to: '/issues' },
      { label: 'Awaiting review', value: t.awaiting_review, sub: 'Concluded, not yet reviewed', icon: 'people', tone: t.awaiting_review ? 'warn' : 'ok' },
      { label: 'Evidence', value: ev.total, sub: `${ev.added_30d} added in 30 days`, icon: 'evidence', to: '/testing/evidence' },
    ],
    issues: [
      { label: 'Open issues', value: i.open, sub: `${i.closed} closed`, icon: 'issues' },
      { label: 'Critical or high', value: i.severe, sub: 'Open', icon: 'alert', tone: i.severe ? 'danger' : 'ok' },
      { label: 'Overdue', value: i.overdue, sub: 'Past their due date', icon: 'clock', tone: i.overdue ? 'warn' : 'ok' },
      { label: 'Ready for retest', value: i.retest, sub: 'Fixed, waiting on a test', icon: 'tests', to: '/testing/tests' },
    ],
    incidents: [
      { label: 'Open incidents', value: inc.open, sub: s(inc.total, 'incident') + ' recorded', icon: 'incidents' },
      { label: 'Critical or high', value: inc.severe, sub: 'Open', icon: 'alert', tone: inc.severe ? 'danger' : 'ok' },
      { label: 'Open issues', value: i.open, sub: `${i.severe} critical or high`, icon: 'issues', to: '/issues' },
    ],
    inventory: [
      { label: 'AI systems', value: inv.total, sub: `${inv.live} live`, icon: 'inventory' },
      { label: 'Live', value: inv.live, sub: pct(inv.live, inv.total) + ' of the inventory', icon: 'check', tone: 'ok' },
      { label: 'Use cases', value: c.total, sub: `${c.tiered} tiered`, icon: 'usecases', to: '/' },
    ],
    evals: [
      { label: 'Suites', value: e.suites, sub: 'Evaluation test suites', icon: 'evals' },
      { label: 'Runs (30 days)', value: e.runs, sub: 'Completed', icon: 'runs' },
      { label: 'Pass rate', value: e.runs ? `${e.pass_pct}%` : '–', sub: 'Cases passed, last 30 days', icon: 'check', tone: !e.runs ? '' : e.pass_pct >= 90 ? 'ok' : e.pass_pct >= 70 ? 'warn' : 'danger' },
      { label: 'Open incidents', value: inc.open, sub: 'From monitoring and reports', icon: 'incidents', to: '/incidents' },
    ],
    knowledge: [
      { label: 'Client documents', value: kb.client_docs, sub: 'Uploaded for this engagement', icon: 'knowledge' },
      { label: 'Shared sources', value: kb.shared_sources, sub: 'Frameworks, controls, method', icon: 'controls' },
      { label: 'Passages', value: kb.passages, sub: 'What agents can cite', icon: 'report' },
      { label: 'Meaning search', value: pct(kb.embedded, kb.passages), sub: kb.embedded ? 'Passages embedded' : 'Keyword search only', icon: 'search', tone: kb.embedded ? 'ok' : '' },
    ],
    runs: [
      { label: 'Runs (30 days)', value: ru.runs_30d, sub: `${ru.running} running now`, icon: 'runs' },
      { label: 'Failed', value: ru.failed_30d, sub: pct(ru.failed_30d, ru.runs_30d) + ' of runs', icon: 'alert', tone: ru.failed_30d ? 'danger' : 'ok' },
      { label: 'Spend this month', value: money(ru.cost_month), sub: 'On this engagement', icon: 'models', to: '/workspace/models' },
      { label: 'Steps per run', value: ru.avg_steps ?? '–', sub: ru.avg_steps ? 'Average, agentic runs' : 'No agentic runs yet', icon: 'agents', to: '/settings/agents' },
    ],
    audit: [
      { label: 'Entries today', value: au.today, sub: 'Changes recorded', icon: 'audit' },
      { label: 'This week', value: au.week, sub: 'Changes recorded', icon: 'report' },
      { label: 'People this week', value: au.people_week, sub: 'Including agents', icon: 'people' },
    ],
    report: [
      { label: 'Governed', value: pct(c.closed, c.total), sub: `${c.closed} of ${c.total} use cases`, icon: 'controls' },
      { label: 'Open high risks', value: r.high, sub: `${r.above_appetite} above appetite`, icon: 'risks', tone: r.high ? 'danger' : 'ok', to: '/risks' },
      { label: 'Tests passed', value: pct(t.passed, t.passed + t.failed), sub: `${t.failed} failed`, icon: 'tests', tone: t.failed ? 'warn' : 'ok', to: '/testing/tests' },
      { label: 'Open issues', value: i.open, sub: `${i.severe} critical or high`, icon: 'issues', tone: i.severe ? 'danger' : '', to: '/issues' },
    ],
  };
  return P[props.page] ?? [];
});
</script>

<template>
  <div v-if="tiles.length" class="kpi-strip" :class="`n${tiles.length}`">
    <component :is="t.to ? 'RouterLink' : 'div'" v-for="(t, i) in tiles" :key="t.label" :to="t.to" class="kpi" :class="[i === 0 ? 'accent' : '', t.tone ? `tone-${t.tone}` : '', t.to ? 'link' : '']">
      <div class="kpi-top"><span class="kpi-icon"><Icon :name="t.icon" :size="15" /></span><span class="kpi-label">{{ t.label }}</span></div>
      <div class="kpi-value">{{ t.value }}</div>
      <div v-if="t.sub" class="kpi-sub">{{ t.sub }}</div>
    </component>
  </div>
</template>
