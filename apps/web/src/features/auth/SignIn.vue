<script setup lang="ts">
import ArgusLogo from '../../components/ArgusLogo.vue';
// First run: create the first admin. After that: sign in.
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import { useApp } from '../../stores/app';

const app = useApp();
const name = ref('');
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
// Single sign-on, when an admin has set it up. Errors come back in the address.
const sso = ref<{ enabled: boolean; label: string } | null>(null);
onMounted(async () => {
  sso.value = await api('/auth/sso').catch(() => null);
  const e = new URLSearchParams(window.location.search).get('sso_error');
  if (e) {
    error.value = e;
    window.history.replaceState({}, '', window.location.pathname);
  }
});

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (app.needsSetup)
      await api('/auth/setup', {
        method: 'POST',
        body: { name: name.value, email: email.value, password: password.value },
      });
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
      <div class="row signin-brand"
        ><ArgusLogo :size="34" /><div
          ><strong>Sign in to ARGUS</strong
          ><span class="small faint" style="display: block">Assurance, Risk &amp; Governance Unified System</span></div
        ></div
      >
      <div>
        <h1 style="font-size: 19px">{{ app.needsSetup ? 'Create the first admin' : 'Sign in' }}</h1>
        <p class="small muted" style="margin-top: 4px">
          {{
            app.needsSetup
              ? 'This account manages people, models and settings. Your name is how your approvals appear in the audit trail.'
              : 'Every approval, test review and sign-off is recorded against your name.'
          }}
        </p>
      </div>
      <label v-if="app.needsSetup" class="field"
        ><span>Full name</span><input v-model="name" class="input" autocomplete="name" required minlength="2"
      /></label>
      <label class="field"
        ><span>Email</span><input v-model="email" class="input" type="email" autocomplete="username" required
      /></label>
      <label class="field">
        <span>Password</span>
        <input
          v-model="password"
          class="input"
          type="password"
          :autocomplete="app.needsSetup ? 'new-password' : 'current-password'"
          required
          :minlength="app.needsSetup ? 10 : 1"
        />
        <span v-if="app.needsSetup" class="hint">At least 10 characters.</span>
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="btn primary" :disabled="busy">{{
        app.needsSetup ? 'Create admin and sign in' : 'Sign in'
      }}</button>
      <template v-if="!app.needsSetup && sso?.enabled">
        <div class="row small faint" style="justify-content: center">or</div>
        <a class="btn" href="/api/auth/sso/start" style="justify-content: center"
          >Sign in with {{ sso.label || 'single sign-on' }}</a
        >
      </template>
    </form>
  </main>
</template>
