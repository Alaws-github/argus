// Northshore Financial Group: a Jamaican bank and insurer that wants the
// whole of ARGUS, every module on. This is the "full app" engagement: use
// cases at every step, a failed control and its issue, an incident, red
// teaming and monitoring, golden runs, the Verifier and an assistant
// conversation. It uses the engagement the database is seeded with (the
// five Northshore use cases AI-1 to AI-5), so it always runs first.
import { B, sleep } from '../lib.mjs';

export const engagement = {
  useSeeded: true,
  name: 'AI assurance 2026',
  client: 'Northshore Financial Group (demo)',
};

export async function build(ctx, { step }) {
  const { E, andrew, jordan, riley, sam, card, waitFor } = ctx;
  await ctx.configure({
    modules: { evals: true, incidents: true, inventory: true, connectors: true, soa: true, advanced_ai: true },
  });
  // ---- Engagement set-up: all six agents on, a client policy in the knowledge base
  const agents = await andrew('GET', `/engagements/${E}/agents`);
  for (const a of agents) if (!a.enabled) await andrew('PATCH', `/agents/${a.id}`, { enabled: true });
  await andrew('PATCH', `/engagements/${E}`, {
    framework: 'EU AI Act, ISO/IEC 42001, NIST AI RMF, Jamaica Data Protection Act 2020',
    appetite: {
      maxResidual: 8,
      statement:
        'The group accepts low residual AI risk in back-office use. Anything affecting customers above a residual score of 8 goes to the Board Risk Committee.',
      escalateTo: 'Board Risk Committee',
    },
  });
  await sam('POST', `/engagements/${E}/knowledge`, {
    title: 'Northshore Group AI Policy v2 (2026)',
    text: [
      '1. Purpose. This policy sets how Northshore Financial Group adopts and oversees artificial intelligence.',
      '2. Approval. No AI system that affects customers may go live without a risk classification and approval by the Model Risk Committee.',
      '3. Human review. Any AI recommendation to decline credit, refuse a claim or close an account must be reviewed by a trained officer before it is sent. Officers may override the recommendation and must record why.',
      '4. Transparency. Customer-facing chatbots must tell customers in their first message that they are an AI, and offer a person on request.',
      '5. Vendors. AI vendors must be assessed before use. Contracts must bar the vendor from training on Northshore data and give Northshore audit rights.',
      '6. Monitoring. Owners of live AI systems report accuracy, overrides and complaints to the Model Risk Committee every quarter.',
    ].join('\n\n'),
  });
  for (const code of ['DAT-04', 'SEC-05', 'OVS-03']) {
    const lib = (await andrew('GET', `/engagements/${E}/soa`)).find((l) => l.code === code);
    const why = {
      'DAT-04':
        'In scope for later: no AI vendor in this engagement processes personal data outside Jamaica today (confirmed with the DPO).',
      'SEC-05': 'Applies; usage limits are set on each AI service contract.',
      'OVS-03': 'Applies to the card replacement agent only.',
    }[code];
    await jordan('PUT', `/engagements/${E}/soa/${lib.id}`, { applicable: code !== 'DAT-04', justification: why });
  }
  step('Agents switched on, client AI policy uploaded, risk appetite and applicability set');

  // ---- Helpers for the workflow
  async function classifyAndDesign(key, { decide } = {}) {
    const { card: c } = await card(key);
    await riley('POST', `/cards/${c.id}/actions`, { action: 'approve' });
    let d = await waitFor(key, (x) => x.stage === 'classify' && x.status === 'needs_approval', 'classification');
    if (decide) await decide(c.id, d.card);
    await riley('POST', `/cards/${c.id}/decisions`, { rest: 'accept' });
    await riley('POST', `/cards/${c.id}/actions`, {
      action: 'approve',
      note: 'Tier and risks agreed with the business owner',
    });
    d = await waitFor(key, (x) => x.stage === 'design' && x.status === 'needs_approval', 'design');
    await andrew('POST', `/cards/${c.id}/verify`, {});
    return { id: c.id, d };
  }
  async function approveDesign(key, id) {
    await riley('POST', `/cards/${id}/decisions`, { rest: 'accept' });
    await riley('POST', `/cards/${id}/actions`, { action: 'approve' });
    return waitFor(key, (x) => x.stage === 'evidence' && x.status === 'needs_approval', 'evidence plan');
  }
  // Evidence goes on each control's test, so the Testing page shows what backs it.
  async function collect(d, notes) {
    const tests = await andrew('GET', `/engagements/${E}/tests`);
    for (const [i, c] of d.controls.entries()) {
      const t = tests.find((x) => x.controlId === c.id);
      const n = notes(i, c);
      const body = n.csv
        ? { kind: 'file', filename: n.filename, mime: 'text/csv', dataBase64: Buffer.from(n.csv).toString('base64') }
        : { kind: 'note', note: n.note };
      await sam('POST', '/evidence', {
        engagementId: E,
        controlId: c.id,
        ...(t ? { testId: t.id } : {}),
        title: n.title,
        ...body,
      });
    }
  }

  // ---- AI-2 Customer service chatbot: the whole way round, with a failed control
  {
    const { id, d: design } = await classifyAndDesign('AI-2');
    let d = await approveDesign('AI-2', id);
    await collect(d, (i, c) =>
      i === 0
        ? {
            title: `Escalation sample, October (${c.key})`,
            note: 'Sampled 25 chats escalated to an agent in October: 2 of 25 chats escalated without a transcript reaching the agent.',
          }
        : {
            title: `Walkthrough and sample (${c.key})`,
            note: `Walked through ${c.title} with the Customer Experience Manager and sampled 25 cases from October. No exceptions found in 25 sampled.`,
          },
    );
    await riley('POST', `/cards/${id}/actions`, { action: 'approve' });
    d = await waitFor('AI-2', (x) => x.stage === 'test' && x.status === 'needs_approval', 'test drafts');
    const tests = (await andrew('GET', `/engagements/${E}/tests`)).filter((t) =>
      d.controls.some((c) => c.id === t.controlId),
    );
    const fail = tests.find((t) => t.draft?.proposed === 'fail') ?? tests[0];
    for (const t of tests) {
      const f = t.id === fail.id;
      await sam(
        'PATCH',
        `/tests/${t.id}`,
        f
          ? {
              status: 'failed',
              actual: t.draft?.actual || '2 of 25 escalations reached the agent without the transcript',
              exceptions: t.draft?.exceptions ?? 2,
              sampleSize: 25,
              fromDraft: !!t.draft,
            }
          : { status: 'passed', actual: 'Sample of 25 from October, no exceptions', exceptions: 0, sampleSize: 25 },
      );
    }
    for (const t of tests) await riley('POST', `/tests/${t.id}/review`, {});
    const issue = await sam('POST', `/engagements/${E}/issues`, {
      title: 'Chats escalated to an agent without the transcript',
      severity: 'medium',
      testId: fail.id,
      controlId: fail.controlId,
      cardId: id,
      owner: 'Customer Experience Manager',
      description:
        'Condition: 2 of 25 escalated chats in October reached the agent without the transcript. Criteria: the agent must see the full chat before replying. Cause: the platform drops transcripts over 4,000 characters. Effect: customers repeat themselves and complaints are harder to investigate. Recommendation: fix the transcript hand-off and retest on November escalations.',
    });
    await sam('PATCH', `/issues/${issue.id}`, {
      status: 'in_remediation',
      managementResponse: 'Vendor ticket raised to lift the transcript size limit; fix due in the December release.',
      dueDate: '2026-12-15',
    });
    await riley('POST', `/cards/${id}/actions`, { action: 'approve' });
    await waitFor('AI-2', (x) => x.stage === 'remediate', 'remediate');
    await riley('POST', `/cards/${id}/actions`, { action: 'advance' });
    d = await waitFor('AI-2', (x) => x.stage === 'validate' && x.status === 'needs_approval', 'review assistant');
    await riley('POST', `/cards/${id}/decisions`, { rest: 'accept' });
    await riley('POST', `/cards/${id}/actions`, {
      action: 'approve',
      note: 'Challenges weighed; the failed control is tracked as an issue with a due date',
    });
    d = await waitFor('AI-2', (x) => x.stage === 'report' && x.status === 'needs_approval', 'board summary');
    await riley('POST', `/cards/${id}/decisions`, {
      item: 'summary',
      decision: 'edit',
      edit: { headline: 'Customer service chatbot: one control failed; fix due December before wider rollout' },
      reason: 'Plainer for the board, with the date',
    });
    await riley('POST', `/cards/${id}/actions`, { action: 'approve' });
    await waitFor('AI-2', (x) => x.stage === 'closed', 'closed');
    void design;
    step(
      'AI-2 Customer service chatbot: classified, controls designed, tested (one failed), issue in remediation, board summary approved',
    );
  }

  // ---- Evaluations of the chatbot itself
  for (const s of await andrew('GET', `/engagements/${E}/evals`)) {
    const run = await sam('POST', `/evals/${s.id}/run`, {});
    let rr;
    for (let i = 0; i < 60; i++) {
      rr = await andrew('GET', `/eval-runs/${run.runId}`);
      if (rr.status !== 'running') break;
      await sleep(300);
    }
    if (s.kind === 'red_team' && rr.passed < rr.total) await sam('POST', `/eval-runs/${rr.id}/issues`, {});
  }
  for (const i of await andrew('GET', `/engagements/${E}/issues`)) {
    if (!i.owner) await sam('PATCH', `/issues/${i.id}`, { owner: 'Head of Digital' });
  }
  step('Chatbot evaluations run: answer quality and red team, with issues raised from red-team failures');

  // ---- Monitoring and an incident on the live chatbot
  const redSuite = (await andrew('GET', `/engagements/${E}/evals`)).find((s) => s.kind === 'red_team');
  await jordan('PATCH', `/evals/${redSuite.id}/schedule`, { schedule: 'weekly' });
  const bot = (await andrew('GET', `/engagements/${E}/inventory`)).find((i) => /chatbot/i.test(i.name));
  const chatbotCard = (await card('AI-2')).card;
  const inc = await sam('POST', `/engagements/${E}/incidents`, {
    title: 'Chatbot quoted the old card replacement fee to customers',
    description:
      'Between 28 and 30 October the chatbot told customers the replacement fee was J$500; it is J$1,200. 41 chats affected. Customers were charged the correct fee, but some complained.',
    severity: 'medium',
    occurredAt: new Date(Date.now() - 4 * 864e5).toISOString(),
    awareAt: new Date(Date.now() - 20 * 3600_000).toISOString(),
    inventoryId: bot.id,
    cardId: chatbotCard.id,
    owner: 'Customer Experience Manager',
    clocks: ['internal'],
  });
  await sam('PATCH', `/incidents/${inc.id}`, {
    status: 'contained',
    note: 'Fee answer switched to the human team while the knowledge source is fixed',
  });
  await sam('POST', `/engagements/${E}/issues`, {
    title: 'Chatbot fee answers come from an out-of-date page',
    severity: 'medium',
    incidentId: inc.id,
    cardId: chatbotCard.id,
    owner: 'Head of Digital',
    description: 'Point the chatbot at the live fee schedule and add a quality eval case for fees.',
  });
  step('Red-team suite monitored weekly; an incident on the chatbot, contained, with a corrective action');

  // ---- AI-1 Loan pre-approval: tested and waiting for sign-off at Validate
  {
    const { id } = await classifyAndDesign('AI-1', {
      decide: async (cid, c) => {
        const privacy = c.classification.risks.findIndex((r) => r.category === 'privacy');
        if (privacy >= 0)
          await riley('POST', `/cards/${cid}/decisions`, {
            item: `risk:${privacy}`,
            decision: 'edit',
            edit: { likelihood: 2 },
            reason: 'The DPO confirmed a recorded lawful basis and purpose for bureau data',
          });
        const accuracy = c.classification.risks.findIndex((r) => r.category === 'accuracy');
        if (accuracy >= 0)
          await riley('POST', `/cards/${cid}/decisions`, {
            item: `risk:${accuracy}`,
            decision: 'reject',
            reason: 'Covered by the group model validation review, already in the register as R-GRP-4',
          });
      },
    });
    let d = await card('AI-1');
    const owners = d.card.design.controls.map((c, i) => [i, c]).filter(([, c]) => /business owner/i.test(c.owner));
    for (const [i] of owners)
      await riley('POST', `/cards/${id}/decisions`, {
        item: `control:${i}`,
        decision: 'edit',
        edit: { owner: 'Head of Retail Credit' },
        reason: 'Named the accountable owner',
      });
    d = await approveDesign('AI-1', id);
    // The first control gets a system export; the rest rest on walkthrough
    // notes, which the Review assistant will challenge at Validate.
    const csv = [
      'application_id,decided_on,model_recommendation,officer,officer_decision,override_reason',
      ...Array.from(
        { length: 25 },
        (_, k) =>
          `LN-${24081 + k * 37},2026-0${7 + (k % 3)}-${String(3 + k).padStart(2, '0')},${k % 4 ? 'approve' : 'decline'},officer-${1 + (k % 5)},${k % 7 === 0 ? 'approve' : k % 4 ? 'approve' : 'decline'},${k % 7 === 0 && k % 4 === 0 ? 'Income verified by payslip; bureau record out of date' : ''}`,
      ),
    ].join('\n');
    await collect(d, (i, c) =>
      i === 0
        ? { title: `Loan decision export, Q3 sample of 25 (${c.key})`, filename: 'loan-decisions-q3-sample.csv', csv }
        : {
            title: `Loan file walkthrough, Q3 (${c.key})`,
            note: `Walked through ${c.title} with the Head of Retail Credit and sampled 25 loan decisions from Q3. No exceptions found in 25 sampled.`,
          },
    );
    await riley('POST', `/cards/${id}/actions`, { action: 'approve' });
    d = await waitFor('AI-1', (x) => x.stage === 'test' && x.status === 'needs_approval', 'test drafts');
    const tests = (await andrew('GET', `/engagements/${E}/tests`)).filter((t) =>
      d.controls.some((c) => c.id === t.controlId),
    );
    for (const t of tests)
      await sam('PATCH', `/tests/${t.id}`, {
        status: 'passed',
        actual: 'Sample of 25 Q3 decisions; review recorded on all 25',
        exceptions: 0,
        sampleSize: 25,
      });
    for (const t of tests) await riley('POST', `/tests/${t.id}/review`, {});
    // Residual risk: one accepted within appetite, one above it waiting for the lead.
    const risks = (await andrew('GET', `/engagements/${E}/risks`)).filter((r) => r.cardKey === 'AI-1');
    if (risks[0]) {
      await sam('PATCH', `/risks/${risks[0].id}`, { residual_likelihood: 2, residual_impact: 3 });
      await riley('PATCH', `/risks/${risks[0].id}`, { accept: true });
    }
    if (risks[1]) await sam('PATCH', `/risks/${risks[1].id}`, { residual_likelihood: 3, residual_impact: 4 });
    await riley('POST', `/cards/${id}/actions`, { action: 'approve' });
    await waitFor('AI-1', (x) => x.stage === 'remediate', 'remediate');
    await riley('POST', `/cards/${id}/actions`, { action: 'advance' });
    await waitFor('AI-1', (x) => x.stage === 'validate' && x.status === 'needs_approval', 'review assistant');
    step(
      'AI-1 Loan pre-approval: risk decisions with an edit and a rejection, controls with named owners, tests passed and reviewed; waiting for sign-off',
    );
  }

  // ---- AI-3 Board paper summariser: classification waiting for decisions, checked by the Verifier
  {
    const { card: c } = await card('AI-3');
    await riley('POST', `/cards/${c.id}/actions`, { action: 'approve' });
    await waitFor('AI-3', (x) => x.stage === 'classify' && x.status === 'needs_approval', 'classification');
    await andrew('POST', `/cards/${c.id}/verify`, {});
    step('AI-3 Board paper summariser: classification drafted and checked by the Verifier, waiting for decisions');
  }

  // ---- AI-5 Motor claims triage: new use case, control design waiting
  {
    const nc = await sam('POST', `/engagements/${E}/cards`, {
      title: 'Motor claims triage',
      businessOwner: 'Claims Manager',
      description:
        "Reads new motor insurance claims and pays small claims under J$150,000 automatically. Larger or unusual claims go to an adjuster with the model's notes.",
      dataUsed: 'Claim forms, photos of damage, policy and claims history, police report numbers.',
      affectedPeople: 'Motor policyholders making a claim, about 900 a month.',
      autonomy: 'autonomous',
      vendor: 'In-house model built on a third-party vision service',
      category: 'decision',
      priority: 'p1',
    });
    const { id } = await classifyAndDesign(nc.key);
    void id;
    step(`${nc.key} Motor claims triage: added by Sam, classified, control design waiting for decisions`);
  }
  // AI-4 Expense receipt categoriser stays at Intake, for a live demo.

  // ---- v1.1: a second classifier for chatbots, a plan in progress, act as on
  await andrew('POST', `/engagements/${E}/agents`, {
    stage: 'classify',
    name: 'Chatbot classifier',
    route: 'cat_chatbot',
    instructions:
      'For chatbots, look hard at prompt injection, disclosure of personal data in answers, and whether customers are told they are talking to an AI.',
  });
  {
    const p = await sam('POST', `/engagements/${E}/plans`, {});
    await sam('POST', `/plans/${p.id}/messages`, {
      text: 'We want to use an AI agent that reads incoming broker emails and books renewal quotes in the policy system. An underwriter checks each quote before it is sent.',
    });
    await sam('POST', `/plans/${p.id}/messages`, { text: 'Broker renewal quoting agent' });
    await sam('POST', `/plans/${p.id}/messages`, { text: 'Head of Commercial Underwriting' });
  }
  step("A Chatbot classifier routed chatbots, and Sam's plan in progress with the Use Case Planner");

  // ---- Maturity assessment (not signed: the lead signs during the demo)
  // Scored the way a cautious assessor would early on: never above 3 until a
  // full cycle of monitoring has been seen.
  for (const a of await andrew('GET', `/engagements/${E}/assessment`)) {
    const score = Math.min(a.suggested ?? 2, 3);
    const why = (a.reasons ?? []).join('; ') || 'Scored from the evidence so far';
    await andrew('PUT', `/engagements/${E}/assessment/${a.id}`, {
      score,
      rationale:
        score < (a.suggested ?? 0) ? `${why}. Held at 3 until a full quarter of monitoring has been seen.` : why,
    });
  }
  step('Maturity assessment scored; the report waits for the lead to sign');

  // ---- Agent testing and the Verifier
  const provs = await andrew('GET', '/providers');
  const rules = provs.find((p) => p.type === 'rules');
  for (const agent of ['risk_classifier', 'control_designer']) {
    const { id } = await andrew('POST', '/agent-testing/runs', {
      agent,
      providerId: rules.id,
      model: rules.models[0],
      withVerifier: true,
    });
    for (let i = 0; i < 100; i++) {
      const r = await andrew('GET', `/agent-testing/runs/${id}`);
      if (r.status !== 'running') break;
      await sleep(300);
    }
  }
  await andrew('POST', '/agent-testing/labels/import', {});
  await andrew('POST', '/agent-testing/calibrate', {});
  step("Golden runs for both agents, reviewers' decisions added as labels, Verifier measured");

  // ---- One assistant conversation, for the walkthrough
  const ai1 = (await card('AI-1')).card;
  await riley('POST', `/engagements/${E}/assistant`, {
    kind: 'card',
    contextId: ai1.id,
    question: 'What should I check before signing this off?',
  });
  step('An assistant conversation on AI-1 (as Riley)');

  // An evidence connector to the core banking report server (pulled by hand, so the demo needs no network).
  const ctl = (await andrew('GET', `/engagements/${E}/controls`))[0];
  await jordan('POST', `/engagements/${E}/connectors`, {
    name: 'Core banking: monthly loan decision export',
    url: 'https://reports.northshore-demo.example/exports/loan-decisions.csv',
    auth: 'none',
    controlId: ctl?.id ?? null,
    schedule: 'manual',
    enabled: true,
  }).catch((e) => console.warn('  (connector skipped)', e.message));
  step('An evidence connector set up to the core banking report server');

  // ---- v1.7.3 and v1.7.4: the client's tools, a workflow with proof, a pipeline, write-back (off), across frameworks
  await jordan('PATCH', `/engagements/${E}`, {
    clientTools: ['sharepoint', 'teams', 'excel', 'power_automate', 'outlook', 'jira'],
  });
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
  const cs = await sam('GET', '/cards/AI-1/client-steps');
  const manual = cs.steps.filter((x) => x.proof === 'manual');
  if (manual[0])
    await sam('POST', `/cards/AI-1/client-steps/${manual[0].nodeId}/confirm`, {
      link: 'https://northshore-demo.example/approvals/power-automate/4471',
      note: 'Tier approved in the Power Automate flow',
    });
  if (manual[1])
    await sam('POST', `/cards/AI-1/client-steps/${manual[1].nodeId}/confirm`, {
      link: 'https://northshore-demo.example/sharepoint/impact-assessments/AI-1',
      note: 'Impact assessment v2 in the library',
    });
  step('A published client workflow with proof on three steps; two confirmed on AI-1');
  const tk = await jordan('POST', `/engagements/${E}/ingest-tokens`, { name: 'Credit model CI' });
  await fetch(`${B}/ingest/evidence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tk.token}` },
    body: JSON.stringify({
      title: 'Credit model 2.3: evaluation results',
      kind: 'eval',
      useCase: 'AI-1',
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
  }).catch(() => {});
  step('A pipeline token, and one push of evaluation results for AI-1');
  await jordan('POST', `/engagements/${E}/outbound`, {
    name: 'Model Risk channel',
    kind: 'teams',
    url: 'https://northshore-demo.example/teams-webhook/model-risk',
    events: ['card.waiting', 'test.failed', 'issue.raised'],
  }).catch(() => {});
  step('A write-back target to the Model Risk channel (write-back stays off)');
  const csv =
    'Title,Objective,Type\nVendor contracts reviewed for AI data use,Contracts with AI suppliers are checked before signing for data use and audit rights,preventive\nQuarterly penetration test of the chatbot,Security test the chatbot every quarter,detective\n';
  const imp = await jordan('POST', `/engagements/${E}/controls/import`, {
    filename: 'northshore-controls.csv',
    dataBase64: Buffer.from(csv).toString('base64'),
    preview: false,
  });
  const c0 = (await andrew('GET', `/engagements/${E}/controls`)).find((c) => c.key === imp.added?.[0]);
  if (c0) await sam('POST', `/controls/${c0.id}/map`, { libraryCode: 'TPR-01' });
  step("Two of Northshore's own controls uploaded; one mapped to the library across frameworks");
  for (const ref of ['Art. 53', 'Art. 54', 'Art. 55'])
    await jordan('PUT', `/engagements/${E}/requirements/euAiAct`, {
      ref,
      applicable: false,
      reason: 'Northshore uses general-purpose models from vendors; it does not provide one.',
    }).catch(() => {});
  step('EU AI Act model-provider articles marked not applicable, with the reason');
}
