<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const name = ref('');
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (app.needsSetup) await api('/auth/setup', { method: 'POST', body: { name: name.value, email: email.value, password: password.value } });
    else await api('/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
    password.value = '';
    await app.checkAuth();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="signin">
    <form class="card signin-card" @submit.prevent="submit">
      <div class="row"><span class="logo">G</span><strong>Governance Harness</strong></div>
      <div>
        <h1 style="font-size: 19px">{{ app.needsSetup ? 'Create the first admin' : 'Sign in' }}</h1>
        <p class="small muted" style="margin-top: 4px">
          {{ app.needsSetup
            ? 'This account manages people, models and settings. Your name is how your approvals appear in the audit trail.'
            : 'Every approval, test review and sign-off is recorded against your name.' }}
        </p>
      </div>
      <label v-if="app.needsSetup" class="field"><span>Full name</span><input v-model="name" class="input" autocomplete="name" required minlength="2" /></label>
      <label class="field"><span>Email</span><input v-model="email" class="input" type="email" autocomplete="username" required /></label>
      <label class="field">
        <span>Password</span>
        <input v-model="password" class="input" type="password" :autocomplete="app.needsSetup ? 'new-password' : 'current-password'" required :minlength="app.needsSetup ? 10 : 1" />
        <span v-if="app.needsSetup" class="hint">At least 10 characters.</span>
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="btn primary" :disabled="busy">{{ app.needsSetup ? 'Create admin and sign in' : 'Sign in' }}</button>
    </form>
  </main>
</template>
