<script setup lang="ts">
// The app shell: sign-in gate, top bar (engagement switcher, navigation,
// account menu with theme and notifications), archived banner and the page.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApp } from './stores/app';
import { api } from './api';
import NewUseCase from './components/NewUseCase.vue';
import SignIn from './components/SignIn.vue';

const app = useApp();
const route = useRoute();
const router = useRouter();
const showNew = ref(false);
const menu = ref<'' | 'more' | 'me' | 'eng'>('');
const initials = computed(() =>
  (app.user?.name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
);

// Assurance work first; workspace administration sits under More.
const MORE = [
  { to: '/knowledge', label: 'Knowledge base' },
  { to: '/agent-testing/golden', label: 'Agent testing', match: '/agent-testing' },
  { to: '/runs', label: 'Runs' },
  { to: '/settings/general', label: 'Settings', match: '/settings' },
  { to: '/models', label: 'Models' },
];
// Monitor, sun and moon, drawn inline so they take the text colour.
const THEMES = [
  { id: 'system', label: 'System', icon: 'M3 4h18v12H3zM8 20h8M12 16v4' },
  { id: 'light', label: 'Light', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' },
  { id: 'dark', label: 'Dark', icon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' },
] as const;

async function pick(id: string) {
  menu.value = '';
  await app.switchEngagement(id);
  // Pages that belong to one engagement reload; a run or suite page goes back to its list.
  if (/^\/(runs|evals)\/./.test(route.path)) router.push(route.path.startsWith('/runs') ? '/runs' : '/evals');
}
const moreActive = computed(() => MORE.some((m) => route.path.startsWith(m.match ?? m.to)));

async function start() {
  try {
    await app.checkAuth();
    if (app.user) await app.init();
  } catch (e: any) {
    app.toast(`Couldn't reach the server: ${e.message}`, 'error');
  }
}
watch(() => app.user?.id, (id) => id && void app.init().catch((e) => app.toast(e.message, 'error')));
watch(() => route.fullPath, () => (menu.value = ''));

async function signOut() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  app.signedOut();
}

const onSignedOut = () => app.signedOut();
const onDoc = (e: MouseEvent) => {
  if (!(e.target as HTMLElement).closest('.menu-host')) menu.value = '';
};
onMounted(() => {
  void start();
  window.addEventListener('gh:signed-out', onSignedOut);
  document.addEventListener('click', onDoc);
});
onBeforeUnmount(() => {
  window.removeEventListener('gh:signed-out', onSignedOut);
  document.removeEventListener('click', onDoc);
});
</script>

<template>
  <div v-if="!app.authChecked" class="page muted">Loading…</div>
  <SignIn v-else-if="!app.user" />
  <template v-else>
    <header class="bar">
      <div class="bar-inner">
        <RouterLink to="/" class="brand"><span class="logo">G</span><span class="brand-text">Governance Harness</span></RouterLink>
        <span v-if="app.engagement" class="menu-host">
          <button class="switcher" :aria-expanded="menu === 'eng'" aria-haspopup="menu" @click="menu = menu === 'eng' ? '' : 'eng'">
            <span class="swatch" :style="{ background: app.engagement.color }">{{ app.engagement.prefix[0] }}</span>
            <span class="switcher-name">{{ app.engagement.name }}</span><span class="faint">▾</span>
          </button>
          <div v-if="menu === 'eng'" class="menu" role="menu" style="min-width: 260px">
            <button v-for="e in app.active" :key="e.id" role="menuitemradio" :aria-checked="e.id === app.engagementId" class="eng-item" @click="pick(e.id)">
              <span class="swatch" :style="{ background: e.color }">{{ e.prefix[0] }}</span>
              <span class="grow"><span>{{ e.name }}</span><span class="small faint" style="display: block">{{ e.client }}</span></span>
              <span v-if="e.id === app.engagementId" aria-hidden="true">✓</span>
            </button>
            <template v-if="app.archived.length">
              <div class="menu-sep" />
              <span class="label-caps menu-label">Archived · read-only</span>
              <button v-for="e in app.archived" :key="e.id" role="menuitemradio" :aria-checked="e.id === app.engagementId" class="eng-item" style="opacity: 0.75" @click="pick(e.id)">
                <span class="swatch" :style="{ background: e.color, filter: 'grayscale(1)' }">{{ e.prefix[0] }}</span>
                <span class="grow"><span>{{ e.name }}</span><span class="small faint" style="display: block">{{ e.client }}</span></span>
                <span v-if="e.id === app.engagementId" aria-hidden="true">✓</span>
              </button>
            </template>
            <template v-if="app.canRaw('manage_engagement')">
              <div class="menu-sep" />
              <RouterLink to="/engagements/new" role="menuitem" class="faint-link">+ Add engagement</RouterLink>
            </template>
          </div>
        </span>
        <nav class="nav">
          <RouterLink to="/overview">Overview</RouterLink>
          <RouterLink to="/" exact-active-class="router-link-active" active-class="">Board</RouterLink>
          <RouterLink to="/risks">Risks</RouterLink>
          <RouterLink to="/controls" :class="{ 'router-link-active': $route.path.startsWith('/controls') }">Controls</RouterLink>
          <RouterLink to="/testing" :class="{ 'router-link-active': $route.path.startsWith('/testing') }">Testing</RouterLink>
          <RouterLink to="/issues">Issues</RouterLink>
          <RouterLink to="/evals" :class="{ 'router-link-active': $route.path.startsWith('/evals') }">Evals</RouterLink>
          <RouterLink to="/inventory">Inventory</RouterLink>
          <RouterLink to="/report">Report</RouterLink>
          <span class="menu-host">
            <button class="nav-more" :class="{ 'router-link-active': moreActive }" :aria-expanded="menu === 'more'" @click="menu = menu === 'more' ? '' : 'more'">More ▾</button>
            <div v-if="menu === 'more'" class="menu" role="menu">
              <template v-for="m in MORE" :key="m.to">
                <RouterLink v-if="m.to !== '/users' || app.can('manage_users')" :to="m.to" role="menuitem">{{ m.label }}</RouterLink>
              </template>
            </div>
          </span>
        </nav>
        <span class="grow" />
        <span class="badge" :class="app.health.runtime === 'live' ? 'ok' : 'warn'" :title="app.health.runtime === 'live' ? app.health.model : 'Agents use the offline rules. Pick a model in Settings > Agents.'">
          {{ app.health.runtime === 'live' ? 'Live agents' : 'Dry run' }}
        </span>
        <button v-if="app.can('prepare')" class="btn primary" @click="showNew = true">+ Add use case</button>
        <span class="menu-host">
          <button class="avatar" :title="app.user.name" :aria-expanded="menu === 'me'" @click="menu = menu === 'me' ? '' : 'me'">{{ initials }}</button>
          <div v-if="menu === 'me'" class="menu right account-menu" role="menu">
            <div class="menu-head">
              <strong>{{ app.user.name }}</strong>
              <span class="small faint">{{ app.user.email }}</span>
            </div>
            <RouterLink to="/account" role="menuitem">Your account</RouterLink>
            <RouterLink v-if="app.can('manage_users')" to="/users" role="menuitem">People and roles</RouterLink>
            <RouterLink to="/audit" role="menuitem">Audit log</RouterLink>
            <div class="menu-sep" />
            <span class="label-caps menu-label">Theme</span>
            <div class="theme-pick" role="radiogroup" aria-label="Theme">
              <button v-for="t in THEMES" :key="t.id" role="radio" :aria-checked="app.theme === t.id" :class="{ on: app.theme === t.id }" @click="app.setTheme(t.id)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="t.icon" /></svg>{{ t.label }}
              </button>
            </div>
            <div class="menu-sep" />
            <button class="switch notify-toggle" :class="{ on: app.notify }" role="switch" :aria-checked="app.notify" @click="app.setNotify(!app.notify)">
              <span class="track" /><span>Desktop notifications</span>
            </button>
            <p class="small faint menu-note">When a use case needs your approval and this tab is in the background, from any engagement.</p>
            <button class="btn signout" @click="signOut">Sign out</button>
          </div>
        </span>
      </div>
    </header>

    <div v-if="app.engagement?.archivedAt" class="archived-bar" role="status">
      <strong>{{ app.engagement.name }} is archived.</strong>
      <span>Read-only since {{ new Date(app.engagement.archivedAt).toLocaleDateString() }}, by {{ app.engagement.archivedBy }}<template v-if="app.engagement.archiveReason">: {{ app.engagement.archiveReason }}</template>.</span>
      <RouterLink v-if="app.canRaw('manage_engagement')" to="/settings/general">Restore or delete</RouterLink>
    </div>
    <RouterView :key="app.engagementId" />

    <NewUseCase v-if="showNew" @close="showNew = false" />
  </template>

  <div class="toast-host" aria-live="polite">
    <div v-for="t in app.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
  </div>
</template>
