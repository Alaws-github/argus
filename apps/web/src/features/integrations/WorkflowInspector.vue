<script setup lang="ts">
// The workflow builder's inspector, on the right: the selected step's settings (type, label, tool,
// connector, proof), the rules the drawing breaks, versions and publishing. State and actions come
// from useWorkflowBuilder, shared with the page's canvas.
import { BUSINESS_TOOLS, PROOF_KINDS, TOOL_GROUPS, WF_LOCKED, WF_NODE_INFO, toolById } from '@gh/shared';
import { ago } from '../../api';
import { useApp } from '../../stores/app';
import AppIcon from '../../components/AppIcon.vue';
import type { WorkflowBuilderState } from './use-workflow-builder';

const props = defineProps<{ builder: WorkflowBuilderState }>();
const app = useApp();
const {
  wf,
  versions,
  description,
  panel,
  viewing,
  canEdit,
  requireSteps,
  check,
  byId,
  selNode,
  selEdge,
  remove,
  focusNode,
  view,
  restore,
  retire,
  TOOL_TYPES,
  conn,
  connState,
  toolsUsed,
  connectorsFor,
  connForm,
  myTools,
  pickTool,
  AGENTS,
} = props.builder;
</script>

<template>
  <aside class="wf-side">
    <template v-if="panel === 'tools'">
      <h2>Business tools</h2>
      <p class="small muted"
        >Where each step happens, and which ones ARGUS reads. Connectors only read: ARGUS never changes anything in
        these tools.</p
      >
      <div v-if="!toolsUsed.length" class="small faint"
        >No steps name a tool yet. Click a step and choose where it happens.</div
      >
      <div v-for="u in toolsUsed" :key="u.tool.id" class="wf-version">
        <div class="spread"
          ><span class="row" style="gap: 8px"
            ><i class="tool-mono lg" :style="{ background: u.tool.color }">{{ u.tool.mono }}</i
            ><strong>{{ u.tool.name }}</strong></span
          ><span class="small faint">{{ u.steps.length }} step{{ u.steps.length === 1 ? '' : 's' }}</span></div
        >
        <div class="small"
          ><button
            v-for="s in u.steps"
            :key="s.id"
            class="linklike"
            style="margin-right: 8px"
            @click="focusNode(s.id)"
            >{{ s.label }}</button
          ></div
        >
        <div v-if="u.linked.length" class="small"
          ><span v-for="c in u.linked" :key="c.id" class="row" style="gap: 6px"
            ><i class="conn-dot" :class="connState(c)" />Read by {{ c.key }} {{ c.name }} ·
            {{ c.lastStatus === 'never' ? 'not pulled yet' : c.lastMessage }}</span
          ></div
        >
        <div v-else-if="u.tool.read" class="small faint"
          >Not read by ARGUS yet.
          <button
            v-if="app.can('manage_engagement') && canEdit"
            class="linklike"
            @click="connForm = { tool: u.tool.id, nodeId: u.steps[0]?.id }"
            >Add a connector</button
          ></div
        >
        <div v-else class="small faint">Mapped only: ARGUS doesn't read {{ u.tool.name }}.</div>
      </div>
    </template>

    <template v-else-if="panel === 'versions'">
      <h2>Versions</h2>
      <p class="small muted">Each publish keeps a numbered copy. View one, or make it the draft again.</p>
      <div v-if="!versions.length" class="small faint">Not published yet.</div>
      <div v-for="v in versions" :key="v.version" class="wf-version" :class="{ on: viewing?.version === v.version }">
        <div class="spread"
          ><strong>Version {{ v.version }}</strong
          ><span class="small faint">{{ ago(v.publishedAt) }}</span></div
        >
        <div class="small muted">{{ v.publishedBy }} · {{ v.nodes }} steps</div>
        <div v-if="v.note" class="small">“{{ v.note }}”</div>
        <div class="row"
          ><button class="btn sm" @click="view(v.version)">View</button
          ><button v-if="app.can('manage_engagement')" class="btn sm ghost" @click="restore(v.version)"
            >Make the draft</button
          ></div
        >
      </div>
      <button
        v-if="app.can('manage_engagement') && wf?.status !== 'retired'"
        class="btn sm ghost danger-text"
        style="margin-top: 12px"
        @click="retire"
        >Retire this workflow</button
      >
    </template>

    <template v-else-if="selNode">
      <div class="spread"
        ><span class="label-caps">{{ WF_NODE_INFO[selNode.type].label }}</span
        ><span v-if="WF_LOCKED.has(selNode.id)" class="badge"><AppIcon name="lock" :size="12" />Built in</span></div
      >
      <p class="small muted">{{ WF_NODE_INFO[selNode.type].hint }}</p>
      <label class="field"
        ><span>Name</span
        ><input v-model="selNode.label" class="input" maxlength="80" :disabled="!canEdit || selNode.type === 'gate'"
      /></label>
      <label v-if="selNode.type === 'start'" class="field"
        ><span>What starts it</span
        ><input
          v-model="selNode.config.trigger"
          class="input"
          :disabled="!canEdit"
          placeholder="New use case, vendor change, scheduled review, incident"
      /></label>
      <label v-if="selNode.type === 'agent'" class="field"
        ><span>Which agent drafts</span>
        <select v-model="selNode.config.agent" class="select" :disabled="!canEdit"
          ><option v-for="a in AGENTS" :key="a.id" :value="a.id">{{ a.name }}</option></select
        >
      </label>
      <label v-if="selNode.type === 'person' || selNode.type === 'task' || selNode.type === 'notify'" class="field"
        ><span>{{
          selNode.type === 'notify' ? 'Who is told' : selNode.type === 'task' ? 'Who does it' : 'Which role decides'
        }}</span
        ><input
          v-model="selNode.config.role"
          class="input"
          :disabled="!canEdit"
          placeholder="For example: Head of Credit Risk"
      /></label>
      <label v-if="selNode.type === 'condition'" class="field"
        ><span>The question</span
        ><input
          v-model="selNode.config.question"
          class="input"
          :disabled="!canEdit"
          placeholder="Is the risk tier high or prohibited?"
      /></label>
      <p v-if="selNode.type === 'gate'" class="small"
        >ARGUS stage: <strong>{{ selNode.config.stage }}</strong>. Every path must pass this gate, in order, and a named
        person decides at it.</p
      >
      <div v-if="TOOL_TYPES.has(selNode.type)" class="wf-toolbox">
        <label class="field"
          ><span>Happens in</span>
          <select
            class="select"
            :value="selNode.config.tool ?? ''"
            :disabled="!canEdit"
            @change="pickTool(selNode, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">ARGUS, or not set</option>
            <optgroup v-if="myTools.length" label="This client's tools"
              ><option v-for="t in myTools" :key="'m' + t.id" :value="t.id">{{ t.name }}</option></optgroup
            >
            <optgroup v-for="g in TOOL_GROUPS" :key="g" :label="g"
              ><option v-for="t in BUSINESS_TOOLS.filter((x) => x.group === g)" :key="t.id" :value="t.id">{{
                t.name
              }}</option></optgroup
            >
          </select>
        </label>
        <template v-if="toolById(selNode.config.tool)">
          <label class="field"
            ><span>Where in {{ toolById(selNode.config.tool)!.name }}</span
            ><input
              v-model="selNode.config.toolDetail"
              class="input"
              maxlength="120"
              :disabled="!canEdit"
              placeholder="Site, list, project, queue or channel"
          /></label>
          <label v-if="toolById(selNode.config.tool)!.read" class="field"
            ><span>ARGUS reads it with</span>
            <select v-model="selNode.config.connectorId" class="select" :disabled="!canEdit">
              <option :value="undefined">No connector (mapped only)</option>
              <option v-for="c in connectorsFor(selNode.config.tool)" :key="c.id" :value="c.id"
                >{{ c.key }} {{ c.name
                }}{{ c.tool && c.tool !== selNode.config.tool ? ` (${toolById(c.tool)?.name ?? c.tool})` : '' }}</option
              >
            </select>
            <span v-if="conn(selNode.config.connectorId)" class="hint">{{
              conn(selNode.config.connectorId)!.lastStatus === 'never'
                ? 'Not pulled yet'
                : `Last pull ${ago(conn(selNode.config.connectorId)!.lastPullAt!)}: ${conn(selNode.config.connectorId)!.lastMessage}`
            }}</span>
            <button
              v-else-if="app.can('manage_engagement')"
              type="button"
              class="btn sm"
              style="align-self: flex-start"
              :disabled="!canEdit"
              @click="connForm = { tool: selNode.config.tool, nodeId: selNode.id }"
              ><AppIcon name="plus" :size="13" />Add a read-only connector for
              {{ toolById(selNode.config.tool)!.name }}</button
            >
          </label>
          <p v-else class="hint">ARGUS maps this step but doesn't read {{ toolById(selNode.config.tool)!.name }}.</p>
        </template>
        <!-- v1.7.3: what proves the step was done for a use case, checked on the use case's Client steps. -->
        <label class="field"
          ><span>Proof it was done</span>
          <select v-model="selNode.config.proof" class="select" :disabled="!canEdit">
            <option
              v-for="(l, k) in PROOF_KINDS"
              :key="k"
              :value="k || undefined"
              :disabled="!!k && k !== 'manual' && !selNode.config.connectorId"
              >{{ l }}{{ k && k !== 'manual' && !selNode.config.connectorId ? ' (needs a connector)' : '' }}</option
            >
          </select>
          <span class="hint">{{
            selNode.config.proof && selNode.config.proof !== 'manual'
              ? 'ARGUS reads the connector and looks for records that mention the use case key (for example AI-3). Ask the client to put the key in the ticket, request or file.'
              : selNode.config.proof === 'manual'
                ? 'A person confirms it on the use case, with a link to the record.'
                : 'The step is shown on each use case but not checked.'
          }}</span>
        </label>
        <label v-if="selNode.config.proof === 'status' || selNode.config.proof === 'all_done'" class="field"
          ><span
            >{{ selNode.config.proof === 'status' ? 'Status that counts as done' : 'Also counts as done' }}
            <span v-if="selNode.config.proof === 'all_done'" class="faint">optional</span></span
          ><input
            v-model="selNode.config.proofStatus"
            class="input"
            maxlength="60"
            :disabled="!canEdit"
            :placeholder="selNode.config.proof === 'status' ? 'Approved' : 'Done, Closed and Resolved always count'"
        /></label>
      </div>
      <label class="field"
        ><span>Notes</span
        ><textarea
          v-model="selNode.config.note"
          class="textarea"
          :disabled="!canEdit"
          placeholder="What happens here, in the client's words"
        />
      </label>
      <ul v-if="check.nodeProblems[selNode.id]" class="wf-problems"
        ><li v-for="p in check.nodeProblems[selNode.id]" :key="p">{{ p }}</li></ul
      >
      <button v-if="canEdit && !WF_LOCKED.has(selNode.id)" class="btn sm ghost danger-text" @click="remove"
        ><AppIcon name="trash" :size="14" />Remove step</button
      >
      <p class="small faint">Drag a step to move it. Drag from its right-hand dot to another step to draw an arrow.</p>
    </template>

    <template v-else-if="selEdge">
      <span class="label-caps">Arrow</span>
      <p class="small muted">{{ byId.get(selEdge.from)?.label }} → {{ byId.get(selEdge.to)?.label }}</p>
      <label class="field"
        ><span>Label</span
        ><input
          v-model="selEdge.label"
          class="input"
          maxlength="40"
          :disabled="!canEdit"
          placeholder="Yes, No, Approved…"
      /></label>
      <label class="check-row"
        ><input v-model="selEdge.rework" type="checkbox" :disabled="!canEdit" /><span
          ><strong>Rework</strong
          ><span class="muted small hint-inline"
            >Goes back to an earlier step, such as "changes requested". Rework arrows don't count as a way round a
            gate.</span
          ></span
        ></label
      >
      <button v-if="canEdit" class="btn sm ghost danger-text" @click="remove"
        ><AppIcon name="trash" :size="14" />Remove arrow</button
      >
    </template>

    <template v-else>
      <h2>{{ check.problems.length ? 'Before it can be published' : 'Ready to publish' }}</h2>
      <ul v-if="check.problems.length" class="wf-problems">
        <li v-for="p in check.problems" :key="p"
          ><button
            class="linklike"
            @click="
              Object.entries(check.nodeProblems).find(([, ps]) => ps.includes(p)) &&
              focusNode(Object.entries(check.nodeProblems).find(([, ps]) => ps.includes(p))![0])
            "
            >{{ p }}</button
          ></li
        >
      </ul>
      <p v-else class="small muted"
        >Every governance rule passes: all five gates are on every path, in order, and a person decides after every
        agent step.</p
      >
      <label class="field"
        ><span>What it covers</span
        ><textarea
          v-model="description"
          class="textarea"
          :disabled="!canEdit"
          maxlength="400"
          placeholder="Which use cases follow it, and whose process it is"
        />
      </label>
      <label class="check-row"
        ><input v-model="requireSteps" type="checkbox" :disabled="!canEdit" /><span
          ><strong>Client steps must be done before sign-off</strong
          ><span class="muted small hint-inline"
            >A use case following this workflow can't be signed off until every step with a proof is done. A person
            still signs off. Takes effect when published.</span
          ></span
        ></label
      >
      <div class="wf-rules small">
        <span class="label-caps">The rules</span>
        <ul class="plain">
          <li><AppIcon name="lock" :size="12" /> The five governance gates and the trigger can't be removed.</li>
          <li><AppIcon name="lock" :size="12" /> Every path from the trigger to an end passes every gate, in order.</li>
          <li><AppIcon name="lock" :size="12" /> After an agent step, a person or a gate decides before the end.</li>
          <li><AppIcon name="lock" :size="12" /> Each condition has labelled ways out; each step is connected.</li>
        </ul>
      </div>
      <p v-if="wf" class="small faint"
        >Changed {{ ago(wf.updatedAt) }} by {{ wf.updatedBy
        }}{{ wf.publishedAt ? `. Published ${ago(wf.publishedAt)} by ${wf.publishedBy}` : '' }}. Every save and publish
        is in the audit log.</p
      >
    </template>
  </aside>
</template>
