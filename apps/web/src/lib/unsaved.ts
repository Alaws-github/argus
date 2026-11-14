// Save buttons stay disabled until something has changed. Call mark() after
// loading the form and after saving; dirty is true while the form differs from
// what was last loaded or saved. Comparison is by value (JSON), so typing a
// change and then undoing it disables Save again.
import { computed, ref, type Ref } from 'vue';

/** Tracks whether a form has unsaved changes, so Save stays off until there is one. */
export function useUnsaved<T>(form: Ref<T> | (() => T)) {
  const read = () => (typeof form === 'function' ? (form as () => T)() : form.value);
  const saved = ref(JSON.stringify(read()));
  const dirty = computed(() => JSON.stringify(read()) !== saved.value);
  const mark = () => {
    saved.value = JSON.stringify(read());
  };
  return { dirty, mark };
}
