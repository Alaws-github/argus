// Verifier and agent-testing checks: the golden dataset and its runs, judge
// calibration against people's labels, the quote check that catches a judge
// inventing support, live checks (off by default, advisory only) and the
// spend cap. Needs a FRESH database and a running server: npm run db:reset,
// npm start, npm run test:verifier.
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
const card = async (key) => (await admin('GET', `/cards/${key}`)).card;
const waitCard = async (key, pred, label, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const c = await card(key); if (pred(c)) return c; await sleep(400); } const c = await card(key); throw new Error(`timeout ${label}: ${c.stage}/${c.status} ${c.statusNote}`); };
const waitRun = async (id) => { for (let i = 0; i < 120; i++) { const r = await admin('GET', `/agent-testing/runs/${id}`); if (r.status !== 'running') return r; await sleep(400); } throw new Error('golden run timeout'); };
const provs = await admin('GET', '/providers');
const rules = provs.find((p) => p.type === 'rules');

// ---- Golden dataset
let at = await riley('GET', '/agent-testing');
ok(at.cases.filter((c) => c.agent === 'risk_classifier').length === 10 && at.cases.filter((c) => c.agent === 'control_designer').length === 5, 'golden set seeded: 10 classifier and 5 designer cases');
ok(at.labels.length === 18 && at.labels.every((l) => l.origin === 'built_in') && at.labels.filter((l) => l.passages.length).length === 17, '18 labelled examples seeded with their passages');
ok(at.verifier.live === false && !at.verifier.model, 'the Verifier has no model and live checks are off by default');
await expectErr(riley('POST', '/agent-testing/runs', { agent: 'risk_classifier', providerId: rules.id, model: rules.models[0] }), 403, 'only an admin starts a golden run');

const r1 = await waitRun((await admin('POST', '/agent-testing/runs', { agent: 'risk_classifier', providerId: rules.id, model: rules.models[0], withVerifier: true })).id);
ok(r1.status === 'done' && r1.results.length === 10 && r1.summary.cases === 10, `classifier golden run finished (${r1.summary.passed}/10 passed)`);
ok(r1.results.every((r) => r.checks.length > 0 && r.verdicts), 'every case is scored and checked by the Verifier');
ok(r1.rulesVersion.length === 12 && r1.runtime === 'dry-run', 'the run records the rules version and runtime');
const inj = r1.results.find((r) => /planted instruction/.test(r.title));
ok(inj?.pass, 'an instruction planted in the profile is ignored (still high tier)');
const r2 = await waitRun((await admin('POST', '/agent-testing/runs', { agent: 'risk_classifier', providerId: rules.id, model: rules.models[0] })).id);
ok(r2.previous === r1.key && r2.regressions.length === 0 && r2.summary.passed === r1.summary.passed, 'a rerun compares with the previous run: same score, no regressions');
const d1 = await waitRun((await admin('POST', '/agent-testing/runs', { agent: 'control_designer', providerId: rules.id, model: rules.models[0] })).id);
ok(d1.status === 'done' && d1.results.length === 5 && d1.results.every((r) => r.checks.some((c) => c.label === 'Every high risk has a control')), `designer golden run finished (${d1.summary.passed}/5 passed)`);

await expectErr(admin('POST', '/agent-testing/cases', { agent: 'control_designer', title: 'No risks', useCase: { description: 'A thing that does things.' }, expected: { mustControls: ['OVS-01'] } }), 400, 'a design case needs its starting risks');
await expectErr(admin('POST', '/agent-testing/cases', { agent: 'risk_classifier', title: 'No answer', useCase: { description: 'A thing that does things.' }, expected: {} }), 400, 'a case needs an expected answer');
const mine = await admin('POST', '/agent-testing/cases', { agent: 'risk_classifier', title: 'Tenant screening', useCase: { description: 'Scores rental applicants and recommends accept or reject.', dataUsed: 'Applicant income, references', affectedPeople: 'Tenant applicants' }, expected: { tier: 'high', mustRisk: ['fairness'] } });
ok(mine.key.startsWith('G-') && !mine.builtIn, 'a person can add their own golden case');
await expectErr(admin('DELETE', `/agent-testing/cases/${at.cases[0].id}`), 409, 'built-in cases cannot be removed');
await admin('DELETE', `/agent-testing/cases/${mine.id}`);

// ---- Calibration on the offline rules
const c1 = await admin('POST', '/agent-testing/calibrate', {});
const m1 = c1.matrix;
ok(c1.labels === 18 && m1.goodGood + m1.goodBad + m1.badGood + m1.badBad === 18, `rules judge calibrated: agreement ${c1.agree}, kappa ${c1.kappa}`);
ok(c1.falsePassRate > 0.1 && !c1.trusted && c1.disagreements.length > 0, `word-matching passes plausible bad claims (false pass ${c1.falsePassRate}), so it is not trusted`);

// ---- Live checks off: a draft gets no verdict until someone asks
const id1 = (await card('AI-1')).id;
await expectErr(admin('POST', `/cards/${id1}/verify`, {}), 409, 'the Verifier refuses a card with no draft to check');
await riley('POST', `/cards/${id1}/actions`, { action: 'approve' });
let c = await waitCard('AI-1', (x) => x.stage === 'classify' && x.status === 'needs_approval', 'classify');
ok(!c.verification?.classify, 'live checks off: the new draft has no verdict');
const v1 = await pat('POST', `/cards/${id1}/verify`, {});
ok(v1.runtime === 'rules' && v1.items.length === 1 + c.classification.risks.length && v1.trigger === 'manual', `a preparer can ask for a check (${v1.items.length} items, on the rules)`);
c = await card('AI-1');
ok(c.verification.classify?.at === v1.at && !Object.keys(c.decisions?.classify ?? {}).length, 'the verdict is stored beside the draft and decides nothing');
await expectErr(riley('POST', `/cards/${id1}/actions`, { action: 'approve' }), 409, 'a verdict is not a decision: approval still needs each item decided');
const audit = await admin('GET', '/audit?q=verifier.checked');
ok(audit.rows.some((r) => r.action === 'verifier.checked' && r.detail.advisory === true), 'the check is in the audit log, marked advisory');

