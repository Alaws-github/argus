<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ROLE_LABELS } from '@gh/shared';
import { useApp } from './stores/app';
import { api } from './api';
import NewUseCase from './components/NewUseCase.vue';
import SignIn from './components/SignIn.vue';

const app = useApp();
const route = useRoute();
const showNew = ref(false);
const menu = ref<'' | 'more' | 'me'>('');
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
  { to: '/runs', label: 'Runs' },
  { to: '/audit', label: 'Audit trail' },
  { to: '/settings/general', label: 'Settings', match: '/settings' },
  { to: '/models', label: 'Models' },
  { to: '/users', label: 'People and roles' },
];
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
async function changePassword() {
  const current = window.prompt('Current password');
  if (!current) return;
  const next = window.prompt('New password (at least 10 characters)');
  if (!next) return;
  try {
    await api('/auth/password', { method: 'POST', body: { current, next } });
    app.toast('Password changed. Sign in with the new one.');
    app.signedOut();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
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
        <span v-if="app.engagement" class="switcher">
          <span class="swatch" :style="{ background: app.engagement.color }">{{ app.engagement.prefix[0] }}</span>
          {{ app.engagement.name }}
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
          <button class="avatar" :title="`${app.user.name} · ${ROLE_LABELS[app.user.role]}`" :aria-expanded="menu === 'me'" @click="menu = menu === 'me' ? '' : 'me'">{{ initials }}</button>
          <div v-if="menu === 'me'" class="menu right" role="menu">
            <div class="menu-head">
              <strong>{{ app.user.name }}</strong>
              <span class="small faint">{{ app.user.email }} · {{ ROLE_LABELS[app.user.role] }}</span>
            </div>
            <button role="menuitem" @click="changePassword">Change password</button>
            <button role="menuitem" @click="signOut">Sign out</button>
          </div>
        </span>
      </div>
    </header>

    <RouterView />

    <NewUseCase v-if="showNew" @close="showNew = false" />
  </template>

  <div class="toast-host" aria-live="polite">
    <div v-for="t in app.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
  </div>
</template>
