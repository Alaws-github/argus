// The gate engine: picks up queued cards in stages with a built, enabled agent,
// runs that agent on its configured provider and model, records the run, then
// stops at the stage's gate or moves the card on.
import { AGENT_ROLES, nextStage, riskRating, type AgentConfig, type AgentRole, type Card, type Stage } from '@gh/shared';
import type { Db, Queryable } from './db.js';
import { emit } from './realtime.js';
import { logAudit } from './audit.js';
import { AGENT_SELECT, agentStages, getCard, getEngagement, getSettings, monthSpend, toAgent, toCard, toRun, RUN_SELECT } from './store.js';
import { apiKeyOf, getProviderRow, type ProviderRow } from './providers.js';
import { costUsd, priceFor } from './agents/pricing.js';
import { runRiskClassifier, RULES_VERSION as CLASSIFIER_RULES } from './agents/risk-classifier.js';
import { runControlDesigner, RULES_VERSION as DESIGNER_RULES } from './agents/control-designer.js';
import { exitCriteria } from './exit-criteria.js';
import type { AgentContext } from './agents/types.js';

export const MAX_PARALLEL = 4;
const TICK_MS = 1500;
let ticking = false;

export async function emitCard(q: Queryable, id: string) {
  const card = await getCard(q, id);
  if (card) emit('card', card);
}

async function emitRun(q: Queryable, id: string) {
  const { rows } = await q.query(`${RUN_SELECT} WHERE r.id = $1`, [id]);
  if (rows[0]) emit('run', toRun(rows[0]));
}

export function startEngine(db: Db) {
  // Close runs left "running" by a crash (Anser lesson: reconcile on startup).
  void db
    .query(`UPDATE runs SET status='failed', error='The server stopped during this run', ended_at=now() WHERE status='running'`)
    .then(() => db.query(`UPDATE cards SET status='queued' WHERE status='running'`));
  setInterval(() => void tick(db), TICK_MS);
}

function routeAllows(agent: AgentConfig, card: Card) {
  if (agent.route === 'all' || !card.tier) return true;
  if (agent.route === 'high_only') return card.tier === 'high' || card.tier === 'prohibited';
  return card.tier !== 'minimal';
}

async function tick(db: Db) {
  if (ticking) return;
  ticking = true;
  try {
    const settings = await getSettings(db);
    if (!settings.autoStart) return;
    const { rows: busy } = await db.query(`SELECT count(*)::int AS n FROM cards WHERE status = 'running'`);
    let free = MAX_PARALLEL - busy[0].n;
    if (free <= 0) return;

    const { rows } = await db.query(
      `SELECT c.* FROM cards c JOIN engagements e ON e.id = c.engagement_id
       WHERE c.status = 'queued' AND NOT e.paused ORDER BY c.updated_at ASC LIMIT 20`,
    );
    for (const row of rows) {
      if (free <= 0) break;
      const card = toCard(row);
      const { rows: a } = await db.query(`${AGENT_SELECT} WHERE a.engagement_id = $1 AND a.stage = $2 AND a.enabled`, [card.engagementId, card.stage]);
      const agent = a.map(toAgent).find((x) => x.built);
      if (!agent) {
        // Nobody to run it: hand the card to a person.
        await db.query(`UPDATE cards SET status='idle', status_note=$2, updated_at=now() WHERE id=$1`, [
          card.id,
          'No enabled agent on this stage. Turn one on in Settings > Agents, or move it on by hand.',
        ]);
        await emitCard(db, card.id);
        continue;
      }
      if (!routeAllows(agent, card)) {
        await db.query(`UPDATE cards SET status='idle', status_note=$2, updated_at=now() WHERE id=$1`, [
          card.id,
          `${agent.name} only takes ${agent.route === 'high_only' ? 'high and prohibited' : 'non-minimal'} use cases. Move this one on by hand.`,
        ]);
        await emitCard(db, card.id);
        continue;
      }
      if (agent.activeRuns >= agent.concurrency) continue;
      if (agent.providerId) {
        const p = await getProviderRow(db, agent.providerId);
        if (p?.max_concurrent) {
          const { rows: pr } = await db.query(`SELECT count(*)::int AS n FROM runs WHERE provider_id = $1 AND status = 'running'`, [p.id]);
          if (pr[0].n >= p.max_concurrent) continue; // waits for a free slot
        }
      }
      free--;
      void runCard(db, card, agent);
    }
  } catch (e) {
    console.error('[engine] tick failed', e);
  } finally {
    ticking = false;
  }
}

