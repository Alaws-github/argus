<script setup lang="ts">
// The workflow builder (v1.7). A canvas of steps and arrows with an icon rail
// on the left (add a step, fit, undo, versions) and an inspector on the right.
// The governance gates and the trigger are locked: they can be moved, never
// deleted. The rules in packages/shared/src/workflow.ts run as you draw, and
// the server runs them again before a publish. v1.7.8: the state and actions are
// in useWorkflowBuilder; the inspector is WorkflowInspector.vue.
import { AGENT_ROLES, WF_LOCKED, WF_NODE_INFO, toolById } from '@gh/shared';
import { useApp } from '../../stores/app';
import AppIcon from '../../components/AppIcon.vue';
import ConnectorForm from './ConnectorForm.vue';
import WorkflowInspector from './WorkflowInspector.vue';
import { useWorkflowBuilder } from './use-workflow-builder';

const app = useApp();
const builder = useWorkflowBuilder();
const {
  W,
  H,
  wf,
  name,
  sel,
  panel,
  viewing,
  busy,
  canvas,
  zoom,
  setZoom,
  canEdit,
  shown,
  dirty,
  check,
  world,
  undo,
  add,
  wire,
  downNode,
  downPort,
  move,
  up,
  path,
  mid,
  wirePath,
  fit,
  problemOf,
  save,
  publish,
  restore,
  conn,
  connState,
  connForm,
  onConnSaved,
  ADD,
  STATUS,
} = builder;
</script>

