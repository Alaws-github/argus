<script setup lang="ts">
// A stacked bar per day, one colour per series in a fixed order (never
// cycled; a 7th series and beyond fold into "Other"). Hover a day for its
// breakdown. A legend is always shown for two or more series.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{ days: string[]; series: Record<string, number[]>; format?: (n: number) => string }>();
const fmt = (n: number) => (props.format ? props.format(n) : String(Math.round(n * 100) / 100));
const COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];

// Biggest series first; the rest become Other so colour stays meaningful.
const rows = computed(() => {
  const all = Object.entries(props.series)
    .map(([name, v]) => ({ name, v, total: v.reduce((a, b) => a + b, 0) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  if (all.length <= 6) return all.map((r, i) => ({ ...r, color: COLORS[i] }));
  const keep = all.slice(0, 5).map((r, i) => ({ ...r, color: COLORS[i] }));
  const rest = all.slice(5);
  const v = props.days.map((_, d) => rest.reduce((a, r) => a + r.v[d], 0));
  return [...keep, { name: `Other (${rest.length})`, v, total: v.reduce((a, b) => a + b, 0), color: 'var(--faint)' }];
});
const totals = computed(() => props.days.map((_, d) => rows.value.reduce((a, r) => a + r.v[d], 0)));
const max = computed(() => {
  const m = Math.max(0, ...totals.value);
  if (m <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(m));
  return [1, 2, 2.5, 5, 10].map((x) => x * p).find((x) => x >= m)!;
});

// Drawn at the container's real width so text stays 11px at any size.
const box = ref<HTMLElement | null>(null);
const W = ref(720);
const H = 180,
  L = 44,
  B = 22,
  T = 8;
let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(([e]) => (W.value = Math.max(240, Math.round(e.contentRect.width))));
  if (box.value) ro.observe(box.value);
});
onBeforeUnmount(() => ro?.disconnect());
const bw = computed(() => (W.value - L) / props.days.length);
const y = (v: number) => T + (H - T - B) * (1 - v / max.value);
const ticks = computed(() => [0, 0.5, 1].map((f) => f * max.value));
const labelEvery = computed(() => Math.ceil(props.days.length / Math.max(2, Math.floor((W.value - L) / 70))));
const short = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const hover = ref<number | null>(null);
const tipLeft = computed(() =>
  hover.value == null ? 0 : Math.min(((L + bw.value * (hover.value + 0.5)) / W.value) * 100, 78),
);
</script>

<template>
  <div ref="box" class="chart-wrap">
    <div v-if="rows.length > 1" class="legend" style="margin-bottom: 8px">
      <span v-for="r in rows" :key="r.name"><i :style="{ background: r.color }" />{{ r.name }}</span>
    </div>
    <svg
      :width="W"
      :height="H"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="`Stacked bars per day, ${rows.length} series`"
      @mouseleave="hover = null"
    >
      <g v-for="t in ticks" :key="t">
        <line class="grid-line" :x1="L" :x2="W" :y1="y(t)" :y2="y(t)" />
        <text class="axis-label" :x="L - 6" :y="y(t) + 4" text-anchor="end">{{ fmt(t) }}</text>
      </g>
      <g v-for="(d, i) in days" :key="d">
        <rect class="hit" :x="L + bw * i" :y="T" :width="bw" :height="H - T - B" @mouseenter="hover = i" />
        <template v-for="(r, j) in rows" :key="r.name">
          <rect
            v-if="r.v[i] > 0"
            class="mark"
            pointer-events="none"
            :fill="r.color"
            :x="L + bw * i + Math.max(1, bw * 0.15)"
            :width="Math.max(2, bw * 0.7)"
            :y="y(rows.slice(0, j + 1).reduce((a, x) => a + x.v[i], 0))"
            :height="
              Math.max(
                0,
                y(rows.slice(0, j).reduce((a, x) => a + x.v[i], 0)) -
                  y(rows.slice(0, j + 1).reduce((a, x) => a + x.v[i], 0)),
              )
            "
            :rx="j === rows.length - 1 || !rows.slice(j + 1).some((x) => x.v[i] > 0) ? Math.min(4, bw * 0.3) : 0"
          />
        </template>
        <text v-if="i % labelEvery === 0" class="axis-label" :x="L + bw * (i + 0.5)" :y="H - 6" text-anchor="middle">
          {{ short(d) }}
        </text>
      </g>
    </svg>
    <div v-if="hover != null" class="chart-tip" :style="{ left: `${tipLeft}%`, top: '30px' }">
      <strong>{{ short(days[hover]) }}</strong> · {{ fmt(totals[hover]) }}
      <div v-for="r in rows.filter((x) => x.v[hover!] > 0)" :key="r.name" class="spread small"
        ><span
          ><i
            :style="{
              background: r.color,
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '2px',
              marginRight: '5px',
            }"
          />{{ r.name }}</span
        ><span class="mono">{{ fmt(r.v[hover!]) }}</span></div
      >
    </div>
    <p v-if="!rows.length" class="small faint" style="position: absolute; top: 40%; width: 100%; text-align: center"
      >Nothing in this period</p
    >
  </div>
</template>
