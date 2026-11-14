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
    { path: '/', component: () => import('./features/board/BoardPage.vue') },
    { path: '/plan/:id?', component: () => import('./features/board/PlanPage.vue') },
    { path: '/overview', component: () => import('./features/engagements/OverviewPage.vue') },
    { path: '/risks', component: () => import('./features/risks/RisksPage.vue') },
    { path: '/runs', component: () => import('./features/board/RunsPage.vue') },
    { path: '/runs/:id', component: () => import('./features/board/RunDetailPage.vue') },
    { path: '/audit', component: () => import('./features/audit/AuditPage.vue') },
    { path: '/settings', redirect: '/settings/general' },
    { path: '/settings/tools', redirect: '/settings/integrations' },
    { path: '/settings/gates', redirect: '/settings/workflow' },
    {
      path: '/settings/:tab(general|workflow|integrations|agents|access)',
      component: () => import('./features/engagements/SettingsPage.vue'),
    },
    { path: '/agents', redirect: '/settings/agents' },
    { path: '/models', redirect: '/workspace/models' },
    { path: '/workspace', redirect: '/workspace/models' },
    {
      path: '/workspace/:tab(models|people|security)',
      component: () => import('./features/workspace/WorkspacePage.vue'),
    },
    { path: '/controls', redirect: '/controls/standards' },
    {
      path: '/controls/:tab(standards|requirements|register|library|soa|traceability|harmonize)',
      component: () => import('./features/controls/ControlsPage.vue'),
    },
    { path: '/testing', redirect: '/testing/tests' },
    { path: '/testing/:tab(tests|evidence|connectors)', component: () => import('./features/testing/TestingPage.vue') },
    { path: '/issues', component: () => import('./features/issues/IssuesPage.vue') },
    { path: '/incidents', component: () => import('./features/incidents/IncidentsPage.vue') },
    { path: '/evals', component: () => import('./features/evals/EvalsPage.vue') },
    { path: '/evals/:id', component: () => import('./features/evals/EvalSuitePage.vue') },
    { path: '/inventory', component: () => import('./features/inventory/InventoryPage.vue') },
    { path: '/report', component: () => import('./features/reporting/ReportPage.vue') },
    { path: '/users', redirect: '/workspace/people' },
    { path: '/workflows', component: () => import('./features/integrations/WorkflowsPage.vue') },
    { path: '/workflows/:id', component: () => import('./features/integrations/WorkflowBuilderPage.vue') },
    { path: '/knowledge', component: () => import('./features/knowledge/KnowledgePage.vue') },
    { path: '/agent-testing', redirect: '/agent-testing/golden' },
    {
      path: '/agent-testing/:tab(golden|verifier|retrieval|history)',
      component: () => import('./features/agent-testing/AgentTestingPage.vue'),
    },
    { path: '/account', component: () => import('./features/workspace/AccountPage.vue') },
    { path: '/engagements/new', component: () => import('./features/engagements/AddEngagementPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

createApp(App).use(createPinia()).use(router).mount('#app');
