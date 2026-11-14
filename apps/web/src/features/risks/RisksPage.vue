<script setup lang="ts">
// The risk register: inherent and residual scores, heat map, risk appetite and
// acceptance, owners and treatment.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import KpiStrip from '../../components/KpiStrip.vue';
import { riskRating, type Risk } from '@gh/shared';
import { useApp } from '../../stores/app';
import { api, socket } from '../../api';

const app = useApp();
const risks = ref<Risk[]>([]);
const status = ref<'open' | 'all'>('open');

async function load() {
  if (!app.engagementId) await app.init();
  risks.value = await api(`/engagements/${app.engagementId}/risks`);
}
onMounted(() => {
  void load();
  socket.on('risk', load);
});
onBeforeUnmount(() => socket.off('risk', load));

const shown = computed(() => risks.value.filter((r) => status.value === 'all' || r.status === 'open'));
const appetite = computed(
  () => app.engagement?.appetite ?? { maxResidual: 8, statement: '', escalateTo: 'Board Risk Committee' },
);
const residualOf = (r: Risk) => r.residualScore ?? r.score;
const aboveAppetite = computed(() =>
  risks.value.filter((r) => r.status !== 'closed' && residualOf(r) > appetite.value.maxResidual && !r.acceptedBy),
);

// Heat map: count of risks by likelihood (rows, 5 at top) and impact.
const view = ref<'inherent' | 'residual'>('inherent');
const heat = computed(() => {
  const m: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const r of risks.value) {
    if (r.status === 'closed') continue;
    const l = view.value === 'residual' ? (r.residualLikelihood ?? r.likelihood) : r.likelihood;
    const i = view.value === 'residual' ? (r.residualImpact ?? r.impact) : r.impact;
    m[5 - l][i - 1]++;
  }
  return m;
});

