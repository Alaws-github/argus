<script setup lang="ts">
// Settings > Connected tools: the business tools this client uses, its connectors, pipeline tokens
// and write-back. Shown with the Client tools and workflows module. Part of SettingsPage.vue (split out in v1.7.8).
import { computed, onMounted, ref, watch } from 'vue';
import { BUSINESS_TOOLS } from '@gh/shared';
import { useApp } from '../../stores/app';
import { api } from '../../api';
import ConnectorsTab from '../integrations/ConnectorsTab.vue';
import PipelinesCard from '../integrations/PipelinesCard.vue';
import WriteBackCard from '../integrations/WriteBackCard.vue';

const app = useApp();
// v1.7.2: the client's business tools, saved on the engagement.
const clientTools = ref<string[]>([]);
watch(
  () => app.engagement?.clientTools,
  (t) => (clientTools.value = [...(t ?? [])]),
  { immediate: true },
);
const toolsDirty = computed(
  () => [...clientTools.value].sort().join() !== [...(app.engagement?.clientTools ?? [])].sort().join(),
);
const toggleTool = (id: string) =>
  (clientTools.value = clientTools.value.includes(id)
    ? clientTools.value.filter((x) => x !== id)
    : [...clientTools.value, id]);
async function saveTools() {
  try {
    const e = await api(`/engagements/${app.engagementId}`, {
      method: 'PATCH',
      body: { clientTools: clientTools.value },
    });
    const i = app.engagements.findIndex((x) => x.id === e.id);
    if (i >= 0) app.engagements.splice(i, 1, e);
    app.toast("Saved the client's tools");
  } catch (err: any) {
    app.toast(err.message, 'error');
  }
}

// The engagement's controls, so a connector or pipeline token can be tied to one.
const controls = ref<any[]>([]);
onMounted(async () => {
  controls.value = await api(`/engagements/${app.engagementId}/controls`).catch(() => []);
});
</script>

<template>
  <section class="card">
    <div class="spread"
      ><h2>Tools this client uses</h2><span class="small faint">Shown first in workflows and connectors</span></div
    >
    <p class="small muted"
      >Tick the business tools the client works in. Workflow steps and connectors list these first. Nothing connects
      until you add a connector below.</p
    >
    <div class="tool-grid" role="group" aria-label="Tools this client uses" style="max-height: none">
      <button
        v-for="t in BUSINESS_TOOLS"
        :key="t.id"
        type="button"
        :class="{ on: clientTools.includes(t.id) }"
        :aria-pressed="clientTools.includes(t.id)"
        :disabled="!app.can('manage_engagement') || !!app.engagement?.archivedAt"
        @click="toggleTool(t.id)"
        ><i class="tool-mono" :style="{ background: t.color }">{{ t.mono }}</i
        >{{ t.name }}</button
      >
    </div>
    <div class="row"
      ><button class="btn primary sm" :disabled="!toolsDirty" @click="saveTools">Save</button
      ><span v-if="toolsDirty" class="small faint">Unsaved changes</span></div
    >
  </section>
  <section class="card">
    <div class="spread"><h2>Connectors</h2><RouterLink to="/workflows" class="small">Client workflows</RouterLink></div>
    <ConnectorsTab :controls="controls" manage />
  </section>
  <PipelinesCard :controls="controls" />
  <WriteBackCard />
</template>
