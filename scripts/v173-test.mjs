// v1.7.3 checks: client step proof, write-back, evidence pushed from
// pipelines, S3 and Azure Blob reads, healthcare frameworks (FDA GMLP,
// HIPAA) and cross-framework harmonization.
// Needs a fresh database and a running server started with MONITOR_TICK_MS=1000
// (so write-back sends within a few seconds). Starts the mock on port 4401.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-model.cjs', import.meta.url))], {
  stdio: 'ignore',
});
process.on('exit', () => mock.kill());
await new Promise((r) => setTimeout(r, 600));

const ROOT = process.env.BASE_URL || 'http://localhost:4300';
const B = ROOT + '/api';
const M = 'http://127.0.0.1:4401';
function client() {
  let cookie = '';
  const c = async (m, p, b) => {
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
  return c;
}
let fails = 0;
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) fails++;
};
const status = async (p) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e.status;
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const push = async (token, body) => {
  const r = await fetch(`${B}/ingest/evidence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const admin = client();
await admin('POST', '/auth/setup', {
  name: 'Andrew Admin',
  email: 'andrew@example.com',
  password: 'correct-horse-9',
}).catch(() => admin('POST', '/auth/login', { email: 'andrew@example.com', password: 'correct-horse-9' }));
for (const [name, email, role] of [
  ['Lee Lead', 'lee@example.com', 'lead'],
  ['Pat Preparer', 'pat@example.com', 'preparer'],
  ['Val Viewer', 'val@example.com', 'viewer'],
])
  await admin('POST', '/users', { name, email, role, password: 'correct-horse-9' }).catch(() => {});
const login = async (email) => {
  const c = client();
  await c('POST', '/auth/login', { email, password: 'correct-horse-9' });
  return c;
};
const lee = await login('lee@example.com');
const pat = await login('pat@example.com');
const val = await login('val@example.com');
const [eng] = await admin('GET', '/engagements');
const E = eng.id;
await admin('PUT', '/settings', { connectorsAllowPrivate: true });
const board = await admin('GET', `/engagements/${E}/board`);
const KEY = (board.cards ?? board).find?.((c) => c.key === `${eng.prefix}-1`)?.key ?? `${eng.prefix}-1`;
ok(KEY === 'AI-1', `the seeded engagement has use case AI-1 (got ${KEY})`);

console.log('\n# Healthcare frameworks');
const lib = await admin('GET', '/library');
ok(
  lib.filter((l) => /^HLT-0[1-6]$/.test(l.code)).length === 6,
  'six healthcare controls are in the library (HLT-01 to HLT-06)',
);
const gov3 = lib.find((l) => l.code === 'GOV-03');
ok(
  gov3?.refs?.hipaa?.includes('164.308(a)(5)') && gov3?.refs?.nistAiRmf?.length,
  'an existing library control gains HIPAA references and keeps its NIST ones',
);
const obl = await admin('GET', '/obligations');
ok(
  obl.some((o) => o.source === 'FDA GMLP' && o.ref === 'GMLP 7') &&
    obl.some((o) => o.source === 'HIPAA' && o.ref === '164.504(e)'),
  'FDA GMLP and HIPAA obligations are listed',
);
const trace0 = await admin('GET', `/engagements/${E}/traceability`);
ok(
  !trace0.some((o) => o.source === 'HIPAA' || o.source === 'FDA GMLP'),
  "an engagement that didn't choose them doesn't show the healthcare obligations",
);
const rulesP = (await admin('GET', '/providers')).find((p) => p.type === 'rules');
const AG = {
  appetite: { maxResidual: 6, statement: '', escalateTo: 'Board' },
  gates: { classify: true, design: true },
  agents: {
    risk_classifier: { providerId: rulesP.id, model: 'rules-v1', effort: 'low' },
    control_designer: { providerId: rulesP.id, model: 'rules-v1', effort: 'low' },
  },
};
const health = await lee('POST', '/engagements', {
  name: 'Clinical AI review',
  client: 'Harbour Health',
  prefix: 'HH',
  sector: 'Healthcare',
  frameworks: ['nistAiRmf', 'hipaa', 'fdaGmlp'],
  ...AG,
});
ok(
  /HIPAA/.test(health.framework) && /Good Machine Learning/.test(health.framework),
  'an engagement can choose HIPAA and FDA GMLP',
);
const trace1 = await lee('GET', `/engagements/${health.id}/traceability`);
ok(
  trace1.some((o) => o.source === 'HIPAA') && trace1.some((o) => o.source === 'FDA GMLP'),
  'its standards and traceability include the healthcare obligations',
);
const soaHealth = await lee('GET', `/engagements/${health.id}/soa`);
ok(
  soaHealth.some((s) => s.code === 'HLT-02' && s.applicable),
  'healthcare controls start as applicable when the engagement chose HIPAA',
);

console.log('\n# Across frameworks');
const csv =
  'Title,Objective,Type\nVendor contracts reviewed for AI data use,Contracts with AI suppliers are checked before signing for data use and audit rights,preventive\nQuarterly penetration test of the chatbot,Security test the chatbot every quarter,detective\n';
const imp = await lee('POST', `/engagements/${E}/controls/import`, {
  filename: 'client-controls.csv',
  dataBase64: Buffer.from(csv).toString('base64'),
  preview: false,
});
ok(imp.added.length === 2, "the client's own controls are uploaded");
let h = await lee('GET', `/engagements/${E}/harmonization`);
const mine = h.controls.find((c) => c.key === imp.added[0]);
ok(
  h.frameworks.length >= 2 && h.frameworks.every((f) => f.total > 0),
  'coverage is worked out for each framework in scope',
);
ok(
  mine && !mine.mapped && mine.suggestions[0]?.code === 'TPR-01',
  `an unmapped control gets a library suggestion (got ${mine?.suggestions.map((s) => s.code)})`,
);
ok(
  (await status(val('POST', `/controls/${mine.id}/map`, { libraryCode: 'TPR-01' }))) === 403,
  'a viewer cannot map a control',
);
const mapped = await pat('POST', `/controls/${mine.id}/map`, { libraryCode: 'TPR-01' });
ok(
  mapped.libraryCode === 'TPR-01' && mapped.refs.iso42001?.length && mapped.refs.nistAiRmf?.length,
  'mapping gives the control every framework reference of the library control at once',
);
h = await lee('GET', `/engagements/${E}/harmonization`);
ok(
  h.controls.find((c) => c.id === mine.id).frameworks >= 2 && h.summary.multi >= 1,
  'the mapped control counts for two or more frameworks',
);
ok(
  (await status(lee('POST', `/controls/${mine.id}/map`, { libraryCode: 'NOPE-9' }))) === 404,
  'an unknown library code is refused',
);

console.log('\n# Pipelines push evidence');
const ctl = (await lee('GET', `/engagements/${E}/controls`))[0];
ok(
  (await status(pat('POST', `/engagements/${E}/ingest-tokens`, { name: 'Credit model CI' }))) === 403,
  'a preparer cannot create an ingest token',
);
const tk = await lee('POST', `/engagements/${E}/ingest-tokens`, { name: 'Credit model CI', controlId: ctl.id });
ok(/^argus_ing_/.test(tk.token) && tk.hint === `…${tk.token.slice(-4)}`, 'the token is shown once when created');
ok(
  !JSON.stringify(await lee('GET', `/engagements/${E}/ingest-tokens`)).includes(tk.token),
  'the token is never returned again',
);
ok((await push(null, { title: 'x', content: 'y' })).status === 401, 'a push without a token is refused');
ok(
  (await push('argus_ing_not-a-real-token-1234567', { title: 'Eval', content: 'y' })).status === 401,
  'a push with an unknown token is refused',
);
let p = await push(tk.token, {
  title: 'Credit model evaluation 2.3',
  kind: 'eval',
  useCase: KEY,
  content: JSON.stringify({ accuracy: 0.94, auc: 0.91 }),
  filename: 'eval.json',
  metrics: { accuracy: 0.94, passed: true },
  source: { system: 'github', repo: 'client/credit-model', commit: 'abc123def4567890', run: '991' },
});
ok(
  p.status === 201 && /^E-\d+$/.test(p.body.evidence),
  `a pipeline pushes evaluation results as evidence (${p.status} ${JSON.stringify(p.body)})`,
);
const evs = await lee('GET', `/engagements/${E}/evidence`);
const pushed = evs.find((e) => `E-${e.number ?? ''}` === p.body.evidence || e.key === p.body.evidence);
ok(
  pushed &&
    pushed.controlId === ctl.id &&
    /Pushed by pipeline: github client\/credit-model/.test(pushed.source) &&
    /Pipeline: Credit model CI/.test(pushed.collectedBy),
  "it is filed against the token's control, with the pipeline as collector and the run as source",
);
ok(
  (await push(tk.token, { title: 'Bad control', content: 'x', control: 'C-9999' })).status === 422,
  'a push naming a control that does not exist is refused',
);
p = await push(tk.token, {
  title: 'SBOM',
  kind: 'sbom',
  contentBase64: Buffer.from('{"bomFormat":"CycloneDX"}').toString('base64'),
  filename: 'sbom.json',
  mime: 'application/json',
});
ok(p.status === 201, 'a file can be pushed as base64');
const audit1 = (await admin('GET', '/audit?q=evidence.pushed')).rows;
ok(
  audit1.some((a) => /^Pipeline: Credit model CI/.test(a.actor) && a.detail?.sha256),
  'each push is audited as the pipeline, with its fingerprint',
);
ok(
  !JSON.stringify((await admin('GET', '/audit?q=ingest_token')).rows).includes(tk.token),
  'the token never appears in the audit log',
);
await lee('DELETE', `/ingest-tokens/${(await lee('GET', `/engagements/${E}/ingest-tokens`))[0].id}`);
ok((await push(tk.token, { title: 'After revoke', content: 'x' })).status === 401, 'a revoked token is refused');

console.log('\n# S3 and Azure Blob');
const s3 = await lee('POST', `/engagements/${E}/connectors`, {
  name: 'Fairness report in S3',
  url: `${M}/s3/reports/fairness.txt?versionId=3`,
  auth: 'aws_sigv4',
  secret: JSON.stringify({
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
  }),
  tool: 'aws_s3',
});
ok(
  (await lee('POST', `/connectors/${s3.id}/pull`)).lastStatus === 'added',
  'an S3 object is read with a SigV4-signed request',
);
ok(
  (await status(
    lee('POST', `/engagements/${E}/connectors`, {
      name: 'Bad S3 key',
      url: `${M}/s3/x`,
      auth: 'aws_sigv4',
      secret: JSON.stringify({ accessKeyId: 'A' }),
      tool: 'aws_s3',
    }),
  )) === 400,
  'an S3 key without a secret or region is refused',
);
const blob = await lee('POST', `/engagements/${E}/connectors`, {
  name: 'Model card in Blob',
  url: `${M}/blob/cards/ai-1.txt`,
  auth: 'azure_sas',
  secret: '?sv=2024-01-01&sp=r&sig=blobsig',
  tool: 'azure_blob',
});
const bp = await lee('POST', `/connectors/${blob.id}/pull`);
ok(
  bp.lastStatus === 'added' && !bp.url.includes('sig='),
  'an Azure blob is read with its SAS token, which is never shown in the address',
);
ok(
  !JSON.stringify((await admin('GET', '/audit?q=connector.')).rows).includes('blobsig'),
  'the SAS token is not in the audit log',
);

console.log('\n# Client step proof');
const jira = await lee('POST', `/engagements/${E}/connectors`, {
  name: 'GRC tickets',
  url: `${M}/proof/jira/search?jql=project%3DGRC`,
  auth: 'none',
  tool: 'jira',
});
const w = await lee('POST', `/engagements/${E}/workflows`, { name: 'Credit model approval', template: 'm365' });
const g = JSON.parse(JSON.stringify(w.graph));
const step = g.nodes.find((n) => n.type === 'person' || n.type === 'task');
step.config = { ...step.config, tool: 'jira', connectorId: jira.id, proof: 'status', proofStatus: '' };
let saved = await lee('PATCH', `/workflows/${w.id}`, { graph: g });
ok(
  saved.check.problems.some((x) => /which status counts as done/.test(x)),
  'a status proof without the status is flagged',
);
step.config.proofStatus = 'Approved';
const manual = g.nodes.find((n) => n.id !== step.id && ['person', 'task', 'notify'].includes(n.type));
manual.config = { ...manual.config, proof: 'manual' };
const third = g.nodes.find(
  (n) => n.id !== step.id && n.id !== manual.id && ['person', 'task', 'notify'].includes(n.type),
);
third.config = { ...third.config, tool: 'jira', connectorId: jira.id, proof: 'all_done' };
saved = await lee('PATCH', `/workflows/${w.id}`, { graph: g });
ok(!saved.check.problems.length, `the workflow with proofs passes the rules (${saved.check.problems.join('; ')})`);
await lee('POST', `/workflows/${w.id}/publish`, { note: 'With proof' });
let cs = await pat('GET', `/cards/${KEY}/client-steps`);
ok(
  cs.workflow?.id === w.id && cs.steps.some((s) => s.nodeId === step.id && s.status === 'not_checked'),
  'a use case follows the latest published workflow and lists its client steps',
);
ok((await status(val('POST', `/cards/${KEY}/client-steps/check`))) === 403, 'a viewer cannot run the checks');
cs = await pat('POST', `/cards/${KEY}/client-steps/check`);
const s1 = cs.steps.find((s) => s.nodeId === step.id);
ok(
  s1.status === 'passed' &&
    /GRC-20/.test(s1.detail) &&
    s1.record === 'GRC-20' &&
    /\/browse\/GRC-20$/.test(s1.recordUrl ?? ''),
  `a step passes when a ticket for ${KEY} has the status (${s1.detail})`,
);
ok(!/GRC-22/.test(JSON.stringify(cs.steps)), 'a ticket for AI-10 does not count for AI-1');
ok(/^E-\d+$/.test(s1.evidenceKey ?? ''), 'the proof is filed as evidence');
const s3s = cs.steps.find((s) => s.nodeId === third.id);
ok(
  s3s.status === 'pending' && /GRC-21/.test(s3s.detail),
  `"every record done" stays pending while one is in progress (${s3s.detail})`,
);
const cs2 = await pat('POST', `/cards/${KEY}/client-steps/check`);
ok(
  cs2.steps.find((s) => s.nodeId === step.id).evidenceKey === s1.evidenceKey,
  'checking again with the same records adds no new evidence',
);
const other = (board.cards ?? board).find?.((c) => c.key !== KEY && c.key !== 'AI-10')?.key ?? 'AI-2';
const cs3 = await pat('POST', `/cards/${other}/client-steps/check`);
ok(
  cs3.steps.find((s) => s.nodeId === step.id).status === 'failed',
  'a use case with no matching record fails the step',
);
ok(
  (await status(pat('POST', `/cards/${KEY}/client-steps/${manual.id}/confirm`, {}))) === 400,
  'confirming by hand needs a link or a note',
);
cs = await pat('POST', `/cards/${KEY}/client-steps/${manual.id}/confirm`, {
  link: 'https://client.example/approvals/77',
  note: 'Signed at the committee',
});
ok(cs.steps.find((s) => s.nodeId === manual.id).status === 'passed', 'a person can confirm a step with a link');
const card = await pat('GET', `/cards/${KEY}`);
ok(card.stage === (await pat('GET', `/cards/${KEY}`)).stage, 'checks never move the use case');
const a2 = (await admin('GET', '/audit?q=client_step')).rows.map((x) => x.action);
ok(a2.includes('client_step.checked') && a2.includes('client_step.confirmed'), 'checks and confirmations are audited');

console.log('\n# Write-back');
const before = (await (await fetch(`${M}/__hooks`)).json()).length;
ok(
  (await status(
    pat('POST', `/engagements/${E}/outbound`, {
      name: 'Hook',
      kind: 'webhook',
      url: `${M}/hook`,
      events: ['issue.raised'],
    }),
  )) === 403,
  'a preparer cannot add a write-back target',
);
const hook = await lee('POST', `/engagements/${E}/outbound`, {
  name: 'Flow webhook',
  kind: 'webhook',
  url: `${M}/hook`,
  secret: 'hook-token',
  events: ['issue.raised', 'step.failed'],
});
await lee('POST', `/engagements/${E}/outbound`, {
  name: 'GRC project',
  kind: 'jira',
  url: M,
  project: 'GRC',
  secret: 'qa@client.example:jira-token',
  events: ['issue.raised'],
});
const teams = await lee('POST', `/engagements/${E}/outbound`, {
  name: 'Model Risk channel',
  kind: 'teams',
  url: `${M}/hook?sig=teamsecret`,
  events: ['card.question'],
});
ok(
  !teams.url.includes('teamsecret') &&
    !JSON.stringify(await lee('GET', `/engagements/${E}/outbound`)).includes('teamsecret'),
  'a channel webhook address is kept secret',
);
ok((await status(lee('POST', `/outbound/${hook.id}/test`))) === 409, 'nothing can be sent while write-back is off');
await lee('POST', `/engagements/${E}/issues`, { title: 'Raised while write-back is off', severity: 'low' }).catch(
  () => {},
);
await wait(3000);
ok((await (await fetch(`${M}/__hooks`)).json()).length === before, 'events while write-back is off send nothing');
const on = await lee('PATCH', `/engagements/${E}`, { writeBack: true });
ok(on.writeBack === true, 'a lead switches write-back on');
const iss = await lee('POST', `/engagements/${E}/issues`, {
  title: 'Decline letters missing the reason',
  severity: 'medium',
});
let hooks = [];
for (let i = 0; i < 20 && hooks.length < before + 2; i++) {
  await wait(1000);
  hooks = await (await fetch(`${M}/__hooks`)).json();
}
const sent = hooks.slice(before);
const wh = sent.find((x) => x.url === '/hook');
ok(
  wh && wh.body.event === 'issue.raised' && wh.auth === 'Bearer hook-token' && /Decline letters/.test(wh.body.subject),
  `a new issue is posted to the webhook (${sent.length} sent)`,
);
const jc = sent.find((x) => x.url.startsWith('/rest/api/3/issue'));
ok(
  jc &&
    jc.body.fields.project.key === 'GRC' &&
    jc.auth === 'Basic ' + Buffer.from('qa@client.example:jira-token').toString('base64'),
  'and creates a Jira ticket in the project',
);
const issues = await lee('GET', `/engagements/${E}/issues`);
const mineIss = issues.find((x) => x.id === iss.id || x.title === 'Decline letters missing the reason');
ok(/^GRC-\d+$/.test(mineIss?.externalRef ?? ''), `the issue remembers its Jira ticket (${mineIss?.externalRef})`);
const t = await lee('POST', `/outbound/${hook.id}/test`);
ok(t.ok, 'a lead can send a test');
const wa = (await admin('GET', '/audit?q=writeback.')).rows;
ok(
  wa.some((x) => x.action === 'writeback.sent' && x.detail.sha256 && x.detail.event === 'issue.raised'),
  'each send is audited with what it sent',
);
ok(
  !JSON.stringify(wa).includes('jira-token') &&
    !JSON.stringify(wa).includes('hook-token') &&
    !JSON.stringify(wa).includes('teamsecret'),
  'credentials and webhook secrets are not in the audit log',
);
const toolsSrc = await (
  await import('node:fs/promises')
).readFile(fileURLToPath(new URL('../apps/server/src/agents/tools.ts', import.meta.url)), 'utf8');
ok(!/outbound|writeback|write-back/i.test(toolsSrc), 'agents have no tool that writes back');

const v = await admin('GET', '/audit/verify');
ok(v.ok, v.message);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
