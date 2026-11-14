// API smoke test: roles, segregation of duties, gates, exit criteria, evidence
// hashing, issue lifecycle, residual risk, evals, report sign-off and the audit
// chain. Run against a FRESH database: npm run db:reset, npm start, then
// npm run smoke (BASE_URL defaults to http://localhost:4300).
const B = (process.env.BASE_URL || 'http://localhost:4300') + '/api';
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(B + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
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
      const e = new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`);
      e.status = r.status;
      e.body = j;
      throw e;
    }
    return j;
  };
}
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) process.exitCode = 1;
};
const expectErr = async (p, status, m) => {
  try {
    await p;
    ok(false, m + ' (no error)');
  } catch (e) {
    ok(e.status === status, `${m} -> ${e.status} ${e.body?.error ?? ''}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const anon = client();
const st = await anon('GET', '/auth/state');
ok(st.needsSetup, 'needs setup on fresh db');
await expectErr(anon('GET', '/engagements'), 401, 'API locked before sign-in');
const admin = client();
await admin('POST', '/auth/setup', {
  name: 'Andrew Lawrence',
  email: 'andrew@example.com',
  password: 'correct-horse-9',
});
await expectErr(
  anon('POST', '/auth/setup', { name: 'X Y', email: 'x@example.com', password: 'correct-horse-9' }),
  409,
  'second setup refused',
);
await admin('POST', '/users', {
  name: 'Riley Reviewer',
  email: 'riley@example.com',
  role: 'reviewer',
  password: 'correct-horse-9',
});
await admin('POST', '/users', {
  name: 'Pat Preparer',
  email: 'pat@example.com',
  role: 'preparer',
  password: 'correct-horse-9',
});
await admin('POST', '/users', {
  name: 'Val Viewer',
  email: 'val@example.com',
  role: 'viewer',
  password: 'correct-horse-9',
});
const riley = client();
await riley('POST', '/auth/login', { email: 'riley@example.com', password: 'correct-horse-9' });
const pat = client();
await pat('POST', '/auth/login', { email: 'pat@example.com', password: 'correct-horse-9' });
const val = client();
await val('POST', '/auth/login', { email: 'val@example.com', password: 'correct-horse-9' });
await expectErr(
  anon('POST', '/auth/login', { email: 'pat@example.com', password: 'wrong' }),
  401,
  'bad password refused',
);

const [eng] = await admin('GET', '/engagements');
const E = eng.id;
const lib = await admin('GET', '/library');
ok(lib.length >= 30, `library has ${lib.length} controls`);
const obl = await admin('GET', '/obligations');
ok(obl.length >= 20, `${obl.length} obligations`);
const inv = await admin('GET', `/engagements/${E}/inventory`);
ok(inv.length === 5, `inventory seeded (${inv.length})`);
const agents = inv.filter((i) => i.kind === 'agent');
console.log(
  '   agent readiness:',
  agents.map((a) => `${a.name}: ${a.readiness?.ok ? 'ready' : a.readiness?.missing.length + ' missing'}`).join('; '),
);

await expectErr(
  val('POST', `/engagements/${E}/issues`, { title: 'x', severity: 'low' }),
  403,
  'viewer cannot raise issue',
);
await expectErr(pat('PATCH', `/engagements/${E}`, { name: 'Hacked' }), 403, 'preparer cannot change engagement');

// Flow AI-1 through classify -> design
const board = await admin('GET', `/engagements/${E}/board`);
const card = (board.cards ?? board).find((c) => c.key === 'AI-1');
await riley('POST', `/cards/${card.id}/actions`, { action: 'approve', note: 'In scope' });
const waitFor = async (pred, label, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const c = await admin('GET', `/cards/${card.id}`);
    const cc = c.card ?? c;
    if (pred(cc)) return cc;
    await sleep(700);
  }
  throw new Error('timeout ' + label);
};
let c = await waitFor((c) => c.stage === 'classify' && c.status === 'needs_approval', 'classify');
ok(!!c.classification, `classified tier=${c.classification?.tier ?? c.tier}`);
await expectErr(pat('POST', `/cards/${card.id}/actions`, { action: 'approve' }), 403, 'preparer cannot approve gate');
await riley('POST', `/cards/${card.id}/decisions`, { rest: 'accept' });
await riley('POST', `/cards/${card.id}/actions`, { action: 'approve', note: 'Tier agreed' });
c = await waitFor((c) => c.stage === 'design' && c.status === 'needs_approval', 'design');
ok(c.design?.controls?.length > 0, `design proposed ${c.design?.controls?.length} controls`);
await riley('POST', `/cards/${card.id}/decisions`, { rest: 'accept' });
await riley('POST', `/cards/${card.id}/actions`, { action: 'approve', note: 'Controls agreed' });
c = await waitFor((c) => c.stage !== 'design', 'after design');
console.log('   now at', c.stage, c.status, c.statusNote ?? '');

