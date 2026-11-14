// The engagement's control register: list, add, import from CSV or Excel, update.
import { ControlInput, ControlStatus } from '@gh/shared';
import { type Router } from 'express';
import { z } from 'zod';
import { CONTROL_SELECT, toControl } from './control-records.js';
import { logAudit } from '../audit/audit.js';
import { readControls } from './control-import.js';
import { httpError, type ActorOf, type Wrap } from '../core/http.js';
import { type Db } from '../core/db.js';
import { emit } from '../core/realtime.js';

/**
 * Registers these 4 routes on the API router (each path is under /api):
 * - GET /engagements/:id/controls
 * - POST /engagements/:id/controls
 * - POST /engagements/:id/controls/import
 * - PATCH /controls/:id
 */
export function controlRoutes(r: Router, db: Db, actorOf: ActorOf, wrap: Wrap) {
  // ---------------------------------------------------------------- controls
  r.get(
    '/engagements/:id/controls',
    wrap(async (req, res) => {
      const { rows } = await db.query(`${CONTROL_SELECT} WHERE c.engagement_id = $1 ORDER BY c.number`, [
        req.params.id,
      ]);
      res.json(rows.map(toControl));
    }),
  );

  r.post(
    '/engagements/:id/controls',
    wrap(async (req, res) => {
      const b = ControlInput.parse(req.body);
      const id = await db.tx(async (q) => {
        let refs = {};
        if (b.libraryId)
          refs = (await q.query(`SELECT refs FROM control_library WHERE id = $1`, [b.libraryId])).rows[0]?.refs ?? {};
        const { rows } = await q.query(
          `INSERT INTO controls (engagement_id, card_id, library_id, title, objective, type, frequency, owner, status, framework_refs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, number`,
          [
            req.params.id,
            b.cardId ?? null,
            b.libraryId ?? null,
            b.title,
            b.objective,
            b.type,
            b.frequency,
            b.owner,
            b.status ?? 'proposed',
            JSON.stringify(refs),
          ],
        );
        for (const rid of b.riskIds)
          await q.query(`INSERT INTO control_risks VALUES ($1,$2) ON CONFLICT DO NOTHING`, [rows[0].id, rid]);
        await logAudit(q, actorOf(req), 'control.added', `control:C-${rows[0].number}`, {
          title: b.title,
          risks: b.riskIds.length,
        });
        return rows[0].id;
      });
      const { rows } = await db.query(`${CONTROL_SELECT} WHERE c.id = $1`, [id]);
      res.status(201).json(toControl(rows[0]));
    }),
  );

  // Upload controls from a CSV or Excel file. preview: true saves nothing.
  r.post(
    '/engagements/:id/controls/import',
    wrap(async (req, res) => {
      const b = z
        .object({
          filename: z.string().max(200),
          dataBase64: z.string().max(14_000_000),
          preview: z.boolean().default(true),
        })
        .parse(req.body);
      const { rows, problems } = await readControls(Buffer.from(b.dataBase64, 'base64'), b.filename);
      const eid = req.params.id;
      const cards = new Map(
        (await db.query(`SELECT id, key FROM cards WHERE engagement_id = $1`, [eid])).rows.map((r: any) => [
          r.key.toUpperCase(),
          r.id,
        ]),
      );
      const risks = new Map(
        (await db.query(`SELECT id, number, card_id FROM risks WHERE engagement_id = $1`, [eid])).rows.map((r: any) => [
          `R-${r.number}`,
          r,
        ]),
      );
      const lib = new Map(
        (await db.query(`SELECT id, code FROM control_library`)).rows.map((r: any) => [r.code.toUpperCase(), r.id]),
      );
      const checked = rows.map((r) => {
        const why: string[] = [];
        if (r.title.length < 3) why.push('no title');
        if (!['preventive', 'detective', 'corrective'].includes(r.type))
          why.push(`type "${r.type}" should be preventive, detective or corrective`);
        const cardId = r.useCase ? cards.get(r.useCase.toUpperCase()) : null;
        if (r.useCase && !cardId) why.push(`no use case ${r.useCase}`);
        const libraryId = r.libraryCode ? lib.get(r.libraryCode.toUpperCase()) : null;
        if (r.libraryCode && !libraryId) why.push(`no library control ${r.libraryCode}`);
        const riskIds: string[] = [];
        for (const k of r.risks) {
          const x: any = risks.get(k);
          if (!x) why.push(`no risk ${k}`);
          else riskIds.push(x.id);
        }
        return {
          ...r,
          cardId: cardId ?? null,
          libraryId: libraryId ?? null,
          riskIds,
          ok: !why.length,
          why: why.join('; '),
        };
      });
      if (b.preview) return res.json({ rows: checked, problems, willAdd: checked.filter((r) => r.ok).length });
      const good = checked.filter((r) => r.ok);
      if (!good.length) throw httpError(422, 'No row can be added. Fix the rows marked in the preview.');
      const added = await db.tx(async (q) => {
        const keys: string[] = [];
        for (const r of good) {
          let refs = {};
          if (r.libraryId)
            refs = (await q.query(`SELECT refs FROM control_library WHERE id = $1`, [r.libraryId])).rows[0]?.refs ?? {};
          const { rows: ins } = await q.query(
            `INSERT INTO controls (engagement_id, card_id, library_id, title, objective, type, frequency, owner, status, framework_refs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'proposed',$9) RETURNING id, number`,
            [
              eid,
              r.cardId,
              r.libraryId,
              r.title.slice(0, 200),
              r.objective.slice(0, 2000),
              r.type,
              r.frequency.slice(0, 60),
              r.owner.slice(0, 120),
              JSON.stringify(refs),
            ],
          );
          for (const rid of r.riskIds)
            await q.query(`INSERT INTO control_risks VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ins[0].id, rid]);
          await logAudit(q, actorOf(req), 'control.added', `control:C-${ins[0].number}`, {
            title: r.title,
            risks: r.riskIds.length,
            uploadedFrom: b.filename,
            row: r.row,
          });
          keys.push(`C-${ins[0].number}`);
        }
        return keys;
      });
      emit('controls', { engagementId: eid });
      res.status(201).json({ added, skipped: checked.filter((r) => !r.ok).map((r) => ({ row: r.row, why: r.why })) });
    }),
  );

  r.patch(
    '/controls/:id',
    wrap(async (req, res) => {
      const b = ControlInput.partial().extend({ status: ControlStatus.optional() }).parse(req.body);
      const { rows: before } = await db.query(`SELECT * FROM controls WHERE id = $1`, [req.params.id]);
      if (!before[0]) throw httpError(404, 'Control not found');
      await db.tx(async (q) => {
        const map: Record<string, string> = {
          title: 'title',
          objective: 'objective',
          type: 'type',
          frequency: 'frequency',
          owner: 'owner',
          status: 'status',
        };
        const keys = Object.keys(b).filter((k) => map[k]);
        if (keys.length)
          await q.query(`UPDATE controls SET ${keys.map((k, i) => `${map[k]} = $${i + 2}`).join(', ')} WHERE id = $1`, [
            before[0].id,
            ...keys.map((k) => (b as any)[k]),
          ]);
        if (b.riskIds) {
          await q.query(`DELETE FROM control_risks WHERE control_id = $1`, [before[0].id]);
          for (const rid of b.riskIds)
            await q.query(`INSERT INTO control_risks VALUES ($1,$2) ON CONFLICT DO NOTHING`, [before[0].id, rid]);
        }
        await logAudit(
          q,
          actorOf(req),
          'control.changed',
          `control:C-${before[0].number}`,
          Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { from: before[0][map[k] ?? k] ?? null, to: v }])),
        );
      });
      const { rows } = await db.query(`${CONTROL_SELECT} WHERE c.id = $1`, [before[0].id]);
      res.json(toControl(rows[0]));
    }),
  );
}
