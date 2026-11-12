<script setup lang="ts">
// Add an engagement (a new client or project) in six steps: Client, Scope,
// Gates, Tools (how the client works; v1.7.2), Models, Review. Modelled on GoldenEye's Add project.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  AGENT_ROLES, BUSINESS_TOOLS, TOOL_GROUPS, WF_TEMPLATES, WF_TEMPLATE_INFO, DEFAULT_GATES, EFFORTS, FRAMEWORK_CHOICES, SECTORS, STAGES, STAGE_HINTS, STAGE_LABELS,
  type AgentRole, type Engagement, type Effort, type LibraryControl, type Obligation, type Provider, type Stage,
} from '@gh/shared';
import { api } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const router = useRouter();
const STEPS = ['Client', 'Scope', 'Gates', 'Tools', 'Models', 'Review'] as const;
const step = ref(0);
const reached = ref(0);
const error = ref('');
const busy = ref(false);

const providers = ref<Provider[]>([]);
const library = ref<LibraryControl[]>([]);
const obligations = ref<Obligation[]>([]);
const settings = ref<any>(null);
onMounted(async () => {
  try {
    [providers.value, library.value, obligations.value, settings.value] = await Promise.all([api('/providers'), api('/library'), api('/obligations'), api('/settings')]);
    preset.value = anthropicReady.value ? 'claude' : settings.value?.defaultProviderId ? 'default' : 'rules';
    applyPreset();
  } catch (e: any) {
    error.value = e.message;
  }
});

const COLORS = ['#8b9dff', '#5ea2ff', '#3fb950', '#f0b429', '#e8a27c', '#f47067', '#c084fc', '#2dd4bf'];
const f = reactive({
  name: '', client: '', sector: '', prefix: '', color: COLORS[1], about: '',
  frameworks: ['nistAiRmf', 'iso42001', 'jdpa'] as string[],
  startSoa: true,
  appetite: { maxResidual: 8, statement: '', escalateTo: 'Board Risk Committee' },
  gates: { ...DEFAULT_GATES } as Record<Stage, boolean>,
  agents: {} as Record<string, { providerId: string; model: string; effort: Effort }>,
  useCases: '',
  clientTools: [] as string[],
  clientWorkflows: true, // v1.7.4: switches on the Client tools and workflows module
  workflow: { template: 'standard' } as { template: (typeof WF_TEMPLATES)[number] } | null,
});
const toggleTool = (id: string) => { f.clientTools = f.clientTools.includes(id) ? f.clientTools.filter((t) => t !== id) : [...f.clientTools, id]; };
const toolName = (id: string) => BUSINESS_TOOLS.find((t) => t.id === id)?.name ?? id;
const touched = reactive({ prefix: false });

// Card prefix from the client's initials, until someone types their own.
watch(() => [f.client, f.name], () => {
  if (touched.prefix) return;
  const words = (f.client || f.name).replace(/\(.*?\)/g, '').split(/[^A-Za-z0-9]+/).filter((w) => w && !/^(the|of|and|ltd|limited|inc|group|plc|co)$/i.test(w));
  const p = (words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3)).toUpperCase().replace(/^[^A-Z]+/, '').slice(0, 4);
  f.prefix = p;
});
// v1.7.3: a healthcare client usually needs HIPAA; suggest it once when the sector is picked.
watch(() => f.sector, (s) => { if (s === 'Healthcare' && !f.frameworks.includes('hipaa')) f.frameworks = [...f.frameworks, 'hipaa']; });
const prefixTaken = computed(() => app.engagements.some((e) => e.prefix === f.prefix));

// ----------------------------------------------------------------- scope
const SOURCE: Record<string, string[]> = {
  nistAiRmf: ['NIST AI RMF'], iso42001: ['ISO/IEC 42001'], euAiAct: ['EU AI Act'], jdpa: ['Jamaica DPA 2020'], owasp: ['OWASP LLM Top 10'], fdaGmlp: ['FDA GMLP'], hipaa: ['HIPAA'], nistCsf: [], coso: [],
};
const mapped = computed(() => library.value.filter((l) => f.frameworks.some((k) => ((l.refs as any)?.[k] ?? []).length)));
const obligationCount = computed(() => obligations.value.filter((o) => f.frameworks.some((k) => SOURCE[k]?.includes(o.source))).length);
const useCaseList = computed(() => f.useCases.split('\n').map((s) => s.trim()).filter((s) => s.length >= 3));