// ---- Live judge through a provider
const prov = await admin('POST', '/providers', { type: 'openai', name: 'Mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: false, models: ['mock-good', 'mock-judge', 'mock-judge-liar'] });
await admin('PUT', '/settings', { verifierProviderId: prov.id, verifierModel: 'mock-judge-liar' });
const lie = await admin('POST', `/cards/${id1}/verify`, {});
const cited = lie.items.filter((i) => !/cites no source/.test(i.reason));
ok(lie.runtime === 'live' && cited.length > 0 && cited.every((i) => i.verdict === 'unsupported' && !i.quoteFound && /wasn't trusted/.test(i.reason)), 'a judge that invents its quotes is caught: its "supported" verdicts are not trusted');
await admin('PUT', '/settings', { verifierModel: 'mock-judge' });
const good = await admin('POST', `/cards/${id1}/verify`, {});
ok(good.items.filter((i) => i.verdict === 'supported').every((i) => i.quoteFound) && good.items.some((i) => i.verdict === 'supported'), 'a judge whose quotes are in the cited passages is believed');
ok(good.sameModel === false, 'different model from the drafting agent');

const c2 = await admin('POST', '/agent-testing/calibrate', {});
ok(c2.runtime === 'live' && c2.matrix.goodGood === 10 && c2.matrix.goodBad === 7 && c2.matrix.badBad === 1 && c2.falsePassRate === 0.875 && !c2.trusted, `a judge that approves everything is measured as such (false pass ${c2.falsePassRate}, kappa ${c2.kappa})`);

// ---- Live checks on: the next draft is checked by itself
await admin('PUT', '/settings', { verifierLive: true });
await riley('POST', `/cards/${id1}/actions`, { action: 'request_changes', note: 'again please' });
c = await waitCard('AI-1', (x) => x.status === 'needs_approval' && x.verification?.classify?.trigger === 'auto', 'auto verify');
ok(c.verification.classify.model === 'mock-judge' && c.verification.classify.runtime === 'live', 'live checks on: a new draft is checked automatically');

// Same model judging its own work is flagged, and a judge that answers
// nothing leaves every item unsupported rather than passing it.
const agents = await admin('GET', `/engagements/${c.engagementId}/agents`);
const classifier = agents.find((a) => a.role === 'risk_classifier');
await admin('PATCH', `/agents/${classifier.id}`, { providerId: prov.id, model: 'mock-good', fallbackModel: null, fallbackProviderId: null });
await admin('PUT', '/settings', { verifierLive: false, verifierModel: 'mock-good' });
await riley('POST', `/cards/${id1}/actions`, { action: 'request_changes', note: 'once more' });
c = await waitCard('AI-1', (x) => x.status === 'needs_approval' && !x.verification?.classify, 'mock-good draft');
const same = await admin('POST', `/cards/${id1}/verify`, {});
ok(same.sameModel === true, 'a model checking its own draft is flagged');
ok(same.items.every((i) => i.verdict === 'unsupported'), 'a judge that gives no verdicts passes nothing');
await admin('PATCH', `/agents/${classifier.id}`, { providerId: rules.id, model: rules.models[0] });

// ---- People's decisions become labels
await riley('POST', `/cards/${id1}/decisions`, { item: 'risk:0', decision: 'reject', reason: 'Not relevant here' });
await riley('POST', `/cards/${id1}/decisions`, { rest: 'accept' });
const imp = await admin('POST', '/agent-testing/labels/import', {});
ok(imp.added === 1 + (await card('AI-1')).classification.risks.length, `reviewers' kept and rejected items become labels (${imp.added})`);
ok((await admin('POST', '/agent-testing/labels/import', {})).added === 0, 'importing twice adds nothing');
at = await admin('GET', '/agent-testing');
ok(at.labels.some((l) => l.origin === 'decision' && l.human === 'bad' && /rejected it: Not relevant here/.test(l.note)), 'a rejected item is labelled bad, with the reviewer\'s reason');
await expectErr(admin('POST', '/agent-testing/labels', { kind: 'risk', claim: 'Something is wrong somewhere.', sources: ['K-999999'], human: 'bad' }), 400, 'a label must cite passages that exist');
await expectErr(admin('DELETE', `/agent-testing/labels/${at.labels[0].id}`), 409, 'built-in labels cannot be removed');

// ---- Spend cap covers testing too
const billed = await admin('POST', '/providers', { type: 'openai', name: 'Billed mock', baseUrl: 'http://localhost:4401/v1', apiKey: 'x', billed: true, models: ['mock-good'] });
await admin('PUT', '/settings', { spendCapUsd: 0, pauseAtCap: true });
await expectErr(admin('POST', '/agent-testing/runs', { agent: 'risk_classifier', providerId: billed.id, model: 'mock-good' }), 409, 'a billed golden run is refused at the spend cap');
await admin('PUT', '/settings', { spendCapUsd: 50 });

const v = await admin('GET', '/audit/verify'); ok(v.ok, v.message);
console.log('\nThis test created these accounts, all with the password correct-horse-9:');
console.log('  andrew@example.com (admin), riley@example.com (reviewer), pat@example.com (preparer)');
console.log('Run npm run db:reset (with the app stopped) to clear them and start again.');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
