// Tagging a record with @ in the assistant's question box: use cases on the board, plus risks, controls
// and issues. Typing @ lists matches; arrow keys move, Enter or Tab picks, Escape closes. Enter without
// a list open sends the question. Split out of AssistantPanel.vue in v1.7.8.
import { computed, nextTick, ref, type Ref } from 'vue';
import { api } from '../../api';
import { useApp } from '../../stores/app';

/** A record that can be tagged with @: its key, title and kind. */
export type Tag = { key: string; title: string; kind: string };

/** The @ tag picker for the question box: matches as you type, keys to move and pick, and Enter to send. */
export function useTagPicker(question: Ref<string>, box: Ref<HTMLTextAreaElement | null>, send: () => unknown) {
  const app = useApp();
  const tags = ref<Tag[]>([]);
  const tagQuery = ref<string | null>(null);
  const tagIndex = ref(0);
  async function loadTags() {
    if (tags.value.length) return;
    const out: Tag[] = app.cards.map((c) => ({ key: c.key, title: c.title, kind: 'Use case' }));
    const get = async (path: string, kind: string, key: (x: any) => string) => {
      try {
        const rows = await api<any[]>(path);
        for (const x of Array.isArray(rows) ? rows : ((rows as any).rows ?? []))
          out.push({ key: key(x), title: x.title, kind });
      } catch {
        /* module off or no access: skip */
      }
    };
    await Promise.all([
      get(`/engagements/${app.engagementId}/risks`, 'Risk', (x) => x.key ?? `R-${x.number}`),
      get(`/engagements/${app.engagementId}/controls`, 'Control', (x) => x.key ?? `C-${x.number}`),
      get(`/engagements/${app.engagementId}/issues`, 'Issue', (x) => x.key ?? `I-${x.number}`),
    ]);
    tags.value = out;
  }
  const tagMatches = computed(() => {
    if (tagQuery.value === null) return [];
    const q = tagQuery.value.toLowerCase();
    return tags.value
      .filter((t) => !q || t.key.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))
      .slice(0, 8);
  });
  function onInput() {
    const el = box.value;
    if (!el) return;
    const before = question.value.slice(0, el.selectionStart ?? question.value.length);
    const m = before.match(/(?:^|\s)@([\w-]{0,20})$/);
    if (m) {
      tagQuery.value = m[1];
      tagIndex.value = 0;
      void loadTags();
    } else tagQuery.value = null;
  }
  function pickTag(t: Tag) {
    const el = box.value!;
    const pos = el.selectionStart ?? question.value.length;
    const before = question.value.slice(0, pos).replace(/@([\w-]{0,20})$/, `@${t.key} `);
    question.value = before + question.value.slice(pos);
    tagQuery.value = null;
    void nextTick(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  }
  function onKey(ev: KeyboardEvent) {
    if (tagQuery.value !== null && tagMatches.value.length) {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        tagIndex.value = (tagIndex.value + 1) % tagMatches.value.length;
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        tagIndex.value = (tagIndex.value + tagMatches.value.length - 1) % tagMatches.value.length;
        return;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') {
        ev.preventDefault();
        pickTag(tagMatches.value[tagIndex.value]);
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        tagQuery.value = null;
        return;
      }
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void send();
    }
  }

  return { tags, tagQuery, tagIndex, tagMatches, onInput, pickTag, onKey };
}