// ---------------------------------------------------------------- models
const BUILT = (Object.entries(AGENT_ROLES) as [AgentRole, (typeof AGENT_ROLES)[AgentRole]][]).filter(([, m]) => m.built);
for (const [role] of BUILT) f.agents[role] = { providerId: '', model: '', effort: 'medium' };
const enabled = computed(() => providers.value.filter((p) => p.enabled));
const anthropic = computed(() => providers.value.find((p) => p.type === 'anthropic'));
const anthropicReady = computed(() => !!anthropic.value?.enabled && anthropic.value.key.set && anthropic.value.status !== 'error');
const rules = computed(() => providers.value.find((p) => p.type === 'rules'));
const preset = ref<'claude' | 'default' | 'rules' | 'custom'>('rules');
const PRESETS = computed(() => [
  { id: 'claude', title: 'Claude for every agent', hint: 'Best results. Every run uses your Anthropic API key.', ok: anthropicReady.value },
  { id: 'default', title: 'Workspace default', hint: settings.value?.defaultModel ? `What new agents start on: ${settings.value.defaultModel}.` : 'Set a default under Models first.', ok: !!settings.value?.defaultProviderId },
  { id: 'rules', title: 'Built-in rules', hint: 'Offline and free. Good for a dry run before a client key is in place.', ok: !!rules.value },
] as const);
function applyPreset() {
  for (const [role] of BUILT) {
    if (preset.value === 'claude' && anthropic.value) f.agents[role] = { providerId: anthropic.value.id, model: role === 'control_designer' ? 'claude-opus-5-5' : 'claude-sonnet-5-5', effort: 'medium' };
    else if (preset.value === 'default' && settings.value?.defaultProviderId) f.agents[role] = { providerId: settings.value.defaultProviderId, model: settings.value.defaultModel, effort: settings.value.defaultEffort };
    else if (preset.value === 'rules' && rules.value) f.agents[role] = { providerId: rules.value.id, model: 'rules-v1', effort: 'medium' };
  }
}
watch(preset, (p) => p !== 'custom' && applyPreset());
const modelsOf = (id: string) => providers.value.find((p) => p.id === id)?.models.filter((m) => m !== 'demo-chatbot-v1') ?? [];
const providerName = (id: string) => providers.value.find((p) => p.id === id)?.name ?? '?';

