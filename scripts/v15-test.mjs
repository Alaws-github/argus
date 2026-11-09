// v1.5 checks: AI that bends instead of breaking. Providers that rate-limit,
// refuse max_tokens, cut answers short, or return malformed or invalid JSON;
// the Use Case Planner's context (engagement, existing use cases, knowledge
// base, instructions), unclear input and suggestions; the assistant's
// workspace instructions; the offline rules as a fallback; golden runs with an
// engagement's context; the broader refusal check.
// Needs a FRESH database and a running server: npm run db:reset, npm start, npm run test:v15.
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

const admin = client();
await admin('POST', '/auth/setup', { name: 'Andrew Lawrence', email: 'andrew@example.com', password: 'correct-horse-9' });
for (const [n, e, r] of [['Riley Reviewer', 'riley@example.com', 'reviewer'], ['Sam Preparer', 'sam@example.com', 'preparer']]) await admin('POST', '/users', { name: n, email: e, role: r, password: 'correct-horse-9' });
const login = async (email) => { const c = client(); await c('POST', '/auth/login', { email, password: 'correct-horse-9' }); return c; };
const riley = await login('riley@example.com');
const sam = await login('sam@example.com');
const [eng] = await admin('GET', '/engagements'); const E = eng.id;
const agents = await admin('GET', `/engagements/${E}/agents`);
const byRole = Object.fromEntries(agents.map((a) => [a.role, a]));
const prov = await admin('POST', '/providers', { type: 'openai', name: 'Flaky mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: false, models: ['mock-good', 'mock-ratelimit', 'mock-maxtok', 'mock-truncate', 'mock-malformed', 'mock-badjson', 'mock-echo', 'mock-bad'] });
const rules = (await admin('GET', '/providers')).find((p) => p.type === 'rules');

const card = async (key) => (await admin('GET', `/cards/${key}`)).card;
const waitCard = async (key, pred, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const c = await card(key); if (pred(c)) return c; await sleep(400); } return card(key); };
const events = async (c) => (c.latestRunId ? (await admin('GET', `/runs/${c.latestRunId}`)).events.map((e) => e.text).join('\n') : '');

// ---- The shared model call: each flaky provider still gets a classification
console.log('\n# Providers that misbehave');
const classify = async (model, title) => {
  await admin('PATCH', `/agents/${byRole.risk_classifier.id}`, { providerId: prov.id, model, fallbackModel: null, fallbackProviderId: null });
  const c = await sam('POST', `/engagements/${E}/cards`, { title, businessOwner: 'Head of Credit', description: 'Scores loan applications for credit officers.', dataUsed: 'Credit bureau data', affectedPeople: 'Loan applicants', autonomy: 'human_in_loop', category: 'decision' });
  await riley('POST', `/cards/${c.id}/actions`, { action: 'approve' });
  return waitCard(c.key, (x) => x.stage === 'classify' && ['needs_approval', 'failed'].includes(x.status));
};
let c = await classify('mock-ratelimit', 'Rate limited scoring');
ok(c.status === 'needs_approval' && c.classification?.tier === 'high', `a 429 is retried and the run succeeds (${c.status} ${c.statusNote ?? ''})`);
c = await classify('mock-maxtok', 'Max tokens scoring');
ok(c.status === 'needs_approval', `a model that refuses max_tokens gets max_completion_tokens (${c.status} ${c.statusNote ?? ''})`);
c = await classify('mock-truncate', 'Truncated scoring');
ok(c.status === 'needs_approval', `an answer cut off at the output limit is asked again with more room (${c.status} ${c.statusNote ?? ''})`);
c = await classify('mock-malformed', 'Malformed scoring');
ok(c.status === 'needs_approval' && c.classification?.tier === 'high' && c.classification.risks[0].likelihood <= 5, `a format slip (likelihood 9, tier "High-risk") is repaired, not fatal (${c.status} ${c.statusNote ?? ''})`);
ok(/format problems .*corrected/.test(await events(c)), 'the run log says the model corrected its answer');
c = await classify('mock-badjson', 'Broken JSON scoring');
ok(c.status === 'needs_approval', `invalid JSON gets one more try (${c.status} ${c.statusNote ?? ''})`);
c = await classify('mock-bad', 'Cheating scoring');
ok(c.status === 'failed' && /sources it wasn't given/.test(c.statusNote ?? ''), 'a citation it was not given is still a hard failure, never repaired away');
// The offline rules as a fallback: a failed model still leaves a cautious draft.
await admin('PATCH', `/agents/${byRole.risk_classifier.id}`, { providerId: prov.id, model: 'mock-bad', fallbackProviderId: rules.id, fallbackModel: 'rules-v1' });
const fb = await sam('POST', `/engagements/${E}/cards`, { title: 'Fallback scoring', businessOwner: 'Head of Credit', description: 'Scores loan applications.', dataUsed: 'Credit data', affectedPeople: 'Applicants', autonomy: 'human_in_loop', category: 'decision' });
await riley('POST', `/cards/${fb.id}/actions`, { action: 'approve' });
c = await waitCard(fb.key, (x) => x.stage === 'classify' && ['needs_approval', 'failed'].includes(x.status));
ok(c.status === 'needs_approval' && /Falling back to rules-v1/.test(await events(c)), 'with the offline rules as fallback, a failed model still leaves a draft for a person');
await admin('PATCH', `/agents/${byRole.risk_classifier.id}`, { providerId: rules.id, model: 'rules-v1', fallbackModel: null, fallbackProviderId: null });

// ---- Use Case Planner, offline
console.log('\n# Use Case Planner (offline rules)');
let plan = await sam('POST', `/engagements/${E}/plans`, {});
plan = await sam('POST', `/plans/${plan.id}/messages`, { text: 'test' });
let reply = plan.messages.at(-1).text;
ok(/doesn't give me enough/.test(reply) && !plan.brief.title && !plan.brief.description, 'a test message is not put in the brief, and the Planner says why');
plan = await sam('POST', `/plans/${plan.id}/messages`, { text: 'Recommend an intake' });
reply = plan.messages.at(-1).text;
ok(/^1\. \*\*/m.test(reply) && /^3\. \*\*/m.test(reply) && !plan.brief.title, `asked for ideas, it suggests use cases and leaves the brief alone (${reply.split('\n')[2]})`);
ok(/Loan pre-approval|Fraud alert|chatbot/i.test(reply), 'the suggestions fit the client (a bank)');
plan = await sam('POST', `/plans/${plan.id}/messages`, { text: '2' });
ok(plan.brief.title && plan.brief.description && /accountable/i.test(plan.messages.at(-1).text), `picking "2" starts the brief from that suggestion (${plan.brief.title}) and asks for the owner`);
ok(!plan.brief.businessOwner && !plan.brief.dataUsed, 'a picked suggestion never invents an owner or data');

// ---- Use Case Planner, live: what reaches the model
console.log('\n# Use Case Planner (model context)');
await admin('PATCH', `/engagements/${E}`, { about: 'A Jamaican bank and insurer. Model Risk Committee approves every credit model.' });
await admin('PATCH', `/agents/${byRole.use_case_planner.id}`, { providerId: prov.id, model: 'mock-echo', instructions: 'Ask about the Model Risk Committee approval date.' });
await sam('POST', `/engagements/${E}/knowledge`, { title: 'Bank AI intake policy', text: 'Every new AI use case at the bank must name a business owner and list customer data before intake.' });
let lp = await sam('POST', `/engagements/${E}/plans`, {});
lp = await sam('POST', `/plans/${lp.id}/messages`, { text: 'A model that scores loan applications for customer data risk' });
reply = lp.messages.at(-1).text;
ok(/engagement:about/.test(reply), `the Planner gets the engagement and its description (${reply})`);
ok(/existing:[A-Z]+-\d/.test(reply), 'it sees the use cases already on the board, to spot duplicates');
ok(/sources:[1-9]/.test(reply) && /intake:true/.test(reply), 'it gets knowledge-base passages, including the intake guidance');
ok(/instructions:true/.test(reply), "it follows the agent's instructions box, added after its own rules");
ok(/upload:true/.test(reply), 'it finds documents uploaded to the Knowledge Base, not only the engagement summary');
await admin('PATCH', `/agents/${byRole.use_case_planner.id}`, { providerId: rules.id, model: 'rules-v1', instructions: '' });

// ---- The assistant: engagement description and workspace instructions
console.log('\n# Assistant');
const before = await admin('GET', '/settings');
await admin('PUT', '/settings', { assistantProviderId: prov.id, assistantModel: 'mock-echo', assistantInstructions: 'Use British spelling.' });
const [, ans] = await sam('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: 'Where do we stand?', newConversation: true });
ok(/about:true/.test(ans.text) && /instructions:true/.test(ans.text), `the assistant gets the engagement description and the workspace instructions (${ans.text})`);
ok((await admin('GET', '/settings')).assistantInstructions === 'Use British spelling.', 'the instructions are saved in the workspace settings');
await admin('PUT', '/settings', { assistantProviderId: before.assistantProviderId, assistantModel: before.assistantModel, assistantInstructions: '' });

// ---- Golden runs with an engagement's context
console.log('\n# Golden runs');
const gr = await admin('POST', '/agent-testing/runs', { agent: 'risk_classifier', providerId: rules.id, model: 'rules-v1', withVerifier: false, engagementId: E });
const t0 = Date.now(); let run;
while (Date.now() - t0 < 60000) { run = await admin('GET', `/agent-testing/runs/${gr.id}`); if (run.status !== 'running') break; await sleep(500); }
ok(run.status === 'done', `a golden run can use an engagement's description and instructions (${run.status})`);
ok((await admin('GET', '/audit?q=golden.run_started')).rows.some((r) => /Northshore|Client Zero/.test(JSON.stringify(r.detail))), 'the audit log names the engagement whose context it used');

const v = await admin('GET', '/audit/verify'); ok(v.ok, v.message);
console.log('\nThis test created accounts with the password correct-horse-9. Run npm run db:reset (with the app stopped) to clear them.');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
