// Web app entry point: fonts, styles, and the list of pages and their URLs.
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import App from './App.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./pages/BoardPage.vue') },
    { path: '/overview', component: () => import('./pages/OverviewPage.vue') },
    { path: '/risks', component: () => import('./pages/RisksPage.vue') },
    { path: '/runs', component: () => import('./pages/RunsPage.vue') },
    { path: '/runs/:id', component: () => import('./pages/RunDetailPage.vue') },
    { path: '/audit', component: () => import('./pages/AuditPage.vue') },
    { path: '/settings', redirect: '/settings/general' },
    { path: '/settings/:tab(general|workflow|agents)', component: () => import('./pages/SettingsPage.vue') },
    { path: '/agents', redirect: '/settings/agents' },
    { path: '/models', component: () => import('./pages/ModelsPage.vue') },
    { path: '/controls', redirect: '/controls/register' },
    { path: '/controls/:tab(register|library|soa|traceability)', component: () => import('./pages/ControlsPage.vue') },
    { path: '/testing', redirect: '/testing/tests' },
    { path: '/testing/:tab(tests|evidence)', component: () => import('./pages/TestingPage.vue') },
    { path: '/issues', component: () => import('./pages/IssuesPage.vue') },
    { path: '/evals', component: () => import('./pages/EvalsPage.vue') },
    { path: '/evals/:id', component: () => import('./pages/EvalSuitePage.vue') },
    { path: '/inventory', component: () => import('./pages/InventoryPage.vue') },
    { path: '/report', component: () => import('./pages/ReportPage.vue') },
    { path: '/users', component: () => import('./pages/UsersPage.vue') },
    { path: '/knowledge', component: () => import('./pages/KnowledgePage.vue') },
    { path: '/agent-testing', redirect: '/agent-testing/golden' },
    { path: '/agent-testing/:tab(golden|verifier|history)', component: () => import('./pages/AgentTestingPage.vue') },
    { path: '/account', component: () => import('./pages/AccountPage.vue') },
    { path: '/engagements/new', component: () => import('./pages/AddEngagementPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

createApp(App).use(createPinia()).use(router).mount('#app');
