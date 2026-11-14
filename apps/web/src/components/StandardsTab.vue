<script setup lang="ts">
// Standards, in plain English: each framework the engagement is measured
// against, what it asks for, and how far this engagement can prove it meets
// it. "Proven" means a control is in place, tested, passing and evidenced.
import { computed, ref } from 'vue';
import { useApp } from '../stores/app';

interface Link {
  code: string;
  title: string;
  excluded: boolean;
  justification: string | null;
  controls: { key: string; title: string; cardKey: string | null }[];
  gap: string | null;
}
interface Row {
  id: string;
  source: string;
  ref: string;
  title: string;
  summary: string;
  status: 'covered' | 'partial' | 'gap' | 'excluded';
  links: Link[];
}
const props = defineProps<{ rows: Row[] }>();
const app = useApp();

const ABOUT: Record<string, { what: string; why: string }> = {
  'EU AI Act': {
    what: "The European Union's law on AI. It sorts AI by risk: some uses are banned, high-risk uses such as credit, hiring, insurance and essential services carry strict duties, and chatbots must say they are AI.",
    why: 'It applies when AI is used in the EU or affects people there, and many organisations elsewhere use it as the benchmark for good practice.',
  },
  'ISO/IEC 42001': {
    what: 'The international standard for running AI responsibly as an organisation: policy, roles, risk and impact assessments, monitoring and correcting what goes wrong.',
    why: 'Organisations can be certified against it, so it is a common target for boards and regulators.',
  },
  'NIST AI RMF': {
    what: "The US government's voluntary framework for managing AI risk, in four parts: Govern, Map, Measure and Manage.",
    why: 'A widely used, practical checklist. It is not law, but auditors and clients often ask for it.',
  },
  'Jamaica DPA 2020': {
    what: "Jamaica's Data Protection Act. Whenever AI uses personal data about people in Jamaica, it must have a lawful basis, keep the data secure, protect it when it leaves Jamaica, and respect people's rights, including objecting to automated decisions.",
    why: 'It is law, enforced by the Information Commissioner.',
  },
  'FDA GMLP': {
    what: "The US Food and Drug Administration's ten Good Machine Learning Practice principles for AI in medical devices (shared with Health Canada and the UK regulator), plus its guidance on planning model changes in advance. Representative patient data, separate test data, testing the clinician and AI together, clear information for users and monitoring after release.",
    why: 'The FDA expects them for AI medical devices, and hospitals use them to judge clinical AI they buy or build.',
  },
  HIPAA: {
    what: "The US health privacy law's Privacy, Security and Breach rules, plus the HHS rule on patient care decision support tools. Use only the health information the AI needs, sign agreements with AI vendors that see it, keep records, report breaches within 60 days, and check clinical tools for unfair impact.",
    why: 'It is US law for hospitals, insurers and their vendors, enforced by HHS with fines.',
  },
  'OWASP LLM Top 10': {
    what: 'The ten most common security weaknesses in systems built on large language models, such as prompt injection and giving an AI more power than it needs.',
    why: 'A technical checklist for testing chatbots and agents before and after release.',
  },
};
const STATUS = {
  covered: { label: 'Proven', tone: 'ok', means: 'A control is in place, tested and evidenced, and its tests pass.' },
  partial: {
    label: 'In progress',
    tone: 'warn',
    means: 'A control is in place but still needs a test, evidence, or a fix for a failed test.',
  },
  gap: { label: 'Gap', tone: 'danger', means: 'No control in place yet.' },
  excluded: { label: 'Not applicable', tone: '', means: 'Excluded in the Statement of Applicability, with a reason.' },
} as const;

const frameworks = computed(() => {
  const by = new Map<string, Row[]>();
  for (const r of [...props.rows].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true })))
    by.set(r.source, [...(by.get(r.source) ?? []), r]);
  return [...by.entries()].map(([name, rows]) => {
    const n = (s: Row['status']) => rows.filter((r) => r.status === s).length;
    const inScope = rows.length - n('excluded');
    return {
      name,
      rows,
      covered: n('covered'),
      partial: n('partial'),
      gap: n('gap'),
      excluded: n('excluded'),
      inScope,
      pct: inScope ? Math.round((n('covered') / inScope) * 100) : 100,
    };
  });
});
const open = ref<string | null>(null);

