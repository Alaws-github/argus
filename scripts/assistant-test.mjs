// Assistant and provider checks: the offline and live assistant, citations and
// suggestions the harness must drop, applying a suggestion under the person's
// own permissions, discarding, ownership, the spend cap, and the JSON fallback
// for providers that refuse tool calls. Needs a FRESH database and a running
// server: npm run db:reset, npm start, npm run test:assistant.
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
for (const [n, e, r] of [['Riley Reviewer', 'riley@example.com', 'reviewer'], ['Pat Preparer', 'pat@example.com', 'preparer'], ['Val Viewer', 'val@example.com', 'viewer']]) await admin('POST', '/users', { name: n, email: e, role: r, password: 'correct-horse-9' });
const login = async (email) => { const c = client(); await c('POST', '/auth/login', { email, password: 'correct-horse-9' }); return c; };
const riley = await login('riley@example.com');
const pat = await login('pat@example.com');
const val = await login('val@example.com');
const [eng] = await admin('GET', '/engagements'); const E = eng.id;
const card = async (key) => (await admin('GET', `/cards/${key}`)).card;
const waitCard = async (key, pred, label, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const c = await card(key); if (pred(c)) return c; await sleep(400); } const c = await card(key); throw new Error(`timeout ${label}: ${c.stage}/${c.status} ${c.statusNote}`); };
const ask = (who, kind, contextId, question) => who('POST', `/engagements/${E}/assistant`, { kind, contextId, question });

// A classification waiting for decisions on AI-1.
const c1 = await card('AI-1');
await riley('POST', `/cards/${c1.id}/actions`, { action: 'approve' });
await waitCard('AI-1', (x) => x.stage === 'classify' && x.status === 'needs_approval', 'classify');

// ---- Offline assistant
const [q1, a1] = await ask(pat, 'card', c1.id, 'What should I check before this is approved?');
ok(q1.role === 'user' && a1.role === 'assistant' && a1.runtime === 'rules', 'the offline assistant answers with no model set');
ok(/still need your decision/.test(a1.text) && a1.passages.length > 0 && a1.citations.every((c) => a1.passages.some((p) => p.id === c)), 'it reports undecided items and shows the passages it cites');
const thread = await pat('GET', `/engagements/${E}/assistant?kind=card&contextId=${c1.id}`);
ok(thread.messages.length === 2, 'the conversation is kept');
ok((await riley('GET', `/engagements/${E}/assistant?kind=card&contextId=${c1.id}`)).messages.length === 0, 'each person has their own conversation');
await expectErr(ask(val, 'card', c1.id, 'Explain this'), 403, 'a viewer cannot use the assistant');
await expectErr(ask(pat, 'card', '00000000-0000-4000-8000-000000000000', 'Explain this'), 404, 'a use case from nowhere is refused');
const [, reg] = await ask(pat, 'risks', '', 'Which risks need attention?');
ok(reg.runtime === 'rules' && reg.text.length > 20, 'the assistant works on a register too');

