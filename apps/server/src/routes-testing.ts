// Agent testing API: the golden dataset and its runs, the Verifier's settings,
// labelled examples and calibration, and the Verifier check on one card.
import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { GOLDEN_AGENTS, JUDGE_TRUST, NewGoldenCase, NewJudgeLabel } from '@gh/shared';
import type { Db } from './db.js';
import { logAudit } from './audit.js';
import { visibleIds } from './access.js';
import { getProviderRow } from './providers.js';
import { getSettings } from './store.js';
import { calibrate, importDecisionLabels, startGoldenRun, toCalibration, toCase, toLabel, toRunRow } from './golden.js';
import { evalRetrieval, RETRIEVAL_SET } from './retrieval.js';
import { checkCap, verifierTarget, verifyCard, VERIFIER_RULES_VERSION } from './verifier.js';

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

export function testingRoutes(r: Router, db: Db, actorOf: (req: Request) => string, wrap: Wrap) {
  r.get('/agent-testing', wrap(async (req, res) => {
    // Examples taken from a members-only engagement are shown only to its members.
    const ids = await visibleIds(db, req.user);
    const [cases, runs, labels, cals, s] = await Promise.all([
      db.query(`SELECT * FROM golden_cases ORDER BY agent, number`),
      db.query(`SELECT * FROM golden_runs ORDER BY number DESC LIMIT 20`),
      ids ? db.query(`SELECT * FROM judge_labels WHERE engagement_id IS NULL OR engagement_id = ANY($1) ORDER BY number`, [ids]) : db.query(`SELECT * FROM judge_labels ORDER BY number`),
      db.query(`SELECT * FROM judge_calibrations ORDER BY number DESC LIMIT 10`),
      getSettings(db),
    ]);
    res.json({
      cases: cases.rows.map(toCase),
      runs: runs.rows.map(toRunRow),
      labels: labels.rows.map(toLabel),
      calibrations: cals.rows.map(toCalibration),
      verifier: { providerId: s.verifierProviderId, model: s.verifierModel, live: s.verifierLive, rulesVersion: VERIFIER_RULES_VERSION },
      trust: JUDGE_TRUST,
    });
  }));

  r.get('/agent-testing/runs/:id', wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT * FROM golden_runs WHERE id::text = $1 OR 'GR-' || number = $1`, [req.params.id]);
    if (!rows[0]) throw httpError(404, 'Run not found');
    res.json(toRunRow(rows[0]));
  }));

  r.post('/agent-testing/runs', wrap(async (req, res) => {
    const b = z.object({ agent: z.enum(GOLDEN_AGENTS), providerId: z.string().uuid(), model: z.string().trim().min(1).max(120), withVerifier: z.boolean().default(false), engagementId: z.string().uuid().nullish(), mode: z.enum(['agentic', 'single']).default('agentic') }).parse(req.body);
    const provider = await getProviderRow(db, b.providerId);
    if (!provider) throw httpError(400, 'Provider not found');
    if (!provider.enabled) throw httpError(400, `${provider.name} is turned off`);
    const { rows: busy } = await db.query(`SELECT 1 FROM golden_runs WHERE status = 'running' AND agent = $1 AND started_at > now() - interval '30 minutes'`, [b.agent]);
    if (busy.length) throw httpError(409, 'A golden run for this agent is already going. Wait for it to finish.');
    await checkCap(db, { provider, model: b.model });
    let context = null;
    if (b.engagementId) {
      const e = (await db.query(`SELECT name, client, about FROM engagements WHERE id = $1`, [b.engagementId])).rows[0];
      if (!e) throw httpError(404, 'Engagement not found');
      const a = (await db.query(`SELECT instructions FROM agents WHERE engagement_id = $1 AND role = $2 ORDER BY custom NULLS FIRST, created_at LIMIT 1`, [b.engagementId, b.agent])).rows[0];
      context = { engagement: `${e.client}: ${e.name}`, about: e.about ?? '', instructions: a?.instructions ?? '' };
    }
    const id = await startGoldenRun(db, b.agent, { provider, model: b.model }, b.withVerifier, actorOf(req), context, b.mode);
    res.status(202).json({ id });
  }));

  // Retrieval checks (v1.6): how well the knowledge base finds the right passage.
  // Read-only; with an embedding model set it compares keyword and meaning search.
  r.get('/agent-testing/retrieval', wrap(async (_req, res) => {
    res.json({ ...(await evalRetrieval(db)), set: RETRIEVAL_SET });
  }));

  r.post('/agent-testing/cases', wrap(async (req, res) => {
    const c = NewGoldenCase.parse(req.body);
    if (c.agent === 'control_designer' && !c.risks.length) throw httpError(400, 'A control design case needs the approved risks it starts from');
    if (c.agent === 'risk_classifier' && !c.expected.tier && !c.expected.mustRisk.length) throw httpError(400, 'Say what the right answer is: the expected tier or the risks it must raise');
    if (c.agent === 'control_designer' && !c.expected.mustControls.length) throw httpError(400, 'Say which library controls it must propose');
    const row = await db.tx(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO golden_cases (agent, title, use_case, tier, risks, expected, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [c.agent, c.title, JSON.stringify(c.useCase), c.tier, JSON.stringify(c.risks), JSON.stringify(c.expected), actorOf(req)],
      );
      await logAudit(q, actorOf(req), 'golden.case_added', `golden:G-${rows[0].number}`, { agent: c.agent, title: c.title, expected: c.expected });
      return rows[0];
    });
    res.status(201).json(toCase(row));
  }));

  r.delete('/agent-testing/cases/:id', wrap(async (req, res) => {
    await db.tx(async (q) => {
      const { rows } = await q.query(`SELECT * FROM golden_cases WHERE id = $1`, [req.params.id]);
      if (!rows[0]) throw httpError(404, 'Case not found');
      if (rows[0].built_in) throw httpError(409, 'Built-in cases stay, so runs stay comparable over time');
      await q.query(`DELETE FROM golden_cases WHERE id = $1`, [req.params.id]);
      await logAudit(q, actorOf(req), 'golden.case_removed', `golden:G-${rows[0].number}`, { title: rows[0].title });
    });
    res.json({ ok: true });
  }));

  r.post('/agent-testing/labels', wrap(async (req, res) => {
    const l = NewJudgeLabel.parse(req.body);
    const nums = l.sources.map((s) => Number(s.slice(2)));
    const { rows: ps } = nums.length
      ? await db.query(`SELECT c.number, c.heading, c.text, s.kind, s.ref FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id WHERE c.number = ANY($1)`, [nums])
      : { rows: [] as any[] };
    const missing = l.sources.filter((s) => !ps.some((p: any) => `K-${p.number}` === s));
    if (missing.length) throw httpError(400, `These passages don't exist: ${missing.join(', ')}`);
    const passages = ps.map((p: any) => ({ id: `K-${p.number}`, title: p.heading, kind: p.kind, ref: p.ref, text: String(p.text).slice(0, 1200), score: 1 }));
    const row = await db.tx(async (q) => {
      const { rows } = await q.query(`INSERT INTO judge_labels (kind, claim, passages, human, note, origin, created_by) VALUES ($1,$2,$3,$4,$5,'manual',$6) RETURNING *`, [
        l.kind, l.claim, JSON.stringify(passages), l.human, l.note, actorOf(req),
      ]);
      await logAudit(q, actorOf(req), 'judge.label_added', `judge:L-${rows[0].number}`, { human: l.human, sources: l.sources });
      return rows[0];
    });
    res.status(201).json(toLabel(row));
  }));

  r.delete('/agent-testing/labels/:id', wrap(async (req, res) => {
    await db.tx(async (q) => {
      const { rows } = await q.query(`SELECT * FROM judge_labels WHERE id = $1`, [req.params.id]);
      if (!rows[0]) throw httpError(404, 'Label not found');
      if (rows[0].origin === 'built_in') throw httpError(409, 'Built-in labels stay, so calibrations stay comparable');
      await q.query(`DELETE FROM judge_labels WHERE id = $1`, [req.params.id]);
      await logAudit(q, actorOf(req), 'judge.label_removed', `judge:L-${rows[0].number}`, {});
    });
    res.json({ ok: true });
  }));

  r.post('/agent-testing/labels/import', wrap(async (req, res) => {
    res.json({ added: await importDecisionLabels(db, actorOf(req)) });
  }));

  r.post('/agent-testing/calibrate', wrap(async (req, res) => {
    const target = await verifierTarget(db);
    await checkCap(db, target);
    res.json(await calibrate(db, target, actorOf(req)));
  }));

  // Ask the Verifier about one card's current draft. Advisory only.
  r.post('/cards/:id/verify', wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT id FROM cards WHERE id::text = $1 OR key = $1`, [req.params.id]);
    if (!rows[0]) throw httpError(404, 'Card not found');
    res.json(await verifyCard(db, rows[0].id, 'manual', actorOf(req)));
  }));
}
