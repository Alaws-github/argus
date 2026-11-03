<script setup lang="ts">
// Tabs shared by the Issues and Incidents pages. Incidents is an optional module.
import { useApp } from '../stores/app';
const app = useApp();
</script>

<template>
  <nav class="tabs">
    <RouterLink to="/issues" :class="{ active: $route.path === '/issues' }">Issues</RouterLink>
    <RouterLink v-if="app.mod('incidents') || $route.path === '/incidents'" to="/incidents" :class="{ active: $route.path === '/incidents' }">Incidents</RouterLink>
  </nav>
</template>
