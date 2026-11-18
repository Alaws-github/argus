<script setup lang="ts">
// The sign-in background: up to a hundred eye-spots, after Argus the hundred-eyed watchman and the copper
// eye-spots in the ARGUS mark. The eyes follow the pointer and blink now and then; they look at the form
// while you type your email, and close in a wave while the password field has focus (mode 'closed').
// It is decoration only: hidden from screen readers, never takes a click, a still picture for anyone who
// asks for reduced motion or uses touch, and it stops drawing while the tab is hidden.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ mode: 'watch' | 'form' | 'closed' }>();

/** One eye: where it sits, its size, and how open it is and where it looks right now. */
interface Eye {
  x: number;
  y: number;
  r: number;
  alpha: number;
  open: number; // 0 shut to 1 open
  gx: number; // gaze, -1 to 1 on each axis
  gy: number;
  nextBlink: number; // time of the next blink, ms
  blinkStart: number; // when the current blink began, or -1
  delay: number; // how long after a mode change this eye reacts, ms (the wave)
  wander: number; // seed for idle gaze
}

const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let eyes: Eye[] = [];
let width = 0;
let height = 0;
let frame = 0;
let pointer: { x: number; y: number; at: number } | null = null;
let modeChangedAt = 0;
let cameFromClosed = false; // eyes reopen in a wave only when the password field loses focus
let colors = { ring: '#3a414c', iris: '#d0743c', pupil: '#0b0d10' };
const still =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('(pointer: coarse)').matches;

const BLINK_MS = 190;
const MAX_EYES = 100;

/** Reads the theme's colours, so the eyes match dark and light mode. */
function readColors() {
  const css = getComputedStyle(document.documentElement);
  const light = css.getPropertyValue('--bg').trim().toLowerCase() === '#f5f6f8';
  colors = {
    ring: css.getPropertyValue('--line-strong').trim() || colors.ring,
    iris: light ? '#b4602b' : '#d0743c',
    pupil: light ? '#2c3139' : '#0b0d10',
  };
}

/** Scatters the eyes on a jittered grid, leaving a clear space around the form in the middle. */
function placeEyes() {
  const cell = Math.max(125, Math.sqrt((width * height) / MAX_EYES));
  const formW = Math.min(440, width - 32) / 2 + 40;
  const formH = 300;
  const placed: Eye[] = [];
  for (let y = cell / 2; y < height; y += cell) {
    for (let x = cell / 2; x < width; x += cell) {
      const ex = x + (Math.random() - 0.5) * cell * 0.7;
      const ey = y + (Math.random() - 0.5) * cell * 0.7;
      if (Math.abs(ex - width / 2) < formW && Math.abs(ey - height / 2) < formH) continue;
      const r = 9 + Math.random() * 17;
      placed.push({
        x: ex,
        y: ey,
        r,
        alpha: 0.16 + (r / 26) * 0.3,
        open: 1,
        gx: 0,
        gy: 0,
        nextBlink: performance.now() + 1500 + Math.random() * 7000,
        blinkStart: -1,
        delay: 0,
        wander: Math.random() * 1000,
      });
    }
  }
  eyes = placed.slice(0, MAX_EYES);
}

/** Sizes the canvas to the window at the screen's pixel density, then places the eyes again. */
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
  placeEyes();
  if (still) drawStill();
}

/** Where an eye wants to look, from -1 to 1 on each axis: the pointer, the form, or a slow idle wander. */
function gazeTarget(e: Eye, now: number) {
  let tx: number;
  let ty: number;
  if (props.mode === 'form' || still) {
    tx = width / 2;
    ty = height / 2;
  } else if (pointer && now - pointer.at < 4000) {
    tx = pointer.x;
    ty = pointer.y;
  } else {
    const t = (now + e.wander * 10) / 2600;
    return { x: Math.sin(t + e.wander) * 0.6, y: Math.cos(t * 0.8 + e.wander) * 0.4 };
  }
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const pull = Math.min(1, d / 160);
  return { x: (dx / d) * pull, y: (dy / d) * pull };
}

