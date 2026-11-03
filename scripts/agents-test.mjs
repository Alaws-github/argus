// Drafting-agent tests: the four agents on the offline rules end to end, then
// their guardrails against a mock model that tries to cheat. Needs a FRESH
// database and a running server: npm run db:reset, npm start, npm run test:agents.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-model.cjs', import.meta.url))], { stdio: 'ignore' });
process.on('exit', () => mock.kill());
await new Promise((r) => setTimeout(r, 500));
const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
function client() { let cookie = ''; return async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } if (!r.ok) { const e = new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)}`); e.status = r.status; e.body = j; throw e; } return j; }; }
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const expectErr = async (p, s, m) => { try { await p; ok(false, m + ' (no error)'); } catch (e) { ok(e.status === s, `${m} -> ${e.status} ${e.body?.error ?? ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = client();
await admin('POST', '/auth/setup', { name: 'Andrew Lawrence', email: 'andrew@example.com', password: 'correct-horse-9' });
for (const [n, e, r] of [['Riley Reviewer', 'riley@example.com', 'reviewer'], ['Pat Preparer', 'pat@example.com', 'preparer']]) await admin('POST', '/users', { name: n, email: e, role: r, password: 'correct-horse-9' });
const riley = client(); await riley('POST', '/auth/login', { email: 'riley@example.com', password: 'correct-horse-9' });
const pat = client(); await pat('POST', '/auth/login', { email: 'pat@example.com', password: 'correct-horse-9' });
const [eng] = await admin('GET', '/engagements'); const E = eng.id;

const agents = await admin('GET', `/engagements/${E}/agents`);
const byRole = Object.fromEntries(agents.map((a) => [a.role, a]));
ok(['evidence_collector', 'control_tester', 'independent_reviewer', 'report_writer'].every((r) => byRole[r].built && !byRole[r].enabled), 'the four new agents are built and ship switched off');
ok(byRole.independent_reviewer.name === 'Review assistant', 'renamed to Review assistant');
ok(Object.values(byRole).every((a) => a.rulesVersion), 'every agent reports a rules version');
for (const r of ['evidence_collector', 'control_tester', 'independent_reviewer', 'report_writer']) await admin('PATCH', `/agents/${byRole[r].id}`, { enabled: true });

const board = async () => (await admin('GET', `/engagements/${E}/board`)).cards;
const cardOf = async (key) => (await admin('GET', `/cards/${key}`));
const waitFor = async (key, pred, label, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const d = await cardOf(key); if (pred(d.card)) return d; await sleep(500); } const d = await cardOf(key); throw new Error(`timeout ${label}: ${d.card.stage}/${d.card.status} ${d.card.statusNote}`); };

async function toEvidence(key) {
  const c = (await board()).find((x) => x.key === key);
  await riley('POST', `/cards/${c.id}/actions`, { action: 'approve' });
  await waitFor(key, (x) => x.stage === 'classify' && x.status === 'needs_approval', 'classify');
  await riley('POST', `/cards/${c.id}/actions`, { action: 'approve' });
  await waitFor(key, (x) => x.stage === 'design' && x.status === 'needs_approval', 'design');
  await riley('POST', `/cards/${c.id}/actions`, { action: 'approve' });
  return c.id;
}

