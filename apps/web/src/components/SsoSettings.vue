<script setup lang="ts">
// Single sign-on set-up (admins). OpenID Connect with the client's identity
// provider. People still need an account here first; SSO only signs them in.
import { useUnsaved } from '../lib/unsaved';
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { useApp } from '../stores/app';

const app = useApp();
const f = ref({
  enabled: false,
  label: '',
  issuer: '',
  clientId: '',
  clientSecret: '',
  allowedDomains: '',
  passwordsForNonAdmins: true,
});
const u = useUnsaved(f);
const secretSet = ref(false);
const redirectUri = ref(`${window.location.origin}/api/auth/sso/callback`);
onMounted(async () => {
  const c = await api('/sso/config').catch(() => null);
  if (c) {
    f.value = {
      enabled: c.enabled,
      label: c.label,
      issuer: c.issuer,
      clientId: c.clientId,
      clientSecret: '',
      allowedDomains: (c.allowedDomains ?? []).join(', '),
      passwordsForNonAdmins: c.passwordsForNonAdmins,
    };
    u.mark();
    secretSet.value = c.secretSet;
  }
});
async function save() {
  try {
    const body: any = { ...f.value, allowedDomains: f.value.allowedDomains.split(/[\s,]+/).filter(Boolean) };
    if (!body.clientSecret) delete body.clientSecret;
    const r = await api('/sso/config', { method: 'PUT', body });
    redirectUri.value = r.redirectUri;
    if (f.value.clientSecret) secretSet.value = true;
    f.value.clientSecret = '';
    u.mark();
    app.toast(f.value.enabled ? 'Single sign-on is on' : 'Saved; single sign-on is off');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
</script>

<template>
  <form class="card" style="gap: 10px; margin-top: 16px" @submit.prevent="save">
    <h2>Single sign-on</h2>
    <p class="small muted"
      >Let people sign in with the client's or your firm's identity provider (Microsoft Entra ID, Google Workspace, Okta
      or any OpenID Connect provider). Each person still needs an account here, matched by email, and their role is
      still set here. This is a first version: no SAML, and signing out here doesn't sign them out of the provider.</p
    >
    <p class="small"
      >Register this address with the provider as the redirect URI: <span class="mono">{{ redirectUri }}</span></p
    >
    <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px">
      <label class="field"
        ><span>Button label</span><input v-model="f.label" class="input" placeholder="e.g. Microsoft"
      /></label>
      <label class="field"
        ><span>Issuer URL</span
        ><input
          v-model="f.issuer"
          class="input mono"
          placeholder="https://login.microsoftonline.com/TENANT/v2.0"
          required
      /></label>
      <label class="field"><span>Client ID</span><input v-model="f.clientId" class="input mono" required /></label>
      <label class="field"
        ><span>Client secret</span
        ><input
          v-model="f.clientSecret"
          type="password"
          class="input mono"
          autocomplete="off"
          :placeholder="secretSet ? 'Saved. Leave empty to keep it.' : 'From the provider'"
      /></label>
      <label class="field"
        ><span>Allowed email domains</span
        ><input v-model="f.allowedDomains" class="input" placeholder="firm.example, client.example (empty: any)"
      /></label>
    </div>
    <label class="row small" style="gap: 6px"
      ><input v-model="f.passwordsForNonAdmins" type="checkbox" /> People other than admins may still sign in with a
      password</label
    >
    <label class="row small" style="gap: 6px"
      ><input v-model="f.enabled" type="checkbox" /> Turn on single sign-on</label
    >
    <div><button class="btn primary" :disabled="!u.dirty.value">Save</button></div>
  </form>
</template>
