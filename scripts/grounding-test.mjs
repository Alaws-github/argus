// Grounding and human-decision tests: the knowledge base, citations on every
// draft (and rejection of invented ones), per-item decisions before approval,
// meaning search through an embedding provider, and temperature 0 on drafting
// calls. Needs a FRESH database and a running server: npm run db:reset,
// npm start, npm run test:grounding.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-model.cjs', import.meta.url))], {
  stdio: 'ignore',
});
process.on('exit', () => mock.kill());
await new Promise((r) => setTimeout(r, 500));

const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
function client() {
  let cookie = '';
  return async (m, p, b) => {
    const r = await fetch(B + p, {
      method: m,
      headers: { 'content-type': 'application/json', cookie },
      body: b ? JSON.stringify(b) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const t = await r.text();
    let j;
    try {
      j = JSON.parse(t);
    } catch {
      j = t;
    }
    if (!r.ok) {
      const e = new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j)}`);
      e.status = r.status;
      e.body = j;
      throw e;
    }
    return j;
  };
}
let fails = 0;
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) fails++;
};
const expectErr = async (p, s, m) => {
  try {
    await p;
    ok(false, m + ' (no error)');
  } catch (e) {
    ok(e.status === s, `${m} -> ${e.status} ${e.body?.error ?? ''}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = client();
await admin('POST', '/auth/setup', {
  name: 'Andrew Lawrence',
  email: 'andrew@example.com',
  password: 'correct-horse-9',
});
for (const [n, e, r] of [
  ['Riley Reviewer', 'riley@example.com', 'reviewer'],
  ['Pat Preparer', 'pat@example.com', 'preparer'],
])
  await admin('POST', '/users', { name: n, email: e, role: r, password: 'correct-horse-9' });
const riley = client();
await riley('POST', '/auth/login', { email: 'riley@example.com', password: 'correct-horse-9' });
const pat = client();
await pat('POST', '/auth/login', { email: 'pat@example.com', password: 'correct-horse-9' });
const [eng] = await admin('GET', '/engagements');
const E = eng.id;
const card = async (key) => await admin('GET', `/cards/${key}`);
const waitFor = async (key, pred, label, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await card(key);
    if (pred(d.card)) return d;
    await sleep(400);
  }
  const d = await card(key);
  throw new Error(`timeout ${label}: ${d.card.stage}/${d.card.status} ${d.card.statusNote}`);
};
const idOf = async (key) => (await card(key)).card.id;

// ---- Knowledge base
const kb = await admin('GET', `/engagements/${E}/knowledge`);
const kinds = kb.sources.reduce((m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m), {});
ok(
  kinds.framework === 37 && kinds.control === 37 && kinds.methodology >= 7,
  `shared knowledge seeded (${JSON.stringify(kinds)})`,
);
ok(kinds.use_case === 4 && kinds.client === 1, "the engagement's own material is indexed");
ok(kb.search.keyword && !kb.search.meaning, 'keyword search on, meaning search off until a provider is set');
let hits = await admin(
  'GET',
  `/engagements/${E}/knowledge/search?q=${encodeURIComponent('EU AI Act Article 14 human oversight')}`,
);
ok(/Art\. 14/.test(hits[0]?.title ?? ''), `keyword search puts the exact article first (${hits[0]?.title})`);
await pat('POST', `/engagements/${E}/knowledge`, {
  title: 'Northshore AI Policy v2',
  text: 'Every AI model that decides on credit must be reviewed by the Model Risk Committee before go-live.\n\nCustomer-facing chatbots must say they are AI in the first message.',
});
hits = await admin('GET', `/engagements/${E}/knowledge/search?q=${encodeURIComponent('Model Risk Committee go-live')}`);
ok(hits[0]?.kind === 'upload', 'an uploaded client document is searchable');
await expectErr(
  pat('POST', `/engagements/${E}/knowledge`, { title: 'Scan', filename: 'policy.pdf', dataBase64: 'JVBERi0=' }),
  400,
  'PDF upload refused with a clear message',
);

// ---- Classifier on the rules: grounded, and decisions before approval
const id1 = await idOf('AI-1');
await riley('POST', `/cards/${id1}/actions`, { action: 'approve' });
let d = await waitFor('AI-1', (x) => x.stage === 'classify' && x.status === 'needs_approval', 'classify');
const cl = d.card.classification;
ok(cl.tierSources.length > 0 && cl.risks.every((r) => r.sources.length > 0), 'every risk and the tier cite sources');
ok(
  cl.sourcePassages.length > 0 && cl.sourcePassages.every((p) => p.text && p.id.startsWith('K-')),
  'cited passages are copied onto the draft for the reviewer',
);
await expectErr(
  riley('POST', `/cards/${id1}/actions`, { action: 'approve' }),
  409,
  'approval blocked until each item is decided',
);
await expectErr(
  pat('POST', `/cards/${id1}/decisions`, { item: 'risk:0', decision: 'accept' }),
  403,
  'a preparer cannot decide on a draft',
);
await expectErr(
  riley('POST', `/cards/${id1}/decisions`, { item: 'risk:1', decision: 'reject' }),
  400,
  'rejecting needs a reason',
);
await expectErr(
  riley('POST', `/cards/${id1}/decisions`, { item: 'risk:0', decision: 'edit', edit: { likelihood: 2 } }),
  400,
  'editing needs a reason',
);
await expectErr(
  riley('POST', `/cards/${id1}/decisions`, { item: 'tier', decision: 'reject', reason: 'x x x' }),
  400,
  'the tier can be edited but not rejected',
);
await expectErr(
  riley('POST', `/cards/${id1}/decisions`, {
    item: 'risk:0',
    decision: 'edit',
    edit: { likelihood: 9 },
    reason: 'typo',
  }),
  400,
  'edits are validated (likelihood 1 to 5)',
);
await riley('POST', `/cards/${id1}/decisions`, {
  item: 'risk:0',
  decision: 'edit',
  edit: { likelihood: 2 },
  reason: 'Monitored monthly',
});
await riley('POST', `/cards/${id1}/decisions`, {
  item: 'risk:1',
  decision: 'reject',
  reason: 'Covered by the group privacy review',
});
await riley('POST', `/cards/${id1}/decisions`, {
  item: 'tier',
  decision: 'edit',
  edit: { tier: 'high', oversight: 'human_in_loop' },
  reason: 'Officers approve each decision',
});
await riley('POST', `/cards/${id1}/decisions`, { rest: 'accept' });
await riley('POST', `/cards/${id1}/actions`, { action: 'approve' });
const risks = (await admin('GET', `/engagements/${E}/risks`)).filter((r) => r.cardKey === 'AI-1');
ok(risks.length === cl.risks.length - 1, `only kept risks enter the register (${risks.length} of ${cl.risks.length})`);
ok(
  risks.find((r) => r.title === cl.risks[0].title)?.likelihood === 2,
  "the reviewer's edit is what entered the register",
);
const trail = await admin('GET', '/audit?q=draft.item');
const edited = trail.rows.find((r) => r.action === 'draft.item_edited' && r.detail.item === 'risk:0');
ok(
  edited &&
    edited.detail.agentProposed.likelihood === cl.risks[0].likelihood &&
    edited.detail.changedTo.likelihood === 2,
  'audit keeps what the AI proposed and what the person changed it to',
);

// ---- Designer: rejecting the only control for a high risk blocks approval
d = await waitFor('AI-1', (x) => x.stage === 'design' && x.status === 'needs_approval', 'design');
const ds = d.card.design;
ok(
  ds.controls.every((c) => c.sources.length > 0),
  'every proposed control cites its library entry or obligation',
);
for (let i = 0; i < ds.controls.length; i++)
  await riley('POST', `/cards/${id1}/decisions`, {
    item: `control:${i}`,
    decision: 'reject',
    reason: 'Testing the guard',
  });
await expectErr(
  riley('POST', `/cards/${id1}/actions`, { action: 'approve' }),
  409,
  'rejecting every control for a high risk is blocked by the exit criteria',
);
for (let i = 0; i < ds.controls.length; i++)
  await riley('POST', `/cards/${id1}/decisions`, {
    item: `control:${i}`,
    decision: i === 0 ? 'edit' : 'accept',
    ...(i === 0 ? { edit: { owner: 'Chief Credit Officer' }, reason: 'Right owner' } : {}),
  });
await riley('POST', `/cards/${id1}/actions`, { action: 'approve' });
const ctl = (await admin('GET', `/engagements/${E}/controls`)).filter((c) => c.cardKey === 'AI-1');
ok(
  ctl.length === ds.controls.length && ctl.some((c) => c.owner === 'Chief Credit Officer'),
  'kept controls created, with the edited owner',
);

// ---- Live model: citations checked, temperature 0
const prov = await admin('POST', '/providers', {
  type: 'openai',
  name: 'Mock',
  baseUrl: 'http://localhost:4401/v1',
  apiKey: 'x',
  billed: false,
  models: ['mock-good', 'mock-bad', 'mock-notemp', 'mock-embed'],
});
const agents = await admin('GET', `/engagements/${E}/agents`);
const classifier = agents.find((a) => a.role === 'risk_classifier');
await admin('PATCH', `/agents/${classifier.id}`, {
  providerId: prov.id,
  model: 'mock-bad',
  fallbackModel: null,
  fallbackProviderId: null,
});
const id3 = await idOf('AI-3');
await riley('POST', `/cards/${id3}/actions`, { action: 'approve' });
d = await waitFor('AI-3', (x) => x.status === 'failed', 'invented citation rejected');
ok(
  /sources it wasn't given: K-99999/.test(d.card.statusNote),
  'an invented citation fails the run: ' + d.card.statusNote,
);
await admin('PATCH', `/agents/${classifier.id}`, { model: 'mock-good' });
await riley('POST', `/cards/${id3}/actions`, { action: 'retry' });
d = await waitFor('AI-3', (x) => x.status === 'needs_approval', 'live classification');
ok(
  d.card.classification.risks[0].sources.length === 2 && d.card.classification.risks[1].sources.length === 0,
  'live draft keeps its citations; the uncited risk is left visibly unsupported',
);
await admin('PATCH', `/agents/${classifier.id}`, { model: 'mock-notemp' });
await riley('POST', `/cards/${id3}/actions`, { action: 'request_changes', note: 'again' });
d = await waitFor('AI-3', (x) => x.status === 'needs_approval' || x.status === 'failed', 'no-temperature model');
ok(d.card.status === 'needs_approval', 'a model that refuses temperature is retried without it');
const seen = await (await fetch('http://localhost:4401/__seen')).json();
ok(
  seen.filter((x) => x.model === 'mock-good').every((x) => x.temperature === 0),
  `drafting calls use temperature 0 (${seen.length} calls seen)`,
);
ok(!(await card('AI-3')).card.decisions?.classify, 'a new draft starts with no decisions');

// ---- Meaning search through an embedding provider
await expectErr(riley('POST', '/knowledge/reindex', {}), 403, 'only an admin sets up meaning search');
const t = await admin('POST', '/knowledge/embeddings/test', { providerId: prov.id, model: 'mock-embed' });
ok(t.dims === 128, `embedding provider test works (${t.dims} dimensions)`);
await admin('PUT', '/settings', { embedProviderId: prov.id, embedModel: 'mock-embed' });
const ri = await admin('POST', '/knowledge/reindex', {});
ok(ri.embedded > 60, `every passage embedded (${ri.embedded})`);
const kb2 = await admin('GET', `/engagements/${E}/knowledge`);
ok(kb2.search.meaning, 'meaning search on');
hits = await admin('GET', `/engagements/${E}/knowledge/search?q=${encodeURIComponent('a person checks loans')}`);
ok(hits.length > 0, `search by meaning finds passages with none of the same words (top: ${hits[0]?.title})`);

const v = await admin('GET', '/audit/verify');
ok(v.ok, v.message);
console.log('\nThis test created these accounts, all with the password correct-horse-9:');
console.log('  andrew@example.com (admin), riley@example.com (reviewer), pat@example.com (preparer)');
console.log('Run npm run db:reset (with the app stopped) to clear them and start again.');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