async function accept(r: Risk, yes: boolean) {
  await update(r, { accept: yes } as any);
}
async function saveAppetite() {
  const v = window.prompt(
    `Highest residual score accepted without escalation to the ${appetite.value.escalateTo} (1-25)`,
    String(appetite.value.maxResidual),
  );
  if (!v) return;
  const statement =
    window.prompt('Risk appetite statement (one or two sentences)', appetite.value.statement) ??
    appetite.value.statement;
  try {
    await api(`/engagements/${app.engagementId}`, {
      method: 'PATCH',
      body: { appetite: { ...appetite.value, maxResidual: Number(v), statement } },
    });
    app.toast('Risk appetite updated');
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}

async function update(r: Risk, patch: Partial<Risk> & Record<string, unknown>) {
  try {
    const next = await api<Risk>(`/risks/${r.id}`, { method: 'PATCH', body: patch });
    Object.assign(r, next);
    app.toast(`${r.key} updated`);
  } catch (e: any) {
    app.toast(e.message, 'error');
  }
}

function exportCsv() {
  const head = [
    'Key',
    'Use case',
    'Risk',
    'Category',
    'Likelihood',
    'Impact',
    'Score',
    'Rating',
    'Residual L',
    'Residual I',
    'Residual score',
    'Controls',
    'Owner',
    'Treatment',
    'Accepted by',
    'Status',
  ];
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = risks.value.map((r) =>
    [
      r.key,
      r.cardKey,
      r.title,
      r.category,
      r.likelihood,
      r.impact,
      r.score,
      riskRating(r.score),
      r.residualLikelihood ?? '',
      r.residualImpact ?? '',
      r.residualScore ?? '',
      r.controlCount,
      r.owner,
      r.treatment,
      r.acceptedBy ?? '',
      r.status,
    ]
      .map(esc)
      .join(','),
  );
  const blob = new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `risk-register-${app.engagement?.slug ?? 'engagement'}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Risk register</h1>
        <p
          >Inherent risk from approved classifications, residual risk after controls, and who accepted what's left.
          Every change goes in the audit trail.</p
        >
      </div>
      <button class="btn" :disabled="!risks.length" @click="exportCsv">Download CSV</button>
    </div>
    <KpiStrip page="risks" />
    <div class="split" style="margin-bottom: 16px; align-items: stretch">
      <div class="card">
        <div class="spread">
          <h2>Heat map</h2>
          <div class="segmented">
            <button :class="{ on: view === 'inherent' }" @click="view = 'inherent'">Inherent</button>
            <button :class="{ on: view === 'residual' }" @click="view = 'residual'">After controls</button>
          </div>
        </div>
        <div class="heat" role="table" :aria-label="`${view} risk heat map`">
          <template v-for="(row, ri) in heat" :key="ri">
            <span class="axis">{{ 5 - ri }}</span>
            <span
              v-for="(n, ci) in row"
              :key="ci"
              class="cell"
              :class="[
                riskRating((5 - ri) * (ci + 1)),
                { empty: !n, over: (5 - ri) * (ci + 1) > appetite.maxResidual },
              ]"
              :title="`Likelihood ${5 - ri}, impact ${ci + 1}: ${n} risk${n === 1 ? '' : 's'}`"
              >{{ n || '' }}</span
            >
          </template>
          <span /><span v-for="n in 5" :key="n" class="axis">{{ n }}</span>
        </div>
        <span class="small faint">Likelihood up, impact across. Outlined cells are above appetite.</span>
      </div>
      <div class="card">
        <div class="spread"
          ><h2>Risk appetite</h2
          ><button v-if="app.can('manage_engagement')" class="btn sm" @click="saveAppetite">Change</button></div
        >
        <p class="small"
          >Residual scores up to <strong>{{ appetite.maxResidual }}</strong> can be accepted by a reviewer. Anything
          higher needs a lead, on behalf of the {{ appetite.escalateTo }}.</p
        >
        <p v-if="appetite.statement" class="small muted">{{ appetite.statement }}</p>
        <div class="notice" :class="aboveAppetite.length ? 'danger' : ''" style="padding: 10px 12px">
          <span class="small">{{
            aboveAppetite.length
              ? `${aboveAppetite.length} risk${aboveAppetite.length === 1 ? ' is' : 's are'} above appetite and not accepted: ${aboveAppetite.map((r) => r.key).join(', ')}`
              : 'Nothing above appetite is left unaccepted.'
          }}</span>
        </div>
      </div>
    </div>

    <div class="toolbar">
      <div class="filters">
        <button class="filter" :class="{ active: status === 'open' }" @click="status = 'open'"
          >Open<span class="count">{{ risks.filter((r) => r.status === 'open').length }}</span></button
        >
        <button class="filter" :class="{ active: status === 'all' }" @click="status = 'all'"
          >All<span class="count">{{ risks.length }}</span></button
        >
      </div>
      <span class="small faint">Score = likelihood × impact, 1 to 25. 20+ critical, 12+ high, 6+ medium.</span>
    </div>

    <div v-if="!shown.length" class="card empty">
      <h2>No risks yet</h2>
      <p>Risks arrive here when you approve a use case's classification on the board.</p>
    </div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr
            ><th>Key</th><th>Risk</th><th>Use case</th><th class="num" title="Likelihood">L</th
            ><th class="num" title="Impact">I</th><th class="num">Score</th><th class="num">Controls</th
            ><th class="num" title="Likelihood after controls">L after</th
            ><th class="num" title="Impact after controls">I after</th><th class="num">After controls</th><th>Owner</th
            ><th>Treatment</th><th>Accepted</th><th>Status</th></tr
          >
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id">
            <td class="mono faint">{{ r.key }}</td>
            <td style="min-width: 240px"
              >{{ r.title }}<div class="small faint">{{ r.category.replace('_', ' ') }} · {{ r.rationale }}</div></td
            >
            <td
              ><RouterLink class="mono" :to="{ path: '/', query: { card: r.cardKey } }">{{ r.cardKey }}</RouterLink></td
            >
            <td class="num">
              <select
                class="select n"
                :value="r.likelihood"
                :aria-label="`${r.key} likelihood`"
                @change="update(r, { likelihood: Number(($event.target as HTMLSelectElement).value) })"
              >
                <option v-for="n in 5" :key="n" :value="n">{{ n }}</option>
              </select>
            </td>
            <td class="num">
              <select
                class="select n"
                :value="r.impact"
                :aria-label="`${r.key} impact`"
                @change="update(r, { impact: Number(($event.target as HTMLSelectElement).value) })"
              >
                <option v-for="n in 5" :key="n" :value="n">{{ n }}</option>
              </select>
            </td>
            <td class="num"
              ><span class="score" :class="riskRating(r.score)">{{ r.score }}</span></td
            >
            <td class="num"
              ><RouterLink :to="{ path: '/controls/register' }">{{ r.controlCount }}</RouterLink></td
            >
            <td class="num">
              <select
                class="select n"
                :value="r.residualLikelihood ?? ''"
                :aria-label="`${r.key} residual likelihood`"
                @change="update(r, { residual_likelihood: Number(($event.target as HTMLSelectElement).value) })"
              >
                <option value="" disabled>–</option
                ><option v-for="n in 5" :key="n" :value="n">{{ n }}</option>
              </select>
            </td>
            <td class="num">
              <select
                class="select n"
                :value="r.residualImpact ?? ''"
                :aria-label="`${r.key} residual impact`"
                @change="update(r, { residual_impact: Number(($event.target as HTMLSelectElement).value) })"
              >
                <option value="" disabled>–</option
                ><option v-for="n in 5" :key="n" :value="n">{{ n }}</option>
              </select>
            </td>
            <td class="num"
              ><span v-if="r.residualScore" class="score" :class="riskRating(r.residualScore)">{{
                r.residualScore
              }}</span
              ><span v-else class="faint">—</span></td
            >
            <td
              ><input
                class="input"
                style="min-width: 150px; padding: 4px 8px"
                :value="r.owner"
                :aria-label="`${r.key} owner`"
                @change="update(r, { owner: ($event.target as HTMLInputElement).value })"
            /></td>
            <td>
              <select
                class="select"
                :value="r.treatment"
                :aria-label="`${r.key} treatment`"
                @change="update(r, { treatment: ($event.target as HTMLSelectElement).value as Risk['treatment'] })"
              >
                <option value="mitigate">Mitigate</option
                ><option value="accept">Accept</option
                ><option value="transfer">Transfer</option
                ><option value="avoid">Avoid</option>
              </select>
            </td>
            <td class="small" style="min-width: 120px">
              <template v-if="r.acceptedBy"
                >{{ r.acceptedBy
                }}<button v-if="app.can('approve')" class="btn ghost sm" @click="accept(r, false)"
                  >Withdraw</button
                ></template
              >
              <button
                v-else-if="app.can('approve')"
                class="btn sm"
                :class="{ danger: residualOf(r) > appetite.maxResidual }"
                :title="residualOf(r) > appetite.maxResidual ? 'Above appetite: needs a lead' : ''"
                @click="accept(r, true)"
                >Accept</button
              >
              <span v-else class="faint">—</span>
            </td>
            <td>
              <select
                class="select"
                :value="r.status"
                :aria-label="`${r.key} status`"
                @change="update(r, { status: ($event.target as HTMLSelectElement).value as Risk['status'] })"
              >
                <option value="open">Open</option
                ><option value="treated">Treated</option
                ><option value="closed">Closed</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
