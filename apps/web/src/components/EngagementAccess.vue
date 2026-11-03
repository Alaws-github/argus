<script setup lang="ts">
// Who can see this engagement: everyone signed in, or only its members (and
// admins). Leads and admins manage it.
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
interface Person { id: string; name: string; email: string; role: string; addedBy?: string }
const access = ref<'open' | 'members'>('open');
const members = ref<Person[]>([]);
const people = ref<Person[]>([]);
const pick = ref('');
const manage = computed(() => app.can('manage_engagement'));

async function load() {
  const r = await api(`/engagements/${await app.eid()}/members`).catch(() => null);
  if (!r) return;
  access.value = r.access;
  members.value = r.members;
  people.value = r.people;
}
onMounted(load);
const candidates = computed(() => people.value.filter((p) => !members.value.some((m) => m.id === p.id)));

async function setAccess(v: 'open' | 'members') {
  if (v === 'members' && !window.confirm('Make this engagement members-only? People who are not members (other than admins) will no longer see it. You are added as a member.')) return;
  try {
    await api(`/engagements/${app.engagementId}/access`, { method: 'PUT', body: { access: v } });
    await load();
    app.toast(v === 'members' ? 'Members only' : 'Open to everyone signed in');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function add() {
  if (!pick.value) return;
  try {
    await api(`/engagements/${app.engagementId}/members`, { method: 'POST', body: { userId: pick.value } });
    pick.value = '';
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function remove(p: Person) {
  try {
    await api(`/engagements/${app.engagementId}/members/${p.id}`, { method: 'DELETE' });
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
</script>

<template>
  <div class="card" style="gap: 10px">
    <h2>Who can see this engagement</h2>
    <div class="segmented" role="radiogroup" aria-label="Access">
      <button type="button" role="radio" :aria-checked="access === 'open'" :class="{ on: access === 'open' }" :disabled="!manage" @click="access !== 'open' && setAccess('open')">Everyone signed in</button>
      <button type="button" role="radio" :aria-checked="access === 'members'" :class="{ on: access === 'members' }" :disabled="!manage" @click="access !== 'members' && setAccess('members')">Members only</button>
    </div>
    <p class="small muted">{{ access === 'members' ? 'Only the people below, and admins, can see this engagement, its records, its audit entries and its live updates. Everyone else gets "not found".' : 'Everyone with an account can see this engagement. Use members only for confidential clients.' }}</p>
    <div v-if="members.length" class="table-wrap">
      <table>
        <thead><tr><th>Member</th><th>Role</th><th>Added by</th><th /></tr></thead>
        <tbody>
          <tr v-for="m in members" :key="m.id"><td>{{ m.name }}<div class="small faint">{{ m.email }}</div></td><td class="small">{{ m.role }}</td><td class="small faint">{{ m.addedBy }}</td><td><button v-if="manage" class="btn ghost sm" @click="remove(m)">Remove</button></td></tr>
        </tbody>
      </table>
    </div>
    <div v-if="manage" class="row">
      <select v-model="pick" class="select" style="max-width: 320px" aria-label="Person to add"><option value="">Add a member…</option><option v-for="p in candidates" :key="p.id" :value="p.id">{{ p.name }} ({{ p.role }})</option></select>
      <button class="btn sm" :disabled="!pick" @click="add">Add</button>
    </div>
  </div>
</template>
