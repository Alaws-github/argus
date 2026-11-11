<script setup lang="ts">
// The workflow builder (v1.7). A canvas of steps and arrows with an icon rail
// on the left (add a step, fit, undo, versions) and an inspector on the right.
// The governance gates and the trigger are locked: they can be moved, never
// deleted. The rules in packages/shared/src/workflow.ts run as you draw, and
// the server runs them again before a publish.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  AGENT_ROLES, BUSINESS_TOOLS, PROOF_KINDS, TOOL_GROUPS, WF_LOCKED, WF_NODE_INFO, toolById, validateWorkflow, type Connector,
  type WfEdge, type WfGraph, type WfNode, type WfNodeType, type Workflow, type WorkflowVersion,
} from '@gh/shared';
import { api, ago } from '../api';
import { useApp } from '../stores/app';
import Icon from '../components/Icon.vue';
import ConnectorForm from '../components/ConnectorForm.vue';

const app = useApp();
const route = useRoute();
const W = 196; // node width
const H = 68; // node height

const wf = ref<Workflow | null>(null);
const versions = ref<WorkflowVersion[]>([]);
const graph = ref<WfGraph>({ nodes: [], edges: [] });
const saved = ref('');
const name = ref('');
const description = ref('');
const sel = ref<{ kind: 'node' | 'edge'; id: string } | null>(null);
const panel = ref<'inspect' | 'versions' | 'tools'>('inspect');
// v1.7.1: the engagement's read-only connectors, which a step in a business tool can link to.
const connectors = ref<Connector[]>([]);
const viewing = ref<{ version: number; graph: WfGraph } | null>(null);
const busy = ref(false);
const canvas = ref<HTMLElement | null>(null);
const zoom = ref(1);
const setZoom = (z: number) => (zoom.value = Math.min(1.4, Math.max(0.4, Math.round(z * 100) / 100)));
const canEdit = computed(() => app.can('manage_engagement') && wf.value?.status !== 'retired' && !viewing.value);

const shown = computed<WfGraph>(() => viewing.value?.graph ?? graph.value);
const state = () => JSON.stringify({ g: graph.value, n: name.value, d: description.value });
const dirty = computed(() => !!wf.value && state() !== saved.value);
const check = computed(() => validateWorkflow(shown.value));
const byId = computed(() => new Map(shown.value.nodes.map((n) => [n.id, n])));
const selNode = computed(() => (sel.value?.kind === 'node' ? byId.value.get(sel.value.id) ?? null : null));
const selEdge = computed(() => (sel.value?.kind === 'edge' ? shown.value.edges.find((e) => e.id === sel.value!.id) ?? null : null));
const world = computed(() => ({
  w: Math.max(1200, ...shown.value.nodes.map((n) => n.x + W + 240)),
  h: Math.max(560, ...shown.value.nodes.map((n) => n.y + H + 200)),
}));

async function load() {
  const d = await api<{ workflow: Workflow; versions: WorkflowVersion[] }>(`/workflows/${route.params.id}`);
  wf.value = d.workflow;
  versions.value = d.versions;
  graph.value = JSON.parse(JSON.stringify(d.workflow.graph));
  name.value = d.workflow.name;
  description.value = d.workflow.description;
  saved.value = state();
  history.length = 0;
}
onMounted(async () => {
  await load().catch((e) => app.toast(e.message, 'error'));
  connectors.value = await api<Connector[]>(`/engagements/${app.engagementId}/connectors`).catch(() => []);
  await nextTick();
  fit();
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', guard);
});
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', guard); });
const guard = (e: BeforeUnloadEvent) => { if (dirty.value) { e.preventDefault(); e.returnValue = ''; } };

