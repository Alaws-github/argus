// Creating an engagement (POST /engagements): the record, its first member and agents, and the
// optional starting points chosen in the Add engagement wizard (a Statement of Applicability,
// use cases, client tools and a draft client workflow). Everything is one transaction, audited.
import { FRAMEWORK_CHOICES, STAGES, toolById, workflowTemplate, type NewEngagement } from '@gh/shared';
import type { z } from 'zod';
import { logAudit } from '../audit/audit.js';
import { httpError } from '../core/http.js';
import type { Db, Queryable } from '../core/db.js';
import { getProviderRow } from '../ai/providers.js';
import { ensureAgents } from '../setup/seed.js';

type NewEngagementInput = z.infer<typeof NewEngagement>;

/** A URL-safe slug from the engagement name, with -2, -3 and so on added until it's unused. */
export function uniqueSlug(name: string, taken: string[]) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'engagement';
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** Intake always has a gate and Closed never does; the other stages are as the person chose. */
const gatesFrom = (chosen: NewEngagementInput['gates']) =>
  Object.fromEntries(STAGES.map((st) => [st, st === 'intake' ? true : st === 'closed' ? false : !!chosen[st]]));

/**
 * Starts the Statement of Applicability: every library control that maps to a framework in scope is
 * marked as applying, with a note asking a person to confirm or exclude it. Returns how many.
 */
async function startSoa(q: Queryable, eid: string, frameworks: string[], actor: string) {
  const { rows: lib } = await q.query(`SELECT id, code, refs FROM control_library`);
  let count = 0;
  for (const l of lib) {
    const hits = frameworks.filter((f) => (l.refs?.[f] ?? []).length);
    if (!hits.length) continue;
    const names = FRAMEWORK_CHOICES.filter((f) => hits.includes(f.id))
      .map((f) => f.label)
      .join(', ');
    await q.query(
      `INSERT INTO soa (engagement_id, library_id, applicable, justification, decided_by) VALUES ($1,$2,true,$3,$4)`,
      [eid, l.id, `Starting position: maps to ${names}, which is in scope. Confirm or exclude with a reason.`, actor],
    );
    count++;
  }
  return count;
}

/** Adds the use cases named in the wizard as Intake cards (PREFIX-1, PREFIX-2 ...). Returns how many. */
async function addStartingUseCases(q: Queryable, eid: string, prefix: string, titles: string[], actor: string) {
  let n = 0;
  for (const title of titles) {
    n++;
    const useCase = {
      title,
      businessOwner: '',
      description: '',
      dataUsed: '',
      affectedPeople: '',
      autonomy: 'human_in_loop',
      vendor: '',
    };
    await q.query(
      `INSERT INTO cards (engagement_id, number, key, title, use_case, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [eid, n, `${prefix}-${n}`, title, JSON.stringify(useCase), actor],
    );
  }
  return n;
}

/**
 * A starting client workflow from a template, saved as a draft: the real process is usually agreed
 * with the client later. Returns its key (WF-n), or null when none was chosen.
 */
async function addStartingWorkflow(q: Queryable, eid: string, b: NewEngagementInput, actor: string) {
  if (!b.workflow) return null;
  const name = b.workflow.name ?? `${b.client} AI approval`;
  const { rows: wf } = await q.query(
    `INSERT INTO workflows (engagement_id, name, description, graph, updated_by) VALUES ($1,$2,$3,$4,$5) RETURNING number`,
    [
      eid,
      name,
      'Started with the engagement. Agree the real process with the client, then publish.',
      JSON.stringify(workflowTemplate(b.workflow.template)),
      actor,
    ],
  );
  const key = `WF-${wf[0].number}`;
  await logAudit(q, actor, 'workflow.created', `workflow:${key}`, {
    name,
    template: b.workflow.template,
    withEngagement: true,
  });
  return key;
}

/** Creates the engagement and everything chosen with it. The creator is its first member. Returns its id. */
export async function createEngagement(db: Db, b: NewEngagementInput, creator: { id: string }, actor: string) {
  const { rows: taken } = await db.query(`SELECT slug, prefix FROM engagements`);
  if (taken.some((e: any) => e.prefix === b.prefix))
    throw httpError(
      409,
      `Another engagement already uses the prefix ${b.prefix}. Card keys must be unique, so pick another.`,
    );
  const slug = uniqueSlug(
    b.name,
    taken.map((e: any) => e.slug),
  );
  for (const a of Object.values(b.agents))
    if (!(await getProviderRow(db, a.providerId))) throw httpError(400, 'A chosen provider no longer exists');
  const gates = gatesFrom(b.gates);
  const labels = FRAMEWORK_CHOICES.filter((f) => b.frameworks.includes(f.id)).map((f) => f.label);

  return db.tx(async (q) => {
    const { rows } = await q.query(
      `INSERT INTO engagements (slug, name, client, prefix, color, gates, about, framework, sector, appetite, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        slug,
        b.name,
        b.client,
        b.prefix,
        b.color,
        JSON.stringify(gates),
        b.about,
        labels.join(' · '),
        b.sector,
        JSON.stringify(b.appetite),
        actor,
      ],
    );
    const eid: string = rows[0].id;
    await q.query(
      `INSERT INTO engagement_members (engagement_id, user_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [eid, creator.id, actor],
    );
    await ensureAgents(q, eid);
    for (const [role, a] of Object.entries(b.agents)) {
      await q.query(
        `UPDATE agents SET provider_id = $3, model = $4, effort = $5 WHERE engagement_id = $1 AND role = $2`,
        [eid, role, a.providerId, a.model, a.effort],
      );
    }
    const soa = b.startSoa ? await startSoa(q, eid, b.frameworks, actor) : 0;
    const useCases = await addStartingUseCases(q, eid, b.prefix, b.useCases, actor);
    await q.query(`UPDATE engagements SET card_seq = $2, client_tools = $3 WHERE id = $1`, [
      eid,
      useCases,
      JSON.stringify(b.clientTools.filter((t) => toolById(t))),
    ]);
    // v1.7.4: a client workflow or client tools chosen at creation switches on the module that shows them.
    if (b.clientWorkflows || b.workflow || b.clientTools.length)
      await q.query(`UPDATE engagements SET modules = modules || '{"connectors": true}'::jsonb WHERE id = $1`, [eid]);
    const workflow = await addStartingWorkflow(q, eid, b, actor);
    await logAudit(q, actor, 'engagement.created', `engagement:${slug}`, {
      name: b.name,
      client: b.client,
      prefix: b.prefix,
      frameworks: labels,
      soaStarted: soa,
      useCases,
      clientTools: b.clientTools,
      workflow,
      gates: Object.keys(gates).filter((k) => gates[k]),
      models: Object.fromEntries(Object.entries(b.agents).map(([k, v]) => [k, v.model])),
    });
    return eid;
  });
}
