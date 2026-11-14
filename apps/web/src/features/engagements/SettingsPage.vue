<script setup lang="ts">
// Engagement settings. Engagements on the left (like projects), tabs on the right: General
// (details, modules, archive or delete), Approval gates, AI Agents, Connected tools (with the Client
// tools and workflows module) and Access. Each tab is its own component (v1.7.8); KeepAlive keeps
// unsaved edits when you move between tabs, as before. Workspace-wide settings live under Workspace settings.
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { AgentConfig } from '@gh/shared';
import { useApp } from '../../stores/app';
import { api } from '../../api';
import EngagementAccess from './EngagementAccess.vue';
import SettingsGeneralTab from './SettingsGeneralTab.vue';
import SettingsGatesTab from './SettingsGatesTab.vue';
import SettingsAgentsTab from './SettingsAgentsTab.vue';
import SettingsToolsTab from './SettingsToolsTab.vue';

const app = useApp();
const route = useRoute();
const TABS = computed(() => ({
  // v1.7.2: "Approval gates" (was Workflow, now that Client Workflows exist). v1.7.4: "Connected tools" shows with the
  // Client tools and workflows module (or when linked to directly).
  general: 'General',
  workflow: 'Approval gates',
  agents: 'AI Agents',
  ...(app.mod('connectors') || route.params.tab === 'integrations' ? { integrations: 'Connected tools' } : {}),
  access: 'Access',
}));
const tab = computed(() =>
  ['general', 'workflow', 'integrations', 'agents', 'access'].includes(String(route.params.tab))
    ? String(route.params.tab)
    : 'general',
);
async function openEngagement(id: string) {
  if (id === app.engagementId) return;
  await app.switchEngagement(id);
}

// The page loads the agents (its header counts them; Approval gates and AI Agents use them), then shows the tabs.
const agents = ref<AgentConfig[]>([]);
const ready = ref(false);
onMounted(async () => {
  if (!app.engagementId) await app.init();
  agents.value = await api(`/engagements/${app.engagementId}/agents`);
  ready.value = true;
});
</script>

<template>
  <div class="page settings-layout">
    <aside class="eng-list" aria-label="Engagements">
      <span class="label-caps">Engagements</span>
      <button
        v-for="e in app.active"
        :key="e.id"
        class="eng-item"
        :class="{ selected: e.id === app.engagementId }"
        @click="openEngagement(e.id)"
      >
        <span class="swatch" :style="{ background: e.color }">{{ e.prefix[0] }}</span>
        <span class="grow clip"
          ><span class="clip" style="display: block">{{ e.name }}</span
          ><span class="small faint clip" style="display: block">{{ e.client }}</span></span
        >
      </button>
      <template v-if="app.archived.length">
        <span class="label-caps" style="margin-top: 10px">Archived</span>
        <button
          v-for="e in app.archived"
          :key="e.id"
          class="eng-item"
          :class="{ selected: e.id === app.engagementId }"
          style="opacity: 0.75"
          @click="openEngagement(e.id)"
        >
          <span class="swatch" :style="{ background: e.color, filter: 'grayscale(1)' }">{{ e.prefix[0] }}</span>
          <span class="grow clip">{{ e.name }}</span>
        </button>
      </template>
      <RouterLink v-if="app.canRaw('manage_engagement')" to="/engagements/new" class="btn sm" style="margin-top: 8px"
        >+ Add engagement</RouterLink
      >
      <RouterLink
        v-if="app.canRaw('manage_models') || app.canRaw('manage_users')"
        to="/workspace"
        class="small faint-link"
        style="margin-top: 14px"
        >Workspace settings →</RouterLink
      >
    </aside>
    <div class="settings-main">
      <div class="page-head">
        <div>
          <h1>{{ app.engagement?.name }}</h1>
          <p
            >Settings for this engagement. Changes apply to new runs; runs in progress keep the settings they started
            with.</p
          >
        </div>
        <span class="badge" :class="app.engagement?.archivedAt ? 'warn' : app.engagement?.paused ? 'warn' : 'ok'"
          >{{ app.engagement?.archivedAt ? 'Archived' : app.engagement?.paused ? 'Paused' : 'Active' }} ·
          {{ agents.filter((a) => a.enabled).length }} agent{{
            agents.filter((a) => a.enabled).length === 1 ? '' : 's'
          }}
          on</span
        >
      </div>

      <nav class="tabs" aria-label="Settings sections">
        <RouterLink v-for="(label, t) in TABS" :key="t" :to="`/settings/${t}`" :class="{ active: tab === t }">{{
          label
        }}</RouterLink>
      </nav>

      <template v-if="ready">
        <KeepAlive>
          <SettingsGeneralTab v-if="tab === 'general'" />
          <SettingsGatesTab v-else-if="tab === 'workflow'" :agents="agents" />
          <SettingsAgentsTab v-else-if="tab === 'agents'" v-model:agents="agents" />
          <SettingsToolsTab v-else-if="tab === 'integrations'" />
        </KeepAlive>
      </template>
      <EngagementAccess v-if="tab === 'access'" />
    </div>
  </div>
</template>
