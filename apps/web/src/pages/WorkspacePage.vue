<script setup lang="ts">
// Workspace settings: what applies to every engagement. Models and keys (with
// spending and the AI features), people and roles, and sign-in and security.
// Engagement-level settings (workflow, agents, integrations, access) are under
// each engagement's Settings.
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { WorkspaceSettings } from '@gh/shared';
import { useApp } from '../stores/app';
import { api } from '../api';
import ModelsPage from './ModelsPage.vue';
import UsersPage from './UsersPage.vue';
import SsoSettings from '../components/SsoSettings.vue';

const app = useApp();
const route = useRoute();
const TABS = computed(() => ({
  models: 'Models & keys',
  ...(app.canRaw('manage_users') ? { people: 'People & roles', security: 'Sign-in & security' } : {}),
}));
const tab = computed(() => (String(route.params.tab) in TABS.value ? String(route.params.tab) : 'models'));

const settings = ref<WorkspaceSettings | null>(null);
onMounted(async () => {
  if (app.canRaw('manage_users')) settings.value = await api('/settings');
});
async function set(patch: Partial<WorkspaceSettings>) {
  try {
    settings.value = { ...settings.value!, ...(await api<WorkspaceSettings>('/settings', { method: 'PUT', body: patch })) };
    app.toast('Saved');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
</script>

<template>
  <div class="page workspace">
    <div class="page-head">
      <div>
        <h1>Workspace settings</h1>
        <p>Apply to every engagement. For one engagement's workflow, agents, integrations and access, open <RouterLink to="/settings/general">its settings</RouterLink>.</p>
      </div>
    </div>
    <nav class="tabs" aria-label="Workspace settings">
      <RouterLink v-for="(label, t) in TABS" :key="t" :to="`/workspace/${t}`" :class="{ active: tab === t }">{{ label }}</RouterLink>
    </nav>

    <ModelsPage v-if="tab === 'models'" />
    <UsersPage v-else-if="tab === 'people'" />
    <template v-else-if="tab === 'security'">
      <div v-if="settings" class="card">
        <h2>Act as someone else</h2>
        <p class="small muted">Lets an admin work as any other person without signing out, to run the whole flow alone: raise a use case as a preparer, approve it as a reviewer, sign off as a lead. Useful for demos, testing and training.</p>
        <div class="notice warn small">
          While it's on, segregation of duties no longer stops one real person from both doing and approving work, because they can switch between names. The audit log records the real admin beside every action taken while acting, and Verify the chain covers it. Leave it off on client engagements.
        </div>
        <label class="switch" :class="{ on: settings.allowActAs }">
          <input type="checkbox" class="sr-only" :checked="settings.allowActAs" @change="set({ allowActAs: !settings.allowActAs })" /><span class="track" />
          <span><strong style="color: var(--text)">Allow admins to act as someone else</strong> From the account menu, top right.</span>
        </label>
      </div>
      <div v-if="settings" class="card">
        <h2>Evidence connectors</h2>
        <p class="small muted">By default a connector can't reach this machine or a private network, so it can't be used to probe internal systems. Allow it only for a client system on your own network.</p>
        <label class="switch" :class="{ on: settings.connectorsAllowPrivate }">
          <input type="checkbox" class="sr-only" :checked="settings.connectorsAllowPrivate" @change="set({ connectorsAllowPrivate: !settings.connectorsAllowPrivate })" /><span class="track" />
          <span><strong style="color: var(--text)">Allow connectors to reach private addresses</strong></span>
        </label>
      </div>
      <SsoSettings />
    </template>
  </div>
</template>

<style scoped>
.workspace :deep(.page) { padding: 0; max-width: none; }
.workspace :deep(.page .page-head h1) { font-size: 18px; }
</style>
