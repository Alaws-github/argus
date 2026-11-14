<script setup lang="ts">
// A filter button in GoldenEye's style: "Label Value ▾", opening a small list.
// Single choice shows radio dots; multiple choice shows tick boxes with counts.
// Date mode offers Today, Yesterday, This week, This month, Last 90 days and a
// custom range. The page does the filtering; this only holds the choice.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';

export interface PillOption {
  value: string;
  label: string;
  icon?: string;
  count?: number;
  iconClass?: string;
}
export interface DateRange {
  preset: '' | 'today' | 'yesterday' | 'week' | 'month' | '90d' | 'custom';
  from?: string;
  to?: string;
}

const props = defineProps<{
  label: string;
  options?: PillOption[];
  multi?: boolean;
  date?: boolean;
  anyLabel?: string;
}>();
const model = defineModel<string | string[] | DateRange>({ required: true });
const open = ref(false);
const root = ref<HTMLElement | null>(null);

const DATE_OPTIONS: PillOption[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom' },
];
const opts = computed(() => (props.date ? DATE_OPTIONS : (props.options ?? [])));
const any = computed(() => props.anyLabel ?? (props.date ? 'Any time' : 'Any'));

const shown = computed(() => {
  const v = model.value as any;
  if (props.date) {
    const r = v as DateRange;
    if (!r.preset) return any.value;
    if (r.preset === 'custom') return r.from || r.to ? `${r.from ?? '…'} to ${r.to ?? '…'}` : 'Custom';
    return DATE_OPTIONS.find((o) => o.value === r.preset)?.label ?? any.value;
  }
  if (props.multi) {
    const arr = v as string[];
    if (!arr.length) return any.value;
    if (arr.length === 1) return opts.value.find((o) => o.value === arr[0])?.label ?? arr[0];
    return `${arr.length} selected`;
  }
  return opts.value.find((o) => o.value === v)?.label ?? any.value;
});
const active = computed(() =>
  props.date
    ? !!(model.value as DateRange).preset
    : props.multi
      ? (model.value as string[]).length > 0
      : model.value !== (opts.value[0]?.value ?? ''),
);

function isOn(v: string) {
  const m = model.value as any;
  if (props.date) return (m as DateRange).preset === v;
  return props.multi ? (m as string[]).includes(v) : m === v;
}
function pick(v: string) {
  if (props.date) {
    const r = model.value as DateRange;
    model.value = r.preset === v && v !== 'custom' ? { preset: '' } : { ...r, preset: v as DateRange['preset'] };
    if (v !== 'custom') open.value = false;
  } else if (props.multi) {
    const arr = model.value as string[];
    model.value = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  } else {
    model.value = v;
    open.value = false;
  }
}
function clear() {
  model.value = props.date ? { preset: '' } : props.multi ? [] : (opts.value[0]?.value ?? '');
  open.value = false;
}
const onDoc = (e: MouseEvent) => {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
};
onMounted(() => document.addEventListener('mousedown', onDoc));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc));
</script>

<template>
  <div ref="root" class="fpill-wrap" @keydown.esc="open = false">
    <button
      type="button"
      class="fpill"
      :class="{ open, active }"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="open = !open"
    >
      <span class="fpill-label">{{ label }}</span>
      <strong class="fpill-value">{{ shown }}</strong>
      <AppIcon name="chevron" :size="14" />
    </button>
    <div v-if="open" class="fpill-menu" :role="multi ? 'group' : 'radiogroup'" :aria-label="label">
      <button
        v-for="o in opts"
        :key="o.value"
        type="button"
        class="fpill-opt"
        :role="multi ? 'checkbox' : 'radio'"
        :aria-checked="isOn(o.value)"
        @click="pick(o.value)"
      >
        <span class="fpill-mark" :class="[multi ? 'box' : 'dot', { on: isOn(o.value) }]"
          ><AppIcon v-if="multi && isOn(o.value)" name="check" :size="11"
        /></span>
        <span v-if="o.icon" class="fpill-icon" :class="o.iconClass"
          ><svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path :d="o.icon" /></svg
        ></span>
        <span class="grow">{{ o.label }}</span>
        <span v-if="o.count !== undefined" class="fpill-count mono">{{ o.count }}</span>
      </button>
      <div v-if="date && (model as DateRange).preset === 'custom'" class="fpill-custom">
        <label class="small">From <input v-model="(model as DateRange).from" class="input" type="date" /></label>
        <label class="small">To <input v-model="(model as DateRange).to" class="input" type="date" /></label>
      </div>
      <button v-if="active" type="button" class="fpill-clear small" @click="clear">Clear</button>
    </div>
  </div>
</template>
