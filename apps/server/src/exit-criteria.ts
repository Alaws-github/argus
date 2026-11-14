// Gate exit criteria, written as checks rather than reminders: a use case can't
// leave a stage until its criteria hold. Same idea as a test phase's exit
// criteria.
import type { Card, Stage } from '@gh/shared';
import type { Queryable } from './db.js';
import { stepsBlockingSignOff } from './client-steps.js';

export const EXIT_CRITERIA: Partial<Record<Stage, string[]>> = {
  classify: ['A classification has been produced'],
  design: ['Every risk scoring 12 or more is treated by at least one control (applies once controls exist)'],
  evidence: ['Every control for this use case has at least one evidence item'],
  test: [
    'Every test for this use case has a result (passed or failed)',
    'Every concluded test has been reviewed by someone other than its preparer',
    'Every failed test has an issue raised for it',
  ],
  remediate: ['No critical or high issue for this use case is still open'],
  report: ['If its client workflow requires it, every tracked client step is done'],
};

export async function exitCriteria(q: Queryable, card: Card): Promise<string[]> {
  const unmet: string[] = [];
  const controls = `SELECT id FROM controls WHERE card_id = $1`;
  switch (card.stage) {
    case 'classify':
      if (!card.classification) unmet.push('there is no classification yet');
      break;
    case 'design': {
      // Every risk scoring 12 or more needs a control, counting only controls
      // the reviewer kept (or the register, once controls exist).
      const { rows: high } = await q.query(
        `SELECT k.title FROM risks k WHERE k.card_id = $1 AND k.likelihood * k.impact >= 12
         AND NOT EXISTS (SELECT 1 FROM control_risks cr WHERE cr.risk_id = k.id)`,
        [card.id],
      );
      let open = high.map((r: any) => r.title as string);
      if (card.design) {
        const d = card.decisions?.design ?? {};
        const covered = new Set(
          card.design.controls.flatMap((c, i) => (d[`control:${i}`]?.decision === 'reject' ? [] : c.riskTitles)),
        );
        open = open.filter((t) => !covered.has(t));
      }
      if (open.length)
        unmet.push(`${open.length} high risk${open.length === 1 ? ' has' : 's have'} no control: ${open.join(', ')}`);
      break;
    }
    case 'evidence': {
      const { rows } = await q.query(
        `SELECT c.title FROM controls c WHERE c.card_id = $1 AND NOT EXISTS (
           SELECT 1 FROM evidence e WHERE e.control_id = c.id OR e.test_id IN (SELECT t.id FROM tests t WHERE t.control_id = c.id))`,
        [card.id],
      );
      if (rows.length) unmet.push(`${rows.length} control${rows.length === 1 ? ' has' : 's have'} no evidence`);
      const { rows: n } = await q.query(`SELECT count(*)::int AS n FROM (${controls}) x`, [card.id]);
      if (!n[0].n) unmet.push('there are no controls for this use case');
      break;
    }
    case 'test': {
      const { rows } = await q.query(
        `SELECT
           count(*) FILTER (WHERE t.status NOT IN ('passed','failed'))::int AS open,
           count(*) FILTER (WHERE t.status IN ('passed','failed') AND t.reviewed_by IS NULL)::int AS unreviewed,
           count(*) FILTER (WHERE t.status = 'failed' AND NOT EXISTS (SELECT 1 FROM issues i WHERE i.test_id = t.id))::int AS untracked,
           count(*)::int AS total
         FROM tests t WHERE t.control_id IN (${controls})`,
        [card.id],
      );
      if (!rows[0].total) unmet.push('there are no tests for this use case');
      if (rows[0].open) unmet.push(`${rows[0].open} test${rows[0].open === 1 ? ' has' : 's have'} no result`);
      if (rows[0].untracked)
        unmet.push(`${rows[0].untracked} failed test${rows[0].untracked === 1 ? ' has' : 's have'} no issue raised`);
      if (rows[0].unreviewed)
        unmet.push(`${rows[0].unreviewed} test${rows[0].unreviewed === 1 ? ' is' : 's are'} not reviewed`);
      break;
    }
    case 'remediate': {
      const { rows } = await q.query(
        `SELECT count(*)::int AS n FROM issues i
         WHERE i.status IN ('open','in_remediation','ready_for_retest') AND i.severity IN ('critical','high')
           AND (i.card_id = $1 OR i.control_id IN (${controls}))`,
        [card.id],
      );
      if (rows[0].n) unmet.push(`${rows[0].n} critical or high issue${rows[0].n === 1 ? ' is' : 's are'} still open`);
      break;
    }
    case 'report': {
      // v1.7.4: a client workflow can require its tracked steps before sign-off. A person still signs off.
      const open = await stepsBlockingSignOff(q, card.id);
      if (open.length)
        unmet.push(
          `${open.length} client step${open.length === 1 ? ' is' : 's are'} not done yet: ${open.slice(0, 4).join(', ')}`,
        );
      break;
    }
  }
  return unmet;
}