// ---- AI-2 on the offline rules
const id2 = await toEvidence('AI-2');
let d = await waitFor('AI-2', (x) => x.stage === 'evidence' && x.status === 'needs_approval', 'evidence draft');
ok(!!d.card.drafts.evidence && d.card.drafts.evidence.requests.length === d.controls.length, `Evidence Collector drafted ${d.card.drafts.evidence?.requests.length} requests`);
ok(d.card.status === 'needs_approval', 'evidence stage stopped for a person although it has no gate');
await expectErr(riley('POST', `/cards/${id2}/actions`, { action: 'approve' }), 409, 'approving without evidence is still blocked by exit criteria');
await expectErr(pat('POST', `/cards/${id2}/actions`, { action: 'approve' }), 403, 'preparer cannot approve the evidence stage');
for (const [i, c] of d.controls.entries()) {
  await pat('POST', '/evidence', { engagementId: E, controlId: c.id, title: `Notes ${c.key}`, kind: 'note', note: i === 0 ? 'Sampled 25 escalations: 2 of 25 chats escalated without a transcript.' : 'Walkthrough with owner, no exceptions found in 25 sampled.' });
}
await riley('POST', `/cards/${id2}/actions`, { action: 'approve' });
d = await waitFor('AI-2', (x) => x.stage === 'test' && x.status === 'needs_approval', 'test drafts');
let tests = (await admin('GET', `/engagements/${E}/tests`)).filter((t) => d.controls.some((c) => c.id === t.controlId));
ok(tests.every((t) => t.draft && t.preparedBy === null && !['passed', 'failed'].includes(t.status)), 'Control Tester drafted every test without concluding any or becoming the preparer');
const failDraft = tests.find((t) => t.draft.proposed === 'fail');
ok(failDraft && failDraft.draft.exceptions === 2, `rules flagged the stated exceptions (${failDraft?.key}: ${failDraft?.draft.exceptions})`);
ok(tests.every((t) => t.draft.proposed !== 'pass'), 'rules never propose a pass');
await expectErr(riley('POST', `/cards/${id2}/actions`, { action: 'approve' }), 409, 'cannot leave Test with tests unconcluded');
for (const t of tests) {
  const f = t.id === failDraft.id;
  await pat('PATCH', `/tests/${t.id}`, f ? { status: 'failed', actual: t.draft.actual, exceptions: t.draft.exceptions, fromDraft: true } : { status: 'passed', actual: 'Walkthrough and sample of 25, no exceptions', exceptions: 0, sampleSize: 25 });
}
await expectErr(pat('POST', `/tests/${failDraft.id}/review`, {}), 403, 'preparer still cannot review (agent draft did not make anyone else the preparer)');
for (const t of tests) await riley('POST', `/tests/${t.id}/review`, {});
const au = await admin('GET', '/audit?action=test.concluded');
ok(au.rows.some((r) => r.actor === 'Pat Preparer' && r.detail.startedFromAgentDraft?.proposed === 'fail'), 'audit records that the person started from the agent draft');
await expectErr(riley('POST', `/cards/${id2}/actions`, { action: 'approve' }), 409, 'a failed test with no issue blocks leaving Test');
await pat('POST', `/engagements/${E}/issues`, { title: 'Escalations without transcripts', severity: 'medium', testId: failDraft.id, controlId: failDraft.controlId, owner: 'Customer Experience Manager' });
await riley('POST', `/cards/${id2}/actions`, { action: 'approve' });
await waitFor('AI-2', (x) => x.stage === 'remediate', 'remediate');
await riley('POST', `/cards/${id2}/actions`, { action: 'advance' });
d = await waitFor('AI-2', (x) => x.stage === 'validate' && x.status === 'needs_approval', 'validate draft');
const v = d.card.drafts.validate;
ok(v && v.challenges.some((c) => c.ref === failDraft.key || /notes only/.test(c.finding)), `Review assistant raised ${v?.challenges.length} challenges (${v?.readiness})`);
await expectErr(pat('POST', `/cards/${id2}/actions`, { action: 'approve' }), 403, 'preparer cannot sign off Validate');
await riley('POST', `/cards/${id2}/actions`, { action: 'approve', note: 'Challenges read; failed test tracked' });
d = await waitFor('AI-2', (x) => x.stage === 'report' && x.status === 'needs_approval', 'report draft');
ok(!!d.card.drafts.report?.headline && !d.card.drafts.report.approvedBy, `Report Writer drafted: "${d.card.drafts.report?.headline}"`);
ok(/not ready/.test(d.card.drafts.report.headline) && /failed/.test(d.card.drafts.report.headline), 'the summary says a control failed, not "complete"');
await riley('POST', `/cards/${id2}/actions`, { action: 'approve' });
d = await waitFor('AI-2', (x) => x.stage === 'closed', 'closed');
ok(d.card.drafts.report.approvedBy === 'Riley Reviewer', 'approved summary records the person who approved it');

