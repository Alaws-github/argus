<script setup lang="ts">
// v1.7.3: pipelines push evidence (Settings > Connected tools). A lead
// creates an ingest token; a CI/CD job posts eval results, fairness metrics,
// drift reports or an SBOM with it. The token is shown once.
import { computed, onMounted, ref, watch } from 'vue';
import type { IngestToken } from '@gh/shared';
import { api, ago } from '../../api';
import { useApp } from '../../stores/app';
import AppIcon from '../../components/AppIcon.vue';

const props = defineProps<{ controls: { id: string; key: string; title: string }[] }>();
const app = useApp();
const list = ref<IngestToken[]>([]);
const form = ref<null | { name: string; controlId: string }>(null);
const made = ref<{ token: string; name: string } | null>(null);
const ci = ref<'github' | 'gitlab' | 'bitbucket' | 'azure' | 'curl'>('github');
const canEdit = computed(() => app.can('manage_engagement'));
const origin = typeof location !== 'undefined' ? location.origin : '';

async function load() {
  if (app.engagementId) list.value = await api(`/engagements/${app.engagementId}/ingest-tokens`);
}
onMounted(() => load().catch(() => {}));
watch(
  () => app.engagementId,
  () => load().catch(() => {}),
);

async function create() {
  try {
    const r = await api<any>(`/engagements/${app.engagementId}/ingest-tokens`, {
      method: 'POST',
      body: { name: form.value!.name, controlId: form.value!.controlId || null },
    });
    made.value = { token: r.token, name: r.name };
    form.value = null;
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function revoke(t: IngestToken) {
  if (!confirm(`Revoke ${t.key} ${t.name}? Pipelines using it will be refused from now on.`)) return;
  try {
    await api(`/ingest-tokens/${t.id}`, { method: 'DELETE' });
    await load();
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    app.toast('Copied');
  } catch {
    app.toast("Couldn't copy here", 'error');
  }
}

const snippet = computed(() => {
  const url = `${origin}/api/ingest/evidence`;
  switch (ci.value) {
    case 'github':
      return `# .github/workflows/model-eval.yml (a step after your evaluation job)
- name: Push evaluation results to ARGUS
  env:
    ARGUS_TOKEN: \${{ secrets.ARGUS_INGEST_TOKEN }}
  run: |
    REPORT=$(jq -Rs . < eval-results.json)
    curl -fsS -X POST ${url} \\
      -H "Authorization: Bearer $ARGUS_TOKEN" -H "Content-Type: application/json" \\
      -d "{\\"title\\":\\"Model evaluation $GITHUB_SHA\\",\\"kind\\":\\"eval\\",\\"filename\\":\\"eval.json\\",\\"content\\":$REPORT,\\"source\\":{\\"system\\":\\"github\\",\\"repo\\":\\"$GITHUB_REPOSITORY\\",\\"commit\\":\\"$GITHUB_SHA\\",\\"run\\":\\"$GITHUB_RUN_ID\\"}}"`;
    case 'gitlab':
      return `# .gitlab-ci.yml
push_to_argus:
  stage: .post
  script:
    - REPORT=$(jq -Rs . < eval-results.json)
    - >
      curl -fsS -X POST ${url}
      -H "Authorization: Bearer $ARGUS_INGEST_TOKEN" -H "Content-Type: application/json"
      -d "{\\"title\\":\\"Model evaluation $CI_COMMIT_SHORT_SHA\\",\\"kind\\":\\"eval\\",\\"filename\\":\\"eval.json\\",\\"content\\":$REPORT,\\"source\\":{\\"system\\":\\"gitlab\\",\\"repo\\":\\"$CI_PROJECT_PATH\\",\\"commit\\":\\"$CI_COMMIT_SHA\\",\\"run\\":\\"$CI_PIPELINE_ID\\"}}"`;
    case 'bitbucket':
      return `# bitbucket-pipelines.yml (a step after your evaluation)
- step:
    name: Push evaluation results to ARGUS
    script:
      - REPORT=$(jq -Rs . < eval-results.json)
      - curl -fsS -X POST ${url} -H "Authorization: Bearer $ARGUS_INGEST_TOKEN" -H "Content-Type: application/json" -d "{\\"title\\":\\"Model evaluation $BITBUCKET_COMMIT\\",\\"kind\\":\\"eval\\",\\"filename\\":\\"eval.json\\",\\"content\\":$REPORT,\\"source\\":{\\"system\\":\\"bitbucket\\",\\"repo\\":\\"$BITBUCKET_REPO_FULL_NAME\\",\\"commit\\":\\"$BITBUCKET_COMMIT\\",\\"run\\":\\"$BITBUCKET_BUILD_NUMBER\\"}}"`;
    case 'azure':
      return `# azure-pipelines.yml
- script: |
    REPORT=$(jq -Rs . < eval-results.json)
    curl -fsS -X POST ${url} -H "Authorization: Bearer $(ARGUS_INGEST_TOKEN)" -H "Content-Type: application/json" -d "{\\"title\\":\\"Model evaluation $(Build.SourceVersion)\\",\\"kind\\":\\"eval\\",\\"filename\\":\\"eval.json\\",\\"content\\":$REPORT,\\"source\\":{\\"system\\":\\"azure-devops\\",\\"repo\\":\\"$(Build.Repository.Name)\\",\\"commit\\":\\"$(Build.SourceVersion)\\",\\"run\\":\\"$(Build.BuildId)\\"}}"
  displayName: Push evaluation results to ARGUS`;
    default:
      return `curl -fsS -X POST ${url} \\
  -H "Authorization: Bearer argus_ing_..." -H "Content-Type: application/json" \\
  -d '{"title":"Fairness check, release 2.3","kind":"fairness","useCase":"${app.engagement?.prefix ?? 'AI'}-1","control":"C-1",
       "content":"approval rate gap by age band: 2.1%","metrics":{"approvalGapPct":2.1,"passed":true},
       "source":{"system":"manual","run":"2.3"}}'`;
  }
});
</script>

<template>
  <section class="card">
    <div class="spread"><h2>Pipelines</h2><span class="small faint">Evidence pushed from CI/CD</span></div>
    <p class="small muted"
      >Let the client's build pipelines (GitHub Actions, GitLab CI, Bitbucket Pipelines, Azure DevOps or any other) push
      evidence straight in: evaluation results, fairness metrics, drift reports, test reports, model cards, an SBOM.
      Each push becomes a fingerprinted evidence item for a control and a use case, recorded as the pipeline, not a
      person. A token can only add evidence to this engagement; it can't read or change anything. For files that stay in
      AWS S3, Azure Blob Storage, SharePoint, OneDrive, Google Drive, GitHub, GitLab, Bitbucket, Jira, ServiceNow or
      Confluence, add a connector above instead.</p
    >

    <div v-if="made" class="callout">
      <strong>Copy the token for {{ made.name }} now. It won't be shown again.</strong>
      <div class="row"
        ><code class="mono token">{{ made.token }}</code
        ><button class="btn sm" @click="copy(made.token)"><AppIcon name="copy" :size="13" />Copy</button
        ><button class="btn ghost sm" @click="made = null">Done</button></div
      >
      <span class="small faint"
        >Store it as a secret in the pipeline (for example ARGUS_INGEST_TOKEN), never in the code.</span
      >
    </div>

    <div v-if="list.length" class="table-wrap">
      <table>
        <thead
          ><tr><th>Key</th><th>Token</th><th>Files against</th><th>Used</th><th v-if="canEdit"></th></tr
        ></thead>
        <tbody>
          <tr v-for="t in list" :key="t.id" :class="{ faint: t.revokedAt }">
            <td class="mono">{{ t.key }}</td>
            <td
              >{{ t.name }} <span class="mono faint small">{{ t.hint }}</span><div class="small faint"
                >Made by {{ t.createdBy }} {{ ago(t.createdAt)
                }}{{ t.revokedAt ? ` · revoked ${ago(t.revokedAt)}` : '' }}</div
              ></td
            >
            <td class="mono small">{{ t.controlKey ?? 'The control each push names' }}</td>
            <td class="small">{{
              t.uses ? `${t.uses} push${t.uses === 1 ? '' : 'es'}, last ${ago(t.lastUsedAt!)}` : 'Not yet'
            }}</td>
            <td v-if="canEdit"><button v-if="!t.revokedAt" class="btn ghost sm" @click="revoke(t)">Revoke</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="canEdit" class="row"
      ><button class="btn sm" @click="form = { name: '', controlId: '' }"
        ><AppIcon name="plus" :size="13" />Create an ingest token</button
      ></div
    >

    <details class="snippet">
      <summary class="small">How a pipeline sends evidence</summary>
      <div class="segmented" style="margin: 8px 0">
        <button
          v-for="(l, k) in {
            github: 'GitHub Actions',
            gitlab: 'GitLab CI',
            bitbucket: 'Bitbucket',
            azure: 'Azure DevOps',
            curl: 'curl',
          }"
          :key="k"
          type="button"
          :class="{ on: ci === k }"
          @click="ci = k"
          >{{ l }}</button
        >
      </div>
      <pre class="mono small code">{{ snippet }}</pre>
      <p class="small faint"
        >Fields: title, kind (eval, fairness, drift, sbom, test_report, model_card, other), useCase (AI-1), control
        (C-1), content (text or JSON) or contentBase64 with filename and mime (PDF, Excel, Word), url, source (system,
        repo, branch, commit, run, pipelineUrl) and metrics (name: number). Up to 10 MB.</p
      >
    </details>

    <template v-if="form">
      <div class="backdrop" @click="form = null" />
      <form class="modal" @submit.prevent="create">
        <div class="spread"
          ><h2>Create an ingest token</h2
          ><button type="button" class="btn ghost sm" aria-label="Close" @click="form = null">✕</button></div
        >
        <label class="field"
          ><span>Name</span
          ><input v-model="form.name" class="input" required minlength="3" placeholder="For example: Credit model CI"
        /></label>
        <label class="field"
          ><span>File against <span class="faint">optional</span></span
          ><select v-model="form.controlId" class="select"
            ><option value="">The control each push names</option
            ><option v-for="c in props.controls" :key="c.id" :value="c.id">{{ c.key }} {{ c.title }}</option></select
          ></label
        >
        <div class="row"
          ><button class="btn primary" :disabled="form.name.trim().length < 3">Create</button
          ><button type="button" class="btn" @click="form = null">Cancel</button></div
        >
      </form>
    </template>
  </section>
</template>

<style scoped>
.callout {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--accent-line);
  border-radius: 12px;
  background: var(--accent-bg);
}
.token {
  word-break: break-all;
  font-size: 12px;
}
.code {
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--surface-2, var(--surface));
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
  overflow: auto;
  max-height: 320px;
}
.snippet summary {
  cursor: pointer;
}
</style>
