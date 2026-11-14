// Which KPI tiles each page shows, built from GET /engagements/:id/kpis (v1.7 dashboard look). One small
// builder per page; the first tile is the accent tile and each tile links to where its number comes from.
// Split out of KpiStrip.vue in v1.7.8.
import { money } from '../api';

/** One KPI tile: the number, its label, a line of context, an icon, a link and a tone. */
export type Tile = {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  to?: string;
  tone?: 'ok' | 'warn' | 'danger' | '';
};

/** The KPI read: one object of counts per area (see apps/server/src/engagements/kpis.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Kpis = Record<string, any>;

/** A share as a whole percentage, or a dash when there is nothing to divide by. */
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
/** "1 issue" or "3 issues". */
const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each page's tiles. */
export const PAGE_TILES: Record<string, (k: Kpis) => Tile[]> = {
  board: (k) => {
    const { cards: c, runs: ru, questions: q } = k;
    return [
      { label: 'Use cases', value: c.total, sub: `${c.added_30d} added in 30 days`, icon: 'usecases' },
      {
        label: 'Need you',
        value: c.needs_you,
        sub: q.open ? `${s(q.open, 'question')} from agents` : 'Approvals, triage and failed runs',
        icon: 'bell',
        tone: c.needs_you ? 'warn' : 'ok',
      },
      {
        label: 'Agents working',
        value: c.working,
        sub: ru.running ? s(ru.running, 'run') + ' live' : 'None right now',
        icon: 'runs',
        to: '/runs',
      },
      {
        label: 'High risk tier',
        value: c.high_tier,
        sub: `${c.tiered} of ${c.total} tiered`,
        icon: 'risks',
        tone: c.high_tier ? 'danger' : '',
        to: '/risks',
      },
      {
        label: 'Governed',
        value: c.closed,
        sub: pct(c.closed, c.total) + ' of use cases',
        icon: 'controls',
        tone: 'ok',
      },
    ];
  },
  risks: (k) => {
    const { risks: r } = k;
    return [
      {
        label: 'Open risks',
        value: r.open,
        sub: r.avg_score ? `Average score ${r.avg_score}` : 'Nothing open',
        icon: 'risks',
      },
      {
        label: 'High (12+)',
        value: r.high,
        sub: pct(r.high, r.open) + ' of open risks',
        icon: 'alert',
        tone: r.high ? 'danger' : 'ok',
      },
      {
        label: 'Above appetite',
        value: r.above_appetite,
        sub: 'Not yet accepted',
        icon: 'bell',
        tone: r.above_appetite ? 'warn' : 'ok',
      },
      {
        label: 'No control',
        value: r.no_control,
        sub: 'Risks nothing treats yet',
        icon: 'controls',
        tone: r.no_control ? 'warn' : 'ok',
        to: '/controls/register',
      },
      {
        label: 'No owner',
        value: r.no_owner,
        sub: 'Risks nobody owns',
        icon: 'people',
        tone: r.no_owner ? 'warn' : 'ok',
      },
    ];
  },
  controls: (k) => {
    const { controls: co } = k;
    return [
      { label: 'Controls', value: co.total, sub: `${co.operating} operating`, icon: 'controls' },
      {
        label: 'Operating',
        value: pct(co.operating, co.total),
        sub: s(co.operating, 'control'),
        icon: 'check',
        tone: 'ok',
      },
      {
        label: 'Untested',
        value: co.untested,
        sub: 'No test yet',
        icon: 'tests',
        tone: co.untested ? 'warn' : 'ok',
        to: '/testing/tests',
      },
      {
        label: 'Failed',
        value: co.failed,
        sub: 'Need remediation',
        icon: 'alert',
        tone: co.failed ? 'danger' : 'ok',
        to: '/issues',
      },
      {
        label: 'No owner',
        value: co.no_owner,
        sub: 'Controls nobody owns',
        icon: 'people',
        tone: co.no_owner ? 'warn' : 'ok',
      },
    ];
  },
  testing: (k) => {
    const { tests: t, evidence: ev } = k;
    return [
      { label: 'Tests', value: t.total, sub: `${t.open} still open`, icon: 'tests' },
      {
        label: 'Passed',
        value: pct(t.passed, t.passed + t.failed),
        sub: `${t.passed} of ${t.passed + t.failed} concluded`,
        icon: 'check',
        tone: 'ok',
      },
      {
        label: 'Failed',
        value: t.failed,
        sub: 'Each needs an issue',
        icon: 'alert',
        tone: t.failed ? 'danger' : 'ok',
        to: '/issues',
      },
      {
        label: 'Awaiting review',
        value: t.awaiting_review,
        sub: 'Concluded, not yet reviewed',
        icon: 'people',
        tone: t.awaiting_review ? 'warn' : 'ok',
      },
      {
        label: 'Evidence',
        value: ev.total,
        sub: `${ev.added_30d} added in 30 days`,
        icon: 'evidence',
        to: '/testing/evidence',
      },
    ];
  },
  issues: (k) => {
    const { issues: i } = k;
    return [
      { label: 'Open issues', value: i.open, sub: `${i.closed} closed`, icon: 'issues' },
      { label: 'Critical or high', value: i.severe, sub: 'Open', icon: 'alert', tone: i.severe ? 'danger' : 'ok' },
      {
        label: 'Overdue',
        value: i.overdue,
        sub: 'Past their due date',
        icon: 'clock',
        tone: i.overdue ? 'warn' : 'ok',
      },
      {
        label: 'Ready for retest',
        value: i.retest,
        sub: 'Fixed, waiting on a test',
        icon: 'tests',
        to: '/testing/tests',
      },
    ];
  },
  incidents: (k) => {
    const { issues: i, incidents: inc } = k;
    return [
      { label: 'Open incidents', value: inc.open, sub: s(inc.total, 'incident') + ' recorded', icon: 'incidents' },
      { label: 'Critical or high', value: inc.severe, sub: 'Open', icon: 'alert', tone: inc.severe ? 'danger' : 'ok' },
      { label: 'Open issues', value: i.open, sub: `${i.severe} critical or high`, icon: 'issues', to: '/issues' },
    ];
  },
  inventory: (k) => {
    const { cards: c, inventory: inv } = k;
    return [
      { label: 'AI systems', value: inv.total, sub: `${inv.live} live`, icon: 'inventory' },
      {
        label: 'Live',
        value: inv.live,
        sub: pct(inv.live, inv.total) + ' of the inventory',
        icon: 'check',
        tone: 'ok',
      },
      { label: 'Use cases', value: c.total, sub: `${c.tiered} tiered`, icon: 'usecases', to: '/' },
    ];
  },
  evals: (k) => {
    const { incidents: inc, evals: e } = k;
    return [
      { label: 'Suites', value: e.suites, sub: 'Evaluation test suites', icon: 'evals' },
      { label: 'Runs (30 days)', value: e.runs, sub: 'Completed', icon: 'runs' },
      {
        label: 'Pass rate',
        value: e.runs ? `${e.pass_pct}%` : '–',
        sub: 'Cases passed, last 30 days',
        icon: 'check',
        tone: !e.runs ? '' : e.pass_pct >= 90 ? 'ok' : e.pass_pct >= 70 ? 'warn' : 'danger',
      },
      {
        label: 'Open incidents',
        value: inc.open,
        sub: 'From monitoring and reports',
        icon: 'incidents',
        to: '/incidents',
      },
    ];
  },
  knowledge: (k) => {
    const { kb } = k;
    return [
      { label: 'Client documents', value: kb.client_docs, sub: 'Uploaded for this engagement', icon: 'knowledge' },
      { label: 'Shared sources', value: kb.shared_sources, sub: 'Frameworks, controls, method', icon: 'controls' },
      { label: 'Passages', value: kb.passages, sub: 'What agents can cite', icon: 'report' },
      {
        label: 'Meaning search',
        value: pct(kb.embedded, kb.passages),
        sub: kb.embedded ? 'Passages embedded' : 'Keyword search only',
        icon: 'search',
        tone: kb.embedded ? 'ok' : '',
      },
    ];
  },
  runs: (k) => {
    const { runs: ru } = k;
    return [
      { label: 'Runs (30 days)', value: ru.runs_30d, sub: `${ru.running} running now`, icon: 'runs' },
      {
        label: 'Failed',
        value: ru.failed_30d,
        sub: pct(ru.failed_30d, ru.runs_30d) + ' of runs',
        icon: 'alert',
        tone: ru.failed_30d ? 'danger' : 'ok',
      },
      {
        label: 'Spend this month',
        value: money(ru.cost_month),
        sub: 'On this engagement',
        icon: 'models',
        to: '/workspace/models',
      },
      {
        label: 'Steps per run',
        value: ru.avg_steps ?? '–',
        sub: ru.avg_steps ? 'Average, agentic runs' : 'No agentic runs yet',
        icon: 'agents',
        to: '/settings/agents',
      },
    ];
  },
  audit: (k) => {
    const { audit: au } = k;
    return [
      { label: 'Entries today', value: au.today, sub: 'Changes recorded', icon: 'audit' },
      { label: 'This week', value: au.week, sub: 'Changes recorded', icon: 'report' },
      { label: 'People this week', value: au.people_week, sub: 'Including agents', icon: 'people' },
    ];
  },
  report: (k) => {
    const { cards: c, risks: r, tests: t, issues: i } = k;
    return [
      {
        label: 'Governed',
        value: pct(c.closed, c.total),
        sub: `${c.closed} of ${c.total} use cases`,
        icon: 'controls',
      },
      {
        label: 'Open high risks',
        value: r.high,
        sub: `${r.above_appetite} above appetite`,
        icon: 'risks',
        tone: r.high ? 'danger' : 'ok',
        to: '/risks',
      },
      {
        label: 'Tests passed',
        value: pct(t.passed, t.passed + t.failed),
        sub: `${t.failed} failed`,
        icon: 'tests',
        tone: t.failed ? 'warn' : 'ok',
        to: '/testing/tests',
      },
      {
        label: 'Open issues',
        value: i.open,
        sub: `${i.severe} critical or high`,
        icon: 'issues',
        tone: i.severe ? 'danger' : '',
        to: '/issues',
      },
    ];
  },
};