const controls = (await admin('GET', `/engagements/${E}/controls`)).filter((x) => x.cardKey === 'AI-1');
ok(controls.length > 0, `${controls.length} controls created for AI-1`);
const tests = (await admin('GET', `/engagements/${E}/tests`)).filter((t) => controls.some((x) => x.id === t.controlId));
ok(tests.length > 0, `${tests.length} draft tests created`);
const risks = (await admin('GET', `/engagements/${E}/risks`)).filter((r) => r.cardKey === 'AI-1');
ok(
  risks.every((r) => r.score < 12 || r.controlCount > 0),
  'every high risk has a control',
);

// exit criteria: try to advance evidence without evidence
await expectErr(
  admin('POST', `/cards/${card.id}/actions`, { action: 'advance' }),
  409,
  'evidence gate blocks without evidence',
);

// Evidence on each control
for (const ctl of controls) {
  await pat('POST', '/evidence', {
    engagementId: E,
    controlId: ctl.id,
    title: `Walkthrough notes ${ctl.key}`,
    kind: 'note',
    note: 'Walked through the control with the owner.',
  });
}
const t0 = tests[0];
const fileB64 = Buffer.from('sample of 25 loan declines reviewed').toString('base64');
const ev = await pat('POST', '/evidence', {
  engagementId: E,
  testId: t0.id,
  controlId: t0.controlId,
  title: 'Sample workpaper',
  kind: 'file',
  filename: 'sample.txt',
  mime: 'text/plain',
  dataBase64: fileB64,
});
ok(ev.sha256?.length === 64, 'evidence hashed');
const ver = await admin('GET', `/evidence/${ev.id}/verify`);
ok(ver.ok, 'evidence integrity verifies');
await admin('POST', `/cards/${card.id}/actions`, { action: 'advance' });
c = await waitFor((c) => c.stage === 'test', 'test stage');

// Tests: pat prepares, pat cannot review own, riley reviews
for (const t of tests) {
  const fail = t.id === t0.id;
  await pat('PATCH', `/tests/${t.id}`, {
    status: fail ? 'failed' : 'passed',
    actual: fail ? '3 of 25 declines had no reviewer sign-off' : 'No exceptions',
    exceptions: fail ? 3 : 0,
    sampleSize: 25,
  });
}
await expectErr(pat('POST', `/tests/${t0.id}/review`, {}), 403, 'preparer cannot review own test (SoD)');
for (const t of tests) await riley('POST', `/tests/${t.id}/review`, {});
const issue = await pat('POST', `/engagements/${E}/issues`, {
  title: 'Loan declines released without reviewer sign-off',
  severity: 'high',
  testId: t0.id,
  controlId: t0.controlId,
  cardId: card.id,
  owner: 'Head of Retail Credit',
  description: '3 of 25',
});
ok(issue.key?.startsWith('I-'), `issue raised ${issue.key}`);
await admin('POST', `/cards/${card.id}/actions`, { action: 'advance' });
c = await waitFor((c) => c.stage === 'remediate', 'remediate');
await expectErr(
  admin('POST', `/cards/${card.id}/actions`, { action: 'advance' }),
  409,
  'open high issue blocks remediate',
);
await pat('PATCH', `/issues/${issue.id}`, {
  status: 'in_remediation',
  managementResponse: 'Adding a mandatory sign-off field',
  dueDate: '2026-12-15',
});
await pat('PATCH', `/issues/${issue.id}`, { status: 'ready_for_retest' });
await expectErr(pat('PATCH', `/issues/${issue.id}`, { status: 'closed' }), 403, 'preparer cannot close own issue');
await expectErr(
  riley('PATCH', `/issues/${issue.id}`, { status: 'closed' }),
  409,
  'cannot close without a passed retest',
);
const retest = await pat('POST', `/engagements/${E}/tests`, {
  controlId: t0.controlId,
  kind: 'retest',
  title: 'Retest after fix',
  procedure: 'Re-sample 25 declines',
  population: 'Declines Nov',
  sampleSize: 25,
  expected: 'All signed off',
});
await expectErr(
  pat('PATCH', `/tests/${t0.id}`, { status: 'passed', actual: 'x', exceptions: 0 }),
  409,
  'reviewed result is locked',
);
await riley('PATCH', `/tests/${retest.id}`, { status: 'passed', actual: '25 of 25 signed off', exceptions: 0 });
await expectErr(
  riley('POST', `/tests/${retest.id}/review`, {}),
  403,
  'reviewer cannot review a test they prepared (SoD)',
);
await admin('POST', `/tests/${retest.id}/review`, {});
const ctlAfter = (await admin('GET', `/engagements/${E}/controls`)).find((x) => x.id === t0.controlId);
ok(ctlAfter.status === 'operating', 'control back to operating after retest: ' + ctlAfter.status);
await riley('PATCH', `/issues/${issue.id}`, { status: 'closed' });
await admin('POST', `/cards/${card.id}/actions`, { action: 'advance' });
c = await waitFor((c) => c.stage !== 'remediate', 'after remediate');
console.log('   now at', c.stage);

