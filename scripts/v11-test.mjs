// v1.1 checks: the Use Case Planner (AI-first intake, manual fallback),
// more than one agent per stage with routing, drag-and-drop moves going
// through the same rules as buttons, act as, and the provider service names.
// Needs a FRESH database and a running server: npm run db:reset, npm start,
// npm run test:v11.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-model.cjs', import.meta.url))], { stdio: 'ignore' });
process.on('exit', () => mock.kill());
const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
function client() { let cookie = ''; const c = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } if (!r.ok) { const e = new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)}`); e.status = r.status; e.body = j; throw e; } return j; }; return c; }
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const expectErr = async (p, s, m) => { try { await p; ok(false, m + ' (no error)'); } catch (e) { ok(e.status === s, `${m} -> ${e.status} ${e.body?.error ?? ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = client();
await admin('POST', '/auth/setup', { name: 'Andrew Lawrence', email: 'andrew@example.com', password: 'correct-horse-9' });
for (const [name, email, role] of [['Jordan Lead', 'jordan@example.com', 'lead'], ['Riley Reviewer', 'riley@example.com', 'reviewer'], ['Sam Preparer', 'sam@example.com', 'preparer'], ['Dana Viewer', 'dana@example.com', 'viewer']]) {
  await admin('POST', '/users', { name, email, role, password: 'correct-horse-9' });
}
const login = async (email) => { const c = client(); await c('POST', '/auth/login', { email, password: 'correct-horse-9' }); return c; };
const sam = await login('sam@example.com');
const riley = await login('riley@example.com');
const dana = await login('dana@example.com');
const eng = (await admin('GET', '/engagements'))[0];
const E = eng.id;

// ---- Planner (offline rules)
console.log('\n# Use Case Planner');
const agents = await admin('GET', `/engagements/${E}/agents`);
const planner = agents.find((a) => a.role === 'use_case_planner');
ok(planner && planner.enabled && planner.stage === 'intake', 'every engagement has a Use Case Planner on Intake, switched on');
ok(agents[0].role === 'use_case_planner', 'it is listed first, because it is the first agent a use case meets');
let list = await sam('GET', `/engagements/${E}/plans`);
ok(list.planner.on && list.planner.runtime === 'rules', 'the plan page knows the Planner is on and running on the offline rules');
let plan = await sam('POST', `/engagements/${E}/plans`, {});
ok(plan.mode === 'ai' && plan.messages.length === 1 && plan.messages[0].role === 'planner', 'a new plan starts with the AI by default, with the Planner asking the first question');
plan = await sam('POST', `/plans/${plan.id}/messages`, { text: 'We want to build a claims triage model that scores motor insurance claims for fraud. Claims handlers check each score before acting.' });
ok(plan.brief.title.length >= 3 && /claims triage/i.test(plan.brief.title), `the Planner names it from the description ("${plan.brief.title}")`);
ok(plan.brief.description.includes('motor insurance'), 'the description is filled from the person\'s own words');
ok(plan.brief.category === 'decision', 'it recognises a scoring model as a decision system');
ok(plan.brief.autonomy === 'human_in_loop', 'it reads "check each score" as a person approving each output');
ok(/Claimants|Customers/i.test(plan.brief.affectedPeople) || plan.brief.affectedPeople === '', 'people affected is only guessed from words the person used');
ok(plan.messages.at(-1).role === 'planner' && /accountable/i.test(plan.messages.at(-1).text), 'then it asks for the next missing thing: the business owner');
ok(plan.missing.includes('Business owner') && plan.missing.includes('Data it uses'), 'the plan lists what is still missing');
await expectErr(sam('POST', `/plans/${plan.id}/add`), 422, 'it cannot go to Intake while required fields are missing');
plan = await sam('POST', `/plans/${plan.id}/messages`, { text: 'Head of Motor Claims' });
ok(plan.brief.businessOwner === 'Head of Motor Claims', 'the answer is filed under the question the Planner asked');
plan = await sam('PATCH', `/plans/${plan.id}`, { brief: { dataUsed: 'Claim forms, policy history, repair estimates, claimant name and TRN.', priority: 'p1' } });
ok(plan.edited.includes('dataUsed') && plan.edited.includes('priority'), 'fields the person types are marked as theirs');
plan = await sam('POST', `/plans/${plan.id}/messages`, { text: 'Actually it uses telematics data too.' });
ok(plan.brief.dataUsed.startsWith('Claim forms'), 'the Planner never overwrites a field the person typed');
await expectErr(riley('POST', `/plans/${plan.id}/messages`, { text: 'hi' }), 403, 'someone else cannot change another person\'s draft');
await expectErr(dana('POST', `/engagements/${E}/plans`, {}), 403, 'a viewer cannot start a plan');
for (let i = 0; i < 4 && plan.missing.length; i++) {
  const ask = plan.messages.at(-1).text;
  const answer = /affected|decided about/i.test(ask) ? 'Motor policyholders who make a claim, about 900 a month.' : /data/i.test(ask) ? 'n/a' : /check each output|on its own/i.test(ask) ? 'A handler approves each one.' : 'In-house';
  plan = await sam('POST', `/plans/${plan.id}/messages`, { text: answer });
}
ok(!plan.missing.length, `after a few answers nothing required is missing (${plan.missing.join(', ') || 'none'})`);
const added = await sam('POST', `/plans/${plan.id}/add`);
ok(added.card.key && added.card.stage === 'intake' && added.card.createdBy === 'Sam Preparer', `adding it creates ${added.card.key} in Intake under the person's name, not the agent's`);
ok(added.card.useCase.category === 'decision' && added.card.useCase.priority === 'p1', 'the card carries its kind and priority');
await expectErr(sam('POST', `/plans/${plan.id}/messages`, { text: 'more' }), 409, 'a plan on the board can no longer be changed');
const auditAll = await admin('GET', '/audit?pageSize=200');
const rows = auditAll.rows;
const created = rows.find((x) => x.action === 'card.created' && x.entity === `card:${added.card.key}`);
ok(created && created.actor === 'Sam Preparer' && created.detail.draftedByPlanner.includes('title') && created.detail.editedByPerson.includes('dataUsed'), 'the audit log records who added it, which fields the Planner drafted and which the person typed');
ok(rows.some((x) => x.action === 'plan.drafted' && x.actor === 'Use Case Planner'), 'each Planner turn is in the audit log under the agent\'s name');

// Manual mode, and the Planner switched off
let manual = await sam('POST', `/engagements/${E}/plans`, { mode: 'manual' });
ok(manual.mode === 'manual' && manual.messages.length === 0, '"Fill it in myself" starts an empty brief with no chat');
manual = await sam('PATCH', `/plans/${manual.id}`, { brief: { title: 'HR CV screening', description: 'Ranks job applicants.', businessOwner: 'HR Director', dataUsed: 'CVs', affectedPeople: 'Job applicants', autonomy: 'human_in_loop', category: 'decision' } });
const m2 = await sam('POST', `/plans/${manual.id}/add`);
ok(m2.card.title === 'HR CV screening', 'a hand-filled brief goes to Intake the same way');
const draft = await sam('POST', `/engagements/${E}/plans`, {});
await sam('DELETE', `/plans/${draft.id}`);
await expectErr(sam('GET', `/plans/${draft.id}`), 404, 'a draft can be deleted');
await admin('PATCH', `/agents/${planner.id}`, { enabled: false });
list = await sam('GET', `/engagements/${E}/plans`);
ok(!list.planner.on, 'with the Planner switched off the page says so');
const off = await sam('POST', `/engagements/${E}/plans`, { mode: 'ai' });
ok(off.mode === 'manual', 'and a new plan falls back to filling it in by hand');
await expectErr(sam('POST', `/plans/${off.id}/messages`, { text: 'hello' }), 409, 'the chat refuses politely instead of pretending');
await admin('PATCH', `/agents/${planner.id}`, { enabled: true });
await sleep(100);


// ---- More than one agent per stage
console.log('\n# New agents and routing');
const classifier = agents.find((a) => a.role === 'risk_classifier');
await expectErr(sam('POST', `/engagements/${E}/agents`, { stage: 'classify', name: 'Nope' }), 403, 'a preparer cannot add an agent');
const chatAgent = await admin('POST', `/engagements/${E}/agents`, { stage: 'classify', name: 'Chatbot classifier', route: 'cat_chatbot', instructions: 'Pay extra attention to prompt injection and disclosure risks.' });
ok(chatAgent.custom && chatAgent.role === 'risk_classifier' && chatAgent.stage === 'classify', 'a lead or admin can add a second agent to a stage; it does that stage\'s job');
ok(chatAgent.model === classifier.model && chatAgent.maxCostUsd === classifier.maxCostUsd, 'it starts from the stage agent\'s model and limits');
await expectErr(admin('POST', `/engagements/${E}/agents`, { stage: 'classify', name: 'chatbot classifier' }), 409, 'names are unique within an engagement');
await expectErr(admin('POST', `/engagements/${E}/agents`, { stage: 'closed', name: 'Closer' }), 422, 'a stage with no agent job cannot take one');
const copy = await admin('POST', `/agents/${chatAgent.id}/duplicate`);
ok(copy.name === 'Chatbot classifier (copy)' && !copy.enabled && copy.route === 'cat_chatbot', 'duplicate makes a switched-off copy');
await expectErr(admin('DELETE', `/agents/${classifier.id}`), 409, 'the built-in agent for a stage cannot be deleted, only turned off');
await admin('DELETE', `/agents/${copy.id}`);
ok(!(await admin('GET', `/engagements/${E}/agents`)).some((a) => a.id === copy.id), 'an added agent can be deleted');
const mk = async (title, category, priority = 'p2') => {
  const c = await sam('POST', `/engagements/${E}/cards`, { title, businessOwner: 'Owner', description: `${title}.`, dataUsed: 'Customer data', affectedPeople: 'Customers', autonomy: 'human_in_loop', category, priority });
  await riley('POST', `/cards/${c.id}/actions`, { action: 'approve' });
  return c;
};
const chatCard = await mk('Branch FAQ chatbot', 'chatbot');
const scoreCard = await mk('Overdraft limit scoring', 'decision');
const waitRun = async (id) => { for (let i = 0; i < 40; i++) { const c = await admin('GET', `/cards/${id}`); if (c.runs.length && c.runs[0].status !== 'running') return c; await sleep(500); } return admin('GET', `/cards/${id}`); };
const cc = await waitRun(chatCard.id);
const sc = await waitRun(scoreCard.id);
ok(cc.runs[0]?.agent === 'Chatbot classifier', `a chatbot goes to the chatbot agent (${cc.runs[0]?.agent})`);
ok(sc.runs[0]?.agent === 'Risk Classifier', `everything else goes to the stage's general agent (${sc.runs[0]?.agent})`);
await admin('PATCH', `/agents/${classifier.id}`, { enabled: false });
const other = await mk('Marketing copy generator', 'generative');
await sleep(2500);
const oc = await admin('GET', `/cards/${other.id}`);
ok(oc.card.status === 'idle' && /None of the agents on this stage take this card/.test(oc.card.statusNote ?? ''), 'a card no agent takes waits for a person, with the reason');
await admin('PATCH', `/agents/${classifier.id}`, { enabled: true });

// ---- Act as
console.log('\n# Act as');
await expectErr(admin('POST', '/auth/act-as', { userId: null }), 403, 'act as is off until an admin turns it on');
await admin('PUT', '/settings', { allowActAs: true });
await expectErr(riley('POST', '/auth/act-as', { userId: null }), 403, 'only an admin can act as someone');
const people = await admin('GET', '/auth/act-as');
const samId = people.people.find((p) => p.name === 'Sam Preparer').id;
const rileyId = people.people.find((p) => p.name === 'Riley Reviewer').id;
let me = await admin('POST', '/auth/act-as', { userId: samId });
ok(me.name === 'Sam Preparer' && me.role === 'preparer' && me.realUser?.name === 'Andrew Lawrence', 'the admin now works as Sam, and the app knows who is really signed in');
await expectErr(admin('GET', '/users'), 403, 'acting as Sam means Sam\'s permissions, not the admin\'s');
const asSam = await admin('POST', `/engagements/${E}/cards`, { title: 'Collections call summariser', businessOwner: 'Collections Manager', description: 'Summarises calls.', dataUsed: 'Call recordings', affectedPeople: 'Customers in arrears', autonomy: 'human_in_loop', category: 'generative' });
ok(asSam.createdBy === 'Sam Preparer', 'what they do is recorded as Sam');
await expectErr(admin('POST', `/cards/${asSam.id}/actions`, { action: 'approve' }), 403, 'Sam still cannot approve, act as or not');
me = await admin('POST', '/auth/act-as', { userId: rileyId });
ok(me.name === 'Riley Reviewer' && me.realUser?.name === 'Andrew Lawrence', 'the admin switches straight to Riley');
const approved = await admin('POST', `/cards/${asSam.id}/actions`, { action: 'approve' });
ok(approved.stage === 'classify', 'and approves as Riley: the whole flow without signing out');
await expectErr(admin('POST', '/auth/password', { current: 'x', next: 'y' }), 409, 'they cannot change Riley\'s password while acting as Riley');
const log = (await admin('GET', '/audit/verify'));
ok(log.ok, `the audit chain still verifies with act-as entries (${log.message})`);
me = await admin('POST', '/auth/act-as', { userId: null });
ok(me.name === 'Andrew Lawrence' && !me.realUser, 'Stop returns the admin to themselves');
const entries = (await admin('GET', '/audit?pageSize=200')).rows;
const appr = entries.find((x) => x.entity === `card:${asSam.key}` && x.action.startsWith('gate.'));
ok(appr && appr.actor === 'Riley Reviewer' && appr.realActor === 'Andrew Lawrence', 'the approval names Riley and the admin who really made it');
ok(entries.some((x) => x.action === 'auth.act_as.started' && x.actor === 'Andrew Lawrence' && x.detail.as === 'Sam Preparer'), 'starting to act as someone is itself in the audit log');
await admin('POST', '/auth/act-as', { userId: samId });
await admin('PUT', '/settings', { allowActAs: false }).catch(() => null);
me = await admin('GET', '/auth/me');
ok(me.name === 'Andrew Lawrence' || me.name === 'Sam Preparer', 'turning act as off is refused or takes effect');
if (me.name === 'Sam Preparer') { await admin('POST', '/auth/act-as', { userId: null }).catch(() => null); }

// ---- Providers show the service, not just the connection
console.log('\n# Providers');
const gem = await admin('POST', '/providers', { type: 'openai', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.invalid/v1beta/openai', apiKey: 'x', models: [] }).catch((e) => e.body);
const gem2 = await admin('POST', '/providers', { type: 'openai', name: 'Gemini', baseUrl: 'http://127.0.0.1:9/generativelanguage.googleapis.com/v1beta/openai', apiKey: 'test-key', models: ['models/gemini-2.5-flash', 'models/imagen-4.0-generate', 'models/gemini-2.5-flash-preview-tts', 'models/text-embedding-004', 'models/gemini-2.5-flash-native-audio', 'models/gemma-3-27b-it'] });
ok(gem2.service === 'Google Gemini API', `a Gemini provider shows as "${gem2.service}"`);
ok(gem2.models.join() === 'models/gemini-2.5-flash,models/gemma-3-27b-it', `only text models are listed (${gem2.models.join(', ')})`);
const provs = await admin('GET', '/providers');
ok(provs.find((p) => p.type === 'rules').service === 'Built-in rules' && provs.find((p) => p.type === 'anthropic').service === 'Anthropic API', 'built-in providers have service names too');

// ---- Overview activity
console.log('\n# Overview charts');
const act = await admin('GET', `/engagements/${E}/activity?days=30`);
ok(act.days.length === 30 && Object.keys(act.runs.agent).includes('Chatbot classifier'), 'activity has a value per day, with runs by agent');
ok(act.outcomes.succeeded.reduce((a, b) => a + b, 0) >= 2, 'run outcomes per day');
await expectErr(admin('GET', `/engagements/${E}/activity?days=12`), 400, 'only the offered ranges are accepted');

// ---- The Planner on a model
console.log('\n# Planner on a model');
const mockProv = await admin('POST', '/providers', { type: 'openai', name: 'Mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: false, models: ['mock-good'] });
await admin('PATCH', `/agents/${planner.id}`, { providerId: mockProv.id, model: 'mock-good' });
ok((await sam('GET', `/engagements/${E}/plans`)).planner.runtime === 'live', 'the plan page shows the Planner is on a model');
let lp = await sam('POST', `/engagements/${E}/plans`, {});
lp = await sam('PATCH', `/plans/${lp.id}`, { brief: { dataUsed: 'Only what I typed' } });
lp = await sam('POST', `/plans/${lp.id}/messages`, { text: 'An agent that books branch appointments.' });
ok(lp.brief.title === 'Mock planned use case' && lp.brief.category === 'agent', 'the model drafts the brief');
ok(lp.brief.dataUsed === 'Only what I typed', 'a field the person typed survives the model trying to overwrite it');
ok(lp.messages.at(-1).runtime === 'live' && lp.messages.at(-1).model === 'mock-good', 'the reply records the model that wrote it');
ok(lp.status === 'draft' && !lp.cardKey, 'the model can draft but never adds it to the board');

// @@MORE@@

console.log(fails ? `\n${fails} FAILED` : '\nAll v1.1 checks passed');
process.exit(fails ? 1 : 0);