<template>
  <div class="wf-shell" :class="{ readonly: !canEdit }">
    <!-- Icon rail: only inside the builder. The top menu stays as it is. -->
    <nav class="wf-rail" aria-label="Workflow tools">
      <RouterLink to="/workflows" class="wf-tool" title="All workflows" aria-label="All workflows"
        ><AppIcon name="workflow" :size="18"
      /></RouterLink>
      <span class="wf-sep" />
      <button
        v-for="t in ADD"
        :key="t"
        class="wf-tool"
        :disabled="!canEdit"
        :title="`Add: ${WF_NODE_INFO[t].label}. ${WF_NODE_INFO[t].hint}`"
        :aria-label="`Add ${WF_NODE_INFO[t].label}`"
        @click="add(t)"
      >
        <AppIcon :name="WF_NODE_INFO[t].icon" :size="18" /><i :class="`wf-swatch t-${t}`" />
      </button>
      <span class="wf-sep" />
      <button class="wf-tool" title="Fit the workflow in view" aria-label="Fit in view" @click="fit"
        ><AppIcon name="grid" :size="18"
      /></button>
      <button class="wf-tool" :disabled="!canEdit" title="Undo (Ctrl+Z)" aria-label="Undo" @click="undo"
        ><AppIcon name="undo" :size="18"
      /></button>
      <button
        class="wf-tool"
        :class="{ on: panel === 'tools' }"
        title="Business tools in this workflow"
        aria-label="Business tools"
        @click="
          panel = panel === 'tools' ? 'inspect' : 'tools';
          sel = null;
        "
        ><AppIcon name="models" :size="18"
      /></button>
      <button
        class="wf-tool"
        :class="{ on: panel === 'versions' }"
        title="Versions"
        aria-label="Versions"
        @click="panel = panel === 'versions' ? 'inspect' : 'versions'"
        ><AppIcon name="history" :size="18"
      /></button>
    </nav>

    <section class="wf-main" style="position: relative">
      <header v-if="wf" class="wf-bar">
        <div class="wf-title">
          <span class="mono faint small">{{ wf.key }}</span>
          <input v-model="name" class="wf-name" :disabled="!canEdit" aria-label="Workflow name" maxlength="80" />
          <span class="pill" :class="STATUS[wf.status][1]"
            ><span class="dot" />{{ STATUS[wf.status][0] }}{{ wf.version ? ` · v${wf.version}` : '' }}</span
          >
          <span v-if="wf.version && wf.changedSincePublish && wf.status !== 'retired'" class="badge info"
            >Changed since v{{ wf.version }}</span
          >
        </div>
        <div class="row wf-actions">
          <button
            class="btn sm"
            :class="check.problems.length ? 'warn-btn' : ''"
            @click="
              sel = null;
              panel = 'inspect';
            "
          >
            <AppIcon :name="check.problems.length ? 'alert' : 'check'" :size="14" />{{
              check.problems.length ? `${check.problems.length} to fix` : 'Passes every rule'
            }}
          </button>
          <template v-if="canEdit">
            <button class="btn sm" :disabled="!dirty || busy" @click="save">Save draft</button>
            <button
              class="btn sm primary"
              :disabled="
                busy || !!check.problems.length || (!dirty && wf.status === 'published' && !wf.changedSincePublish)
              "
              :title="check.problems.length ? 'Fix the problems first' : 'Publish a new version'"
              @click="publish"
              >Publish</button
            >
          </template>
        </div>
      </header>
      <div v-if="viewing" class="wf-viewing">
        Viewing version {{ viewing.version }} (read-only).
        <button v-if="app.can('manage_engagement')" class="btn sm" @click="restore(viewing.version)"
          >Make this the draft</button
        >
        <button class="btn sm ghost" @click="viewing = null">Back to the draft</button>
      </div>

      <div ref="canvas" class="wf-canvas" @pointermove="move" @pointerup="up" @pointerdown.self="sel = null">
        <div class="wf-zoom-box" :style="{ width: `${world.w * zoom}px`, height: `${world.h * zoom}px` }">
          <div
            class="wf-world"
            :style="{ width: `${world.w}px`, height: `${world.h}px`, transform: `scale(${zoom})` }"
            @pointerdown.self="sel = null"
          >
            <svg class="wf-edges" :width="world.w" :height="world.h">
              <defs>
                <marker
                  id="wf-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0L10 5L0 10z" class="wf-arrowhead" />
                </marker>
                <marker
                  id="wf-arrow-sel"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0L10 5L0 10z" class="wf-arrowhead sel" />
                </marker>
              </defs>
              <g
                v-for="e in shown.edges"
                :key="e.id"
                class="wf-edge"
                :class="{ rework: e.rework, sel: sel?.kind === 'edge' && sel.id === e.id }"
                @pointerdown.stop="
                  sel = { kind: 'edge', id: e.id };
                  panel = 'inspect';
                "
              >
                <path :d="path(e)" class="hit" />
                <path
                  :d="path(e)"
                  class="line"
                  :marker-end="sel?.kind === 'edge' && sel.id === e.id ? 'url(#wf-arrow-sel)' : 'url(#wf-arrow)'"
                />
              </g>
              <path v-if="wire" :d="wirePath" class="wf-wire" />
            </svg>
            <template v-for="e in shown.edges" :key="'l' + e.id">
              <span
                v-if="e.label"
                class="wf-edge-label"
                :class="{ rework: e.rework }"
                :style="{ left: `${mid(e).x}px`, top: `${mid(e).y}px` }"
                @pointerdown.stop="
                  sel = { kind: 'edge', id: e.id };
                  panel = 'inspect';
                "
                >{{ e.label }}</span
              >
            </template>
            <div
              v-for="n in shown.nodes"
              :key="n.id"
              class="wf-node"
              :class="[
                `t-${n.type}`,
                { sel: sel?.kind === 'node' && sel.id === n.id, locked: WF_LOCKED.has(n.id), bad: problemOf(n.id) },
              ]"
              :style="{ left: `${n.x}px`, top: `${n.y}px`, width: `${W}px`, height: `${H}px` }"
              tabindex="0"
              role="button"
              :aria-label="`${WF_NODE_INFO[n.type].label}: ${n.label}`"
              @pointerdown="downNode($event, n)"
              @keydown.enter="sel = { kind: 'node', id: n.id }"
            >
              <span class="wf-node-icon"><AppIcon :name="WF_NODE_INFO[n.type].icon" :size="15" /></span>
              <span class="wf-node-text">
                <span class="wf-node-type"
                  >{{ WF_NODE_INFO[n.type].label
                  }}<template v-if="n.type === 'person' && n.config.role"> · {{ n.config.role }}</template
                  ><template v-if="n.type === 'agent' && n.config.agent">
                    · {{ (AGENT_ROLES as any)[n.config.agent]?.name }}</template
                  ></span
                >
                <span class="wf-node-label">{{ n.label }}</span>
              </span>
              <span
                v-if="toolById(n.config.tool)"
                class="wf-tool-chip"
                :title="`In ${toolById(n.config.tool)!.name}${n.config.toolDetail ? `: ${n.config.toolDetail}` : ''}${conn(n.config.connectorId) ? `. Read by ${conn(n.config.connectorId)!.key}` : ''}`"
              >
                <i class="tool-mono" :style="{ background: toolById(n.config.tool)!.color }">{{
                  toolById(n.config.tool)!.mono
                }}</i>{{ toolById(n.config.tool)!.name
                }}<i
                  v-if="conn(n.config.connectorId)"
                  class="conn-dot"
                  :class="connState(conn(n.config.connectorId))"
                />
              </span>
              <span v-if="problemOf(n.id)" class="wf-node-bad" :title="check.nodeProblems[n.id].join('\n')">{{
                problemOf(n.id)
              }}</span>
              <span
                v-if="n.type !== 'end' && canEdit"
                class="wf-port"
                title="Drag to another step to draw an arrow"
                @pointerdown="downPort($event, n)"
              />
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

    <WorkflowInspector :builder="builder" />
    <ConnectorForm v-if="connForm" :tool="connForm.tool" @saved="onConnSaved" @close="connForm = null" />
  </div>
</template>
