<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { AuditEntry } from '@gh/shared';
import { api, socket } from '../api';

const rows = ref<AuditEntry[]>([]);
const check = ref<{ ok: boolean; message: string } | null>(null);
async function verify() {
  check.value = await api('/audit/verify');
}
const load = async () => (rows.value = await api('/audit?limit=500'));
onMounted(() => {
  void load();
  socket.on('audit', load);
});
onBeforeUnmount(() => socket.off('audit', load));

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const detail = (d: Record<string, unknown>) =>
  Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Audit trail</h1>
        <p>Every action by a person or an agent, written in the same transaction as the change. Each entry carries the hash of the one before it, so an edited or deleted entry breaks the chain.</p>
      </div>
      <div class="stack" style="align-items: flex-end; gap: 6px">
        <button class="btn" @click="verify">Verify the chain</button>
        <span v-if="check" class="small" :class="check.ok ? '' : 'error'" :style="check.ok ? 'color: var(--ok)' : ''">{{ check.message }}</span>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>On</th><th>Detail</th></tr></thead>
        <tbody>
          <tr v-for="a in rows" :key="a.id">
            <td class="faint" style="white-space: nowrap">{{ when(a.at) }}</td>
            <td>{{ a.actor }}</td>
            <td class="mono">{{ a.action }}</td>
            <td class="mono">{{ a.entity }}</td>
            <td class="small muted">{{ detail(a.detail) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
