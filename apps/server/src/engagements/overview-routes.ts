// The numbers behind the KPI tiles, the Overview page and the activity charts.
import { STAGES, riskRating } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { engagementKpis } from './kpis.js';
import { getSettings, monthSpend } from '../settings/settings-store.js';

export function overviewRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // v1.7: the numbers for every page's KPI tiles, in one read.
  r.get(
    '/engagements/:id/kpis',
    wrap(async (req, res) => {
      res.json(await engagementKpis(db, req.params.id));
    }),
  );

  r.get(
    '/engagements/:id/overview',
    wrap(async (req, res) => {
      const id = req.params.id;
      const { rows: cards } = await db.query(`SELECT stage, status, tier FROM cards WHERE engagement_id = $1`, [id]);
      const { rows: risks } = await db.query(`SELECT likelihood, impact, status FROM risks WHERE engagement_id = $1`, [
        id,
      ]);
      const { rows: runs } = await db.query(
        `SELECT r.status, r.cost_usd FROM runs r JOIN cards c ON c.id = r.card_id WHERE c.engagement_id = $1`,
        [id],
      );
      const active = cards.filter((c: any) => !(c.stage === 'closed' && !c.tier));
      const classified = active.filter((c: any) => c.tier && c.stage !== 'classify').length;
      const tiers: Record<string, number> = { prohibited: 0, high: 0, limited: 0, minimal: 0 };
      for (const c of active) if (c.tier) tiers[c.tier]++;
      const openHigh = risks.filter(
        (k: any) => k.status === 'open' && ['critical', 'high'].includes(riskRating(k.likelihood * k.impact)),
      ).length;
      const finished = runs.filter((x: any) => x.status !== 'running');
      const byStage = Object.fromEntries(STAGES.map((s) => [s, cards.filter((c: any) => c.stage === s).length]));
      res.json({
        useCases: active.length,
        classified,
        coveragePct: active.length ? Math.round((classified / active.length) * 100) : 0,
        tiers,
        risks: { total: risks.length, open: risks.filter((k: any) => k.status === 'open').length, openHigh },
        needsYou: cards.filter(
          (c: any) =>
            c.status === 'needs_approval' || c.status === 'failed' || (c.stage === 'intake' && c.status === 'idle'),
        ).length,
        runs: {
          total: runs.length,
          succeededPct: finished.length
            ? Math.round((finished.filter((x: any) => x.status === 'succeeded').length / finished.length) * 100)
            : 0,
          spendUsd: runs.reduce((a: number, x: any) => a + Number(x.cost_usd), 0),
        },
        month: await (async () => {
          const s = await getSettings(db);
          return {
            spendUsd: await monthSpend(db, s.timeZone),
            capUsd: s.spendCapUsd,
            warnAtPct: s.warnAtPct,
            pauseAtCap: s.pauseAtCap,
          };
        })(),
        byStage,
      });
    }),
  );

  // Activity over time for the Overview charts: agent runs and their cost by
  // stage, agent or model, run outcomes, use cases added and closed, and how
  // people decided the agents' draft items.
  r.get(
    '/engagements/:id/activity',
    wrap(async (req, res) => {
      const { days } = z
        .object({
          days: z.coerce
            .number()
            .int()
            .refine((n) => [7, 30, 90, 365].includes(n))
            .default(30),
        })
        .parse(req.query);
      const id = req.params.id;
      const tz = (await getSettings(db)).timeZone;
      const dayList: string[] = [];
      const today = new Date();
      for (let i = days - 1; i >= 0; i--)
        dayList.push(new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10));
      const since = dayList[0];
      const { rows: runs } = await db.query(
        `SELECT to_char(r.started_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, r.stage, r.agent, r.model, r.status, r.cost_usd
       FROM runs r JOIN cards c ON c.id = r.card_id WHERE c.engagement_id = $1 AND r.started_at >= $2::date`,
        [id, since, tz],
      );
      const { rows: cards } = await db.query(
        `SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS created, CASE WHEN stage = 'closed' THEN to_char(stage_entered_at AT TIME ZONE $3, 'YYYY-MM-DD') END AS closed
       FROM cards WHERE engagement_id = $1 AND (created_at >= $2::date OR stage_entered_at >= $2::date)`,
        [id, since, tz],
      );
      const { rows: decisions } = await db.query(
        `SELECT action, detail FROM audit_log WHERE engagement_id = $1 AND at >= $2::date AND action LIKE 'draft.%'`,
        [id, since],
      );
      const idx = new Map(dayList.map((d, i) => [d, i]));
      const series = (key: 'stage' | 'agent' | 'model', metric: 'cost' | 'runs') => {
        const out: Record<string, number[]> = {};
        for (const r of runs) {
          const i = idx.get(r.day);
          if (i == null) continue;
          const name = String(r[key] ?? 'unknown');
          out[name] ??= dayList.map(() => 0);
          out[name][i] += metric === 'cost' ? Number(r.cost_usd) : 1;
        }
        return out;
      };
      const counts = (pick: (x: any) => string | null) => {
        const a = dayList.map(() => 0);
        for (const x of cards) {
          const d = pick(x);
          const i = d ? idx.get(d) : undefined;
          if (i != null) a[i]++;
        }
        return a;
      };
      const outcome = (st: string) => {
        const a = dayList.map(() => 0);
        for (const r of runs) {
          const i = idx.get(r.day);
          if (i != null && r.status === st) a[i]++;
        }
        return a;
      };
      const d = { accepted: 0, edited: 0, rejected: 0 };
      for (const x of decisions) {
        if (x.action === 'draft.rest_accepted') d.accepted += (x.detail?.items ?? []).length;
        else if (x.action === 'draft.item_accepted') d.accepted++;
        else if (x.action === 'draft.item_edited') d.edited++;
        else if (x.action === 'draft.item_rejected') d.rejected++;
      }
      res.json({
        days: dayList,
        cost: { stage: series('stage', 'cost'), agent: series('agent', 'cost'), model: series('model', 'cost') },
        runs: { stage: series('stage', 'runs'), agent: series('agent', 'runs'), model: series('model', 'runs') },
        outcomes: { succeeded: outcome('succeeded'), failed: outcome('failed') },
        flow: { added: counts((x) => x.created), closed: counts((x) => x.closed) },
        decisions: d,
      });
    }),
  );
}
