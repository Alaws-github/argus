<script setup lang="ts">
// Upload controls from a CSV or Excel file. Shows a preview first (nothing is
// saved), with the reason for any row that can't be added, then adds the rest.
import { ref } from 'vue';
import { useApp } from '../stores/app';
import { api, downloadText } from '../api';
import Icon from './Icon.vue';

const emit = defineEmits<{ close: []; done: [] }>();
const app = useApp();
const file = ref<File | null>(null);
const fileEl = ref<HTMLInputElement | null>(null);
const preview = ref<any>(null);
const busy = ref(false);
const error = ref('');

const TEMPLATE = [
  'Title,Objective,Type,Frequency,Owner,Use case,Library code,Risks',
  '"Human review of declined applications","A trained officer reviews every AI decline before the customer is told",preventive,per decision,Head of Retail Credit,AI-1,OVS-01,R-1',
  '"Quarterly bias test of the scoring model","Compare approval rates across groups each quarter and report gaps above 5 points",detective,quarterly,Model Risk Manager,AI-1,,R-2; R-3',
].join('\n');

const b64 = (f: File) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => fail(r.error);
  r.readAsDataURL(f);
});

async function choose() {
  file.value = fileEl.value?.files?.[0] ?? null;
  preview.value = null;
  error.value = '';
  if (!file.value) return;
  if (file.value.size > 10 * 1024 * 1024) { error.value = 'The file is over 10 MB.'; return; }
  busy.value = true;
  try {
    preview.value = await api(`/engagements/${app.engagementId}/controls/import`, { method: 'POST', body: { filename: file.value.name, dataBase64: await b64(file.value), preview: true } });
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function add() {
  if (!file.value) return;
  busy.value = true;
  try {
    const r = await api<{ added: string[]; skipped: unknown[] }>(`/engagements/${app.engagementId}/controls/import`, { method: 'POST', body: { filename: file.value.name, dataBase64: await b64(file.value), preview: false } });
    app.toast(`${r.added.length} control${r.added.length === 1 ? '' : 's'} added${r.skipped.length ? `; ${r.skipped.length} row${r.skipped.length === 1 ? '' : 's'} skipped` : ''}`);
    emit('done');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="backdrop" @click="emit('close')" />
  <div class="modal" style="width: min(860px, calc(100vw - 24px))" role="dialog" aria-label="Upload controls" @keydown.esc="emit('close')">
    <div class="spread"><h2>Upload Controls</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="emit('close')">✕</button></div>
    <p class="small muted">Add many controls at once from a CSV or Excel file: one control per row. <strong>Title</strong> is required; the other columns are optional. Use case is a key such as AI-1, Risks are keys such as R-2 (separate several with ;), and Library code links a control from the library so its standards come with it.</p>
    <div class="row" style="flex-wrap: wrap">
      <button class="btn" @click="downloadText('controls-template.csv', TEMPLATE, 'text/csv')"><Icon name="download" />Download Template</button>
      <span class="file-pick"><label class="btn primary"><input ref="fileEl" type="file" accept=".csv,.xlsx" class="sr-only" @change="choose" /><Icon name="upload" />Choose File</label><span class="small" :class="file ? '' : 'faint'">{{ file?.name ?? 'CSV or Excel (.xlsx)' }}</span></span>
    </div>
    <p v-if="busy" class="small muted">Reading…</p>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="preview">
      <div v-for="p in preview.problems" :key="p" class="notice warn small">{{ p }}</div>
      <p class="small"><strong>{{ preview.willAdd }}</strong> of {{ preview.rows.length }} rows will be added.<template v-if="preview.willAdd < preview.rows.length"> The others are marked below; fix them in the file and choose it again, or add the rest now.</template></p>
      <div class="table-wrap" style="max-height: 340px; overflow: auto">
        <table>
          <thead><tr><th>Row</th><th>Title</th><th>Type</th><th>Owner</th><th>Use case</th><th>Risks</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in preview.rows" :key="r.row">
              <td class="mono">{{ r.row }}</td><td>{{ r.title }}</td><td>{{ r.type }}</td><td>{{ r.owner }}</td><td class="mono">{{ r.useCase }}</td><td class="mono">{{ r.risks.join(', ') }}</td>
              <td><span v-if="r.ok" class="pill green"><span class="dot" />Ready</span><span v-else class="small" style="color: var(--danger)">{{ r.why }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="row" style="justify-content: flex-end">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="busy || !preview.willAdd" @click="add">Add {{ preview.willAdd }} Control{{ preview.willAdd === 1 ? '' : 's' }}</button>
      </div>
    </template>
  </div>
</template>