// ---- Guardrails on a live model (mock)
const prov = await admin('POST', '/providers', { type: 'openai', name: 'Mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: false, models: ['mock-good', 'mock-bad'] });
const id1 = await toEvidence('AI-1');
await waitFor('AI-1', (x) => x.stage === 'evidence' && x.status === 'needs_approval', 'AI-1 evidence');
await admin('PATCH', `/agents/${byRole.evidence_collector.id}`, { providerId: prov.id, model: 'mock-bad', fallbackModel: null, fallbackProviderId: null });
await riley('POST', `/cards/${id1}/actions`, { action: 'request_changes', note: 'Run again' });
d = await waitFor('AI-1', (x) => x.status === 'failed', 'bad evidence plan rejected');
ok(/keys that aren't part of this use case: C-999/.test(d.card.statusNote), 'invented control key rejected: ' + d.card.statusNote);
await admin('PATCH', `/agents/${byRole.evidence_collector.id}`, { model: 'mock-good' });
await riley('POST', `/cards/${id1}/actions`, { action: 'retry' });
d = await waitFor('AI-1', (x) => x.stage === 'evidence' && x.status === 'needs_approval', 'good evidence plan');
for (const c of d.controls) await pat('POST', '/evidence', { engagementId: E, controlId: c.id, title: `Export ${c.key}`, kind: 'note', note: 'Export reviewed.' });
await admin('PATCH', `/agents/${byRole.control_tester.id}`, { providerId: prov.id, model: 'mock-bad', fallbackModel: null, fallbackProviderId: null });
await riley('POST', `/cards/${id1}/actions`, { action: 'approve' });
d = await waitFor('AI-1', (x) => x.stage === 'test' && x.status === 'failed', 'bad tester rejected');
ok(/pass with 3 exceptions/.test(d.card.statusNote) && /E-999/.test(d.card.statusNote), 'pass-with-exceptions and foreign evidence rejected: ' + d.card.statusNote.slice(0, 160));
let t1 = (await admin('GET', `/engagements/${E}/tests`)).filter((t) => d.controls.some((c) => c.id === t.controlId));
ok(t1.every((t) => !t.draft), 'a rejected run leaves no drafts behind');
await admin('PATCH', `/agents/${byRole.control_tester.id}`, { model: 'mock-good' });
await riley('POST', `/cards/${id1}/actions`, { action: 'retry' });
await waitFor('AI-1', (x) => x.stage === 'test' && x.status === 'needs_approval', 'good tester');
t1 = (await admin('GET', `/engagements/${E}/tests`)).filter((t) => d.controls.some((c) => c.id === t.controlId));
ok(t1.every((t) => t.draft && t.draft.model === 'mock-good'), 'live drafts land on each test');
// Live Review assistant: the rule findings must survive whatever the model says
await admin('PATCH', `/agents/${byRole.independent_reviewer.id}`, { providerId: prov.id, model: 'mock-good', fallbackModel: null, fallbackProviderId: null });
await admin('PATCH', `/agents/${byRole.report_writer.id}`, { providerId: prov.id, model: 'mock-bad', fallbackModel: null, fallbackProviderId: null });
for (const t of t1) await pat('PATCH', `/tests/${t.id}`, { status: 'passed', actual: 'Sample of 25, no exceptions', exceptions: 0, sampleSize: 25 });
for (const t of t1) await riley('POST', `/tests/${t.id}/review`, {});
await riley('POST', `/cards/${id1}/actions`, { action: 'approve' });
await waitFor('AI-1', (x) => x.stage === 'remediate', 'AI-1 remediate');
await riley('POST', `/cards/${id1}/actions`, { action: 'advance' });
d = await waitFor('AI-1', (x) => x.stage === 'validate' && x.status === 'needs_approval', 'AI-1 validate');
ok(d.card.drafts.validate.challenges.some((c) => /notes only/.test(c.finding)) && d.card.drafts.validate.challenges.some((c) => /Mock:/.test(c.finding)), `rule findings kept alongside the model's (${d.card.drafts.validate.challenges.length})`);
ok(d.card.drafts.validate.readiness === 'not_ready', 'model said ready, but high rule findings keep it not ready');
await riley('POST', `/cards/${id1}/actions`, { action: 'approve' });
d = await waitFor('AI-1', (x) => x.stage === 'report' && x.status === 'failed', 'bad report rejected');
ok(/figures that aren't in the data: (97|14|250000)/.test(d.card.statusNote), 'invented figures rejected: ' + d.card.statusNote);
await admin('PATCH', `/agents/${byRole.report_writer.id}`, { model: 'mock-good' });
await riley('POST', `/cards/${id1}/actions`, { action: 'retry' });
d = await waitFor('AI-1', (x) => x.stage === 'report' && x.status === 'needs_approval', 'good report');
ok(d.card.drafts.report.model === 'mock-good', 'live report draft accepted');
const v2 = await admin('GET', '/audit/verify'); ok(v2.ok, v2.message);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
