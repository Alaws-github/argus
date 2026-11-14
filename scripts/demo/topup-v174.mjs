// Adds the v1.7.3 and v1.7.4 demo pieces to a site whose demo clients were
// built before those versions (npm run demo skips clients that are already
// there). It only adds; it never changes or deletes what's there, and it's
// safe to run again: each piece is skipped if it exists already.
//
//   Northshore Financial Group (demo): its client tools, a published client
//   workflow with proof on three steps (two confirmed on its first use case),
//   a pipeline token with one push of evaluation results, a write-back target
//   (write-back stays off), two of its own controls (one mapped to the
//   library), and the EU AI Act model-provider articles marked not applicable.
//   Palmcrest Health Network (demo): HIPAA and FDA GMLP in scope, with the
//   healthcare library controls marked as applying.
//
// Run with the app running, for example in PowerShell:
//   $env:BASE_URL="https://your-site.example"; npm run demo:topup
// If the site's admin isn't andrew@example.com with the demo password, also set
// DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD (in your terminal, never in a file).
import { B, PW, client, step } from './lib.mjs';

const admin = client();
const email = process.env.DEMO_ADMIN_EMAIL || 'andrew@example.com';
try {
  await admin('POST', '/auth/login', { email, password: process.env.DEMO_ADMIN_PASSWORD || PW });
} catch (e) {
  console.error(
    `Couldn't sign in to ${B} as ${email} (${e.message.slice(0, 120)}).\nSet DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD for an admin on that site, then run again.`,
  );
  process.exit(1);
}
const me = await admin('GET', '/auth/me');
if (me.role !== 'admin') {
  console.error(`${email} is not an admin. Use an admin account.`);
  process.exit(1);
}
console.log(`Signed in to ${B} as ${me.name} (admin)`);

// Act as the demo people where they exist, so the records read naturally; otherwise the admin does it.
const as = async (who) => {
  const c = client();
  try {
    await c('POST', '/auth/login', { email: `${who}@example.com`, password: PW });
    return c;
  } catch {
    return admin;
  }
};
const jordan = await as('jordan');
const sam = await as('sam');
const engagements = await admin('GET', '/engagements');

