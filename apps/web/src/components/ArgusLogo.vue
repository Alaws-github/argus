<script setup lang="ts">
// ARGUS mark: a line-drawn Great Argus pheasant in display, its wing fanned
// out with the eye-spots (ocelli) the bird is named for, in copper. Argus was
// the hundred-eyed watchman of Greek myth: a fitting name for assurance.
// An original drawing; GoldenEye's mark is the model for the style only.
defineProps<{ size?: number }>();
</script>

<template>
  <svg :width="size ?? 26" :height="size ?? 26" viewBox="0 0 32 32" fill="none" aria-hidden="true" class="argus-mark">
    <ellipse cx="16.07" cy="13.47" rx="6.50" ry="2.15" transform="rotate(-112 16.07 13.47)" stroke="currentColor" stroke-width="1.35"/>
    <circle cx="14.90" cy="10.58" r="1.2" fill="var(--brand, #d0743c)"/>
    <ellipse cx="13.01" cy="14.39" rx="7.50" ry="2.15" transform="rotate(-137 13.01 14.39)" stroke="currentColor" stroke-width="1.35"/>
    <circle cx="10.38" cy="11.93" r="1.2" fill="var(--brand, #d0743c)"/>
    <ellipse cx="11.13" cy="17.11" rx="7.75" ry="2.15" transform="rotate(-162 11.13 17.11)" stroke="currentColor" stroke-width="1.35"/>
    <circle cx="7.59" cy="15.96" r="1.2" fill="var(--brand, #d0743c)"/>
    <ellipse cx="11.55" cy="20.35" rx="7.00" ry="2.15" transform="rotate(173 11.55 20.35)" stroke="currentColor" stroke-width="1.35"/>
    <circle cx="8.22" cy="20.76" r="1.2" fill="var(--brand, #d0743c)"/>
    <ellipse cx="13.52" cy="22.38" rx="5.75" ry="2.15" transform="rotate(150 13.52 22.38)" stroke="currentColor" stroke-width="1.35"/>
    <circle cx="11.13" cy="23.75" r="1.2" fill="var(--brand, #d0743c)"/>
    <path d="M17 22c2.6 3 6.6 2.9 8.3-.6 1.3-2.7.2-5.9-1.5-7.9-1-1.1-1.4-2.7-.8-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    <circle cx="24.6" cy="7.6" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M26.5 7.2l2.4.8-2.3.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M20.4 24.8l-1.1 3.9M23.1 24.9l.4 3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
</template>