// What to do next, in words, from the first gap found.
function next(r: Row): string {
  if (r.status === 'covered') return '';
  if (r.status === 'excluded') return r.links.find((l) => l.justification)?.justification ?? '';
  const l = r.links.find((x) => x.gap && !x.excluded);
  if (!l) return '';
  const name = `${l.code} ${l.title}`;
  return (
    {
      'No control in place': `Add ${name} to a use case, or mark it not applicable with a reason.`,
      'Control has no test': `Write a test for ${l.controls.map((c) => c.key).join(', ')} on the Testing page.`,
      'Control has no evidence': `Collect evidence for ${l.controls.map((c) => c.key).join(', ')}.`,
      'A test failed': `Fix ${l.controls.map((c) => c.key).join(', ')} and retest; track it as an issue.`,
    }[l.gap!] ?? l.gap!
  );
}
</script>

<template>
  <div class="stack" style="gap: 16px">
    <!-- v1.7.4: be clear these are the key requirements only; "fully met" is on Every Requirement. -->
    <p class="small notice" style="display: block"
      >These cards cover each framework's <strong>key requirements</strong> in plain English. To see whether a framework
      is <strong>fully met</strong>, with every clause, article or subcategory accounted for, open
      <RouterLink to="/controls/requirements">Every Requirement</RouterLink>.</p
    >
    <div class="flow-strip" aria-label="How requirements become proof">
      <div><strong>1. Standard</strong><span>What a law or framework asks for</span></div>
      <div><strong>2. Library control</strong><span>A reusable way to meet it</span></div>
      <div><strong>3. Our control</strong><span>That control, in place for a use case, with an owner</span></div>
      <div><strong>4. Test</strong><span>Checked on a sample, prepared and reviewed</span></div>
      <div><strong>5. Evidence</strong><span>Files that prove it, fingerprinted</span></div>
    </div>

    <div class="framework-grid">
      <article v-for="f in frameworks" :key="f.name" class="card framework" :class="{ open: open === f.name }">
        <div class="spread" style="align-items: flex-start">
          <h2>{{ f.name }}</h2>
          <span class="big-pct" :class="f.pct >= 80 ? 'ok' : f.pct >= 40 ? 'warn' : 'danger'">{{ f.pct }}%</span>
        </div>
        <p class="small">{{ ABOUT[f.name]?.what }}</p>
        <p class="small faint">{{ ABOUT[f.name]?.why }}</p>
        <div
          class="coverage-bar"
          role="img"
          :aria-label="`${f.covered} proven, ${f.partial} in progress, ${f.gap} gaps of ${f.inScope} in scope`"
        >
          <i class="ok" :style="{ flex: f.covered }" /><i class="warn" :style="{ flex: f.partial }" /><i
            class="danger"
            :style="{ flex: f.gap }"
          />
        </div>
        <div class="small">
          <strong>{{ f.covered }} of {{ f.inScope }}</strong> requirements proven<template v-if="f.partial"
            >, {{ f.partial }} in progress</template
          ><template v-if="f.gap"
            >, <span style="color: var(--danger)">{{ f.gap }} with no control</span></template
          ><template v-if="f.excluded"> ({{ f.excluded }} not applicable)</template>
        </div>
        <button
          class="btn sm"
          style="align-self: flex-start"
          :aria-expanded="open === f.name"
          @click="open = open === f.name ? null : f.name"
          >{{ open === f.name ? 'Hide requirements' : `See the ${f.rows.length} requirements` }}</button
        >

        <ul v-if="open === f.name" class="req-list">
          <li v-for="r in f.rows" :key="r.id">
            <div class="spread" style="align-items: flex-start; gap: 8px">
              <div
                ><span class="mono faint small">{{ r.ref }}</span> <strong class="small">{{ r.title }}</strong></div
              >
              <span class="badge" :class="STATUS[r.status].tone" :title="STATUS[r.status].means">{{
                STATUS[r.status].label
              }}</span>
            </div>
            <div class="small">{{ r.summary }}</div>
            <div class="small faint"
              >Met by {{ r.links.map((l) => l.code).join(', ')
              }}<template v-if="r.links.some((l) => l.controls.length)"
                >: in place as
                {{
                  r.links
                    .flatMap((l) => l.controls.map((c) => `${c.key}${c.cardKey ? ` (${c.cardKey})` : ''}`))
                    .join(', ')
                }}</template
              ></div
            >
            <div v-if="next(r)" class="small next-step"
              >{{ r.status === 'excluded' ? 'Why: ' : 'Next: ' }}{{ next(r) }}</div
            >
          </li>
        </ul>
      </article>
    </div>

    <div class="row small faint" style="flex-wrap: wrap; gap: 12px">
      <span v-for="(s, k) in STATUS" :key="k"
        ><span class="badge" :class="s.tone">{{ s.label }}</span> {{ s.means }}</span
      >
    </div>
    <button class="btn sm ask-ai" style="align-self: flex-start" @click="app.openAssistant('controls')"
      ><span class="ai-mark" style="font-size: 10px; padding: 1px 4px">AI</span>Ask what to do first</button
    >
  </div>
</template>
