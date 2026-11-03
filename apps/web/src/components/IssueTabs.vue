<script setup lang="ts">
// Tabs shared by the Issues and Incidents pages.
</script>

<template>
  <nav class="tabs">
    <RouterLink to="/issues" :class="{ active: $route.path === '/issues' }">Issues</RouterLink>
    <RouterLink to="/incidents" :class="{ active: $route.path === '/incidents' }">Incidents</RouterLink>
  </nav>
</template>
