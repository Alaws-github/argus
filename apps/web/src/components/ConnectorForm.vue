<script setup lang="ts">
// The connector form (v1.7.2), used in Settings > Connected tools and, in
// place, from a workflow step. Picking a tool fills in its usual read address
// and sign-in and says what the client's IT team must set up. Credentials are
// write-only: they're sent once, encrypted, and never shown again.
import { computed, onMounted, ref } from 'vue';
import { BUSINESS_TOOLS, TOOL_GROUPS, toolById, type Connector, type EngagementControl } from '@gh/shared';
import { api } from '../api';
import { useApp } from '../stores/app';
import { useUnsaved } from '../lib/unsaved';

const props = defineProps<{ editing?: Connector | null; tool?: string; controls?: EngagementControl[]; controlId?: string | null }>();
const emit = defineEmits<{ saved: [c: Connector]; close: [] }>();
const app = useApp();
const controls = ref<EngagementControl[]>(props.controls ?? []);
onMounted(async () => {
  if (!props.controls) controls.value = await api<EngagementControl[]>(`/engagements/${app.engagementId}/controls`).catch(() => []);
});

const editing = computed(() => props.editing ?? null);
const blank = () => ({ name: '', url: '', auth: 'none', headerName: '', secret: '', controlId: props.controlId ?? '', schedule: 'manual', tool: '' });
const c0 = props.editing;
const form = ref(c0 ? { name: c0.name, url: c0.url, auth: c0.auth as string, headerName: c0.headerName, secret: '', controlId: c0.controlId ?? '', schedule: c0.schedule as string, tool: c0.tool ?? '' } : blank());
// Microsoft 365 sign-in is three values, sent as one encrypted secret.
const ms = ref({ tenantId: '', clientId: '', clientSecret: '' });
const aws = ref({ accessKeyId: '', secretAccessKey: '', region: '' }); // v1.7.3: S3 reads signed with AWS Signature Version 4
const u = useUnsaved(form);
const tool = computed(() => toolById(form.value.tool));
function pick(id: string) {
  const t = toolById(id);
  form.value.tool = id;
  if (!t?.read) return;
  if (!form.value.name) form.value.name = `${t.name} export`;
  if (!form.value.url || /[{}]/.test(form.value.url) || BUSINESS_TOOLS.some((x) => x.read?.url === form.value.url)) form.value.url = t.read.url;
  form.value.auth = t.read.auth;
  if (t.read.headerName) form.value.headerName = t.read.headerName;
}
if (!c0 && props.tool) pick(props.tool);
// The client's own tools come first.
const mine = computed(() => new Set(app.engagement?.clientTools ?? []));
const ordered = computed(() => BUSINESS_TOOLS.filter((t) => t.read).map((t) => (mine.value.has(t.id) ? { ...t, group: "This client's tools" } : t)));
const groups = computed(() => [...(mine.value.size ? ["This client's tools"] : []), ...TOOL_GROUPS]);
const busy = ref(false);
async function save() {
  busy.value = true;
  try {
    const body: any = { ...form.value, controlId: form.value.controlId || null };
    if (body.auth === 'azure_ad' && (ms.value.tenantId || ms.value.clientId || ms.value.clientSecret)) body.secret = JSON.stringify(ms.value);
    if (body.auth === 'aws_sigv4' && (aws.value.accessKeyId || aws.value.secretAccessKey || aws.value.region)) body.secret = JSON.stringify(aws.value);
    if (!body.secret) delete body.secret;
    const c = editing.value
      ? await api<Connector>(`/connectors/${editing.value.id}`, { method: 'PATCH', body })
      : await api<Connector>(`/engagements/${app.engagementId}/connectors`, { method: 'POST', body });
    app.toast(editing.value ? `${c.key} saved` : `${c.key} added. Pull now to check it works.`);
    emit('saved', c);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="backdrop" @click="emit('close')" />
  <form class="modal" @submit.prevent="save">
    <div class="spread"><h2>{{ editing ? `Edit ${editing.key}` : 'Add a connector' }}</h2><button type="button" class="btn ghost sm" aria-label="Close" @click="emit('close')">✕</button></div>
    <div class="field">
      <span>Which tool <span v-if="mine.size" class="faint">this client's tools first ({{ ordered.filter((t) => mine.has(t.id)).map((t) => t.name).join(", ") }})</span></span>
      <div class="tool-grid" role="radiogroup" aria-label="Which tool">
        <button type="button" :class="{ on: !form.tool }" role="radio" :aria-checked="!form.tool" @click="form.tool = ''"><i class="tool-mono" style="background: var(--muted)">↗</i>A report link</button>
        <template v-for="g in groups" :key="g"><button v-for="t in ordered.filter((x) => x.group === g)" :key="t.id" type="button" :class="{ on: form.tool === t.id }" role="radio" :aria-checked="form.tool === t.id" :title="g" @click="pick(t.id)"><i class="tool-mono" :style="{ background: t.color }">{{ t.mono }}</i>{{ t.name }}</button></template>
      </div>
      <span v-if="tool?.read" class="hint">{{ tool.read.help }}</span>
    </div>
    <label class="field"><span>Name</span><input v-model="form.name" class="input" required minlength="3" placeholder="e.g. Loan decisions export" /></label>
    <label class="field"><span>Address</span><input v-model="form.url" class="input mono" required placeholder="https://reports.client.example/loan-decisions.csv" /><span class="hint">{{ tool?.read ? 'Replace the {…} parts with the real ids. ARGUS only ever reads it.' : 'A report, export or file link. ARGUS only ever reads it.' }}</span></label>
    <div class="split">
      <label class="field"><span>Sign-in</span><select v-model="form.auth" class="select"><option value="none">None</option><option value="bearer">Bearer token</option><option value="header">API key in a header</option><option value="basic">User and password</option><option value="azure_ad">Microsoft Entra app (Microsoft 365)</option><option value="google_sa">Google service account</option><option value="aws_sigv4">AWS access key (S3)</option><option value="azure_sas">Azure SAS token (Blob Storage)</option></select></label>
      <label v-if="form.auth === 'header'" class="field"><span>Header name</span><input v-model="form.headerName" class="input mono" placeholder="x-api-key" /></label>
    </div>
    <div v-if="form.auth === 'azure_ad'" class="split">
      <label class="field"><span>Tenant ID</span><input v-model="ms.tenantId" class="input mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved' : ''" /></label>
      <label class="field"><span>Client ID</span><input v-model="ms.clientId" class="input mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved' : ''" /></label>
      <label class="field"><span>Client secret</span><input v-model="ms.clientSecret" type="password" class="input mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved. Leave empty to keep it.' : ''" /></label>
    </div>
    <div v-else-if="form.auth === 'aws_sigv4'" class="split">
      <label class="field"><span>Access key ID</span><input v-model="aws.accessKeyId" class="input mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved' : 'AKIA…'" /></label>
      <label class="field"><span>Region</span><input v-model="aws.region" class="input mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved' : 'us-east-1'" /></label>
      <label class="field"><span>Secret access key</span><input v-model="aws.secretAccessKey" type="password" class="input mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved. Leave empty to keep it.' : ''" /></label>
    </div>
    <label v-else-if="form.auth === 'azure_sas'" class="field"><span>SAS token (read only)</span><input v-model="form.secret" type="password" class="input mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved. Leave empty to keep it.' : 'sv=…&sp=r&se=…&sig=…'" /></label>
    <label v-else-if="form.auth === 'google_sa'" class="field"><span>Service account JSON key</span><textarea v-model="form.secret" class="textarea mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved. Leave empty to keep it.' : 'Paste the whole key file'" /></label>
    <label v-else-if="form.auth !== 'none'" class="field"><span>{{ form.auth === 'basic' ? 'user:password' : 'Token or key' }}</span><input v-model="form.secret" type="password" class="input mono" autocomplete="off" :placeholder="editing?.secretSet ? 'Saved. Leave empty to keep it.' : ''" /></label>
    <div class="split">
      <label class="field"><span>File against control</span><select v-model="form.controlId" class="select"><option value="">None</option><option v-for="c in controls" :key="c.id" :value="c.id">{{ c.key }} {{ c.title }}</option></select></label>
      <label class="field"><span>Pull</span><select v-model="form.schedule" class="select"><option value="manual">On request</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
    </div>
    <div class="row"><button class="btn primary" :disabled="busy || (!u.dirty.value && !ms.tenantId && !ms.clientSecret && !aws.accessKeyId && !aws.secretAccessKey)">Save</button><button type="button" class="btn" @click="emit('close')">Cancel</button></div>
  </form>
</template>