// ---- Conversations (v1.4): new, list, search, carry on, private to the person
const [pq, pa] = await pat('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: "What's on this page?", newConversation: true, page: { path: '/risks', snapshot: 'Risk Register\nR-1 Biased lending decisions  score 16' } });
ok(/Risk Register/.test(pa.text) && /R-1 Biased lending/.test(pa.text), 'the offline assistant says which page you are on and what is on screen');
ok(pq.conversationId && pq.conversationId === pa.conversationId, 'a new conversation is started');
const [, pa2] = await pat('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: 'And what can I do here?', conversationId: pq.conversationId, page: { path: '/controls/register', snapshot: '' } });
ok(pa2.conversationId === pq.conversationId && /Controls: Register/.test(pa2.text), 'carrying on keeps the conversation and follows the page');
const list = await pat('GET', `/engagements/${E}/assistant/conversations`);
ok(list.length >= 3 && list[0].id === pq.conversationId && list[0].messages === 4 && list[0].title === "What's on this page?", 'conversations are listed newest first, titled by the first question');
const found = await pat('GET', `/engagements/${E}/assistant/conversations?q=${encodeURIComponent('can I do here')}`);
ok(found.length === 1 && found[0].id === pq.conversationId && /can I do here/.test(found[0].match), 'search finds a conversation by any message in it');
ok((await pat('GET', `/engagements/${E}/assistant/conversations?q=zzzz-nothing`)).length === 0, 'search with no match returns nothing');
ok((await pat('GET', `/engagements/${E}/assistant/conversations/${pq.conversationId}`)).messages.length === 4, 'a conversation opens with its history');
await expectErr(riley('GET', `/engagements/${E}/assistant/conversations/${pq.conversationId}`), 404, "nobody else can open your conversation");
await expectErr(riley('POST', `/engagements/${E}/assistant`, { kind: 'engagement', contextId: '', question: 'Hello there', conversationId: pq.conversationId }), 404, "nobody else can add to your conversation");
ok(!(await riley('GET', `/engagements/${E}/assistant/conversations`)).some((c) => c.id === pq.conversationId), "someone else's conversations are not listed");
const renamed = await pat('PATCH', `/engagements/${E}/assistant/conversations/${pq.conversationId}`, { title: 'Page tour' });
ok(renamed.title === 'Page tour', 'a conversation can be renamed');

// ---- Live assistant through a provider
const prov = await admin('POST', '/providers', { type: 'openai', name: 'Mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: false, models: ['mock-assist', 'mock-notools'] });
await expectErr(riley('PUT', '/settings', { assistantProviderId: prov.id, assistantModel: 'mock-assist' }), 403, 'only an admin picks the assistant\'s model');
await admin('PUT', '/settings', { assistantProviderId: prov.id, assistantModel: 'mock-assist' });
const [, a2] = await ask(riley, 'card', c1.id, 'Is the privacy risk supported?');
ok(a2.runtime === 'live' && a2.model === 'mock-assist', 'the live assistant answers');
ok(!a2.citations.includes('K-99999') && a2.dropped.some((d) => /K-99999/.test(d)), 'an invented citation is dropped and reported');
ok(a2.dropped.some((d) => /not in this record/.test(d)), 'a suggestion about a record it was not shown is dropped');
ok(!a2.suggestions.some((s) => s.kind === 'approve_stage') && a2.dropped.length >= 3, 'it cannot suggest approving: unknown kinds are dropped');
const dec = a2.suggestions.find((s) => s.kind === 'decide_item');
const rerun = a2.suggestions.find((s) => s.kind === 'rerun_agent');
ok(dec && rerun && a2.suggestions.every((s) => s.status === 'open'), 'valid suggestions wait for a person');
let c = await card('AI-1');
ok(!c.decisions?.classify?.[dec.item], 'nothing changed before anyone clicked Apply');

// Apply runs as the person: a preparer's own suggestion is refused by their role.
const [, a3] = await ask(pat, 'card', c1.id, 'Anything to reject?');
const patDec = a3.suggestions.find((s) => s.kind === 'decide_item');
await expectErr(pat('POST', `/engagements/${E}/assistant/${a3.id}/suggestions/${patDec.id}/apply`, {}), 403, "applying runs under the person's role: a preparer can't decide on a draft");
const after = (await pat('GET', `/engagements/${E}/assistant?kind=card&contextId=${c1.id}`)).messages.find((m) => m.id === a3.id);
ok(after.suggestions.find((s) => s.id === patDec.id).status === 'failed', 'the refused suggestion is marked failed with the reason');
await expectErr(riley('POST', `/engagements/${E}/assistant/${a3.id}/suggestions/${patDec.id}/apply`, {}), 403, "nobody can apply someone else's suggestion");

await riley('POST', `/engagements/${E}/assistant/${a2.id}/suggestions/${dec.id}/apply`, {});
c = await card('AI-1');
ok(c.decisions.classify[dec.item]?.by === 'Riley Reviewer' && c.decisions.classify[dec.item].reason === 'Not supported by the profile', 'applied: the decision is recorded under the reviewer\'s name');
await expectErr(riley('POST', `/engagements/${E}/assistant/${a2.id}/suggestions/${dec.id}/apply`, {}), 409, 'a suggestion applies once');
await expectErr(riley('POST', `/cards/${c1.id}/actions`, { action: 'approve' }), 409, 'the assistant decided one item; approval still needs the rest');
const audit = await admin('GET', '/audit?q=assistant');
const applied = audit.rows.find((r) => r.action === 'assistant.suggestion_applied');
ok(applied?.actor === 'Riley Reviewer' && applied.detail.proposedBy === 'mock-assist', 'the audit log shows who applied what the AI proposed');
const decRow = (await admin('GET', '/audit?q=draft.item')).rows.find((r) => r.detail.item === dec.item);
ok(decRow?.actor === 'Riley Reviewer', 'the decision itself has its normal audit entry');

await riley('POST', `/engagements/${E}/assistant/${a2.id}/suggestions/${rerun.id}/discard`, {});
const th2 = (await riley('GET', `/engagements/${E}/assistant?kind=card&contextId=${c1.id}`)).messages.find((m) => m.id === a2.id);
ok(th2.suggestions.find((s) => s.id === rerun.id).status === 'discarded' && (await card('AI-1')).status === 'needs_approval', 'a discarded suggestion changes nothing');
ok((await admin('GET', '/audit?q=assistant.suggestion_discarded')).rows.length === 1, 'discarding is audited');

// ---- Spend cap covers the assistant
const billed = await admin('POST', '/providers', { type: 'openai', name: 'Billed mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: true, models: ['mock-assist'] });
await admin('PUT', '/settings', { assistantProviderId: billed.id, spendCapUsd: 0, pauseAtCap: true });
await expectErr(ask(riley, 'card', c1.id, 'Anything else?'), 409, 'a billed assistant stops at the spend cap');
await admin('PUT', '/settings', { spendCapUsd: 50, assistantProviderId: null, assistantModel: '' });

// ---- With no assistant model picked, the workspace default answers (v1.4)
const before = await admin('GET', '/settings');
await admin('PUT', '/settings', { defaultProviderId: prov.id, defaultModel: 'mock-assist' });
const [, viaDefault] = await ask(riley, 'risks', '', 'Which risks need attention first?');
ok(viaDefault.runtime === 'live' && viaDefault.model === 'mock-assist', 'connecting a default model is enough for live answers');
await admin('PUT', '/settings', { defaultProviderId: before.defaultProviderId, defaultModel: before.defaultModel });

// ---- Providers that refuse tool calls still work (JSON fallback)
const agents = await admin('GET', `/engagements/${E}/agents`);
const classifier = agents.find((a) => a.role === 'risk_classifier');
await admin('PATCH', `/agents/${classifier.id}`, { providerId: prov.id, model: 'mock-notools', fallbackModel: null, fallbackProviderId: null });
const id3 = (await card('AI-3')).id;
await riley('POST', `/cards/${id3}/actions`, { action: 'approve' });
const c3 = await waitCard('AI-3', (x) => x.status === 'needs_approval' || x.status === 'failed', 'no-tools classify');
ok(c3.status === 'needs_approval' && c3.classification?.tier === 'high', `a provider without tool calls answers in JSON instead (${c3.status})`);

const v = await admin('GET', '/audit/verify'); ok(v.ok, v.message);
console.log('\nThis test created these accounts, all with the password correct-horse-9:');
console.log('  andrew@example.com (admin), riley@example.com (reviewer), pat@example.com (preparer), val@example.com (viewer)');
console.log('Run npm run db:reset (with the app stopped) to clear them and start again.');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
