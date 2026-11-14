<script setup lang="ts">
// People and roles (admin only): add people, change roles, reset passwords,
// disable accounts. People are never deleted, so their approvals keep a name.
import { onMounted, ref } from 'vue';
import { ROLES, ROLE_HINTS, ROLE_LABELS, type Role, type User } from '@gh/shared';
import { api, ago } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const users = ref<User[]>([]);
const load = async () => {
  try {
    users.value = await api('/users');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
};
onMounted(load);

async function patch(u: User, body: Record<string, unknown>, msg: string) {
  try {
    Object.assign(u, await api(`/users/${u.id}`, { method: 'PATCH', body }));
    app.toast(msg);
  } catch (e: any) {
    app.toast(e.message, 'error');
    await load();
  }
}
function reset(u: User) {
  const password = window.prompt(
    `New temporary password for ${u.name} (at least 10 characters). Their sessions end now.`,
  );
  if (password) void patch(u, { password }, `Password reset for ${u.name}`);
}

const adding = ref(false);
const form = ref({ name: '', email: '', role: 'preparer' as Role, password: '' });
const err = ref('');
async function add() {
  err.value = '';
  try {
    await api('/users', { method: 'POST', body: form.value });
    adding.value = false;
    form.value = { name: '', email: '', role: 'preparer', password: '' };
    await load();
  } catch (e: any) {
    err.value = e.message;
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>People and roles</h1>
        <p
          >Who can do what. Change a person's role with the role list on their row. Segregation of duties is enforced on
          top of roles: nobody approves a use case they added, reviews a test they prepared, or signs off a report they
          scored alone.</p
        >
      </div>
      <button class="btn primary" @click="adding = true">Add person</button>
    </div>
    <div class="grid kpis" style="margin-bottom: 16px">
      <div v-for="r in ROLES" :key="r" class="tile">
        <span class="label-caps"
          >{{ ROLE_LABELS[r] }} · {{ users.filter((u) => u.role === r && !u.disabled).length }}</span
        >
        <span class="small muted">{{ ROLE_HINTS[r] }}</span>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead
          ><tr><th>Name</th><th>Email</th><th>Role</th><th>Last seen</th><th>Access</th><th /></tr
        ></thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" :style="u.disabled ? 'opacity: 0.55' : ''">
            <td
              >{{ u.name
              }}<span v-if="u.id === app.user?.id" class="badge accent" style="margin-left: 6px">You</span></td
            >
            <td class="small">{{ u.email }}</td>
            <td>
              <select
                class="select"
                :value="u.role"
                :disabled="u.id === app.user?.id"
                :aria-label="`${u.name} role`"
                @change="
                  patch(
                    u,
                    { role: ($event.target as HTMLSelectElement).value },
                    `${u.name} is now ${ROLE_LABELS[($event.target as HTMLSelectElement).value as Role]}`,
                  )
                "
              >
                <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
              </select>
            </td>
            <td class="small faint">{{ u.lastSeenAt ? `${ago(u.lastSeenAt)} ago` : 'Never' }}</td>
            <td
              ><span class="pill" :class="u.disabled ? '' : 'green'">{{ u.disabled ? 'Disabled' : 'Active' }}</span></td
            >
            <td>
              <div v-if="u.id !== app.user?.id" class="row">
                <button class="btn sm" @click="reset(u)">Reset password</button>
                <button
                  class="btn sm"
                  :class="{ danger: !u.disabled }"
                  @click="patch(u, { disabled: !u.disabled }, u.disabled ? `${u.name} enabled` : `${u.name} disabled`)"
                  >{{ u.disabled ? 'Enable' : 'Disable' }}</button
                >
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small faint" style="margin-top: 10px"
      >People are disabled, never deleted, so their name stays on the approvals they made.</p
    >

    <template v-if="adding">
      <div class="backdrop" @click="adding = false" />
      <form class="modal" @submit.prevent="add">
        <div class="spread"
          ><h2>Add a person</h2
          ><button type="button" class="btn ghost sm" aria-label="Close" @click="adding = false">✕</button></div
        >
        <label class="field"
          ><span>Full name</span><input v-model="form.name" class="input" required minlength="2" /><span class="hint"
            >Must be unique: it's how their approvals are recorded.</span
          ></label
        >
        <label class="field"
          ><span>Email</span><input v-model="form.email" type="email" class="input" required
        /></label>
        <label class="field"
          ><span>Role</span>
          <select v-model="form.role" class="select"
            ><option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}: {{ ROLE_HINTS[r] }}</option></select
          >
        </label>
        <label class="field"
          ><span>Temporary password</span
          ><input v-model="form.password" type="text" class="input" required minlength="10" autocomplete="off" /><span
            class="hint"
            >Share it with them directly. They can change it from their menu.</span
          ></label
        >
        <p v-if="err" class="error">{{ err }}</p>
        <div class="row"
          ><button class="btn primary">Add person</button
          ><button type="button" class="btn" @click="adding = false">Cancel</button></div
        >
      </form>
    </template>
  </div>
</template>
