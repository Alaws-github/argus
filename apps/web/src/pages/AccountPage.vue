<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ROLE_HINTS, ROLE_LABELS } from '@gh/shared';
import { api, ago, when } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const name = ref(app.user?.name ?? '');
const sessions = ref<{ id: string; current: boolean; createdAt: string; lastUsedAt: string; ip: string | null; userAgent: string }[]>([]);
const pw = ref({ current: '', next: '', confirm: '' });
const pwErr = ref('');

const loadSessions = async () => (sessions.value = await api('/auth/sessions'));
onMounted(() => void loadSessions().catch((e) => app.toast(e.message, 'error')));

async function saveName() {
  try {
    app.user = await api('/auth/me', { method: 'PATCH', body: { name: name.value } });
    app.toast('Saved your name');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function changePassword() {
  pwErr.value = '';
  if (pw.value.next !== pw.value.confirm) return (pwErr.value = "The new passwords don't match");
  try {
    await api('/auth/password', { method: 'POST', body: { current: pw.value.current, next: pw.value.next } });
    app.toast('Password changed. Sign in with the new one.');
    app.signedOut();
  } catch (e: any) {
    pwErr.value = e.message;
  }
}
async function end(id: string) {
  await api(`/auth/sessions/${id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message, 'error'));
  await loadSessions();
}
async function endAll() {
  if (!window.confirm('Sign out everywhere, including this browser?')) return;
  await api('/auth/sessions/end-all', { method: 'POST' }).catch(() => {});
  app.signedOut();
}
// A readable name for a browser from its user agent.
function browser(ua: string) {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}
</script>

<template>
  <div class="page" style="max-width: 760px">
    <div class="page-head"><div><h1>Your account</h1><p>{{ app.user?.email }} · {{ app.user && ROLE_LABELS[app.user.role] }}: {{ app.user && ROLE_HINTS[app.user.role] }}</p></div></div>

    <div class="stack" style="gap: 16px">
      <form class="card" @submit.prevent="saveName">
        <h2>Your name</h2>
        <label class="field"><span>Display name</span><input v-model="name" class="input" required minlength="2" maxlength="80" autocomplete="name" /></label>
        <p class="hint">
          Everyone sees you by this name on approvals, test reviews and the audit log. Records you signed before keep the name you used then, and still count as yours for segregation of duties.
        </p>
        <p v-if="app.user?.formerNames.length" class="small faint">Also known on older records as {{ app.user.formerNames.join(', ') }}.</p>
        <div><button class="btn primary" :disabled="name.trim() === app.user?.name || name.trim().length < 2">Save</button></div>
      </form>

      <form class="card" @submit.prevent="changePassword">
        <h2>Password</h2>
        <label class="field"><span>Current password</span><input v-model="pw.current" type="password" class="input" autocomplete="current-password" required /></label>
        <div class="split">
          <label class="field"><span>New password</span><input v-model="pw.next" type="password" class="input" autocomplete="new-password" minlength="10" required /></label>
          <label class="field"><span>Again</span><input v-model="pw.confirm" type="password" class="input" autocomplete="new-password" minlength="10" required /></label>
        </div>
        <p class="hint">At least 10 characters. Changing it signs you out everywhere.</p>
        <p v-if="pwErr" class="error" role="alert">{{ pwErr }}</p>
        <div><button class="btn">Change password</button></div>
      </form>

      <section class="card">
        <div class="spread"><h2>Where you're signed in</h2><button class="btn sm" @click="endAll">Sign out everywhere</button></div>
        <div v-for="s in sessions" :key="s.id" class="spread" style="border-top: 1px solid var(--line-soft); padding-top: 10px">
          <div>
            <div>{{ browser(s.userAgent) }} <span v-if="s.current" class="badge accent">This browser</span></div>
            <div class="small faint">From {{ s.ip ?? 'an unknown address' }} · signed in {{ when(s.createdAt) }} · active {{ ago(s.lastUsedAt) }} ago</div>
          </div>
          <button v-if="!s.current" class="btn sm" @click="end(s.id)">Sign out</button>
        </div>
        <p class="hint">A session ends after 12 hours without use, or 7 days after you signed in. Signing out everywhere ends all of them, this one too.</p>
      </section>
    </div>
  </div>
</template>
