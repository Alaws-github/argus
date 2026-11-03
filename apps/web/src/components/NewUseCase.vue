<script setup lang="ts">
// The "+ Add use case" form: the profile of a new AI use case, which lands in
// Intake for someone else to triage.
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useApp } from '../stores/app';
import { api } from '../api';

const emit = defineEmits<{ close: [] }>();
const app = useApp();
const router = useRouter();
const busy = ref(false);
const error = ref('');
const form = reactive({
  title: '',
  businessOwner: '',
  description: '',
  dataUsed: '',
  affectedPeople: '',
  autonomy: 'human_in_loop',
  vendor: '',
});

async function submit() {
  error.value = '';
  if (form.title.trim().length < 3) {
    error.value = 'Give the use case a name of at least 3 characters.';
    return;
  }
  busy.value = true;
  try {
    const card = await api(`/engagements/${app.engagementId}/cards`, { method: 'POST', body: form });
    app.toast(`${card.key} added to Intake`);
    emit('close');
    router.push({ path: '/', query: { card: card.key } });
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="backdrop" @click="emit('close')" />
  <form class="modal" @submit.prevent="submit" @keydown.esc="emit('close')">
    <div class="spread">
      <h2>Add an AI use case</h2>
      <button type="button" class="btn ghost sm" aria-label="Close" @click="emit('close')">✕</button>
    </div>
    <p class="muted small">It goes to Intake. You decide whether it goes forward to classification.</p>
    <label class="field"><span>Name</span><input v-model="form.title" class="input" placeholder="Loan pre-approval scoring" autofocus /></label>
    <label class="field"><span>Business owner</span><input v-model="form.businessOwner" class="input" placeholder="Head of Retail Credit" /></label>
    <label class="field"><span>What it does</span><textarea v-model="form.description" class="textarea" placeholder="What the AI does, who acts on its output, how often" /></label>
    <label class="field"><span>Data it uses</span><textarea v-model="form.dataUsed" class="textarea" placeholder="Name every data source. Say if any of it identifies a person." /></label>
    <label class="field"><span>People affected</span><input v-model="form.affectedPeople" class="input" placeholder="Who sees its output or is decided about" /></label>
    <div class="grid" style="grid-template-columns: 1fr 1fr">
      <label class="field">
        <span>Autonomy</span>
        <select v-model="form.autonomy" class="select">
          <option value="assistive">Assistive: a person does the work</option>
          <option value="human_in_loop">A person approves each output</option>
          <option value="human_on_loop">Acts, a person monitors</option>
          <option value="autonomous">Fully autonomous</option>
        </select>
      </label>
      <label class="field"><span>Vendor or model</span><input v-model="form.vendor" class="input" placeholder="In-house, or the vendor's name" /></label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="row" style="justify-content: flex-end">
      <button type="button" class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy">{{ busy ? 'Adding…' : 'Add to Intake' }}</button>
    </div>
  </form>
</template>