// Undo: snapshots of the drawing before each change.
const history: string[] = [];
const snap = () => { history.push(JSON.stringify(graph.value)); if (history.length > 40) history.shift(); };
function undo() { const s = history.pop(); if (s) { graph.value = JSON.parse(s); sel.value = null; } }

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_LABEL: Record<WfNodeType, string> = { start: 'Trigger', gate: 'Gate', agent: 'Agent drafts', person: 'Person decides', task: 'Client step', condition: 'Is it high risk?', notify: 'Tell someone', end: 'End' };
function add(type: WfNodeType) {
  if (!canEdit.value) return;
  snap();
  const el = canvas.value!;
  const x = Math.round(((el.scrollLeft + el.clientWidth / 2) / zoom.value - W / 2) / 20) * 20;
  const y = Math.round(((el.scrollTop + el.clientHeight / 2) / zoom.value - H / 2 + (graph.value.nodes.length % 4) * 24) / 20) * 20;
  const n: WfNode = { id: uid(type.slice(0, 4)), type, label: DEFAULT_LABEL[type], x, y, config: type === 'agent' ? { agent: 'risk_classifier' } : type === 'person' ? { role: 'Reviewer' } : {} };
  graph.value.nodes.push(n);
  sel.value = { kind: 'node', id: n.id };
  panel.value = 'inspect';
}
function remove() {
  if (!canEdit.value || !sel.value) return;
  if (sel.value.kind === 'node') {
    if (WF_LOCKED.has(sel.value.id)) return app.toast('Governance steps and the trigger can be moved, not removed.', 'error');
    snap();
    const id = sel.value.id;
    graph.value.nodes = graph.value.nodes.filter((n) => n.id !== id);
    graph.value.edges = graph.value.edges.filter((e) => e.from !== id && e.to !== id);
  } else {
    snap();
    graph.value.edges = graph.value.edges.filter((e) => e.id !== sel.value!.id);
  }
  sel.value = null;
}
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel.value) { e.preventDefault(); remove(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if (e.key === 'Escape') sel.value = null;
}

// Dragging a step, and drawing an arrow from a step's right-hand dot.
const drag = ref<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
const wire = ref<{ from: string; x: number; y: number } | null>(null);
const pt = (e: PointerEvent) => { const r = canvas.value!.getBoundingClientRect(); return { x: (e.clientX - r.left + canvas.value!.scrollLeft) / zoom.value, y: (e.clientY - r.top + canvas.value!.scrollTop) / zoom.value }; };
function downNode(e: PointerEvent, n: WfNode) {
  sel.value = { kind: 'node', id: n.id };
  panel.value = 'inspect';
  if (!canEdit.value || e.button !== 0) return;
  const p = pt(e);
  drag.value = { id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function downPort(e: PointerEvent, n: WfNode) {
  if (!canEdit.value) return;
  e.stopPropagation();
  wire.value = { from: n.id, ...pt(e) };
  canvas.value!.setPointerCapture(e.pointerId);
}
function move(e: PointerEvent) {
  if (drag.value) {
    const n = graph.value.nodes.find((x) => x.id === drag.value!.id)!;
    const p = pt(e);
    if (!drag.value.moved) { snap(); drag.value.moved = true; }
    n.x = Math.max(0, Math.round((p.x - drag.value.dx) / 20) * 20);
    n.y = Math.max(0, Math.round((p.y - drag.value.dy) / 20) * 20);
  } else if (wire.value) Object.assign(wire.value, pt(e));
}
function up(e: PointerEvent) {
  if (wire.value) {
    const p = pt(e);
    const to = graph.value.nodes.find((n) => p.x >= n.x && p.x <= n.x + W && p.y >= n.y && p.y <= n.y + H);
    const from = wire.value.from;
    if (to && to.id !== from && !graph.value.edges.some((x) => x.from === from && x.to === to.id)) {
      snap();
      // An arrow back to a step that already leads here is rework (a loop back), not a new path.
      const leadsHere = (start: string) => { const seen = new Set([start]); const st = [start]; while (st.length) { const c = st.pop()!; for (const x of graph.value.edges) if (!x.rework && x.from === c && !seen.has(x.to)) { seen.add(x.to); st.push(x.to); } } return seen.has(from); };
      const back = leadsHere(to.id);
      const ed: WfEdge = { id: uid('e'), from, to: to.id, ...(back ? { rework: true, label: 'Changes requested' } : {}) };
      graph.value.edges.push(ed);
      sel.value = { kind: 'edge', id: ed.id };
    }
    wire.value = null;
  }
  drag.value = null;
}

// Arrow geometry: forward arrows curve right; rework arrows loop underneath.
function path(e: WfEdge) {
  const a = byId.value.get(e.from);
  const b = byId.value.get(e.to);
  if (!a || !b) return '';
  const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
  // On to the next row: leave from the bottom, arrive at the top.
  if (!e.rework && x2 < x1 - 20 && b.y > a.y + H) {
    const ax = a.x + W / 2, bx = b.x + W / 2, my = (a.y + H + b.y) / 2;
    return `M ${ax} ${a.y + H} C ${ax} ${my}, ${bx} ${my}, ${bx} ${b.y}`;
  }
  if (e.rework || x2 < x1 - 20) {
    const low = Math.max(a.y, b.y) + H + 46;
    return `M ${a.x + W / 2} ${a.y + H} C ${a.x + W / 2} ${low}, ${b.x + W / 2} ${low}, ${b.x + W / 2} ${b.y + H}`;
  }
  const c = Math.max(40, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
}
function mid(e: WfEdge) {
  const a = byId.value.get(e.from), b = byId.value.get(e.to);
  if (!a || !b) return { x: 0, y: 0 };
  if (!e.rework && b.x < a.x + W - 20 && b.y > a.y + H) return { x: (a.x + b.x) / 2 + W / 2, y: (a.y + H + b.y) / 2 };
  if (e.rework || b.x + 0 < a.x + W - 20) return { x: (a.x + b.x) / 2 + W / 2, y: Math.max(a.y, b.y) + H + 34 };
  return { x: (a.x + W + b.x) / 2, y: (a.y + b.y) / 2 + H / 2 - 9 };
}
const wirePath = computed(() => {
  if (!wire.value) return '';
  const a = byId.value.get(wire.value.from)!;
  const x1 = a.x + W, y1 = a.y + H / 2;
  return `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${wire.value.x - 60} ${wire.value.y}, ${wire.value.x} ${wire.value.y}`;
});

function fit() {
  const el = canvas.value;
  if (!el || !shown.value.nodes.length) return;
  // Zoom so the whole workflow fits the width (not below 50%), then scroll to its top-left.
  const minX = Math.min(...shown.value.nodes.map((n) => n.x)), minY = Math.min(...shown.value.nodes.map((n) => n.y));
  const maxX = Math.max(...shown.value.nodes.map((n) => n.x + W));
  setZoom(Math.max(0.6, Math.min(1, (el.clientWidth - 60) / (maxX - minX + 80))));
  void nextTick(() => el.scrollTo({ left: Math.max(0, (minX - 40) * zoom.value), top: Math.max(0, (minY - 80) * zoom.value), behavior: 'smooth' }));
}
function focusNode(id: string) {
  const n = byId.value.get(id);
  if (!n || !canvas.value) return;
  sel.value = { kind: 'node', id };
  panel.value = 'inspect';
  canvas.value.scrollTo({ left: Math.max(0, (n.x + W / 2) * zoom.value - canvas.value.clientWidth / 2), top: Math.max(0, (n.y + H / 2) * zoom.value - canvas.value.clientHeight / 2), behavior: 'smooth' });
}
const problemOf = (id: string) => check.value.nodeProblems[id]?.length ?? 0;

// Save, publish, versions.
async function save() {
  busy.value = true;
  try {
    const d = await api<{ workflow: Workflow }>(`/workflows/${wf.value!.id}`, { method: 'PATCH', body: { name: name.value, description: description.value, graph: graph.value } });
    wf.value = d.workflow;
    saved.value = state();
    app.toast(check.value.problems.length ? `Draft saved. ${check.value.problems.length} thing${check.value.problems.length === 1 ? '' : 's'} to fix before it can be published.` : 'Draft saved');
  } catch (e: any) { app.toast(e.message, 'error'); } finally { busy.value = false; }
}
async function publish() {
  if (dirty.value) await save();
  const note = window.prompt('A note for this version (optional): what changed and why', '') ?? null;
  if (note === null) return;
  busy.value = true;
  try {
    await api(`/workflows/${wf.value!.id}/publish`, { method: 'POST', body: { note } });
    await load();
    app.toast(`Published as version ${wf.value!.version}`);
  } catch (e: any) { app.toast(e.message, 'error'); } finally { busy.value = false; }
}
async function view(v: number) {
  const d = await api<{ graph: WfGraph }>(`/workflows/${wf.value!.id}/versions/${v}`);
  viewing.value = { version: v, graph: d.graph };
  sel.value = null;
  await nextTick();
  fit();
}
async function restore(v: number) {
  if (dirty.value && !window.confirm('Restoring replaces your unsaved changes. Carry on?')) return;
  try {
    await api(`/workflows/${wf.value!.id}/restore`, { method: 'POST', body: { version: v } });
    viewing.value = null;
    await load();
    app.toast(`Version ${v} is the draft again. Publish it to make it current.`);
  } catch (e: any) { app.toast(e.message, 'error'); }
}
async function retire() {
  if (!window.confirm('Retire this workflow? Its versions are kept, and you can restore one later.')) return;
  try { await api(`/workflows/${wf.value!.id}/retire`, { method: 'POST', body: {} }); await load(); app.toast('Retired'); } catch (e: any) { app.toast(e.message, 'error'); }
}

// Which steps happen in a business tool, and the tools this workflow uses.
const TOOL_TYPES = new Set<WfNodeType>(['start', 'person', 'task', 'notify']);
const conn = (id?: string | null) => connectors.value.find((c) => c.id === id) ?? null;
const connState = (c: Connector | null) => (!c ? '' : c.lastStatus === 'failed' ? 'bad' : c.lastStatus === 'never' ? 'new' : 'ok');
const toolsUsed = computed(() => {
  const by = new Map<string, { tool: NonNullable<ReturnType<typeof toolById>>; steps: WfNode[]; linked: Connector[] }>();
  for (const n of shown.value.nodes) {
    const t = toolById(n.config.tool);
    if (!t) continue;
    const e = by.get(t.id) ?? { tool: t, steps: [], linked: [] };
    e.steps.push(n);
    const c = conn(n.config.connectorId);
    if (c && !e.linked.includes(c)) e.linked.push(c);
    by.set(t.id, e);
  }
  return [...by.values()];
});
const connectorsFor = (tool?: string) => [...connectors.value].sort((a, b) => Number(b.tool === tool) - Number(a.tool === tool));
// v1.7.2: add a connector in place, without leaving the builder. A new one is linked to the step it was started from.
const connForm = ref<{ tool?: string; nodeId?: string } | null>(null);
function onConnSaved(c: Connector) {
  connectors.value = [...connectors.value.filter((x) => x.id !== c.id), c];
  const n = connForm.value?.nodeId ? graph.value.nodes.find((x) => x.id === connForm.value!.nodeId) : null;
  if (n) { snap(); n.config.connectorId = c.id; if (!n.config.tool && c.tool) n.config.tool = c.tool; }
  connForm.value = null;
}
// The client's tools (Settings > Connected tools) come first in the tool list.
const myTools = computed(() => BUSINESS_TOOLS.filter((t) => app.engagement?.clientTools?.includes(t.id)));
function pickTool(n: WfNode, id: string) {
  n.config.tool = id || undefined;
  if (!id) { n.config.toolDetail = undefined; n.config.connectorId = undefined; }
  else if (n.config.connectorId && conn(n.config.connectorId)?.tool && conn(n.config.connectorId)!.tool !== id) n.config.connectorId = undefined;
}

const ADD: WfNodeType[] = ['agent', 'person', 'task', 'condition', 'notify', 'end'];
const AGENTS = Object.entries(AGENT_ROLES).map(([id, a]) => ({ id, name: a.name }));
const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'amber'], published: ['Published', 'green'], retired: ['Retired', ''] };
</script>

<template>
  <div class="wf-shell" :class="{ readonly: !canEdit }">
    <!-- Icon rail: only inside the builder. The top menu stays as it is. -->
    <nav class="wf-rail" aria-label="Workflow tools">
      <RouterLink to="/workflows" class="wf-tool" title="All workflows" aria-label="All workflows"><Icon name="workflow" :size="18" /></RouterLink>
      <span class="wf-sep" />
      <button v-for="t in ADD" :key="t" class="wf-tool" :disabled="!canEdit" :title="`Add: ${WF_NODE_INFO[t].label}. ${WF_NODE_INFO[t].hint}`" :aria-label="`Add ${WF_NODE_INFO[t].label}`" @click="add(t)">
        <Icon :name="WF_NODE_INFO[t].icon" :size="18" /><i :class="`wf-swatch t-${t}`" />
      </button>
      <span class="wf-sep" />
      <button class="wf-tool" title="Fit the workflow in view" aria-label="Fit in view" @click="fit"><Icon name="grid" :size="18" /></button>
      <button class="wf-tool" :disabled="!canEdit" title="Undo (Ctrl+Z)" aria-label="Undo" @click="undo"><Icon name="undo" :size="18" /></button>
      <button class="wf-tool" :class="{ on: panel === 'tools' }" title="Business tools in this workflow" aria-label="Business tools" @click="panel = panel === 'tools' ? 'inspect' : 'tools'; sel = null"><Icon name="models" :size="18" /></button>
      <button class="wf-tool" :class="{ on: panel === 'versions' }" title="Versions" aria-label="Versions" @click="panel = panel === 'versions' ? 'inspect' : 'versions'"><Icon name="history" :size="18" /></button>
    </nav>

    <section class="wf-main" style="position: relative">
      <header v-if="wf" class="wf-bar">
        <div class="wf-title">
          <span class="mono faint small">{{ wf.key }}</span>
          <input v-model="name" class="wf-name" :disabled="!canEdit" aria-label="Workflow name" maxlength="80" />
          <span class="pill" :class="STATUS[wf.status][1]"><span class="dot" />{{ STATUS[wf.status][0] }}{{ wf.version ? ` · v${wf.version}` : '' }}</span>
          <span v-if="wf.version && wf.changedSincePublish && wf.status !== 'retired'" class="badge info">Changed since v{{ wf.version }}</span>
        </div>
        <div class="row wf-actions">
          <button class="btn sm" :class="check.problems.length ? 'warn-btn' : ''" @click="sel = null; panel = 'inspect'">
            <Icon :name="check.problems.length ? 'alert' : 'check'" :size="14" />{{ check.problems.length ? `${check.problems.length} to fix` : 'Passes every rule' }}
          </button>
          <template v-if="canEdit">
            <button class="btn sm" :disabled="!dirty || busy" @click="save">Save draft</button>
            <button class="btn sm primary" :disabled="busy || !!check.problems.length || (!dirty && wf.status === 'published' && !wf.changedSincePublish)" :title="check.problems.length ? 'Fix the problems first' : 'Publish a new version'" @click="publish">Publish</button>
          </template>
        </div>
      </header>
      <div v-if="viewing" class="wf-viewing">
        Viewing version {{ viewing.version }} (read-only).
        <button v-if="app.can('manage_engagement')" class="btn sm" @click="restore(viewing.version)">Make this the draft</button>
        <button class="btn sm ghost" @click="viewing = null">Back to the draft</button>
      </div>

      <div ref="canvas" class="wf-canvas" @pointermove="move" @pointerup="up" @pointerdown.self="sel = null">
        <div class="wf-zoom-box" :style="{ width: `${world.w * zoom}px`, height: `${world.h * zoom}px` }">
        <div class="wf-world" :style="{ width: `${world.w}px`, height: `${world.h}px`, transform: `scale(${zoom})` }" @pointerdown.self="sel = null">
          <svg class="wf-edges" :width="world.w" :height="world.h">
            <defs>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="wf-arrowhead" /></marker>
              <marker id="wf-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="wf-arrowhead sel" /></marker>
            </defs>
            <g v-for="e in shown.edges" :key="e.id" class="wf-edge" :class="{ rework: e.rework, sel: sel?.kind === 'edge' && sel.id === e.id }" @pointerdown.stop="sel = { kind: 'edge', id: e.id }; panel = 'inspect'">
              <path :d="path(e)" class="hit" />
              <path :d="path(e)" class="line" :marker-end="sel?.kind === 'edge' && sel.id === e.id ? 'url(#wf-arrow-sel)' : 'url(#wf-arrow)'" />
            </g>
            <path v-if="wire" :d="wirePath" class="wf-wire" />
          </svg>
          <template v-for="e in shown.edges" :key="'l' + e.id">
            <span v-if="e.label" class="wf-edge-label" :class="{ rework: e.rework }" :style="{ left: `${mid(e).x}px`, top: `${mid(e).y}px` }" @pointerdown.stop="sel = { kind: 'edge', id: e.id }; panel = 'inspect'">{{ e.label }}</span>
          </template>
          <div
            v-for="n in shown.nodes" :key="n.id" class="wf-node" :class="[`t-${n.type}`, { sel: sel?.kind === 'node' && sel.id === n.id, locked: WF_LOCKED.has(n.id), bad: problemOf(n.id) }]"
            :style="{ left: `${n.x}px`, top: `${n.y}px`, width: `${W}px`, height: `${H}px` }" tabindex="0" role="button" :aria-label="`${WF_NODE_INFO[n.type].label}: ${n.label}`"
            @pointerdown="downNode($event, n)" @keydown.enter="sel = { kind: 'node', id: n.id }"
          >
            <span class="wf-node-icon"><Icon :name="WF_NODE_INFO[n.type].icon" :size="15" /></span>
            <span class="wf-node-text">
              <span class="wf-node-type">{{ WF_NODE_INFO[n.type].label }}<template v-if="n.type === 'person' && n.config.role"> · {{ n.config.role }}</template><template v-if="n.type === 'agent' && n.config.agent"> · {{ (AGENT_ROLES as any)[n.config.agent]?.name }}</template></span>
              <span class="wf-node-label">{{ n.label }}</span>
            </span>
            <span v-if="toolById(n.config.tool)" class="wf-tool-chip" :title="`In ${toolById(n.config.tool)!.name}${n.config.toolDetail ? `: ${n.config.toolDetail}` : ''}${conn(n.config.connectorId) ? `. Read by ${conn(n.config.connectorId)!.key}` : ''}`">
              <i class="tool-mono" :style="{ background: toolById(n.config.tool)!.color }">{{ toolById(n.config.tool)!.mono }}</i>{{ toolById(n.config.tool)!.name }}<i v-if="conn(n.config.connectorId)" class="conn-dot" :class="connState(conn(n.config.connectorId))" />
            </span>
            <span v-if="problemOf(n.id)" class="wf-node-bad" :title="check.nodeProblems[n.id].join('\n')">{{ problemOf(n.id) }}</span>
            <span v-if="n.type !== 'end' && canEdit" class="wf-port" title="Drag to another step to draw an arrow" @pointerdown="downPort($event, n)" />
          </div>
        </div>
        </div>
      </div>
      <div class="wf-zoom" role="group" aria-label="Zoom">
        <button class="ap-icon sm" title="Zoom out" aria-label="Zoom out" @click="setZoom(zoom - 0.1)">−</button>
        <button class="wf-zoom-pct" title="Fit the workflow in view" @click="fit">{{ Math.round(zoom * 100) }}%</button>
        <button class="ap-icon sm" title="Zoom in" aria-label="Zoom in" @click="setZoom(zoom + 0.1)">+</button>
      </div>
    </section>

    <aside class="wf-side">
      <template v-if="panel === 'tools'">
        <h2>Business tools</h2>
        <p class="small muted">Where each step happens, and which ones ARGUS reads. Connectors only read: ARGUS never changes anything in these tools.</p>
        <div v-if="!toolsUsed.length" class="small faint">No steps name a tool yet. Click a step and choose where it happens.</div>
        <div v-for="u in toolsUsed" :key="u.tool.id" class="wf-version">
          <div class="spread"><span class="row" style="gap: 8px"><i class="tool-mono lg" :style="{ background: u.tool.color }">{{ u.tool.mono }}</i><strong>{{ u.tool.name }}</strong></span><span class="small faint">{{ u.steps.length }} step{{ u.steps.length === 1 ? '' : 's' }}</span></div>
          <div class="small"><button v-for="s in u.steps" :key="s.id" class="linklike" style="margin-right: 8px" @click="focusNode(s.id)">{{ s.label }}</button></div>
          <div v-if="u.linked.length" class="small"><span v-for="c in u.linked" :key="c.id" class="row" style="gap: 6px"><i class="conn-dot" :class="connState(c)" />Read by {{ c.key }} {{ c.name }} · {{ c.lastStatus === 'never' ? 'not pulled yet' : c.lastMessage }}</span></div>
          <div v-else-if="u.tool.read" class="small faint">Not read by ARGUS yet. <button v-if="app.can('manage_engagement') && canEdit" class="linklike" @click="connForm = { tool: u.tool.id, nodeId: u.steps[0]?.id }">Add a connector</button></div>
          <div v-else class="small faint">Mapped only: ARGUS doesn't read {{ u.tool.name }}.</div>
        </div>
      </template>

      <template v-else-if="panel === 'versions'">
        <h2>Versions</h2>
        <p class="small muted">Each publish keeps a numbered copy. View one, or make it the draft again.</p>
        <div v-if="!versions.length" class="small faint">Not published yet.</div>
        <div v-for="v in versions" :key="v.version" class="wf-version" :class="{ on: viewing?.version === v.version }">
          <div class="spread"><strong>Version {{ v.version }}</strong><span class="small faint">{{ ago(v.publishedAt) }}</span></div>
          <div class="small muted">{{ v.publishedBy }} · {{ v.nodes }} steps</div>
          <div v-if="v.note" class="small">“{{ v.note }}”</div>
          <div class="row"><button class="btn sm" @click="view(v.version)">View</button><button v-if="app.can('manage_engagement')" class="btn sm ghost" @click="restore(v.version)">Make the draft</button></div>
        </div>
        <button v-if="app.can('manage_engagement') && wf?.status !== 'retired'" class="btn sm ghost danger-text" style="margin-top: 12px" @click="retire">Retire this workflow</button>
      </template>

      <template v-else-if="selNode">
        <div class="spread"><span class="label-caps">{{ WF_NODE_INFO[selNode.type].label }}</span><span v-if="WF_LOCKED.has(selNode.id)" class="badge"><Icon name="lock" :size="12" />Built in</span></div>
        <p class="small muted">{{ WF_NODE_INFO[selNode.type].hint }}</p>
        <label class="field"><span>Name</span><input v-model="selNode.label" class="input" maxlength="80" :disabled="!canEdit || selNode.type === 'gate'" /></label>
        <label v-if="selNode.type === 'start'" class="field"><span>What starts it</span><input v-model="selNode.config.trigger" class="input" :disabled="!canEdit" placeholder="New use case, vendor change, scheduled review, incident" /></label>
        <label v-if="selNode.type === 'agent'" class="field"><span>Which agent drafts</span>
          <select v-model="selNode.config.agent" class="select" :disabled="!canEdit"><option v-for="a in AGENTS" :key="a.id" :value="a.id">{{ a.name }}</option></select>
        </label>
        <label v-if="selNode.type === 'person' || selNode.type === 'task' || selNode.type === 'notify'" class="field"><span>{{ selNode.type === 'notify' ? 'Who is told' : selNode.type === 'task' ? 'Who does it' : 'Which role decides' }}</span><input v-model="selNode.config.role" class="input" :disabled="!canEdit" placeholder="For example: Head of Credit Risk" /></label>
        <label v-if="selNode.type === 'condition'" class="field"><span>The question</span><input v-model="selNode.config.question" class="input" :disabled="!canEdit" placeholder="Is the risk tier high or prohibited?" /></label>
        <p v-if="selNode.type === 'gate'" class="small">ARGUS stage: <strong>{{ selNode.config.stage }}</strong>. Every path must pass this gate, in order, and a named person decides at it.</p>
        <div v-if="TOOL_TYPES.has(selNode.type)" class="wf-toolbox">
          <label class="field"><span>Happens in</span>
            <select class="select" :value="selNode.config.tool ?? ''" :disabled="!canEdit" @change="pickTool(selNode, ($event.target as HTMLSelectElement).value)">
              <option value="">ARGUS, or not set</option>
              <optgroup v-if="myTools.length" label="This client's tools"><option v-for="t in myTools" :key="'m' + t.id" :value="t.id">{{ t.name }}</option></optgroup>
              <optgroup v-for="g in TOOL_GROUPS" :key="g" :label="g"><option v-for="t in BUSINESS_TOOLS.filter((x) => x.group === g)" :key="t.id" :value="t.id">{{ t.name }}</option></optgroup>
            </select>
          </label>
          <template v-if="toolById(selNode.config.tool)">
            <label class="field"><span>Where in {{ toolById(selNode.config.tool)!.name }}</span><input v-model="selNode.config.toolDetail" class="input" maxlength="120" :disabled="!canEdit" placeholder="Site, list, project, queue or channel" /></label>
            <label v-if="toolById(selNode.config.tool)!.read" class="field"><span>ARGUS reads it with</span>
              <select v-model="selNode.config.connectorId" class="select" :disabled="!canEdit">
                <option :value="undefined">No connector (mapped only)</option>
                <option v-for="c in connectorsFor(selNode.config.tool)" :key="c.id" :value="c.id">{{ c.key }} {{ c.name }}{{ c.tool && c.tool !== selNode.config.tool ? ` (${toolById(c.tool)?.name ?? c.tool})` : '' }}</option>
              </select>
              <span v-if="conn(selNode.config.connectorId)" class="hint">{{ conn(selNode.config.connectorId)!.lastStatus === 'never' ? 'Not pulled yet' : `Last pull ${ago(conn(selNode.config.connectorId)!.lastPullAt!)}: ${conn(selNode.config.connectorId)!.lastMessage}` }}</span>
              <button v-else-if="app.can('manage_engagement')" type="button" class="btn sm" style="align-self: flex-start" :disabled="!canEdit" @click="connForm = { tool: selNode.config.tool, nodeId: selNode.id }"><Icon name="plus" :size="13" />Add a read-only connector for {{ toolById(selNode.config.tool)!.name }}</button>
            </label>
            <p v-else class="hint">ARGUS maps this step but doesn't read {{ toolById(selNode.config.tool)!.name }}.</p>
          </template>
          <!-- v1.7.3: what proves the step was done for a use case, checked on the use case's Client steps. -->
          <label class="field"><span>Proof it was done</span>
            <select v-model="selNode.config.proof" class="select" :disabled="!canEdit">
              <option v-for="(l, k) in PROOF_KINDS" :key="k" :value="k || undefined" :disabled="!!k && k !== 'manual' && !selNode.config.connectorId">{{ l }}{{ k && k !== 'manual' && !selNode.config.connectorId ? ' (needs a connector)' : '' }}</option>
            </select>
            <span class="hint">{{ selNode.config.proof && selNode.config.proof !== 'manual' ? 'ARGUS reads the connector and looks for records that mention the use case key (for example AI-3). Ask the client to put the key in the ticket, request or file.' : selNode.config.proof === 'manual' ? 'A person confirms it on the use case, with a link to the record.' : 'The step is shown on each use case but not checked.' }}</span>
          </label>
          <label v-if="selNode.config.proof === 'status' || selNode.config.proof === 'all_done'" class="field"><span>{{ selNode.config.proof === 'status' ? 'Status that counts as done' : 'Also counts as done' }} <span v-if="selNode.config.proof === 'all_done'" class="faint">optional</span></span><input v-model="selNode.config.proofStatus" class="input" maxlength="60" :disabled="!canEdit" :placeholder="selNode.config.proof === 'status' ? 'Approved' : 'Done, Closed and Resolved always count'" /></label>
        </div>
        <label class="field"><span>Notes</span><textarea v-model="selNode.config.note" class="textarea" :disabled="!canEdit" placeholder="What happens here, in the client's words" /></label>
        <ul v-if="check.nodeProblems[selNode.id]" class="wf-problems"><li v-for="p in check.nodeProblems[selNode.id]" :key="p">{{ p }}</li></ul>
        <button v-if="canEdit && !WF_LOCKED.has(selNode.id)" class="btn sm ghost danger-text" @click="remove"><Icon name="trash" :size="14" />Remove step</button>
        <p class="small faint">Drag a step to move it. Drag from its right-hand dot to another step to draw an arrow.</p>
      </template>

      <template v-else-if="selEdge">
        <span class="label-caps">Arrow</span>
        <p class="small muted">{{ byId.get(selEdge.from)?.label }} → {{ byId.get(selEdge.to)?.label }}</p>
        <label class="field"><span>Label</span><input v-model="selEdge.label" class="input" maxlength="40" :disabled="!canEdit" placeholder="Yes, No, Approved…" /></label>
        <label class="check-row"><input v-model="selEdge.rework" type="checkbox" :disabled="!canEdit" /><span><strong>Rework</strong><span class="muted small hint-inline">Goes back to an earlier step, such as "changes requested". Rework arrows don't count as a way round a gate.</span></span></label>
        <button v-if="canEdit" class="btn sm ghost danger-text" @click="remove"><Icon name="trash" :size="14" />Remove arrow</button>
      </template>

      <template v-else>
        <h2>{{ check.problems.length ? 'Before it can be published' : 'Ready to publish' }}</h2>
        <ul v-if="check.problems.length" class="wf-problems">
          <li v-for="p in check.problems" :key="p"><button class="linklike" @click="Object.entries(check.nodeProblems).find(([, ps]) => ps.includes(p)) && focusNode(Object.entries(check.nodeProblems).find(([, ps]) => ps.includes(p))![0])">{{ p }}</button></li>
        </ul>
        <p v-else class="small muted">Every governance rule passes: all five gates are on every path, in order, and a person decides after every agent step.</p>
        <label class="field"><span>What it covers</span><textarea v-model="description" class="textarea" :disabled="!canEdit" maxlength="400" placeholder="Which use cases follow it, and whose process it is" /></label>
        <div class="wf-rules small">
          <span class="label-caps">The rules</span>
          <ul class="plain">
            <li><Icon name="lock" :size="12" /> The five governance gates and the trigger can't be removed.</li>
            <li><Icon name="lock" :size="12" /> Every path from the trigger to an end passes every gate, in order.</li>
            <li><Icon name="lock" :size="12" /> After an agent step, a person or a gate decides before the end.</li>
            <li><Icon name="lock" :size="12" /> Each condition has labelled ways out; each step is connected.</li>
          </ul>
        </div>
        <p v-if="wf" class="small faint">Changed {{ ago(wf.updatedAt) }} by {{ wf.updatedBy }}{{ wf.publishedAt ? `. Published ${ago(wf.publishedAt)} by ${wf.publishedBy}` : '' }}. Every save and publish is in the audit log.</p>
      </template>
    </aside>
    <ConnectorForm v-if="connForm" :tool="connForm.tool" @saved="onConnSaved" @close="connForm = null" />
  </div>
</template>