// Residual & acceptance
const r0 = risks[0];
await pat('PATCH', `/risks/${r0.id}`, { residual_likelihood: 2, residual_impact: 2 });
await expectErr(pat('PATCH', `/risks/${r0.id}`, { accept: true }), 403, 'preparer cannot accept risk');
const acc = await riley('PATCH', `/risks/${r0.id}`, { accept: true });
ok(acc.acceptedBy === 'Riley Reviewer' && acc.residualScore === 4, 'reviewer accepts within appetite');
const r1 = risks[1] ?? risks[0];
await admin('PATCH', `/risks/${r1.id}`, { residual_likelihood: 4, residual_impact: 4 });
await expectErr(riley('PATCH', `/risks/${r1.id}`, { accept: true }), 403, 'above-appetite acceptance needs a lead');

// SoA
const soa = await admin('GET', `/engagements/${E}/soa`);
ok(soa.length === lib.length, 'SoA lists library');
await admin('PUT', `/engagements/${E}/soa/${lib[0].id}`, { applicable: true, justification: 'Policy in scope' });

// Evals
const suites = await admin('GET', `/engagements/${E}/evals`);
ok(suites.length === 2, 'two seeded suites');
for (const s of suites) {
  const run = await pat('POST', `/evals/${s.id}/run`, {});
  let rr;
  for (let i = 0; i < 40; i++) {
    rr = await admin('GET', `/eval-runs/${run.runId}`);
    if (rr.status !== 'running') break;
    await sleep(300);
  }
  console.log(`   ${s.name}: ${rr.status} ${rr.passed}/${rr.total}`);
  if (s.kind === 'red_team') {
    const iss = await pat('POST', `/eval-runs/${rr.id}/issues`, {});
    ok(Array.isArray(iss) ? iss.length > 0 : !!iss, 'issues raised from failed red-team cases');
  }
}

// Traceability, assessment, report
const tr = await admin('GET', `/engagements/${E}/traceability`);
console.log('   traceability keys:', Object.keys(tr));
const asmt = await admin('GET', `/engagements/${E}/assessment`);
console.log('   assessment:', JSON.stringify(asmt).slice(0, 200));
await admin('PUT', `/engagements/${E}/assessment/govern`, { score: 2, rationale: 'Policy exists; no committee yet' });
const rep = await admin('GET', `/engagements/${E}/report`);
console.log('   report keys:', Object.keys(rep));
await expectErr(pat('POST', `/engagements/${E}/report/sign`, {}), 403, 'preparer cannot sign report');
for (const a of asmt)
  if (a.id !== 'govern')
    await admin('PUT', `/engagements/${E}/assessment/${a.id}`, {
      score: a.suggested ?? 2,
      rationale: (a.reasons ?? []).join('; '),
    });
