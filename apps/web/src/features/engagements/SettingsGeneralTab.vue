<script setup lang="ts">
// Settings > General: the engagement's details and pause, its optional modules and the client steps
// default, and archiving, restoring or deleting it. Part of SettingsPage.vue (split out in v1.7.8).
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { MODULES, MODULE_INFO, type Engagement, type Module } from '@gh/shared';
import { useApp } from '../../stores/app';
import { api } from '../../api';

const app = useApp();
const router = useRouter();
const saving = ref(false);

async function setStepsDefault(on: boolean) {
  try {
    const e = await api(`/engagements/${app.engagementId}`, { method: 'PATCH', body: { clientStepsDefault: on } });
    Object.assign(app.engagement!, e);
    app.toast(
      on
        ? 'Use cases follow the latest published client workflow'
        : 'Use cases follow no client workflow unless one is picked',
    );
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
// Optional modules for this engagement. The core flow is always on.
async function toggleModule(m: Module) {
  try {
    const e = await api<Engagement>(`/engagements/${app.engagementId}`, {
      method: 'PATCH',
      body: { modules: { [m]: !app.mod(m) } },
    });
    Object.assign(app.engagement!, e);
    app.toast(`${MODULE_INFO[m].label} ${e.modules[m] ? 'switched on' : 'switched off'}`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}

// ------------------------------------------------------------------ General
const general = reactive({ name: '', client: '', prefix: '', framework: '', about: '', paused: false });
function resetGeneral() {
  const e = app.engagement;
  if (e)
    Object.assign(general, {
      name: e.name,
      client: e.client,
      prefix: e.prefix,
      framework: e.framework,
      about: e.about,
      paused: e.paused,
    });
}
const generalDirty = computed(() => {
  const e = app.engagement;
  return (
    !!e && (['name', 'client', 'prefix', 'framework', 'about', 'paused'] as const).some((k) => general[k] !== e[k])
  );
});
const archiveReason = ref('');
const confirmName = ref('');
const busyArchive = ref(false);
async function archive() {
  if (!window.confirm(`Archive ${app.engagement?.name}? It becomes read-only until someone restores it.`)) return;
  busyArchive.value = true;
  try {
    const e = await api<Engagement>(`/engagements/${app.engagementId}/archive`, {
      method: 'POST',
      body: { reason: archiveReason.value },
    });
    Object.assign(app.engagement!, e);
    app.toast(`${e.name} archived`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busyArchive.value = false;
  }
}
async function restore() {
  busyArchive.value = true;
  try {
    const e = await api<Engagement>(`/engagements/${app.engagementId}/restore`, { method: 'POST' });
    Object.assign(app.engagement!, e);
    app.toast(`${e.name} restored`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busyArchive.value = false;
  }
}
async function remove() {
  // Capture the id first: the server's broadcast can switch engagements before this request returns.
  const gone = app.engagementId;
  const name = app.engagement!.name;
  busyArchive.value = true;
  try {
    const r = await api(`/engagements/${gone}`, { method: 'DELETE', body: { confirm: confirmName.value } });
    app.engagements = app.engagements.filter((e) => e.id !== gone);
    if (app.engagementId === gone) await app.switchEngagement(app.active[0]?.id ?? '');
    app.toast(
      `${name} deleted: ${r.removed.cards} use cases, ${r.removed.evidence} evidence items. The audit log keeps the record.`,
    );
    router.push('/');
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    busyArchive.value = false;
  }
}

async function saveGeneral() {
  saving.value = true;
  try {
    await api(`/engagements/${app.engagementId}`, { method: 'PATCH', body: { ...general } });
    app.toast('Engagement settings saved');
  } catch (e: any) {
    app.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

resetGeneral();
</script>

<template>
  <section class="card">
    <fieldset class="bare" :disabled="!!app.engagement?.archivedAt || !app.can('manage_engagement')">
      <h2>General</h2>
      <div class="grid" style="grid-template-columns: 1fr 1fr">
        <label class="field"><span>Engagement name</span><input v-model="general.name" class="input" /></label>
        <label class="field"><span>Client</span><input v-model="general.client" class="input" /></label>
        <label class="field"
          ><span>Card prefix</span><input v-model="general.prefix" class="input mono" /><span class="hint"
            >New use cases get keys like {{ general.prefix || 'AI' }}-12. Existing keys don't change.</span
          ></label
        >
        <label class="field"
          ><span>Frameworks</span><input v-model="general.framework" class="input" /><span class="hint"
            >Shown on Overview and in reports.</span
          ></label
        >
      </div>
      <label class="field">
        <span>What the engagement is</span>
        <textarea v-model="general.about" class="textarea" style="min-height: 110px" />
        <span class="hint"
          >Every agent reads this with each use case: the client's sector, regulators and anything that changes how risk
          is judged.</span
        >
      </label>
      <label class="switch" :class="{ on: general.paused }">
        <input v-model="general.paused" type="checkbox" class="sr-only" /><span class="track" />
        <span
          ><strong style="color: var(--text)">Pause this engagement</strong> No new runs start. Use cases stay where
          they are.</span
        >
      </label>
      <div class="row">
        <button class="btn primary" :disabled="!generalDirty || saving" @click="saveGeneral">Save changes</button>
        <button v-if="generalDirty" class="btn ghost" @click="resetGeneral">Discard</button>
      </div>
    </fieldset>
  </section>

  <section class="card">
    <h2>Modules</h2>
    <p class="small muted"
      >The core flow (intake, risk, controls, testing, issues, sign-off and the report, with the AI drafting each step)
      is always on. Switch on more when this engagement needs them. Switching one off hides it; nothing is deleted.</p
    >
    <div class="stack" style="gap: 8px">
      <button
        v-for="m in MODULES"
        :key="m"
        class="switch"
        :class="{ on: app.mod(m) }"
        role="switch"
        :aria-checked="app.mod(m)"
        :disabled="!app.can('manage_engagement')"
        @click="toggleModule(m)"
      >
        <span class="track" /><span style="text-align: left"
          ><strong style="color: var(--text)">{{ MODULE_INFO[m].label }}</strong>
          <span class="small muted">{{ MODULE_INFO[m].hint }}</span></span
        >
      </button>
    </div>
    <!-- v1.7.4: whether new use cases follow a client workflow; each use case can change it. -->
    <div v-if="app.mod('connectors')" class="field" style="margin-top: 12px">
      <span>Client steps on use cases</span>
      <label class="check-row"
        ><input
          type="radio"
          name="csd"
          :checked="app.engagement?.clientStepsDefault !== false"
          :disabled="!app.can('manage_engagement')"
          @change="setStepsDefault(true)"
        /><span
          ><strong>Follow the latest published client workflow</strong
          ><span class="muted small hint-inline"
            >Each use case shows the client's steps. Any use case can opt out.</span
          ></span
        ></label
      >
      <label class="check-row"
        ><input
          type="radio"
          name="csd"
          :checked="app.engagement?.clientStepsDefault === false"
          :disabled="!app.can('manage_engagement')"
          @change="setStepsDefault(false)"
        /><span
          ><strong>No client workflow</strong
          ><span class="muted small hint-inline"
            >The team works in ARGUS only. Any use case can still opt in.</span
          ></span
        ></label
      >
    </div>
  </section>

  <section v-if="app.canRaw('manage_engagement')" class="card danger-zone">
    <h2>Archive or delete</h2>
    <template v-if="!app.engagement?.archivedAt">
      <p class="small muted"
        >Archiving makes this engagement read-only and moves it to the bottom of the switcher. Nothing is removed: use
        cases, evidence, tests, issues and the audit trail all stay, and a lead can restore it at any time.</p
      >
      <label class="field"
        ><span>Reason <span class="faint">optional, goes in the audit log</span></span
        ><input v-model="archiveReason" class="input" placeholder="e.g. Engagement complete, report delivered 30 Oct"
      /></label>
      <div><button class="btn danger" :disabled="busyArchive" @click="archive">Archive this engagement</button></div>
    </template>
    <template v-else>
      <p class="small"
        >Archived {{ new Date(app.engagement.archivedAt).toLocaleString() }} by {{ app.engagement.archivedBy
        }}<template v-if="app.engagement.archiveReason">: {{ app.engagement.archiveReason }}</template
        >.</p
      >
      <div class="row" style="flex-wrap: wrap">
        <button class="btn" :disabled="busyArchive" @click="restore">Restore</button>
        <a class="btn" :href="`/api/engagements/${app.engagementId}/export`">Download the full record (JSON)</a>
      </div>
      <template v-if="app.canRaw('manage_users')">
        <div class="notice danger" style="margin-top: 6px">
          <h3>Delete permanently</h3>
          <p class="small"
            >Removes every use case, risk, control, test, piece of evidence, issue, evaluation and run in this
            engagement. It can't be undone. The audit log keeps every entry about it, and records who deleted it and
            what was removed. Download the record first if the client or a regulator may ask for it.</p
          >
          <label class="field"
            ><span
              >Type <strong>{{ app.engagement.name }}</strong> to confirm</span
            ><input v-model="confirmName" class="input" autocomplete="off"
          /></label>
          <div
            ><button
              class="btn danger"
              :disabled="confirmName.trim() !== app.engagement.name || busyArchive"
              @click="remove"
              >Delete this engagement</button
            ></div
          >
        </div>
      </template>
      <p v-else class="small faint">Only an admin can delete an engagement.</p>
    </template>
  </section>

  <div v-if="generalDirty" class="save-bar">
    <span>You have unsaved changes</span>
    <button class="btn ghost sm" @click="resetGeneral()">Discard</button>
    <button class="btn primary sm" :disabled="saving" @click="saveGeneral()">Save changes</button>
  </div>
</template>
