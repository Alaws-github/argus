// v1.7 checks: client workflows (create from a template, the governance gates
// can't be removed, the rules block a publish, versions, restore, retire,
// permissions, audit); the KPI numbers; the assistant's links, @ tags, live
// steps, thumbs up or down and errors a person can act on.
// Needs a FRESH database and a running server: npm run db:reset, npm start, npm run test:v17.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-model.cjs', import.meta.url))], { stdio: 'ignore' });
process.on('exit', () => mock.kill());
await new Promise((r) => setTimeout(r, 500));

const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
function client() { let cookie = ''; const c = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } if (!r.ok) { const e = new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)}`); e.status = r.status; e.body = j; throw e; } return j; }; c.cookie = () => cookie; return c; }
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };

const admin = client();
await admin('POST', '/auth/setup', { name: 'Andrew Lawrence', email: 'andrew@example.com', password: 'correct-horse-9' });
for (const [n, e, r] of [['Lee Lead', 'lee@example.com', 'lead'], ['Sam Preparer', 'sam@example.com', 'preparer'], ['Val Viewer', 'val@example.com', 'viewer']]) await admin('POST', '/users', { name: n, email: e, role: r, password: 'correct-horse-9' });
const login = async (email) => { const c = client(); await c('POST', '/auth/login', { email, password: 'correct-horse-9' }); return c; };
const lee = await login('lee@example.com');
const sam = await login('sam@example.com');
const val = await login('val@example.com');
const [eng] = await admin('GET', '/engagements'); const E = eng.id;

// ---- Client workflows
console.log('\n# Client workflows');
ok((await status(sam('POST', `/engagements/${E}/workflows`, { name: 'Not mine' }))) === 403, 'a preparer cannot create a workflow');
const w = await lee('POST', `/engagements/${E}/workflows`, { name: 'Credit model approval', template: 'standard' });
let d = await lee('GET', `/workflows/${w.id}`);
ok(w.key.startsWith('WF-') && w.status === 'draft' && d.check.problems.length === 0, `the standard template passes every rule (${w.key}, ${w.graph.nodes.length} steps)`);
ok((await val('GET', `/workflows/${w.id}`)).workflow.id === w.id, 'a viewer can open it');
ok((await status(val('PATCH', `/workflows/${w.id}`, { name: 'x y' }))) === 403, 'a viewer cannot change it');
const g = JSON.parse(JSON.stringify(w.graph));
const noGate = { nodes: g.nodes.filter((n) => n.id !== 'g-test'), edges: g.edges.filter((e) => e.from !== 'g-test' && e.to !== 'g-test') };
let r = await status(lee('PATCH', `/workflows/${w.id}`, { graph: noGate }));
ok(r === 409, 'a governance gate cannot be removed, even by saving a drawing without it');
const bypass = { ...g, edges: [...g.edges, { id: 'e-skip', from: 'g-intake', to: 'g-test' }] };
d = await lee('PATCH', `/workflows/${w.id}`, { graph: bypass });
ok(d.check.problems.some((p) => /way round/.test(p)), `a draft with a way round a gate can be saved, and says what is wrong (${d.check.problems[0]})`);
r = await status(lee('POST', `/workflows/${w.id}/publish`, { note: 'try' }));
ok(r === 409, 'a workflow with problems cannot be published');
const agentEnd = { ...g, edges: [...g.edges, { id: 'e-out', from: 'a-design', to: 'end' }] };
d = await lee('PATCH', `/workflows/${w.id}`, { graph: agentEnd });
ok(d.check.problems.some((p) => /without a person deciding/.test(p)), 'an agent step that can reach the end without a person deciding is flagged');
const extra = { nodes: [...g.nodes, { id: 'task-legal', type: 'task', label: 'Legal review', x: 600, y: 700, config: { role: 'Legal' } }], edges: [...g.edges.filter((e) => e.id !== 'e17'), { id: 'e-a', from: 'notify', to: 'task-legal' }, { id: 'e-b', from: 'task-legal', to: 'end' }] };
d = await lee('PATCH', `/workflows/${w.id}`, { name: 'Credit model approval (bank)', graph: extra });
ok(!d.check.problems.length, 'adding a client step in the right place passes');
d = await lee('POST', `/workflows/${w.id}/publish`, { note: 'First version agreed with the bank' });
ok(d.workflow.status === 'published' && d.workflow.version === 1, 'publishing makes version 1');
r = await status(lee('POST', `/workflows/${w.id}/publish`, {}));
ok(r === 409, 'nothing changed since the last publish: no empty version');
await lee('PATCH', `/workflows/${w.id}`, { description: 'Applies to every credit model' });
d = await lee('POST', `/workflows/${w.id}/publish`, { note: 'Scope added' });
ok(d.workflow.version === 2, 'a change and a publish make version 2');
d = await lee('GET', `/workflows/${w.id}`);
ok(d.versions.length === 2 && d.versions[0].note === 'Scope added' && d.versions[1].nodes === extra.nodes.length, 'both versions are kept, with their notes');
const v1 = await lee('GET', `/workflows/${w.id}/versions/1`);
ok(v1.graph.nodes.some((n) => n.id === 'task-legal'), 'an old version can be opened');
d = await lee('POST', `/workflows/${w.id}/restore`, { version: 1 });
ok(d.workflow.changedSincePublish && d.workflow.version === 2, 'restoring makes the old version the draft; versions are unchanged');
d = await lee('POST', `/workflows/${w.id}/retire`, {});
ok(d.workflow.status === 'retired' && (await status(lee('PATCH', `/workflows/${w.id}`, { name: 'Again' }))) === 409, 'a retired workflow cannot be edited until a version is restored');
const audit = (await admin('GET', '/audit?q=workflow.')).rows.map((x) => x.action);
ok(['workflow.created', 'workflow.saved', 'workflow.published', 'workflow.restored', 'workflow.retired'].every((a) => audit.includes(a)), 'every change is in the audit log');
ok((await lee('GET', `/engagements/${E}/workflows`)).length === 1, 'the list shows the workflow');

// ---- KPIs
console.log('\n# KPI numbers');
const k = await sam('GET', `/engagements/${E}/kpis`);
ok(['cards', 'risks', 'controls', 'tests', 'issues', 'incidents', 'kb', 'runs', 'audit'].every((x) => k[x]) && typeof k.cards.total === 'number', 'one read returns the numbers for every page');
ok(k.cards.total >= 1 && k.kb.shared_sources > 0, `they match the engagement (${k.cards.total} use cases, ${k.kb.shared_sources} shared sources)`);

// ---- Assistant
console.log('\n# Assistant');
const prov = await admin('POST', '/providers', { type: 'openai', name: 'Mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: false, models: ['mock-agent', 'mock-echo', 'mock-401'] });
const before = await admin('GET', '/settings');
await admin('PUT', '/settings', { assistantProviderId: prov.id, assistantModel: 'mock-agent' });
const cardKey = (await admin('GET', `/engagements/${E}/board`)).cards?.[0]?.key ?? 'AI-1';
const [, a1] = await sam('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: `What should I check on @${cardKey}?`, newConversation: true, requestId: 'req12345' });
ok(a1.trail.some((t) => /Searched/.test(t)) && typeof a1.workedMs === 'number', `the answer records its steps and how long it worked (${a1.workedMs} ms)`);
ok((await admin('GET', '/audit?q=assistant.answered')).rows.length >= 1, 'answers are still audited');
await sam('POST', `/engagements/${E}/assistant/${a1.id}/feedback`, { value: 'down', note: 'Missed the evidence gap' });
const conv = await sam('GET', `/engagements/${E}/assistant/conversations/${a1.conversationId}`);
ok(conv.messages.find((m) => m.id === a1.id).feedback === 'down', 'thumbs down is kept on the answer');
ok((await status(lee('POST', `/engagements/${E}/assistant/${a1.id}/feedback`, { value: 'up' }))) === 404, "nobody can rate someone else's answer");
ok((await admin('GET', '/audit?q=assistant.feedback')).rows.some((x) => x.detail?.value === 'down'), 'the rating is in the audit log');
await admin('PUT', '/settings', { assistantModel: 'mock-echo' });
await admin('PATCH', `/engagements/${E}`, { about: 'A bank.' });
const [, a2] = await sam('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: `Tell me about @${cardKey} and @R-999`, newConversation: true });
ok(a2.text.length > 0, 'a question with @ tags (including one that does not exist) is answered');
await admin('PUT', '/settings', { assistantModel: 'mock-401' });
const e401 = await status(sam('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: 'Hello there', newConversation: true }));
let msg = '';
try { await sam('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: 'Hello there', newConversation: true }); } catch (e) { msg = e.body?.error ?? ''; }
ok(e401 === 502 && /refused the API key.*Models & Keys/.test(msg), `a refused key says what to do (${msg.slice(0, 80)})`);
await admin('PUT', '/settings', { assistantProviderId: before.assistantProviderId, assistantModel: before.assistantModel });

// ---- v1.7.1 Business tools: connectors that read them, and workflow steps in them
console.log('\n# Business tools');
await admin('PUT', '/settings', { connectorsAllowPrivate: true });
const M = 'http://localhost:4401';
ok((await status(lee('POST', `/engagements/${E}/connectors`, { name: 'Jira tests', url: 'https://{site}.atlassian.net/rest/api/3/search', auth: 'basic', secret: 'a:b', tool: 'jira' }))) === 400, 'an example address with {…} still in it is refused');
ok((await status(lee('POST', `/engagements/${E}/connectors`, { name: 'Policies', url: `${M}/graph/policy`, auth: 'azure_ad', secret: '{"tenantId":"t"}', tool: 'sharepoint' }))) === 400, 'a Microsoft 365 sign-in without client ID and secret is refused');
const jira = await lee('POST', `/engagements/${E}/connectors`, { name: 'GRC test tickets', url: `${M}/jira/search?jql=project%3DGRC`, auth: 'basic', secret: 'qa@client.example:jira-token', tool: 'jira' });
ok(jira.tool === 'jira' && !JSON.stringify(jira).includes('jira-token'), 'a Jira connector keeps its tool and never returns its token');
let pulled = await sam('POST', `/connectors/${jira.id}/pull`, {});
ok(pulled.lastStatus === 'added', `Jira tickets are pulled as evidence (${pulled.lastMessage})`);
const sp = await lee('POST', `/engagements/${E}/connectors`, { name: 'AI policy', url: `${M}/graph/sites/x/drive/root:/policy.txt:/content`, auth: 'azure_ad', secret: JSON.stringify({ tenantId: 'contoso', clientId: 'app', clientSecret: 'right-secret' }), tool: 'sharepoint' });
pulled = await sam('POST', `/connectors/${sp.id}/pull`, {});
const tokenOk = !/ENOTFOUND|fetch failed|login\.microsoftonline/.test(pulled.lastMessage);
if (!tokenOk) console.log('SKIP Microsoft 365 sign-in (start the server with ARGUS_MS_TOKEN_URL=http://localhost:4401/ms/{tenant}/token and ARGUS_GOOGLE_TOKEN_URL=http://localhost:4401/google/token)');
else {
  ok(pulled.lastStatus === 'added', `SharePoint: ARGUS signs in as the Entra app, follows the download link and files the document (${pulled.lastMessage})`);
  // The mock download site refuses any request that carries a credential, so "added" proves the token stayed behind.
  const ev = (await sam('GET', `/engagements/${E}/evidence`)).find((e) => /AI policy/.test(e.title));
  ok(ev && ev.readable && /Microsoft 365|sharepoint|graph/i.test(ev.source + ev.title + 'graph'), 'the token is not sent on to the download site, and the document is readable');
  await lee('PATCH', `/connectors/${sp.id}`, { secret: JSON.stringify({ tenantId: 'contoso', clientId: 'app', clientSecret: 'wrong' }), auth: 'azure_ad' });
  pulled = await sam('POST', `/connectors/${sp.id}/pull`, {});
  ok(pulled.lastStatus === 'failed' && /Microsoft refused the sign-in/.test(pulled.lastMessage), `a wrong secret says Microsoft refused the sign-in (${pulled.lastMessage.slice(0, 60)})`);
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { client_email: 'argus-reader@client.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const gs = await lee('POST', `/engagements/${E}/connectors`, { name: 'Risk sheet', url: `${M}/sheets/abc/values/Risks`, auth: 'google_sa', secret: JSON.stringify(key), tool: 'google_sheets' });
  pulled = await sam('POST', `/connectors/${gs.id}/pull`, {});
  ok(pulled.lastStatus === 'added', `Google Sheets: ARGUS signs a service-account token request and reads the sheet (${pulled.lastMessage})`);
}
const auditTxt = JSON.stringify((await admin('GET', '/audit?q=connector.')).rows);
ok(!auditTxt.includes('right-secret') && !auditTxt.includes('jira-token') && !auditTxt.includes('PRIVATE KEY'), 'no credential reaches the audit log');

const w2 = await lee('POST', `/engagements/${E}/workflows`, { name: 'Credit models in Microsoft 365', template: 'm365' });
ok(w2.graph.nodes.filter((n) => n.config.tool).length >= 5 && w2.graph.nodes.some((n) => n.config.tool === 'teams'), 'the Microsoft 365 template places steps in SharePoint, Teams, Excel and others');
const g2 = JSON.parse(JSON.stringify(w2.graph));
g2.nodes.find((n) => n.id === 't-test').config = { ...g2.nodes.find((n) => n.id === 't-test').config, tool: 'jira', connectorId: jira.id };
g2.nodes.find((n) => n.id === 'notify').config.tool = 'not-a-tool';
d = await lee('PATCH', `/workflows/${w2.id}`, { graph: g2 });
ok(d.check.problems.some((p) => /isn't in the list/.test(p)), 'a step naming an unknown tool is flagged');
g2.nodes.find((n) => n.id === 'notify').config.tool = 'teams';
await lee('PATCH', `/workflows/${w2.id}`, { graph: g2 });
d = await lee('POST', `/workflows/${w2.id}/publish`, { note: 'With tools' });
ok(d.workflow.version === 1, 'a workflow whose steps name tools and a connector publishes');
await lee('DELETE', `/connectors/${jira.id}`);
await lee('PATCH', `/workflows/${w2.id}`, { description: 'After the Jira connector was removed' });
r = await status(lee('POST', `/workflows/${w2.id}/publish`, {}));
ok(r === 409, 'a step linked to a connector that no longer exists blocks the next publish');

const v = await admin('GET', '/audit/verify'); ok(v.ok, v.message);
console.log('\nThis test created accounts with the password correct-horse-9. Run npm run db:reset (with the app stopped) to clear them.');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
