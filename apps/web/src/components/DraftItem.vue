<script setup lang="ts">
// One item of an AI agent's draft (a risk, a control, a challenge, the tier):
// what the agent proposed, why, the sources it rests on, and the reviewer's
// decision. Sources open in place so the reviewer reads exactly what the agent saw.
import { computed, ref } from 'vue';
import { VERDICT_ADVICE, VERDICT_LABELS, describeSource, type ItemDecision, type ItemVerdict, type SourcePassage } from '@gh/shared';

export interface EditField { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'select'; options?: { value: string | number; label: string }[] }

const props = defineProps<{
  title: string;
  meta?: string;
  why?: string;
  sources?: string[];
  passages?: SourcePassage[];
  decision?: ItemDecision;
  canDecide: boolean;
  fields?: EditField[];
  values?: Record<string, unknown>;
  noReject?: boolean;
  verdict?: ItemVerdict;
}>();
const emit = defineEmits<{ decide: [decision: 'accept' | 'edit' | 'reject', edit?: Record<string, unknown>, reason?: string] }>();

const openSource = ref<string | null>(null);
const mode = ref<'' | 'edit' | 'reject'>('');
const draft = ref<Record<string, unknown>>({});
const reason = ref('');
const passageOf = (id: string) => props.passages?.find((p) => p.id === id);
const about = (id: string) => { const p = passageOf(id); return p ? describeSource(p) : null; };

// Save change stays off until a field differs from the AI's draft.
const editChanged = computed(() => Object.entries(draft.value).some(([k, v]) => v !== props.values?.[k]));
function startEdit() {
  draft.value = { ...(props.values ?? {}) };
  reason.value = '';
  mode.value = 'edit';
}
function save() {
  const changed = Object.fromEntries(Object.entries(draft.value).filter(([k, v]) => v !== props.values?.[k]));
  emit('decide', 'edit', changed, reason.value.trim());
  mode.value = '';
}
function reject() {
  emit('decide', 'reject', undefined, reason.value.trim());
  mode.value = '';
}
const state = computed(() => props.decision?.decision ?? 'open');
const LABEL: Record<string, string> = { open: 'To decide', accept: 'Accepted', edit: 'Edited', reject: 'Rejected' };
</script>

<template>
  <div class="draft-item" :class="state">
    <div class="spread" style="align-items: flex-start">
      <div class="grow">
        <div class="draft-title">{{ title }}</div>
        <div v-if="meta" class="small faint">{{ meta }}</div>
      </div>
      <span class="decision-chip" :class="state">{{ LABEL[state] }}</span>
    </div>

    <p v-if="why" class="small draft-why"><span class="label-caps">Why</span> {{ why }}</p>

    <!-- v1.7.4: each source says what it is (a framework requirement, a library control, ARGUS's method, a client document)
         and which frameworks it draws on, so nobody has to know what K-55 means. Click to read the passage. -->
    <div v-if="sources !== undefined" class="source-block">
      <span class="label-caps">Based on</span>
      <template v-if="sources?.length">
        <button v-for="s in sources" :key="s" type="button" class="source-line" :class="{ on: openSource === s }" :aria-expanded="openSource === s" :title="openSource === s ? 'Hide the passage' : 'Read the passage the agent used'" @click="openSource = openSource === s ? null : s">
          <template v-if="about(s)">
            <span class="source-kind">{{ about(s)!.kind }}</span>
            <span class="source-name">{{ about(s)!.name }}</span>
            <span v-if="about(s)!.basedOn.length" class="small faint">drawing on {{ about(s)!.basedOn.join(', ') }}</span>
          </template>
          <span v-else class="source-name">Passage {{ s }}</span>
          <span class="mono faint small source-id">{{ s }}</span>
        </button>
      </template>
      <span v-else class="badge warn" title="The agent cited no passage for this. Check it yourself before accepting.">No source cited</span>
    </div>
    <blockquote v-if="openSource && passageOf(openSource)" class="passage">
      <div class="small faint">{{ about(openSource)!.kind }}: {{ passageOf(openSource)!.title }} <span class="mono">({{ openSource }})</span></div>
      <div class="small">{{ passageOf(openSource)!.text }}</div>
    </blockquote>

    <div v-if="verdict" class="verdict" :class="verdict.verdict">
      <span class="verdict-chip">Verifier: {{ VERDICT_LABELS[verdict.verdict] }}</span>
      <span class="small">{{ VERDICT_ADVICE[verdict.verdict] }}</span>
      <span v-if="verdict.quote && verdict.quoteFound" class="small faint">The passage says: <q>{{ verdict.quote }}</q></span>
      <span class="small faint">{{ verdict.reason }}</span>
    </div>

    <p v-if="decision && decision.decision !== 'accept'" class="small decision-note">
      <strong>{{ decision.by }}</strong> {{ decision.decision === 'edit' ? 'changed' : 'rejected' }} this<template v-if="decision.edit">: {{ Object.entries(decision.edit).map(([k, v]) => `${k} → ${v}`).join(', ') }}</template><template v-if="decision.reason">. “{{ decision.reason }}”</template>
    </p>

    <form v-if="mode === 'edit'" class="stack" style="gap: 8px" @submit.prevent="save">
      <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px">
        <label v-for="f in fields" :key="f.key" class="field" :style="f.type === 'textarea' || f.type === 'text' ? 'grid-column: 1 / -1' : ''">
          <span>{{ f.label }}</span>
          <textarea v-if="f.type === 'textarea'" v-model="draft[f.key] as string" class="textarea" style="min-height: 70px" />
          <select v-else-if="f.type === 'select'" v-model="draft[f.key]" class="select"><option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option></select>
          <input v-else-if="f.type === 'number'" v-model.number="draft[f.key]" type="number" min="1" max="5" class="input" />
          <input v-else v-model="draft[f.key] as string" class="input" />
        </label>
      </div>
      <input v-model="reason" class="input" placeholder="Why you changed it (goes in the audit trail)" required minlength="3" aria-label="Reason for the change" />
      <div class="row"><button class="btn sm primary" :disabled="!editChanged">Save change</button><button type="button" class="btn sm ghost" @click="mode = ''">Cancel</button></div>
    </form>
    <form v-else-if="mode === 'reject'" class="row" style="flex-wrap: wrap" @submit.prevent="reject">
      <input v-model="reason" class="input grow" placeholder="Why it should not be kept" required minlength="3" aria-label="Reason for rejecting" />
      <button class="btn sm danger">Reject</button><button type="button" class="btn sm ghost" @click="mode = ''">Cancel</button>
    </form>
    <div v-else-if="canDecide" class="row">
      <button v-if="state !== 'accept'" class="btn sm" @click="emit('decide', 'accept')">Accept</button>
      <button v-if="fields?.length" class="btn sm" @click="startEdit">Edit</button>
      <button v-if="!noReject && state !== 'reject'" class="btn sm ghost" @click="mode = 'reject'; reason = ''">Reject</button>
    </div>
  </div>
</template>

<style scoped>
.source-block { display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
.source-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; text-align: left; font: inherit; color: var(--text); background: none; border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; cursor: pointer; }
.source-line:hover, .source-line.on { border-color: var(--accent-line); background: var(--accent-bg); }
.source-kind { font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: var(--accent-text); }
.source-name { font-size: 13px; }
.source-id { margin-left: auto; }
</style>