// ------------------------------------------------------------ navigation
function valid(i: number): string {
  if (i === 0) {
    if (f.name.trim().length < 2) return 'Give the engagement a name';
    if (f.client.trim().length < 2) return 'Name the client';
    if (!/^[A-Z][A-Z0-9]{0,5}$/.test(f.prefix)) return 'The card prefix is 1 to 6 capital letters or digits, starting with a letter';
    if (prefixTaken.value) return `Another engagement already uses ${f.prefix}`;
  }
  if (i === 1 && !f.frameworks.length) return 'Pick at least one framework';
  if (i === 4 && BUILT.some(([r]) => !f.agents[r]?.providerId || !f.agents[r]?.model)) return 'Choose a provider and model for each agent';
  return '';
}
function go(i: number) {
  error.value = '';
  for (let k = 0; k < i; k++) {
    const v = valid(k);
    if (v) {
      step.value = k;
      error.value = v;
      return;
    }
  }
  step.value = i;
  reached.value = Math.max(reached.value, i);
}
async function create() {
  for (let k = 0; k < 5; k++) if (valid(k)) return go(k + 1);
  busy.value = true;
  error.value = '';
  try {
    const e = await api<Engagement>('/engagements', {
      method: 'POST',
      body: { ...f, name: f.name.trim(), client: f.client.trim(), useCases: useCaseList.value, ...(f.clientWorkflows ? {} : { workflow: null, clientTools: [] }) },
    });
    await app.addedEngagement(e);
    app.toast(`${e.name} added. You're on its board now.`);
    router.push('/');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page wizard">
    <div class="page-head">
      <div>
        <h1>Add an engagement</h1>
        <p>Set up a new client, or a new piece of work for an existing one. You choose what's in scope, where people step in and which models run the agents. All of it can be changed later in Settings.</p>
      </div>
      <RouterLink class="btn ghost" to="/">Cancel</RouterLink>
    </div>

    <nav class="wizard-steps" aria-label="Steps">
      <button v-for="(s, i) in STEPS" :key="s" :class="{ on: step === i, done: i < reached && step !== i }" :disabled="i > reached" :aria-current="step === i ? 'step' : undefined" @click="go(i)">
        <span class="n">{{ i < reached && step !== i ? '✓' : i + 1 }}</span><span class="lbl">{{ s }}</span>
      </button>
    </nav>

    <section class="card">
      <!-- 1 Client -->
      <template v-if="step === 0">
        <h2>Who is it for?</h2>
        <div class="split">
          <label class="field"><span>Client</span><input v-model="f.client" class="input" placeholder="e.g. Harbourview Credit Union" autofocus /></label>
          <label class="field"><span>Sector</span><select v-model="f.sector" class="select"><option value="">Choose</option><option v-for="s in SECTORS" :key="s">{{ s }}</option></select></label>
        </div>
        <label class="field"><span>Engagement name</span><input v-model="f.name" class="input" placeholder="e.g. AI governance readiness 2027" /><span class="hint">Shown in the switcher. One client can have several engagements.</span></label>
        <div class="split">
          <label class="field">
            <span>Card prefix</span>
            <input v-model="f.prefix" class="input mono" maxlength="6" @input="touched.prefix = true; f.prefix = f.prefix.toUpperCase()" />
            <span class="hint" :class="{ error: prefixTaken }">{{ prefixTaken ? `Already used by another engagement` : `Use cases will be ${f.prefix || 'XX'}-1, ${f.prefix || 'XX'}-2…` }}</span>
          </label>
          <div class="field"><span>Colour</span>
            <div class="colors"><button v-for="c in COLORS" :key="c" type="button" :class="{ on: f.color === c }" :style="{ background: c }" :aria-label="`Colour ${c}`" @click="f.color = c" /></div>
          </div>
        </div>
        <label class="field"><span>About the client</span><textarea v-model="f.about" class="textarea" placeholder="What they do, who regulates them, which laws apply. Agents read this as context." /></label>
      </template>

      <!-- 2 Scope -->
      <template v-else-if="step === 1">
        <h2>What's in scope?</h2>
        <div class="field"><span>Frameworks</span>
          <label v-for="fw in FRAMEWORK_CHOICES" :key="fw.id" class="check-row"><input v-model="f.frameworks" type="checkbox" :value="fw.id" /><span><strong>{{ fw.label }}</strong><span class="muted small hint-inline">{{ fw.hint }}</span></span></label>
        </div>
        <div class="notice" style="padding: 12px">
          <span class="small">{{ mapped.length }} of {{ library.length }} library controls map to these, and {{ obligationCount }} obligations will show in the traceability matrix.</span>
          <label class="check-row"><input v-model="f.startSoa" type="checkbox" /><span>Start the Statement of Applicability with those {{ mapped.length }} marked applicable. You still confirm or exclude each one with a reason.</span></label>
        </div>
        <div class="field"><span>Risk appetite</span>
          <div class="row"><input v-model.number="f.appetite.maxResidual" type="range" min="1" max="25" style="flex: 1" aria-label="Highest residual score accepted" /><span class="badge accent" style="min-width: 44px; justify-content: center">{{ f.appetite.maxResidual }}</span></div>
          <span class="hint">The highest residual score (likelihood × impact) a reviewer can accept. Anything higher needs a lead, on behalf of:</span>
          <input v-model="f.appetite.escalateTo" class="input" aria-label="Escalate to" />
          <textarea v-model="f.appetite.statement" class="textarea" style="min-height: 60px" placeholder="Appetite statement, if the board has one" aria-label="Appetite statement" />
        </div>
        <label class="field"><span>Use cases to start with <span class="faint">optional</span></span>
          <textarea v-model="f.useCases" class="textarea" placeholder="One per line, e.g.&#10;Fraud scoring on card transactions&#10;HR CV screening assistant" />
          <span class="hint">{{ useCaseList.length ? `${useCaseList.length} will land in Intake. ` : '' }}You added them, so someone else decides which go forward. Fill in each profile from the board.</span>
        </label>
      </template>

      <!-- 3 Gates -->
      <template v-else-if="step === 2">
        <h2>Where do you want to step in?</h2>
        <p class="small muted">Use cases stop at these stages until a reviewer or lead signs off. Exit criteria apply either way: a use case can't leave Evidence, Test or Remediate until its checks hold.</p>
        <div v-for="s in STAGES.filter((x) => x !== 'closed')" :key="s" class="spread" style="border-top: 1px solid var(--line-soft); padding-top: 10px">
          <div><strong>{{ STAGE_LABELS[s] }}</strong><div class="small faint">{{ STAGE_HINTS[s] }}</div></div>
          <button class="switch" :class="{ on: f.gates[s] }" role="switch" :aria-checked="f.gates[s]" :disabled="s === 'intake'" :title="s === 'intake' ? 'A person always decides what enters governance' : ''" @click="f.gates[s] = !f.gates[s]">
            <span class="track" />{{ f.gates[s] ? 'Gate' : 'No gate' }}
          </button>
        </div>
      </template>

      <!-- 4 Tools: how the client works (v1.7.2) -->
      <template v-else-if="step === 3">
        <h2>How does the client work?</h2>
        <p class="muted small">Optional. Pick the business tools the client uses, and ARGUS drafts a client workflow for you to change later. Nothing connects yet: no passwords or keys are asked for here. Connect tools later in Settings, Connected tools.</p>
        <button type="button" class="switch" :class="{ on: f.clientWorkflows }" role="switch" :aria-checked="f.clientWorkflows" @click="f.clientWorkflows = !f.clientWorkflows">
          <span class="track" /><span style="text-align: left"><strong style="color: var(--text)">Use client workflows</strong> <span class="small muted">Client Workflows in the Settings menu, each use case's client steps, and Settings &gt; Connected tools. Off: the team works in ARGUS only. You can change this later under Settings &gt; General &gt; Modules.</span></span>
        </button>
        <template v-if="f.clientWorkflows">
        <div class="field">
          <span>Start a client workflow from</span>
          <label v-for="t in WF_TEMPLATES" :key="t" class="check-row"><input type="radio" name="wf" :checked="f.workflow?.template === t" @change="f.workflow = { template: t }" /><span><strong>{{ WF_TEMPLATE_INFO[t].label }}</strong><span class="muted small hint-inline">{{ WF_TEMPLATE_INFO[t].hint }}</span></span></label>
          <label class="check-row"><input type="radio" name="wf" :checked="!f.workflow" @change="f.workflow = null" /><span><strong>Decide later</strong><span class="muted small hint-inline">No workflow yet. Add one from Client workflows when you're ready.</span></span></label>
        </div>
        <div class="field">
          <span>Tools this client uses <span class="faint">{{ f.clientTools.length ? `${f.clientTools.length} picked` : 'optional' }}</span></span>
          <template v-for="g in TOOL_GROUPS" :key="g">
            <div class="small faint" style="margin-top: 6px">{{ g }}</div>
            <div class="tool-grid" style="max-height: none">
              <button v-for="t in BUSINESS_TOOLS.filter((x) => x.group === g)" :key="t.id" type="button" :class="{ on: f.clientTools.includes(t.id) }" :aria-pressed="f.clientTools.includes(t.id)" @click="toggleTool(t.id)"><i class="tool-mono" :style="{ background: t.color }">{{ t.mono }}</i>{{ t.name }}</button>
            </div>
          </template>
        </div>
        </template>
      </template>

      <!-- 5 Models -->
      <template v-else-if="step === 4">
        <h2>Which models run the agents?</h2>
        <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
          <button v-for="p in PRESETS" :key="p.id" type="button" class="agent-item" :class="{ selected: preset === p.id }" :disabled="!p.ok" style="flex-direction: column; align-items: flex-start; text-align: left" @click="preset = p.id">
            <strong>{{ p.title }}</strong><span class="small muted">{{ p.hint }}</span>
          </button>
        </div>
        <p class="small" :style="{ color: anthropicReady ? 'var(--ok)' : 'var(--warn)' }">
          {{ anthropicReady ? 'Anthropic API key connected' : anthropic ? 'Anthropic has no working key yet. Add one under Models to use Claude.' : 'No Anthropic provider yet.' }}
          <RouterLink to="/models" class="small" style="margin-left: 6px">Manage models and keys</RouterLink>
        </p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>Runs on</th><th>Model</th><th>Effort</th></tr></thead>
            <tbody>
              <tr v-for="[role, meta] in BUILT" :key="role">
                <td>{{ meta.name }}<div class="small faint">{{ STAGE_LABELS[meta.stage] }}</div></td>
                <td><select v-model="f.agents[role].providerId" class="select" :aria-label="`${meta.name} provider`" @change="preset = 'custom'; f.agents[role].model = modelsOf(f.agents[role].providerId)[0] ?? ''"><option v-for="p in enabled" :key="p.id" :value="p.id">{{ p.name }}</option></select></td>
                <td><select v-model="f.agents[role].model" class="select mono" :aria-label="`${meta.name} model`" @change="preset = 'custom'"><option v-for="m in modelsOf(f.agents[role].providerId)" :key="m" :value="m">{{ m }}</option></select></td>
                <td><select v-model="f.agents[role].effort" class="select" :aria-label="`${meta.name} effort`" @change="preset = 'custom'"><option v-for="e in EFFORTS" :key="e" :value="e">{{ e }}</option></select></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint">The other stages are done by people until their agents are built. Agents never approve anything.</p>
      </template>

      <!-- 6 Review -->
      <template v-else>
        <h2>Check and add</h2>
        <dl class="kv">
          <dt>Engagement</dt><dd><span class="swatch" :style="{ background: f.color, display: 'inline-grid', marginRight: '6px' }">{{ f.prefix[0] }}</span>{{ f.name }}</dd>
          <dt>Client</dt><dd>{{ f.client }}<template v-if="f.sector"> · {{ f.sector }}</template></dd>
          <dt>Card prefix</dt><dd class="mono">{{ f.prefix }}</dd>
          <dt>Frameworks</dt><dd>{{ FRAMEWORK_CHOICES.filter((x) => f.frameworks.includes(x.id)).map((x) => x.label).join(', ') }}</dd>
          <dt>Applicability</dt><dd>{{ f.startSoa ? `${mapped.length} library controls start as applicable` : 'Every control starts undecided' }}</dd>
          <dt>Risk appetite</dt><dd>Residual up to {{ f.appetite.maxResidual }}; above that, a lead accepts for the {{ f.appetite.escalateTo }}</dd>
          <dt>Gates</dt><dd>{{ STAGES.filter((s) => f.gates[s]).map((s) => STAGE_LABELS[s]).join(', ') }}</dd>
          <dt>Agents</dt><dd><div v-for="[role, meta] in BUILT" :key="role">{{ meta.name }}: <span class="mono">{{ f.agents[role]?.model }}</span> on {{ providerName(f.agents[role]?.providerId) }}, {{ f.agents[role]?.effort }} effort</div></dd>
          <dt>Client workflows</dt><dd>{{ f.clientWorkflows ? 'On' : 'Off (the team works in ARGUS only)' }}</dd>
          <template v-if="f.clientWorkflows">
          <dt>Client tools</dt><dd>{{ f.clientTools.length ? f.clientTools.map(toolName).join(', ') : 'None picked' }}<div class="small faint">Connect them later in Settings, Connected tools</div></dd>
          <dt>Client workflow</dt><dd>{{ f.workflow ? `A draft from ${WF_TEMPLATE_INFO[f.workflow.template].label}` : 'Decide later' }}</dd>
          </template>
          <dt>Use cases</dt><dd>{{ useCaseList.length ? useCaseList.join('; ') : 'None yet' }}</dd>
        </dl>
      </template>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="spread">
        <button class="btn" :disabled="step === 0" @click="go(step - 1)">Back</button>
        <button v-if="step < 5" class="btn primary" @click="valid(step) ? (error = valid(step)) : go(step + 1)">Next</button>
        <button v-else class="btn primary" :disabled="busy" @click="create">{{ busy ? 'Adding…' : 'Add engagement' }}</button>
      </div>
    </section>
  </div>
</template>
