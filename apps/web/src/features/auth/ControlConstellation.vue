<script setup lang="ts">
// The sign-in background: a slowly drifting constellation of records (use cases, risks, controls, tests and
// evidence) joined by thin lines, like the traceability chain ARGUS keeps. Points near the pointer are drawn
// towards it and the nearest few show their keys ("R-5", "C-12"). It is decoration only: hidden from screen
// readers, never takes a click, a still picture for anyone who asks for reduced motion or uses touch, and it
// stops drawing while the tab is hidden.
import { onBeforeUnmount, onMounted, ref } from 'vue';

/** The kinds of record a point stands for, with their key prefix and the theme colour they take. */
const KINDS = [
  { prefix: 'AI', token: '--brand' },
  { prefix: 'R', token: '--danger' },
  { prefix: 'C', token: '--accent' },
  { prefix: 'C', token: '--accent' },
  { prefix: 'T', token: '--warn' },
  { prefix: 'E', token: '--ok' },
] as const;

/**
 * One point. Each circles slowly round its own anchor, and the anchors are spread evenly over the window, so
 * the points never bunch up. The pointer only nudges a point off its path (ox, oy), and it springs back.
 */
interface Point {
  x: number;
  y: number;
  ax: number; // anchor
  ay: number;
  orbit: number; // radius of its slow circle round the anchor
  angle: number;
  spin: number; // radians per frame, either way round
  ox: number; // the pointer's nudge
  oy: number;
  r: number;
  kind: number;
  label: string;
  show: number; // label opacity, 0 to 1
}

const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let points: Point[] = [];
let width = 0;
let height = 0;
let frame = 0;
let pointer: { x: number; y: number } | null = null;
let colors = { line: '#4a5699', text: '#a3a9b3', kinds: KINDS.map(() => '#8b9dff') };
const still =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('(pointer: coarse)').matches;

const LINK = 120; // points closer than this are joined
const REACH = 200; // the pointer pulls points within this distance
const NUDGE = 34; // how far, at most, the pointer draws a point towards it
const LABELS = 5; // keys shown on the points nearest the pointer
const LABEL_GAP = 34; // keys closer together than this are skipped, so they never overlap
const MAX_POINTS = 170;

/** Reads the theme's colours, so the constellation matches dark and light mode. */
function readColors() {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  colors = {
    line: get('--accent-line', colors.line),
    text: get('--muted', colors.text),
    kinds: KINDS.map((k) => get(k.token, k.token === '--brand' ? '#d0743c' : '#8b9dff')),
  };
}

/** Spreads the anchors evenly on a jittered grid over the window, numbering each kind's keys from 1 like real records. */
function placePoints() {
  const cell = Math.max(64, Math.sqrt((width * height) / MAX_POINTS));
  const next = KINDS.map(() => 1);
  points = [];
  for (let y = cell / 2; y < height + cell / 2; y += cell) {
    for (let x = cell / 2; x < width + cell / 2; x += cell) {
      if (Math.random() < 0.12) continue; // a few gaps, so it doesn't look like a grid
      const kind = Math.floor(Math.random() * KINDS.length);
      const n = KINDS[kind].prefix === 'C' ? next[2]++ : next[kind]++;
      const ax = x + (Math.random() - 0.5) * cell * 0.8;
      const ay = y + (Math.random() - 0.5) * cell * 0.8;
      points.push({
        x: ax,
        y: ay,
        ax,
        ay,
        orbit: 8 + Math.random() * cell * 0.3,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() < 0.5 ? -1 : 1) * (0.0012 + Math.random() * 0.0025),
        ox: 0,
        oy: 0,
        r: 1.6 + Math.random() * 1.8,
        kind,
        label: `${KINDS[kind].prefix}-${n}`,
        show: 0,
      });
    }
  }
}

/** Sizes the canvas to the window at the screen's pixel density, then places the points again. */
function resize() {
  const el = canvas.value;
  if (!el) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  el.width = Math.round(width * dpr);
  el.height = Math.round(height * dpr);
  ctx = el.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  placePoints();
  if (still) draw();
}