interface Target {
  provider: ProviderRow;
  model: string;
}

async function resolveTarget(db: Db, providerId: string | null, model: string | null): Promise<Target | string> {
  if (!providerId || !model) return 'No provider or model is set for this agent';
  const provider = await getProviderRow(db, providerId);
  if (!provider) return 'Its provider was removed';
  if (!provider.enabled) return `${provider.name} is turned off`;
  return { provider, model };
}

async function runCard(db: Db, card: Card, agent: AgentConfig) {
  const settings = await getSettings(db);
  const feedback = card.statusNote?.startsWith('Feedback: ') ? card.statusNote.slice(10) : null;

  const fail = async (message: string) => {
    await db.tx(async (q) => {
      await q.query(`UPDATE cards SET status='failed', status_note=$2, updated_at=now() WHERE id=$1`, [card.id, message]);
      await logAudit(q, agent.name, 'run.blocked', `card:${card.key}`, { reason: message });
    });
    await emitCard(db, card.id);
  };

  // Pick the primary target, or the fallback when the primary is unusable.
  const primary = await resolveTarget(db, agent.providerId, agent.model);
  const fallback = agent.fallbackModel ? await resolveTarget(db, agent.fallbackProviderId ?? agent.providerId, agent.fallbackModel) : null;
  const targets: Target[] = [];
  if (typeof primary !== 'string') targets.push(primary);
  if (fallback && typeof fallback !== 'string') targets.push(fallback);
  if (!targets.length) return fail(`${agent.name} can't run: ${typeof primary === 'string' ? primary : 'no usable model'}. Fix it in Settings > Agents or Models & keys.`);

  // Spend cap: billed providers stop at the cap when "pause at the cap" is on.
  const spent = await monthSpend(db, settings.timeZone);
  const capped = settings.pauseAtCap && settings.spendCapUsd != null && spent >= settings.spendCapUsd;
  const usable = targets.filter((t) => !(capped && t.provider.billed));
  if (!usable.length) {
    return fail(`Paused: billed AI spend this month reached the $${settings.spendCapUsd} cap. Raise it on Models & keys, or move the agent to an unbilled provider.`);
  }

  let target = usable[0];
  const runId = await db.tx(async (q) => {
    const { rows } = await q.query(
      `INSERT INTO runs (card_id, stage, agent, agent_id, provider_id, model, runtime, billed, rules_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, number`,
      [card.id, card.stage, agent.name, agent.id, target.provider.id, target.model, target.provider.type === 'rules' ? 'dry-run' : 'live', target.provider.billed,
        agent.role === 'control_designer' ? DESIGNER_RULES : CLASSIFIER_RULES],
    );
    await q.query(`UPDATE cards SET status='running', status_note=NULL, latest_run_id=$2, updated_at=now() WHERE id=$1`, [card.id, rows[0].id]);
    await logAudit(q, agent.name, 'run.started', `card:${card.key}`, { run: `R-${rows[0].number}`, stage: card.stage, model: target.model, provider: target.provider.name });
    return rows[0].id as string;
  });
  await emitCard(db, card.id);
  await emitRun(db, runId);

  const log = async (kind: 'step' | 'output' | 'error', text: string) => {
    const { rows } = await db.query(`INSERT INTO run_events (run_id, kind, text) VALUES ($1,$2,$3) RETURNING *`, [runId, kind, text]);
    emit('run:event', { runId, id: Number(rows[0].id), at: rows[0].at, kind, text });
  };

  if (capped && targets[0] !== target) await log('step', `The spend cap is reached, so this run uses the unbilled fallback ${target.model}`);

  const engagementAbout = (await getEngagement(db, card.engagementId))?.about ?? '';
  const attempt = (t: Target) => {
    const ctx: AgentContext = {
      card,
      feedback,
      provider: t.provider,
      apiKey: apiKeyOf(t.provider),
      model: t.model,
      effort: agent.effort,
      instructions: agent.instructions,
      engagementAbout: engagementAbout,
      timeoutMs: agent.timeoutMin * 60_000,
    };
    if ((agent.role as AgentRole) === 'risk_classifier') return runRiskClassifier(ctx, log);
    if ((agent.role as AgentRole) === 'control_designer') return runControlDesigner(ctx, db, log);
    throw new Error(`${AGENT_ROLES[agent.role].name} isn't built yet`);
  };

  try {
    let result: Awaited<ReturnType<typeof attempt>>;
    try {
      result = await attempt(target);
    } catch (e: any) {
      const next = usable.find((t) => t !== target);
      if (!next) throw e;
      await log('error', String(e?.message ?? e).slice(0, 500));
      await log('step', `Falling back to ${next.model} on ${next.provider.name}`);
      target = next;
      await db.query(`UPDATE runs SET provider_id=$2, model=$3, runtime=$4, billed=$5 WHERE id=$1`, [
        runId, target.provider.id, target.model, target.provider.type === 'rules' ? 'dry-run' : 'live', target.provider.billed,
      ]);
      result = await attempt(target);
    }

    const cost = target.provider.billed ? costUsd(priceFor(target.model, target.provider.prices), result.tokensIn, result.tokensOut, result.tokensCached) : 0;
    if (target.provider.billed && !priceFor(target.model, target.provider.prices)) {
      await log('step', `${target.model} has no price on Models & keys, so this run is recorded at $0`);
    }
    if (agent.maxCostUsd > 0 && cost > agent.maxCostUsd) {
      await log('step', `This run cost $${cost.toFixed(4)}, over the agent's $${agent.maxCostUsd} limit per run`);
    }

    const engagement = await getEngagement(db, card.engagementId);
    const gated = Boolean(engagement?.gates[card.stage as Stage]);
    const output: any = result.output;
    const isDesign = agent.role === 'control_designer';
    const stillRunning = await db.tx(async (q) => {
      // A kill switch may have ended this run while the model was answering.
      const { rows: live } = await q.query(`UPDATE runs SET status='succeeded', tokens_in=$2, tokens_out=$3, cost_usd=$4, ended_at=now() WHERE id=$1 AND status='running' RETURNING id`, [
        runId, result.tokensIn, result.tokensOut, cost,
      ]);
      if (!live.length) return false;
      const note = isDesign ? `Proposed ${output.controls.length} controls. Review and approve.` : `Proposed tier: ${output.tier}. Review and approve.`;
      if (isDesign) {
        await q.query(`UPDATE cards SET design=$2, cost_usd=cost_usd+$3, status=$4, status_note=$5, updated_at=now() WHERE id=$1`, [
          card.id, JSON.stringify(output), cost, gated ? 'needs_approval' : 'idle', gated ? note : null,
        ]);
      } else {
        await q.query(`UPDATE cards SET classification=$2, tier=$3, cost_usd=cost_usd+$4, status=$5, status_note=$6, updated_at=now() WHERE id=$1`, [
          card.id, JSON.stringify(output), output.tier, cost, gated ? 'needs_approval' : 'idle', gated ? note : null,
        ]);
      }
      await logAudit(q, agent.name, 'run.succeeded', `card:${card.key}`, {
        ...(isDesign ? { controls: output.controls.length, gaps: output.gaps.length } : { tier: output.tier, risks: output.risks.length }),
        costUsd: cost, model: target.model,
      });
      return true;
    });
    if (!stillRunning) {
      await emitCard(db, card.id);
      return;
    }
    emit('usage', { changed: true });
    if (!gated) await advance(db, card.id, agent.name);
  } catch (e: any) {
    const message = String(e?.name === 'TimeoutError' ? `The run passed its ${agent.timeoutMin}-minute limit` : (e?.message ?? e)).slice(0, 1000);
    await log('error', message);
    await db.tx(async (q) => {
      await q.query(`UPDATE runs SET status='failed', error=$2, ended_at=now() WHERE id=$1`, [runId, message]);
      await q.query(`UPDATE cards SET status='failed', status_note=$2, updated_at=now() WHERE id=$1`, [card.id, message]);
      await logAudit(q, agent.name, 'run.failed', `card:${card.key}`, { error: message });
    });
  }
  await emitCard(db, card.id);
  await emitRun(db, runId);
}