await expectErr(admin('POST', `/engagements/${E}/report/sign`, {}), 403, 'assessor cannot sign own report (SoD)');
await admin('POST', '/users', {
  name: 'Lee Lead',
  email: 'lee@example.com',
  role: 'lead',
  password: 'correct-horse-9',
});
const lee = client();
await lee('POST', '/auth/login', { email: 'lee@example.com', password: 'correct-horse-9' });
const signed = await lee('POST', `/engagements/${E}/report/sign`, {});
ok(!!signed, 'lead signs report');

// Kill switch
const ag = await admin('GET', `/engagements/${E}/agents`).catch(() => admin('GET', `/agents?engagementId=${E}`));
const a0 = (ag.agents ?? ag)[0];
await admin('POST', `/agents/${a0.id}/kill`, { test: true })
  .then((x) => ok(true, 'kill switch test ' + JSON.stringify(x).slice(0, 100)))
  .catch((e) => ok(false, e.message));

// v0.4: engagements, renames, sessions, audit filters
const providers = await admin('GET', '/providers');
const rulesP = providers.find((x) => x.type === 'rules');
const newEng = {
  name: 'Readiness 2027',
  client: 'Harbourview Credit Union',
  prefix: 'HCU',
  frameworks: ['nistAiRmf', 'jdpa'],
  startSoa: true,
  appetite: { maxResidual: 6, statement: '', escalateTo: 'Board' },
  gates: { classify: true, design: true },
  agents: {
    risk_classifier: { providerId: rulesP.id, model: 'rules-v1', effort: 'low' },
    control_designer: { providerId: rulesP.id, model: 'rules-v1', effort: 'low' },
  },
  useCases: ['Member chatbot', 'Loan document reader'],
};
await expectErr(pat('POST', '/engagements', newEng), 403, 'preparer cannot add an engagement');
await expectErr(lee('POST', '/engagements', { ...newEng, prefix: 'AI' }), 409, 'card prefix must be unique');
const hcu = await lee('POST', '/engagements', newEng);
ok(hcu.prefix === 'HCU' && hcu.appetite.maxResidual === 6, 'lead adds an engagement');
const hb = await lee('GET', `/engagements/${hcu.id}/board`);
ok(hb.cards.map((c) => c.key).join() === 'HCU-1,HCU-2', 'starting use cases land in Intake');
const eb = (await admin('GET', `/engagements/${E}/board`)).cards;
ok(
  eb.some((c) => ['Riley Reviewer', 'Andrew Lawrence', 'Pat Preparer'].includes(c.updatedBy)),
  `cards carry who last changed them (${eb.map((c) => `${c.key}:${c.updatedBy}`).join(', ')})`,
);
const agentOnly = eb.filter((c) => c.updatedBy && !/[A-Z][a-z]+ [A-Z]/.test(c.updatedBy));
ok(agentOnly.length === 0, 'an agent is never shown as the person who changed a card');
const hsoa = await lee('GET', `/engagements/${hcu.id}/soa`);
ok(
  hsoa.some((x) => x.applicable === true) && hsoa.some((x) => x.applicable === null),
  `SoA started (${hsoa.filter((x) => x.applicable).length} applicable)`,
);
await expectErr(
  lee('POST', `/cards/${hb.cards[0].id}/actions`, { action: 'approve' }),
  403,
  'creator cannot triage their own imported use case',
);
await expectErr(pat('PATCH', '/auth/me', { name: 'Riley Reviewer' }), 409, "cannot take someone else's name");
// Rename must not open a segregation-of-duties hole
const rt = await pat('POST', `/engagements/${E}/tests`, {
  controlId: t0.controlId,
  kind: 'operating',
  title: 'Rename check',
  procedure: 'x',
});
await riley('PATCH', `/tests/${rt.id}`, { status: 'passed', actual: 'fine', exceptions: 0 });
await riley('PATCH', '/auth/me', { name: 'Riley R. Reviewer' });
await expectErr(
  riley('POST', `/tests/${rt.id}/review`, {}),
  403,
  'renamed reviewer still cannot review their own test',
);
await expectErr(pat('PATCH', '/auth/me', { name: 'Riley Reviewer' }), 409, 'former names stay reserved');
const sess = await riley('GET', '/auth/sessions');
ok(sess.length === 1 && sess[0].current, 'sessions list shows this browser');
const au = await admin('GET', '/audit?action=user.renamed');
ok(au.total === 1 && au.rows[0].ip, `audit filter by action, with address (${au.rows[0].ip})`);
const au2 = await admin('GET', '/audit?q=Harbourview&pageSize=25');
ok(au2.total >= 1, 'audit search');
await riley('POST', '/auth/sessions/end-all', {});
await expectErr(riley('GET', '/engagements'), 401, 'signed out everywhere');

