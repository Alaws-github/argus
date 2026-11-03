// v1.2 (ARGUS) checks: optional modules per engagement, and that the simpler
// five-step board still runs every stage check underneath (a drag or button
// to the next step goes through the same actions).
// Needs a FRESH database and a running server: npm run db:reset, npm start, npm run test:v12.
const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
function client() { let cookie = ''; return async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } if (!r.ok) { const e = new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)}`); e.status = r.status; e.body = j; throw e; } return j; }; }
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const expectErr = async (p, s, m) => { try { await p; ok(false, m + ' (no error)'); } catch (e) { ok(e.status === s, `${m} -> ${e.status} ${e.body?.error ?? ''}`); } };
const admin = client();
await admin('POST', '/auth/setup', { name: 'Andrew Lawrence', email: 'andrew@example.com', password: 'correct-horse-9' });
await admin('POST', '/users', { name: 'Sam Preparer', email: 'sam@example.com', role: 'preparer', password: 'correct-horse-9' });
const sam = client(); await sam('POST', '/auth/login', { email: 'sam@example.com', password: 'correct-horse-9' });
const [seed] = await admin('GET', '/engagements');
const MODS = ['evals', 'incidents', 'inventory', 'connectors', 'soa', 'advanced_ai'];

console.log('\n# Modules');
ok(MODS.every((m) => seed.modules[m] === false), 'a new workspace\'s engagement starts with the core flow only (every module off)');
const providers = await admin('GET', '/providers');
const e2 = await admin('POST', '/engagements', { name: 'Second', client: 'Second client (test)', prefix: 'SEC', frameworks: ['nistAiRmf'], appetite: { maxResidual: 8 }, gates: { intake: true }, agents: {}, useCases: [] });
ok(MODS.every((m) => e2.modules[m] === false), 'an engagement added later starts with every module off too');
const on = await admin('PATCH', `/engagements/${seed.id}`, { modules: { evals: true, soa: true } });
ok(on.modules.evals && on.modules.soa && !on.modules.incidents, 'a lead switches modules on one at a time; the others stay as they were');
const off = await admin('PATCH', `/engagements/${seed.id}`, { modules: { evals: false } });
ok(!off.modules.evals && off.modules.soa, 'and off again');
await expectErr(sam('PATCH', `/engagements/${seed.id}`, { modules: { incidents: true } }), 403, 'a preparer cannot change modules');
ok((await admin('GET', `/engagements/${seed.id}/evals`)).length > 0, 'switching a module off hides it in the app; the records stay (the seeded eval suites are still there)');
const audit = (await admin('GET', '/audit?pageSize=200')).rows;
ok(audit.some((x) => x.action === 'engagement.updated' || x.action === 'engagement.changed'), 'module changes are in the audit log');

console.log('\n# The five steps still run every stage check');
const c = await sam('POST', `/engagements/${seed.id}/cards`, { title: 'Phase check use case', businessOwner: 'Owner', description: 'Checks a thing.', dataUsed: 'None', affectedPeople: 'Staff', autonomy: 'human_in_loop', category: 'other' });
await expectErr(sam('POST', `/cards/${c.id}/actions`, { action: 'approve' }), 403, 'dragging a card out of Intake as its preparer is refused, exactly like the button');
await expectErr(admin('POST', `/cards/${c.id}/actions`, { action: 'advance' }), 409, 'the move-on action still refuses Intake (it needs a decision)');
const moved = await admin('POST', `/cards/${c.id}/actions`, { action: 'approve' });
ok(moved.stage === 'classify', 'a reviewer\'s drop moves it to Assess risk (the classify stage)');
void providers;
console.log(fails ? `\n${fails} FAILED` : '\nAll v1.2 checks passed');
process.exit(fails ? 1 : 0);
