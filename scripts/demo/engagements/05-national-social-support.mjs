// National Social Support Agency: a public body paying cash benefits. Its
// minister has asked for an independent review of AI before a fraud model
// goes live. Members only. Modules: Statement of Applicability, incidents.
export const engagement = {
  name: 'Public sector AI review',
  client: 'National Social Support Agency (demo)',
  prefix: 'NSSA',
  color: '#c76fd6',
  sector: 'Public sector',
  frameworks: ['nistAiRmf', 'iso42001', 'jdpa', 'euAiAct'],
  about: 'Government agency paying cash benefits to about 410,000 people: families with children, older people and people with disabilities. Decisions can be appealed to a tribunal. The agency is subject to the Access to Information Act and the Jamaica Data Protection Act 2020; the EU AI Act is used as a benchmark because it treats access to public benefits as high risk.',
  appetite: { maxResidual: 6, statement: 'Very low appetite for any AI that can stop, reduce or claw back a benefit. Above a residual of 6 the Permanent Secretary decides.', escalateTo: 'Permanent Secretary' },
};

export async function build(ctx, { step }) {
  await ctx.configure({ modules: { soa: true, incidents: true }, access: 'members' });
  await ctx.knowledge('NSSA benefit decisions and appeals procedure', [
    '1. A benefit can only be stopped, reduced or recovered by a decision officer, who must record the reasons.',
    '2. The claimant is told the decision and the reasons in writing, and how to appeal, within 10 working days.',
    '3. A fraud referral is not a finding of fraud. Payments continue while a referral is investigated unless a manager approves a suspension.',
  ]);

  const fraud = await ctx.useCase({
    title: 'Benefit fraud risk scoring', businessOwner: 'Director of Compliance and Investigations',
    description: 'Scores every active claim each month for fraud risk and sends the top 2% to investigators. Abroad, a tax authority\'s risk model wrongly flagged thousands of families as fraudsters, many with dual nationality, and an automated debt scheme raised unlawful debts; the minister wants to be sure that cannot happen here.',
    dataUsed: 'Claim records, household composition, bank account changes, address history, nationality, payments from other agencies.',
    affectedPeople: 'Every benefit recipient, about 410,000 people, many on low incomes.',
    autonomy: 'human_in_loop', vendor: 'Consultancy-built model, now run by the agency\'s IT unit', category: 'decision', priority: 'p1',
  });
  await ctx.toClassification(fraud.key);
  await ctx.verify(fraud.key);
  await ctx.approveClassification(fraud.key, {
    note: 'Tier agreed; nationality as an input to be challenged at design',
    decide: async (id, c) => {
      const i = c.classification.risks.findIndex((r) => /bias|fair/i.test(r.category));
      if (i >= 0) await ctx.edit(id, `risk:${i}`, { likelihood: 4, impact: 5 }, 'Nationality is an input; the overseas cases show the harm is severe and wide');
    },
  });
  const fc = (await ctx.card(fraud.key)).card;
  await ctx.issue({ title: 'No written reasons when a referral leads to suspension', severity: 'high', cardId: fc.id, owner: 'Director of Compliance and Investigations', description: 'Condition: suspensions after a fraud referral are recorded as "risk score" with no reasons. Criteria: procedure section 2 needs written reasons and how to appeal. Effect: claimants cannot challenge the decision. Recommendation: block suspension until reasons are recorded.' });
  step(`${fraud.key} Benefit fraud risk scoring: classified with the bias risk raised, controls drafted, an issue on missing reasons`);

  const help = await ctx.useCase({
    title: 'Benefits helpline assistant', businessOwner: 'Head of Customer Contact',
    description: 'A chatbot on the agency website and WhatsApp answers questions about eligibility and payment dates in English and Jamaican Patois, and can check the status of a claim after the caller gives their reference and date of birth.',
    dataUsed: 'Claim status, payment dates, the published eligibility rules.',
    affectedPeople: 'Claimants and families, about 25,000 chats a month expected.', autonomy: 'human_on_loop', vendor: 'Government cloud chatbot platform', category: 'chatbot', priority: 'p2',
  });
  await ctx.toClassification(help.key);
  step(`${help.key} Benefits helpline assistant: classification drafted, waiting for decisions`);

  const letters = await ctx.useCase({
    title: 'Decision letter drafting', businessOwner: 'Head of Benefit Operations',
    description: 'Drafts the letter explaining a benefit decision from the decision officer\'s notes. The officer edits and sends it.',
    dataUsed: 'Decision officer notes, claimant name and address, the decision.',
    affectedPeople: 'Claimants receiving decisions, about 6,000 letters a month.', autonomy: 'human_in_loop', vendor: 'Office productivity AI assistant', category: 'generative', priority: 'p3',
  });
  step(`${letters.key} Decision letter drafting: in Intake`);
}
