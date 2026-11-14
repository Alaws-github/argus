<script setup lang="ts">
// The row of KPI tiles at the top of a page (v1.7 dashboard look). Every page
// reads the same numbers from GET /engagements/:id/kpis; this file decides
// which tiles a page shows. The first tile is the accent tile. Each tile links
// to where the number comes from.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, socket } from '../api';
import { useApp } from '../stores/app';
import AppIcon from './AppIcon.vue';
import { PAGE_TILES, type Tile } from './kpi-tiles';

const props = defineProps<{ page: string }>();
const app = useApp();
const k = ref<any>(null);

// One request shared by every strip on screen, refreshed at most every few seconds.
let timer: ReturnType<typeof setTimeout> | null = null;
async function load() {
  if (!app.engagementId) return;
  try {
    k.value = await api(`/engagements/${app.engagementId}/kpis`);
  } catch {
    /* the tiles are a summary; the page still works without them */
  }
}
const soon = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void load(), 1500);
};
onMounted(() => {
  void load();
  socket.on('card', soon);
  socket.on('audit', soon);
});
onBeforeUnmount(() => {
  socket.off('card', soon);
  socket.off('audit', soon);
  if (timer) clearTimeout(timer);
});
watch(
  () => app.engagementId,
  () => void load(),
);

const tiles = computed<Tile[]>(() => (k.value ? (PAGE_TILES[props.page]?.(k.value) ?? []) : []));
</script>

<template>
  <div v-if="tiles.length" class="kpi-strip" :class="`n${tiles.length}`">
    <component
      :is="t.to ? 'RouterLink' : 'div'"
      v-for="(t, i) in tiles"
      :key="t.label"
      :to="t.to"
      class="kpi"
      :class="[i === 0 ? 'accent' : '', t.tone ? `tone-${t.tone}` : '', t.to ? 'link' : '']"
    >
      <div class="kpi-top"
        ><span class="kpi-icon"><AppIcon :name="t.icon" :size="15" /></span
        ><span class="kpi-label">{{ t.label }}</span></div
      >
      <div class="kpi-value">{{ t.value }}</div>
      <div v-if="t.sub" class="kpi-sub">{{ t.sub }}</div>
    </component>
  </div>
</template>
