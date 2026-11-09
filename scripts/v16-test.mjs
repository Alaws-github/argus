// v1.6 checks: agents that reason. The agent loop (look things up with
// read-only tools, then hand in a draft), single-call mode, follow-up questions
// that pause a run until a person answers or skips, tools it may not use,
// members-only records it must not see, the step limit, the self-check, models
// without tool calls, the assistant's look-ups and what it based an answer on,
// and golden runs that say which mode ran.
// Needs a FRESH database and a running server: npm run db:reset, npm start, npm run test:v16.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-model.cjs', import.meta.url))], { stdio: 'ignore' });
process.on('exit', () => mock.kill());
await new Promise((r) => setTimeout(r, 500));

const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
function client() { let cookie = ''; return async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } if (!r.ok) { const e = new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)}`); e.status = r.status; e.body = j; throw e; } return j; }; }
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };

const admin = client();
await admin('POST', '/auth/setup', { name: 'Andrew Lawrence', email: 'andrew@example.com', password: 'correct-horse-9' });
for (const [n, e, r] of [['Riley Reviewer', 'riley@example.com', 'reviewer'], ['Sam Preparer', 'sam@example.com', 'preparer'], ['Val Viewer', 'val@example.com', 'viewer']]) await admin('POST', '/users', { name: n, email: e, role: r, password: 'correct-horse-9' });
const login = async (email) => { const c = client(); await c('POST', '/auth/login', { email, password: 'correct-horse-9' }); return c; };
const riley = await login('riley@example.com');
const sam = await login('sam@example.com');
const val = await login('val@example.com');
const [eng] = await admin('GET', '/engagements'); const E = eng.id;
const agents = await admin('GET', `/engagements/${E}/agents`);
const byRole = Object.fromEntries(agents.map((a) => [a.role, a]));
const prov = await admin('POST', '/providers', { type: 'openai', name: 'Loop mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: false, models: ['mock-good', 'mock-agent', 'mock-asker', 'mock-rogue', 'mock-looper', 'mock-critic', 'mock-gemini', 'mock-notools', 'mock-bad', 'mock-echo'] });
const rules = (await admin('GET', '/providers')).find((p) => p.type === 'rules');
const C = byRole.risk_classifier.id;

const card = async (key) => (await admin('GET', `/cards/${key}`));
const waitCard = async (key, pred, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const c = (await card(key)).card; if (pred(c)) return c; await sleep(400); } return (await card(key)).card; };
const events = async (runId) => (await admin('GET', `/runs/${runId}`)).events.map((e) => e.text).join('\n');
const run = async (runId) => (await admin('GET', `/runs/${runId}`)).run;
const settled = (x) => x.stage === 'classify' && ['needs_approval', 'failed', 'question'].includes(x.status);
const classify = async (model, title, patch = {}) => {
  await admin('PATCH', `/agents/${C}`, { providerId: prov.id, model, fallbackModel: null, fallbackProviderId: null, mode: 'agentic', maxSteps: 8, selfCheck: true, ...patch });
  const c = await sam('POST', `/engagements/${E}/cards`, { title, businessOwner: 'Head of Credit', description: 'Scores loan applications for credit officers.', dataUsed: 'Credit bureau data', affectedPeople: 'Loan applicants', autonomy: 'human_in_loop', category: 'decision' });
  await riley('POST', `/cards/${c.id}/actions`, { action: 'approve' });
  return waitCard(c.key, settled);
};

// ---- The loop
console.log('\n# The agent loop');
ok(byRole.risk_classifier.mode === 'agentic' && byRole.risk_classifier.maxSteps === 8 && byRole.risk_classifier.selfCheck === true, 'agents start agentic, with 8 steps and the self-check on');
let c = await classify('mock-agent', 'Looks things up');
let ev = await events(c.latestRunId);
let r = await run(c.latestRunId);
ok(c.status === 'needs_approval', `an agent that searches first still hands in a valid draft (${c.status} ${c.statusNote ?? ''})`);
ok(/Searched the knowledge base for "human oversight/.test(ev) && /Read the engagement details/.test(ev), 'each look-up is written to the run log (rule 24)');
ok(/Self-check passed/.test(ev), 'it checks its own draft before handing it in');
ok(r.mode === 'agentic' && r.steps >= 2, `the run records the mode and the steps (${r.mode}, ${r.steps} steps)`);
const found = (ev.match(/human oversight[^(]*\((?:\d+) passages?: ([^)]+)\)/) || [])[1]?.split(', ') ?? [];
ok(found.length && (c.classification.tierSources ?? []).some((k) => found.includes(k)), `it may cite a passage it found itself (${c.classification.tierSources})`);

c = await classify('mock-agent', 'One call only', { mode: 'single' });
r = await run(c.latestRunId);
ok(c.status === 'needs_approval' && r.mode === 'single' && !/Searched the knowledge base/.test(await events(c.latestRunId)), 'single-call mode works as in v1.5: no look-ups');

c = await classify('mock-gemini', 'Gemini thought signatures');
ev = await events(c.latestRunId);
r = await run(c.latestRunId);
ok(c.status === 'needs_approval' && r.mode === 'agentic' && /Searched the knowledge base/.test(ev), `a Gemini-style thought signature on a tool call is sent back on the next step (${c.status} ${c.statusNote ?? ''})`);

c = await classify('mock-bad', 'Still cheating');
ok(c.status === 'failed' && /sources it wasn't given/.test(c.statusNote ?? ''), 'a citation it neither was given nor found is still a hard failure');

c = await classify('mock-notools', 'No tool calls');
ev = await events(c.latestRunId);
ok(c.status === 'needs_approval' && /doesn't take tool calls/.test(ev), 'a model without tool calls falls back to a single call');

// ---- Limits and refusals
console.log('\n# Limits and refusals');
c = await classify('mock-looper', 'Never stops searching', { maxSteps: 3 });
r = await run(c.latestRunId);
ok(c.status === 'needs_approval' && r.steps === 3, `at the step limit the agent must hand in its draft (rule 26: ${r.steps} steps)`);

const other = await admin('POST', '/engagements', {
  name: 'Private review', client: 'Kestrel Bay Telecom (test)', prefix: 'KBT', frameworks: ['nistAiRmf'], startSoa: false,
  appetite: { maxResidual: 6, statement: '', escalateTo: 'Board' }, gates: { classify: true },
  agents: { risk_classifier: { providerId: rules.id, model: 'rules-v1', effort: 'low' } },
});
const secret = await admin('POST', `/engagements/${other.id}/cards`, { title: 'Secret churn model', businessOwner: 'Head of Retention', description: 'Predicts churn.', dataUsed: 'Call records', affectedPeople: 'Subscribers', autonomy: 'assistive', category: 'analytics' });
await admin('PUT', `/engagements/${other.id}/access`, { access: 'members' });
c = await classify('mock-rogue', 'Tries to peek', { instructions: `PEEK:${secret.key}` });
ev = await events(c.latestRunId);
ok(/Tried a tool it may not use \(delete_card\); refused/.test(ev), 'a tool it may not use is refused and logged (rule 23)');
ok(new RegExp(`Looked for ${secret.key}: not found`).test(ev), "another engagement's members-only use case is not found");
ok(c.status === 'needs_approval' && !(c.classification?.factors ?? []).join(' ').includes('Secret churn'), 'nothing from it reaches the draft');
await admin('PATCH', `/agents/${C}`, { instructions: '' });

c = await classify('mock-critic', 'Checks itself');
ev = await events(c.latestRunId);
ok(c.status === 'needs_approval' && /Self-check found 1 thing to fix: The privacy risk cites no passage/.test(ev), 'what the self-check finds goes back to the agent to fix, not to a person');
c = await classify('mock-critic', 'Self-check off', { selfCheck: false });
ok(!/Self-check/.test(await events(c.latestRunId)), 'with the self-check off, no critique runs');

// ---- Questions (rule 27)
console.log('\n# Questions for a person');
c = await classify('mock-asker', 'Needs an answer');
let d = await card(c.key);
const q1 = d.questions.find((x) => x.status === 'open');
ok(c.status === 'question' && /asks: Who signs off a declined loan application/.test(c.statusNote ?? ''), `the run pauses and the card shows the question (${c.status})`);
ok(q1 && q1.askedTo === 'business_owner' && q1.why, 'the question says who should answer and why');
ok(d.runs[0].status === 'waiting', 'the run is recorded as waiting, not failed');
ok((await admin('GET', `/audit?q=agent.asked`)).rows.some((x) => x.entity === `card:${c.key}`), 'the question is in the audit log');
ok((await status(val('POST', `/cards/${c.id}/questions/${q1.id}/answer`, { answer: 'x' }))) === 403, 'a viewer cannot answer');
ok((await status(sam('POST', `/cards/${c.id}/questions/${q1.id}/answer`, { answer: '  ' }))) === 400, 'an empty answer is refused');
await sam('POST', `/cards/${c.id}/questions/${q1.id}/answer`, { answer: 'The credit committee signs off every decline.' });
ok((await status(sam('POST', `/cards/${c.id}/questions/${q1.id}/answer`, { answer: 'again' }))) === 409, 'a question is answered once');
c = await waitCard(c.key, (x) => x.status === 'needs_approval' || x.status === 'failed');
ok(c.status === 'needs_approval' && (c.classification?.factors ?? []).some((f) => /Answer from Sam Preparer: The credit committee/.test(f)), 'the answer reaches the agent, under the name of who gave it');
ok((await admin('GET', `/audit?q=agent.answered`)).rows.some((x) => x.actor === 'Sam Preparer'), 'the answer is audited under the person');
ok(c.stage === 'classify', 'an answer informs the draft; it never approves anything (rule 1)');

c = await classify('mock-asker', 'Question skipped');
d = await card(c.key);
await riley('POST', `/cards/${c.id}/questions/${d.questions[0].id}/skip`, {});
c = await waitCard(c.key, (x) => x.status === 'needs_approval' || x.status === 'failed');
ok(c.status === 'needs_approval' && (await card(c.key)).questions[0].status === 'skipped', 'a skipped question lets the agent carry on with what it has');

await admin('PATCH', `/agents/${C}`, { tools: ['read_profile', 'read_register'] });
c = await classify('mock-asker', 'Asking switched off');
ok(c.status === 'needs_approval' && !(await card(c.key)).questions.length, 'with asking unticked, the agent cannot pause the run');
await admin('PATCH', `/agents/${C}`, { tools: ['read_profile', 'read_register', 'ask'] });

// ---- The assistant
console.log('\n# The assistant');
const before = await admin('GET', '/settings');
await sam('POST', `/engagements/${E}/knowledge`, { title: 'Credit oversight note', text: 'Human oversight of credit decisions: a credit officer reviews every decline before it is sent.' });
await admin('PUT', '/settings', { assistantProviderId: prov.id, assistantModel: 'mock-agent' });
const [, a1] = await sam('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: 'How should declines be overseen?', newConversation: true });
ok(a1.trail.some((t) => /Searched the knowledge base/.test(t)), `the assistant looks things up and shows its steps (${a1.trail.length})`);
ok(a1.citations.length && a1.basis.includes('knowledge') && !a1.citations.includes('K-99999'), `it may cite what it found; an invented citation is still dropped (${a1.citations})`);
ok(!a1.passages.some((p) => /^About /.test(p.title)), 'the engagement summary is never shown as a source');
await admin('PUT', '/settings', { assistantModel: 'mock-echo' });
const [, a2] = await sam('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: "What's on this page?", page: { path: '/board', snapshot: 'Board\nIntake\nClassify risk' }, newConversation: true });
ok(a2.basis.includes('page') && !a2.passages.length, `a question about the page is answered from the page, not the knowledge base (${a2.basis})`);
await admin('PUT', '/settings', { assistantProviderId: before.assistantProviderId, assistantModel: before.assistantModel });

// ---- Golden runs
console.log('\n# Golden runs');
const golden = async (mode) => {
  const g = await admin('POST', '/agent-testing/runs', { agent: 'risk_classifier', providerId: prov.id, model: 'mock-agent', withVerifier: false, mode });
  const t0 = Date.now(); let x;
  while (Date.now() - t0 < 90000) { x = await admin('GET', `/agent-testing/runs/${g.id}`); if (x.status !== 'running') break; await sleep(500); }
  return x;
};
const g1 = await golden('agentic');
const g2 = await golden('single');
ok(g1.mode === 'agentic' && g2.mode === 'single' && g1.status === 'done' && g2.status === 'done', `golden runs say which mode ran, so the two can be compared (${g1.mode} ${g1.status}, ${g2.mode} ${g2.status})`);

await admin('PATCH', `/agents/${C}`, { providerId: rules.id, model: 'rules-v1' });
const v = await admin('GET', '/audit/verify'); ok(v.ok, v.message);
console.log('\nThis test created accounts with the password correct-horse-9. Run npm run db:reset (with the app stopped) to clear them.');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
