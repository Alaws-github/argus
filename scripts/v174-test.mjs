// v1.7.4 checks: use cases that follow no client workflow, the engagement
// default, steps without a proof as context only, confirming only "a person
// confirms it" steps, the Client tools and workflows module, scheduled checks
// and the plainer Verifier wording. (Requiring client steps before sign-off is
// checked in agents-test.mjs, which takes a use case all the way to sign-off.)
// Needs a fresh database and a server started with MONITOR_TICK_MS=1000.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-model.cjs', import.meta.url))], { stdio: 'ignore' });
process.on('exit', () => mock.kill());
await new Promise((r) => setTimeout(r, 600));

const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
const M = 'http://127.0.0.1:4401';
function client() { let cookie = ''; const c = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } if (!r.ok) { const e = new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)}`); e.status = r.status; e.body = j; throw e; } return j; }; return c; }
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = client();
await admin('POST', '/auth/setup', { name: 'Andrew Admin', email: 'andrew@example.com', password: 'correct-horse-9' }).catch(() => admin('POST', '/auth/login', { email: 'andrew@example.com', password: 'correct-horse-9' }));
for (const [name, email, role] of [['Lee Lead', 'lee@example.com', 'lead'], ['Pat Preparer', 'pat@example.com', 'preparer']]) await admin('POST', '/users', { name, email, role, password: 'correct-horse-9' }).catch(() => {});
const login = async (email) => { const c = client(); await c('POST', '/auth/login', { email, password: 'correct-horse-9' }); return c; };
const lee = await login('lee@example.com');
const pat = await login('pat@example.com');
const [eng] = await admin('GET', '/engagements'); const E = eng.id;
await admin('PUT', '/settings', { connectorsAllowPrivate: true });

console.log('\n# The Client tools and workflows module');
const rulesP = (await admin('GET', '/providers')).find((p) => p.type === 'rules');
const AG = { appetite: { maxResidual: 6, statement: '', escalateTo: 'Board' }, gates: { classify: true, design: true }, agents: { risk_classifier: { providerId: rulesP.id, model: 'rules-v1', effort: 'low' }, control_designer: { providerId: rulesP.id, model: 'rules-v1', effort: 'low' } } };
const plain = await lee('POST', '/engagements', { name: 'In-app only', client: 'Plain Client', prefix: 'PL', frameworks: ['nistAiRmf'], ...AG });
ok(plain.modules.connectors === false, 'an engagement added without a workflow or tools starts with the module off');
const withWf = await lee('POST', '/engagements', { name: 'With a workflow', client: 'Tools Client', prefix: 'TC', frameworks: ['nistAiRmf'], workflow: { template: 'standard' }, ...AG });
ok(withWf.modules.connectors === true, 'choosing a client workflow when adding the engagement switches the module on');

console.log('\n# Following a client workflow, or not');
const jira = await lee('POST', `/engagements/${E}/connectors`, { name: 'GRC tickets', url: `${M}/proof/jira/search`, auth: 'none', tool: 'jira', schedule: 'daily' });
const w = await lee('POST', `/engagements/${E}/workflows`, { name: 'Credit model approval', template: 'standard' });
const g = JSON.parse(JSON.stringify(w.graph));
const steps0 = g.nodes.filter((n) => ['person', 'task', 'notify'].includes(n.type));
steps0[0].config = { ...steps0[0].config, tool: 'jira', connectorId: jira.id, proof: 'status', proofStatus: 'Approved' };
steps0[1].config = { ...steps0[1].config, proof: 'manual' };
steps0[2].config = { ...steps0[2].config, tool: 'teams', toolDetail: 'Model Risk channel' }; // shown as context only
await lee('PATCH', `/workflows/${w.id}`, { graph: g });
await lee('POST', `/workflows/${w.id}/publish`, {});
let cs = await pat('GET', '/cards/AI-1/client-steps');
ok(cs.mode === 'auto' && !cs.off && cs.workflow?.id === w.id, 'by default a use case follows the latest published workflow');
ok(cs.summary.total === 2, `only steps with a proof count towards done (${cs.summary.total} of ${cs.steps.length} steps tracked)`);
ok(cs.steps.filter((s) => !s.proof).every((s) => s.detail === ''), 'steps without a proof carry no "not set" note');
ok(await status(pat('POST', `/cards/AI-1/client-steps/${steps0[0].id}/confirm`, { link: 'https://x.example/1' })) === 409, 'a step checked through a connector cannot be confirmed by hand');
const untracked = cs.steps.find((s) => !s.proof);
ok(await status(pat('POST', `/cards/AI-1/client-steps/${untracked.nodeId}/confirm`, { link: 'https://x.example/1' })) === 409, 'a step with no proof cannot be confirmed');
ok((await pat('POST', `/cards/AI-1/client-steps/${steps0[1].id}/confirm`, { note: 'Minutes in the committee folder' })).summary.passed === 1, 'a "person confirms it" step can be confirmed');
cs = await pat('PUT', '/cards/AI-1/workflow', { mode: 'none' });
ok(cs.off && cs.mode === 'none' && cs.steps.length === 0, 'a use case can follow no client workflow');
ok(await status(pat('POST', '/cards/AI-1/client-steps/check')) === 409, 'and then there is nothing to check');
cs = await pat('PUT', '/cards/AI-1/workflow', { mode: 'pinned', workflowId: w.id });
ok(cs.mode === 'pinned' && cs.workflow.id === w.id && cs.steps.length, 'it can follow a chosen workflow again');
ok(await status(pat('PUT', '/cards/AI-1/workflow', { mode: 'pinned' })) === 400, 'pinning needs a workflow');
await pat('PUT', '/cards/AI-1/workflow', { mode: 'auto' });
const off = await lee('PATCH', `/engagements/${E}`, { clientStepsDefault: false });
ok(off.clientStepsDefault === false, 'a lead sets the engagement default to no client workflow');
cs = await pat('GET', '/cards/AI-2/client-steps');
ok(cs.off && cs.mode === 'auto' && !cs.defaultOn, 'use cases on the default then follow none');
cs = await pat('PUT', '/cards/AI-2/workflow', { mode: 'pinned', workflowId: w.id });
ok(!cs.off && cs.steps.length, 'one use case can still opt in');
ok(await status(pat('PATCH', `/engagements/${E}`, { clientStepsDefault: true })) === 403, 'a preparer cannot change the engagement default');
await lee('PATCH', `/engagements/${E}`, { clientStepsDefault: true });
const au = (await admin('GET', '/audit?q=card.workflow_set')).rows;
ok(au.some((a) => a.detail.workflow === 'no client workflow'), 'choosing no client workflow is audited');

console.log('\n# Scheduled checks');
let scheduled = [];
for (let i = 0; i < 15 && !scheduled.length; i++) { await wait(1000); scheduled = (await admin('GET', '/audit?q=client_step.checked')).rows.filter((a) => a.actor === 'Client step schedule'); }
ok(scheduled.some((a) => a.detail.useCase === 'AI-1' && a.detail.status === 'passed'), `steps whose connector pulls daily are checked on a schedule (${scheduled.length} checks)`);
ok(!scheduled.some((a) => a.detail.useCase === 'AI-1' && a.detail.node === steps0[1].id), 'a "person confirms it" step is never checked by the schedule');
const before = scheduled.length;
await wait(3000);
ok((await admin('GET', '/audit?q=client_step.checked')).rows.filter((a) => a.actor === 'Client step schedule').length === before, 'a step checked within its period is not checked again');

console.log('\n# Plainer Verifier wording');
const pv = await admin('POST', '/cards/AI-3/verify', {}).catch((e) => e.body);
const reasons = JSON.stringify(pv ?? {});
ok(!/key terms \(/.test(reasons), 'the Verifier no longer lists word stems in its reasons');

console.log('\n# Every requirement of each framework');
let rq = await lee('GET', `/engagements/${E}/requirements`);
const nist = rq.frameworks.find((f) => f.id === 'nistAiRmf');
const iso = rq.frameworks.find((f) => f.id === 'iso42001');
ok(nist?.total === 72 && iso?.total === 65, `the complete lists are used: NIST AI RMF ${nist?.total} subcategories, ISO/IEC 42001 ${iso?.total} clauses and Annex A controls`);
ok(rq.frameworks.every((f) => f.proven + f.inProgress + f.gap + f.notApplicable === f.total), 'every requirement has exactly one status');
ok(!nist.fullyMet && nist.gap > 0, 'a framework with gaps is not shown as fully met');
const g17 = nist.rows.find((r) => r.id === 'GOVERN 1.7');
ok(g17.status === 'gap' && g17.next === 'No control in place meets it', 'a requirement no control meets is a gap, and says so');
await lee('POST', `/engagements/${E}/controls/import`, { filename: 'c.csv', dataBase64: Buffer.from('Title,Objective,Type\nAI systems retired safely,Retired AI systems are switched off and their data handled,preventive\n').toString('base64'), preview: false });
const ctl1 = (await lee('GET', `/engagements/${E}/requirements`)).controls[0];
rq = await pat('POST', `/controls/${ctl1.id}/refs`, { framework: 'nistAiRmf', ref: 'GOVERN 1.7' });
ok(rq.frameworks[0].rows.find((r) => r.id === 'GOVERN 1.7').status !== 'gap', 'mapping one of the engagement\'s controls closes the gap');
ok(await status(pat('PUT', `/engagements/${E}/requirements/nistAiRmf`, { ref: 'MEASURE 2.12', applicable: false, reason: 'No such need here' })) === 403, 'a preparer cannot scope a requirement out');
ok(await status(lee('PUT', `/engagements/${E}/requirements/nistAiRmf`, { ref: 'MEASURE 2.12', applicable: false, reason: 'short' })) === 400, 'scoping a requirement out needs a real reason');
rq = await lee('PUT', `/engagements/${E}/requirements/nistAiRmf`, { ref: 'MEASURE 2.12', applicable: false, reason: 'The client runs no models of its own; vendors report their environmental impact under the contract.' });
ok(rq.frameworks[0].rows.find((r) => r.id === 'MEASURE 2.12').status === 'not_applicable', 'a lead can mark a requirement not applicable with a reason');
ok(await status(lee('PUT', `/engagements/${E}/requirements/nistAiRmf`, { ref: 'MEASURE 9.9', applicable: false, reason: 'Not a real requirement at all' })) === 404, 'a requirement that does not exist is refused');
const hz = await lee('GET', `/engagements/${E}/harmonization`);
ok(hz.frameworks.find((f) => f.id === 'nistAiRmf').total === 72, 'Across Frameworks counts against the complete list too');
const ow = await lee('POST', '/engagements', { name: 'Chatbot red team', client: 'Red Team Client', prefix: 'RT', frameworks: ['owasp'], ...AG });
let owq = await lee('GET', `/engagements/${ow.id}/requirements`);
ok(owq.frameworks.length === 1 && owq.frameworks[0].total === 20, 'OWASP has its 20 LLM and agentic risks');
for (const r of owq.frameworks[0].rows) owq = await lee('PUT', `/engagements/${ow.id}/requirements/owasp`, { ref: r.id, applicable: false, reason: 'Out of scope for this test engagement, checked by the lead.' });
ok(owq.frameworks[0].fullyMet === true, 'a framework is fully met only when every requirement is proven or not applicable');
ok((await admin('GET', '/audit?q=requirement.not_applicable')).rows.length >= 21, 'each scoping decision is audited');

console.log('\n# Editing and deleting assistant conversations');
const ask = (who, body) => who('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', ...body });
const [q1] = await ask(pat, { question: 'Which use cases are high risk?', newConversation: true });
await ask(pat, { question: 'And which controls are untested?', conversationId: q1.conversationId });
let conv = await pat('GET', `/engagements/${E}/assistant/conversations/${q1.conversationId}`);
ok(conv.messages.length === 4, 'a conversation with two questions and two answers');
const [q2] = await ask(pat, { question: 'Which use cases use personal data?', conversationId: q1.conversationId, replaceFrom: conv.messages[2].id });
conv = await pat('GET', `/engagements/${E}/assistant/conversations/${q1.conversationId}`);
ok(conv.messages.length === 4 && conv.messages[2].text === 'Which use cases use personal data?' && !conv.messages.some((m) => /untested/.test(m.text)), 'editing a question replaces it and the answer after it');
ok(await status(ask(pat, { question: 'Edit an answer?', conversationId: q1.conversationId, replaceFrom: conv.messages[3].id })) === 404, 'only your own questions can be edited, not answers');
ok(await status(ask(lee, { question: 'Edit someone else\'s?', conversationId: q1.conversationId, replaceFrom: conv.messages[2].id })) === 404, "nobody can edit someone else's conversation");
const renamed = await pat('PATCH', `/engagements/${E}/assistant/conversations/${q1.conversationId}`, { title: 'Personal data questions' });
ok(renamed.title === 'Personal data questions', 'a conversation can be renamed');
ok(await status(lee('DELETE', `/engagements/${E}/assistant/conversations/${q1.conversationId}`)) === 404, "nobody can delete someone else's conversation");
await pat('DELETE', `/engagements/${E}/assistant/conversations/${q1.conversationId}`);
ok(await status(pat('GET', `/engagements/${E}/assistant/conversations/${q1.conversationId}`)) === 404 && !(await pat('GET', `/engagements/${E}/assistant/conversations`)).some((c) => c.id === q1.conversationId), 'deleting removes the conversation and its messages');
const au2 = (await admin('GET', '/audit?q=assistant.')).rows.map((x) => x.action);
ok(au2.includes('assistant.question_edited') && au2.includes('assistant.conversation_deleted') && au2.filter((x) => x === 'assistant.answered').length >= 3, 'edits and deletes are audited, and the record of each question asked stays');

const v = await admin('GET', '/audit/verify'); ok(v.ok, v.message);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