// Move a card to the next stage. When leaving Classify, the approved risks are
// written to the risk register in the same transaction.
export async function advance(db: Db, cardId: string, actor: string, note?: string) {
  await db.tx(async (q) => {
    const card = await getCard(q, cardId);
    if (!card) throw new Error('Card not found');
    const to = nextStage(card.stage);
    if (!to) throw new Error('This card is already closed');

    const unmet = await exitCriteria(q, card);
    if (unmet.length) throw Object.assign(new Error(`Exit criteria not met: ${unmet.join('; ')}`), { status: 409, unmet });

    if (card.stage === 'design' && card.design) await applyDesign(q, card, actor);

    if (card.stage === 'classify' && card.classification) {
      for (const r of card.classification.risks) {
        await q.query(
          `INSERT INTO risks (engagement_id, card_id, title, category, likelihood, impact, owner, rationale) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [card.engagementId, card.id, r.title, r.category, r.likelihood, r.impact, card.useCase.businessOwner || '', r.rationale],
        );
      }
    }

    const stages = await agentStages(q, card.engagementId);
    const status = stages.includes(to) ? 'queued' : 'idle';
    await q.query(`UPDATE cards SET stage=$2, status=$3, status_note=NULL, stage_entered_at=now(), updated_at=now() WHERE id=$1`, [card.id, to, status]);
    const atGate = card.status === 'needs_approval' || card.stage === 'intake';
    await logAudit(q, actor, atGate ? 'gate.approved' : 'card.moved', `card:${card.key}`, {
      from: card.stage,
      to,
      ...(note ? { note } : {}),
      ...(card.stage === 'classify' && card.tier
        ? { tier: card.tier, risksAdded: card.classification?.risks.length ?? 0, highRisks: card.classification?.risks.filter((r) => ['critical', 'high'].includes(riskRating(r.likelihood * r.impact))).length ?? 0 }
        : {}),
    });
  });
  await emitCard(db, cardId);
  emit('risk', { changed: true });
}

// On approval, the design becomes controls in the register, linked to the risks
// they treat, each with a draft test built from its test approach.
async function applyDesign(q: Queryable, card: Card, actor: string) {
  const { rows: risks } = await q.query(`SELECT id, title FROM risks WHERE card_id = $1`, [card.id]);
  for (const c of card.design!.controls) {
    const { rows: lib } = c.libraryCode ? await q.query(`SELECT id, type, frequency, refs FROM control_library WHERE code = $1`, [c.libraryCode]) : { rows: [] as any[] };
    const { rows } = await q.query(
      `INSERT INTO controls (engagement_id, card_id, library_id, title, objective, type, frequency, owner, status, framework_refs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'designed',$9) RETURNING id, number`,
      [card.engagementId, card.id, lib[0]?.id ?? null, c.title, c.objective, lib[0]?.type ?? 'preventive', lib[0]?.frequency ?? 'per change', c.owner, JSON.stringify(lib[0]?.refs ?? {})],
    );
    for (const t of c.riskTitles) {
      const r = risks.find((x: any) => x.title === t);
      if (r) await q.query(`INSERT INTO control_risks (control_id, risk_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [rows[0].id, r.id]);
    }
    await q.query(
      `INSERT INTO tests (engagement_id, control_id, kind, title, procedure, expected) VALUES ($1,$2,'operating',$3,$4,$5)`,
      [card.engagementId, rows[0].id, `Test: ${c.title}`, c.testApproach, 'The control operated as designed for every item sampled'],
    );
  }
  await logAudit(q, actor, 'controls.created_from_design', `card:${card.key}`, { controls: card.design!.controls.length });
}
