<script setup lang="ts">
// The app shell: sign-in gate, top bar (engagement switcher, navigation,
// account menu with theme and notifications), archived banner and the page.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApp } from './stores/app';
import { api } from './api';
import SignIn from './components/SignIn.vue';
import ArgusLogo from './components/ArgusLogo.vue';
import Icon from './components/Icon.vue';
import AssistantPanel from './components/AssistantPanel.vue';

const app = useApp();
const route = useRoute();
const router = useRouter();
// Act as: the people an admin can switch to (only when the workspace allows it).
const actAs = ref<{ actingAs: string | null; people: { id: string; name: string; email: string; role: string }[] } | null>(null);
async function loadActAs() {
  actAs.value = await api('/auth/act-as').catch(() => null);
}
async function actAsPerson(userId: string | null) {
  try {
    await api('/auth/act-as', { method: 'POST', body: { userId } });
    window.location.reload();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
const menu = ref<'' | 'reg' | 'ai' | 'set' | 'me' | 'eng'>('');
const navOpen = ref(false);
// The switcher names the client first ("Kestrel Bay Telecom"), the engagement second.
const clientName = (c: string) => c.replace(/\s*\(demo\)\s*$/i, '') || c;
const initials = computed(() =>
  (app.user?.name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
);

// Five places in the top bar: Overview, Use cases, Registers, AI, Report,
// plus Settings. Optional modules appear only when switched on for the
// engagement (Engagement settings > General > Modules).
const REGISTERS = computed(() => [
  { to: '/risks', label: 'Risks', icon: 'risks' },
  { to: '/testing', label: 'Tests and Evidence', icon: 'tests' },
  { to: '/issues', label: app.mod('incidents') ? 'Issues and Incidents' : 'Issues', icon: 'issues', match: ['/issues', '/incidents'] },
  ...(app.mod('inventory') ? [{ to: '/inventory', label: 'AI Inventory', icon: 'inventory' }] : []),
]);
const AI_MENU = computed(() => [
  { to: '/settings/agents', label: 'AI Agents', icon: 'agents', hint: 'Who drafts each step, and on which model' },
  { to: '/runs', label: 'AI Runs', icon: 'runs', hint: 'Every run, its steps and cost' },
  ...(app.mod('evals') ? [{ to: '/evals', label: 'AI Testing and Monitoring', icon: 'evals', hint: 'Evals, red teaming, drift alerts' }] : []),
  ...(app.mod('advanced_ai') ? [{ to: '/agent-testing/golden', label: 'Checking the AI', icon: 'checking', hint: 'Golden dataset and the Verifier', match: '/agent-testing' }] : []),
]);
const SETTINGS = [
  { to: '/settings/general', label: 'Engagement Settings', icon: 'engagement', match: '/settings/(general|workflow|integrations|access)' },
  { to: '/workspace/models', label: 'Workspace Settings', icon: 'workspace', match: '/workspace' },
  { to: '/audit', label: 'Audit Log', icon: 'audit' },
];
const isOn = (items: { to: string; match?: string | string[] }[]) =>
  items.some((m) => [m.match ?? m.to].flat().some((x) => new RegExp(`^${x}`).test(route.path)));
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

// The top-bar assistant follows the page you're on.
function askAi() {
  const kind = route.path.startsWith('/risks') ? 'risks' : route.path.startsWith('/controls') ? 'controls' : route.path.startsWith('/issues') ? 'issues' : 'engagement';
  app.openAssistant(kind);
}

async function start() {
  try {
    await app.checkAuth();
    if (app.user) await app.init();
  } catch (e: any) {
    app.toast(`Couldn't reach the server: ${e.message}`, 'error');
  }
}
watch(() => app.user?.id, (id) => id && void app.init().catch((e) => app.toast(e.message, 'error')));
watch(() => route.fullPath, () => { menu.value = ''; navOpen.value = false; });
watch(menu, (m) => m === 'me' && (app.user?.role === 'admin' || app.user?.realUser) && void loadActAs());


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
        <RouterLink to="/" class="brand" aria-label="ARGUS home"><ArgusLogo /><span class="brand-text">ARGUS</span></RouterLink>
        <span v-if="app.engagement" class="menu-host">
          <button class="switcher" :aria-expanded="menu === 'eng'" aria-haspopup="menu" @click="menu = menu === 'eng' ? '' : 'eng'">
            <span class="swatch" :style="{ background: app.engagement.color }">{{ app.engagement.prefix[0] }}</span>
            <span class="switcher-name" :title="`${app.engagement.client} · ${app.engagement.name}`">{{ clientName(app.engagement.client) }}</span><span class="faint">▾</span>
          </button>
          <div v-if="menu === 'eng'" class="menu" role="menu" style="min-width: 260px">
            <button v-for="e in app.active" :key="e.id" role="menuitemradio" :aria-checked="e.id === app.engagementId" class="eng-item" @click="pick(e.id)">
              <span class="swatch" :style="{ background: e.color }">{{ e.prefix[0] }}</span>
              <span class="grow"><span>{{ clientName(e.client) }}</span><span class="small faint" style="display: block">{{ e.name }}</span></span>
              <span v-if="e.id === app.engagementId" aria-hidden="true">✓</span>
            </button>
            <template v-if="app.archived.length">
              <div class="menu-sep" />
              <span class="label-caps menu-label">Archived · read-only</span>
              <button v-for="e in app.archived" :key="e.id" role="menuitemradio" :aria-checked="e.id === app.engagementId" class="eng-item" style="opacity: 0.75" @click="pick(e.id)">
                <span class="swatch" :style="{ background: e.color, filter: 'grayscale(1)' }">{{ e.prefix[0] }}</span>
                <span class="grow"><span>{{ clientName(e.client) }}</span><span class="small faint" style="display: block">{{ e.name }}</span></span>
                <span v-if="e.id === app.engagementId" aria-hidden="true">✓</span>
              </button>
            </template>
            <template v-if="app.canRaw('manage_engagement')">
              <div class="menu-sep" />
              <RouterLink to="/engagements/new" role="menuitem" class="faint-link">+ Add engagement</RouterLink>
            </template>
          </div>
        </span>
        <button class="nav-toggle btn ghost sm" :aria-expanded="navOpen" aria-label="Menu" @click="navOpen = !navOpen">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path :d="navOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'" /></svg>
        </button>
        <nav class="nav" :class="{ open: navOpen }" aria-label="Main">
          <RouterLink title="Overview" to="/overview"><Icon name="overview" /><span class="nl">Overview</span></RouterLink>
          <RouterLink title="Use Cases" to="/" exact-active-class="router-link-active" active-class=""><Icon name="usecases" /><span class="nl">Use Cases</span></RouterLink>
          <RouterLink title="Controls" to="/controls" :class="{ 'router-link-active': $route.path.startsWith('/controls') }"><Icon name="controls" /><span class="nl">Controls</span></RouterLink>
          <span class="menu-host">
            <button class="nav-more" title="Registers" :class="{ 'router-link-active': isOn(REGISTERS) }" :aria-expanded="menu === 'reg'" @click="menu = menu === 'reg' ? '' : 'reg'"><Icon name="registers" /><span class="nl">Registers</span><Icon name="chevron" :size="13" /></button>
            <div v-if="menu === 'reg'" class="menu" role="menu">
              <RouterLink v-for="m in REGISTERS" :key="m.to" :to="m.to" role="menuitem" class="menu-icon"><Icon :name="m.icon" />{{ m.label }}</RouterLink>
            </div>
          </span>
          <span class="menu-host">
            <button class="nav-more nav-ai" title="AI" :class="{ 'router-link-active': isOn(AI_MENU) }" :aria-expanded="menu === 'ai'" @click="menu = menu === 'ai' ? '' : 'ai'"><Icon name="ai" /><span class="nl">AI</span><Icon name="chevron" :size="13" /></button>
            <div v-if="menu === 'ai'" class="menu" role="menu" style="min-width: 270px">
              <button role="menuitem" class="menu-rich" @click="menu = ''; askAi()"><Icon name="assistant" /><span><strong>Ask the Assistant</strong><span class="small faint">About the page you're on</span></span></button>
              <RouterLink v-for="m in AI_MENU" :key="m.to" :to="m.to" role="menuitem" class="menu-rich"><Icon :name="m.icon" /><span><strong>{{ m.label }}</strong><span class="small faint">{{ m.hint }}</span></span></RouterLink>
            </div>
          </span>
          <RouterLink title="Knowledge Base" to="/knowledge"><Icon name="knowledge" /><span class="nl">Knowledge Base</span></RouterLink>
          <RouterLink title="Report" to="/report"><Icon name="report" /><span class="nl">Report</span></RouterLink>
          <span class="menu-host">
            <button class="nav-more" title="Settings" :class="{ 'router-link-active': isOn(SETTINGS) }" :aria-expanded="menu === 'set'" @click="menu = menu === 'set' ? '' : 'set'"><Icon name="settings" /><span class="nl">Settings</span><Icon name="chevron" :size="13" /></button>
            <div v-if="menu === 'set'" class="menu" role="menu">
              <RouterLink v-for="m in SETTINGS" :key="m.to" :to="m.to" role="menuitem" class="menu-icon"><Icon :name="m.icon" />{{ m.label }}</RouterLink>
            </div>
          </span>
        </nav>
        <span class="grow" />
        <span class="badge" :class="app.health.runtime === 'live' ? 'ok' : 'warn'" :title="app.health.runtime === 'live' ? app.health.model : 'Agents use the offline rules. Pick a model in Settings > Agents.'">
          {{ app.health.runtime === 'live' ? 'Live agents' : 'Dry run' }}
        </span>
        <button class="btn ask-ai ask-top" title="Ask the assistant about this page" aria-label="Ask the assistant about this page" @click="askAi"><span class="ai-mark" style="font-size: 10px; padding: 1px 4px">AI</span><span class="ask-label">Ask AI</span></button>
        <button v-if="app.can('prepare')" class="btn primary" @click="router.push({ path: '/plan', query: { new: String(Date.now()) } })"><Icon name="plus" /><span class="add-label">Add Use Case</span></button>
        <span class="menu-host">
          <button class="avatar" :title="app.user.name" :aria-expanded="menu === 'me'" @click="menu = menu === 'me' ? '' : 'me'">{{ initials }}</button>
          <div v-if="menu === 'me'" class="menu right account-menu" role="menu">
            <div class="menu-head">
              <strong>{{ app.user.name }}</strong>
              <span class="small faint">{{ app.user.email }}</span>
            </div>
            <RouterLink to="/account" role="menuitem" class="menu-icon"><Icon name="account" />Your Account</RouterLink>
            <RouterLink v-if="app.can('manage_users')" to="/workspace/people" role="menuitem" class="menu-icon"><Icon name="people" />People and Roles</RouterLink>
            <RouterLink to="/audit" role="menuitem" class="menu-icon"><Icon name="audit" />Audit Log</RouterLink>
            <template v-if="actAs">
              <div class="menu-sep" />
              <span class="label-caps menu-label">Act As</span>
              <button v-for="p in actAs.people" :key="p.id" role="menuitemradio" :aria-checked="p.id === app.user.id" class="eng-item act-as-item" @click="actAsPerson(p.id === (app.user.realUser?.id ?? app.user.id) ? null : p.id)">
                <span class="grow">{{ p.name }}<span class="small faint" style="display: block">{{ p.role }}{{ p.id === (app.user.realUser?.id ?? app.user.id) ? ' · you' : '' }}</span></span>
                <span v-if="p.id === app.user.id" aria-hidden="true">✓</span>
              </button>
            </template>
            <div class="menu-sep" />
            <span class="label-caps menu-label">Theme</span>
            <div class="theme-pick" role="radiogroup" aria-label="Theme">
              <button v-for="t in THEMES" :key="t.id" role="radio" :aria-checked="app.theme === t.id" :class="{ on: app.theme === t.id }" @click="app.setTheme(t.id)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="t.icon" /></svg>{{ t.label }}
              </button>
            </div>
            <div class="menu-sep" />
            <button class="switch notify-toggle" :class="{ on: app.notify }" role="switch" :aria-checked="app.notify" @click="app.setNotify(!app.notify)">
              <span class="track" /><span>Desktop Notifications</span>
            </button>
            <p class="small faint menu-note">When a use case needs your approval and this tab is in the background, from any engagement.</p>
            <button class="btn signout" @click="signOut"><Icon name="signout" />Sign Out</button>
          </div>
        </span>
      </div>
    </header>

    <div v-if="app.user.realUser" class="archived-bar act-as-bar" role="status">
      <strong>Acting as {{ app.user.name }} ({{ app.user.role }}).</strong>
      <span>You are {{ app.user.realUser.name }}. Everything you do is recorded as {{ app.user.name }}, with your name beside it in the audit log.</span>
      <button class="btn sm" @click="actAsPerson(null)">Stop acting</button>
    </div>
    <div v-if="app.engagement?.archivedAt" class="archived-bar" role="status">
      <strong>{{ app.engagement.name }} is archived.</strong>
      <span>Read-only since {{ new Date(app.engagement.archivedAt).toLocaleDateString() }}, by {{ app.engagement.archivedBy }}<template v-if="app.engagement.archiveReason">: {{ app.engagement.archiveReason }}</template>.</span>
      <RouterLink v-if="app.canRaw('manage_engagement')" to="/settings/general">Restore or delete</RouterLink>
    </div>
    <RouterView :key="app.engagementId" />

    <AssistantPanel />
  </template>

  <div class="toast-host" aria-live="polite">
    <div v-for="t in app.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
  </div>
</template>