// v0.4.1: archive and delete
await expectErr(pat('POST', `/engagements/${hcu.id}/archive`, {}), 403, 'preparer cannot archive');
await expectErr(lee('DELETE', `/engagements/${hcu.id}`, { confirm: hcu.name }), 403, 'lead cannot delete (admin only)');
await expectErr(
  admin('DELETE', `/engagements/${hcu.id}`, { confirm: hcu.name }),
  409,
  'cannot delete before archiving',
);
const arch = await lee('POST', `/engagements/${hcu.id}/archive`, { reason: 'Report delivered' });
ok(!!arch.archivedAt && arch.archivedBy === 'Lee Lead', 'lead archives an engagement');
const hcuCard = hb.cards[1];
await expectErr(
  admin('POST', `/engagements/${hcu.id}/cards`, {
    title: 'New thing',
    businessOwner: 'x',
    description: '',
    dataUsed: '',
    affectedPeople: '',
    autonomy: 'assistive',
    vendor: '',
  }),
  409,
  'archived: cannot add a use case',
);
await expectErr(
  admin('POST', `/cards/${hcuCard.id}/actions`, { action: 'approve' }),
  409,
  'archived: cannot approve a gate',
);
await expectErr(admin('PATCH', `/engagements/${hcu.id}`, { name: 'Renamed' }), 409, 'archived: settings are read-only');
await expectErr(
  admin('PUT', `/engagements/${hcu.id}/soa/${hsoa[0].id}`, { applicable: false, justification: 'Not needed here' }),
  409,
  'archived: SoA is read-only',
);
const still = await admin('GET', `/engagements/${hcu.id}/board`);
ok(still.cards.length === 2, 'archived: still readable');
const rec = await admin('GET', `/engagements/${hcu.id}/export`);
ok(
  rec.cards.length === 2 && rec.statementOfApplicability.length > 0 && rec.audit.length > 0,
  'full record exports as JSON',
);
await lee('POST', `/engagements/${hcu.id}/restore`, {});
await admin('POST', `/cards/${hcuCard.id}/actions`, { action: 'approve' });
ok(true, 'restored: writable again');
await expectErr(
  lee('POST', `/engagements/${E}/archive`, {}).then(() => lee('POST', `/engagements/${hcu.id}/archive`, {})),
  409,
  'cannot archive the last active engagement',
);
await lee('POST', `/engagements/${E}/restore`, {});
await new Promise((r) => setTimeout(r, 3500)); // let the classifier finish the card approved above
await lee('POST', `/engagements/${hcu.id}/archive`, {});
await expectErr(
  admin('DELETE', `/engagements/${hcu.id}`, { confirm: 'readiness 2027' }),
  400,
  'delete needs the exact name',
);
const del = await admin('DELETE', `/engagements/${hcu.id}`, { confirm: hcu.name });
ok(del.ok && del.removed.cards === 2, `admin deletes it (removed ${JSON.stringify(del.removed)})`);
await expectErr(admin('GET', `/engagements/${hcu.id}/board`), 404, 'deleted engagement is gone');
const trail = await admin('GET', '/audit?action=engagement.deleted');
ok(trail.total === 1 && trail.rows[0].detail.removed.cards === 2, 'audit keeps who deleted it and what went');

const v = await admin('GET', '/audit/verify');
ok(v.ok, `audit chain verifies (${JSON.stringify(v)})`);

console.log('\nThis test created these accounts, all with the password correct-horse-9:');
console.log(
  '  andrew@example.com (admin), riley@example.com (reviewer), pat@example.com (preparer), val@example.com (viewer), lee@example.com (lead)',
);
console.log('Run npm run db:reset (with the app stopped) to clear them and start again.');
