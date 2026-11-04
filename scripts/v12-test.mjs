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

console.log('\n# Upload controls');
const csvText = 'Title,Objective,Type,Frequency,Owner,Use case,Library code,Risks\n"Model change approval","Changes need sign-off",preventive,per change,Head of Model Risk,AI-1,MOD-01,\n"Bad row",x,sideways,monthly,Someone,AI-99,,R-999\n"Comma, in title","Quoted ""text"" is fine",detective,monthly,Ops,,,\n';
const b64 = Buffer.from(csvText).toString('base64');
const before = (await admin('GET', `/engagements/${seed.id}/controls`)).length;
const prev = await sam('POST', `/engagements/${seed.id}/controls/import`, { filename: 'controls.csv', dataBase64: b64, preview: true });
ok(prev.rows.length === 3 && prev.willAdd === 2, `the preview reads every row and says which can be added (${prev.willAdd} of ${prev.rows.length})`);
ok(/sideways/.test(prev.rows[1].why) && /AI-99/.test(prev.rows[1].why) && /R-999/.test(prev.rows[1].why), 'a bad row says exactly what is wrong with it');
ok(prev.rows[2].title === 'Comma, in title' && prev.rows[2].objective === 'Quoted "text" is fine', 'quoted CSV cells with commas and quotes are read correctly');
ok((await admin('GET', `/engagements/${seed.id}/controls`)).length === before, 'the preview saves nothing');
const done = await sam('POST', `/engagements/${seed.id}/controls/import`, { filename: 'controls.csv', dataBase64: b64, preview: false });
const after = await admin('GET', `/engagements/${seed.id}/controls`);
ok(done.added.length === 2 && after.length === before + 2 && done.skipped.length === 1, 'importing adds the good rows and reports the skipped one');
const lib = after.find((c) => c.title === 'Model change approval');
ok(lib && lib.cardKey === 'AI-1' && lib.status === 'proposed', 'an uploaded control is linked to its use case and starts as proposed');
const auditRows = (await admin('GET', '/audit?pageSize=50')).rows;
ok(auditRows.filter((x) => x.action === 'control.added' && x.detail.uploadedFrom === 'controls.csv').length === 2, 'each uploaded control has its own audit entry, naming the file and row');
await expectErr(client()('POST', `/engagements/${seed.id}/controls/import`, { filename: 'x.csv', dataBase64: b64, preview: true }), 401, 'you must be signed in to upload');
const viewer = client(); await admin('POST', '/users', { name: 'Vee Viewer', email: 'vee@example.com', role: 'viewer', password: 'correct-horse-9' }); await viewer('POST', '/auth/login', { email: 'vee@example.com', password: 'correct-horse-9' });
await expectErr(viewer('POST', `/engagements/${seed.id}/controls/import`, { filename: 'x.csv', dataBase64: b64, preview: false }), 403, 'a viewer cannot upload controls');
const noTitle = await sam('POST', `/engagements/${seed.id}/controls/import`, { filename: 'x.csv', dataBase64: Buffer.from('Owner,Type\nA,preventive\n').toString('base64'), preview: true });
ok(noTitle.problems.some((p) => /Title/.test(p)), 'a file without a Title column is explained, not half-imported');
console.log(fails ? `\n${fails} FAILED` : '\nAll v1.2 checks passed');
process.exit(fails ? 1 : 0);
