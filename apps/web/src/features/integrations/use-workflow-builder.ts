// Everything the workflow builder knows and does (v1.7.8: moved out of WorkflowBuilderPage.vue so the
// inspector is its own component). The graph and its undo history, dragging steps and drawing arrows,
// arrow geometry, the rules checked as you draw (validateWorkflow), saving, publishing and versions,
// and the business tools and connectors each step uses.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  AGENT_ROLES,
  BUSINESS_TOOLS,
  WF_LOCKED,
  toolById,
  validateWorkflow,
  type Connector,
  type WfEdge,
  type WfGraph,
  type WfNode,
  type WfNodeType,
  type Workflow,
  type WorkflowVersion,
} from '@gh/shared';
import { api } from '../../api';
import { useApp } from '../../stores/app';

/** The builder's state and actions for the workflow in the route. */
export function useWorkflowBuilder() {
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
  const requireSteps = ref(false); // v1.7.4: tracked client steps must be done before sign-off
  const state = () => JSON.stringify({ g: graph.value, n: name.value, d: description.value, r: requireSteps.value });
  const dirty = computed(() => !!wf.value && state() !== saved.value);
  const check = computed(() => validateWorkflow(shown.value));
  const byId = computed(() => new Map(shown.value.nodes.map((n) => [n.id, n])));
  const selNode = computed(() => (sel.value?.kind === 'node' ? (byId.value.get(sel.value.id) ?? null) : null));
  const selEdge = computed(() =>
    sel.value?.kind === 'edge' ? (shown.value.edges.find((e) => e.id === sel.value!.id) ?? null) : null,
  );
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
    requireSteps.value = !!d.workflow.requireSteps;
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
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', guard);
  });
  const guard = (e: BeforeUnloadEvent) => {
    if (dirty.value) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  // Undo: snapshots of the drawing before each change.
  const history: string[] = [];
  const snap = () => {
    history.push(JSON.stringify(graph.value));
    if (history.length > 40) history.shift();
  };
  function undo() {
    const s = history.pop();
    if (s) {
      graph.value = JSON.parse(s);
      sel.value = null;
    }
  }

  const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
  const DEFAULT_LABEL: Record<WfNodeType, string> = {
    start: 'Trigger',
    gate: 'Gate',
    agent: 'Agent drafts',
    person: 'Person decides',
    task: 'Client step',
    condition: 'Is it high risk?',
    notify: 'Tell someone',
    end: 'End',
  };
  function add(type: WfNodeType) {
    if (!canEdit.value) return;
    snap();
    const el = canvas.value!;
    const x = Math.round(((el.scrollLeft + el.clientWidth / 2) / zoom.value - W / 2) / 20) * 20;
    const y =
      Math.round(
        ((el.scrollTop + el.clientHeight / 2) / zoom.value - H / 2 + (graph.value.nodes.length % 4) * 24) / 20,
      ) * 20;
    const n: WfNode = {
      id: uid(type.slice(0, 4)),
      type,
      label: DEFAULT_LABEL[type],
      x,
      y,
      config: type === 'agent' ? { agent: 'risk_classifier' } : type === 'person' ? { role: 'Reviewer' } : {},
    };
    graph.value.nodes.push(n);
    sel.value = { kind: 'node', id: n.id };
    panel.value = 'inspect';
  }
  function remove() {
    if (!canEdit.value || !sel.value) return;
    if (sel.value.kind === 'node') {
      if (WF_LOCKED.has(sel.value.id))
        return app.toast('Governance steps and the trigger can be moved, not removed.', 'error');
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.value) {
      e.preventDefault();
      remove();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
    if (e.key === 'Escape') sel.value = null;
  }

  // Dragging a step, and drawing an arrow from a step's right-hand dot.
  const drag = ref<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const wire = ref<{ from: string; x: number; y: number } | null>(null);
  const pt = (e: PointerEvent) => {
    const r = canvas.value!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left + canvas.value!.scrollLeft) / zoom.value,
      y: (e.clientY - r.top + canvas.value!.scrollTop) / zoom.value,
    };
  };
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
      if (!drag.value.moved) {
        snap();
        drag.value.moved = true;
      }
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
        const leadsHere = (start: string) => {
          const seen = new Set([start]);
          const st = [start];
          while (st.length) {
            const c = st.pop()!;
            for (const x of graph.value.edges)
              if (!x.rework && x.from === c && !seen.has(x.to)) {
                seen.add(x.to);
                st.push(x.to);
              }
          }
          return seen.has(from);
        };
        const back = leadsHere(to.id);
        const ed: WfEdge = {
          id: uid('e'),
          from,
          to: to.id,
          ...(back ? { rework: true, label: 'Changes requested' } : {}),
        };
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
    const x1 = a.x + W,
      y1 = a.y + H / 2,
      x2 = b.x,
      y2 = b.y + H / 2;
    // On to the next row: leave from the bottom, arrive at the top.
    if (!e.rework && x2 < x1 - 20 && b.y > a.y + H) {
      const ax = a.x + W / 2,
        bx = b.x + W / 2,
        my = (a.y + H + b.y) / 2;
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
    const a = byId.value.get(e.from),
      b = byId.value.get(e.to);
    if (!a || !b) return { x: 0, y: 0 };
    if (!e.rework && b.x < a.x + W - 20 && b.y > a.y + H) return { x: (a.x + b.x) / 2 + W / 2, y: (a.y + H + b.y) / 2 };
    if (e.rework || b.x + 0 < a.x + W - 20) return { x: (a.x + b.x) / 2 + W / 2, y: Math.max(a.y, b.y) + H + 34 };
    return { x: (a.x + W + b.x) / 2, y: (a.y + b.y) / 2 + H / 2 - 9 };
  }
  const wirePath = computed(() => {
    if (!wire.value) return '';
    const a = byId.value.get(wire.value.from)!;
    const x1 = a.x + W,
      y1 = a.y + H / 2;
    return `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${wire.value.x - 60} ${wire.value.y}, ${wire.value.x} ${wire.value.y}`;
  });

  function fit() {
    const el = canvas.value;
    if (!el || !shown.value.nodes.length) return;
    // Zoom so the whole workflow fits the width (not below 50%), then scroll to its top-left.
    const minX = Math.min(...shown.value.nodes.map((n) => n.x)),
      minY = Math.min(...shown.value.nodes.map((n) => n.y));
    const maxX = Math.max(...shown.value.nodes.map((n) => n.x + W));
    setZoom(Math.max(0.6, Math.min(1, (el.clientWidth - 60) / (maxX - minX + 80))));
    void nextTick(() =>
      el.scrollTo({
        left: Math.max(0, (minX - 40) * zoom.value),
        top: Math.max(0, (minY - 80) * zoom.value),
        behavior: 'smooth',
      }),
    );
  }
  function focusNode(id: string) {
    const n = byId.value.get(id);
    if (!n || !canvas.value) return;
    sel.value = { kind: 'node', id };
    panel.value = 'inspect';
    canvas.value.scrollTo({
      left: Math.max(0, (n.x + W / 2) * zoom.value - canvas.value.clientWidth / 2),
      top: Math.max(0, (n.y + H / 2) * zoom.value - canvas.value.clientHeight / 2),
      behavior: 'smooth',
    });
  }
  const problemOf = (id: string) => check.value.nodeProblems[id]?.length ?? 0;

  // Save, publish, versions.
  async function save() {
    busy.value = true;
    try {
      const d = await api<{ workflow: Workflow }>(`/workflows/${wf.value!.id}`, {
        method: 'PATCH',
        body: {
          name: name.value,
          description: description.value,
          graph: graph.value,
          requireSteps: requireSteps.value,
        },
      });
      wf.value = d.workflow;
      saved.value = state();
      app.toast(
        check.value.problems.length
          ? `Draft saved. ${check.value.problems.length} thing${check.value.problems.length === 1 ? '' : 's'} to fix before it can be published.`
          : 'Draft saved',
      );
    } catch (e: any) {
      app.toast(e.message, 'error');
    } finally {
      busy.value = false;
    }
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
    } catch (e: any) {
      app.toast(e.message, 'error');
    } finally {
      busy.value = false;
    }
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
    } catch (e: any) {
      app.toast(e.message, 'error');
    }
  }
  async function retire() {
    if (!window.confirm('Retire this workflow? Its versions are kept, and you can restore one later.')) return;
    try {
      await api(`/workflows/${wf.value!.id}/retire`, { method: 'POST', body: {} });
      await load();
      app.toast('Retired');
    } catch (e: any) {
      app.toast(e.message, 'error');
    }
  }

  // Which steps happen in a business tool, and the tools this workflow uses.
  const TOOL_TYPES = new Set<WfNodeType>(['start', 'person', 'task', 'notify']);
  const conn = (id?: string | null) => connectors.value.find((c) => c.id === id) ?? null;
  const connState = (c: Connector | null) =>
    !c ? '' : c.lastStatus === 'failed' ? 'bad' : c.lastStatus === 'never' ? 'new' : 'ok';
  const toolsUsed = computed(() => {
    const by = new Map<
      string,
      { tool: NonNullable<ReturnType<typeof toolById>>; steps: WfNode[]; linked: Connector[] }
    >();
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
  const connectorsFor = (tool?: string) =>
    [...connectors.value].sort((a, b) => Number(b.tool === tool) - Number(a.tool === tool));
  // v1.7.2: add a connector in place, without leaving the builder. A new one is linked to the step it was started from.
  const connForm = ref<{ tool?: string; nodeId?: string } | null>(null);
  function onConnSaved(c: Connector) {
    connectors.value = [...connectors.value.filter((x) => x.id !== c.id), c];
    const n = connForm.value?.nodeId ? graph.value.nodes.find((x) => x.id === connForm.value!.nodeId) : null;
    if (n) {
      snap();
      n.config.connectorId = c.id;
      if (!n.config.tool && c.tool) n.config.tool = c.tool;
    }
    connForm.value = null;
  }
  // The client's tools (Settings > Connected tools) come first in the tool list.
  const myTools = computed(() => BUSINESS_TOOLS.filter((t) => app.engagement?.clientTools?.includes(t.id)));
  function pickTool(n: WfNode, id: string) {
    n.config.tool = id || undefined;
    if (!id) {
      n.config.toolDetail = undefined;
      n.config.connectorId = undefined;
    } else if (n.config.connectorId && conn(n.config.connectorId)?.tool && conn(n.config.connectorId)!.tool !== id)
      n.config.connectorId = undefined;
  }

  const ADD: WfNodeType[] = ['agent', 'person', 'task', 'condition', 'notify', 'end'];
  const AGENTS = Object.entries(AGENT_ROLES).map(([id, a]) => ({ id, name: a.name }));
  const STATUS: Record<string, [string, string]> = {
    draft: ['Draft', 'amber'],
    published: ['Published', 'green'],
    retired: ['Retired', ''],
  };

  return {
    route,
    W,
    H,
    wf,
    versions,
    graph,
    saved,
    name,
    description,
    sel,
    panel,
    connectors,
    viewing,
    busy,
    canvas,
    zoom,
    setZoom,
    canEdit,
    shown,
    requireSteps,
    state,
    dirty,
    check,
    byId,
    selNode,
    selEdge,
    world,
    load,
    guard,
    history,
    snap,
    undo,
    uid,
    DEFAULT_LABEL,
    add,
    remove,
    onKey,
    drag,
    wire,
    pt,
    downNode,
    downPort,
    move,
    up,
    path,
    mid,
    wirePath,
    fit,
    focusNode,
    problemOf,
    save,
    publish,
    view,
    restore,
    retire,
    TOOL_TYPES,
    conn,
    connState,
    toolsUsed,
    connectorsFor,
    connForm,
    onConnSaved,
    myTools,
    pickTool,
    ADD,
    AGENTS,
    STATUS,
  };
}

/** What the inspector receives. */
export type WorkflowBuilderState = ReturnType<typeof useWorkflowBuilder>;