/** Moves each point round its anchor, and nudges the ones near the pointer towards it (they spring back after). */
function move() {
  for (const p of points) {
    p.angle += p.spin;
    const px = p.ax + Math.cos(p.angle) * p.orbit;
    const py = p.ay + Math.sin(p.angle) * p.orbit;
    let tx = 0;
    let ty = 0;
    if (pointer) {
      const dx = pointer.x - px;
      const dy = pointer.y - py;
      const d = Math.hypot(dx, dy);
      if (d < REACH && d > 1) {
        const k = (1 - d / REACH) * NUDGE;
        tx = (dx / d) * k;
        ty = (dy / d) * k;
      }
    }
    p.ox += (tx - p.ox) * 0.08;
    p.oy += (ty - p.oy) * 0.08;
    p.x = px + p.ox;
    p.y = py + p.oy;
  }
}

/** Fades in the keys of the points nearest the pointer and fades out the rest. */
function updateLabels() {
  const near = pointer
    ? points
        .map((p) => ({ p, d: Math.hypot(p.x - pointer!.x, p.y - pointer!.y) }))
        .filter((x) => x.d < REACH)
        .sort((a, b) => a.d - b.d)
        .map((x) => x.p)
    : [];
  const shown: Point[] = [];
  for (const p of near) {
    if (shown.length >= LABELS) break;
    if (shown.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > LABEL_GAP)) shown.push(p);
  }
  for (const p of points) p.show += ((shown.includes(p) ? 1 : 0) - p.show) * 0.12;
}

/** Draws the lines between near points (and to the pointer), then the points and any visible keys. */
function draw() {
  if (!ctx) return;
  const c = ctx;
  c.clearRect(0, 0, width, height);
  c.lineWidth = 1;
  c.strokeStyle = colors.line;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    for (let j = i + 1; j < points.length; j++) {
      const b = points[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > LINK) continue;
      c.globalAlpha = (1 - d / LINK) * 0.6;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    if (pointer) {
      const d = Math.hypot(a.x - pointer.x, a.y - pointer.y);
      if (d < REACH) {
        c.globalAlpha = (1 - d / REACH) * 0.35;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(pointer.x, pointer.y);
        c.stroke();
      }
    }
  }
  c.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
  for (const p of points) {
    c.globalAlpha = 0.75;
    c.fillStyle = colors.kinds[p.kind];
    c.beginPath();
    c.arc(p.x, p.y, p.r + p.show * 1.5, 0, Math.PI * 2);
    c.fill();
    if (p.show > 0.03) {
      c.globalAlpha = p.show * 0.9;
      c.fillStyle = colors.text;
      c.fillText(p.label, p.x + 7, p.y - 6);
    }
  }
  c.globalAlpha = 1;
}

/** One animation frame. */
function tick() {
  frame = 0;
  if (document.hidden) return;
  move();
  updateLabels();
  draw();
  frame = requestAnimationFrame(tick);
}

/** Starts drawing again if it was stopped (first load, or the tab coming back). */
function start() {
  if (still) draw();
  else if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
}

const onPointer = (ev: PointerEvent) => {
  pointer = { x: ev.clientX, y: ev.clientY };
};
const onLeave = () => {
  pointer = null;
};
let resizeTimer = 0;
const onResize = () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(resize, 150);
};
const onVisibility = () => start();
const scheme = window.matchMedia('(prefers-color-scheme: light)');
const onTheme = () => {
  readColors();
  if (still) draw();
};
const themeObserver = new MutationObserver(onTheme);

onMounted(() => {
  readColors();
  resize();
  if (!still) {
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('pointerleave', onLeave);
  }
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  scheme.addEventListener('change', onTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  start();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  clearTimeout(resizeTimer);
  window.removeEventListener('pointermove', onPointer);
  document.removeEventListener('pointerleave', onLeave);
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVisibility);
  scheme.removeEventListener('change', onTheme);
  themeObserver.disconnect();
});
</script>

<template>
  <canvas ref="canvas" class="control-constellation" aria-hidden="true"></canvas>
</template>

<style scoped>
.control-constellation {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
</style>