/** How open an eye should be now: shut while the password has focus, otherwise open apart from blinks. */
function openTarget(e: Eye, now: number) {
  const reacted = now - modeChangedAt > e.delay;
  if (props.mode === 'closed') return reacted ? 0 : 1;
  if (!reacted && cameFromClosed) return 0;
  if (e.blinkStart < 0 && now >= e.nextBlink) e.blinkStart = now;
  if (e.blinkStart >= 0) {
    const t = (now - e.blinkStart) / BLINK_MS;
    if (t >= 1) {
      e.blinkStart = -1;
      e.nextBlink = now + 2500 + Math.random() * 8000;
      return 1;
    }
    return Math.abs(1 - 2 * t);
  }
  return 1;
}

/** Draws one eye: an almond outline whose lids close with `open`, and a copper iris and pupil inside. */
function drawEye(c: CanvasRenderingContext2D, e: Eye) {
  const w = e.r * 1.6;
  const h = e.r * e.open;
  c.save();
  c.globalAlpha = e.alpha;
  c.translate(e.x, e.y);
  if (e.open < 0.15) {
    // Shut: a curved lid line, like a sleeping eye.
    c.beginPath();
    c.moveTo(-w, 0);
    c.quadraticCurveTo(0, e.r * 0.55, w, 0);
    c.lineWidth = 1.6;
    c.strokeStyle = colors.ring;
    c.stroke();
    c.restore();
    return;
  }
  c.beginPath();
  c.moveTo(-w, 0);
  c.quadraticCurveTo(0, -h * 1.5, w, 0);
  c.quadraticCurveTo(0, h * 1.5, -w, 0);
  c.closePath();
  c.lineWidth = 1.4;
  c.strokeStyle = colors.ring;
  c.stroke();
  c.clip();
  const ix = e.gx * w * 0.45;
  const iy = e.gy * e.r * 0.35;
  c.beginPath();
  c.arc(ix, iy, e.r * 0.62, 0, Math.PI * 2);
  c.fillStyle = colors.iris;
  c.fill();
  c.beginPath();
  c.arc(ix, iy, e.r * 0.28, 0, Math.PI * 2);
  c.fillStyle = colors.pupil;
  c.fill();
  c.restore();
}

/** One animation frame: ease each eye toward its gaze and openness, then draw them all. */
function tick(now: number) {
  frame = 0;
  if (!ctx || document.hidden) return;
  ctx.clearRect(0, 0, width, height);
  for (const e of eyes) {
    const g = gazeTarget(e, now);
    e.gx += (g.x - e.gx) * 0.12;
    e.gy += (g.y - e.gy) * 0.12;
    e.open += (openTarget(e, now) - e.open) * (e.blinkStart >= 0 ? 0.6 : 0.18);
    drawEye(ctx, e);
  }
  frame = requestAnimationFrame(tick);
}

/** The picture without motion: every eye open and looking at the form, or shut while the password has focus. */
function drawStill() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  for (const e of eyes) {
    const g = gazeTarget(e, 0);
    e.gx = g.x;
    e.gy = g.y;
    e.open = props.mode === 'closed' ? 0 : 1;
    drawEye(ctx, e);
  }
}

/** Starts drawing again if it was stopped (first load, or the tab coming back). */
function start() {
  if (still) drawStill();
  else if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
}

const onPointer = (ev: PointerEvent) => {
  pointer = { x: ev.clientX, y: ev.clientY, at: performance.now() };
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
  if (still) drawStill();
};
const themeObserver = new MutationObserver(onTheme);

// A mode change sets off a wave from the middle outwards: eyes nearest the form react first.
watch(
  () => props.mode,
  (_mode, previous) => {
    modeChangedAt = performance.now();
    cameFromClosed = previous === 'closed';
    const far = Math.hypot(width / 2, height / 2) || 1;
    for (const e of eyes) e.delay = (Math.hypot(e.x - width / 2, e.y - height / 2) / far) * 260;
    if (still) drawStill();
  },
);

onMounted(() => {
  readColors();
  resize();
  window.addEventListener('pointermove', onPointer, { passive: true });
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
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVisibility);
  scheme.removeEventListener('change', onTheme);
  themeObserver.disconnect();
});
</script>

<template>
  <canvas ref="canvas" class="watching-eyes" aria-hidden="true"></canvas>
</template>

<style scoped>
.watching-eyes {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
</style>