// ------------------------------------------------------------------ Northshore
const ns = engagements.find((e) => e.client === 'Northshore Financial Group (demo)');
if (!ns) console.log('\nNorthshore Financial Group (demo): not on this site, skipped');
else {
  const E = ns.id;
  const key1 = `${ns.prefix}-1`;
  console.log(`\nNorthshore Financial Group (demo)`);
  if (!ns.modules?.connectors || !ns.clientTools?.length) {
    await jordan('PATCH', `/engagements/${E}`, {
      modules: { connectors: true },
      clientTools: ['sharepoint', 'teams', 'excel', 'power_automate', 'outlook', 'jira'],
    });
    step('Client tools and workflows switched on, with its Microsoft 365 and Jira tools');
  }
  const wfs = await admin('GET', `/engagements/${E}/workflows`);
  if (!wfs.some((w) => w.name === 'Credit model approval')) {
    const wf = await jordan('POST', `/engagements/${E}/workflows`, {
      name: 'Credit model approval',
      description: 'How Northshore takes a credit or pricing model live, in its Microsoft 365 tools',
      template: 'm365',
    });
    const g = JSON.parse(JSON.stringify(wf.graph));
    const proofs = { 'p-classify': 'manual', 't-dpia': 'manual', 'p-signoff': 'manual' };
    for (const n of g.nodes) if (proofs[n.id]) n.config = { ...n.config, proof: proofs[n.id] };
    await jordan('PATCH', `/workflows/${wf.id}`, { graph: g });
    await jordan('POST', `/workflows/${wf.id}/publish`, { note: 'Agreed with the Model Risk Committee' });
    step('A published client workflow, "Credit model approval", with proof on three steps');
  } else step('Client workflow already there');
  const cs = await sam('GET', `/cards/${key1}/client-steps`).catch(() => null);
  const manual = (cs?.steps ?? []).filter((x) => x.proof === 'manual');
  const links = [
    ['https://northshore-demo.example/approvals/power-automate/4471', 'Tier approved in the Power Automate flow'],
    ['https://northshore-demo.example/sharepoint/impact-assessments/AI-1', 'Impact assessment v2 in the library'],
  ];
  let confirmed = 0;
  for (const [i, s] of manual.slice(0, 2).entries()) {
    if (s.status === 'passed') continue;
    await sam('POST', `/cards/${key1}/client-steps/${s.nodeId}/confirm`, { link: links[i][0], note: links[i][1] })
      .then(() => confirmed++)
      .catch(() => {});
  }
  if (confirmed) step(`${confirmed} client steps confirmed on ${key1}`);

  const tokens = await admin('GET', `/engagements/${E}/ingest-tokens`);
  if (!tokens.some((t) => t.name === 'Credit model CI')) {
    const tk = await jordan('POST', `/engagements/${E}/ingest-tokens`, { name: 'Credit model CI' });
    const ctl = (await admin('GET', `/engagements/${E}/controls`))[0];
    const r = await fetch(`${B}/ingest/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tk.token}` },
      body: JSON.stringify({
        title: 'Credit model 2.3: evaluation results',
        kind: 'eval',
        useCase: key1,
        control: ctl?.key,
        filename: 'eval-2.3.json',
        content: JSON.stringify({ auc: 0.91, approvalRateGapByAgeBand: 0.021, threshold: 0.03, passed: true }),
        metrics: { auc: 0.91, approvalGapPct: 2.1, passed: true },
        source: {
          system: 'github',
          repo: 'northshore/credit-model',
          branch: 'main',
          commit: '4f2a9c1e7b3d',
          run: '1187',
        },
      }),
    });
    step(
      r.ok
        ? `A pipeline token, and one push of evaluation results for ${key1}`
        : `A pipeline token (the push was refused: ${r.status})`,
    );
  } else step('Pipeline token already there');

  const targets = await admin('GET', `/engagements/${E}/outbound`);
  if (!targets.some((t) => t.name === 'Model Risk channel')) {
    await jordan('POST', `/engagements/${E}/outbound`, {
      name: 'Model Risk channel',
      kind: 'teams',
      url: 'https://northshore-demo.example/teams-webhook/model-risk',
      events: ['card.waiting', 'test.failed', 'issue.raised'],
    });
    step('A write-back target to the Model Risk channel (write-back stays off)');
  }

  const controls = await admin('GET', `/engagements/${E}/controls`);
  if (!controls.some((c) => c.title === 'Vendor contracts reviewed for AI data use')) {
    const csv =
      'Title,Objective,Type\nVendor contracts reviewed for AI data use,Contracts with AI suppliers are checked before signing for data use and audit rights,preventive\nQuarterly penetration test of the chatbot,Security test the chatbot every quarter,detective\n';
    const imp = await jordan('POST', `/engagements/${E}/controls/import`, {
      filename: 'northshore-controls.csv',
      dataBase64: Buffer.from(csv).toString('base64'),
      preview: false,
    });
    const c0 = (await admin('GET', `/engagements/${E}/controls`)).find((c) => c.key === imp.added?.[0]);
    if (c0) await sam('POST', `/controls/${c0.id}/map`, { libraryCode: 'TPR-01' });
    step("Two of Northshore's own controls uploaded; one mapped to the library across frameworks");
  }

  const rq = await admin('GET', `/engagements/${E}/requirements?framework=euAiAct`).catch(() => null);
  const eu = rq?.frameworks?.[0];
  if (eu?.inScope) {
    let n = 0;
    for (const ref of ['Art. 53', 'Art. 54', 'Art. 55']) {
      if (eu.rows.find((r) => r.id === ref)?.status === 'not_applicable') continue;
      await jordan('PUT', `/engagements/${E}/requirements/euAiAct`, {
        ref,
        applicable: false,
        reason: 'Northshore uses general-purpose models from vendors; it does not provide one.',
      })
        .then(() => n++)
        .catch(() => {});
    }
    if (n) step('EU AI Act model-provider articles marked not applicable, with the reason');
  }
}

// ------------------------------------------------------------------ Palmcrest
const pc = engagements.find((e) => e.client === 'Palmcrest Health Network (demo)');
if (!pc) console.log('\nPalmcrest Health Network (demo): not on this site, skipped');
else {
  console.log('\nPalmcrest Health Network (demo)');
  const add = ['FDA Good Machine Learning Practice', 'HIPAA and HHS health AI rules'].filter(
    (l) => !pc.framework.includes(l),
  );
  if (add.length) {
    await jordan('PATCH', `/engagements/${pc.id}`, { framework: [pc.framework, ...add].join(' · ') });
    step(`${add.join(' and ')} added to the frameworks in scope`);
  } else step('HIPAA and FDA GMLP already in scope');
  const soa = await admin('GET', `/engagements/${pc.id}/soa`);
  let n = 0;
  for (const l of soa.filter((x) => /^HLT-/.test(x.code) && x.applicable == null)) {
    await jordan('PUT', `/engagements/${pc.id}/soa/${l.id}`, {
      applicable: true,
      justification: 'Palmcrest handles protected health information and runs clinical AI tools.',
    })
      .then(() => n++)
      .catch(() => {});
  }
  if (n) step(`${n} healthcare library control${n === 1 ? '' : 's'} marked as applying`);
}

console.log('\nDone. Nothing that was already there was changed or removed.');
